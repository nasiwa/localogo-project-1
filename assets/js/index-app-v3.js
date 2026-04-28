// ── SUPABASE CLIENT ──────────────────────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── STATE ─────────────────────────────────────────────────────────
let activeBatch = null;
let _countdownInterval = null;
let _waveInterval = null;

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  console.log("System initializing...");
  try {
    await loadConfig();
    await checkUserState();
    setupRealtime();
    
    // Bersihkan URL dari token Supabase yang kotor (#access_token=...)
    if (window.location.hash && window.location.hash.includes('access_token')) {
      setTimeout(() => {
        history.replaceState(null, '', window.location.pathname);
      }, 1000);
    }
  } catch (err) {
    console.error("Init error:", err);
    showPanel('panel-not-logged-in');
  }
}

// ── CEK STATUS USER ───────────────────────────────────────────────
async function checkUserState() {
  const { data: { session } } = await _supabase.auth.getSession();

  if (!session) {
    showPanel('panel-not-logged-in');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/status?t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });

    if (!res.ok) {
      showPanel('panel-not-logged-in');
      return;
    }

    const result = await res.json();
    if (!result.success) {
      showPanel('panel-not-logged-in');
      return;
    }

    const { status, data } = result;
    console.log("Current Status:", status, data);

    if (status === 'done') {
      showPanel('panel-done');
    } else if (status === 'waiting') {
      renderWaitingPanel(data);
    } else if (status === 'active') {
      if (!document.getElementById('panel-active').offsetParent) {
        renderWaitingPanel({ ...data, is_transition: true });
        setTimeout(() => renderActivePanel(data, session), 2000);
      } else {
        renderActivePanel(data, session);
      }
    } else if (status === 'expired') {
      showPanel('panel-expired');
    } else {
      await renderNotQueuedPanel(session);
    }
  } catch (err) {
    console.error("State check failed:", err);
    showPanel('panel-not-logged-in');
  }
}

// ── PANEL: BELUM ANTRE ────────────────────────────────────────────
async function renderNotQueuedPanel(session) {
  const user = session?.user;
  const nameEl = document.getElementById('queue-user-name');
  if (user && nameEl) {
    nameEl.textContent = user.user_metadata?.full_name || user.email.split('@')[0];
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/info?t=${Date.now()}`);
    const { success, data } = await res.json();

    const availEl = document.getElementById('queue-quota-available');
    const totalEl = document.getElementById('queue-quota-total');
    const btn = document.getElementById('btn-claim-queue');

    if (success && data) {
      if (availEl) availEl.textContent = data.available ?? '?';
      if (totalEl) totalEl.textContent = data.total_quota ?? '?';

      if (!data.is_open) {
        showPanel('panel-not-queued');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span>Antrean Sedang Ditutup</span><span>🔒</span>'; }
      } else if (data.available <= 0) {
        showPanel('panel-quota-full');
      } else {
        showPanel('panel-not-queued');
        if (btn) { btn.disabled = false; btn.innerHTML = '<span>Ambil Nomor Antrean</span><span>→</span>'; }
      }
    }
  } catch (err) {
    console.error("Info fetch error:", err);
  }
}

// ── PANEL: MENUNGGU ───────────────────────────────────────────────
function renderWaitingPanel(data) {
  showPanel('panel-waiting');

  const numEl   = document.getElementById('display-queue-number');
  const sessEl  = document.getElementById('display-queue-session');
  const timerEl = document.getElementById('timer-countdown');
  const titleEl = document.getElementById('waiting-title');

  if (numEl)  numEl.textContent  = String(data.queue_number || '---').padStart(3, '0');
  if (sessEl) sessEl.textContent = data.session || '1';

  if (data.is_transition) {
    if (titleEl) titleEl.textContent = 'Giliran Anda Tiba! Menyiapkan Form...';
    if (timerEl) timerEl.textContent = '00:02';
    return;
  }

  if (_waveInterval) clearInterval(_waveInterval);
  let secondsLeft = Math.max(0, (data.minutes_to_wait || 0) * 60);

  function tick() {
    if (secondsLeft <= 0) {
      clearInterval(_waveInterval);
      checkUserState();
      return;
    }
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    if (timerEl) timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    secondsLeft--;
  }
  tick();
  _waveInterval = setInterval(tick, 1000);
}

// ── PANEL: AKTIF (FORM) ───────────────────────────────────────────
function renderActivePanel(data, session) {
  showPanel('panel-active');
  const adminRow = document.getElementById('sidebar-admin-row');
  if (adminRow) adminRow.style.display = 'none';

  const user = session?.user;
  if (user) {
    const emailEl = document.getElementById('f-email');
    const nameEl  = document.getElementById('f-name');
    if (emailEl) emailEl.value = user.email || '';
    if (nameEl && user.user_metadata?.full_name) nameEl.value = user.user_metadata.full_name;
  }

  onWaInput();

  if (_countdownInterval) clearInterval(_countdownInterval);
  let formSeconds = 10 * 60;
  if (data?.expires_at) {
    const msLeft = new Date(data.expires_at) - new Date();
    formSeconds = Math.max(0, Math.floor(msLeft / 1000));
  }

  const countdownEl = document.getElementById('active-countdown-timer');
  function tickForm() {
    if (formSeconds <= 0) {
      clearInterval(_countdownInterval);
      checkUserState();
      return;
    }
    const m = Math.floor(formSeconds / 60);
    const s = formSeconds % 60;
    if (countdownEl) countdownEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    formSeconds--;
  }
  tickForm();
  _countdownInterval = setInterval(tickForm, 1000);
}

// ── LOAD CONFIG (Batch Aktif & Grid) ──────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/batches?t=${Date.now()}`);
    const bData = await res.json();
    if (bData.success && bData.batches) {
      renderBatches(bData.batches);
      const b = bData.batches.find(x => x.status === 'active');
      if (b) {
        activeBatch = b;
        const batchEls = document.querySelectorAll('[id="sidebar-batch"], [id="h-batch"]');
        batchEls.forEach(el => { if (el) el.textContent = b.name; });
      }
    }
  } catch (e) { console.warn("loadConfig failed:", e); }
}

function renderBatches(batches) {
  const grid = document.getElementById('batch-grid');
  if (!grid) return;
  grid.innerHTML = '';
  batches.forEach(b => {
    const progress = Math.min(100, Math.round((b.filled_slots / b.total_slots) * 100));
    const card = document.createElement('div');
    card.className = `batch-card ${b.status === 'active' ? 'active' : ''}`;
    card.innerHTML = `
      <div class="batch-name">${b.name}</div>
      <div class="batch-status-chip status-${b.status}">${b.status.toUpperCase()}</div>
      <div class="batch-progress-bg"><div class="batch-progress-fill" style="width:${progress}%"></div></div>
    `;
    grid.appendChild(card);
  });
}

// ── NOMINAL UNIK ──────────────────────────────────────────────────
function onWaInput() {
  const waEl = document.getElementById('f-wa');
  if (!waEl) return;
  const wa = waEl.value.trim();
  const last3 = wa.slice(-3).replace(/\D/g, '0');
  const nominal = 100000 + parseInt(last3 || '0', 10);
  const formatted = 'Rp' + nominal.toLocaleString('id-ID');

  const nominalEl = document.getElementById('display-unique-nominal');
  const sidebarEl = document.getElementById('sidebar-total');
  if (nominalEl) nominalEl.textContent = formatted;
  if (sidebarEl)  sidebarEl.textContent  = formatted;
}

// ── AMBIL NOMOR ANTREAN ───────────────────────────────────────────
async function claimQueueSlot() {
  const btn = document.getElementById('btn-claim-queue');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>Memproses...</span><span>⏳</span>'; }

  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { showPanel('panel-not-logged-in'); return; }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const result = await res.json();

    if (!result.success) {
      showToast('⚠️ ' + (result.error || 'Gagal mengambil antrean'));
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>Ambil Nomor Antrean</span><span>→</span>'; }
      return;
    }
    
    // Berhasil → langsung panggil checkUserState
    await checkUserState();
  } catch (err) {
    showToast('Koneksi terputus, coba lagi.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>Ambil Nomor Antrean</span><span>→</span>'; }
  }
}

// ── SUBMIT BOOKING ────────────────────────────────────────────────
async function handleBooking() {
  const nameVal  = document.getElementById('f-name')?.value.trim();
  const emailVal = document.getElementById('f-email')?.value.trim();
  const waVal    = document.getElementById('f-wa')?.value.trim();
  const proofFile = document.getElementById('f-proof')?.files[0];

  if (!nameVal || !waVal || !proofFile) return showToast('⚠️ Lengkapi semua data');

  const btn = document.getElementById('btn-pay');
  const oldHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>Mengunggah...</span><span>⏳</span>'; }

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const fileName = `proof_${session.user.id}_${Date.now()}.jpg`;
    await _supabase.storage.from('transfer_proofs').upload(fileName, proofFile);

    const body = {
      full_name: nameVal,
      email: emailVal,
      whatsapp: waVal,
      batch_id: activeBatch.id,
      proof_url: fileName,
      user_id: session?.user?.id
    };

    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const resData = await res.json();
    if (resData.success) {
      if (_countdownInterval) clearInterval(_countdownInterval);
      showPanel('panel-done');
    } else {
      throw new Error(resData.error || 'Gagal mengirim pendaftaran');
    }
  } catch (err) {
    showToast('⚠️ ' + err.message);
    if (btn) { btn.disabled = false; btn.innerHTML = oldHTML; }
  }
}

// ── SHOW PANEL ────────────────────────────────────────────────────
function showPanel(panelId) {
  document.querySelectorAll('.state-panel').forEach(p => p.style.display = 'none');
  const target = document.getElementById(panelId);
  if (target) target.style.display = 'block';

  const stepMap = {
    'panel-not-logged-in': 1, 'panel-quota-full': 1, 'panel-not-queued': 1,
    'panel-waiting': 2, 'panel-active': 3, 'panel-done': 4
  };
  const step = stepMap[panelId] || 1;
  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active'));
  for (let i = 1; i <= step; i++) {
    const el = document.getElementById('step' + i);
    if (el) el.classList.add('active');
  }
}

// ── UTILITIES ─────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function setupRealtime() {
  // Ganti Realtime WebSockets dengan Polling santai tiap 10 detik untuk menyelamatkan server
  setInterval(() => {
    loadQueueInfo();
    if (userState.status === 'waiting' || userState.status === 'not_queued') {
      checkUserState();
    }
  }, 10000);
}

// ── EXPOSED GLOBALS ───────────────────────────────────────────────
window.loginGoogle = () => _supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
window.claimQueueSlot = claimQueueSlot;
window.handleBooking  = handleBooking;
window.onWaInput      = onWaInput;
window.resetQueue = async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  await fetch(`${BACKEND_URL}/api/queue/reset`, { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}` } });
  window.location.reload();
};
window.logout = async () => {
  await _supabase.auth.signOut();
  window.location.reload();
};

init();
