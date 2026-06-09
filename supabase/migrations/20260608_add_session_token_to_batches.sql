-- Create session_links table for shared session token registration
CREATE TABLE IF NOT EXISTS session_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  batch_id uuid REFERENCES batches(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Session Link',
  max_quota int NOT NULL DEFAULT 50,
  used_count int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_session_links_token ON session_links(token);
CREATE INDEX IF NOT EXISTS idx_session_links_batch_id ON session_links(batch_id);
