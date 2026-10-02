-- Additive development-only workflow metadata.
-- No existing status, published-result history, foreign key, index, or constraint is changed.
ALTER TABLE academic_results
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  ADD COLUMN IF NOT EXISTS review_comment text,
  ADD COLUMN IF NOT EXISTS reviewed_by integer,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS email text;