const express = require('express');
const router = express.Router();
const { adminSupabase } = require('../supabaseClient');

// ── HELPER: Kirim WA via Fonnte ───────────────────────────────────
async function sendFontteWA(whatsapp, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn('[FONNTE] FONNTE_TOKEN tidak diset — skip kirim WA');
    return { skipped: true };
  }

  const params = new URLSearchParams({ target: whatsapp, message });
  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: token },
    body: params
  });

  const data = await res.json();
  if (!data.status) throw new Error(`Fonnte error: ${JSON.stringify(data)}`);
  return data;
}

// ── HELPER: Generate token unik ───────────────────────────────────
function generateToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * POST /api/slot-queue/add
 * Dipanggil Google Apps Script tiap kali ada submit Google Form
 */
router.post('/add', async (req, res) => {
  const { full_name, whatsapp, batch_id } = req.body;

  if (!full_name || !whatsapp || !batch_id) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap: full_name, whatsapp, batch_id wajib diisi.' });
  }

  // Normalisasi nomor WA: 08xx → 628xx
  const normalizedWA = whatsapp.replace(/\D/g, '').replace(/^0/, '62');

  try {
    // Cek duplikat WA di batch ini
    const { data: existing } = await adminSupabase
      .from('slot_queue')
      .select('id, status')
      .eq('batch_id', batch_id)
      .eq('whatsapp', normalizedWA)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, error: 'Nomor WA ini sudah terdaftar di antrian batch ini.' });
    }

    const { data, error } = await adminSupabase
      .from('slot_queue')
      .insert({ full_name: full_name.trim(), whatsapp: normalizedWA, batch_id, status: 'waiting' })
      .select('id')
      .single();

    if (error) throw error;

    console.log(`[SLOT_QUEUE] Tambah antrian: ${full_name} (${normalizedWA})`);
    res.json({ success: true, id: data.id });

  } catch (err) {
    console.error('[SLOT_QUEUE_ADD_ERR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/slot-queue/allocate
 * Dipanggil Google Apps Script saat kuota tercapai (submit ke-N)
 * Generates token + blast WA via Fonnte
 */
router.post('/allocate', async (req, res) => {
  // Auth sederhana pakai ADMIN_PASSWORD
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Unauthorized.' });
  }

  const { batch_id, count = 100, expiry_minutes = 30 } = req.body;

  if (!batch_id) {
    return res.status(400).json({ success: false, error: 'batch_id diperlukan.' });
  }

  try {
    // Ambil N orang pertama yang masih 'waiting' (FIFO)
    const { data: waitingList, error: fetchErr } = await adminSupabase
      .from('slot_queue')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(count);

    if (fetchErr) throw fetchErr;
    if (!waitingList || waitingList.length === 0) {
      return res.json({ success: true, allocated: 0, message: 'Tidak ada antrian yang menunggu.' });
    }

    // Info batch untuk pesan WA
    const { data: batch } = await adminSupabase
      .from('batches')
      .select('name')
      .eq('id', batch_id)
      .single();

    const batchName = batch?.name || 'Localogo';
    const expiresAt = new Date(Date.now() + expiry_minutes * 60 * 1000).toISOString();

    let allocated = 0;
    let failed = 0;

    for (const entry of waitingList) {
      const token = generateToken();
      const link = `https://localogo.id/claim-verification-v1-x92?token=${token}`;
      const message =
        `Halo ${entry.full_name}! 🎉\n\n` +
        `Selamat! Kamu berhasil mendapatkan slot pendaftaran *${batchName}*.\n\n` +
        `🔗 *Link pendaftaranmu:*\n${link}\n\n` +
        `⏰ Link ini hanya berlaku *${expiry_minutes} menit* — segera klik sekarang!\n\n` +
        `⚠️ Jangan share link ini ke orang lain, link hanya bisa dipakai 1x.\n\n` +
        `_Tim Localogo_`;

      try {
        // Simpan token ke DB
        const { error: updateErr } = await adminSupabase
          .from('slot_queue')
          .update({ token, token_expires_at: expiresAt, status: 'allocated' })
          .eq('id', entry.id);

        if (updateErr) throw updateErr;

        // Kirim WA
        await sendFontteWA(entry.whatsapp, message);
        allocated++;

        // Delay kecil agar tidak kena rate limit Fonnte
        await new Promise(r => setTimeout(r, 350));
      } catch (err) {
        console.error(`[ALLOCATE_ERR] ${entry.whatsapp}:`, err.message);
        failed++;
      }
    }

    console.log(`[ALLOCATE] Selesai — allocated: ${allocated}, failed: ${failed}`);
    res.json({ success: true, allocated, failed });

  } catch (err) {
    console.error('[ALLOCATE_CRASH]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/slot-queue/validate-token/:token
 * Dipanggil frontend saat halaman dibuka dengan ?token=xxx
 */
router.get('/validate-token/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.length < 10) {
    return res.json({ valid: false, reason: 'not_found' });
  }

  try {
    const { data, error } = await adminSupabase
      .from('slot_queue')
      .select('id, full_name, whatsapp, batch_id, token_expires_at, token_used_at')
      .eq('token', token)
      .single();

    if (error || !data) {
      return res.json({ valid: false, reason: 'not_found' });
    }

    if (data.token_used_at) {
      return res.json({ valid: false, reason: 'used' });
    }

    if (new Date(data.token_expires_at) < new Date()) {
      // Tandai sebagai expired
      await adminSupabase.from('slot_queue').update({ status: 'expired' }).eq('id', data.id);
      return res.json({ valid: false, reason: 'expired' });
    }

    res.json({
      valid: true,
      full_name: data.full_name,
      whatsapp: data.whatsapp,
      batch_id: data.batch_id,
      expires_at: data.token_expires_at,
      queue_id: data.id
    });
  } catch (err) {
    console.error('[VALIDATE_TOKEN_ERR]', err);
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

module.exports = router;
