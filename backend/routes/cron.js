const express = require('express');
const router = express.Router();

// Middleware to verify Vercel Cron Request
function verifyCron(req, res, next) {
  const authHeader = req.headers.authorization;
  
  // Kalau di lokal (testing) tanpa CRON_SECRET, loloskan saja
  if (!process.env.CRON_SECRET) {
      console.warn('⚠️ CRON_SECRET is not set. Bypassing cron authentication. Make sure to set this in Vercel!');
      return next();
  }
  
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }
  next();
}

router.use(verifyCron);

// GET /api/cron/activate-wave
// Dijalankan setiap 7 menit oleh Vercel
router.get('/activate-wave', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    
    // 1. Ambil konfigurasi (berapa kapasitas per gelombang)
    const { data: config } = await supabase
      .from('batch_config')
      .select('wave_capacity, wave_duration_minutes, is_open')
      .limit(1)
      .single();
      
    if (!config || !config.is_open) {
      return res.json({ success: true, message: 'Antrean ditutup, tidak ada yang diaktivasi' });
    }

    // 2. Cari N orang terdepan yang statusnya masih 'waiting'
    const { data: waitingUsers, error: selectErr } = await supabase
      .from('queue_slots')
      .select('id')
      .eq('status', 'waiting')
      .order('queue_number', { ascending: true })
      .limit(config.wave_capacity);

    if (selectErr) throw selectErr;

    if (!waitingUsers || waitingUsers.length === 0) {
      return res.json({ success: true, message: 'Tidak ada user yang sedang menunggu' });
    }

    const idsToActivate = waitingUsers.map(u => u.id);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.wave_duration_minutes * 60000);

    // 3. Ubah status mereka menjadi 'active'
    const { error: updateErr } = await supabase
      .from('queue_slots')
      .update({
        status: 'active',
        activated_at: now.toISOString(),
        expires_at: expiresAt.toISOString()
      })
      .in('id', idsToActivate);

    if (updateErr) throw updateErr;

    res.json({ success: true, activated_count: idsToActivate.length, message: `Berhasil mengaktivasi ${idsToActivate.length} user.` });
  } catch (err) {
    console.error('Cron Activate Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cron/expire-slots
// Dijalankan setiap 1 menit oleh Vercel
router.get('/expire-slots', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    const now = new Date().toISOString();

    // Ubah status 'active' menjadi 'expired' jika waktu sudah habis
    const { data, error } = await supabase
      .from('queue_slots')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('expires_at', now)
      .select(); 

    if (error) throw error;

    res.json({ success: true, expired_count: data ? data.length : 0 });
  } catch (err) {
    console.error('Cron Expire Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
