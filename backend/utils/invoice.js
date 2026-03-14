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
  const signature = hmac.digest('hex').substring(0, 16); // Shorten for QR density but secure enough
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
  const smartCode = `BC${romanBatch}${sessionNum}_${seq.toString().padStart(4, '0')}`;
  
  const qrData = generateSecureQrData(order.order_ref);
  const qrBuffer = await QRCode.toBuffer(qrData, { margin: 1, width: 90, color: { dark: '#000000', light: '#ffffff' } });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- COLORS & FONTS ---
    const primaryBlue = '#374151'; // Reference uses a clean dark blue/gray
    const secondaryBlue = '#60a5fa'; // Light blue accents
    const textGray = '#4b5563';
    const lightBg = '#f3f4f6';
    const accentDark = '#1e3a8a';

    // ── HEADER ──
    doc.font('Helvetica-Bold').fontSize(28).fillColor(accentDark).text('LOCALOGO', 40, 50);
    doc.font('Helvetica').fontSize(10).fillColor(textGray).text('Jl. Kertosentono No.23, Kota Malang', 40, 85);
    doc.text('localogo.id | info@localogo.id', 40, 100);

    doc.font('Helvetica-Bold').fontSize(36).fillColor(primaryBlue).text('INVOICE', 0, 50, { align: 'right', width: doc.page.width - 40 });
    
    // Line separator
    doc.moveTo(40, 125).lineTo(doc.page.width - 40, 125).lineWidth(1).strokeColor('#e5e7eb').stroke();

    // ── INVOICE INFO ──
    const infoY = 150;
    
    // Left: Invoice To
    doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryBlue).text('INVOICE TO:', 40, infoY);
    // Name block bg
    doc.rect(40, infoY + 15, 260, 24).fill(accentDark);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(order.full_name, 50, infoY + 20, { width: 240, height: 14 });
    
    doc.font('Helvetica').fontSize(10).fillColor(textGray);
    doc.text(`Email: ${order.email}`, 40, infoY + 45);
    doc.text(`WhatsApp: ${order.whatsapp}`, 40, infoY + 60);

    // Right: Details
    const rightX = doc.page.width - 240;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryBlue).text('Order Ref:', rightX, infoY, { width: 80, align: 'right' });
    doc.font('Helvetica').text(order.order_ref, rightX + 85, infoY);
    
    doc.font('Helvetica-Bold').text('Smart Code:', rightX, infoY + 20, { width: 80, align: 'right' });
    doc.font('Helvetica-Bold').fillColor(accentDark).text(smartCode, rightX + 85, infoY + 20);
    
    doc.font('Helvetica-Bold').fillColor(primaryBlue).text('Date:', rightX, infoY + 40, { width: 80, align: 'right' });
    const dateStr = order.paid_at ? new Date(order.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A';
    doc.font('Helvetica').text(dateStr, rightX + 85, infoY + 40);

    // ── TABLE ──
    const tableTop = 260;
    
    // Table Header Background
    doc.rect(40, tableTop, doc.page.width - 80, 25).fill(accentDark);
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    doc.text('ITEM DESCRIPTION', 55, tableTop + 8);
    doc.text('UNIT PRICE', 320, tableTop + 8, { width: 80, align: 'center' });
    doc.text('QUANTITY', 400, tableTop + 8, { width: 60, align: 'center' });
    doc.text('AMOUNT', 460, tableTop + 8, { width: 80, align: 'right' });

    // Table Row Background
    doc.rect(40, tableTop + 25, doc.page.width - 80, 40).fill(lightBg);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryBlue);
    doc.text('DP Paket Perlengkapan OSPEK 2026', 55, tableTop + 40);
    
    doc.font('Helvetica').fontSize(10).fillColor(textGray);
    doc.text('Rp 100,000', 320, tableTop + 40, { width: 80, align: 'center' });
    doc.text('01', 400, tableTop + 40, { width: 60, align: 'center' });
    doc.text('Rp 100,000', 460, tableTop + 40, { width: 80, align: 'right' });

    // Table divider line
    doc.moveTo(40, tableTop + 65).lineTo(doc.page.width - 40, tableTop + 65).lineWidth(1).strokeColor('#d1d5db').stroke();

    // ── TOTALS ──
    const totalsY = tableTop + 85;
    
    doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryBlue).text('SUB TOTAL', 380, totalsY);
    doc.font('Helvetica').fontSize(10).text('Rp 100,000', 460, totalsY, { width: 80, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryBlue).text('TOTAL', 380, totalsY + 25);
    doc.font('Helvetica-Bold').fontSize(16).text('Rp 100,000', 440, totalsY + 23, { width: 100, align: 'right' });

    // ── TERMS & CONDITIONS & QR ──
    const bottomY = 620;

    // T&C Box
    doc.rect(40, bottomY, 320, 100).fill(accentDark);
    // Checkbox styling for T&C
    doc.fontSize(8);
    const tc1 = 'Simpan invoice ini sebagai bukti sah saat pengambilan.';
    const tc2 = 'Jangan bagikan Kode Pesanan & QR ini kepada siapapun.';
    const tc3 = 'Info sesi penukaran diumumkan di Grup WhatsApp Batch.';
    const tc4 = 'Pembayaran bersifat final dan tidak dapat direfund.';
    
    doc.fillColor('#ffffff').font('Helvetica-Bold').text('TERMS & CONDITIONS', 55, bottomY + 15);
    doc.font('Helvetica').fontSize(7);
    
    doc.rect(55, bottomY + 35, 6, 6).fill('#ffffff');
    doc.text(tc1, 67, bottomY + 34, { width: 280 });
    
    doc.rect(55, bottomY + 50, 6, 6).fill('#ffffff');
    doc.text(tc2, 67, bottomY + 49, { width: 280 });
    
    doc.rect(55, bottomY + 65, 6, 6).fill('#ffffff');
    doc.text(tc3, 67, bottomY + 64, { width: 280 });
    
    doc.rect(55, bottomY + 80, 6, 6).fill('#ffffff');
    doc.text(tc4, 67, bottomY + 79, { width: 280 });

    // Manager / Signature Area & QR Code inside it
    doc.rect(360, bottomY, 195, 100).fill(primaryBlue);
    
    // Draw QR on the blue box
    doc.image(qrBuffer, 375, bottomY + 5, { width: 90 });
    
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('SCAN FOR', 475, bottomY + 35);
    doc.text('VERIFICATION', 475, bottomY + 47);
    
    doc.font('Helvetica').fontSize(7).text('Valid Ticket', 475, bottomY + 65);

    // Footer contact ribbon
    doc.rect(40, 750, doc.page.width - 80, 20).fill(accentDark);
    doc.fillColor('#ffffff').fontSize(7);
    doc.text('WhatsApp: +62 821-xxxx-xxxx', 50, 756);
    doc.text('Instagram: @localogo', 200, 756);
    doc.text('localogo.id', 480, 756, { width: 60, align: 'right' });

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
