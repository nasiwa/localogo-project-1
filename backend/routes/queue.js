const express = require('express');
const router = express.Router();
const { adminSupabase } = require('../supabaseClient');

// ── GET QUEUE INFO (PUBLIC) ───────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const { data: cfg, error } = await adminSupabase
      .from('batch_config')
      .select('*')
      .limit(1)
      .single();

    if (error || !cfg) {
      return res.json({ success: true, data: { is_open: false, available: 0, total_quota: 0 } });
    }

    // 1. Hitung orang yang sedang antre aktif
    const { count: queueCount } = await adminSupabase
      .from('queue_slots')
      .select('*', { count: 'exact', head: true })
      .in('status', ['waiting', 'active']);

    // 2. Hitung total pesanan lunas/pending (SINKRON DENGAN DASHBOARD)
    const { count: orderCount } = await adminSupabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['paid', 'pending']);

    const totalUsed = (queueCount || 0) + (orderCount || 0);
    const available = Math.max(0, cfg.total_quota - totalUsed);

    res.json({
      success: true,
      data: {
        is_open: cfg.is_open,
        available,
        total_quota: cfg.total_quota,
      }
    });
  } catch (err) {
    console.error("Queue Info Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CLAIM QUEUE SLOT ──────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Tidak ada token.' });
    const token = authHeader.split(' ')[1];

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: 'Token tidak valid.' });

    // ── FIX STUCK: Hapus data EXPIRED dulu sebelum claim baru ──
    await adminSupabase
      .from('queue_slots')
      .delete()
      .eq('user_id', user.id)
      .eq('status', 'expired');

    // Cek apakah sudah punya order (Ghost Check)
    const { data: existingOrder } = await adminSupabase
      .from('orders')
      .select('id, email, status')
      .eq('email', user.email)
      .in('status', ['paid', 'pending'])
      .maybeSingle();

    if (existingOrder) {
      console.log("Ghost Order Found:", existingOrder);
      return res.status(400).json({ 
        success: false, 
        error: 'Email Anda sudah terdaftar. Jika Anda menghapus data di Supabase, pastikan hapus di tabel ORDERS.' 
      });
    }

    // Panggil RPC
    const { data, error } = await adminSupabase.rpc('claim_queue_slot', {
      p_user_id: user.id
    });

    if (error) throw error;
    
    // Jika RPC bilang already_queued tapi statusnya expired, kita force update (backup logic)
    if (data.message === 'already_queued' && data.data?.status === 'expired') {
        await adminSupabase.from('queue_slots').delete().eq('user_id', user.id);
        return res.status(400).json({ success: false, error: 'Sistem sedang refresh, silakan klik sekali lagi.' });
    }

    if (!data.success) return res.json({ success: false, error: data.error });

    res.json({ success: true, data: data.data });
  } catch (err) {
    console.error("Claim Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET USER STATUS ───────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'No token' });
    const token = authHeader.split(' ')[1];

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ success: false, error: 'Invalid token' });

    // 1. Cek Order Lunas/Pending
    const { data: order } = await adminSupabase
      .from('orders')
      .select('id, status')
      .eq('email', user.email)
      .in('status', ['paid', 'pending'])
      .maybeSingle();

    if (order) return res.json({ success: true, status: 'done' });

    // 2. Cek Antrean Aktif
    const { data: slot } = await adminSupabase
      .from('queue_slots')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'expired')
      .maybeSingle();

    if (!slot) return res.json({ success: true, status: 'not_queued' });

    // Wave Logic
    const queueNum = slot.queue_number;
    const requiredMinutes = (Math.ceil(queueNum / 10) - 1) * 10;
    const slotCreatedAt = new Date(slot.created_at).getTime();
    const now = Date.now();
    const minutesElapsed = Math.floor((now - slotCreatedAt) / 60000);

    if (slot.status === 'waiting' && minutesElapsed >= requiredMinutes) {
      const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
      await adminSupabase
        .from('queue_slots')
        .update({ status: 'active', activated_at: new Date().toISOString(), expires_at: expiresAt })
        .eq('id', slot.id);
      slot.status = 'active';
      slot.expires_at = expiresAt;
    }

    res.json({
      success: true,
      status: slot.status,
      data: {
        queue_number: queueNum,
        session: slot.session,
        minutes_to_wait: Math.max(0, requiredMinutes - minutesElapsed),
        expires_at: slot.expires_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reset', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader.split(' ')[1];
        const { data: { user } } = await adminSupabase.auth.getUser(token);
        await adminSupabase.from('queue_slots').delete().eq('user_id', user.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
