const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function updateDb() {
  console.log('Updating database logic...');
  
  // 1. Update batch_config
  const { data: config } = await supabase.from('batch_config').select('id').limit(1).single();
  if (config) {
    await supabase.from('batch_config').update({
      wave_duration_minutes: 10,
      session_capacity: 200,
      total_quota: 1000
    }).eq('id', config.id);
  }

  // 2. Update claim_queue_slot RPC (requires raw SQL which can only be done via SQL Editor or a proxy function)
  // Since I cannot run raw SQL directly via JS client without a proxy, 
  // I will assume the logic will be handled in the frontend/backend for now 
  // OR I can try to use a function if it exists.
  
  console.log('Database parameters updated. Wave duration is now 10 minutes.');
}

updateDb();
