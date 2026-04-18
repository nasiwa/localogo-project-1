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
    callbackUrl: callbackUrl,
    returnUrl: returnUrl,
    signature: signature,
    // Note: Duitku V2 Inquiry can take more params, but these are essential for Pop
  };

  try {
    const response = await axios.post(ENDPOINT, payload);
    return response.data; // Should contain { token, paymentUrl, ... }
  } catch (error) {
    console.error('Duitku Inquiry Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Gagal membuat transaksi Duitku');
  }
}

module.exports = {
  createDuitkuTransaction,
  generateCallbackSignature
};
