// ── SUPABASE CLIENT (Public Read-Only) ────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── STATE ─────────────────────────────────────────────────────────
let activeBatch = null;
let _countdownInterval = null;
let selectedPaymentMethod = 'BC'; // Default VA

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  console.log("Duitku System initializing...");
  try {
    await loadConfig();

    // Sementara: Bypass Google Auth karena kendala teknis
    showPanel('panel-active');
    startFormTimer();
    // handleAuthState(); // Simpan untuk nanti
    
    /* 
    const verifiedCode = sessionStorage.getItem('verified_code');
    const verifiedAt = sessionStorage.getItem('code_verified_at');
    if (verifiedCode && verifiedAt && (Date.now() - parseInt(verifiedAt)) < 30 * 60 * 1000) {
      showPanel('panel-active');
      startFormTimer();
      handleAuthState(); 
    } else {
      showPanel('panel-enter-code');
    }
    */

    // Polling kuota tiap 10 detik
    setInterval(loadConfig, 10000);
  } catch (err) {
    console.error("Init error:", err);
    showPanel('panel-enter-code');
  }
}

// ── GOOGLE AUTH ───────────────────────────────────────────────────
async function loginGoogle() {
  const { data, error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/payment_with_duitku'
    }
  });
  if (error) console.error("Google Login Error:", error);
}

async function handleAuthState() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    const user = session.user;
    const nameEl = document.getElementById('f-name');
    const emailEl = document.getElementById('f-email');
    
    if (nameEl) nameEl.value = user.user_metadata.full_name || '';
    if (emailEl) emailEl.value = user.email || '';
    
    // Hide overlay, show form
    const overlay = document.getElementById('google-auth-overlay');
    const formBody = document.getElementById('the-form-body');
    if (overlay) overlay.style.display = 'none';
    if (formBody) formBody.style.display = 'block';
  }
}

// ── VERIFY ACCESS CODE ────────────────────────────────────────────
async function verifyCode() {
  const codeInput = document.getElementById('f-code');
  const btn = document.getElementById('btn-verify-code');
  const errEl = document.getElementById('code-error');

  const code = codeInput?.value.trim().toUpperCase();
  if (!code) {
    if (errEl) errEl.textContent = '⚠️ Masukkan kode akses terlebih dahulu.';
    return;
  }

  if (errEl) errEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Memverifikasi...'; }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (data.success) {
      sessionStorage.setItem('verified_code', data.code);
      sessionStorage.setItem('verified_batch_id', data.batch_id || (activeBatch?.id ?? ''));
      sessionStorage.setItem('code_verified_at', Date.now().toString());
      showPanel('panel-active');
      startFormTimer();
      handleAuthState();
    } else {
      if (errEl) errEl.textContent = '❌ ' + (data.error || 'Kode tidak valid.');
      if (btn) { btn.disabled = false; btn.textContent = 'Verifikasi Kode →'; }
    }
  } catch (err) {
    if (errEl) errEl.textContent = '❌ Koneksi gagal. Coba lagi.';
    if (btn) { btn.disabled = false; btn.textContent = 'Verifikasi Kode →'; }
  }
}

// ── FORM TIMER ────────────────────────────────────────────────────
function startFormTimer() {
  if (_countdownInterval) clearInterval(_countdownInterval);

  const verifiedAt = parseInt(sessionStorage.getItem('code_verified_at') || Date.now());
  const totalSeconds = 30 * 60;
  const elapsed = Math.floor((Date.now() - verifiedAt) / 1000);
  let remaining = Math.max(0, totalSeconds - elapsed);

  const countdownEl = document.getElementById('active-countdown-timer');

  function tick() {
    if (remaining <= 0) {
      clearInterval(_countdownInterval);
      sessionStorage.clear();
      showPanel('panel-expired');
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (countdownEl) countdownEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    remaining--;
  }

  tick();
  _countdownInterval = setInterval(tick, 1000);
}

// ── LOAD CONFIG ───────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/batches?t=${Date.now()}`);
    const bData = await res.json();
    if (bData.success && bData.batches) {
      renderBatches(bData.batches);
      const b = bData.batches.find(x => x.status === 'active');
      if (b) {
        activeBatch = b;
        const remainEl = document.getElementById('slots-remain');
        if (remainEl) remainEl.textContent = `${b.total_slots - b.filled_slots} Slot Tersedia`;

        const batchEls = document.querySelectorAll('[id="sidebar-batch"]');
        batchEls.forEach(el => { if (el) el.textContent = b.name; });

        const baVal = document.getElementById('ba-val');
        if (baVal) baVal.textContent = b.name;
      }
    }
  } catch (e) { console.warn("loadConfig failed:", e); }
}

function renderBatches(batches) {
  const grid = document.getElementById('batch-grid');
  if (!grid) return;
  grid.innerHTML = batches.map(b => {
    const remain = b.total_slots - b.filled_slots;
    const isFull = remain <= 0 || b.status !== 'active';
    return `
      <div class="batch-card ${isFull ? 'full' : ''}">
        <div class="batch-name">${b.name}</div>
        <div class="batch-slots">${isFull ? 'CLOSED' : remain + ' Slot'}</div>
        <div class="batch-status-pill ${b.status}">${b.status.toUpperCase()}</div>
      </div>
    `;
  }).join('');
}

// ── NOMINAL UNIK ──────────────────────────────────────────────────
function onWaInput() {
  updateNominal();
}

function onInput() {
  // Common input handler if needed
}

function updateNominal() {
  const waEl = document.getElementById('f-wa');
  if (!waEl) return;
  const wa = waEl.value.trim();
  
  // For Duitku, we usually have a fixed admin fee or dynamic fee
  // The sidebar in war-test.html has Rp102.500 fixed total.
  // I'll update it to match the logic in backend: 100k + 2500 admin
  const formatted = 'Rp' + (102500).toLocaleString('id-ID');

  const sidebarEl = document.getElementById('sidebar-total');
  const modalTotalEl = document.getElementById('pm-amount');
  if (sidebarEl) sidebarEl.textContent = formatted;
  if (modalTotalEl) modalTotalEl.textContent = formatted;
}

// ── DUITKU HELPERS ────────────────────────────────────────────────
function highlightMethod(method, el) {
  selectedPaymentMethod = method;
  document.querySelectorAll('.method-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  console.log("Selected Method:", selectedPaymentMethod);
}

function openConfirm() {
  const nameVal = document.getElementById('f-name')?.value.trim();
  const emailVal = document.getElementById('f-email')?.value.trim();
  const waVal = document.getElementById('f-wa')?.value.trim();

  if (!nameVal || !emailVal || !waVal) return showToast('⚠️ Lengkapi nama, email, dan nomor WA');

  document.getElementById('pm-name').textContent = nameVal;
  document.getElementById('pm-email').textContent = emailVal;
  document.getElementById('pm-wa').textContent = waVal;
  document.getElementById('pm-batch').textContent = activeBatch?.name || '—';
  
  // Show modal
  document.getElementById('confirm-modal').classList.add('show');
  document.getElementById('duitku-selector').style.display = 'block';
  document.getElementById('btn-pay-modal').style.display = 'block';
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('show');
}

// ── SUBMIT ────────────────────────────────────────────────────────
async function handleBooking() {
  // First step: show confirmation modal with Duitku selector
  openConfirm();
}

async function startPayment() {
  const nameVal = document.getElementById('f-name')?.value.trim();
  const emailVal = document.getElementById('f-email')?.value.trim();
  const waVal = document.getElementById('f-wa')?.value.trim();
  
  // Gunakan kode PUBLIC untuk bypass kendala Supabase/Google Auth
  const code = 'PUBLIC'; 
  const batchId = sessionStorage.getItem('verified_batch_id') || activeBatch?.id;

  const btn = document.getElementById('btn-pay-modal');
  const oldHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Memproses...'; }

  try {
    const body = {
      full_name: nameVal,
      email: emailVal,
      whatsapp: waVal,
      batch_id: batchId,
      access_code: code,
      gateway: 'duitku',
      paymentMethod: selectedPaymentMethod
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const resData = await res.json();
    if (resData.success && resData.payment_url) {
      // Redirect to Duitku
      window.location.href = resData.payment_url;
    } else {
      throw new Error(resData.error || 'Gagal membuat transaksi');
    }
  } catch (err) {
    showToast('⚠️ ' + err.message);
    if (btn) { btn.disabled = false; btn.innerHTML = oldHTML; }
  }
}

// ── UI HELPERS ────────────────────────────────────────────────────
function showPanel(panelId) {
  document.querySelectorAll('.state-panel, .booking-layout').forEach(p => p.style.display = 'none');
  
  if (panelId === 'panel-active') {
    document.getElementById('booking-main').style.display = 'grid';
    // Bypass: Tampilkan form body langsung
    const fb = document.getElementById('the-form-body');
    const overlay = document.getElementById('google-auth-overlay');
    if (fb) fb.style.display = 'block';
    if (overlay) overlay.style.display = 'none';
  } else {
    const target = document.getElementById(panelId);
    if (target) target.style.display = 'block';
  }

  // Update steps
  const stepMap = { 'panel-enter-code': 1, 'panel-active': 2, 'panel-done': 3 };
  const currentStep = stepMap[panelId] || 1;
  document.querySelectorAll('.step-item').forEach((el, idx) => {
    if (idx + 1 <= currentStep) el.classList.add('active');
    else el.classList.remove('active');
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── GLOBALS ───────────────────────────────────────────────────────
window.verifyCode = verifyCode;
window.handleBooking = handleBooking;
window.startPayment = startPayment;
window.loginGoogle = loginGoogle;
window.highlightMethod = highlightMethod;
window.closeConfirm = closeConfirm;
window.onWaInput = onWaInput;
window.onInput = onInput;

init();
