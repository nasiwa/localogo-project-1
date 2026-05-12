const express = require('express');
const router = express.Router();
const { createTransaction, snap } = require('../services/paymentProvider');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');
const { adminSupabase } = require('../supabaseClient');

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
  res.json({ 
    gateway: process.env.PAYMENT_GATEWAY || 'manual',
    midtransClientKey: process.env.MIDTRANS_CLIENT_KEY || ''
  });
});



/**
 * POST /api/simulate-payment-success
 * For production flow to update status immediately and send email
 */
router.post('/simulate-payment-success', async (req, res) => {
  const { order_ref } = req.body;
  try {
    // 1. Confirm Payment via RPC (This handles sequence_num and quota correctly)
    const { data: confirmData, error: rpcError } = await adminSupabase.rpc('confirm_payment', { p_order_ref: order_ref });
    
    if (rpcError) {
      console.error('[CONFIRM_RPC_ERR]', rpcError);
      throw rpcError;
    }
    
    if (!confirmData.success) {
       console.error('[CONFIRM_LOGIC_ERR]', confirmData.error);
       throw new Error(confirmData.error);
    }

    // 2. Fetch full order details for the PDF
    const { data: order, error } = await adminSupabase
      .from('orders')
      .select('*, batches(*)')
      .eq('order_ref', order_ref)
      .single();
      
    if (error) throw error;

    // 3. Generate PDF and Send Email
    if (order) {
      console.log(`[AUTO_EMAIL] Generating invoice and sending email for ${order.order_ref}...`);
      try {
        const pdfBuffer = await generateInvoicePDF({
          order_ref: order.order_ref,
          full_name: order.full_name,
          email: order.email,
          whatsapp: order.whatsapp || 'N/A',
          batch_name: order.batches?.name,
          batch_num: order.batches?.name ? parseInt(order.batches.name.replace(/\D/g, '')) || 1 : 1,
          sequence: order.sequence_num, // Now this will have a valid number!
          wa_group_url: order.batches?.wa_group_url,
          paid_at: order.paid_at,
          amount: order.amount
        });
        
        await sendInvoiceEmail(order, pdfBuffer);
        console.log(`[AUTO_EMAIL] Success for ${order.order_ref}`);
      } catch (e) {
        console.error('[EMAIL_GENERATE_ERR]', e);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[SIM_SUCCESS_ERR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/batches — public batch status (with auto-reveal)
 */
router.get('/batches', async (req, res) => {
  try {
    const supabase = req.app.get('getSupabase')();
    await supabase.rpc('auto_reveal_batches');
    
    // public_batches view sudah filter status='active'|'closed' secara otomatis
    // Kita hanya tampilkan yang benar-benar aktif (bukan closed) ke customer
    const { data, error } = await supabase
      .from('public_batches')
      .select('*')
      .eq('status', 'active'); // lowercase sesuai schema database
      
    if (error) throw error;
    res.json({ success: true, batches: data || [] });
  } catch (err) {
    console.error('[BATCHES_ERR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



/**
 * POST /api/create-midtrans-order
 * Dedicated route for Midtrans payment page — no access_code required
 */
router.post('/create-midtrans-order', async (req, res) => {
  const { full_name, email, whatsapp, batch_id } = req.body;

  if (!full_name || !email || !whatsapp || !batch_id) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap. Isi semua field.' });
  }

  const orderRef = genOrderRef();
  const finalAmount = 102500; // Rp100.000 + Rp2.500 admin fee

  try {
    // 1. Cek Batch masih aktif
    const { data: batch, error: bErr } = await adminSupabase
      .from('batches')
      .select('id, name, total_slots, filled_slots, status')
      .eq('id', batch_id)
      .eq('status', 'active')
      .single();

    if (bErr || !batch) {
      return res.status(400).json({ success: false, error: 'Batch tidak tersedia atau sudah ditutup.' });
    }

    // 2. Cek Duplikat WhatsApp
    const { data: existing } = await adminSupabase
      .from('orders')
      .select('id, status')
      .eq('batch_id', batch_id)
      .eq('whatsapp', whatsapp)
      .in('status', ['paid', 'pending'])
      .maybeSingle();

    if (existing) {
      const msg = existing.status === 'paid'
        ? '⚠️ Nomor WhatsApp ini sudah memiliki slot aktif di Batch ini.'
        : '⚠️ Pendaftaran nomor ini sedang diproses (Pending). Selesaikan pembayaran sebelumnya.';
      return res.status(400).json({ success: false, error: msg });
    }

    // 3. Buat Midtrans Snap Token
    let snapToken = null;
    try {
      const paymentData = await createTransaction('midtrans', {
        orderRef,
        amount: finalAmount,
        full_name,
        email,
        whatsapp,
        batchName: batch.name,
        backendUrl: process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`,
        frontendUrl: process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
      });
      snapToken = paymentData.token;
    } catch (payErr) {
      console.error('[MIDTRANS_CREATE_ERR]', payErr);
      return res.status(500).json({ success: false, error: `Gagal membuat transaksi Midtrans: ${payErr.message}` });
    }

    // 4. Insert Order ke database
    const { data: newOrder, error: insErr } = await adminSupabase
      .from('orders')
      .insert({
        order_ref: orderRef,
        batch_id: batch_id,
        full_name,
        email,
        whatsapp,
        amount: finalAmount,
        status: 'pending',
        payment_gateway: 'midtrans',
        midtrans_token: snapToken
      })
      .select()
      .single();

    if (insErr) throw insErr;

    console.log(`[MIDTRANS_ORDER] Created: ${orderRef}`);
    return res.json({
      success: true,
      order_ref: orderRef,
      midtrans_token: snapToken,
      batch_name: batch.name
    });

  } catch (err) {
    console.error('[MIDTRANS_ORDER_CRASH]', err);
    res.status(500).json({ success: false, error: `Server Error: ${err.message}` });
  }
});

/**
 * POST /api/create-order
 */
router.post('/create-order', async (req, res) => {
  const { full_name, email, whatsapp, batch_id, proof_base64, proof_ext, access_code, paymentMethod } = req.body;
  const gateway = req.body.gateway || process.env.PAYMENT_GATEWAY || 'manual';

  if (!full_name || !email || !whatsapp || !batch_id || !access_code) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap.' });
  }

  if (gateway === 'manual' && !proof_base64) {
    return res.status(400).json({ success: false, error: 'Bukti transfer wajib diunggah untuk metode manual.' });
  }

  const orderRef = genOrderRef();
  const normalizedCode = access_code.trim().toUpperCase();

  try {
    // 1. Atomic code claim
    const { data: claimData, error: claimErr } = await adminSupabase
      .rpc('increment_access_code', { p_code: normalizedCode });

    if (claimErr) throw claimErr;
    const claimResult = claimData && claimData[0];

    if (!claimResult || !claimResult.success) {
      return res.status(409).json({ success: false, error: 'Kuota untuk kode sesi ini sudah penuh atau kode tidak valid.' });
    }

    // 2. Cek Batch
    const { data: batch, error: bErr } = await adminSupabase
      .from('batches')
      .select('id, name, total_slots, filled_slots')
      .eq('id', batch_id)
      .eq('status', 'active')
      .single();

    if (bErr || !batch) {
      console.error('[BATCH_ERR]', bErr);
      await adminSupabase.rpc('decrement_access_code', { p_code: normalizedCode });
      return res.status(400).json({ success: false, error: 'Batch tidak tersedia atau sudah penuh' });
    }

    // 3. Cek Duplikat WA
    const { data: existing } = await adminSupabase
      .from('orders')
      .select('id, status')
      .eq('batch_id', batch_id)
      .eq('whatsapp', whatsapp)
      .in('status', ['paid', 'pending'])
      .maybeSingle();

    if (existing) {
      await adminSupabase.rpc('decrement_access_code', { p_code: normalizedCode });
      const msg = existing.status === 'paid'
        ? 'Nomor WhatsApp ini sudah lunas di Batch ini.'
        : 'Pendaftaran nomor ini sedang diproses (Pending).';
      return res.status(400).json({ success: false, error: msg });
    }

    // 4. Calculate Amount
    let finalAmount = 100000;
    if (gateway === 'manual') {
      const last3WA = whatsapp.slice(-3).replace(/\D/g, '0');
      finalAmount += parseInt(last3WA || '0');
    } else {
      finalAmount += 2500; // Admin fee for gateway
    }

    // 5. Handle Proof (Only if manual)
    let fileName = null;
    if (gateway === 'manual' && proof_base64) {
      fileName = `proof_${Date.now()}.${proof_ext || 'jpg'}`;
      const fileBuffer = Buffer.from(proof_base64, 'base64');
      const { error: uploadErr } = await adminSupabase.storage
        .from('transfer_proofs')
        .upload(fileName, fileBuffer, {
          contentType: `image/${proof_ext || 'jpeg'}`,
          upsert: false
        });

      if (uploadErr) {
        console.error('[UPLOAD_ERR]', uploadErr);
        await adminSupabase.rpc('decrement_access_code', { p_code: normalizedCode });
        return res.status(500).json({ success: false, error: `Gagal upload bukti: ${uploadErr.message}` });
      }
    }

    // 6. Create Transaction with Provider (if not manual)
    let paymentData = { gateway: 'manual' };
    if (gateway !== 'manual') {
      try {
        paymentData = await createTransaction(gateway, {
          orderRef,
          amount: finalAmount,
          full_name,
          email,
          whatsapp,
          batchName: batch.name,
          paymentMethod: paymentMethod, // Specific for Duitku
          backendUrl: process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`,
          frontendUrl: process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
        });
      } catch (payErr) {
        console.error('[PAYMENT_PROVIDER_ERR]', payErr);
        await adminSupabase.rpc('decrement_access_code', { p_code: normalizedCode });
        return res.status(500).json({ success: false, error: `Gagal membuat transaksi ${gateway}: ${payErr.message}` });
      }
    }

    // 7. Insert Order
    const currentSeq = (batch.filled_slots || 0) + 1;
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
        payment_gateway: gateway,
        proof_url: fileName,
        sequence: currentSeq,
        midtrans_token: paymentData.token || null
      })
      .select()
      .single();

    if (insErr) {
      console.error('[INSERT_ERR]', insErr);
      throw insErr;
    }

    // 8. Update Filled Slots
    await adminSupabase.rpc('increment_filled_slots', { p_batch_id: batch_id });

    console.log(`[CREATE_ORDER] SUCCESS: ${orderRef} (${gateway})`);
    return res.json({
      success: true,
      id: newOrder.id,
      order_ref: orderRef,
      amount: finalAmount,
      batch_name: batch.name,
      payment_url: paymentData.paymentUrl || null, // Duitku might return paymentUrl
      token: paymentData.token || null // Midtrans uses token
    });

  } catch (err) {
    console.error('[CREATE_ORDER_CRASH]', err);
    res.status(500).json({
      success: false,
      error: `Server Error: ${err.message || 'Unknown'}`,
      details: err.details || null
    });
  }
});

/**
 * GET /api/download-invoice/:orderRef
 * Publicly accessible download for customers
 */
router.get('/download-invoice/:orderRef', async (req, res) => {
  const { orderRef } = req.params;
  try {
    const { data: order, error } = await adminSupabase
      .from('orders')
      .select('*, batch:batches(*)')
      .eq('order_ref', orderRef)
      .single();

    if (error || !order) return res.status(404).send('Order tidak ditemukan');
    if (order.status !== 'paid') return res.status(403).send('Order belum lunas');

    // Map database fields to what generateInvoicePDF expects
    const mappedOrder = {
      order_ref: order.order_ref,
      full_name: order.full_name,
      email: order.email,
      whatsapp: order.whatsapp || 'N/A',
      batch_name: order.batch?.name,
      batch_num: order.batch?.name ? parseInt(order.batch.name.replace(/\D/g, '')) || 1 : 1,
      sequence: order.sequence_num,
      wa_group_url: order.batch?.wa_group_url,
      paid_at: order.paid_at,
      amount: order.amount
    };

    const pdfBuffer = await generateInvoicePDF(mappedOrder);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice_${orderRef}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('Server Error');
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
