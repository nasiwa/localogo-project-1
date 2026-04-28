const { adminSupabase } = require('./backend/supabaseClient');
require('dotenv').config({ path: './backend/.env' });

async function deleteSpecificOrder() {
  const orderRef = 'MANUAL-MOGN4XLT';
  console.log(`🧹 Menghapus data order: ${orderRef}...`);

  try {
    const { error } = await adminSupabase
      .from('orders')
      .delete()
      .eq('order_ref', orderRef);

    if (error) {
      console.error("❌ Gagal menghapus:", error);
    } else {
      console.log(`✅ Data ${orderRef} BERHASIL dihapus dari tabel orders.`);
    }
  } catch (e) {
    console.error("CRITICAL ERROR:", e);
  }
}

deleteSpecificOrder();
