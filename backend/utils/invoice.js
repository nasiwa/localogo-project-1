const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);
const QR_SECRET = process.env.QR_SECRET || 'localogo_secure_qr_2026';

function toRoman(num) {
  const map = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
  let result = '';
  for (let key in map) {
    while (num >= map[key]) {
      result += key;
      num -= map[key];
    }
  }
  return result;
}

function generateSecureQrData(orderRef) {
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(orderRef);
  const signature = hmac.digest('hex').substring(0, 16);
  return `${orderRef}|${signature}`;
}

/**
 * Generate PDF Invoice Buffer
 */
async function generateInvoicePDF(order) {
  const seq = order.sequence || 0;
  const batchNum = parseInt(order.batch_num) || 1;
  const sessionNum = Math.ceil(seq / 200) || 1;
  const romanBatch = toRoman(batchNum);
  // SMART CODE with SESSION NUMBER (1-5)
  const smartCode = `BC${romanBatch}${sessionNum}_${seq.toString().padStart(4, '0')}`;
  
  const qrData = generateSecureQrData(order.order_ref);
  const qrBuffer = await QRCode.toBuffer(qrData, { margin: 1, width: 200 });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- COLORS ---
    const teal = '#24999b';
    const darkTeal = '#024847';
    const white = '#ffffff';
    const grayText = '#6a9999';

    // ── HEADER SECTION ──
    doc.rect(0, 0, doc.page.width, 220).fill(darkTeal);
    doc.fillColor(white).font('Helvetica-Bold').fontSize(70).text('LOCALOGO', 0, 45, { align: 'center' });
    doc.fontSize(24).font('Helvetica-Bold').text('Toko Ospek UB', 0, 115, { align: 'center', opacity: 0.9 });
    
    // Address Bar
    doc.rect(0, 175, doc.page.width, 30).fill(teal);
    doc.fillColor(white).font('Helvetica-Bold').fontSize(9)
       .text('LOCALOGO 2 | Jl. Kertosentono No.23, Ketawanggede, Kec. Lowokwaru, Kota Malang, Jawa Timur 65144', 0, 186, { align: 'center' });

    // ── MAIN CONTENT ──
    // Sequence Number (Big Bold Focus)
    doc.fillColor('#eef5f5').rect(40, 240, 150, 80).fill();
    doc.fillColor(darkTeal).font('Helvetica-Bold').fontSize(54).text(seq.toString().padStart(4, '0'), 40, 255, { width: 150, align: 'center' });
    doc.fontSize(10).font('Helvetica-Bold').text('No. Antrean', 40, 245, { width: 150, align: 'center', opacity: 0.8 });

    // Order Details
    const startY = 360;
    const labelX = 50;
    const valueX = 160;

    const row = (label, value, y, color = '#000') => {
      doc.fillColor(grayText).font('Helvetica-Bold').fontSize(11).text(label, labelX, y);
      doc.fillColor(color).font('Helvetica-Bold').fontSize(11).text(`:  ${value}`, valueX, y);
    };

    row('Nama Pemesan', order.full_name, startY);
    row('Email', order.email, startY + 30);
    row('WhatsApp', order.whatsapp, startY + 60);
    row('Order', 'PO PAKET PERLENGKAPAN OSPEK 2026', startY + 90, teal);
    row('Nominal DP', 'Rp. 100,000', startY + 115);
    row('Biaya Admin', 'Rp. 2,500', startY + 135);
    
    doc.rect(labelX, startY + 152, 260, 1).fill('#e0eeee');
    row('Total Bayar', 'Rp. 102,500', startY + 162, darkTeal);

    const paidTime = order.paid_at ? new Date(order.paid_at).toLocaleString('id-ID') : 'N/A';
    doc.fillColor(grayText).font('Helvetica-Bold').fontSize(9).text(`Dibayar pada: ${paidTime}`, labelX, startY + 185);

    // ── RIGHT SIDE BOXES ──
    const rightX = 380;
    const boxWidth = 170;

    // Smart Code Box
    doc.roundedRect(rightX, 240, boxWidth, 90, 8).strokeColor('#d0eeee').lineWidth(2).stroke();
    doc.fillColor(darkTeal).font('Helvetica-Bold').fontSize(11).text('KODE PESANAN', rightX, 250, { width: boxWidth, align: 'center' });
    doc.fillColor(teal).fontSize(24).text(smartCode, rightX, 275, { width: boxWidth, align: 'center' });

    // Batch & Session Row
    const halfW = (boxWidth - 10) / 2;
    // Batch
    doc.roundedRect(rightX, 345, halfW, 90, 8).stroke();
    doc.fillColor(grayText).font('Helvetica-Bold').fontSize(10).text('Batch', rightX, 355, { width: halfW, align: 'center' });
    doc.fillColor(darkTeal).font('Helvetica-Bold').fontSize(32).text(batchNum.toString(), rightX, 385, { width: halfW, align: 'center' });
    // Session
    doc.roundedRect(rightX + halfW + 10, 345, halfW, 90, 8).stroke();
    doc.fillColor(grayText).font('Helvetica-Bold').fontSize(10).text('Sesi', rightX + halfW + 10, 355, { width: halfW, align: 'center' });
    doc.fillColor(darkTeal).font('Helvetica-Bold').fontSize(32).text(sessionNum.toString(), rightX + halfW + 10, 385, { width: halfW, align: 'center' });

    // ── FOOTER & QR ──
    const footY = 560;
    doc.rect(40, footY, 515, 1).fill('#e0eeee');

    doc.image(qrBuffer, 480, footY + 20, { width: 75 });
    doc.fillColor(darkTeal).font('Helvetica-Bold').fontSize(8).text('SCAN UNTUK VERIFIKASI', 370, footY + 50, { width: 100, align: 'right' });

    // Notes
    doc.fontSize(8).fillColor('#222').font('Helvetica-Bold');
    const noteX = 50;
    const noteY = footY + 20;
    doc.text('INFORMASI PENTING:', noteX, noteY, { underline: true });
    doc.text('• Simpan struk ini sebagai bukti sah pengambilan.', noteX, noteY + 15);
    doc.text('• Jangan bagikan Kode Pesanan Anda kepada orang lain.', noteX, noteY + 28);
    doc.text('• Info sesi pengambilan akan dikirim via grup WhatsApp.', noteX, noteY + 41);
    doc.text('• Pastikan nomor WA aktif untuk info lebih lanjut.', noteX, noteY + 54);

    // Bottom Decorative Strip
    doc.rect(0, 810, doc.page.width, 32).fill(darkTeal);
    doc.fillColor(white).font('Helvetica-Bold').fontSize(12).text('AUTHENTIC INVOICE — OSPEK RABRAW 2026', 0, 822, { align: 'center' });

    doc.end();
  });
}

/**
 * Send Invoice Email
 */
async function sendInvoiceEmail(order, pdfBuffer) {
  const waGroup = order.wa_group_url || 'https://chat.whatsapp.com/HENBjsvxRuMAq546mVfHpL';
  
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
    <style>
      body{font-family:'Poppins', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;background-color:#f4f9f9;margin:0;padding:20px;}
      .card{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(2,72,71,0.08);border:1px solid #e0eeee;}
      .header{background:#024847;padding:50px 20px;text-align:center;color:#fff;}
      .header h1{margin:0;font-size:32px;letter-spacing:3px;font-weight:700;}
      .content{padding:40px;color:#2d5c5c;}
      .badge{display:inline-block;padding:8px 20px;background:#e7f7f2;color:#1a9e6a;border-radius:99px;font-weight:700;font-size:12px;margin-bottom:25px;border:1px solid #c9ebd8;}
      h2{font-size:22px;margin-bottom:15px;color:#024847;font-weight:700;}
      p{line-height:1.7;font-size:15px;margin-bottom:20px;color:#4a6e6e;}
      .order-box{background:#f0fafa;padding:25px;border-radius:12px;border:1px dashed #24999b;margin-top:30px;text-align:center;}
      .order-label{color:#6a9999;font-size:11px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:8px;font-weight:700;}
      .order-ref{color:#24999b;font-size:20px;font-family:monospace;font-weight:700;}
      .btn-wa{display:inline-block;margin-top:20px;padding:14px 28px;background:#25D366;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;box-shadow:0 4px 15px rgba(37,211,102,0.2);}
      .footer{background:#f9fdfd;padding:25px;text-align:center;font-size:12px;color:#6a9999;border-top:1px solid #eaf5f5;}
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <h1>LOCALOGO</h1>
        <div style="font-size:12px;opacity:0.6;margin-top:10px;letter-spacing:1px;font-weight:700;">PRE-ORDER OSPEK 2026</div>
      </div>
      <div class="content">
        <div class="badge">PAYMENT SUCCESSFUL</div>
        <h2>Halo, <strong>${order.full_name}</strong>! 👋</h2>
        <p>Terima kasih telah melakukan pembayaran Down Payment. Slot kamu untuk <strong>Batch ${order.batch_num}</strong> telah resmi <strong>DIAMANKAN</strong>.</p>
        
        <div style="background:#fffbe6; padding:20px; border-radius:12px; border:1px solid #ffe58f; margin-bottom:25px;">
           <p style="margin:0; font-size:14px; color:#856404;"><strong>PENTING:</strong> Segera bergabung ke grup WhatsApp Batch ${order.batch_num} untuk informasi sesi pengambilan:</p>
           <a href="${waGroup}" class="btn-wa">Gabung Grup WhatsApp</a>
        </div>

        <p>Terlampir adalah <strong>Invoice Resmi</strong> yang berisi kode pesanan dan detail sesi pengambilan kamu. Silakan simpan dokumen ini dengan baik sebagai bukti sah.</p>
        
        <div class="order-box">
          <span class="order-label">ORDER REFERENCE</span>
          <span class="order-ref">${order.order_ref}</span>
        </div>
      </div>
      <div class="footer">
        © 2026 LOCALOGO · Malang, Indonesia<br>
        <span style="opacity:0.7">Email ini dikirim otomatis oleh sistem pendaftaran.</span>
      </div>
    </div>
  </body>
  </html>`;

  await resend.emails.send({
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to: order.email,
    subject: `SLOT SECURED: Invoice PO Perlengkapan OSPEK - ${order.full_name}`,
    html,
    attachments: [{
      filename: `Invoice-${order.full_name.replace(/\s+/g, '-')}.pdf`,
      content: pdfBuffer.toString('base64'),
    }],
  });
}

module.exports = {
  generateInvoicePDF,
  sendInvoiceEmail
};
