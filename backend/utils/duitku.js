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
  const { orderId, amount, productDetails, email, callbackUrl, returnUrl, itemDetails } = params;
  
  const signature = generateRequestSignature(orderId, amount);

  const payload = {
    merchantCode: DUITKU_CONFIG.merchantCode,
    paymentAmount: amount,
    merchantOrderId: orderId,
    productDetails: productDetails,
    email: email,
    phoneNumber: params.phoneNumber || '', 
    paymentMethod: params.paymentMethod || '', // Added mandatory field
    callbackUrl: callbackUrl,
    returnUrl: returnUrl,
    signature: signature,
    itemDetails: itemDetails || [] // Added support for detailed items
  };

  try {
    const response = await axios.post(ENDPOINT, payload);
    if (response.data && response.data.resultCode && response.data.resultCode !== '00') {
      console.error('Duitku API Rejection:', response.data);
      const errorMsg = response.data.statusMessage || response.data.Message || 'Ditolak oleh Duitku';
      throw new Error(errorMsg);
    }
    return response.data; 
  } catch (error) {
    // Catch Axios errors or our custom throw
    const remoteData = error.response?.data;
    // Duitku V2 often uses statusMessage, reference, or Message
    const remoteMsg = remoteData?.statusMessage || remoteData?.Message || remoteData?.reference || remoteData?.message || error.message;
    console.error('Duitku Inquiry Error:', remoteData || error.message);
    throw new Error(remoteMsg);
  }
}

module.exports = {
  createDuitkuTransaction,
  generateCallbackSignature
};
