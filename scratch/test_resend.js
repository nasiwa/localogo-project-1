const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function testResend() {
  console.log('🔑 API Key:', process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 10) + '...' : 'TIDAK ADA!');
  console.log('📧 From:', process.env.EMAIL_FROM);
  console.log('📛 From Name:', process.env.EMAIL_FROM_NAME);
  console.log('\n🚀 Mencoba kirim email test...\n');

  try {
    const { data, error } = await resend.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_FROM, // Kirim ke diri sendiri sebagai test
      subject: '✅ Test Koneksi Resend - LOCALOGO',
      html: `
        <div style="font-family:sans-serif;padding:30px;background:#f0fafa;border-radius:12px;max-width:500px;margin:auto">
          <h2 style="color:#024847">✅ Resend Berhasil Terhubung!</h2>
          <p>API Key baru sudah aktif dan berfungsi dengan sempurna.</p>
          <p style="color:#666;font-size:12px">Dikirim pada: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>
        </div>
      `
    });

    if (error) {
      console.error('❌ GAGAL:', JSON.stringify(error, null, 2));
    } else {
      console.log('✅ SUKSES! Email test berhasil dikirim!');
      console.log('📨 Email ID:', data.id);
      console.log('\n🎉 Resend sudah terhubung SEMPURNA dan siap digunakan!');
    }
  } catch (e) {
    console.error('❌ ERROR:', e.message);
  }
}

testResend();
