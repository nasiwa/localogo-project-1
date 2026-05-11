-- ============================================================
-- JALANKAN INI DI SUPABASE SQL EDITOR
-- ============================================================

-- Buat tabel access_codes untuk sistem kode unik
CREATE TABLE IF NOT EXISTS public.access_codes (
  code         TEXT PRIMARY KEY,
  is_used      BOOLEAN DEFAULT false,
  used_at      TIMESTAMPTZ,
  batch_id     UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Aktifkan RLS agar hanya service role yang bisa akses langsung
ALTER TABLE public.access_codes ENABLE ROW LEVEL SECURITY;

-- Tolak semua akses publik (frontend hanya akses via API backend)
CREATE POLICY "No public access" ON public.access_codes
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- CONTOH: Insert kode untuk testing
-- Ganti batch_id dengan UUID batch aktif kamu
-- ============================================================
-- INSERT INTO public.access_codes (code, batch_id) VALUES
--   ('BATCH1-TEST1', 'YOUR-BATCH-UUID-HERE'),
--   ('BATCH1-TEST2', 'YOUR-BATCH-UUID-HERE'),
--   ('BATCH1-TEST3', 'YOUR-BATCH-UUID-HERE');
