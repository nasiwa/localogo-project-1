// ── SUPABASE CLIENT ──────────────────────────────────────────────
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Update Midtrans client key dynamically
const snapScript = document.querySelector('script[data-client-key]');
if (snapScript) {
  snapScript.setAttribute('data-client-key', MIDTRANS_CLIENT);
}

// ── STATE ─────────────────────────────────────────────────────────
let activeBatch = null;
let activeGateway = 'manual';
let countdownInterval;

function startCountdown(durationMinutes, displayId, onEnd) {
  clearInterval(countdownInterval);
  let timer = Math.floor(durationMinutes * 60);
  const display = document.getElementById(displayId);
  if (!display) return;

  function update() {
    let minutes = parseInt(timer / 60, 10);
    let seconds = parseInt(timer % 60, 10);
    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;
    display.textContent = minutes + ":" + seconds;

    if (--timer < 0) {
      clearInterval(countdownInterval);
      if (onEnd) onEnd();
    }
  }
  update();
  countdownInterval = setInterval(update, 1000);
}

// ── INITIAL LOAD & STATE MANAGEMENT ───────────────────────────────
let queueStatusInterval = null;

async function init() {
  console.log("System initializing...");
  try {
    loadConfig().catch(e => console.warn("Config load failed", e));
    await checkUserState();
    setupRealtime();
  } catch (err) {
    console.error("Init error:", err);
    showPanel('panel-not-logged-in');
  }
}

async function checkUserState() {
  const { data: { session: authSession } } = await _supabase.auth.getSession();
  if (!authSession) {
    showPanel('panel-not-logged-in');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/status?t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${authSession.access_token}` }
    });
    const result = await res.json();
    if (!result.success) throw new Error('Gagal cek status');

    const { status, data } = result;
    console.log("Current Status:", status);

    if (status === 'not_queued') {
      await renderNotQueuedPanel();
    } else if (status === 'waiting') {
      renderWaitingPanel(data);
    } else if (status === 'active') {
      // Transition effect
      if (document.getElementById('panel-active').style.display !== 'block') {
          renderWaitingPanel({ ...data, is_transition: true });
          setTimeout(() => renderActivePanel(data), 2000);
      } else {
          renderActivePanel(data);
      }
    } else if (status === 'done') {
      showPanel('panel-done');
    } else if (status === 'expired') {
      showPanel('panel-expired');
    }
  } catch (err) {
    console.error("State check failed:", err);
    showPanel('panel-not-logged-in');
  }
}

function showPanel(panelId) {
  const panels = document.querySelectorAll('.state-panel');
  panels.forEach(p => p.style.display = 'none');
  
  const target = document.getElementById(panelId);
  if (target) target.style.display = 'block';

  // Update Steps
  const steps = {
    'panel-not-queued': 1, 'panel-quota-full': 1,
    'panel-waiting': 2,
    'panel-active': 3,
    'panel-done': 4
  };
  if (steps[panelId]) updateStep(steps[panelId]);
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
  const nameEl = document.getElementById('queue-user-name');
  if(user && nameEl) nameEl.textContent = user.user_metadata?.full_name || user.email.split('@')[0];

  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/info?t=${Date.now()}`);
    const { success, data } = await res.json();
    
    if (success && data.is_open) {
      const availEl = document.getElementById('queue-quota-available');
      const totalEl = document.getElementById('queue-quota-total');
      if (availEl) availEl.textContent = data.available;
      if (totalEl) totalEl.textContent = data.total_quota;
      
      const btn = document.getElementById('btn-claim-queue');
      if (data.available <= 0) {
          showPanel('panel-quota-full'); // SHOW SORRY PANEL
      } else {
          showPanel('panel-not-queued');
          if(btn) {
              btn.disabled = false;
              btn.innerHTML = '<span>Ambil Nomor Antrean</span><span>→</span>';
          }
      }
    } else {
      showPanel('panel-not-queued');
      const btn = document.getElementById('btn-claim-queue');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Antrean Sedang Ditutup</span><span>🔒</span>';
      }
    }
  } catch (err) {
    showPanel('panel-not-logged-in');
  }
}

async function claimQueueSlot() {
  const btn = document.getElementById('btn-claim-queue');
  btn.innerHTML = '<span>Memproses...</span><span>⏳</span>';
  btn.disabled = true;

  const { data: { session } } = await _supabase.auth.getSession();
  try {
    const res = await fetch(`${BACKEND_URL}/api/queue/claim`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const result = await res.json();
    if (!result.success) {
      showToast(result.error);
      btn.innerHTML = '<span>Ambil Nomor Antrean</span><span>→</span>';
      btn.disabled = false;
      return;
    }
    checkUserState();
  } catch (err) {
    showToast('Koneksi terputus');
    btn.disabled = false;
  }
}

function renderWaitingPanel(data) {
  showPanel('panel-waiting');
  const numEl = document.getElementById('display-queue-number');
  const sessEl = document.getElementById('display-queue-session');
  if (numEl) numEl.textContent = String(data.queue_number || '---').padStart(3, '0');
  if (sessEl) sessEl.textContent = data.session || '1';
  
  const timerDisplay = document.getElementById('timer-countdown');
  const statusText = document.getElementById('waiting-title');

  if (data.is_transition && statusText) {
      statusText.textContent = "Giliran Anda Tiba! Menyiapkan Form...";
      if (timerDisplay) timerDisplay.textContent = "00:02";
      return;
  }

  if (data.status === 'active') {
      if (statusText) statusText.textContent = "Menuju Form Pendaftaran...";
      if (timerDisplay) timerDisplay.textContent = "GO!";
      return;
  }

  // LOGIKA GELOMBANG 10 MENIT
  if (data.minutes_to_wait !== undefined) {
      if (window.queueStatusInterval) clearInterval(window.queueStatusInterval);
      
      let secondsRemaining = data.minutes_to_wait * 60;
      function tick() {
          if (secondsRemaining <= 0) {
              clearInterval(window.queueStatusInterval);
              checkUserState();
              return;
          }
          const m = Math.floor(secondsRemaining / 60);
          const s = secondsRemaining % 60;
          if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          secondsRemaining--;
      }
      tick();
      window.queueStatusInterval = setInterval(tick, 1000);
  }
}

function renderActivePanel(data) {
  showPanel('panel-active');
  const sidebarTotal = document.getElementById('sidebar-total');
  const adminRow = document.getElementById('sidebar-admin-row');
  if (adminRow) adminRow.style.display = 'none';

  _supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      document.getElementById('f-email').value = session.user.email;
      if (session.user.user_metadata?.full_name) {
          document.getElementById('f-name').value = session.user.user_metadata.full_name;
      }
      onWaInput(); 
    }
  });

  if (data.expires_at) {
    const diff = (new Date(data.expires_at) - new Date()) / 60000;
    startCountdown(diff, 'active-countdown-timer', () => checkUserState());
  }
}

async function loadConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/batches?t=${Date.now()}`);
    const bData = await res.json();
    if (bData.success && bData.batches) {
      const b = bData.batches.find(x => x.status === 'active');
      if (b) {
        activeBatch = b;
        document.getElementById('sidebar-batch').textContent = b.name;
        document.getElementById('h-batch').textContent = b.name;
      }
    }
  } catch (e) {}
}

function onWaInput() {
  const wa = document.getElementById('f-wa').value.trim();
  const last3 = wa.slice(-3).replace(/\D/g, '0');
  const nominal = 100000 + parseInt(last3 || '0');
  const formatted = 'Rp' + nominal.toLocaleString('id-ID');
  document.getElementById('display-unique-nominal').textContent = formatted;
  document.getElementById('sidebar-total').textContent = formatted;
}

async function handleBooking() {
  const proofFile = document.getElementById('f-proof').files[0];
  if (!proofFile) return showToast('⚠️ Upload bukti transfer dulu');

  const btn = document.getElementById('btn-pay');
  const oldText = btn.innerHTML;
  btn.disabled = true; 
  btn.innerHTML = '<span>Mengunggah...</span><span>⏳</span>';

  try {
    const fileName = `proof_${Date.now()}.jpg`;
    await _supabase.storage.from('transfer_proofs').upload(fileName, proofFile);
    
    const { data: { session } } = await _supabase.auth.getSession();
    const body = {
      full_name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      whatsapp: document.getElementById('f-wa').value.trim(),
      batch_id: activeBatch?.id,
      proof_url: fileName,
      user_id: session?.user?.id
    };
    
    const res = await fetch(`${BACKEND_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const resData = await res.json();
    if (resData.success) showPanel('panel-done');
    else throw new Error(resData.error);
  } catch (err) {
    showToast('⚠️ ' + err.message);
    btn.disabled = false; btn.innerHTML = oldText;
  }
}

window.loginGoogle = async () => {
    await _supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
};
window.claimQueueSlot = claimQueueSlot;
window.handleBooking = handleBooking;
window.resetQueue = async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    await fetch(`${BACKEND_URL}/api/queue/reset`, { method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}` } });
    window.location.reload();
};
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function setupRealtime() {
  _supabase.channel('queue').on('postgres_changes', { event: '*', schema: 'public', table: 'queue_slots' }, () => checkUserState()).subscribe();
}
init();
