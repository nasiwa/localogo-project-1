const axios = require('axios');

const BACKEND_URL = 'https://localogo.id';
const BATCH_ID = '7afa8a7d-430a-4a35-9ca4-9c00a9f7726e'; // Batch 2

async function sendBatch(batchNum) {
    console.log(`\n🌊 GELOMBANG ${batchNum} MENYERBU FORM (10 Orang)...`);
    const promises = [];
    for (let i = 1; i <= 10; i++) {
        const id = (batchNum - 1) * 10 + i;
        promises.push(axios.post(`${BACKEND_URL}/api/create-order`, {
            batch_id: BATCH_ID,
            full_name: `Simulasi War #${id}`,
            email: `war_${Date.now()}_${id}@example.com`,
            whatsapp: `08${Date.now().toString().slice(-8)}${id}`,
            payment_method: 'manual'
        }).then(r => {
            if (r.data.success) {
                console.log(`   ✅ User #${id} Berhasil (Order: ${r.data.order_ref})`);
            } else {
                console.error(`   ❌ User #${id} GAGAL: ${r.data.error || 'Unknown error'}`);
            }
        }).catch(e => {
            const msg = e.response ? JSON.stringify(e.response.data) : e.message;
            console.error(`   ❌ User #${id} ERROR: ${msg}`);
        }));
    }
    await Promise.all(promises);
    console.log(`🏁 GELOMBANG ${batchNum} SELESAI. Menunggu 5 menit untuk gelombang berikutnya...`);
}

async function runRealWar() {
    console.log('🚀 MEMULAI SIMULASI WAR REAL-TIME (10 Orang / 5 Menit)');
    let currentBatch = 1;
    while (currentBatch <= 10) {
        await sendBatch(currentBatch);
        currentBatch++;
        if (currentBatch <= 10) {
            await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // Tunggu 5 menit
        }
    }
}

runRealWar();
