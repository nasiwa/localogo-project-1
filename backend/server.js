require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ── APP INITIALIZATION ───────────────────────────────────────────
const app = express();

// ── CLIENTS (Centrally managed) ──────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Pass clients to routers via app.set
app.set('clients', { supabase });

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── ROUTES ───────────────────────────────────────────────────────
const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

app.use('/api', clientRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', webhookRoutes); // Webhooks are /api/midtrans-webhook etc.

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ── SERVER BOOT ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 LOCALOGO Modular Backend running on port ${PORT}`);
    console.log(`   Mode: ${process.env.PAYMENT_GATEWAY?.toUpperCase() || 'MIDTRANS'} ACTIVE`);
  });
}

module.exports = app;
