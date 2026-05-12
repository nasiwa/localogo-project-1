let currentBatches = [];

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
        batch_id: batchId
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
  document.getElementById('res-oid').textContent = orderRef;
  document.getElementById('res-batch').textContent = document.getElementById('sum-batch').textContent;
  
  // Link download invoice PDF
  const downloadBtn = document.getElementById('download-link');
  downloadBtn.href = `/api/admin/orders/download-invoice/${orderRef}`;
  
  document.getElementById('success-modal').classList.add('show');
}

// Init
loadBatches();
