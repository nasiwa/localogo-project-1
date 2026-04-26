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
 * GET /api/config — public config (gateway type)
 */
router.get('/config', (req, res) => {
  res.json({ gateway: process.env.PAYMENT_GATEWAY || 'manual' });
});

/**
 * GET /api/batches — public batch status (with auto-reveal)
 */
router.get('/batches', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    await supabase.rpc('auto_reveal_batches');
    const { data, error } = await supabase.from('public_batches').select('*');
    if (error) throw error;
    res.json({ success: true, batches: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const { createClient } = require('@supabase/supabase-js');
const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * POST /api/create-order
 */
router.post('/create-order', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  const { full_name, email, whatsapp, batch_id, proof_url, user_id } = req.body;

  if (!full_name || !email || !whatsapp || !batch_id || !proof_url) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap.' });
  }

  const orderRef = genOrderRef();

  try {
    // 1. Calculate Amount
    const last3WA = whatsapp.slice(-3).replace(/\D/g, '0');
    const finalAmount = 100000 + parseInt(last3WA || '0');

    // 2. LOGIKA PENDAFTARAN (VERSI CEPAT & TANGGUH)
    console.log(`[CREATE_ORDER] Starting claim for ${email} (User: ${user_id})`);
    
    // A. Ambil Info Batch
    const { data: batch, error: bErr } = await supabase
      .from('batches')
      .select('id, name, total_slots, filled_slots')
      .eq('id', batch_id)
      .eq('status', 'active')
      .single();

    if (bErr || !batch) {
      return res.status(400).json({ success: false, error: 'Batch tidak tersedia atau sudah penuh' });
    }

    // B. Cek Duplikat WA
    const { data: existing } = await adminSupabase
      .from('orders')
      .select('id')
      .eq('batch_id', batch_id)
      .eq('whatsapp', whatsapp)
      .in('status', ['paid', 'pending'])
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, error: '⚠️ WhatsApp ini sudah terdaftar di Batch ini.' });
    }

    // C. Cek Kuota
    const { count: takenCount } = await adminSupabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch_id)
      .in('status', ['paid', 'pending']);

    if (takenCount >= batch.total_slots) {
      return res.status(409).json({ success: false, error: 'Maaf, slot baru saja penuh.' });
    }

    // D. Buat Pesanan (INSERT)
    console.log(`[CREATE_ORDER] Quota OK (${takenCount}/${batch.total_slots}). Inserting...`);
    const { data: newOrder, error: insErr } = await adminSupabase
      .from('orders')
      .insert({
        order_ref: orderRef,
        batch_id: batch_id,
        full_name: full_name,
        email: email,
        whatsapp: whatsapp,
        amount: finalAmount,
        status: 'pending',
        payment_gateway: 'manual',
        proof_url: proof_url
      })
      .select()
      .single();

    if (insErr) {
      console.error('[INSERT_ERR]', insErr);
      throw insErr;
    }

    // E. SET STATUS ANTREAN JADI 'DONE' (Gunakan try/catch agar tidak mengganggu response utama)
    if (user_id) {
      console.log(`[CREATE_ORDER] Setting queue status to DONE for ${user_id}`);
      adminSupabase
        .from('queue_slots')
        .update({ status: 'done' })
        .eq('user_id', user_id)
        .then(() => console.log(`[QUEUE_UPDATE] Success for ${user_id}`))
        .catch(e => console.error(`[QUEUE_UPDATE] Failed:`, e));
    }

    console.log(`[CREATE_ORDER] SUCCESS: ${orderRef}`);
    return res.json({
      success: true,
      id: newOrder.id,
      order_ref: orderRef,
      amount: finalAmount,
      batch_name: batch.name
    });

  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/submit-proof
 */
router.post('/submit-proof', async (req, res) => {
  const supabase = req.app.get('getSupabase')();
  const { id, order_ref, proof_url } = req.body;

  console.log(`[PROOF_SUBMIT] Attempting for ID: ${id} (Ref: ${order_ref}): ${proof_url}`);

  if ((!id && !order_ref) || !proof_url) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
  }

  try {
    const query = supabase.from('orders').update({ proof_url: proof_url, status: 'pending' });
    
    // Filter by ID if available, otherwise fallback to order_ref
    if (id) query.eq('id', id);
    else query.eq('order_ref', order_ref);

    const { data: updateData, error } = await query.select();

    if (error) {
       console.error('[PROOF_SUBMIT_ERROR]', error);
       throw error;
    }

    console.log(`[PROOF_SUBMIT_SUCCESS] Updated rows: ${updateData?.length}`);
    res.json({ success: true, count: updateData?.length });
  } catch (err) {
    console.error('submit-proof error:', err);
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
  const supabase = req.app.get('getSupabase')();
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
