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
  checkMaintenance();
  await checkAuthSession();
  await loadConfig();    // 🔧 Ambil gateway type dari server
  await loadBatches();
  setupRealtime();
  restorePendingOrder(); // 🔁 Pulihkan modal jika user refresh
}

function checkMaintenance() {
  const isPreview = new URLSearchParams(window.location.search).get('preview') === 'ospek2026';
  const hasAccess = localStorage.getItem('localogo_admin_access') === 'true';
  const overlay = document.getElementById('maintenance-overlay');
  
  if (isPreview) {
    localStorage.setItem('localogo_admin_access', 'true');
    if (overlay) overlay.classList.remove('show');
    return;
  }
  
  if (!hasAccess && overlay) {
    overlay.classList.add('show');
    // Block scrolling while maintenance is on
    document.body.style.overflow = 'hidden';
  }
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

    // Cek apakah masih dalam window 24 jam
    const ageMs = Date.now() - saved.savedAt;
    const maxMs = 24 * 60 * 60 * 1000; // 24 jam
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

      if (sidebarAdminRow) sidebarAdminRow.style.display = 'none';
      if (sidebarTotal) sidebarTotal.textContent = fmtIDR(saved.amount || 100000);
      if (pmAmount) pmAmount.textContent = fmtIDR(saved.amount || 100000);
      
      const manualTotalEl = document.getElementById('pm-total-manual');
      if (manualTotalEl) manualTotalEl.textContent = fmtIDR(saved.amount || 100000);

      const bankInfoEl = document.getElementById('manual-bank-info');
      const amountStr = String(saved.amount || 100000);
      const uniqueCode = amountStr.slice(-3);
      const basePart = amountStr.slice(0, -3);
      
      if (bankInfoEl) {
        bankInfoEl.innerHTML = `${saved.bank_info || 'Bank Info N/A'}<br>` +
          `<span style="color:var(--txm); font-size:18px;">Rp ${basePart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</span>` +
          `<span style="color:var(--red); font-size:20px; font-weight:900;">${uniqueCode}</span>`;
      }
      if (payBtn) payBtn.textContent = 'Selesaikan & Kirim Bukti';
      if (secureNote) secureNote.textContent = '🔒 Slot diamankan sementara (24 jam).';
    } else {
      if (manualBox) manualBox.style.display = 'none';
      if (rowUnique) rowUnique.style.display = 'none';
      if (rowGateway) rowGateway.style.display = 'flex';

      if (sidebarAdminRow) sidebarAdminRow.style.display = 'flex';
      if (sidebarTotal) sidebarTotal.textContent = 'Rp102.500';
      if (pmAmount) pmAmount.textContent = 'Rp102.500';

      if (payBtn) payBtn.textContent = 'Buka Halaman Pembayaran';
      if (secureNote) secureNote.textContent = `🔒 Diproses oleh ${paymentGateway.charAt(0).toUpperCase() + paymentGateway.slice(1)}`;
    }

    // Instead of auto-showing full modal, show a small restoration toast
    showRestorationToast();

  } catch (err) {
    console.error('Restore Error:', err);
  }
}

function showRestorationToast() {
  const toast = document.createElement('div');
  toast.id = 'restore-toast';
  toast.innerHTML = `
    <div style="background:var(--td); color:#fff; padding:12px 20px; border-radius:50px; display:flex; align-items:center; gap:12px; box-shadow:0 8px 30px rgba(0,0,0,0.2); font-size:13px; font-weight:600;">
      <span>📑 Pesanan tertunda ditemukan</span>
      <button onclick="openRestoredModal()" style="background:#fff; color:var(--td); border:none; padding:4px 12px; border-radius:20px; font-weight:800; cursor:pointer;">LIHAT</button>
      <button onclick="discardRestoredOrder()" style="background:rgba(255,255,255,0.2); color:#fff; border:none; padding:4px 12px; border-radius:20px; font-weight:600; cursor:pointer;">HAPUS</button>
    </div>
  `;
  toast.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:9999; animation: slideUp 0.5s ease-out;';
  document.body.appendChild(toast);
}

window.openRestoredModal = function() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('show');
  setStep(3); // Go to summary
  const toast = document.getElementById('restore-toast');
  if (toast) toast.remove();
};

window.discardRestoredOrder = function() {
  clearPendingOrder();
  const toast = document.getElementById('restore-toast');
  if (toast) toast.remove();
  showToast('Sesi pendaftaran lama telah dihapus.');
};

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
let batchDebounceTimer;
function debouncedLoadBatches() {
  clearTimeout(batchDebounceTimer);
  // Tambahkan jitter acak (0-3000ms) agar semua client tidak request berbarengan
  const jitter = Math.floor(Math.random() * 3000);
  batchDebounceTimer = setTimeout(() => {
    loadBatches();
  }, jitter + 1000);
}

function setupRealtime() {
  // Listen for any changes in the 'batches' table
  _supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'batches' },
      (payload) => {
        console.log('Realtime update:', payload);
        debouncedLoadBatches(); // Refresh UI data safely
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('Order update:', payload);
        debouncedLoadBatches();
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
    batch_name: activeBatch.name // Fixed: ensure correct field name
  };

  // ── VIRTUAL QUEUE FOR BATCH 2 ONLY ──
  const isBatch2 = (activeBatch.name || '').includes('Batch 2');
  if (isBatch2) {
    const overlay = document.getElementById('queue-overlay');
    const bar = document.getElementById('queue-progress');
    const percentTxt = document.getElementById('queue-percent');
    if (overlay && bar && percentTxt) {
      overlay.classList.add('show');
      // Simulate progress over random 3-7 seconds
      const duration = 3000 + Math.random() * 4000;
      const start = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - start;
        const progress = Math.min((elapsed / duration) * 100, 99);
        bar.style.width = progress + '%';
        percentTxt.textContent = Math.floor(progress) + '%';
        if (elapsed >= duration) clearInterval(interval);
      }, 100);
      
      // Wait for the simulated duration
      await new Promise(r => setTimeout(r, duration));
      
      // Complete bar
      bar.style.width = '100%';
      percentTxt.textContent = '100%';
      await new Promise(r => setTimeout(r, 500));
      overlay.classList.remove('show');
    }
  }

  const btnLanjut = document.querySelector('[onclick="handleBooking()"]');
  const originalLanjutText = btnLanjut ? btnLanjut.innerHTML : 'Lanjut ke Pembayaran &rarr;';

  if (activeGateway === 'manual') {
    if (btnLanjut) { btnLanjut.disabled = true; btnLanjut.innerHTML = 'Memproses...'; }
    try {
      const res = await fetch(`${BACKEND_URL}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        if (res.status === 409) showToast('⚠️ Email atau WhatsApp Anda sudah terdaftar atau Batch Penuh.');
        else showToast('⚠️ ' + (data.error || 'Gagal membuat order'));
        if (btnLanjut) { btnLanjut.disabled = false; btnLanjut.innerHTML = originalLanjutText; }
        return;
      }
      
      // Update global order state for Manual
      currentOrder = { ...body, id: data.id, order_ref: data.order_ref, amount: data.amount };
      paymentGateway = 'manual';
      paymentToken = null; // No token for manual
      
      // Pre-fill modal details with generated data
      document.getElementById('pm-oid').textContent = data.order_ref;
      document.getElementById('pm-name').textContent = body.full_name;
      document.getElementById('pm-email').textContent = body.email;
      document.getElementById('pm-wa').textContent = body.whatsapp;
      document.getElementById('pm-batch').textContent = body.batch_name;
      
      // Update manual payment unique nominal
      const fmtIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
      
      const manualTotalEl = document.getElementById('pm-total-manual');
      if (manualTotalEl) manualTotalEl.textContent = fmtIDR(data.amount);

      const pmAmount = document.getElementById('pm-amount');
      if (pmAmount) pmAmount.textContent = fmtIDR(data.amount);

      const sidebarAdminRow = document.getElementById('sidebar-admin-row');
      const sidebarTotal = document.getElementById('sidebar-total');
      if (sidebarAdminRow) sidebarAdminRow.style.display = 'none';
      if (sidebarTotal) sidebarTotal.textContent = fmtIDR(data.amount);

      const rowUnique = document.getElementById('row-unique-nominal');
      const rowGateway = document.getElementById('row-total-gateway');
      if (rowUnique) rowUnique.style.display = 'flex';
      if (rowGateway) rowGateway.style.display = 'none';

      const bankInfoEl = document.getElementById('manual-bank-info');
      if (bankInfoEl) {
        const amountStr = String(data.amount);
        const uniqueCode = amountStr.slice(-3);
        const basePart = amountStr.slice(0, -3);
        bankInfoEl.innerHTML = `${data.bank_info || 'Trf ke Rekening'}<br>` +
          `<span style="color:var(--txm); font-size:18px;">Rp ${basePart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}</span>` +
          `<span style="color:var(--red); font-size:20px; font-weight:900;">${uniqueCode}</span>`;
      }
      
      if (btnLanjut) { btnLanjut.disabled = false; btnLanjut.innerHTML = originalLanjutText; }
      
      // Simpan backup agar jika refresh 24 jam, data ini kembali
      savePendingOrder({ ...currentOrder, gateway: 'manual' }, data.amount, data.bank_info);

    } catch (err) {
      console.error(err);
      showToast('⚠️ Gagal terhubung ke server');
      if (btnLanjut) { btnLanjut.disabled = false; btnLanjut.innerHTML = originalLanjutText; }
      return;
    }
  } else {
    // Duitku Flow: show popup first, generate order later
    document.getElementById('pm-oid').textContent = 'Generating...';
    document.getElementById('pm-name').textContent = body.full_name;
    document.getElementById('pm-email').textContent = body.email;
    document.getElementById('pm-wa').textContent = body.whatsapp;
    document.getElementById('pm-batch').textContent = body.batch_name;
  }

  // Handle Manual vs Gateway Layout in Modal
  const manualBox = document.getElementById('manual-box');
  const duitkuSelector = document.getElementById('duitku-selector');
  const payBtnModal = document.getElementById('btn-pay-modal');
  const secureNote = document.getElementById('secure-note');

  if (activeGateway === 'manual') {
    if (manualBox) manualBox.style.display = 'block';
    if (duitkuSelector) duitkuSelector.style.display = 'none';
    if (payBtnModal) payBtnModal.style.display = 'block'; // Manual needs final submit
    if (secureNote) secureNote.textContent = '🔒 Slot diamankan sementara (24 jam).';
  } else {
    if (manualBox) manualBox.style.display = 'none';
    if (duitkuSelector) duitkuSelector.style.display = 'block';
    if (payBtnModal) payBtnModal.style.display = 'none'; // Will trigger on grid click
    if (secureNote) secureNote.textContent = '🔒 Pembayaran aman melalui Duitku.';
  }

  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.add('show');

  // Trigger default highlight for VC (Virtual Account) if using Duitku
  if (activeGateway !== 'manual') {
    const vcCard = document.querySelector('.method-card.active');
    if (vcCard) highlightMethod('BC', vcCard);
  }
}

// ── STEP 2: HIGHLIGHT SELECTION ─────────────────────────────
window.highlightMethod = function(methodCode, el) {
  selectedPaymentMethod = methodCode;
  paymentGateway = activeGateway !== 'manual' ? activeGateway : 'duitku'; 
  
  // Visual feedback on card
  const cards = document.querySelectorAll('.method-card');
  cards.forEach(c => c.classList.remove('active'));
  el.classList.add('active');

  // Show and update the Big Payment Button
  const payBtnModal = document.getElementById('btn-pay-modal');
  if (payBtnModal) {
    payBtnModal.style.display = 'block';
    
    // Map code to readable name for button
    const names = { 'QR': 'QRIS', 'SP': 'ShopeePay', 'OV': 'OVO', 'DA': 'DANA', 'BC': 'Virtual Account' };
    payBtnModal.innerHTML = `<span class="icon">💳</span> Bayar Sekarang via ${names[methodCode] || 'Virtual Account'}`;
  }
};

// ── STEP 3: PROCESS ACTUAL BOOKING & OPEN PAYMENT ───────────
async function startPayment() {
  const btn = document.getElementById('btn-pay-modal');
  if (!btn) return;
  
  const originalHtml = btn.innerHTML;

  // CASE 1: MANUAL PAYMENT (PROOF UPLOAD)
  if (paymentGateway === 'manual') {
    const fileInput = document.getElementById('proof-file');
    if (!fileInput || !fileInput.files[0]) {
       showToast('⚠️ Harap upload bukti transfer dulu!');
       return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>&nbsp; Mengirim...';

    try {
      const file = fileInput.files[0];
      const compressedFile = await compressImage(file);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentOrder.order_ref}_${Date.now()}.${fileExt}`;
      const filePath = fileName;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadErr } = await _supabase.storage
        .from('transfer_proofs')
        .upload(filePath, compressedFile);

      if (uploadErr) throw new Error('Gagal upload: ' + uploadErr.message);

      const { data: urlData } = _supabase.storage.from('transfer_proofs').getPublicUrl(filePath);

      // Save proof to DB via Backend
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
      if (!submitData.success) throw new Error(submitData.error || 'Database save failed');

      showToast('✅ Bukti terkirim! Admin akan segera memverifikasi.');
      clearPendingOrder();
      const modal = document.getElementById('confirm-modal');
      if (modal) modal.classList.remove('show');
      handleSuccessManual();

    } catch (err) {
      console.error('Manual upload error:', err);
      showToast('❌ Gagal: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    return;
  }

  // CASE 2: DUITKU / GATEWAY FLOW (BOOK THEN POPUP)
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>&nbsp; Memproses Pembayaran...';

  try {
    const body = {
      full_name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      whatsapp: document.getElementById('f-wa').value.trim(),
      batch_id: activeBatch.id,
      payment_method: selectedPaymentMethod
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await res.json();
    if (!data.success) {
      if (res.status === 409) {
        showToast('⚠️ Email atau WhatsApp Anda sudah terdaftar. Gunakan data lain atau selesaikan pembayaran sebelumnya.');
      } else {
        showToast('⚠️ ' + (data.error || 'Gagal membuat order'));
      }
      return;
    }

    // Update state & localStorage
    paymentToken = data.token;
    paymentGateway = data.gateway;
    currentOrder = { ...body, id: data.id, order_ref: data.order_ref, batch_name: data.batch_name };
    document.getElementById('pm-oid').textContent = data.order_ref;
    
    savePendingOrder(
      { ...currentOrder, token: data.token, gateway: data.gateway },
      data.amount,
      data.bank_info
    );

    // Trigger SDK Pop-up
    if (paymentGateway === 'duitku' && typeof checkout !== 'undefined') {
      checkout.process(paymentToken, {
        successEvent: result => { handleSuccessPayment(); },
        pendingEvent: result => { showToast('⏳ Pembayaran Sedang Diproses'); },
        errorEvent: result => { showToast('⚠️ Pembayaran Gagal'); },
        closeEvent: result => { console.log('Duitku Closed'); }
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

  } catch (err) {
    console.error(err);
    showToast('⚠️ Gagal terhubung ke server');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
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
