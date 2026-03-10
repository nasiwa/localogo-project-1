# LOKALOGO OSPEK Pre-Order — Setup Guide

## Struktur File
```
Localogo-Project/
├── public/
│   ├── index.html      ← Halaman booking publik
│   └── admin.html      ← Dashboard admin
├── backend/
│   ├── server.js       ← Express + Midtrans + Resend
│   ├── package.json
│   └── .env.example    ← Copy jadi .env & isi
├── supabase/
│   └── schema.sql      ← Jalankan di Supabase SQL Editor
└── README.md
```

---

## STEP 1 — Setup Supabase

1. Buat project baru di https://supabase.com
2. Masuk ke **SQL Editor**
3. Copy seluruh isi `supabase/schema.sql` → Run
4. Masuk ke **Authentication → Providers → Google**
   - Enable Google OAuth
   - Masukkan Client ID & Secret dari Google Cloud Console
   - Tambah redirect URL: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
5. Masuk ke **Authentication → URL Configuration**
   - Site URL: URL hosting kamu (atau `http://localhost:5500`)
6. Insert email admin kamu di SQL Editor:
   ```sql
   INSERT INTO admin_users (email) VALUES ('emailkamu@gmail.com');
   ```
7. Catat:
   - Project URL: `https://XXXX.supabase.co`
   - Anon Key (Settings → API)
   - Service Role Key (Settings → API) ← **JANGAN expose ke publik!**

---

## STEP 2 — Setup Midtrans

1. Daftar / login di https://dashboard.midtrans.com
2. Pilih mode **Sandbox** dulu untuk testing
3. Settings → Access Keys → catat:
   - **Server Key**: `SB-Mid-server-XXXX`
   - **Client Key**: `SB-Mid-client-XXXX`
4. Settings → **Snap Preferences**:
   - Payment Methods: centang QRIS, GoPay, ShopeePay, BCA VA, BNI VA, Mandiri
5. Settings → **Configuration**:
   - Payment Notification URL: `https://your-backend.com/api/midtrans-webhook`
   - Finish/Unfinish/Error Redirect URL: URL halaman index.html kamu

---

## STEP 3 — Setup Resend (Email)

1. Daftar di https://resend.com
2. Domains → Add domain kamu (atau pakai domain bawaan untuk testing)
3. API Keys → Create → catat key-nya
4. Email dari harus pakai domain yang sudah diverifikasi

---

## STEP 4 — Setup Backend

```bash
cd backend
cp .env.example .env
# Edit .env dengan semua key yang sudah dikumpulkan

npm install
npm start
# Backend jalan di http://localhost:3001
```

Isi `.env`:
```env
SUPABASE_URL=https://XXXX.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...   # SERVICE ROLE key, bukan anon!
MIDTRANS_SERVER_KEY=SB-Mid-server-XXXX
MIDTRANS_CLIENT_KEY=SB-Mid-client-XXXX
MIDTRANS_IS_PRODUCTION=false
RESEND_API_KEY=re_XXXX
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Lokalogo OSPEK 2026
PORT=3001
FRONTEND_URL=http://localhost:5500
```

---

## STEP 5 — Update Frontend Config

Di **index.html** dan **admin.html**, update bagian ini:
```html
<script>
  const SUPABASE_URL    = 'https://XXXX.supabase.co';   // dari Supabase
  const SUPABASE_ANON   = 'eyJhbGci...';                 // ANON key
  const BACKEND_URL     = 'http://localhost:3001';        // atau URL backend deploy
  const MIDTRANS_CLIENT = 'SB-Mid-client-XXXX';          // client key
</script>
```

---

## STEP 6 — Testing

1. Buka `index.html` di browser (pakai Live Server VS Code atau http-server)
2. Isi form → klik Lanjut ke Pembayaran
3. Di Midtrans Snap (sandbox), gunakan:
   - QRIS: screenshot QR, bayar lewat aplikasi GoPay simulator
   - VA: pakai nomor VA yang muncul, bayar via Midtrans simulator
4. Cek email — invoice PDF harusnya masuk
5. Cek Supabase → Table `orders` → status harus berubah ke `paid`
6. Buka `admin.html` → login Google → kelola batch

---

## Cara Kelola Batch (Admin)

| Status  | Artinya                                        |
|---------|------------------------------------------------|
| hidden  | Tidak terlihat publik sama sekali              |
| active  | Terlihat & bisa dipesan                        |
| closed  | Penuh / ditutup, tidak bisa dipesan            |

**Reveal Otomatis:**
- Set tanggal & waktu di field "Reveal At" pada modal Edit Batch
- Sistem akan otomatis ubah status ke `active` pada waktu tersebut
- Fungsi `auto_reveal_batches()` dipanggil setiap ada request `/api/batches`

**Flow yang direkomendasikan:**
1. Buat 5 batch, semua `hidden`
2. Set Batch 1 → `active` (atau set reveal_at ke tanggal buka pendaftaran)
3. Saat Batch 1 penuh (otomatis closed oleh sistem), set Batch 2 reveal_at ke waktu yang diinginkan
4. Batch 2 otomatis muncul ke publik pada waktu yang ditentukan

---

## Deploy ke Production

### Backend → Railway / Render / Fly.io
```bash
# Railway
npm install -g @railway/cli
railway login
railway init
railway up
# Set env vars di Railway dashboard
```

### Frontend → Vercel / Netlify / GitHub Pages
- Upload folder `public/` ke Vercel/Netlify
- Update `BACKEND_URL` di HTML ke URL Railway/Render

### Midtrans Production
- Ganti `MIDTRANS_IS_PRODUCTION=true`
- Ganti ke Live Key di Midtrans dashboard
- Ganti Snap.js URL: `app.sandbox.midtrans.com` → `app.midtrans.com`
- Update Notification URL ke URL backend production

---

## Concurrency Safety

Sistem menggunakan PostgreSQL `FOR UPDATE` + transaction melalui Supabase RPC:

```
100 user klik "Bayar" bersamaan
         ↓
Backend panggil RPC claim_slot()
         ↓
PostgreSQL lock baris batch (FOR UPDATE)
         ↓
Request antri satu per satu
         ↓
Jika slot tersedia → insert order pending
Jika slot habis → return error "Slot penuh"
         ↓
Midtrans webhook → confirm_payment() RPC
         ↓
Deduct filled_slots + mark order paid + send email
```

Tidak ada double-booking meskipun 1000 user klik bersamaan.
