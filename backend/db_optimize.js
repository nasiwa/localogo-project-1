require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const sql = `
-- 1. Tambahkan Index agar pencarian WA super cepat
CREATE INDEX IF NOT EXISTS idx_orders_wa_batch ON orders(whatsapp, batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_batch ON orders(status, batch_id);

-- 2. TULIS ULANG FUNGSI claim_slot (VERSI RAMPING & CEPAT)
CREATE OR REPLACE FUNCTION claim_slot(
  p_batch_id uuid, 
  p_order_ref text, 
  p_name text, 
  p_email text, 
  p_wa text, 
  p_amount int
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_name    text;
  v_total_slots   int;
  v_filled_slots  int;
  v_pending_slots int;
  v_order_id      uuid;
  v_existing_id   uuid;
BEGIN
  -- A. LOCK BARIS BATCH (Antrean rapi, tidak ada tabrakan kuota)
  SELECT name, total_slots, filled_slots 
  INTO v_batch_name, v_total_slots, v_filled_slots
  FROM batches
  WHERE id = p_batch_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Batch tidak tersedia atau sudah penuh');
  END IF;

  -- B. CEK DUPLIKAT (Cepat karena ada index)
  SELECT id INTO v_existing_id
  FROM orders
  WHERE batch_id = p_batch_id AND whatsapp = p_wa AND status IN ('paid', 'pending')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', '⚠️ Nomor WhatsApp ini sudah terdaftar di Batch ini.');
  END IF;

  -- C. HITUNG KUOTA TERSISA (Tanpa pembersihan massal yang bikin lemot)
  SELECT count(*) INTO v_pending_slots
  FROM orders
  WHERE batch_id = p_batch_id AND status = 'pending';

  IF (v_filled_slots + v_pending_slots) >= v_total_slots THEN
    RETURN json_build_object('success', false, 'error', 'Maaf, slot baru saja habis dibooking orang lain.');
  END IF;

  -- D. INSERT PESANAN
  INSERT INTO orders (order_ref, batch_id, full_name, email, whatsapp, amount)
  VALUES (p_order_ref, p_batch_id, p_name, p_email, p_wa, p_amount)
  RETURNING id INTO v_order_id;
  
  RETURN json_build_object(
    'success', true, 
    'id', v_order_id,
    'batch_name', v_batch_name
  );
END;
$$;
`;

supabase.rpc('exec_sql', { sql }).then(r => {
    console.log('Database claim_slot optimized:', r);
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
