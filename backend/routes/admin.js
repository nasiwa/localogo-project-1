const express = require('express');
const router = express.Router();
const { adminSupabase } = require('../supabaseClient');
const { generateInvoicePDF, sendInvoiceEmail } = require('../utils/invoice');
const crypto = require('crypto');

const QR_SECRET = process.env.QR_SECRET || 'localogo_secure_qr_2026';

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}
router.use(adminAuth);

router.get('/check', (req, res) => res.json({ allowed: true }));

// ── DASHBOARD STATS ──────────────────────────────────────────────
router.get('/dashboard-stats', async (req, res) => {
  try {
    const { count: paidCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid');
    const { count: pendingCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    const { count: pickupCount } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid').eq('is_picked_up', true);
    const { data: batches } = await adminSupabase.from('batches').select('filled_slots, total_slots');

    const totalFilled = (paidCount || 0) + (pendingCount || 0);
    const totalSlots = (batches || []).reduce((s, b) => s + (b.total_slots || 0), 0);

    res.json({ success: true, paidCount: paidCount || 0, pendingCount: pendingCount || 0, pickupCount: pickupCount || 0, totalFilled, totalSlots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MASTER GATE — BACA & TULIS KE batch_config (sumber yang sama dengan queue.js) ──
router.get('/gate', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.from('batch_config').select('id, is_open').limit(1).single();
    if (error) throw error;
    res.json({ success: true, is_open: data.is_open });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/gate', async (req, res) => {
  try {
    const { is_open } = req.body;
    if (typeof is_open !== 'boolean') return res.status(400).json({ success: false, error: 'is_open harus boolean' });

    // Ambil id dulu
    const { data: cfg, error: fetchErr } = await adminSupabase.from('batch_config').select('id').limit(1).single();
    if (fetchErr || !cfg) throw new Error('batch_config tidak ditemukan');

    const { error } = await adminSupabase.from('batch_config').update({ is_open, updated_at: new Date() }).eq('id', cfg.id);
    if (error) throw error;

    res.json({ success: true, is_open });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BATCHES ──────────────────────────────────────────────────────
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
    const { data, error } = await adminSupabase.from('batches').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, batch: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ORDERS ───────────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    let limit   = parseInt(req.query.limit) || 100;
    
    // Pastikan limit tidak terlalu kecil untuk export, tapi juga tidak merusak server
    if (limit > 5000) limit = 5000; 

    const from  = (page - 1) * limit;
    const to    = from + limit - 1;
    const q = req.query.q || '';
    const batchId = req.query.batch_id || 'all';
    const status = req.query.status || 'all';

    let query = adminSupabase.from('orders').select('*, batches(name)', { count: 'exact' });
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,order_ref.ilike.%${q}%`);
    if (batchId !== 'all') query = query.eq('batch_id', batchId);
    if (status !== 'all') query = query.eq('status', status);

    // Jika limit > 1000, kita ambil 2 kali saja secara manual untuk kestabilan
    if (limit > 1000) {
      const { data: d1, error: e1, count } = await query.order('created_at', { ascending: false }).range(0, 999);
      const { data: d2, error: e2 }        = await query.order('created_at', { ascending: false }).range(1000, 1999);
      
      if (e1) throw e1;
      const combined = (d1 || []).concat(d2 || []);
      return res.json({ success: true, orders: combined, total: count });
    }

    const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;
    res.json({ success: true, orders: data, total: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── AUTO EXPIRE ───────────────────────────────────────────────────
// ... (rest of file)


// ── AUTO EXPIRE ───────────────────────────────────────────────────
router.post('/auto-expire', async (req, res) => {
  try {
    const { data: pending } = await adminSupabase.from('orders').select('id, created_at, payment_gateway').eq('status', 'pending');
    const now = Date.now();
    const toExpire = (pending || []).filter(o => {
      const age = now - new Date(o.created_at).getTime();
      return o.payment_gateway === 'manual' ? age > 24 * 3600 * 1000 : age > 30 * 60 * 1000;
    }).map(o => o.id);

    if (toExpire.length > 0) await adminSupabase.from('orders').update({ status: 'expired' }).in('id', toExpire);
    res.json({ success: true, expired_count: toExpire.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PROOF URL ─────────────────────────────────────────────────────
router.get('/proof-url/:filename', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.storage.from('transfer_proofs').createSignedUrl(req.params.filename, 3600);
    if (error) throw error;
    res.json({ success: true, signedUrl: data.signedUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BATCH MEMBERS ─────────────────────────────────────────────────
router.get('/batch/:id/members', async (req, res) => {
  try {
    // Ambil 2 kali saja secara manual (total 2000 data) untuk kestabilan server
    const { data: d1, error: e1 } = await adminSupabase.from('orders').select('order_ref, full_name, email, whatsapp, status, created_at, is_picked_up, sequence_num, scanned_by').eq('batch_id', req.params.id).eq('status', 'paid').order('created_at').range(0, 999);
    const { data: d2, error: e2 } = await adminSupabase.from('orders').select('order_ref, full_name, email, whatsapp, status, created_at, is_picked_up, sequence_num, scanned_by').eq('batch_id', req.params.id).eq('status', 'paid').order('created_at').range(1000, 1999);

    if (e1) throw e1;
    const allMembers = (d1 || []).concat(d2 || []);
    res.json({ success: true, members: allMembers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CONFIRM MANUAL ────────────────────────────────────────────────
router.post('/order/:orderRef/confirm-manual', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.rpc('confirm_payment', { p_order_ref: req.params.orderRef });
    if (error) throw error;
    if (data?.success) {
      try {
        const { data: fullOrder } = await adminSupabase.from('orders').select('*, batches(*)').eq('order_ref', req.params.orderRef).single();
        if (fullOrder) {
          const mappedOrder = {
            ...fullOrder,
            batch_name: fullOrder.batches?.name,
            batch_num: fullOrder.batches?.name ? parseInt(fullOrder.batches.name.replace(/\D/g, '')) || 1 : 1,
            sequence: fullOrder.sequence_num,
            wa_group_url: fullOrder.batches?.wa_group_url,
          };
          const pdfBuffer = await generateInvoicePDF(mappedOrder);
          await sendInvoiceEmail(mappedOrder, pdfBuffer);
        }
      } catch (e) { console.error('Email error:', e); }
    }
    res.json({ success: true, message: 'Dikonfirmasi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MANUAL ORDER ──────────────────────────────────────────────────
router.post('/order/manual', async (req, res) => {
  try {
    const { full_name, email, whatsapp, batch_id, amount, status, gateway } = req.body;
    if (!full_name || !email || !batch_id) return res.status(400).json({ success: false, error: 'Data tidak lengkap' });

    const orderRef = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const { data: claimData, error: claimErr } = await adminSupabase.rpc('claim_slot', {
      p_batch_id: batch_id, p_order_ref: orderRef, p_name: full_name,
      p_email: email, p_wa: whatsapp || 'Manual', p_amount: gateway === 'giveaway' ? 0 : parseInt(amount || 100000)
    });
    if (claimErr || !claimData?.success) return res.status(400).json({ success: false, error: claimData?.error || 'Gagal' });

    // Update to giveaway if selected
    if (gateway === 'giveaway') {
      await adminSupabase.from('orders').update({ payment_gateway: 'giveaway', amount: 0 }).eq('order_ref', orderRef);
    }

    if (status === 'paid') {
      const { data: conf } = await adminSupabase.rpc('confirm_payment', { p_order_ref: orderRef });
      if (conf?.success) {
        try {
          const { data: fullOrder } = await adminSupabase.from('orders').select('*, batches(*)').eq('order_ref', orderRef).single();
          if (fullOrder) {
            const mappedOrder = {
              ...fullOrder,
              batch_name: fullOrder.batches?.name,
              batch_num: fullOrder.batches?.name ? parseInt(fullOrder.batches.name.replace(/\D/g, '')) || 1 : 1,
              sequence: fullOrder.sequence_num,
              wa_group_url: fullOrder.batches?.wa_group_url,
            };
            const pdf = await generateInvoicePDF(mappedOrder);
            await sendInvoiceEmail(mappedOrder, pdf);
          }
        } catch (e) { console.error('Email error:', e); }
      }
    }
    res.json({ success: true, order_ref: orderRef });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── VERIFY TICKET (SCANNER) ───────────────────────────────────────
router.get('/verify/:qrData', async (req, res) => {
  try {
    const qrData = decodeURIComponent(req.params.qrData);
    const [orderRef, signature] = qrData.split('|');

    if (!orderRef || !signature) {
      return res.status(400).json({ success: false, error: 'Format QR tidak valid' });
    }

    // Validasi Signature
    const hmac = crypto.createHmac('sha256', QR_SECRET);
    hmac.update(orderRef);
    const expectedSig = hmac.digest('hex').substring(0, 16);

    if (signature !== expectedSig) {
      return res.status(403).json({ success: false, error: 'TANDA TANGAN QR TIDAK VALID' });
    }

    // Ambil Data Order
    const { data: order, error } = await adminSupabase
      .from('orders')
      .select('*, batches(name)')
      .eq('order_ref', orderRef)
      .maybeSingle();

    if (error) throw error;
    if (!order) return res.status(404).json({ success: false, error: 'PESANAN TIDAK DITEMUKAN' });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PICKUP ────────────────────────────────────────────────────────
router.post('/pickup/:orderRef', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.from('orders')
      .update({ is_picked_up: true, picked_up_at: new Date().toISOString(), scanned_by: req.body.loketId || 'Unknown' })
      .eq('order_ref', req.params.orderRef).eq('status', 'paid').eq('is_picked_up', false).select();
    if (error) throw error;
    if (!data?.length) return res.status(400).json({ success: false, error: 'Tiket tidak valid atau sudah diambil' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ACCESS CODES MANAGEMENT ──────────────────────────────────────
router.get('/access-codes', async (req, res) => {
  try {
    const { data, error } = await adminSupabase
      .from('access_codes')
      .select('code, max_uses, use_count, batch_id, created_at, batches(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, codes: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/access-codes', async (req, res) => {
  try {
    const { code, max_uses, batch_id } = req.body;
    if (!code || !batch_id) return res.status(400).json({ success: false, error: 'Kode dan batch_id wajib diisi.' });
    const normalizedCode = code.trim().toUpperCase();
    const { data, error } = await adminSupabase
      .from('access_codes')
      .insert({ code: normalizedCode, max_uses: parseInt(max_uses) || 100, batch_id, use_count: 0 })
      .select('code, max_uses, use_count, batch_id, created_at')
      .single();
    if (error) throw error;
    res.json({ success: true, code: data });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Kode sudah ada, gunakan kode lain.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/access-codes/:code', async (req, res) => {
  try {
    const { error } = await adminSupabase
      .from('access_codes')
      .delete()
      .eq('code', req.params.code.toUpperCase());
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SESSION LINKS CRUD ───────────────────────────────────────────

// GET all session links (with batch info)
router.get('/session-links', async (req, res) => {
  try {
    const { data, error } = await adminSupabase
      .from('session_links')
      .select('*, batches(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, links: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create new session link
router.post('/session-links', async (req, res) => {
  const { batch_id, label, max_quota, valid_from } = req.body;
  if (!batch_id || !label) {
    return res.status(400).json({ success: false, error: 'batch_id dan label wajib diisi.' });
  }
  // Auto-generate token (32 hex chars)
  const token = require('crypto').randomBytes(16).toString('hex');
  try {
    const { data, error } = await adminSupabase
      .from('session_links')
      .insert({
        token,
        batch_id,
        label,
        max_quota: max_quota || 50,
        valid_from: valid_from || null
      })
      .select('*, batches(name)')
      .single();
    if (error) throw error;
    res.json({ success: true, link: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH toggle active/inactive
router.patch('/session-links/:id/toggle', async (req, res) => {
  try {
    const { data: current } = await adminSupabase
      .from('session_links').select('is_active').eq('id', req.params.id).single();
    const { data, error } = await adminSupabase
      .from('session_links')
      .update({ is_active: !current?.is_active })
      .eq('id', req.params.id)
      .select().single();
    if (error) throw error;
    res.json({ success: true, link: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE session link
router.delete('/session-links/:id', async (req, res) => {
  try {
    const { error } = await adminSupabase
      .from('session_links').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
