require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
    console.log("Checking/Creating PUBLIC access code...");
    
    // UPSERT a public code with 10,000 uses
    const { data, error } = await supabase
        .from('access_codes')
        .upsert({
            code: 'PUBLIC',
            max_uses: 10000,
            use_count: 0,
            batch_id: 'e1f48e15-4468-4d28-b13e-71f88db68fed'
        }, { onConflict: 'code' })
        .select();

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Success:", data);
    }
}

run();
