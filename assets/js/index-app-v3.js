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

// ── INITIAL LOAD & STATE MANAGEMENT ───────────────────────────────
let queueStatusInterval = null;
let activeCountdownInterval = null;

async function init() {
  await loadConfig();
  await checkUserState();
  setupRealtime();
}

async function checkUserState() {
  const { data: { session } } = await _supabase.auth.getSession();
  
  if (!session) {
    showPanel('panel-not-logged-in');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/status`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const { success, status, data } = await res.json();

    if (!success) throw new Error('Gagal cek status antrean');

    if (status === 'not_queued') {
      await renderNotQueuedPanel();
    } else if (status === 'waiting') {
      renderWaitingPanel(data);
    } else if (status === 'active') {
      renderActivePanel(data);
    } else if (status === 'done') {
      showPanel('panel-done');
    } else if (status === 'expired') {
      showPanel('panel-expired');
    }
  } catch (err) {
    console.error(err);
    showToast('Terjadi kesalahan sistem, memuat ulang...');
    setTimeout(() => window.location.reload(), 2000);
  }
}

function showPanel(panelId) {
  const panels = document.querySelectorAll('.state-panel');
  panels.forEach(p => p.style.display = 'none');
  const target = document.getElementById(panelId);
  if (target) target.style.display = 'block';
  
  // Update step visual indicators
  if (panelId === 'panel-not-queued' || panelId === 'panel-quota-full') updateStep(1);
  else if (panelId === 'panel-waiting') updateStep(2);
  else if (panelId === 'panel-active') updateStep(3);
  else if (panelId === 'panel-done') updateStep(4);
}

function updateStep(stepNum) {
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active'));
  for (let i = 1; i <= stepNum; i++) {
    const el = document.getElementById('step' + i);
    if (el) el.classList.add('active');
  }
}

async function renderNotQueuedPanel() {
  const { data: { user } } = await _supabase.auth.getUser();
  if(user) {
    document.getElementById('queue-user-name').textContent = user.user_metadata?.full_name || user.email.split('@')[0];
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/info`);
    const { success, data } = await res.json();
    
    if (success && data.is_open) {
      document.getElementById('queue-quota-available').textContent = data.available;
      document.getElementById('queue-quota-total').textContent = data.total_quota;
      
      if (data.available <= 0) {
        document.getElementById('qf-total').textContent = data.total_quota;
        showPanel('panel-quota-full');
      } else {
        showPanel('panel-not-queued');
      }
    } else {
      document.getElementById('queue-quota-available').textContent = 'Ditutup';
      document.getElementById('queue-quota-total').textContent = '-';
      document.getElementById('btn-claim-queue').disabled = true;
      document.getElementById('btn-claim-queue').innerHTML = '<span>Antrean Belum Dibuka</span><span>🔒</span>';
      showPanel('panel-not-queued');
    }
  } catch (err) {
    console.error(err);
  }
}

async function claimQueueSlot() {
  const btn = document.getElementById('btn-claim-queue');
  btn.innerHTML = '<span>Memproses...</span><span>⏳</span>';
  btn.disabled = true;

  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) return window.location.reload();

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const result = await res.json();

    if (!result.success) {
      if (result.error === 'quota_full') {
        showPanel('panel-quota-full');
      } else if (result.error === 'queue_closed') {
        showToast('Antrean saat ini sedang ditutup');
        window.location.reload();
      } else {
        showToast(result.error || 'Gagal mengambil antrean');
        btn.innerHTML = '<span>Coba Lagi</span><span>→</span>';
        btn.disabled = false;
      }
      return;
    }

    checkUserState(); // Reload state automatically
  } catch (err) {
    showToast('Gagal koneksi ke server');
    btn.innerHTML = '<span>Coba Lagi</span><span>→</span>';
    btn.disabled = false;
  }
}

function renderWaitingPanel(queueData) {
  showPanel('panel-waiting');
  document.getElementById('display-queue-number').textContent = String(queueData.queue_number).padStart(3, '0');
  document.getElementById('display-queue-session').textContent = queueData.session;
  
  if (queueStatusInterval) clearInterval(queueStatusInterval);
  queueStatusInterval = setInterval(() => {
    checkUserState();
  }, 60000); 
}

function renderActivePanel(queueData) {
  if (queueStatusInterval) clearInterval(queueStatusInterval);
  
  const emailInput = document.getElementById('f-email');
  _supabase.auth.getUser().then(({ data }) => {
    if (data?.user?.email) emailInput.value = data.user.email;
  });

  showPanel('panel-active');

  const expiresAt = new Date(queueData.expires_at).getTime();
  if (activeCountdownInterval) clearInterval(activeCountdownInterval);

  activeCountdownInterval = setInterval(() => {
    const now = new Date().getTime();
    const distance = expiresAt - now;

    if (distance <= 0) {
      clearInterval(activeCountdownInterval);
      showPanel('panel-expired');
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    document.getElementById('active-countdown-timer').textContent = 
      `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, 1000);
}

async function registerWaitlist() {
  const btn = document.getElementById('btn-waitlist');
  btn.innerHTML = '<span>Mendaftarkan...</span><span>⏳</span>';
  const { data: { session } } = await _supabase.auth.getSession();
  
  try {
    await fetch(`${BACKEND_URL}/api/queue/notify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    document.getElementById('waitlist-box').innerHTML = `
      <div style="color:var(--td); font-weight:bold; font-size:15px; margin-bottom:5px;">✅ Email Anda berhasil didaftarkan!</div>
      <div style="font-size:13px; color:#555;">Kami akan mengirim email notifikasi sesaat sebelum kuota tambahan dibuka.</div>
    `;
  } catch (e) {
    btn.innerHTML = '<span>Gagal. Coba lagi</span><span>🔄</span>';
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

    // Auto-show the modal if it's a valid pending order
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('show');
    setStep(3); // Go to summary/payment step
    
    // Also show toast as a small notification
    showToast('📑 Melanjutkan sesi pendaftaran Anda...');

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
  const channel = _supabase.channel('public:batches');
  
  channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'batches' }, (payload) => {
      if (activeBatch && payload.new.id === activeBatch.id) {
        activeBatch = payload.new;
        updateBatchUI();
      }
    })
    .subscribe();

  _supabase
    .channel('orders-channel')
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
async function handleBooking() {
  if (!validate()) return;
  const proofFile = document.getElementById('f-proof').files[0];
  if (!proofFile) {
    showToast('⚠️ Silakan upload bukti transfer terlebih dahulu');
    return;
  }

  const btnLanjut = document.getElementById('btn-pay');
  const originalLanjutText = btnLanjut.innerHTML;
  btnLanjut.disabled = true; 
  btnLanjut.innerHTML = '<span>Mengunggah Bukti...</span><span>⏳</span>';

  try {
    // 1. Kompresi Gambar
    const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1280, useWebWorker: true };
    const compressedFile = await imageCompression(proofFile, options);
    
    // 2. Upload ke Supabase Storage
    const fileName = `proof_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    const { data: uploadData, error: uploadErr } = await _supabase.storage
      .from('payment_proofs')
      .upload(fileName, compressedFile);

    if (uploadErr) throw new Error('Gagal mengunggah bukti: Pastikan bucket payment_proofs tersedia');

    btnLanjut.innerHTML = '<span>Menyelesaikan Pendaftaran...</span><span>⏳</span>';

    // 3. Post ke Backend
    if (!activeBatch) throw new Error('Konfigurasi batch tidak ditemukan');

    const body = {
      full_name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      whatsapp: document.getElementById('f-wa').value.trim(),
      batch_id: activeBatch.id,
      proof_url: fileName // Hanya kirim nama file, BUKAN public URL
    };
    
    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const resData = await res.json();
    if (!resData.success) {
      throw new Error(resData.error || 'Gagal membuat pesanan');
    }

    // 4. Update status antrean menjadi 'done'
    const { data: { session } } = await _supabase.auth.getSession();
    await _supabase.from('queue_slots')
      .update({ status: 'done' })
      .eq('user_id', session.user.id);

    // 5. Muat ulang state (akan masuk ke halaman Sukses)
    checkUserState();

  } catch (err) {
    console.error(err);
    showToast('⚠️ ' + err.message);
    btnLanjut.disabled = false; 
    btnLanjut.innerHTML = originalLanjutText;
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

function formatPrice(num) {
  if (!num) return 'Rp0';
  return 'Rp' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
window.addEventListener('load', () => {
  init();
  initCarousel();
});
