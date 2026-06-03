-- Add email column to slot_queue table
ALTER TABLE slot_queue ADD COLUMN IF NOT EXISTS email text;
