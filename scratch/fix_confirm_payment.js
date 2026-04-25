const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://qbkhapuewbclazyykslr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia2hhcHVld2JjbGF6eXlrc2xyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3NzE5MCwiZXhwIjoyMDg4MzUzMTkwfQ.NgLQGtbEgjXg9gqb3Tjb7e5BOo8Mbg1DU4n5rzID6wY');

const sql = `
CREATE OR REPLACE FUNCTION confirm_payment(p_order_ref TEXT) 
RETURNS JSON AS $$ 
DECLARE 
    v_order RECORD; 
    v_batch RECORD; 
BEGIN 
    -- 1. Ambil data order tanpa peduli status lama (kecuali sudah lunas)
    SELECT * INTO v_order FROM orders WHERE order_ref = p_order_ref; 
    
    IF NOT FOUND THEN 
        RETURN json_build_object('success', false, 'error', 'Order tidak ditemukan'); 
    END IF; 
    
    IF v_order.status = 'paid' THEN 
        RETURN json_build_object('success', false, 'error', 'Order sudah lunas'); 
    END IF; 
    
    -- 2. Update status jadi Lunas
    UPDATE orders SET status = 'paid', paid_at = NOW() WHERE order_ref = p_order_ref; 
    
    -- 3. Ambil info batch untuk kembalian data
    SELECT * INTO v_batch FROM batches WHERE id = v_order.batch_id; 
    
    RETURN json_build_object(
        'success', true, 
        'order_ref', v_order.order_ref, 
        'full_name', v_order.full_name, 
        'email', v_order.email, 
        'whatsapp', v_order.whatsapp, 
        'batch_name', v_batch.name, 
        'batch_num', 1, 
        'sequence', v_order.sequence_num, 
        'wa_group_url', v_batch.wa_group_url
    ); 
END; 
$$ LANGUAGE plpgsql SECURITY DEFINER;
`;

async function run() {
    console.log('🚀 Menghubungi database...');
    const { error } = await s.rpc('exec_sql', { sql });
    if (error) {
        console.error('❌ Gagal:', error);
    } else {
        console.log('✅ Fungsi confirm_payment BERHASIL diperbarui! Sekarang pendaftar Expired bisa dikonfirmasi.');
    }
}

run();
