const crypto = require('crypto');
const axios = require('axios');

const merchantCode = 'DS29837';
const apiKey = '9ca3dbe15fd3655f1beb90322c980468';
const orderId = 'TEST' + Date.now();
const amount = 10000; // Small amount

function genSign(mCode, oId, amt, key) {
  const raw = mCode + oId + amt + key;
  return crypto.createHash('md5').update(raw).digest('hex');
}

const signature = genSign(merchantCode, orderId, amount, apiKey);

const payload = {
    merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: 'Test',
    email: 'test@mail.com',
    paymentMethod: '', // Testing if empty string is accepted for Pop
    callbackUrl: 'https://example.com/callback',
    returnUrl: 'https://example.com/return',
    signature: signature
};

const ENDPOINT = 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

axios.post(ENDPOINT, payload)
  .then(r => console.log('OK:', r.data))
  .catch(e => console.log('ERR:', e.response?.data || e.message));
