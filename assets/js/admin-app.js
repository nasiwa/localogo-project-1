const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let allOrders = [];
let currentPage = 1;
let totalOrders = 0;
const ordersPerPage = 500;

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
  if (page === 'codes') loadAccessCodes();
}

async function refreshAll() {
  loadMasterGate();
  const activePage = document.querySelector('.page-section.active');
  if (!activePage) return;
  const pageId = activePage.id.replace('page-', '');
  showPage(pageId);
}

// ── DASHBOARD ──────────────────────────────────────────────────────
async function triggerAutoExpire() {
  try {
    await fetch(`${BACKEND_URL}/api/admin/auto-expire`, { 
      method: 'POST',
      headers: { 'x-admin-token': getAdminToken() } 
    });
  } catch (e) { console.warn('Auto-expire failed:', e); }
}

async function loadDashboard() {
  await triggerAutoExpire(); // 🧹 Bersihkan pesanan basi sebelum hitung data
  try {
    const h = { 'x-admin-token': getAdminToken() };
    const [bRes, sRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/admin/batches`, { headers: h }),
      fetch(`${BACKEND_URL}/api/admin/dashboard-stats`, { headers: h })
    ]);
    const { batches } = await bRes.json();
    const stats = await sRes.json();

    const elFilled = document.getElementById('ds-filled');
    const elFilledSub = document.getElementById('ds-filled-sub');
    const elPaid = document.getElementById('ds-paid');
    const elPending = document.getElementById('ds-pending');
    const elPickup = document.getElementById('ds-pickup');
    const elPickupSub = document.getElementById('ds-pickup-sub');

    if (elFilled) elFilled.textContent = stats.totalFilled;
    if (elFilledSub) elFilledSub.textContent = `dari ${stats.totalSlots} total`;
    if (elPaid) elPaid.textContent = stats.paidCount;
    if (elPending) elPending.textContent = stats.pendingCount;
    if (elPickup) elPickup.textContent = stats.pickupCount;
    if (elPickupSub) elPickupSub.textContent = `${((stats.pickupCount/stats.paidCount||0)*100).toFixed(0)}% telah lunas`;

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
  await triggerAutoExpire(); // 🧹 Bersihkan pesanan basi sebelum hitung data
  try {
    const h = { 'x-admin-token': getAdminToken() };
    
    // Untuk mendapatkan jumlah paid per batch, kita perlu memanggil orders tapi per batch atau biarkan orders paginate.
    // Karena /api/admin/batches sekarang hanya mengembalikan filled_slots (yang mana gabungan paid+pending),
    // Untuk tabel Kelola Batch, kita perlu count per batch. 
    // Cara termudah adalah fetch all orders, ATAU menggunakan API dashboard-stats yang di-expand.
    // Agar lebih cepat tanpa merombak backend lagi, kita bisa fetch all orders jika tidak lebih dari limit.
    // TAPI karena ada 631 order, kita harus request limit besar!
    
    const [bRes, oRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/admin/batches`, { headers: h }),
      fetch(`${BACKEND_URL}/api/admin/orders?limit=2000`, { headers: h }) // 🔧 LIMIT DISESUAIKAN KE 2000 UNTUK STABILITAS
    ]);
    const { batches } = await bRes.json();
    const { orders } = await oRes.json();

    // Pulihkan dropdown filter batch di halaman Orders
    const filterBatchSelect = document.getElementById('filter-batch');
    if (filterBatchSelect) {
      filterBatchSelect.innerHTML = '<option value="all">Semua Batch</option>' + 
        batches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    }

    const tbody = document.getElementById('batch-tbody');
    if (tbody) {
      tbody.innerHTML = batches.map(b => {
        const batchOrders = orders.filter(o => o.batch_id === b.id);
        const paidCount = batchOrders.filter(o => o.status === 'paid').length;
        const pendingCount = batchOrders.filter(o => o.status === 'pending').length;

        return `
          <tr>
            <td style="font-weight:700">${b.name}</td>
            <td><span class="pill ${b.status}">${b.status}</span></td>
            <td>${b.total_slots}</td>
            <td style="color:var(--t); font-weight:700">${paidCount}</td>
            <td style="color:#f59e0b; font-weight:700">${pendingCount}</td>
            <td style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px">${b.wa_group_url || '—'}</td>
            <td>
              <div style="display:flex; gap:5px;">
                <button class="btn-sm btn-edit" onclick='openEditModal(${JSON.stringify(b)})'>Edit</button>
                <button class="btn-sm btn-primary" onclick="openMembersModal('${b.id}', '${b.name}')">Lihat</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
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
  
  const revealInput = document.getElementById('edit-reveal');
  if (revealInput) {
    if (b.reveal_at) {
      const d = new Date(b.reveal_at);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      revealInput.value = d.toISOString().slice(0, 16);
    } else {
      revealInput.value = '';
    }
  }

  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.add('show');
}

function closeEditModal() { 
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.remove('show'); 
}

async function saveBatch() {
  const id = document.getElementById('edit-batch-id').value;
  const revealVal = document.getElementById('edit-reveal').value;
  let revealISO = null;
  if (revealVal) {
    revealISO = new Date(revealVal).toISOString();
  }

  const payload = {
    name: document.getElementById('edit-name').value,
    total_slots: parseInt(document.getElementById('edit-slots').value),
    wa_group_url: document.getElementById('edit-wa-link').value,
    status: document.getElementById('edit-status').value,
    reveal_at: revealISO
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
async function loadOrders(page = 1) {
  currentPage = page;
  const q = document.getElementById('order-search')?.value || '';
  const batchId = document.getElementById('filter-batch')?.value || 'all';
  const status = document.getElementById('filter-status')?.value || 'all';
  
  try {
    const url = `${BACKEND_URL}/api/admin/orders?page=${page}&limit=${ordersPerPage}&q=${encodeURIComponent(q)}&batch_id=${batchId}&status=${status}`;
    const res = await fetch(url, { 
      headers: { 'x-admin-token': getAdminToken() } 
    });
    const { orders, total } = await res.json();
    allOrders = orders;
    totalOrders = total;
    renderOrders(orders);
    buildPagination(total);
  } catch (e) {
    console.error('loadOrders error:', e);
  }
}

function buildPagination(total) {
  const container = document.getElementById('pagination-container');
  if (!container) return;
  
  const totalPages = Math.ceil(total / ordersPerPage);
  let html = '';
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  // Prev
  html += `<button class="btn-sm" ${currentPage === 1 ? 'disabled style="opacity:0.5"' : `onclick="loadOrders(${currentPage - 1})"`}>« Prev</button>`;
  
  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i <= 3 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="btn-sm ${i === currentPage ? 'btn-primary' : ''}" onclick="loadOrders(${i})">${i}</button>`;
    } else if (i === 4 && currentPage > 5) {
      html += `<span style="color:var(--txm)">...</span>`;
    }
  }

  // Next
  html += `<button class="btn-sm" ${currentPage === totalPages ? 'disabled style="opacity:0.5"' : `onclick="loadOrders(${currentPage + 1})"`}>Next »</button>`;
  
  container.innerHTML = `
    <div style="color:var(--txm); font-size:12px; margin-bottom:8px;">Menampilkan ${allOrders.length} dari ${total} data</div>
    <div style="display:flex; gap:5px; align-items:center;">${html}</div>
  `;
}

async function exportToCSV() {
  const btnExport = document.getElementById('btn-export-csv');
  const originalHtml = btnExport ? btnExport.innerHTML : 'Export CSV';
  if (btnExport) btnExport.textContent = 'Mengekspor...';

  try {
    const q = document.getElementById('order-search')?.value || '';
    const batchId = document.getElementById('filter-batch')?.value || 'all';
    
    // Force status 'paid' for export, regardless of the UI filter
    const status = 'paid';
    
    // Fetch ALL matching paid orders with a high limit to bypass default 1000
    const url = `${BACKEND_URL}/api/admin/orders?page=1&limit=5000&q=${encodeURIComponent(q)}&batch_id=${batchId}&status=${status}`;
    const res = await fetch(url, { 
      headers: { 'x-admin-token': getAdminToken() } 
    });
    
    const { orders, total } = await res.json();
    console.log(`Exporting ${orders?.length} of ${total} orders`);
    
    if (!orders || orders.length === 0) {
      if (btnExport) btnExport.innerHTML = originalHtml;
      return showToast('Tidak ada data untuk diexport');
    }
    
    // Format headers
    const headers = ['No', 'Code', 'Nama', 'Email', 'WhatsApp'];
    
    // Format rows
    const csvRows = orders.map((o, index) => {
      const batchName = o.batches?.name || 'Batch 1';
      
      // Hitung Smart Code (sama dengan logika di tabel)
      let smartCode = '—';
      if (o.status === 'paid' && o.sequence_num) {
        const bNum = parseInt(batchName.match(/\d+/) || '1');
        const sess = Math.ceil(o.sequence_num / 200);
        const romans = ['I','II','III','IV','V'];
        smartCode = `BC${romans[bNum-1] || 'I'}${sess}_${o.sequence_num.toString().padStart(4, '0')}`;
      }

      return [
        index + 1,
        smartCode,
        `"${o.full_name.replace(/"/g, '""')}"`,
        o.email,
        `'${o.whatsapp}`
      ];
    });

    const csvContent = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', blobUrl);
    link.setAttribute('download', `Rekap_Order_Localogo_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error('Export error:', e);
    showToast('Gagal melakukan export data');
  } finally {
    if (btnExport) btnExport.innerHTML = originalHtml;
  }
}

function renderOrders(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  console.log('DEBUG_ORDERS:', orders);
  
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
      <td>${o.proof_url ? `<button onclick="viewProof('${o.proof_url}')" style="background:transparent; cursor:pointer; font-size:11px; color:var(--td); border:1px solid var(--td); padding:2px 5px; border-radius:4px;">🖼️ Lihat</button>` : '<span style="opacity:0.2">—</span>'}</td>
      <td>${o.is_picked_up ? `<span class="badge-pickup">DIAMBIL</span><div style="font-size:9px;color:var(--txm);margin-top:2px;">oleh ${o.scanned_by || 'Loket'}</div>` : '<span style="opacity:0.3">—</span>'}</td>
      <td style="font-size:10px">${new Date(o.created_at).toLocaleString()}</td>
      <td>
         <div style="display:flex; gap:4px; justify-content:flex-end;">
           ${(o.status === 'pending' || o.status === 'expired') ? `<button class="btn-sm btn-activate" onclick="confirmManual('${o.order_ref}')">Konfirmasi</button>` : ''}
           <button class="btn-sm btn-edit" onclick="syncOrder('${o.order_ref}')">Sync</button>
           ${o.status === 'paid' ? `<a href="${BACKEND_URL}/api/invoice/${o.order_ref}" target="_blank" class="btn-sm btn-primary" style="text-decoration:none; text-align:center; display:inline-block;">PDF</a>` : ''}
         </div>
      </td>
    </tr>`;
  }).join('');
}

async function viewProof(filename) {
  // Jika sudah berupa URL (data lama), langsung buka
  if (filename.startsWith('http')) return window.open(filename, '_blank');
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/proof-url/${filename}`, {
      headers: { 'x-admin-token': getAdminToken() }
    });
    const data = await res.json();
    if (data.success && data.signedUrl) {
      window.open(data.signedUrl, '_blank');
    } else {
      showToast('⚠️ ' + (data.error || 'Gagal memuat gambar'));
    }
  } catch (e) {
    console.error('viewProof error:', e);
    showToast('⚠️ Terjadi kesalahan server');
  }
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

function toggleManualOrderType() {
  const typeSelect = document.getElementById('man-type');
  const amountInput = document.getElementById('man-amount');
  const statusSelect = document.getElementById('man-status');
  if (!typeSelect || !amountInput || !statusSelect) return;

  if (typeSelect.value === 'giveaway') {
    amountInput.value = 0;
    amountInput.disabled = true;
    statusSelect.value = 'paid';
    statusSelect.disabled = true;
  } else {
    amountInput.value = 100000;
    amountInput.disabled = false;
    statusSelect.disabled = false;
  }
}

async function openManualModal() {
  const modal = document.getElementById('manual-order-modal');
  
  // Reset form inputs
  const typeSelect = document.getElementById('man-type');
  if (typeSelect) {
    typeSelect.value = 'reguler';
    toggleManualOrderType();
  }
  
  // Load batches for the dropdown
  const res = await fetch(`${BACKEND_URL}/api/admin/batches`, { headers: { 'x-admin-token': getAdminToken() } });
  const { batches } = await res.json();
  const select = document.getElementById('man-batch');
  if (select) {
    select.innerHTML = batches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  }
  if (modal) modal.classList.add('show');
}

function closeManualModal() {
  const modal = document.getElementById('manual-order-modal');
  if (modal) modal.classList.remove('show');
}

async function submitManualOrder() {
  const btn = document.getElementById('btn-save-manual');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const typeVal = document.getElementById('man-type')?.value || 'reguler';
  const payload = {
    full_name: document.getElementById('man-name').value,
    email: document.getElementById('man-email').value,
    whatsapp: document.getElementById('man-wa').value,
    batch_id: document.getElementById('man-batch').value,
    amount: document.getElementById('man-amount').value,
    status: document.getElementById('man-status').value,
    gateway: typeVal === 'giveaway' ? 'giveaway' : 'manual'
  };

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/order/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Order manual berhasil dibuat!');
      closeManualModal();
      loadOrders(1);
    } else {
      showToast('❌ Gagal: ' + data.error);
    }
  } catch (e) {
    showToast('❌ Terjadi kesalahan');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function closeMembersModal() { 
  const modal = document.getElementById('members-modal');
  if (modal) modal.classList.remove('show'); 
}

// ── UTILS ──────────────────────────────────────────────────────────
// Global search with debounce
let searchTimeout;
function filterOrders() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadOrders(1); // Reset ke halaman 1 saat mencari
  }, 500);
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
  
  // Bind export button
  const btnExport = document.getElementById('btn-export-csv');
  if (btnExport) btnExport.onclick = exportToCSV;
};


// ── MASTER GATE LOGIC (FIXED: Using Backend API) ───────────────────
async function loadMasterGate() {
  const adminToken = getAdminToken();
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/gate`, {
      headers: { 'x-admin-token': adminToken }
    });
    const { success, is_open } = await res.json();
    
    if (success) {
      const icon = document.getElementById('master-gate-icon');
      const status = document.getElementById('master-gate-status');
      const btn = document.getElementById('btn-master-toggle');
      if (!icon || !status || !btn) return;
      
      if (is_open) {
        icon.textContent = '🔓';
        status.innerHTML = 'Status: <strong style="color:var(--green)">ANTREAN DIBUKA</strong>. User bisa masuk.';
        btn.textContent = 'TUTUP ANTREAN 🔒';
        btn.style.background = 'var(--red)';
      } else {
        icon.textContent = '🔒';
        status.innerHTML = 'Status: <strong style="color:var(--red)">ANTREAN TERKUNCI</strong>. User tidak bisa masuk.';
        btn.textContent = 'BUKA ANTREAN 🔓';
        btn.style.background = 'var(--td)';
      }
    }
  } catch (e) {
    console.error('loadMasterGate error:', e);
  }
}

async function toggleMasterGate() {
  const adminToken = getAdminToken();
  const btn = document.getElementById('btn-master-toggle');
  const statusLabel = document.getElementById('master-gate-status');
  
  // Ambil status saat ini dulu
  const resInit = await fetch(`${BACKEND_URL}/api/admin/gate`, {
    headers: { 'x-admin-token': adminToken }
  });
  const { is_open: currentStatus } = await resInit.json();
  const newState = !currentStatus;

  btn.disabled = true;
  btn.textContent = 'Memproses...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/gate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-admin-token': adminToken 
      },
      body: JSON.stringify({ is_open: newState })
    });
    const result = await res.json();

    if (result.success) {
      showToast(newState ? '🚀 Antrean berhasil DIBUKA!' : '🔒 Antrean berhasil DITUTUP!');
      loadMasterGate();
    } else {
      showToast('⚠ Gagal: ' + (result.error || 'Terjadi kesalahan'));
    }
  } catch (e) {
    showToast('⚠ Gagal menyambung ke server');
  } finally {
    btn.disabled = false;
  }
}

// ── ACCESS CODES MANAGEMENT ────────────────────────────────────
let _allBatchesForCode = [];

async function loadAccessCodes() {
  try {
    const h = { 'x-admin-token': getAdminToken() };
    const [cRes, bRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/admin/access-codes`, { headers: h }),
      fetch(`${BACKEND_URL}/api/admin/batches`, { headers: h })
    ]);
    const { codes } = await cRes.json();
    const { batches } = await bRes.json();
    _allBatchesForCode = batches || [];

    const tbody = document.getElementById('codes-tbody');
    if (!tbody) return;
    if (!codes || codes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--txm); padding:30px;">Belum ada kode sesi. Klik "+ Tambah Kode" untuk membuat kode baru.</td></tr>';
      return;
    }
    tbody.innerHTML = codes.map(c => {
      const sisa = c.max_uses - c.use_count;
      const batchName = c.batches?.name || '—';
      const pct = Math.round((c.use_count / c.max_uses) * 100);
      const sisakColor = sisa <= 0 ? 'color:var(--red); font-weight:700;' : sisa < 20 ? 'color:#f59e0b; font-weight:700;' : 'color:var(--green); font-weight:700;';
      return `<tr>
        <td style="font-family:monospace; font-weight:700; font-size:13px; letter-spacing:1px;">${c.code}</td>
        <td><span class="pill active" style="font-size:10px;">${batchName}</span></td>
        <td style="text-align:center;">${c.max_uses}</td>
        <td style="text-align:center;">
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="flex:1; background:var(--bg3); border-radius:4px; height:6px;">
              <div style="width:${Math.min(pct,100)}%; background:var(--td); height:6px; border-radius:4px;"></div>
            </div>
            <span>${c.use_count}</span>
          </div>
        </td>
        <td style="${sisakColor}">${sisa}</td>
        <td style="font-size:10px; color:var(--txm);">${new Date(c.created_at).toLocaleDateString('id-ID')}</td>
        <td style="text-align:right;">
          <button class="btn-sm" style="background:rgba(224,85,85,0.12); color:var(--red); border:1px solid rgba(224,85,85,0.3);" onclick="deleteCode('${c.code}')">Hapus</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error('loadAccessCodes error:', e);
    showToast('⚠️ Gagal memuat kode sesi');
  }
}

async function openAddCodeModal() {
  // Load batches for dropdown
  if (_allBatchesForCode.length === 0) {
    const res = await fetch(`${BACKEND_URL}/api/admin/batches`, { headers: { 'x-admin-token': getAdminToken() } });
    const { batches } = await res.json();
    _allBatchesForCode = batches || [];
  }
  const select = document.getElementById('new-code-batch');
  if (select) {
    select.innerHTML = _allBatchesForCode.map(b => `<option value="${b.id}">${b.name} (${b.status})</option>`).join('');
  }
  const modal = document.getElementById('add-code-modal');
  if (modal) modal.classList.add('show');
}

function closeAddCodeModal() {
  const modal = document.getElementById('add-code-modal');
  if (modal) modal.classList.remove('show');
}

async function saveNewCode() {
  const btn = document.getElementById('btn-save-code');
  const code = document.getElementById('new-code-input')?.value.trim().toUpperCase();
  const batch_id = document.getElementById('new-code-batch')?.value;
  const max_uses = document.getElementById('new-code-maxuses')?.value;

  if (!code) return showToast('⚠️ Isi kode akses terlebih dahulu');
  if (!batch_id) return showToast('⚠️ Pilih batch tujuan');

  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/access-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken() },
      body: JSON.stringify({ code, batch_id, max_uses: parseInt(max_uses) || 100 })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Kode sesi berhasil ditambahkan!');
      closeAddCodeModal();
      document.getElementById('new-code-input').value = '';
      loadAccessCodes();
    } else {
      showToast('❌ ' + data.error);
    }
  } catch (e) {
    showToast('❌ Gagal menyambung ke server');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Kode'; }
  }
}

async function deleteCode(code) {
  if (!confirm(`Hapus kode sesi "${code}"? Data penggunaan akan hilang permanen.`)) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/admin/access-codes/${encodeURIComponent(code)}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': getAdminToken() }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Kode berhasil dihapus');
      loadAccessCodes();
    } else {
      showToast('❌ Gagal: ' + data.error);
    }
  } catch (e) {
    showToast('❌ Gagal menyambung ke server');
  }
}