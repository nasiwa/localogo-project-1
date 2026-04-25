const { createClient } = require('@supabase/supabase-js');
const s = createClient(
  'https://qbkhapuewbclazyykslr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia2hhcHVld2JjbGF6eXlrc2xyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3NzE5MCwiZXhwIjoyMDg4MzUzMTkwfQ.NgLQGtbEgjXg9gqb3Tjb7e5BOo8Mbg1DU4n5rzID6wY'
);

const BATCH_1_ID = 'e1f48e15-4468-4d28-b13e-71f88db68fed';

async function fixSequences() {
  console.log('🔧 Memulai perbaikan nomor urut Batch 1...\n');

  // STEP 1: Reset semua sequence_num jadi NULL dulu
  console.log('Step 1: Reset semua sequence_num ke NULL...');
  const { error: resetErr } = await s
    .from('orders')
    .update({ sequence_num: null })
    .eq('batch_id', BATCH_1_ID)
    .neq('status', 'paid'); // Jangan reset yang sudah paid dulu

  if (resetErr) {
    console.error('❌ Reset gagal:', resetErr.message);
    return;
  }
  console.log('✅ Semua order NON-PAID berhasil di-reset ke NULL\n');

  // STEP 2: Ambil semua order yang PAID, urutkan berdasarkan paid_at
  console.log('Step 2: Mengambil semua order PAID berdasarkan waktu konfirmasi...');
  const { data: paidOrders, error: fetchErr } = await s
    .from('orders')
    .select('id, order_ref, full_name, paid_at, sequence_num')
    .eq('batch_id', BATCH_1_ID)
    .eq('status', 'paid')
    .order('paid_at', { ascending: true });

  if (fetchErr) {
    console.error('❌ Fetch gagal:', fetchErr.message);
    return;
  }

  console.log(`📊 Ditemukan ${paidOrders.length} order yang PAID\n`);

  // STEP 3: Berikan nomor urut berdasarkan urutan paid_at
  console.log('Step 3: Memberikan nomor urut baru...');
  let updated = 0;
  for (let i = 0; i < paidOrders.length; i++) {
    const seqNum = i + 1;
    const { error: updateErr } = await s
      .from('orders')
      .update({ sequence_num: seqNum })
      .eq('id', paidOrders[i].id);

    if (updateErr) {
      console.error(`❌ Gagal update ${paidOrders[i].full_name}:`, updateErr.message);
    } else {
      updated++;
      // Log setiap 50 orang
      if (updated % 50 === 0 || updated === paidOrders.length) {
        const sesi = Math.ceil(seqNum / 200);
        console.log(`   Diproses ${updated}/${paidOrders.length}: ${paidOrders[i].full_name} → #${seqNum} (Sesi ${sesi})`);
      }
    }
  }

  console.log(`\n✅ SELESAI! ${updated} order PAID berhasil dinomori ulang.`);
  console.log('📋 Semua order yang belum bayar sudah di-reset ke NULL (tanpa nomor urut).');
  
  // Verifikasi Nazril
  const { data: nazril } = await s
    .from('orders')
    .select('full_name, sequence_num, status')
    .eq('order_ref', 'PO-OSPEK-MOAU6SA6-2BEN')
    .single();
  
  if (nazril) {
    const sesi = nazril.sequence_num ? Math.ceil(nazril.sequence_num / 200) : 'N/A';
    console.log(`\n🔍 Verifikasi Nazril: ${nazril.full_name} → #${nazril.sequence_num || 'NULL'} (Sesi ${sesi}) [${nazril.status}]`);
  }
}

fixSequences();
