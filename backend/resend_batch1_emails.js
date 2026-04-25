const { createClient } = require('@supabase/supabase-js');
const { generateInvoicePDF, sendInvoiceEmail } = require('./utils/invoice');

const s = createClient(
  'https://qbkhapuewbclazyykslr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia2hhcHVld2JjbGF6eXlrc2xyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3NzE5MCwiZXhwIjoyMDg4MzUzMTkwfQ.NgLQGtbEgjXg9gqb3Tjb7e5BOo8Mbg1DU4n5rzID6wY'
);

const BATCH_1_ID = 'e1f48e15-4468-4d28-b13e-71f88db68fed';

async function resendAllEmails() {
  console.log('📧 MEMULAI PENGIRIMAN ULANG EMAIL KE SELURUH BATCH 1...\n');

  // Ambil semua order PAID beserta info batch
  const { data: orders, error } = await s
    .from('orders')
    .select('*, batches(name, wa_group_url)')
    .eq('batch_id', BATCH_1_ID)
    .eq('status', 'paid')
    .order('sequence_num', { ascending: true });

  if (error) {
    console.error('❌ Gagal ambil data:', error.message);
    return;
  }

  console.log(`📊 Total ${orders.length} orang akan menerima email koreksi.\n`);
  console.log('⚠️  Email koreksi ini akan memiliki subject yang berbeda agar tidak membingungkan.\n');

  let success = 0;
  let failed = 0;
  const failedList = [];

  for (const order of orders) {
    try {
      const sesi = Math.ceil((order.sequence_num || 1) / 200);
      const batchNum = 1; // Batch 1

      const orderInfo = {
        order_ref: order.order_ref,
        full_name: order.full_name,
        email: order.email,
        whatsapp: order.whatsapp || 'N/A',
        batch_name: order.batches?.name || 'Batch 1',
        batch_num: batchNum,
        sequence: order.sequence_num,
        wa_group_url: order.batches?.wa_group_url,
        paid_at: order.paid_at || order.created_at,
      };

      // Generate PDF baru dengan nomor yang benar
      const pdfBuffer = await generateInvoicePDF(orderInfo);
      
      // Kirim email dengan subject KOREKSI agar tidak membingungkan
      const seq = order.sequence_num;
      const sesiLabel = Math.ceil(seq / 200);
      
      // Override sendInvoiceEmail subject dengan custom subject
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      // Generate HTML sama seperti sendInvoiceEmail tapi subject berbeda
      await resend.emails.send({
        from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
        to: order.email,
        subject: `[KOREKSI INVOICE] Nomor Antrian & Sesi Kamu — ${order.full_name}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0eeee;">
            <div style="background:#024847;padding:40px 20px;text-align:center;color:#fff;">
              <h1 style="margin:0;font-size:28px;letter-spacing:3px;">LOCALOGO</h1>
              <div style="font-size:11px;opacity:0.6;margin-top:8px;">PRE-ORDER OSPEK 2026</div>
            </div>
            <div style="padding:35px;color:#2d5c5c;">
              <div style="background:#fff3cd;padding:15px;border-radius:8px;border:1px solid #ffc107;margin-bottom:25px;">
                <strong style="color:#856404;">📋 KOREKSI INVOICE</strong><br>
                <span style="font-size:13px;color:#856404;">Kami mengirimkan invoice terbaru ini untuk menggantikan invoice sebelumnya. Mohon gunakan invoice terbaru ini sebagai dokumen resmi.</span>
              </div>
              <h2 style="color:#024847;">Halo, <strong>${order.full_name}</strong>! 👋</h2>
              <p style="color:#4a6e6e;line-height:1.7;">Invoice kamu telah diperbarui. Nomor antrean dan sesi pengambilan di bawah ini adalah yang <strong>RESMI dan BENAR</strong>.</p>
              <div style="background:#f0fafa;padding:25px;border-radius:12px;border:1px dashed #24999b;text-align:center;margin:20px 0;">
                <div style="font-size:11px;color:#6a9999;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Nomor Antrean Resmi</div>
                <div style="font-size:42px;font-weight:700;color:#024847;">${String(seq).padStart(4,'0')}</div>
                <div style="margin-top:10px;font-size:14px;color:#24999b;font-weight:700;">Sesi ${sesiLabel} · Batch 1</div>
              </div>
              <p style="color:#4a6e6e;line-height:1.7;">Invoice PDF terbaru (dengan nomor yang benar) terlampir pada email ini.</p>
              ${order.batches?.wa_group_url ? `<a href="${order.batches.wa_group_url}" style="display:inline-block;padding:12px 24px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Gabung Grup WhatsApp</a>` : ''}
            </div>
            <div style="background:#f9fdfd;padding:20px;text-align:center;font-size:12px;color:#6a9999;border-top:1px solid #eaf5f5;">
              © 2026 LOCALOGO · Malang, Indonesia
            </div>
          </div>
        `,
        attachments: [{
          filename: `Invoice-KOREKSI-${order.full_name.replace(/\s+/g, '-')}.pdf`,
          content: pdfBuffer.toString('base64'),
        }],
      });

      success++;
      console.log(`   ✅ [${success}/${orders.length}] ${order.full_name} → #${order.sequence_num} Sesi ${sesi}`);

      // Jeda kecil agar tidak membanjiri server email
      await new Promise(r => setTimeout(r, 300));

    } catch (e) {
      failed++;
      failedList.push({ name: order.full_name, email: order.email, error: e.message });
      console.error(`   ❌ GAGAL: ${order.full_name} (${order.email}) — ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ BERHASIL DIKIRIM: ${success} orang`);
  console.log(`❌ GAGAL: ${failed} orang`);
  
  if (failedList.length > 0) {
    console.log('\nDaftar yang GAGAL:');
    failedList.forEach(f => console.log(`  - ${f.name} (${f.email}): ${f.error}`));
  }
  
  console.log('='.repeat(60));
  console.log('\n🎉 SELESAI! Semua peserta sudah mendapatkan email koreksi.');
}

resendAllEmails();
