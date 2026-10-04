-- Parent-level defaults do not replace authoritative per-child relationships.
-- Nullable additions preserve existing records without guessing lost choices.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS default_relationship_type text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;