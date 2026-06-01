// ── SUPABASE CLIENT (Public Read-Only) ────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── STATE ─────────────────────────────────────────────────────────
let activeBatch = null;
let _countdownInterval = null;

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  console.log("System initializing (Code Verification Mode)...");
  try {
    // ── CEK TOKEN DI URL TERLEBIH DAHULU ──
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
      await loadConfig();
      await handleTokenValidation(urlToken);
      setInterval(loadConfig, 10000);
      return;
    }

    await loadConfig();

    const verifiedCode = sessionStorage.getItem('verified_code');
    const verifiedAt = sessionStorage.getItem('code_verified_at');

    // Jika sudah verifikasi dan belum expired (30 mnt)
    if (verifiedCode && verifiedAt && (Date.now() - parseInt(verifiedAt)) < 30 * 60 * 1000) {
      showPanel('panel-active');
      startFormTimer();
    } else {
      showPanel('panel-enter-code');
    }

    // Polling kuota tiap 10 detik
    setInterval(loadConfig, 10000);
  } catch (err) {
    console.error("Init error:", err);
    showPanel('panel-enter-code');
  }
}

// ── VALIDASI TOKEN WAR SYSTEM ───────────────────────────────
async function handleTokenValidation(token) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/slot-queue/validate-token/${token}`);
    const data = await res.json();

    if (data.valid) {
      // Simpan info token ke sessionStorage
      sessionStorage.setItem('slot_token', token);
      sessionStorage.setItem('verified_batch_id', data.batch_id);
      sessionStorage.setItem('code_verified_at', Date.now().toString());
      sessionStorage.setItem('verified_code', '_TOKEN_BYPASS_');

      // Pre-fill nama & WA dari data token
      setTimeout(() => {
        const nameEl = document.getElementById('f-name');
        const waEl   = document.getElementById('id-wa');
        if (nameEl && data.full_name) { nameEl.value = data.full_name; onNameInput(); }
        if (waEl   && data.whatsapp)  { waEl.value   = data.whatsapp;  updateNominal(); }
      }, 200);

      showPanel('panel-active');
      startFormTimer();
    } else {
      // Token tidak valid — tampilkan pesan error di panel kode
      showPanel('panel-enter-code');
      const errEl = document.getElementById('code-error');
      const reason = data.reason === 'expired' ? 'Link sudah expired. Hubungi admin untuk mendapatkan slot baru.'
                   : data.reason === 'used'    ? 'Link ini sudah digunakan sebelumnya.'
                   :                             'Link tidak valid atau tidak ditemukan.';
      if (errEl) errEl.textContent = '❌ ' + reason;
    }
  } catch (err) {
    console.error('Token validation error:', err);
    showPanel('panel-enter-code');
    const errEl = document.getElementById('code-error');
    if (errEl) errEl.textContent = '❌ Gagal memvalidasi link. Coba refresh halaman.';
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
    } else {
      if (errEl) errEl.textContent = '❌ ' + (data.error || 'Kode tidak valid.');
      if (btn) { btn.disabled = false; btn.textContent = 'Verifikasi Kode →'; }
    }
  } catch (err) {
    if (errEl) errEl.textContent = '❌ Koneksi gagal. Coba lagi.';
    if (btn) { btn.disabled = false; btn.textContent = 'Verifikasi Kode →'; }
  }
}

// ── FORM TIMER (30 MIN) ───────────────────────────────────────────
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
      const b = bData.batches.find(x => x.status === 'active');
      if (b) {
        activeBatch = b;
        const remainEl = document.getElementById('slots-remain');
        if (remainEl) remainEl.textContent = `${b.total_slots - b.filled_slots} Slot Tersedia`;

        const batchEls = document.querySelectorAll('[id="sidebar-batch"]');
        batchEls.forEach(el => { if (el) el.textContent = b.name; });
      }
    }
  } catch (e) { console.warn("loadConfig failed:", e); }
}

// ── NOMINAL UNIK (Triggered by id-wa) ──────────────────────────────
function onWaInput() {
  updateNominal();
}

function onNameInput() {
  const nameVal = document.getElementById('f-name')?.value.trim();
  const displayEl = document.getElementById('display-sender-name');
  if (displayEl) {
    displayEl.textContent = nameVal || '...';
  }
}

function updateNominal() {
  const waEl = document.getElementById('id-wa');
  if (!waEl) return;
  const wa = waEl.value.trim();
  const last3 = wa.slice(-3).replace(/\D/g, '0');
  const nominal = 100000 + parseInt(last3 || '0', 10);
  const formatted = 'Rp' + nominal.toLocaleString('id-ID');

  const nominalEl = document.getElementById('display-unique-nominal');
  const sidebarEl = document.getElementById('sidebar-total');
  if (nominalEl) nominalEl.textContent = formatted;
  if (sidebarEl) sidebarEl.textContent = formatted;
}

// ── FILE HELPERS ──────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Gagal membaca file. Coba pilih ulang foto bukti transfer.'));
  });
}

// ── SUBMIT ────────────────────────────────────────────────────────
async function handleBooking() {
  const nameVal = document.getElementById('f-name')?.value.trim();
  const emailVal = document.getElementById('f-email')?.value.trim();
  const waVal = document.getElementById('id-wa')?.value.trim();
  const proofFile = document.getElementById('f-proof')?.files[0];
  const code      = sessionStorage.getItem('verified_code');
  const slotToken = sessionStorage.getItem('slot_token');
  const batchId   = sessionStorage.getItem('verified_batch_id') || activeBatch?.id;

  console.log("DEBUG handleBooking:", { nameVal, emailVal, waVal, proofFile, code, slotToken, batchId });

  if (!nameVal || !emailVal || !waVal) return showToast('⚠️ Lengkapi nama, email, dan nomor WA');

  // Validasi Email Ketat
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailVal)) {
    return showToast('⚠️ Format email tidak valid (contoh: nama@gmail.com)');
  }

  if (!proofFile) return showToast('⚠️ Upload bukti transfer terlebih dahulu');
  if (!slotToken && !code) { showPanel('panel-enter-code'); return; }

  // ── KONFIRMASI AKHIR ──
  const confirmMsg = `Pastikan email Anda sudah benar:\n\n» ${emailVal}\n\nEmail ini akan digunakan untuk mengirim INVOICE dan LINK GRUP WA setelah diverifikasi. Apakah email ini sudah aktif dan sesuai?`;
  if (!window.confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-pay');
  const oldHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>Mengirim...</span>'; }

  try {
    let finalFile = proofFile;
    // Kompres jika > 500KB
    if (proofFile.size > 500 * 1024) {
      try {
        const options = { maxSizeMB: 0.8, maxWidthOrHeight: 1280, useWebWorker: true };
        finalFile = await imageCompression(proofFile, options);
      } catch (e) { console.warn("Compression failed, using original", e); }
    }

    const base64 = await fileToBase64(finalFile);
    const ext = finalFile.name.split('.').pop().toLowerCase() || 'jpg';

    const body = {
      full_name: nameVal,
      email: emailVal,
      whatsapp: waVal,
      batch_id: batchId,
      proof_base64: base64,
      proof_ext: ext,
      // Kirim slot_token jika ada, otherwise kirim access_code
      ...(slotToken ? { slot_token: slotToken } : { access_code: code })
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const resData = await res.json();
    if (resData.success) {
      if (_countdownInterval) clearInterval(_countdownInterval);
      sessionStorage.clear();
      showPanel('panel-done');
    } else {
      throw new Error(resData.error || 'Gagal mengirim pendaftaran');
    }
  } catch (err) {
    const errMsg = err instanceof Error
      ? err.message
      : (err?.message || err?.error || 'Terjadi kesalahan. Coba lagi.');
    showToast('⚠️ ' + errMsg);
    if (btn) { btn.disabled = false; btn.innerHTML = oldHTML; }
  }
}

// ── UI HELPERS ────────────────────────────────────────────────────
function showPanel(panelId) {
  document.querySelectorAll('.state-panel').forEach(p => p.style.display = 'none');
  const target = document.getElementById(panelId);
  if (target) target.style.display = 'block';

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
window.onWaInput = onWaInput;

init();
