const midtrans = require('midtrans-client');
const { createDuitkuTransaction } = require('../utils/duitku');

const snap = new midtrans.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

/**
 * Main Payment Provider Factory
 * Handles creating transactions for different gateways
 */
async function createTransaction(gateway, params) {
  const { orderRef, amount, full_name, email, whatsapp, batchName, backendUrl, frontendUrl } = params;

  if (gateway === 'manual') {
    return {
      gateway: 'manual',
      bank_info: process.env.MANUAL_BANK_INFO
    };
  }

  if (gateway === 'duitku') {
    const cleanBackendUrl = (backendUrl || '').trim().replace(/\/+$/, '');
    const cleanFrontendUrl = (frontendUrl || '').trim().replace(/\/+$/, '');
    
    const duitkuRes = await createDuitkuTransaction({
      orderId: orderRef,
      amount: amount,
      productDetails: `DP Perlengkapan OSPEK 2026 — ${batchName}`,
      email: email,
      phoneNumber: whatsapp,
      paymentMethod: 'VC', // Switched from 'QR' because 'VC' is confirmed active in your Sandbox
      callbackUrl: `${cleanBackendUrl}/api/duitku-webhook`,
      returnUrl: `${cleanFrontendUrl}/?order=${orderRef}`,
      itemDetails: [
        {
          name: `DP Perlengkapan OSPEK 2026 — ${batchName}`,
          price: 100000,
          quantity: 1
        },
        {
          name: 'Biaya Layanan',
          price: 2500,
          quantity: 1
        }
      ]
    });

    return {
      gateway: 'duitku',
      token: duitkuRes.token,
    };
  }

  // Default: Midtrans
  const midtransParams = {
    transaction_details: {
      order_id: orderRef,
      gross_amount: amount,
    },
    enabled_payments: ['qris', 'gopay', 'shopeepay', 'bca_va', 'bni_va', 'mandiri_bill', 'permata_va'],
    customer_details: {
      first_name: full_name,
      email: email,
      phone: whatsapp,
    },
    item_details: [
      {
        id: 'ospek-dp-2026',
        price: 100000,
        quantity: 1,
        name: `DP Perlengkapan OSPEK 2026 — ${batchName}`,
      },
      {
        id: 'admin-fee',
        price: 2500,
        quantity: 1,
        name: 'Biaya Layanan',
      }
    ],
    expiry: {
      unit: 'minutes',
      duration: 30,
    },
  };

  const snapResponse = await snap.createTransaction(midtransParams);
  return {
    gateway: 'midtrans',
    token: snapResponse.token,
  };
}

module.exports = {
  createTransaction,
  snap // Export snap for status checks
};
