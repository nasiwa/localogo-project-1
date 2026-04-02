require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const midtrans = require('midtrans-client');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const { generateInvoicePDF, sendInvoiceEmail } = require('./utils/invoice');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ── CLIENTS ──────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key for full access (backend only!)
);

const snap = new midtrans.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const resend = new Resend(process.env.RESEND_API_KEY);

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('../public')); // Serve frontend files

// ── HELPERS ──────────────────────────────────────────────────────
function genOrderRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-OSPEK-${ts}-${rnd}`;
}

function verifyMidtransSignature(orderId, statusCode, grossAmount, serverKey) {
  const raw = orderId + statusCode + grossAmount + serverKey;
  return crypto.createHash('sha512').update(raw).digest('hex');
}

// ════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════

// ── GET /api/batches — public batch status (with auto-reveal) ──
app.get('/api/batches', async (req, res) => {
  try {
    // Trigger scheduled reveals
    await supabase.rpc('auto_reveal_batches');

    const { data, error } = await supabase
      .from('public_batches')
      .select('*'); // view already ORDER BY sort_order internally

    if (error) throw error;
    res.json({ success: true, batches: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/create-order — create pending order + Midtrans token ──
app.post('/api/create-order', async (req, res) => {
  try {
    const { full_name, email, whatsapp, batch_id } = req.body;

    if (!full_name || !email || !whatsapp || !batch_id) {
      return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
    }

    const orderRef = genOrderRef();

    // CONCURRENCY-SAFE: use RPC with DB transaction + FOR UPDATE
    const { data: claimData, error: claimErr } = await supabase
      .rpc('claim_slot', {
        p_batch_id: batch_id,
        p_order_ref: orderRef,
        p_name: full_name,
        p_email: email,
        p_wa: whatsapp,
      });

    if (claimErr || !claimData.success) {
      return res.status(409).json({
        success: false,
        error: claimData?.error || claimErr?.message || 'Gagal memesan slot'
      });
    }

    // Create Midtrans Snap token
    const midtransParams = {
      transaction_details: {
        order_id: orderRef,
        gross_amount: 102500,
      },
      enabled_payments: ['qris', 'gopay', 'shopeepay', 'bca_va', 'bni_va', 'mandiri_bill', 'permata_va'],
      customer_details: {
        first_name: full_name,
        email: email,
        phone: whatsapp,
      },
      item_details: [
        {
          id: 'ospek-dp-2026',
          price: 100000,
          quantity: 1,
          name: `DP Perlengkapan OSPEK 2026 — ${claimData.batch_name}`,
        },
        {
          id: 'admin-fee',
          price: 2500,
          quantity: 1,
          name: 'Biaya Layanan',
        }
      ],
      expiry: {
        unit: 'minutes',
        duration: 30,  // token expires in 30 minutes
      },
    };

    const snapResponse = await snap.createTransaction(midtransParams);

    // Save snap token to order
    await supabase
      .from('orders')
      .update({ midtrans_token: snapResponse.token })
      .eq('order_ref', orderRef);

    res.json({
      success: true,
      order_ref: orderRef,
      snap_token: snapResponse.token,
      batch_name: claimData.batch_name,
    });

  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/midtrans-webhook — Midtrans payment notification ──
app.post('/api/midtrans-webhook', async (req, res) => {
  try {
    const notif = req.body;
    console.log('Incoming Midtrans Webhook:', JSON.stringify(notif, null, 2));

    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
    } = notif;

    // 1. Verify signature
    const expectedSig = verifyMidtransSignature(
      order_id, status_code, gross_amount,
      process.env.MIDTRANS_SERVER_KEY
    );

    if (expectedSig !== signature_key) {
      console.warn('⚠️ Invalid Midtrans signature for order:', order_id);
      console.warn('   Expected:', expectedSig);
      console.warn('   Received:', signature_key);
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2. Check if payment is settled
    const isSettled =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept');

    if (!isSettled) {
      console.log(`ℹ️ Order ${order_id} status: ${transaction_status} — skipping processing`);
      return res.json({ received: true });
    }

    // 3. CONCURRENCY-SAFE slot confirmation via RPC
    const { data: confirmData, error: confirmErr } = await supabase
      .rpc('confirm_payment', { p_order_ref: order_id });

    if (confirmErr || !confirmData.success) {
      console.error('❌ confirm_payment failed:', confirmData?.error || confirmErr);
      return res.status(500).json({ error: 'Payment confirmation failed' });
    }

    const order = {
      order_ref: confirmData.order_ref,
      full_name: confirmData.full_name,
      email: confirmData.email,
      whatsapp: confirmData.whatsapp || 'N/A',
      batch_name: confirmData.batch_name,
      batch_num: confirmData.batch_num,
      sequence: confirmData.sequence,
      wa_group_url: confirmData.wa_group_url, // Added
      paid_at: new Date().toISOString(),
    };

    // 4. Generate PDF invoice
    try {
      const pdfBuffer = await generateInvoicePDF(order);
      // 5. Send email with PDF
      await sendInvoiceEmail(order, pdfBuffer);
      console.log(`✅ Payment confirmed & email sent for ${order_id}`);
    } catch (err) {
      console.error('📧 Error sending invoice email:', err);
    }

    res.json({ success: true });

  } catch (err) {
    console.error('💥 Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/batch/:id/members — list members in a batch ──
app.get('/api/admin/batch/:id/members', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { data, error } = await supabase
    .from('orders')
    .select('order_ref, full_name, email, whatsapp, status, created_at, is_picked_up, sequence_num, scanned_by')
    .eq('batch_id', id)
    .eq('status', 'paid')  // Only show paid members
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, members: data });
});

// ── GET /api/admin/order/:orderRef/sync — manually sync status from Midtrans ──
app.get('/api/admin/order/:orderRef/sync', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { orderRef } = req.params;
  try {
    const status = await snap.transaction.status(orderRef);
    console.log(`Syncing order ${orderRef}:`, status.transaction_status);

    const isSettled =
      status.transaction_status === 'settlement' ||
      (status.transaction_status === 'capture' && status.fraud_status === 'accept');

    if (isSettled) {
      const { data: confirmData, error: confirmErr } = await supabase
        .rpc('confirm_payment', { p_order_ref: orderRef });

      if (confirmErr) throw confirmErr;

      if (confirmData && confirmData.success) {
        // Only send email if it wasn't already paid (RPC handles this check)
        const order = {
          order_ref: confirmData.order_ref,
          full_name: confirmData.full_name,
          email: confirmData.email,
          whatsapp: confirmData.whatsapp || 'N/A',
          batch_name: confirmData.batch_name,
          batch_num: confirmData.batch_num,
          sequence: confirmData.sequence,
          wa_group_url: confirmData.wa_group_url, // Added
          paid_at: new Date().toISOString(),
        };
        try {
          const pdfBuffer = await generateInvoicePDF(order);
          await sendInvoiceEmail(order, pdfBuffer);
        } catch (e) {
          console.error('Email error during sync:', e);
        }
        return res.json({ success: true, status: 'paid', message: 'Order updated to Paid' });
      }
    }

    res.json({ success: true, status: status.transaction_status, message: 'Status synced' });

  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/admin/verify/:qrData — verify order status and QR SIGNATURE for QR Scanner ──
app.get('/api/admin/verify/:qrData', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { qrData } = req.params;
  
  // New secure format is "ORDER_REF|SIGNATURE"
  // Legacy format is just "ORDER_REF" -> we should probably reject it for strict security, 
  // but let's handle the extraction first.
  const parts = qrData.split('|');
  const orderRef = parts[0];
  const providedSignature = parts[1];

  if (!providedSignature) {
    return res.status(400).json({ success: false, error: 'QR Code tidak valid (Missing Signature)' });
  }

  // Verify Cryptographic Signature
  const QR_SECRET = process.env.QR_SECRET || 'localogo_secure_qr_2026';
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(orderRef);
  const expectedSignature = hmac.digest('hex').substring(0, 16);

  if (crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature)) === false) {
    return res.status(400).json({ success: false, error: 'QR Code Palsu / Tidak Dikenali (Invalid Signature)' });
  }
  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(name, wa_group_url)')
    .eq('order_ref', orderRef)
    .single();

  if (error || !data) return res.status(404).json({ success: false, error: 'Order tidak ditemukan' });
  res.json({ success: true, order: data });
});

// ── POST /api/admin/pickup/:orderRef — confirm order pickup (ANTI-CHEAT) ──
app.post('/api/admin/pickup/:orderRef', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { orderRef } = req.params;
  const { loketId } = req.body || {};

  // Update order status to picked up
  const { data, error } = await supabase
    .from('orders')
    .update({
      is_picked_up: true,
      picked_up_at: new Date().toISOString(),
      scanned_by: loketId || 'Unknown'
    })
    .eq('order_ref', orderRef)
    .eq('status', 'paid') // Only paid orders can be picked up
    .eq('is_picked_up', false) // Prevent duplicate pickup confirmation
    .select();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data || data.length === 0) return res.status(400).json({ success: false, error: 'Tiket tidak valid atau sudah pernah diambil' });

  res.json({ success: true, message: 'Pesanan berhasil ditandai sebagai DIAMBIL' });
});

// ── GET /api/admin/check — verify admin token ──
app.get('/api/admin/check', async (req, res) => {
  const token = req.headers['x-admin-token'];
  res.json({ allowed: token === process.env.ADMIN_PASSWORD });
});

// ── GET /api/admin/batches — full batch data for admin ──
app.get('/api/admin/batches', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .order('sort_order');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, batches: data });
});

// ── PATCH /api/admin/batch/:id — update batch settings ──
app.patch('/api/admin/batch/:id', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const updates = {};
  const allowed = ['status', 'reveal_at', 'total_slots', 'name'];
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

// ── GET /api/admin/orders — all orders ──
app.get('/api/admin/orders', async (req, res) => {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(name)')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, orders: data });
});


// ── PUBLIC FAST SYNC (For Frontend onSuccess) ──────────────────
app.get('/api/verify-payment/:orderRef', async (req, res) => {
  const { orderRef } = req.params;
  try {
    console.log(`[FastSync] Checking: ${orderRef}`);
    const status = await snap.transaction.status(orderRef);

    if (status.transaction_status === 'settlement' || status.transaction_status === 'capture') {
      console.log(`[FastSync] Order ${orderRef} is SETTLED. Confirming...`);
      const { data, error } = await supabase.rpc('confirm_payment', { p_order_ref: orderRef });

      if (error) throw error;

      // Send email in background (don't block response)
      // The `data` object from `confirm_payment` RPC already contains the necessary order details
      // for `sendInvoiceEmail` if it was designed to accept it directly.
      // Assuming `sendInvoiceEmail` expects the same `order` structure as in the webhook/sync logic.
      const order = {
        order_ref: data.order_ref,
        full_name: data.full_name,
        email: data.email,
        whatsapp: data.whatsapp || 'N/A',
        batch_name: data.batch_name,
        batch_num: data.batch_num,
        sequence: data.sequence,
        wa_group_url: data.wa_group_url, // Added
        paid_at: new Date().toISOString(),
      };
      generateInvoicePDF(order).then(pdfBuffer => {
        sendInvoiceEmail(order, pdfBuffer).catch(e => console.error('[FastSync] Email error:', e));
      }).catch(e => console.error('[FastSync] PDF generation error:', e));

      return res.json({ success: true, status: 'paid' });
    }

    res.json({ success: true, status: status.transaction_status });
  } catch (err) {
    console.error('[FastSync] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUBLIC GET /api/invoice/:orderRef (Download PDF) ──
app.get('/api/invoice/:orderRef', async (req, res) => {
  const { orderRef } = req.params;
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*, batches(name, wa_group_url)')
      .eq('order_ref', orderRef)
      .single();

    if (error || !order) return res.status(404).send('Order not found');
    if (order.status !== 'paid') return res.status(400).send('Order is not paid');

    const formattedOrder = {
      order_ref: order.order_ref,
      full_name: order.full_name,
      email: order.email,
      whatsapp: order.whatsapp || 'N/A',
      batch_name: order.batches?.name,
      batch_num: order.batch_id,
      sequence: order.sequence_num,
      wa_group_url: order.batches?.wa_group_url,
      paid_at: order.paid_at || order.created_at,
    };

    const pdfBuffer = await generateInvoicePDF(formattedOrder);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${orderRef}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Invoice Download Error:', err);
    res.status(500).send('Internal server error');
  }
});

// Server boot
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 LOCALOGO Backend running on port ${PORT}`);
  console.log(`   Midtrans: ${process.env.MIDTRANS_IS_PRODUCTION === 'true' ? '🟢 PRODUCTION' : '🟡 SANDBOX'}`);
});
module.exports = app;

if (require.main === module) { app.listen(process.env.PORT || 3001); }
