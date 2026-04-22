const crypto = require('crypto');
const axios = require('axios');

const merchantCode = 'DS29837';
const apiKey = '9ca3dbe15fd3655f1beb90322c980468';
const orderId = 'TEST-ORDER-' + Date.now();
const amount = 102500;

function generateRequestSignature(orderId, amount) {
  const raw = merchantCode + orderId + amount + apiKey;
  console.log('Signature Raw String:', raw);
  return crypto.createHash('md5').update(raw).digest('hex');
}

const signature = generateRequestSignature(orderId, amount);
console.log('Signature:', signature);

const payload = {
    merchantCode: merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: 'Test Product OSPEK',
    email: 'test@example.com',
    phoneNumber: '08123456789',
    paymentMethod: '', // Mandatory but can be empty for Pop
    callbackUrl: 'https://www.localogo.id/api/duitku-webhook',
    returnUrl: 'https://www.localogo.id/?order=' + orderId,
    signature: signature,
    itemDetails: [
        {
            name: 'Test Product OSPEK',
            price: 100000,
            quantity: 1
        },
        {
            name: 'Service Fee',
            price: 2500,
            quantity: 1
        }
    ]
};

const ENDPOINT = 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

axios.post(ENDPOINT, payload)
  .then(response => {
    console.log('SUCCESS Response:', response.data);
  })
  .catch(error => {
    console.error('ERROR Status:', error.response?.status);
    console.error('ERROR Body:', JSON.stringify(error.response?.data, null, 2));
  });
