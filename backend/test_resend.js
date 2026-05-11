require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function testEmail() {
  console.log('--- TESTING RESEND API KEY ---');
  console.log('Using Key:', process.env.RESEND_API_KEY.substring(0, 10) + '...');
  
  try {
    const { data, error } = await resend.emails.send({
      from: 'Localogo <admin@localogo.id>',
      to: ['hellosiwaa@gmail.com'], // Kirim ke email Anda untuk tes
      subject: 'Tes Sistem Email Localogo 🚀',
      html: '<strong>Sistem email berhasil terhubung!</strong><br>API Key baru Anda sudah aktif dan bisa digunakan.'
    });

    if (error) {
      console.error('❌ Gagal kirim email:', error);
    } else {
      console.log('✅ Email berhasil terkirim! ID:', data.id);
    }
  } catch (err) {
    console.error('💥 Error sistem:', err.message);
  }
}

testEmail();
