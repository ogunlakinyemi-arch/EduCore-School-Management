-- Prepared only. Apply only after separate target verification and authorization.
-- Existing names/history are not rewritten; all legacy titles remain NULL.
BEGIN;
ALTER TABLE parents ADD COLUMN person_title text;
ALTER TABLE employees ADD COLUMN person_title text;
ALTER TABLE parents ADD CONSTRAINT parents_person_title_ck CHECK (
  person_title IS NULL OR person_title IN
  ('Mr','Mrs','Ms','Miss','Dr','Prof','Rev','Pastor','Imam','Alhaji','Alhaja','Chief','Engr','Barr','Hon')
);
ALTER TABLE employees ADD CONSTRAINT employees_person_title_ck CHECK (
  person_title IS NULL OR person_title IN
  ('Mr','Mrs','Ms','Miss','Dr','Prof','Rev','Pastor','Imam','Alhaji','Alhaja','Chief','Engr','Barr','Hon')
);
COMMIT;
