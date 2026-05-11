-- ============================================================
-- UPDATE UNTUK SKENARIO B: SATU KODE BANYAK PENGGUNA
-- ============================================================

-- Hapus tabel lama jika sudah ada (karena strukturnya berubah total)
DROP TABLE IF EXISTS public.access_codes;

CREATE TABLE public.access_codes (
  code         TEXT PRIMARY KEY,
  max_uses     INT DEFAULT 100,      -- Batas maksimal orang per kode (sesi)
  use_count    INT DEFAULT 0,        -- Berapa kali sudah digunakan
  batch_id     UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Aktifkan RLS
ALTER TABLE public.access_codes ENABLE ROW LEVEL SECURITY;

-- No public access
CREATE POLICY "No public access" ON public.access_codes USING (false);

-- Fungsi atomic untuk menambah use_count
CREATE OR REPLACE FUNCTION public.increment_access_code(p_code TEXT)
RETURNS TABLE (success BOOLEAN, batch_id UUID) AS $$
DECLARE
  v_batch_id UUID;
BEGIN
  UPDATE public.access_codes
  SET use_count = use_count + 1
  WHERE code = p_code AND use_count < max_uses
  RETURNING access_codes.batch_id INTO v_batch_id;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_batch_id;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fungsi atomic untuk mengurangi use_count (Rollback)
CREATE OR REPLACE FUNCTION public.decrement_access_code(p_code TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE public.access_codes
  SET use_count = GREATEST(0, use_count - 1)
  WHERE code = p_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- INSERT KODE UNTUK SESI (4 SESI)
-- Ganti YOUR-BATCH-UUID dengan ID batch aktif kamu
-- ============================================================
-- INSERT INTO public.access_codes (code, max_uses, batch_id) VALUES
--   ('LCG-30APR-7X3', 100, 'YOUR-BATCH-UUID'),
--   ('LCG-30APR-9P2', 100, 'YOUR-BATCH-UUID'),
--   ('LCG-30APR-4Q8', 100, 'YOUR-BATCH-UUID'),
--   ('LCG-30APR-2M5', 100, 'YOUR-BATCH-UUID');
