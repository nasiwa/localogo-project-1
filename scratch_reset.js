const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') }); 
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("❌ ERROR: File .env tidak ditemukan di folder /backend atau isinya kosong!");
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function resetSystem() {
  console.log("🧹 Memulai Mantra Reset Total...");
  const emailsToClear = [
    'nasywadivianastasya@gmail.com',
    'nasivvati@student.ub.ac.id',
    'hellosiwaa@gmail.com',
    'localogo01@gmail.com'
  ];

  try {
    const { error: err1 } = await supabase.from('batch_config').update({ issued_queue_numbers: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
    if (err1) console.error("Gagal reset counter:", err1);
    else console.log("✅ Counter antrean sudah balik ke 0.");

    const { error: err2 } = await supabase.from('queue_slots').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err2) console.error("Gagal hapus queue_slots:", err2);
    else console.log("✅ Semua antrean percobaan sudah dihapus.");

    const { error: err3 } = await supabase.from('orders').delete().in('email', emailsToClear);
    if (err3) console.error("Gagal hapus data orders:", err3);
    else console.log("✅ Email tester sudah bersih dari tabel Orders.");

    console.log("\n✨ MANTRA SELESAI! Silakan Refresh halaman User dan Login lagi.");
  } catch (e) { console.error("CRITICAL ERROR:", e); }
}

resetSystem();
