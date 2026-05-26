require('dotenv').config();
const { adminSupabase } = require('./backend/supabaseClient');

const orderRef = 'PO-OSPEK-MOAXM349-ZJXN';

async function deleteOrder() {
  console.log(`Attempting to delete order: ${orderRef}`);
  
  const { data, error } = await adminSupabase
    .from('orders')
    .delete()
    .eq('order_ref', orderRef)
    .select();

  if (error) {
    console.error('Error deleting order:', error);
    process.exit(1);
  }

  if (data && data.length > 0) {
    console.log('Order deleted successfully:', data);
  } else {
    console.log('No order found with that reference.');
  }
}

deleteOrder();
