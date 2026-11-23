-- REVIEW PACKAGE ONLY. NOT EXECUTED OR CONNECTED BY THIS TOOL.
-- Separate target, recovery, SQL-console and publication approval required.
-- Functions/triggers only; structural tables use the reviewed Publish flow.
-- PostgreSQL 14+; keep release/send gates closed. Never run at startup/build.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;
DO $operator$ BEGIN
 IF current_user<>'neondb_owner' OR current_setting('server_version_num')::int<140000 THEN
 RAISE EXCEPTION 'Requires approved managed-database owner and PostgreSQL 14+; target identity still needs independent approval';
 END IF;
END $operator$;
CREATE OR REPLACE FUNCTION public.reject_free_term_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Free academic-term evidence is immutable';
 END $$;
CREATE OR REPLACE FUNCTION public.validate_free_term_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM academic_terms t WHERE t.id=NEW.academic_term_id
   AND t.school_id=NEW.school_id AND t.academic_session_id=NEW.academic_session_id
   AND t.start_date=NEW.start_date AND t.end_date=NEW.end_date) THEN
   RAISE EXCEPTION 'Free term must match the saved school/session/term calendar';
 END IF;
 RETURN NEW;
 END $$;
COMMIT;
