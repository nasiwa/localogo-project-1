const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let allOrders = [];

function getAdminToken() { 
  return sessionStorage.getItem('lok_admin_token') || ''; 
}

function checkAuth() { 
  return !!getAdminToken(); 
}

// ── AUTH LOGIC ─────────────────────────────────────────────────────
async function doLogin() {
  const pwInput = document.getElementById('pw-input');
  const btn = document.getElementById('btn-login');
  if (!pwInput || !btn) return;
  
  const pw = pwInput.value;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Memverifikasi...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/check`, {
      headers: { 'x-admin-token': pw }
    });
    const data = await res.json();

    if (data.allowed) {
      sessionStorage.setItem('lok_admin_token', pw);
      enterApp();
    } else {
      const errEl = document.getElementById('login-err');
      if (errEl) errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (e) {
    alert('Gagal menyambung ke server');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function enterApp() {
  const loginScreen = document.getElementById('login-screen');
  const app = document.getElementById('app');
  if (loginScreen) loginScreen.classList.add('hidden');
  if (app) app.classList.add('visible');
  loadDashboard();
  subscribeAdmin();
}

function logout() {
  sessionStorage.removeItem('lok_admin_token');
  window.location.reload();
}

function togglePw() {
  const input = document.getElementById('pw-input');
  const eye = document.getElementById('pw-eye');
  if (!input || !eye) return;
  if (input.type === 'password') {
    input.type = 'text';
    eye.textContent = '🙈';
    eye.title = 'Sembunyikan password';
  } else {
    input.type = 'password';
    eye.textContent = '👁';
    eye.title = 'Tampilkan password';
  }
}

// ── NAVIGATION ─────────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.snav-item').forEach(i => i.classList.remove('active'));
  
  const pageEl = document.getElementById('page-' + page);
  const navEl = document.getElementById('nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  
  if (page === 'dashboard') loadDashboard();
  if (page === 'batches') loadAdminBatches();
  if (page === 'orders') loadOrders();
}

async function refreshAll() {
  const activePage = document.querySelector('.page-section.active');
  if (!activePage) return;
  const pageId = activePage.id.replace('page-', '');
  showPage(pageId);
}

// ── DASHBOARD ──────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const h = { 'x-admin-token': getAdminToken() };
    const [bRes, oRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/admin/batches`, { headers: h }),
      fetch(`${BACKEND_URL}/api/admin/orders`, { headers: h })
    ]);
    const { batches } = await bRes.json();
    const { orders } = await oRes.json();

    const totalFilled = batches.reduce((s, b) => s + b.filled_slots, 0);
    const totalSlots = batches.reduce((s, b) => s + b.total_slots, 0);
    const paidOrders = orders.filter(o => o.status === 'paid');
    const pickupCount = paidOrders.filter(o => o.is_picked_up).length;

    const elFilled = document.getElementById('ds-filled');
    const elFilledSub = document.getElementById('ds-filled-sub');
    const elPaid = document.getElementById('ds-paid');
    const elPending = document.getElementById('ds-pending');
    const elPickup = document.getElementById('ds-pickup');
    const elPickupSub = document.getElementById('ds-pickup-sub');

    if (elFilled) elFilled.textContent = totalFilled;
    if (elFilledSub) elFilledSub.textContent = `dari ${totalSlots} total`;
    if (elPaid) elPaid.textContent = paidOrders.length;
    if (elPending) elPending.textContent = batches.reduce((s, b) => s + (b.pending_slots||0), 0);
    if (elPickup) elPickup.textContent = pickupCount;
    if (elPickupSub) elPickupSub.textContent = `${((pickupCount/paidOrders.length||0)*100).toFixed(0)}% telah lunas`;

    const tbody = document.getElementById('dash-batch-tbody');
    if (tbody) {
      tbody.innerHTML = batches.map(b => {
        const pct = Math.round((b.filled_slots / b.total_slots) * 100);
        return `<tr>
          <td>${b.name}</td>
          <td><span class="pill ${b.status}">${b.status}</span></td>
          <td>${b.filled_slots} / ${b.total_slots}</td>
          <td><div class="tbl-bar"><div class="tbl-fill" style="width:${pct}%"></div></div></td>
          <td style="font-size:10px; color:var(--txm)">${b.wa_group_url ? 'Link Set ✅' : 'No Link ❌'}</td>
        </tr>`;
      }).join('');
    }
  } catch (e) {
    console.error('loadDashboard error:', e);
  }
}

// ── BATCH MANAGEMENT ──────────────────────────────────────────────
async function loadAdminBatches() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/batches`, { headers: { 'x-admin-token': getAdminToken() } });
    const { batches } = await res.json();
    const tbody = document.getElementById('batch-tbody');
    if (tbody) {
      tbody.innerHTML = batches.map(b => `
        <tr>
          <td style="font-weight:700">${b.name}</td>
          <td><span class="pill ${b.status}">${b.status}</span></td>
          <td>${b.total_slots}</td>
          <td>${b.filled_slots}</td>
          <td style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px">${b.wa_group_url || '—'}</td>
          <td>
            <div style="display:flex; gap:5px;">
              <button class="btn-sm btn-edit" onclick='openEditModal(${JSON.stringify(b)})'>Edit</button>
              <button class="btn-sm btn-primary" onclick="openMembersModal('${b.id}', '${b.name}')">Lihat</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error('loadAdminBatches error:', e);
  }
}

function openEditModal(b) {
  document.getElementById('edit-batch-id').value = b.id;
  document.getElementById('edit-name').value = b.name;
  document.getElementById('edit-slots').value = b.total_slots;
  document.getElementById('edit-wa-link').value = b.wa_group_url || '';
  document.getElementById('edit-status').value = b.status;
  
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.add('show');
}

function closeEditModal() { 
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.remove('show'); 
}

async function saveBatch() {
  const id = document.getElementById('edit-batch-id').value;
  const payload = {
    name: document.getElementById('edit-name').value,
    total_slots: parseInt(document.getElementById('edit-slots').value),
    wa_group_url: document.getElementById('edit-wa-link').value,
    status: document.getElementById('edit-status').value
  };
  try {
    await fetch(`${BACKEND_URL}/api/admin/batch/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
      body: JSON.stringify(payload)
    });
    showToast('Batch updated!');
    closeEditModal();
    loadAdminBatches();
  } catch (e) {
    showToast('Failed to update batch');
  }
}

// ── ORDER MANAGEMENT ──────────────────────────────────────────────
async function loadOrders() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/orders`, { headers: { 'x-admin-token': getAdminToken() } });
    const { orders } = await res.json();
    allOrders = orders;
    renderOrders(orders);
  } catch (e) {
    console.error('loadOrders error:', e);
  }
}

function renderOrders(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  
  tbody.innerHTML = orders.map((o, index) => {
    const batchName = o.batches?.name || '—';
    // Smart code calc
    let smartCode = '—';
    if (o.status === 'paid' && o.sequence_num) {
      const bNum = parseInt(batchName.match(/\d+/) || '1');
      const sess = Math.ceil(o.sequence_num / 200);
      const romans = ['I','II','III','IV','V'];
      smartCode = `BC${romans[bNum-1]}${sess}_${o.sequence_num.toString().padStart(4, '0')}`;
    }

    return `<tr>
      <td>${index + 1}</td>
      <td style="font-family:monospace; font-size:10px">${o.order_ref}</td>
      <td style="font-weight:700; color:var(--t)">${smartCode}</td>
      <td>${o.full_name}</td>
      <td style="font-size:11px">${o.email}</td>
      <td style="font-size:12px">${o.whatsapp}</td>
      <td>${batchName}</td>
      <td style="text-align:right; font-weight:700; color:var(--t)">${new Intl.NumberFormat('id-ID').format(o.amount || 0)}</td>
      <td><span class="badge-${o.status}">${o.status.toUpperCase()}</span></td>
      <td>${o.proof_url ? `<a href="${o.proof_url}" target="_blank" style="text-decoration:none; font-size:11px; color:var(--td); border:1px solid var(--td); padding:2px 5px; border-radius:4px;">🖼️ Lihat</a>` : '<span style="opacity:0.2">—</span>'}</td>
      <td>${o.is_picked_up ? `<span class="badge-pickup">DIAMBIL</span><div style="font-size:9px;color:var(--txm);margin-top:2px;">oleh ${o.scanned_by || 'Loket'}</div>` : '<span style="opacity:0.3">—</span>'}</td>
      <td style="font-size:10px">${new Date(o.created_at).toLocaleString()}</td>
      <td>
         <div style="display:flex; gap:4px; justify-content:flex-end;">
           ${o.status === 'pending' ? `<button class="btn-sm btn-activate" onclick="confirmManual('${o.order_ref}')">Konfirmasi</button>` : ''}
           <button class="btn-sm btn-edit" onclick="syncOrder('${o.order_ref}')">Sync</button>
           ${o.status === 'paid' ? `<a href="${BACKEND_URL}/api/invoice/${o.order_ref}" target="_blank" class="btn-sm btn-primary" style="text-decoration:none; text-align:center; display:inline-block;">PDF</a>` : ''}
         </div>
      </td>
    </tr>`;
  }).join('');
}

async function syncOrder(ref) {
  const res = await fetch(`${BACKEND_URL}/api/admin/order/${ref}/sync`, { headers: { 'x-admin-token': getAdminToken() } });
  const data = await res.json();
  showToast(`Sync result: ${data.status}`);
  loadOrders();
}

async function confirmManual(ref) {
  if (!confirm(`Konfirmasi pembayaran manual untuk ${ref}? Email invoice akan langsung dikirim ke peserta.`)) return;
  const res = await fetch(`${BACKEND_URL}/api/admin/order/${ref}/confirm-manual`, {
    method: 'POST',
    headers: { 'x-admin-token': getAdminToken() }
  });
  const data = await res.json();
  if (data.success) {
    showToast('✅ Pesanan berhasil dikonfirmasi!');
    loadOrders();
    loadDashboard();
  } else {
    showToast('❌ Gagal: ' + data.error);
  }
}

// ── MEMBER LIST ──────────────────────────────────────────────────
let currentBatchMembers = [];
async function openMembersModal(id, name) {
  const title = document.getElementById('m-modal-title');
  const modal = document.getElementById('members-modal');
  if (title) title.textContent = name;
  if (modal) modal.classList.add('show');
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/batch/${id}/members`, { headers: { 'x-admin-token': getAdminToken() } });
    const { members } = await res.json();
    currentBatchMembers = members;
    const tbody = document.getElementById('m-modal-tbody');
    if (tbody) {
      tbody.innerHTML = members.map((m, index) => {
        const bNum = parseInt(name.match(/\d+/) || '1');
        const romans = ['I','II','III','IV','V'];
        
        let smartCode = '—';
        if (m.sequence_num) {
          const sess = Math.ceil(m.sequence_num / 200);
          smartCode = `BC${romans[bNum-1]}${sess}_${m.sequence_num.toString().padStart(4, '0')}`;
        }
        
        return `
          <tr>
            <td>${index + 1}</td>
            <td style="font-weight:700; color:var(--t); font-size:11px">${smartCode}</td>
            <td>${m.full_name}</td>
            <td style="font-size:10px">${m.email}</td>
            <td style="font-size:11px">${m.whatsapp}</td>
            <td>${m.is_picked_up ? `<span style="color:var(--t)">✅ Diambil</span> <span style="font-size:9px;color:#859a9a;">(${m.scanned_by || 'Lkt'})</span>` : '<span style="color:var(--red)">❌ Belum</span>'}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {
    console.error('openMembersModal error:', e);
  }
}

function closeMembersModal() { 
  const modal = document.getElementById('members-modal');
  if (modal) modal.classList.remove('show'); 
}

// ── UTILS ──────────────────────────────────────────────────────────
function filterOrders() {
  const qEl = document.getElementById('order-search');
  if (!qEl) return;
  const q = qEl.value.toLowerCase();
  renderOrders(allOrders.filter(o => o.full_name.toLowerCase().includes(q) || o.order_ref.toLowerCase().includes(q)));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function subscribeAdmin() {
  _sb.channel('admin-updates').on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, () => loadDashboard()).subscribe();
}

window.onload = () => { 
  if (checkAuth()) enterApp(); 
};
