const crypto = require('crypto');
const axios = require('axios');

const merchantCode = 'DS29837';
const apiKey = '9ca3dbe15fd3655f1beb90322c980468';
const orderId = 'PO' + Date.now();
const amount = 100000;

function genSign(mCode, oId, amt, key) {
  const raw = mCode + oId + amt + key;
  return crypto.createHash('md5').update(raw).digest('hex');
}

const signature = genSign(merchantCode, orderId, amount, apiKey);

// Pay attention: NO paymentMethod here
const payload = {
    merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: 'Test Pop',
    phoneNumber: '08123456789',
    paymentMethod: 'ALL', // Testing for 'all methods' code
    callbackUrl: 'https://example.com/callback',
    returnUrl: 'https://example.com/return',
    signature: signature,
    itemDetails: [
        {
            name: 'Test Item',
            price: 100000,
            quantity: 1
        }
    ]
};

const ENDPOINT = 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

axios.post(ENDPOINT, payload)
  .then(r => console.log('OK:', r.data))
  .catch(e => console.log('ERR:', e.response?.data || e.message));
