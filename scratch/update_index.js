const fs = require('fs');
const path = 'd:/Localogo-Project/index.html';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Logo
content = content.replace(
  /<a class="logo" href="#">\s+<div class="logo-text">Localogo<\/div>\s+<\/a>/,
  \`<a class="logo" href="#">
      <img src="favicon.png" alt="Logo" style="height: 30px; margin-right: 10px;" onerror="this.style.display='none'">
      <div class="logo-text">Localogo</div>
    </a>\`
);

// 2. Update Waiting Panel
content = content.replace(
  /Posisi Anda sudah aman\. Anda boleh me-refresh halaman ini tanpa takut kehilangan antrean\./,
  'Halaman ini akan otomatis mengarahkan Anda ke formulir pendaftaran saat giliran tiba. Mohon tetap berada di sini agar posisi Anda aman.'
);
content = content.replace(/batas waktu transfer hanya 7 menit/, 'batas waktu pendaftaran hanya 10 menit');
content = content.replace(/setiap <span id="display-wave-duration">7<\/span> menit/, 'setiap <span id="display-wave-duration">10</span> menit');

// 3. Add Countdown to Waiting Panel
content = content.replace(
  /<h4 id="waiting-title"/,
  \`<div id="queue-timer" style="margin-bottom: 20px; padding: 10px; background: rgba(36,153,155,0.05); border-radius: 8px; font-weight: 700; color: var(--td); font-size: 14px; display:none;">
    Estimasi giliran Anda: <span id="timer-countdown">--:--</span>
  </div>
  <h4 id="waiting-title"\`
);

// 4. Update Form Panel
content = content.replace(/07:00/, '10:00');
content = content.replace(/Lanjut ke Pembayaran/, 'Kirim Pendaftaran');
content = content.replace(
  /<!-- Upload Bukti Transfer -->/,
  \`<!-- Rekening Pembayaran -->
          <div style="background:var(--bg); padding:15px; border-radius:8px; margin: 20px 0; border:1px solid var(--border);">
            <div style="font-size:11px; color:var(--txm); text-transform:uppercase; font-weight:700; margin-bottom:10px;">Transfer Ke Rekening Berikut:</div>
            <div style="font-size:14px; color:var(--txd); font-weight:700; margin-bottom:5px;">Bank BCA</div>
            <div style="font-size:18px; color:var(--td); font-weight:900; letter-spacing:1px; margin-bottom:5px;">123 4567 890</div>
            <div style="font-size:13px; color:var(--txm);">a.n. Localogo Official</div>
            
            <div style="margin-top:15px; padding-top:15px; border-top:1px dashed var(--border);">
              <div style="font-size:11px; color:var(--txm); text-transform:uppercase; font-weight:700; margin-bottom:5px;">Nominal yang Harus Dibayar:</div>
              <div style="font-size:24px; color:var(--td); font-weight:900;" id="display-unique-nominal">Rp100.---</div>
              <div style="font-size:10px; color:var(--red); font-weight:600;">*WAJIB transfer sesuai nominal sampai 3 digit terakhir.</div>
            </div>
          </div>
          <!-- Upload Bukti Transfer -->\`
);

// 5. Update Expired Panel
content = content.replace(/7 menit/, '10 menit');
content = content.replace(
  /<button onclick="window\.location\.reload\(\)" class="btn-primary" style="width:100%;">Coba Ambil Antrean Lagi<\/button>/,
  '<button onclick="resetQueue()" class="btn-pay" style="width:100%;">Ambil Antrean Baru</button>'
);

fs.writeFileSync(path, content);
console.log('index.html updated successfully');
