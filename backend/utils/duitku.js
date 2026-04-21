const axios = require('axios');
const crypto = require('crypto');

const DUITKU_CONFIG = {
  merchantCode: process.env.DUITKU_MERCHANT_CODE,
  apiKey: process.env.DUITKU_API_KEY,
  isProduction: process.env.DUITKU_IS_PRODUCTION === 'true',
};

const ENDPOINT = DUITKU_CONFIG.isProduction
  ? 'https://passport.duitku.com/webapi/api/merchant/v2/inquiry'
  : 'https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry';

/**
 * Generate Duitku Request Signature
 * formula: md5(merchantCode + orderId + amount + apiKey)
 */
function generateRequestSignature(orderId, amount) {
  const raw = DUITKU_CONFIG.merchantCode + orderId + amount + DUITKU_CONFIG.apiKey;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Generate Duitku Callback Signature
 * formula: md5(merchantCode + amount + merchantOrderId + apiKey)
 */
function generateCallbackSignature(amount, merchantOrderId) {
  const raw = DUITKU_CONFIG.merchantCode + amount + merchantOrderId + DUITKU_CONFIG.apiKey;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Request Payment Token from Duitku (Inquiry)
 */
async function createDuitkuTransaction(params) {
  const { orderId, amount, productDetails, email, callbackUrl, returnUrl } = params;
  
  const signature = generateRequestSignature(orderId, amount);

  const payload = {
    merchantCode: DUITKU_CONFIG.merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: productDetails,
    email: email,
    phoneNumber: params.phoneNumber || '', // Added
    customerDetail: params.customerName || email, // Added
    callbackUrl: callbackUrl,
    returnUrl: returnUrl,
    signature: signature,
  };

  try {
    const response = await axios.post(ENDPOINT, payload);
    if (response.data && response.data.resultCode !== '00') {
      console.error('Duitku API Rejection:', response.data);
      throw new Error(response.data.message || 'Ditolak oleh Duitku');
    }
    return response.data; 
  } catch (error) {
    console.error('Duitku Inquiry Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Gagal membuat transaksi Duitku');
  }
}

module.exports = {
  createDuitkuTransaction,
  generateCallbackSignature
};
