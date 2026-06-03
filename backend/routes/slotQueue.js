const express = require('express');
const router = express.Router();
const { adminSupabase } = require('../supabaseClient');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY || 'dummy_key_will_fail_at_send_time');

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
  const { full_name, whatsapp, email, batch_id } = req.body;

  if (!full_name || !whatsapp || !batch_id) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap: full_name, whatsapp, batch_id wajib diisi.' });
  }

  // Normalisasi nomor WA: 08xx → 628xx
  const normalizedWA = whatsapp.replace(/\D/g, '').replace(/^0/, '62');
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  try {
    // Cek duplikat WA / Email di batch ini
    let query = adminSupabase
      .from('slot_queue')
      .select('id, status')
      .eq('batch_id', batch_id);

    if (cleanEmail) {
      query = query.or(`whatsapp.eq.${normalizedWA},email.eq.${cleanEmail}`);
    } else {
      query = query.eq('whatsapp', normalizedWA);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, error: 'Nomor WA atau Email ini sudah terdaftar di antrian batch ini.' });
    }

    // Ambil info batch untuk nama batch
    const { data: batch } = await adminSupabase
      .from('batches')
      .select('name')
      .eq('id', batch_id)
      .single();

    const batchName = batch?.name || 'Localogo';

    // Generasi Token Instan & Expires
    const token = generateToken();
    const expiryMinutes = 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

    const { data, error } = await adminSupabase
      .from('slot_queue')
      .insert({
        full_name: full_name.trim(),
        whatsapp: normalizedWA,
        email: cleanEmail,
        batch_id,
        status: 'allocated',
        token,
        token_expires_at: expiresAt
      })
      .select('id')
      .single();

    if (error) throw error;

    console.log(`[SLOT_QUEUE] Sukses alokasi instan: ${full_name} (${normalizedWA}) - Email: ${cleanEmail}`);

    // Jika email di-submit, langsung kirim Link Pembayaran via Resend secara instan
    if (cleanEmail) {
      const link = `https://www.localogo.id/midtrans_payment?token=${token}`;
      
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
        <style>
          body{font-family:'Poppins', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;background-color:#f4f9f9;margin:0;padding:20px;}
          .card{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(2,72,71,0.08);border:1px solid #e0eeee;}
          .header{background:#024847;padding:50px 20px;text-align:center;color:#fff;}
          .header h1{margin:0;font-size:32px;letter-spacing:3px;font-weight:700;}
          .content{padding:40px;color:#2d5c5c;text-align:center;}
          .badge{display:inline-block;padding:8px 20px;background:#eefaf6;color:#10b981;border-radius:99px;font-weight:700;font-size:12px;margin-bottom:25px;border:1px solid #a7f3d0;}
          h2{font-size:22px;margin-bottom:15px;color:#024847;font-weight:700;}
          p{line-height:1.7;font-size:15px;margin-bottom:25px;color:#4a6e6e;}
          .btn-pay{display:inline-block;padding:16px 32px;background:#24999b;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;box-shadow:0 4px 15px rgba(36,153,155,0.25);margin-bottom:25px;}
          .timer-box{background:#fffbe6;padding:15px;border-radius:12px;border:1px solid #ffe58f;margin-bottom:25px;color:#856404;font-size:14px;font-weight:700;}
          .footer{background:#f9fdfd;padding:25px;text-align:center;font-size:12px;color:#6a9999;border-top:1px solid #eaf5f5;}
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h1>LOCALOGO</h1>
            <div style="font-size:12px;opacity:0.6;margin-top:10px;letter-spacing:1px;font-weight:700;">PRE-ORDER OSPEK 2026</div>
          </div>
          <div class="content">
            <div class="badge">SLOT SECURED</div>
            <h2>Halo, <strong>${full_name.trim()}</strong>! 👋</h2>
            <p>Selamat! Kamu berhasil mengamankan slot pendaftaran untuk <strong>${batchName}</strong>.</p>
            
            <div class="timer-box">
              ⏰ PENTING: Link pembayaran ini hanya berlaku selama ${expiryMinutes} menit!
            </div>

            <a href="${link}" class="btn-pay">Bayar Sekarang</a>

            <p style="font-size:13px; color:#8a9f9f;">Setelah pembayaran berhasil, invoice resmi dan link grup WhatsApp ${batchName} akan dikirimkan otomatis ke email kamu.</p>
          </div>
          <div class="footer">
            © 2026 LOCALOGO · Malang, Indonesia<br>
            <span style="opacity:0.7">Email ini dikirim otomatis oleh sistem pendaftaran.</span>
          </div>
        </div>
      </body>
      </html>`;

      await resend.emails.send({
        from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
        to: cleanEmail,
        subject: `KLAIM SLOT: Link Pembayaran ${batchName} - ${full_name.trim()}`,
        html,
        text: `Halo ${full_name.trim()}, selamat! Kamu berhasil mengamankan slot pendaftaran ${batchName}. Silakan lakukan pembayaran di link berikut: ${link}. Link ini hanya berlaku ${expiryMinutes} menit.`
      });
    }

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
      const link = `https://localogo.id/midtrans_payment?token=${token}`;
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
