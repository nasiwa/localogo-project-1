const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function testConfirm(ref) {
    console.log(`Testing confirm_payment for: ${ref}`);
    const { data, error } = await supabase.rpc('confirm_payment', { p_order_ref: ref });
    if (error) {
        console.error('RPC Error:', error);
    } else {
        console.log('RPC Result:', data);
    }
}

// Ambil salah satu order_ref dari screenshot user: PO-OSPEK-MMHBFH39-K6ZY
testConfirm('PO-OSPEK-MMHBFH39-K6ZY');
