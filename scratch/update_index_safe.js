const fs = require('fs');
const path = 'd:/Localogo-Project/index.html';
let content = fs.readFileSync(path, 'utf8');

const replacements = [
  {
    target: /<a class="logo" href="#">\s+<div class="logo-text">Localogo<\/div>\s+<\/a>/,
    replacement: '<a class="logo" href="#">\n      <img src="favicon.png" alt="Logo" style="height: 30px; margin-right: 10px;" onerror="this.style.display=\'none\'">\n      <div class="logo-text">Localogo</div>\n    </a>'
  },
  {
    target: /Posisi Anda sudah aman\. Anda boleh me-refresh halaman ini tanpa takut kehilangan antrean\./,
    replacement: 'Halaman ini akan otomatis mengarahkan Anda ke formulir pendaftaran saat giliran tiba. Mohon tetap berada di sini agar posisi Anda aman.'
  },
  {
    target: /batas waktu transfer hanya 7 menit/,
    replacement: 'batas waktu pendaftaran hanya 10 menit'
  },
  {
    target: /setiap <span id="display-wave-duration">7<\/span> menit/,
    replacement: 'setiap <span id="display-wave-duration">10</span> menit'
  },
  {
    target: /<h4 id="waiting-title"/,
    replacement: '<div id="queue-timer" style="margin-bottom: 20px; padding: 10px; background: rgba(36,153,155,0.05); border-radius: 8px; font-weight: 700; color: var(--td); font-size: 14px; display:none;">\n    Estimasi giliran Anda: <span id="timer-countdown">--:--</span>\n  </div>\n  <h4 id="waiting-title"'
  },
  {
    target: /07:00/g,
    replacement: '10:00'
  },
  {
    target: /Lanjut ke Pembayaran/,
    replacement: 'Kirim Pendaftaran'
  },
  {
    target: /<!-- Upload Bukti Transfer -->/,
    replacement: '<!-- Rekening Pembayaran -->\n          <div style="background:var(--bg); padding:15px; border-radius:8px; margin: 20px 0; border:1px solid var(--border);">\n            <div style="font-size:11px; color:var(--txm); text-transform:uppercase; font-weight:700; margin-bottom:10px;">Transfer Ke Rekening Berikut:</div>\n            <div style="font-size:14px; color:var(--txd); font-weight:700; margin-bottom:5px;">Bank BCA</div>\n            <div style="font-size:18px; color:var(--td); font-weight:900; letter-spacing:1px; margin-bottom:5px;">123 4567 890</div>\n            <div style="font-size:13px; color:var(--txm);">a.n. Localogo Official</div>\n            \n            <div style="margin-top:15px; padding-top:15px; border-top:1px dashed var(--border);">\n              <div style="font-size:11px; color:var(--txm); text-transform:uppercase; font-weight:700; margin-bottom:5px;">Nominal yang Harus Dibayar:</div>\n              <div style="font-size:24px; color:var(--td); font-weight:900;" id="display-unique-nominal">Rp100.---</div>\n              <div style="font-size:10px; color:var(--red); font-weight:600;">*WAJIB transfer sesuai nominal sampai 3 digit terakhir.</div>\n            </div>\n          </div>\n          <!-- Upload Bukti Transfer -->'
  },
  {
    target: /7 menit/g,
    replacement: '10 menit'
  },
  {
    target: /<button onclick="window\.location\.reload\(\)" class="btn-primary" style="width:100%;">Coba Ambil Antrean Lagi<\/button>/,
    replacement: '<button onclick="resetQueue()" class="btn-pay" style="width:100%;">Ambil Antrean Baru</button>'
  }
];

replacements.forEach(r => {
  content = content.replace(r.target, r.replacement);
});

fs.writeFileSync(path, content);
console.log('index.html updated successfully');
