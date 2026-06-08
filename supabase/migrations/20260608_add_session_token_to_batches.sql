-- Add session_token column to batches table for shared session link feature
ALTER TABLE batches ADD COLUMN IF NOT EXISTS session_token TEXT UNIQUE;
