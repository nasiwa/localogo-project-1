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

    const { count: orderCount } = await adminSupabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['paid', 'pending']);

    const totalUsed = orderCount || 0;
    const available = Math.max(0, cfg.total_quota - totalUsed);

    res.json({
      success: true,
      data: { is_open: cfg.is_open, available, total_quota: cfg.total_quota }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── VERIFY ACCESS CODE ────────────────────────────────────────────
router.post('/verify-code', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Kode tidak boleh kosong.' });

    const normalizedCode = code.trim().toUpperCase();

    const { data, error } = await adminSupabase
      .from('access_codes')
      .select('code, use_count, max_uses, batch_id')
      .eq('code', normalizedCode)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.json({ success: false, error: 'Kode tidak ditemukan atau tidak valid.' });
    
    if (data.use_count >= data.max_uses) {
      return res.json({ success: false, error: 'Kuota untuk kode sesi ini sudah penuh.' });
    }

    res.json({ success: true, batch_id: data.batch_id, code: normalizedCode });
  } catch (err) {
    console.error("Verify Code Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
