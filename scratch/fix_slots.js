const { createClient } = require('@supabase/supabase-js');
const s = createClient(
  'https://qbkhapuewbclazyykslr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia2hhcHVld2JjbGF6eXlrc2xyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3NzE5MCwiZXhwIjoyMDg4MzUzMTkwfQ.NgLQGtbEgjXg9gqb3Tjb7e5BOo8Mbg1DU4n5rzID6wY'
);

async function fixSlots() {
  // 1. Cek kondisi batch sekarang
  const { data: batches } = await s.from('batches').select('*');
  console.log('=== STATUS BATCH SEKARANG ===');
  batches.forEach(b => {
    console.log(`${b.name} | total:${b.total_slots} | filled:${b.filled_slots} | pending:${b.pending_slots} | slots_left:${b.slots_left} | status:${b.status}`);
  });

  // 2. Hitung ulang slots dari tabel orders (yang benar)
  console.log('\n=== MENGHITUNG ULANG SLOT ===');
  for (const batch of batches) {
    const { count: paidCount } = await s.from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .eq('status', 'paid');

    const { count: pendingCount } = await s.from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .eq('status', 'pending');

    const newSlotsLeft = batch.total_slots - paidCount - pendingCount;

    console.log(`${batch.name} → paid:${paidCount} pending:${pendingCount} → slots_left seharusnya: ${newSlotsLeft}`);

    // 3. Update slots_left, filled_slots, pending_slots yang benar
    await s.from('batches').update({
      filled_slots: paidCount,
      pending_slots: pendingCount,
      slots_left: Math.max(0, newSlotsLeft)
    }).eq('id', batch.id);
  }

  // 4. Verifikasi setelah update
  const { data: updated } = await s.from('batches').select('name, total_slots, filled_slots, pending_slots, slots_left, status');
  console.log('\n=== STATUS BATCH SETELAH DIPERBAIKI ===');
  updated.forEach(b => {
    console.log(`${b.name} | total:${b.total_slots} | filled:${b.filled_slots} | pending:${b.pending_slots} | slots_left:${b.slots_left} | status:${b.status}`);
  });
  console.log('\n✅ Slot sudah diperbaiki!');
}

fixSlots();
