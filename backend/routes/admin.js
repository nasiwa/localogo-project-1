const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');
const { snap } = require('../services/paymentProvider');

/**
 * Middleware: Admin Authentication
 */
function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// Apply auth to all admin routes
router.use(adminAuth);

/**
 * GET /api/admin/check — verify admin token
 */
router.get('/check', (req, res) => {
  res.json({ allowed: true });
});

/**
 * GET /api/admin/batches — full batch data for admin
 */
router.get('/batches', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .order('sort_order');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, batches: data });
});

/**
 * PATCH /api/admin/batch/:id — update batch settings
 */
router.patch('/batch/:id', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { id } = req.params;
  const updates = {};
  const allowed = ['status', 'reveal_at', 'total_slots', 'name', 'wa_group_url'];
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await supabase
    .from('batches')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, batch: data });
});

/**
 * GET /api/admin/orders — all orders
 */
router.get('/orders', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(name)')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, orders: data });
});

/**
 * GET /api/admin/batch/:id/members
 */
router.get('/batch/:id/members', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { id } = req.params;
  const { data, error } = await supabase
    .from('orders')
    .select('order_ref, full_name, email, whatsapp, status, created_at, is_picked_up, sequence_num, scanned_by')
    .eq('batch_id', id)
    .eq('status', 'paid')
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, members: data });
});

/**
 * GET /api/admin/order/:orderRef/sync
 */
router.get('/order/:orderRef/sync', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { orderRef } = req.params;
  try {
    const status = await snap.transaction.status(orderRef);
    const isSettled =
      status.transaction_status === 'settlement' ||
      (status.transaction_status === 'capture' && status.fraud_status === 'accept');

    if (isSettled) {
      const { data: confirmData, error: confirmErr } = await supabase
        .rpc('confirm_payment', { p_order_ref: orderRef });

      if (confirmErr) throw confirmErr;

      if (confirmData?.success) {
        const order = {
          order_ref: confirmData.order_ref,
          full_name: confirmData.full_name,
          email: confirmData.email,
          whatsapp: confirmData.whatsapp || 'N/A',
          batch_name: confirmData.batch_name,
          batch_num: confirmData.batch_num,
          sequence: confirmData.sequence,
          wa_group_url: confirmData.wa_group_url,
          paid_at: new Date().toISOString(),
        };
        try {
          const pdfBuffer = await generateInvoicePDF(order);
          await sendInvoiceEmail(order, pdfBuffer);
        } catch (e) { console.error('Email error during sync:', e); }
        return res.json({ success: true, status: 'paid', message: 'Order updated to Paid' });
      }
    }
    res.json({ success: true, status: status.transaction_status || 'unknown', message: 'Status synced' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/order/:orderRef/confirm-manual
 */
router.post('/order/:orderRef/confirm-manual', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { orderRef } = req.params;
  try {
    const { data: confirmData, error: confirmErr } = await supabase
      .rpc('confirm_payment', { p_order_ref: orderRef });

    if (confirmErr || !confirmData.success) {
      return res.status(400).json({ success: false, error: confirmData?.error || confirmErr?.message });
    }

    const order = {
      order_ref: confirmData.order_ref,
      full_name: confirmData.full_name,
      email: confirmData.email,
      whatsapp: confirmData.whatsapp || 'N/A',
      batch_name: confirmData.batch_name,
      batch_num: confirmData.batch_num,
      sequence: confirmData.sequence,
      wa_group_url: confirmData.wa_group_url,
      paid_at: new Date().toISOString(),
    };

    const pdfBuffer = await generateInvoicePDF(order);
    await sendInvoiceEmail(order, pdfBuffer);

    res.json({ success: true, message: 'Order confirmed manually and email sent' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/verify/:qrData (Scanner)
 */
router.get('/verify/:qrData', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { qrData } = req.params;
  const parts = qrData.split('|');
  const orderRef = parts[0];
  const providedSignature = parts[1];

  if (!providedSignature) return res.status(400).json({ success: false, error: 'QR Code tidak valid' });

  const QR_SECRET = process.env.QR_SECRET || 'localogo_secure_qr_2026';
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(orderRef);
  const expectedSignature = hmac.digest('hex').substring(0, 16);

  if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
    return res.status(400).json({ success: false, error: 'QR Code Palsu' });
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(name, wa_group_url)')
    .eq('order_ref', orderRef)
    .single();

  if (error || !data) return res.status(404).json({ success: false, error: 'Order tidak ditemukan' });
  res.json({ success: true, order: data });
});

/**
 * POST /api/admin/pickup/:orderRef
 */
router.post('/pickup/:orderRef', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { orderRef } = req.params;
  const { loketId } = req.body || {};

  const { data, error } = await supabase
    .from('orders')
    .update({
      is_picked_up: true,
      picked_up_at: new Date().toISOString(),
      scanned_by: loketId || 'Unknown'
    })
    .eq('order_ref', orderRef)
    .eq('status', 'paid')
    .eq('is_picked_up', false)
    .select();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data?.length) return res.status(400).json({ success: false, error: 'Tiket tidak valid atau sudah diambil' });

  res.json({ success: true, message: 'Pesanan berhasil ditandai sebagai DIAMBIL' });
});

module.exports = router;
