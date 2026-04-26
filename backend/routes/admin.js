const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { adminSupabase } = require('../client');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');

/**
 * Middleware: Admin Authentication
 */
function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

router.get('/check', (req, res) => {
  res.json({ allowed: true });
});

// ── DASHBOARD STATS ──
router.get('/dashboard-stats', async (req, res) => {
  try {
    const { count: paidCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid');
    const { count: pendingCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    const { count: pickupCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid').eq('is_picked_up', true);
    const { data: batches } = await adminSupabase.from('batches').select('filled_slots, total_slots');

    const totalFilled = (paidCount || 0) + (pendingCount || 0);
    const totalSlots = batches ? batches.reduce((sum, b) => sum + (b.total_slots || 0), 0) : 0;

    res.json({
      success: true,
      paidCount: paidCount || 0,
      pendingCount: pendingCount || 0,
      pickupCount: pickupCount || 0,
      totalFilled,
      totalSlots,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MASTER GATE ──
router.get('/gate', async (req, res) => {
  try {
    const { data } = await adminSupabase.from('config').select('*').eq('key', 'is_queue_open').single();
    const is_open = data ? (data.value === 'true' || data.value === true) : false;
    res.json({ success: true, is_open });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/gate', async (req, res) => {
  try {
    const { is_open } = req.body;
    await adminSupabase.from('config').upsert({ key: 'is_queue_open', value: String(is_open), updated_at: new Date() }, { onConflict: 'key' });
    res.json({ success: true, is_open });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BATCHES ──
router.get('/batches', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.from('batches').select('*').order('sort_order');
    if (error) throw error;
    res.json({ success: true, batches: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/batch/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await adminSupabase.from('batches').update(req.body).eq('id', id).select().single();
    if (error) throw error;
    res.json({ success: true, batch: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ORDERS ──
router.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await adminSupabase.from('orders').select('*, batches(name)', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;
    res.json({ success: true, orders: data, total: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── AUTO EXPIRE (RESTORED) ──
router.post('/auto-expire', async (req, res) => {
  try {
    const { data: pendingOrders } = await adminSupabase.from('orders').select('id, created_at').eq('status', 'pending');
    const idsToExpire = [];
    const now = Date.now();
    (pendingOrders || []).forEach(o => {
      const age = now - new Date(o.created_at).getTime();
      if (age > 24 * 60 * 60 * 1000) idsToExpire.push(o.id); // 24 Jam
    });
    if (idsToExpire.length > 0) {
      await adminSupabase.from('orders').update({ status: 'expired' }).in('id', idsToExpire);
    }
    res.json({ success: true, expired_count: idsToExpire.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROOF URL ──
router.get('/proof-url/:filename', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.storage.from('transfer_proofs').createSignedUrl(req.params.filename, 3600);
    if (error) throw error;
    res.json({ success: true, signedUrl: data.signedUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CONFIRM MANUAL ──
router.post('/order/:orderRef/confirm-manual', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.rpc('confirm_payment', { p_order_ref: req.params.orderRef });
    if (error) throw error;
    res.json({ success: true, message: 'Confirmed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
