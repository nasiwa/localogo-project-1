-- ============================================================
-- SLOT QUEUE TABLE — untuk sistem WAR registration
-- Jalankan ini di Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS slot_queue (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name        text NOT NULL,
  whatsapp         text NOT NULL,
  batch_id         uuid REFERENCES batches(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'waiting',
  -- status: 'waiting' | 'allocated' | 'registered' | 'expired'
  token            text UNIQUE,
  token_expires_at timestamptz,
  token_used_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Index untuk query performa tinggi
CREATE INDEX IF NOT EXISTS idx_slot_queue_status_created  ON slot_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_slot_queue_token           ON slot_queue(token);
CREATE INDEX IF NOT EXISTS idx_slot_queue_batch_wa        ON slot_queue(batch_id, whatsapp);

-- RLS: Hanya backend (service role) yang bisa akses
ALTER TABLE slot_queue ENABLE ROW LEVEL SECURITY;

-- Policy: service role bypass RLS otomatis, block semua akses public
CREATE POLICY "No public access" ON slot_queue
  FOR ALL TO anon USING (false);
