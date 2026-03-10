require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function testEmail() {
  try {
    console.log('Testing Resend with API Key:', process.env.RESEND_API_KEY ? 'Present' : 'Missing');
    console.log('From:', process.env.EMAIL_FROM);
    
    const { data, error } = await resend.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: 'nasywadivianastasya@gmail.com', // Using the email from the user's screenshot
      subject: 'Test Email Localogo',
      html: '<h1>Test Berhasil</h1><p>Jika kamu menerima email ini, berarti API Resend sudah oke.</p>'
    });

    if (error) {
      console.error('Resend Error:', error);
    } else {
      console.log('Email sent successfully:', data);
    }
  } catch (err) {
    console.error('Script Error:', err);
  }
}

testEmail();
