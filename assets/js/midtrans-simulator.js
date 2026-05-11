/**
 * Midtrans Simulator Logic
 */

let activeBatches = [];

async function init() {
  try {
    // Fetch Batches
    const resB = await fetch('/api/batches');
    const dataB = await resB.json();
    if (dataB.success) {
      activeBatches = dataB.batches;
      renderBatches();
    }

    // Fetch Config
    const resC = await fetch('/api/config');
    const dataC = await resC.json();
    if (dataC.midtransClientKey) {
      const snapScript = document.querySelector('script[src*="snap.js"]');
      if (snapScript) {
        snapScript.setAttribute('data-client-key', dataC.midtransClientKey);
      }
    }
  } catch (err) {
    console.error('Initialization error:', err);
  }
}

function renderBatches() {
  const select = document.getElementById('sim-batch');
  select.innerHTML = activeBatches.map(b => `
    <option value="${b.id}">${b.name} (${b.filled_slots}/${b.total_slots} Terisi)</option>
  `).join('');
  updateSummary();
}

function updateSummary() {
  const select = document.getElementById('sim-batch');
  const batchName = select.options[select.selectedIndex]?.text.split(' (')[0] || '—';
  const sumBatch = document.getElementById('sum-batch');
  if (sumBatch) sumBatch.innerText = batchName;
}

async function startSimulatedPayment() {
  const name = document.getElementById('sim-name').value;
  const email = document.getElementById('sim-email').value;
  const wa = document.getElementById('sim-wa').value;
  const batchId = document.getElementById('sim-batch').value;

  if (!name || !email || !wa || !batchId) {
    alert('Harap lengkapi semua data pendaftaran.');
    return;
  }

  const btn = document.getElementById('btn-pay-sim');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>Memproses...</span>';

  try {
    // 1. Create order via API
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: name,
        email: email,
        whatsapp: wa,
        batch_id: batchId,
        gateway: 'midtrans',
        access_code: 'PUBLIC'
      })
    });

    const result = await response.json();

    if (!result.success) {
      alert('Error: ' + result.error);
      btn.disabled = false;
      btn.innerHTML = originalText;
      return;
    }

    // 2. Trigger Midtrans Snap
    if (window.snap) {
      window.snap.pay(result.token, {
        onSuccess: async function(res) {
          // Notify backend of success (to update status immediately in admin)
          await confirmSuccess(result.order_ref);
          showSuccess(result.order_ref, name, email);
        },
        onPending: function(res) {
          alert('Pembayaran pending. Silakan selesaikan sesuai instruksi.');
          location.reload();
        },
        onError: function(res) {
          alert('Pembayaran gagal. Silakan coba lagi.');
          btn.disabled = false;
          btn.innerHTML = originalText;
        },
        onClose: function() {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      });
    } else {
      alert('Simulasi: Token Snap diterima. Mengalihkan ke sukses...');
      await confirmSuccess(result.order_ref);
      showSuccess(result.order_ref, name, email);
    }

  } catch (err) {
    console.error('Submit Error:', err);
    alert('Terjadi kesalahan koneksi.');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function confirmSuccess(oid) {
  try {
    await fetch('/api/simulate-payment-success', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ref: oid })
    });
  } catch (err) {
    console.error('Confirm Error:', err);
  }
}

function showSuccess(oid, name, email) {
  const select = document.getElementById('sim-batch');
  const batchName = select.options[select.selectedIndex]?.text.split(' (')[0] || '—';

  document.getElementById('res-oid').innerText = oid;
  document.getElementById('res-name').innerText = name.toUpperCase();
  document.getElementById('res-email').innerText = email;
  document.getElementById('res-batch').innerText = batchName;
  document.getElementById('download-link').href = `/api/invoice/${oid}`;
  
  document.getElementById('success-modal').classList.add('active');
  document.getElementById('success-modal').style.display = 'flex';
}

init();
