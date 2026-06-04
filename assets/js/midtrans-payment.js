let currentBatches = [];
let _slotToken = null; // Token dari URL ?token=xxx

async function loadBatches() {
  try {
    const res = await fetch('/api/batches');
    const data = await res.json();
    if (data.success) {
      currentBatches = data.batches;
      const select = document.getElementById('sim-batch');
      select.innerHTML = '';
      
      if (currentBatches.length === 0) {
        select.innerHTML = '<option value="">Tidak ada batch aktif saat ini</option>';
        document.getElementById('hero-batch-name').innerText = "CLOSED";
        // Disable button and show message
        const btn = document.getElementById('btn-pay-sim');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<span>Pendaftaran Ditutup Sementara</span>';
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        }
        return;
      }

      currentBatches.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.name} (Sisa: ${b.quota - b.paid_count})`;
        select.appendChild(opt);
      });

      // Set default batch
      updateSummary();
      const firstBatch = currentBatches[0].name;
      document.getElementById('hero-batch-name').innerText = firstBatch;
    }
  } catch (err) {
    console.error('Failed to load batches:', err);
  }
}

function updateSummary() {
  const select = document.getElementById('sim-batch');
  const batchId = select.value;
  const batch = currentBatches.find(b => b.id == batchId);
  
  if (batch) {
    document.getElementById('sum-batch').textContent = batch.name;
    document.getElementById('hero-batch-name').innerText = batch.name;
  } else {
    document.getElementById('sum-batch').textContent = '—';
  }
}

// WhatsApp input: Only numbers
document.getElementById('sim-wa').addEventListener('input', function(e) {
  this.value = this.value.replace(/[^0-9]/g, '');
});

async function startSimulatedPayment() {
  const name = document.getElementById('sim-name').value.trim();
  const email = document.getElementById('sim-email').value.trim();
  const wa = document.getElementById('sim-wa').value.trim();
  const batchId = document.getElementById('sim-batch').value;

  if (!name || !email || !wa || !batchId) {
    alert('Harap lengkapi semua data pendaftaran.');
    return;
  }

  // Strict Email Validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || !email.endsWith('.com')) {
    alert('Format email tidak valid. Pastikan diakhiri dengan .com (Contoh: nama@gmail.com)');
    return;
  }

  // Confirmation Popup
  const confirmEmail = confirm(`Apakah email ini sudah benar?\n\n👉 ${email}\n\nEmail ini akan digunakan untuk mengirimkan Invoice PDF dan Link Grup WhatsApp resmi.`);
  if (!confirmEmail) return;

  const btn = document.getElementById('btn-pay-sim');
  btn.disabled = true;
  btn.innerHTML = '<span>Memproses...</span>';

  try {
    const res = await fetch('/api/create-midtrans-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: name,
        email: email,
        whatsapp: wa,
        batch_id: batchId,
        ...((_slotToken) ? { slot_token: _slotToken } : {})
      })
    });

    const data = await res.json();
    if (data.success && data.midtrans_token) {
      window.snap.pay(data.midtrans_token, {
        onSuccess: async function(result) {
          await confirmPayment(data.order_ref);
        },
        onPending: function(result) {
          alert('Pembayaran tertunda. Silakan selesaikan pembayaran Anda.');
          location.reload();
        },
        onError: function(result) {
          alert('Pembayaran gagal. Silakan coba lagi.');
          location.reload();
        },
        onClose: function() {
          alert('Anda menutup jendela pembayaran sebelum selesai.');
          location.reload();
        }
      });
    } else {
      alert('Error: ' + (data.error || 'Gagal membuat pesanan'));
    }
  } catch (err) {
    console.error(err);
    alert('Terjadi kesalahan koneksi.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Lanjut ke Pembayaran</span><span>→</span>';
  }
}

async function confirmPayment(orderRef) {
  try {
    const res = await fetch('/api/simulate-payment-success', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_ref: orderRef })
    });
    const data = await res.json();
    if (data.success) {
      showSuccessModal(orderRef);
    }
  } catch (err) {
    console.error('Confirm error:', err);
  }
}

function showSuccessModal(orderRef) {
  document.getElementById('res-name').textContent = document.getElementById('sim-name').value;
  document.getElementById('res-oid').textContent = orderRef;
  document.getElementById('res-batch').textContent = document.getElementById('sum-batch').textContent;
  document.getElementById('res-email').textContent = document.getElementById('sim-email').value;
  
  // Link download invoice PDF (Public Route)
  const downloadBtn = document.getElementById('download-link');
  downloadBtn.href = `/api/download-invoice/${orderRef}`;
  
  document.getElementById('success-modal').classList.add('show');
}

// ── TOKEN WAR FLOW ──────────────────────────────────────────────
async function initTokenFlow() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (!token) return;

  _slotToken = token;

  try {
    const res = await fetch(`/api/slot-queue/validate-token/${token}`);
    const data = await res.json();

    if (data.valid) {
      // Pre-fill nama & WA
      const nameEl = document.getElementById('sim-name');
      const waEl   = document.getElementById('sim-wa');
      if (nameEl) nameEl.value = data.full_name;
      if (waEl)   waEl.value   = data.whatsapp;

      // Set batch dari token + disable dropdown
      const batchSelect = document.getElementById('sim-batch');
      if (batchSelect && data.batch_id) {
        // Tambahkan option jika belum ada (batch mungkin belum aktif di dropdown)
        if (!batchSelect.querySelector(`option[value="${data.batch_id}"]`)) {
          const opt = document.createElement('option');
          opt.value = data.batch_id;
          opt.textContent = 'Slot Kamu';
          batchSelect.appendChild(opt);
        }
        batchSelect.value = data.batch_id;
        batchSelect.disabled = true;
        updateSummary();
      }

      // Hitung sisa waktu & tampilkan banner
      const expiresAt  = new Date(data.expires_at);
      const minsLeft   = Math.max(0, Math.floor((expiresAt - Date.now()) / 60000));
      const tokenBanner = document.getElementById('token-info-banner');
      if (tokenBanner) {
        tokenBanner.style.display = 'block';
        tokenBanner.innerHTML = `⏰ Slot kamu valid! Sisa waktu: <strong>${minsLeft} menit</strong>. Segera lengkapi data & bayar.`;
      }
    } else {
      // Token tidak valid — disable tombol bayar
      const reason = data.reason === 'expired' ? 'Link slot sudah expired.'
                   : data.reason === 'used'    ? 'Link ini sudah pernah digunakan.'
                   :                             'Link tidak valid.';
      const btn = document.getElementById('btn-pay-sim');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>❌ ${reason}</span>`;
        btn.style.opacity = '0.6';
        btn.style.cursor  = 'not-allowed';
      }
      alert(`❌ ${reason}\n\nHubungi admin Localogo jika ada pertanyaan.`);
    }
  } catch (err) {
    console.error('Token validation error:', err);
  }
}

function showSuccessModalWithData(order) {
  document.getElementById('res-name').textContent = order.full_name;
  document.getElementById('res-oid').textContent = order.order_ref;
  document.getElementById('res-batch').textContent = order.batch_name;
  document.getElementById('res-email').textContent = order.email;
  
  const downloadBtn = document.getElementById('download-link');
  downloadBtn.href = `/api/download-invoice/${order.order_ref}`;
  
  document.getElementById('success-modal').classList.add('show');
}

// Init
async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('order_id');
  const statusCode = urlParams.get('status_code');
  const transactionStatus = urlParams.get('transaction_status');

  // Jika dialihkan kembali dari Midtrans setelah pembayaran berhasil
  if (orderId && (statusCode === '200' || transactionStatus === 'settlement' || transactionStatus === 'capture')) {
    // Tampilkan state loading
    const heroTitle = document.querySelector('.hero-title');
    if (heroTitle) {
      heroTitle.innerHTML = '<span>Verifikasi</span>Sinkronisasi Pembayaran...';
    }

    try {
      // 1. Jalankan Fast Sync ke server
      const syncRes = await fetch(`/api/verify-payment/${orderId}`);
      const syncData = await syncRes.json();
      console.log('Fast Sync Result:', syncData);

      // 2. Ambil detail order
      const detailsRes = await fetch(`/api/order-details/${orderId}`);
      const detailsData = await detailsRes.json();

      if (detailsData.success) {
        showSuccessModalWithData(detailsData.order);
        // Load batches di background saja untuk melengkapi view
        loadBatches();
        return; // Hentikan inisialisasi normal agar user tetap di modal sukses
      }
    } catch (err) {
      console.error('Failed to sync or load order details:', err);
    }
  }

  // Alur normal
  await loadBatches();
  await initTokenFlow();
}
init();

