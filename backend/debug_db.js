const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkOrders() {
    const { data, error } = await supabase.from('orders').select('*, batches(name)').limit(10);
    if (error) {
        console.error('Error fetching orders:', error);
    } else {
        console.log('Orders found:', data.length);
        console.log(JSON.stringify(data, null, 2));
    }
}

checkOrders();
