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
let paymentGateway = 'midtrans';
let currentOrder = {};

// ── INITIAL LOAD ──────────────────────────────────────────────────
async function init() {
  await checkAuthSession();
  await loadBatches();
  setupRealtime();
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
async function handleBooking() {
  if (!validate()) return;
  if (!activeBatch) { showToast('⚠ Tidak ada batch aktif'); return; }

  const btn = document.getElementById('btn-pay');
  if (!btn) return;
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>&nbsp; Memproses...';

  try {
    const body = {
      full_name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      whatsapp: document.getElementById('f-wa').value.trim(),
      batch_id: activeBatch.id,
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.success) {
      showToast('⚠ ' + (data.error || 'Gagal membuat order'));
      return;
    }

    // Store state
    paymentToken = data.token;
    paymentGateway = data.gateway;
    currentOrder = { ...body, order_ref: data.order_ref, batch_name: data.batch_name };

    // Show confirm modal
    document.getElementById('pm-oid').textContent = data.order_ref;
    document.getElementById('pm-name').textContent = body.full_name;
    document.getElementById('pm-email').textContent = body.email;
    document.getElementById('pm-wa').textContent = body.whatsapp;
    document.getElementById('pm-batch').textContent = data.batch_name;
    
    // Handle Gateway Layout
    const payBtn = document.getElementById('btn-pay-modal');
    const manualBox = document.getElementById('manual-box');
    const secureNote = document.getElementById('secure-note');
    
    const rowUnique = document.getElementById('row-unique-nominal');
    const rowGateway = document.getElementById('row-total-gateway');
    
    if (paymentGateway === 'manual') {
      if (manualBox) manualBox.style.display = 'block';
      if (rowUnique) rowUnique.style.display = 'flex';
      if (rowGateway) rowGateway.style.display = 'none';
      
      const manualTotalEl = document.getElementById('pm-total-manual');
      if (manualTotalEl) {
        manualTotalEl.textContent = new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0
        }).format(data.amount || 100000);
      }
      
      const bankInfoEl = document.getElementById('manual-bank-info');
      // Highlight the last 3 digits in the UI for clarity
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
      const filePath = `receipts/${fileName}`;

      // Upload to Supabase Storage
      const { data, error: uploadErr } = await _supabase.storage
        .from('transfer_proofs')
        .upload(filePath, compressedFile);

      if (uploadErr) throw uploadErr;

      // Get Public URL
      const { data: urlData } = _supabase.storage
        .from('transfer_proofs')
        .getPublicUrl(filePath);

      // Update Order Table via Backend (to bypass RLS)
      const submitRes = await fetch(`${BACKEND_URL}/api/submit-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_ref: currentOrder.order_ref,
          proof_url: urlData.publicUrl
        })
      });

      const submitData = await submitRes.json();
      if (!submitData.success) throw new Error(submitData.error || 'Gagal menyimpan data bukti');

      showToast('✅ Bukti terkirim! Admin akan segera memverifikasi.');
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

  if (paymentGateway === 'duitku' && typeof duitkuPop !== 'undefined') {
    duitkuPop.show(paymentToken, {
      callbackUrl: `${BACKEND_URL}/api/duitku-webhook`,
      onSuccess: function (result) {
        handleSuccessPayment();
      },
      onPending: function (result) {
        showToast('⏳ Pembayaran Pending');
      },
      onError: function (result) {
        showToast('⚠ Pembayaran Gagal');
      },
      onClose: function () {
        showToast('Pembayaran Dibatalkan');
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
