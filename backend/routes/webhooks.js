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
  const { supabase } = req.app.get('clients');
  try {
    const notif = req.body;
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = notif;

    const expectedSig = verifyMidtransSignature(order_id, status_code, gross_amount, process.env.MIDTRANS_SERVER_KEY);
    if (expectedSig !== signature_key) return res.status(403).json({ error: 'Invalid signature' });

    const isSettled = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');
    if (!isSettled) return res.json({ received: true });

    const { data: confirmData, error: confirmErr } = await supabase.rpc('confirm_payment', { p_order_ref: order_id });
    if (confirmErr || !confirmData?.success) return res.status(500).json({ error: 'Confirmation failed' });

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
  const { supabase } = req.app.get('clients');
  try {
    const { amount, merchantOrderId, signature, resultCode } = req.body;
    
    if (signature !== generateCallbackSignature(amount, merchantOrderId)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    if (resultCode !== '00') return res.json({ success: true });

    const { data: confirmData, error: confirmErr } = await supabase.rpc('confirm_payment', { p_order_ref: merchantOrderId });
    if (confirmErr || !confirmData?.success) return res.status(500).json({ error: 'Confirmation failed' });

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
      await sendInvoiceEmail(confirmData, pdfBuffer); // Note: confirmData has all info
    } catch (err) { console.error('Duitku Webhook Email Error:', err); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
