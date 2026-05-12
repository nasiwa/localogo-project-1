const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');
const { generateCallbackSignature } = require('../utils/duitku');

/**
 * Midtrans Verification Helper
 */
function verifyMidtransSignature(orderId, statusCode, grossAmount, serverKey) {
  const raw = orderId + statusCode + grossAmount + serverKey;
  return crypto.createHash('sha512').update(raw).digest('hex');
}

/**
 * POST /api/midtrans-webhook
 */
router.post('/midtrans-webhook', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  try {
    const notif = req.body;
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = notif;

    const expectedSig = verifyMidtransSignature(order_id, status_code, gross_amount, process.env.MIDTRANS_SERVER_KEY);
    if (expectedSig !== signature_key) return res.status(403).json({ error: 'Invalid signature' });

    const isSettled = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');
    if (!isSettled) return res.json({ received: true });

    const { data: confirmData, error: confirmErr } = await supabase.rpc('confirm_payment', { p_order_ref: order_id });
    if (confirmErr || !confirmData?.success) return res.status(500).json({ error: 'Confirmation failed' });

    // Fetch full order to get joined batch data
    const { data: fullOrder, error: fetchErr } = await supabase
      .from('orders')
      .select('*, batches(*)')
      .eq('order_ref', order_id)
      .single();

    if (fetchErr || !fullOrder) return res.status(500).json({ error: 'Failed to fetch order details' });

    const order = {
      order_ref: fullOrder.order_ref,
      full_name: fullOrder.full_name,
      email: fullOrder.email,
      whatsapp: fullOrder.whatsapp || 'N/A',
      batch_name: fullOrder.batches?.name,
      batch_num: fullOrder.batches?.name ? parseInt(fullOrder.batches.name.replace(/\D/g, '')) || 1 : 1,
      sequence: fullOrder.sequence_num,
      wa_group_url: fullOrder.batches?.wa_group_url,
      paid_at: fullOrder.paid_at || new Date().toISOString(),
      amount: fullOrder.amount
    };

    try {
      const pdfBuffer = await generateInvoicePDF(order);
      await sendInvoiceEmail(order, pdfBuffer);
    } catch (err) { console.error('Webhook Email Error:', err); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/duitku-webhook
 */
router.post('/duitku-webhook', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  try {
    const { amount, merchantOrderId, signature, resultCode } = req.body;
    
    if (signature !== generateCallbackSignature(amount, merchantOrderId)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    if (resultCode !== '00') return res.json({ success: true });

    const { data: confirmData, error: confirmErr } = await supabase.rpc('confirm_payment', { p_order_ref: merchantOrderId });
    if (confirmErr || !confirmData?.success) return res.status(500).json({ error: 'Confirmation failed' });

    // Fetch full order to get joined batch data
    const { data: fullOrder, error: fetchErr } = await supabase
      .from('orders')
      .select('*, batches(*)')
      .eq('order_ref', merchantOrderId)
      .single();

    if (fetchErr || !fullOrder) return res.status(500).json({ error: 'Failed to fetch order details' });

    const order = {
      order_ref: fullOrder.order_ref,
      full_name: fullOrder.full_name,
      email: fullOrder.email,
      whatsapp: fullOrder.whatsapp || 'N/A',
      batch_name: fullOrder.batches?.name,
      batch_num: fullOrder.batches?.name ? parseInt(fullOrder.batches.name.replace(/\D/g, '')) || 1 : 1,
      sequence: fullOrder.sequence_num,
      wa_group_url: fullOrder.batches?.wa_group_url,
      paid_at: fullOrder.paid_at || new Date().toISOString(),
      amount: fullOrder.amount
    };

    try {
      const pdfBuffer = await generateInvoicePDF(order);
      await sendInvoiceEmail(order, pdfBuffer);
    } catch (err) { console.error('Duitku Webhook Email Error:', err); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
