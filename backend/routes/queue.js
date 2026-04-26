const express = require('express');
const router = express.Router();
const { adminSupabase } = require('../client');

// ── GET QUEUE INFO (PUBLIC) ───────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    // 1. Ambil Batch Aktif
    const { data: batch, error: bErr } = await adminSupabase
      .from('batches')
      .select('*')
      .eq('status', 'active')
      .single();

    if (bErr || !batch) {
      return res.json({ success: true, data: { is_open: false, available: 0, total_quota: 0 } });
    }

    // 2. Ambil Status Master Gate dari Config
    const { data: config } = await adminSupabase.from('config').select('*').eq('key', 'is_queue_open').single();
    const isMasterGateOpen = config ? (config.value === 'true' || config.value === true) : false;

    // 3. Hitung Antrean Aktif (Reserved)
    const { count: activeQueues, error: qErr } = await adminSupabase
      .from('queue_slots')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .neq('status', 'expired');

    if (qErr) throw qErr;

    const available = Math.max(0, batch.total_slots - (activeQueues || 0));

    res.json({
      success: true,
      data: {
        is_open: isMasterGateOpen, // Gerbang Utama
        available: available,
        total_quota: batch.total_slots,
        batch_name: batch.name,
        session_size: 200, // Sesuai permintaan: 200 per sesi
        wave_size: 10,     // Sesuai permintaan: 10 orang per gelombang
        wave_interval: 10  // 10 menit
      }
    });
  } catch (err) {
    console.error("Queue Info Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CHECK STATUS (USER) ───────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: "No token" });
    const token = authHeader.split(' ')[1];
    
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: "Invalid token" });

    // Cek apakah user punya slot antrean
    const { data: slot, error: sErr } = await adminSupabase
      .from('queue_slots')
      .select('*, batches(status, name, total_slots)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (sErr || !slot) return res.json({ success: true, status: 'not_queued' });
    if (slot.status === 'expired') return res.json({ success: true, status: 'expired' });
    if (slot.status === 'done') return res.json({ success: true, status: 'done' });

    // LOGIKA SESI & GELOMBANG (10 Orang / 10 Menit)
    const now = new Date();
    const batchStart = new Date(slot.created_at);
    const diffMs = now - batchStart;
    const minutesElapsed = Math.floor(diffMs / 60000);

    // Hitung apakah nomor antreannya sudah boleh masuk
    // Contoh: Nomor 1-10 masuk menit 0, Nomor 11-20 masuk menit 10, dst.
    const myWaveNumber = Math.ceil(slot.queue_number / 10);
    const requiredMinutes = (myWaveNumber - 1) * 10;

    let finalStatus = slot.status;
    if (slot.status === 'waiting' && minutesElapsed >= requiredMinutes) {
        // Otomatis Aktifkan jika waktu sudah tiba
        await adminSupabase.from('queue_slots').update({ 
            status: 'active',
            activated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }).eq('id', slot.id);
        finalStatus = 'active';
    }

    res.json({
      success: true,
      status: finalStatus,
      data: {
        queue_number: slot.queue_number,
        session: Math.ceil(slot.queue_number / 200),
        expires_at: slot.expires_at,
        minutes_to_wait: Math.max(0, requiredMinutes - minutesElapsed)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CLAIM SLOT ────────────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];
    const { data: { user } } = await adminSupabase.auth.getUser(token);

    // 1. Cek Batch
    const { data: batch } = await adminSupabase.from('batches').select('*').eq('status', 'active').single();
    if (!batch) return res.status(400).json({ success: false, error: "Tidak ada batch aktif" });

    // 2. Cek apakah Master Gate Terbuka
    const { data: config } = await adminSupabase.from('config').select('*').eq('key', 'is_queue_open').single();
    if (!config || config.value !== 'true') return res.status(400).json({ success: false, error: "Antrean sedang ditutup sementara" });

    // 3. Hitung Antrean Aktif
    const { count } = await adminSupabase.from('queue_slots').select('*', { count: 'exact', head: true }).eq('batch_id', batch.id).neq('status', 'expired');
    
    if (count >= batch.total_slots) {
        return res.status(400).json({ success: false, error: "Maaf, kuota batch ini sudah habis sepenuhnya!" });
    }

    // 4. Buat Slot Baru
    const nextNumber = (count || 0) + 1;
    const { data: newSlot, error: insErr } = await adminSupabase.from('queue_slots').insert({
        user_id: user.id,
        batch_id: batch.id,
        queue_number: nextNumber,
        status: 'waiting'
    }).select().single();

    if (insErr) throw insErr;
    res.json({ success: true, data: newSlot });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── RESET ─────────────────────────────────────────────────────────
router.post('/reset', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader.split(' ')[1];
        const { data: { user } } = await adminSupabase.auth.getUser(token);

        await adminSupabase.from('queue_slots').update({ status: 'expired' }).eq('user_id', user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
