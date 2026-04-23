const axios = require('axios');

const BACKEND_URL = 'https://localogo.id';
const BATCH_ID = '7afa8a7d-430a-4a35-9ca4-9c00a9f7726e'; // ID Batch 2

async function simulateOrder(i) {
    const payload = {
        batch_id: BATCH_ID,
        full_name: `Stress Test User ${i}`,
        email: `stress_test_${Date.now()}_${i}@example.com`,
        whatsapp: `0812345678${i}`,
        payment_method: 'manual'
    };

    try {
        const start = Date.now();
        const res = await axios.post(`${BACKEND_URL}/api/create-order`, payload);
        const end = Date.now();
        console.log(`[Order ${i}] ✅ BERHASIL (${end - start}ms) - ID: ${res.data.order.order_ref}`);
    } catch (e) {
        const errMsg = e.response ? JSON.stringify(e.response.data) : e.message;
        console.error(`[Order ${i}] ❌ GAGAL: ${errMsg}`);
    }
}

async function runTest() {
    console.log('🚀 MEMULAI STRESS TEST: 100 Pesanan (10 gelombang x 10 orang)...');
    
    for (let batch = 1; batch <= 10; batch++) {
        console.log(`\n📦 GELOMBANG ${batch} DIMULAI...`);
        const promises = [];
        for (let i = 1; i <= 10; i++) {
            const orderNum = (batch - 1) * 10 + i;
            promises.push(simulateOrder(orderNum));
            await new Promise(r => setTimeout(r, 200)); // Jeda antar orang 0.2 detik
        }
        await Promise.all(promises);
        console.log(`✅ GELOMBANG ${batch} SELESAI. Menunggu 2 detik...`);
        await new Promise(r => setTimeout(r, 2000)); // Istirahat antar gelombang
    }
    
    console.log('\n🏁 STRESS TEST 100 PESANAN SELESAI.');
}

runTest();
