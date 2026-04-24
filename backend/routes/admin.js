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
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');

// Helper to generate manual order ref
function genManualRef() {
  return `MANUAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
}

/**
 * POST /api/admin/order/manual
 */
router.post('/order/manual', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  const { full_name, email, whatsapp, batch_id, amount, status } = req.body;

  if (!full_name || !email || !batch_id) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
  }

  const orderRef = genManualRef();

  try {
    // 1. Claim Slot
    const { data: claimData, error: claimErr } = await supabase.rpc('claim_slot', {
      p_batch_id: batch_id,
      p_order_ref: orderRef,
      p_name: full_name,
      p_email: email,
      p_wa: whatsapp || 'Manual',
      p_amount: parseInt(amount || 100000)
    });

    if (claimErr || !claimData?.success) {
      return res.status(400).json({ success: false, error: claimData?.error || 'Gagal membuat order manual' });
    }

    // 2. If status is paid, confirm it immediately
    if (status === 'paid') {
      const { data: confData, error: confErr } = await supabase.rpc('confirm_payment', { p_order_ref: orderRef });
      
      if (!confErr && confData.success) {
        // Send email
        const orderInfo = {
          order_ref: orderRef,
          full_name,
          email,
          whatsapp: whatsapp || 'N/A',
          batch_name: confData.batch_name,
          batch_num: confData.batch_num,
          sequence: confData.sequence,
          wa_group_url: confData.wa_group_url,
          paid_at: new Date().toISOString()
        };
        const pdfBuffer = await generateInvoicePDF(orderInfo);
        await sendInvoiceEmail(orderInfo, pdfBuffer);
      }
    }

    res.json({ success: true, order_ref: orderRef });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/batches', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
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
  const supabase = req.app.get('getSupabase')();
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
 * GET /api/admin/orders — all orders with pagination
 */
router.get('/orders', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const q = req.query.q || '';
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('orders')
    .select('*, batches(name)', { count: 'exact' });

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,order_ref.ilike.%${q}%`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, orders: data, total: count });
});

/**
 * GET /api/admin/batch/:id/members
 */
router.get('/batch/:id/members', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
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
  const supabase = req.app.get('getSupabase')();
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
  const supabase = req.app.get('getSupabase')();
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
  const supabase = req.app.get('getSupabase')();
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
  const supabase = req.app.get('getSupabase')();
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

/**
 * POST /api/admin/auto-expire — clean up outdated pending orders manually
 */
router.post('/auto-expire', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  try {
    const { data: pendingOrders, error: fetchErr } = await supabase
      .from('orders')
      .select('id, created_at, payment_gateway')
      .eq('status', 'pending');

    if (fetchErr) throw fetchErr;

    const idsToExpire = [];
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const THIRTY_MINS = 30 * 60 * 1000;

    (pendingOrders || []).forEach(o => {
      const age = now - new Date(o.created_at).getTime();
      const isManual = o.payment_gateway === 'manual';
      
      if (isManual && age > TWENTY_FOUR_HOURS) {
        idsToExpire.push(o.id);
      } else if (!isManual && age > THIRTY_MINS) {
        idsToExpire.push(o.id);
      }
    });

    if (idsToExpire.length > 0) {
      const { error: updateErr } = await supabase
        .from('orders')
        .update({ status: 'expired' })
        .in('id', idsToExpire);
      if (updateErr) throw updateErr;
    }

    res.json({ success: true, expired_count: idsToExpire.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
