const express = require('express');
const router = express.Router();
const { createTransaction, snap } = require('../services/paymentProvider');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');

/**
 * HELPERS
 */
function genOrderRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-OSPEK-${ts}-${rnd}`;
}

/**
 * GET /api/batches — public batch status (with auto-reveal)
 */
router.get('/batches', async (req, res) => {
  const { supabase } = req.app.get('clients');
  try {
    await supabase.rpc('auto_reveal_batches');
    const { data, error } = await supabase.from('public_batches').select('*');
    if (error) throw error;
    res.json({ success: true, batches: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/create-order
 */
router.post('/create-order', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { full_name, email, whatsapp, batch_id } = req.body;

  if (!full_name || !email || !whatsapp || !batch_id) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
  }

  const orderRef = genOrderRef();

  try {
    // 1. Claim Slot
    const { data: claimData, error: claimErr } = await supabase.rpc('claim_slot', {
      p_batch_id: batch_id,
      p_order_ref: orderRef,
      p_name: full_name,
      p_email: email,
      p_wa: whatsapp,
    });

    if (claimErr || !claimData?.success) {
      return res.status(409).json({ success: false, error: claimData?.error || 'Gagal memesan slot' });
    }

    // 2. Choose Provider and Create Transaction
    const gateway = process.env.PAYMENT_GATEWAY || 'midtrans';
    const payment = await createTransaction(gateway, {
      orderRef,
      amount: 102500,
      full_name,
      email,
      whatsapp,
      batchName: claimData.batch_name,
      backendUrl: process.env.BACKEND_URL,
      frontendUrl: process.env.FRONTEND_URL_OVERRIDE || process.env.FRONTEND_URL
    });

    // 3. Update database with token/gateway
    await supabase.from('orders').update({
      midtrans_token: payment.token || null,
      payment_gateway: gateway
    }).eq('order_ref', orderRef);

    res.json({
      success: true,
      order_ref: orderRef,
      token: payment.token,
      bank_info: payment.bank_info,
      gateway: gateway,
      batch_name: claimData.batch_name
    });

  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/verify-payment/:orderRef (Fast Sync)
 */
router.get('/verify-payment/:orderRef', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { orderRef } = req.params;
  try {
    const status = await snap.transaction.status(orderRef);
    if (status.transaction_status === 'settlement' || status.transaction_status === 'capture') {
      const { data, error } = await supabase.rpc('confirm_payment', { p_order_ref: orderRef });
      if (error) throw error;

      const order = {
        order_ref: data.order_ref,
        full_name: data.full_name,
        email: data.email,
        whatsapp: data.whatsapp || 'N/A',
        batch_name: data.batch_name,
        batch_num: data.batch_num,
        sequence: data.sequence,
        wa_group_url: data.wa_group_url,
        paid_at: new Date().toISOString(),
      };

      generateInvoicePDF(order).then(pdfBuffer => {
        sendInvoiceEmail(order, pdfBuffer).catch(e => console.error('[FastSync] Email error:', e));
      }).catch(e => console.error('[FastSync] PDF error:', e));

      return res.json({ success: true, status: 'paid' });
    }
    res.json({ success: true, status: status.transaction_status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/invoice/:orderRef (Download PDF)
 */
router.get('/invoice/:orderRef', async (req, res) => {
  const { supabase } = req.app.get('clients');
  const { orderRef } = req.params;
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*, batches(name, wa_group_url)')
      .eq('order_ref', orderRef)
      .single();

    if (error || !order) return res.status(404).send('Order not found');
    if (order.status !== 'paid') return res.status(400).send('Order is not paid');

    const pdfBuffer = await generateInvoicePDF({
      order_ref: order.order_ref,
      full_name: order.full_name,
      email: order.email,
      whatsapp: order.whatsapp || 'N/A',
      batch_name: order.batches?.name,
      batch_num: order.batch_id,
      sequence: order.sequence_num,
      wa_group_url: order.batches?.wa_group_url,
      paid_at: order.paid_at || order.created_at,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${orderRef}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('Internal error');
  }
});

module.exports = router;
