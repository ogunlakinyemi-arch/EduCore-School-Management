-- REVIEW DRAFT ONLY. Not applied to Development or Production.
-- Adds one permitted audience without rewriting any historical event or SQL.
-- Recheck exact target, current definition, recovery and locks before approval.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
ALTER TABLE school_calendar_events DROP CONSTRAINT school_calendar_events_audience_check;
ALTER TABLE school_calendar_events ADD CONSTRAINT school_calendar_events_audience_check
  CHECK (cardinality(audience)>0 AND audience <@ ARRAY['TEACHER','STUDENT','PARENT','STAFF','DRIVER']::text[]);
COMMIT;
