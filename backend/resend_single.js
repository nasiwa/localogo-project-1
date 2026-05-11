require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { generateInvoicePDF, sendInvoiceEmail } = require('./utils/invoice');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const targetEmail = process.argv[2];

if (!targetEmail) {
  console.log('Usage: node resend_single.js <email_address>');
  process.exit(1);
}

async function resend() {
  console.log(`🔍 Mencari data untuk: ${targetEmail}...`);
  
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, batches(name, wa_group_url)')
    .eq('email', targetEmail)
    .single();

  if (error || !order) {
    console.error('❌ Data tidak ditemukan:', error?.message || 'Email tidak terdaftar');
    return;
  }

  try {
    // Tentukan batch_num (biasanya ada di nama batch atau kolom lain)
    const batchNum = order.batches?.name.match(/\d+/) ? parseInt(order.batches.name.match(/\d+/)[0]) : 1;

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
      amount: order.amount
    };

    console.log('📄 Generating PDF...');
    const pdfBuffer = await generateInvoicePDF(orderInfo);
    
    console.log('📧 Mengirim Email...');
    await sendInvoiceEmail(orderInfo, pdfBuffer);
    
    console.log(`✅ BERHASIL! Email telah dikirim ulang ke ${targetEmail}`);
  } catch (err) {
    console.error('❌ Gagal kirim email:', err.message);
  }
}

resend();
