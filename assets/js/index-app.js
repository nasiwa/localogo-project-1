// ── SUPABASE CLIENT ──────────────────────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Update Midtrans client key dynamically if element exists
const snapScript = document.querySelector('script[data-client-key]');
if (snapScript) {
  snapScript.setAttribute('data-client-key', MIDTRANS_CLIENT);
}

// ── STATE ─────────────────────────────────────────────────────────
let activeBatch = null;
let paymentToken = null;
let paymentGateway = 'manual';
let selectedPaymentMethod = 'VC';
let currentOrder = {};
let activeGateway = 'manual';

// ── INITIAL LOAD ──────────────────────────────────────────────────
async function init() {
  await checkAuthSession();
  await loadConfig();    // 🔧 Ambil gateway type dari server
  await loadBatches();
  setupRealtime();
  restorePendingOrder(); // 🔁 Pulihkan modal jika user refresh
}

async function loadConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/config`);
    const data = await res.json();
    activeGateway = data.gateway || 'midtrans';
    updateSidebarForGateway();
  } catch (e) {
    console.warn('loadConfig failed:', e);
  }
}

function updateSidebarForGateway() {
  const adminRow = document.getElementById('sidebar-admin-row');
  const totalEl = document.getElementById('sidebar-total');
  const headPrice = document.querySelector('.order-price'); // Small fix: update head price too
  const badgeEl = document.getElementById('payment-badge');

  // Update dynamic branding text
  if (badgeEl) {
    const gatewayLabel = activeGateway.charAt(0).toUpperCase() + activeGateway.slice(1);
    badgeEl.innerHTML = `🔒 Transaksi aman via ${gatewayLabel} · SSL Encrypted`;
  }

  if (activeGateway === 'manual') {
    if (adminRow) adminRow.style.display = 'none';
    if (headPrice) headPrice.textContent = 'Rp100.xxx';
    onWaInput(); // initial update
  } else {
    if (adminRow) adminRow.style.display = 'flex';
    if (totalEl) totalEl.textContent = 'Rp102.500';
    if (headPrice) headPrice.textContent = 'Rp100.000';
  }
}

function onWaInput() {
  const waField = document.getElementById('f-wa');
  if (!waField) return;

  // Filter: Hanya angka saja
  waField.value = waField.value.replace(/\D/g, '');

  // Jika manual, update sidebar total live
  if (activeGateway === 'manual') {
    const totalEl = document.getElementById('sidebar-total');
    const headPrice = document.querySelector('.order-price');
    const wa = waField.value;
    
    let displayTotal = 'Rp100.xxx';
    if (wa.length >= 3) {
      const code = wa.slice(-3);
      displayTotal = `Rp100.${code}`;
    } else if (wa.length > 0) {
      displayTotal = `Rp100.${wa.padStart(3, '0')}`;
    }

    if (totalEl) totalEl.textContent = displayTotal;
    if (headPrice) headPrice.textContent = displayTotal;
  }
}

// ── LOCALSTORAGE: SIMPAN & PULIHKAN PESANAN PENDING ────────────────
function savePendingOrder(orderData, amount, bank_info) {
  const payload = {
    ...orderData,
    amount,
    bank_info,
    savedAt: Date.now()
  };
  localStorage.setItem('localogo_pending_order', JSON.stringify(payload));
}

function clearPendingOrder() {
  localStorage.removeItem('localogo_pending_order');
}

function restorePendingOrder() {
  try {
    const raw = localStorage.getItem('localogo_pending_order');
    if (!raw) return;
    const saved = JSON.parse(raw);

    // Cek apakah masih dalam window 6 jam
    const ageMs = Date.now() - saved.savedAt;
    const maxMs = 6 * 60 * 60 * 1000; // 6 jam
    if (ageMs > maxMs) { clearPendingOrder(); return; }

    // Pulihkan state
    paymentToken = saved.token || null;
    paymentGateway = saved.gateway || 'manual';
    currentOrder = {
      id: saved.id,
      order_ref: saved.order_ref,
      full_name: saved.full_name,
      email: saved.email,
      whatsapp: saved.whatsapp,
      batch_name: saved.batch_name
    };

    const fmtIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

    // Pulihkan UI modal
    document.getElementById('pm-oid').textContent = saved.order_ref;
    document.getElementById('pm-name').textContent = saved.full_name;
    document.getElementById('pm-email').textContent = saved.email;
    document.getElementById('pm-wa').textContent = saved.whatsapp;
    document.getElementById('pm-batch').textContent = saved.batch_name;

    const payBtn = document.getElementById('btn-pay-modal');
    const manualBox = document.getElementById('manual-box');
    const secureNote = document.getElementById('secure-note');
    const rowUnique = document.getElementById('row-unique-nominal');
    const rowGateway = document.getElementById('row-total-gateway');
    const sidebarAdminRow = document.getElementById('sidebar-admin-row');
    const sidebarTotal = document.getElementById('sidebar-total');
    const pmAmount = document.getElementById('pm-amount');

    if (paymentGateway === 'manual') {
      if (manualBox) manualBox.style.display = 'block';
      if (rowUnique) rowUnique.style.display = 'flex';
      if (rowGateway) rowGateway.style.display = 'none';

      // Update sidebar & modal header dengan nominal unik
      if (sidebarAdminRow) sidebarAdminRow.style.display = 'none';
      if (sidebarTotal) sidebarTotal.textContent = fmtIDR(saved.amount || 100000);
      if (pmAmount) pmAmount.textContent = fmtIDR(saved.amount || 100000);

      const manualTotalEl = document.getElementById('pm-total-manual');
      if (manualTotalEl) manualTotalEl.textContent = fmtIDR(saved.amount || 100000);

      const bankInfoEl = document.getElementById('manual-bank-info');
      if (bankInfoEl && saved.amount) {
        const amountStr = String(saved.amount);
        const uniqueCode = amountStr.slice(-3);
        const basePart = amountStr.slice(0, -3);
        bankInfoEl.innerHTML = `${saved.bank_info || ''}<br><span style="color:var(--txm); font-size:18px;">Rp ${basePart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</span><span style="color:var(--red); font-size:20px; font-weight:900;">${uniqueCode}</span>`;
      }

      if (payBtn) payBtn.textContent = 'Selesaikan & Kirim Bukti';
      const remainMs = maxMs - ageMs;
      const remainHrs = Math.floor(remainMs / 3600000);
      const remainMins = Math.floor((remainMs % 3600000) / 60000);
      if (secureNote) secureNote.textContent = `🔒 Slot masih diamankan — sisa ${remainHrs} jam ${remainMins} menit`;
    } else {
      if (manualBox) manualBox.style.display = 'none';
      if (rowUnique) rowUnique.style.display = 'none';
      if (rowGateway) rowGateway.style.display = 'flex';
      if (sidebarAdminRow) sidebarAdminRow.style.display = 'flex';
      if (sidebarTotal) sidebarTotal.textContent = 'Rp102.500';
      if (pmAmount) pmAmount.textContent = 'Rp102.500';
      if (payBtn) payBtn.textContent = 'Buka Halaman Pembayaran';
    }

    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) confirmModal.classList.add('show');
    setStep(3);
    showToast('🔁 Pesanan kamu sebelumnya dipulihkan!');
  } catch (e) {
    console.warn('Restore failed:', e);
    clearPendingOrder();
  }
}

// ── GOOGLE AUTH ───────────────────────────────────────────────────
async function checkAuthSession() {
  const { data: { session } } = await _supabase.auth.getSession();
  handleSessionResult(session);

  _supabase.auth.onAuthStateChange((event, session) => {
    handleSessionResult(session);
  });
}

function handleSessionResult(session) {
  const overlay = document.getElementById('google-auth-overlay');
  const formBody = document.getElementById('the-form-body');
  const nameInput = document.getElementById('f-name');
  const emailInput = document.getElementById('f-email');

  if (session && session.user) {
    if (overlay) overlay.style.display = 'none';
    if (formBody) formBody.style.display = 'block';
    
    const u = session.user;
    if (emailInput) {
      emailInput.value = u.email;
      emailInput.readOnly = true;
      emailInput.style.background = '#f2f8f8';
      emailInput.style.color = '#555';
      emailInput.style.pointerEvents = 'none';
    }
    
    if (u.user_metadata && u.user_metadata.full_name && nameInput && !nameInput.value) {
      nameInput.value = u.user_metadata.full_name;
    }
    
    if (formBody && !document.getElementById('logout-btn-box')) {
       const logoutBox = document.createElement('div');
       logoutBox.id = 'logout-btn-box';
       logoutBox.style = "margin-bottom:15px; font-size:11.5px; text-align:right;";
       logoutBox.innerHTML = `Login sebagai <strong style="color:var(--td)">${u.email}</strong> (<a href="#" onclick="logoutGoogle(event)" style="color:var(--red);text-decoration:underline;">Ganti Akun</a>)`;
       formBody.insertBefore(logoutBox, formBody.firstChild);
    }
    onInput(); 
  } else {
    if (overlay) overlay.style.display = 'block';
    if (formBody) formBody.style.display = 'none';
    const box = document.getElementById('logout-btn-box');
    if(box) box.remove();
  }
}

async function loginGoogle() {
  showToast('Mengalihkan ke Google...');
  const { data, error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) showToast('Gagal login: ' + error.message);
}

async function logoutGoogle(e) {
  if(e) e.preventDefault();
  await _supabase.auth.signOut();
  window.location.reload();
}

// ── SUPABASE REALTIME (Auto-refresh UI) ───────────────────────────
function setupRealtime() {
  // Listen for any changes in the 'batches' table
  _supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'batches' },
      (payload) => {
        console.log('Realtime update:', payload);
        loadBatches(); // Refresh UI data
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('Order update:', payload);
        loadBatches();
      }
    )
    .subscribe();
}

// ── LOAD BATCHES FROM BACKEND ─────────────────────────────────────
async function loadBatches() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/batches`);
    const data = await res.json();
    if (data.success) renderBatches(data.batches);
  } catch (e) {
    console.error('loadBatches:', e);
    showToast('⚠ Gagal memuat data batch');
  }
}

// ── RENDER BATCHES ────────────────────────────────────────────────
function renderBatches(batches) {
  const grid = document.getElementById('batch-grid');
  if (!grid) return;
  
  // Determine the truly active batch (must be 'active' status AND have slots)
  activeBatch = batches.find(b => b.status === 'active' && b.slots_left > 0) || null;

  // Hero stats
  const heroBatchEl = document.getElementById('h-batch');
  if (heroBatchEl) heroBatchEl.textContent = activeBatch ? activeBatch.name : 'HABIS';

  // Batch cards
  grid.innerHTML = batches.map(b => {
    const totalUsed = b.filled_slots + (b.pending_slots || 0);
    const pct = Math.min(100, Math.round((totalUsed / b.total_slots) * 100)); // Cap at 100
    
    const isActuallyFull = b.status === 'closed' || b.slots_left <= 0;
    const isAct = b.status === 'active' && !isActuallyFull;
    
    const pill = isActuallyFull
      ? '<span class="status-pill full">Penuh</span>'
      : b.status === 'active' ? '<span class="status-pill open">Open Now</span>' : '<span class="status-pill">Segera</span>';
      
    const pendingNote = (b.status === 'active' && b.pending_slots > 0 && !isActuallyFull)
      ? `<div style="font-size:10px;color:var(--tm);margin-top:4px;">⏳ Beberapa orang sedang proses booking</div>`
      : '';

    return `<div class="batch-card ${isAct ? 'active' : isActuallyFull ? 'closed' : ''}">
      <div class="batch-card-top"><span class="batch-name-label">${b.name}</span>${pill}</div>
      <div class="batch-pct-label" style="font-size:12px; font-weight:600">${isActuallyFull ? 'Kuota Habis' : 'Slot Tersedia'}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      ${pendingNote}
    </div>`;
  }).join('');

  // Sidebar + batch assign box
  if (activeBatch) {
    const baVal = document.getElementById('ba-val');
    const sidebarBatch = document.getElementById('sidebar-batch');
    if (baVal) baVal.textContent = `${activeBatch.name} — Tersedia`;
    if (sidebarBatch) sidebarBatch.textContent = activeBatch.name;
  }

  // Slots remain note
  const slotsRemain = document.getElementById('slots-remain');
  if (slotsRemain) {
    slotsRemain.textContent = activeBatch
      ? `Silakan amankan slot kamu di ${activeBatch.name}`
      : 'Pendaftaran ditutup';
  }

  // Toggle sold out: Show if NO active batch is available
  const showSoldOut = !activeBatch;
  const bookingMain = document.getElementById('booking-main');
  const soldOut = document.getElementById('sold-out');
  if (bookingMain) bookingMain.style.display = showSoldOut ? 'none' : '';
  if (soldOut) soldOut.classList.toggle('show', showSoldOut);
}

// ── FORM INPUT ─────────────────────────────────────────────────────
function onInput() {
  const fields = ['f-name', 'f-email', 'f-wa'];
  const any = fields.some(id => {
    const el = document.getElementById(id);
    return el && el.value.trim();
  });
  if (any) setStep(2); else setStep(1);
}

// ── VALIDATE ───────────────────────────────────────────────────────
function validate() {
  const checks = [
    { wrap: 'fi-name', id: 'f-name', ok: v => v.length > 1 },
    { wrap: 'fi-email', id: 'f-email', ok: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
    { wrap: 'fi-wa', id: 'f-wa', ok: v => v.length > 7 },
  ];
  let ok = true;
  checks.forEach(c => {
    const el = document.getElementById(c.id);
    const wr = document.getElementById(c.wrap);
    if (!el || !wr) return;
    wr.classList.remove('field-err');
    if (!c.ok(el.value.trim())) { wr.classList.add('field-err'); ok = false; }
  });
  return ok;
}

// ── HANDLE BOOKING ─────────────────────────────────────────────────
// ── STEP 1: SHOW CONFIRMATION MODAL ──────────────────────────
async function handleBooking() {
  if (!validate()) return;
  if (!activeBatch) { showToast('⚠ Tidak ada batch aktif'); return; }

  const body = {
    full_name: document.getElementById('f-name').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    whatsapp: document.getElementById('f-wa').value.trim(),
    batch_id: activeBatch.id,
    batch_name: activeBatch.batch_name
  };

  // Pre-fill modal details
  document.getElementById('pm-oid').textContent = 'Generating...';
  document.getElementById('pm-name').textContent = body.full_name;
  document.getElementById('pm-email').textContent = body.email;
  document.getElementById('pm-wa').textContent = body.whatsapp;
  document.getElementById('pm-batch').textContent = body.batch_name;

  // Handle Manual vs Gateway Layout in Modal
  const manualBox = document.getElementById('manual-box');
  const duitkuSelector = document.getElementById('duitku-selector');
  const payBtnModal = document.getElementById('btn-pay-modal');
  const secureNote = document.getElementById('secure-note');

  if (activeGateway === 'manual') {
    if (manualBox) manualBox.style.display = 'block';
    if (duitkuSelector) duitkuSelector.style.display = 'none';
    if (payBtnModal) payBtnModal.style.display = 'block'; // Manual needs final submit
    if (secureNote) secureNote.textContent = '🔒 Slot diamankan sementara (6 jam).';
  } else {
    if (manualBox) manualBox.style.display = 'none';
    if (duitkuSelector) duitkuSelector.style.display = 'block';
    if (payBtnModal) payBtnModal.style.display = 'none'; // Will trigger on grid click
    if (secureNote) secureNote.textContent = '🔒 Pembayaran aman melalui Duitku.';
  }

  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('show');
}

// ── STEP 2: PROCESS ACTUAL BOOKING & OPEN PAYMENT ───────────
window.selectAndPay = async function(methodCode, el) {
  selectedPaymentMethod = methodCode;
  
  // Visual feedback on card
  const cards = document.querySelectorAll('.method-card');
  cards.forEach(c => c.classList.remove('active'));
  el.classList.add('active');

  const btn = el; // Show spinner in card if possible, but for now just toast
  showToast('📡 Menyiapkan pembayaran...');

  try {
    const body = {
      full_name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      whatsapp: document.getElementById('f-wa').value.trim(),
      batch_id: activeBatch.id,
      payment_method: methodCode
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.success) {
      showToast('⚠️ ' + (data.error || 'Gagal membuat order'));
      return;
    }

    // Store state
    paymentToken = data.token;
    paymentGateway = data.gateway;
    currentOrder = { ...body, id: data.id, order_ref: data.order_ref, batch_name: data.batch_name };

    // Update modal with real order ID just in case
    document.getElementById('pm-oid').textContent = data.order_ref;

    // Save to localStorage
    savePendingOrder(
      { ...currentOrder, token: data.token, gateway: data.gateway },
      data.amount,
      data.bank_info
    );

    // IMMEDIATELY START PAYMENT
    startPayment();

  } catch (err) {
    console.error(err);
    showToast('⚠️ Gagal terhubung ke server');
  }
};
    
    const fmtIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const sidebarAdminRow = document.getElementById('sidebar-admin-row');
    const sidebarTotal = document.getElementById('sidebar-total');
    const pmAmount = document.getElementById('pm-amount');

    if (paymentGateway === 'manual') {
      if (manualBox) manualBox.style.display = 'block';
      if (rowUnique) rowUnique.style.display = 'flex';
      if (rowGateway) rowGateway.style.display = 'none';

      // Sembunyikan baris Admin, update total sidebar & header modal
      if (sidebarAdminRow) sidebarAdminRow.style.display = 'none';
      if (sidebarTotal) sidebarTotal.textContent = fmtIDR(data.amount || 100000);
      if (pmAmount) pmAmount.textContent = fmtIDR(data.amount || 100000);
      
      const manualTotalEl = document.getElementById('pm-total-manual');
      if (manualTotalEl) manualTotalEl.textContent = fmtIDR(data.amount || 100000);
      
      const bankInfoEl = document.getElementById('manual-bank-info');
      const amountStr = String(data.amount || 100000);
      const uniqueCode = amountStr.slice(-3);
      const basePart = amountStr.slice(0, -3);
      
      if (bankInfoEl) {
        bankInfoEl.innerHTML = `${data.bank_info || 'Bank Info N/A'}<br>` +
          `<span style="color:var(--txm); font-size:18px;">Rp ${basePart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</span>` +
          `<span style="color:var(--red); font-size:20px; font-weight:900;">${uniqueCode}</span>`;
      }
      
      if (payBtn) payBtn.textContent = 'Selesaikan & Kirim Bukti';
      if (secureNote) secureNote.textContent = '🔒 Slot diamankan sementara (6 jam).';
    } else {
      if (manualBox) manualBox.style.display = 'none';

      if (rowUnique) rowUnique.style.display = 'none';
      if (rowGateway) rowGateway.style.display = 'flex';

      // Tampilkan baris Admin, update total yang sudah include admin
      if (sidebarAdminRow) sidebarAdminRow.style.display = 'flex';
      if (sidebarTotal) sidebarTotal.textContent = 'Rp102.500';
      if (pmAmount) pmAmount.textContent = 'Rp102.500';

      if (payBtn) payBtn.textContent = 'Buka Halaman Pembayaran';
      if (secureNote) secureNote.textContent = `🔒 Diproses oleh ${paymentGateway.charAt(0).toUpperCase() + paymentGateway.slice(1)}`;
    }
    
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) confirmModal.classList.add('show');
    setStep(3);

  } catch (e) {
    showToast('⚠ Koneksi gagal, coba lagi');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ── START PAYMENT ─────────────────────────────────────────────
async function startPayment() {
  const btn = document.getElementById('btn-pay-modal');
  
  if (paymentGateway === 'manual') {
    const fileInput = document.getElementById('proof-file');
    if (!fileInput || !fileInput.files[0]) {
       showToast('⚠️ Harap upload bukti transfer dulu!');
       return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>&nbsp; Mengirim...';
    }

    try {
      const file = fileInput.files[0];
      const compressedFile = await compressImage(file);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentOrder.order_ref}_${Date.now()}.${fileExt}`;
      const filePath = fileName; // Flat path is safer

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadErr } = await _supabase.storage
        .from('transfer_proofs')
        .upload(filePath, compressedFile);

      if (uploadErr) {
        console.error('Storage Upload Error:', uploadErr);
        throw new Error('Gagal upload ke storage: ' + uploadErr.message);
      }

      // Get Public URL
      const { data: urlData } = _supabase.storage
        .from('transfer_proofs')
        .getPublicUrl(filePath);

      console.log('Generated Proof URL:', urlData.publicUrl);

      // Update Order Table via Backend (to bypass RLS) using internal ID
      const submitRes = await fetch(`${BACKEND_URL}/api/submit-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentOrder.id,
          order_ref: currentOrder.order_ref,
          proof_url: urlData.publicUrl
        })
      });

      const submitData = await submitRes.json();
      console.log('Submit Result:', submitData);

      if (!submitData.success || submitData.count === 0) {
        throw new Error(submitData.error || 'Gagal menyimpan data bukti ke database');
      }

      showToast('✅ Bukti terkirim! Admin akan segera memverifikasi.');
      clearPendingOrder(); // 🗑️ Hapus state setelah sukses
      const modal = document.getElementById('confirm-modal');
      if (modal) modal.classList.remove('show');
      
      handleSuccessManual();

    } catch (err) {
      console.error('Upload error:', err);
      showToast('❌ Gagal upload bukti: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Selesaikan & Kirim Bukti';
      }
    }
    return;
  }
  
  if (!paymentToken) return;
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('show');

  if (paymentGateway === 'duitku' && typeof checkout !== 'undefined') {
    checkout.process(paymentToken, {
      successEvent: function (result) {
        console.log('Duitku Success:', result);
        handleSuccessPayment();
      },
      pendingEvent: function (result) {
        console.log('Duitku Pending:', result);
        showToast('⏳ Pembayaran Sedang Diproses');
      },
      errorEvent: function (result) {
        console.log('Duitku Error:', result);
        showToast('⚠️ Pembayaran Gagal');
      },
      closeEvent: function (result) {
        console.log('Duitku Closed');
        // Tidak perlu toast batal jika user hanya menutup
      }
    });
  } else if (window.snap) {
    // Midtrans Snap
    window.snap.pay(paymentToken, {
      onSuccess: async result => {
        handleSuccessPayment();
      },
      onPending: result => {
        showToast('⏳ Pembayaran pending — selesaikan dalam 30 menit');
      },
      onError: result => {
        showToast('⚠ Pembayaran gagal, coba lagi');
        setStep(2);
      },
      onClose: () => {
        showToast('Pembayaran dibatalkan');
        setStep(2);
      },
    });
  }
}

async function handleSuccessPayment() {
  clearPendingOrder(); // 🗑️ Hapus state setelah pembayaran sukses
  showToast('📡 Memverifikasi pembayaran...');
  try {
    await fetch(`${BACKEND_URL}/api/verify-payment/${currentOrder.order_ref}`);
  } catch (e) {
    console.error('[FastSync] Failed:', e);
  }

  document.getElementById('s-name').textContent = currentOrder.full_name;
  document.getElementById('s-oid').textContent = currentOrder.order_ref;
  document.getElementById('s-batch').textContent = currentOrder.batch_name;
  document.getElementById('s-email').textContent = currentOrder.email;
  const downloadBtn = document.getElementById('btn-download-pdf');
  if (downloadBtn) downloadBtn.href = `${BACKEND_URL}/api/invoice/${currentOrder.order_ref}`;
  
  const successModal = document.getElementById('success-modal');
  if (successModal) successModal.classList.add('show');
  setStep(4);
  resetForm();
}

function closeConfirm() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('show');
  setStep(2);
}
function closeSuccess() {
  const modal = document.getElementById('success-modal');
  if (modal) modal.classList.remove('show');
  setStep(1);
}

function resetForm() {
  ['f-name', 'f-email', 'f-wa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ── STEP HELPER ────────────────────────────────────────────────────
function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('step' + i);
    const sc = document.getElementById('sc' + i);
    if (!el || !sc) continue;
    el.classList.remove('active', 'done');
    if (i < n) { el.classList.add('done'); sc.textContent = '✓'; }
    else if (i === n) { el.classList.add('active'); sc.textContent = i; }
    else { sc.textContent = i; }
  }
}

// ── TOAST ──────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── WAITLIST ───────────────────────────────────────────────────────
function joinWL() {
  const el = document.getElementById('wl-email');
  if (!el) return;
  const email = el.value.trim();
  if (!email) return;
  showToast(`✅ ${email} berhasil masuk waiting list!`);
  el.value = '';
}

async function handleSuccessManual() {
  showToast('📡 Mendaftarkan antrian verifikasi...');
  
  document.getElementById('s-name').textContent = currentOrder.full_name;
  document.getElementById('s-oid').textContent = currentOrder.order_ref;
  document.getElementById('s-batch').textContent = currentOrder.batch_name;
  document.getElementById('s-email').textContent = currentOrder.email;
  
  // Update UI for Manual Success
  const successTitle = document.querySelector('#success-modal .success-title');
  const successSub = document.querySelector('#success-modal .success-sub');
  const successStatus = document.querySelector('#success-modal .detail-val.ok');
  
  if(successTitle) successTitle.textContent = 'Bukti Berhasil Diupload!';
  if(successSub) successSub.textContent = 'Admin akan memverifikasi dalam < 24 jam. Info akan masuk ke emailmu.';
  if(successStatus) {
    successStatus.textContent = '⏳ PENDING VERIFICATION';
    successStatus.style.background = '#fef3c7';
    successStatus.style.color = '#92400e';
  }

  const downloadBtn = document.getElementById('btn-download-pdf');
  if (downloadBtn) downloadBtn.style.display = 'none'; // Hide PDF until paid
  
  const successModal = document.getElementById('success-modal');
  if (successModal) successModal.classList.add('show');
  setStep(4);
  resetForm();
}

// ── PROOF HELPERS ──────────────────────────────────────────────────
function previewProof(input) {
  const preview = document.getElementById('proof-preview');
  const placeholder = document.getElementById('proof-placeholder');
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.querySelector('img').src = e.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.7); // 0.7 quality for good compression
      };
    };
  });
}

// Global click handlers for backdrops
document.addEventListener('click', function(e) {
    const confirmModal = document.getElementById('confirm-modal');
    const successModal = document.getElementById('success-modal');
    if (confirmModal && e.target === confirmModal) closeConfirm();
    if (successModal && e.target === successModal) closeSuccess();
});

// BOOT
init();

// ── CAROUSEL LOGIC ────────────────────────────────────────────────
let slideIndex = 1;
let slideInterval;

function initCarousel() {
  const slider = document.getElementById("product-slider");
  if (!slider) return;

  const slides = slider.querySelectorAll(".pg-slide");
  if (!slides.length) return;
  
  // Create dots
  const dotsContainer = document.getElementById("slider-dots");
  if (dotsContainer && !dotsContainer.children.length) {
    dotsContainer.innerHTML = Array.from(slides).map((_, i) => 
      `<span class="dot ${i === 0 ? 'active' : ''}" onclick="currentSlide(${i + 1})"></span>`
    ).join('');
  }

  showSlides(slideIndex);
  startAutoSlide();
}

function startAutoSlide() {
  stopAutoSlide();
  slideInterval = setInterval(() => {
    moveSlide(1);
  }, 5000); // 5 detik agar user sempat melihat konten
}

function stopAutoSlide() {
  if (slideInterval) clearInterval(slideInterval);
}

// Global exposure for HTML onclick
window.moveSlide = function(n) {
  stopAutoSlide();
  showSlides(slideIndex += n);
  startAutoSlide();
}

window.currentSlide = function(n) {
  stopAutoSlide();
  showSlides(slideIndex = n);
  startAutoSlide();
}

function showSlides(n) {
  let i;
  const slider = document.getElementById("product-slider");
  if (!slider) return;

  const slides = slider.querySelectorAll(".pg-slide");
  const dots = document.querySelectorAll(".dot");
  
  if (!slides.length) return;
  
  if (n > slides.length) { slideIndex = 1 }
  if (n < 1) { slideIndex = slides.length }
  
  for (i = 0; i < slides.length; i++) {
    slides[i].classList.remove("active");
  }
  for (i = 0; i < dots.length; i++) {
    dots[i].classList.remove("active");
  }
  
  slides[slideIndex - 1].classList.add("active");
  if (dots[slideIndex - 1]) dots[slideIndex - 1].classList.add("active");
}

// Ensure init after everything is loaded
window.addEventListener('load', initCarousel);
