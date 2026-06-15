-- Menambahkan kolom allowed_emails (JSONB) ke tabel session_links
-- Berfungsi untuk membatasi pendaftaran hanya untuk email tertentu (Opsi 2)
ALTER TABLE IF EXISTS public.session_links
ADD COLUMN IF NOT EXISTS allowed_emails JSONB DEFAULT NULL;

-- Menambahkan comment untuk dokumentasi
COMMENT ON COLUMN public.session_links.allowed_emails IS 'Daftar email yang diizinkan mendaftar menggunakan token ini. Kosong berarti bebas.';
