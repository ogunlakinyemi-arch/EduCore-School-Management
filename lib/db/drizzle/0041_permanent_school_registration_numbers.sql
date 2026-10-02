-- Additive only. Legacy null numbers remain null; no school record is rewritten.
-- Existing school codes, foreign keys and tenant-key indexes are unchanged.
CREATE UNIQUE INDEX schools_registration_number_unique ON schools (registration_number);