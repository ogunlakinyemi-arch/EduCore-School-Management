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
DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text($inventory$["owner_free_academic_terms","owner_free_academic_term_events"]$inventory$::jsonb) n(name)
   WHERE to_regclass('public.'||name) IS NULL) THEN RAISE EXCEPTION 'Required structural tables missing; no triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset($inventory$[{"name":"reject_free_term_evidence_mutation","body_md5":"4f1dcd3c37f119ee7a85198a96642cbe"},{"name":"validate_free_term_scope","body_md5":"d7d8cef9df3aebc60bde104d87215988"}]$inventory$::jsonb) AS e(name text,body_md5 text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.name||'()')
 LEFT JOIN pg_language l ON l.oid=p.prolang
   WHERE NOT COALESCE((p.oid IS NOT NULL AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.proretset AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict
 AND NOT p.proleakproof AND p.proparallel='u' AND p.proconfig IS NULL AND l.lanname='plpgsql'
 AND md5(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^[[:space:]]+|[[:space:]]+$','','g'))=e.body_md5),false)) THEN RAISE EXCEPTION 'Approved function body/properties missing; no triggers changed'; END IF;
 END $preflight$;
CREATE OR REPLACE TRIGGER owner_free_terms_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.owner_free_academic_terms FOR EACH STATEMENT EXECUTE FUNCTION public.reject_free_term_evidence_mutation();
ALTER TABLE public.owner_free_academic_terms ENABLE TRIGGER owner_free_terms_immutable;
CREATE OR REPLACE TRIGGER owner_free_term_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.owner_free_academic_term_events FOR EACH STATEMENT EXECUTE FUNCTION public.reject_free_term_evidence_mutation();
ALTER TABLE public.owner_free_academic_term_events ENABLE TRIGGER owner_free_term_events_immutable;
CREATE OR REPLACE TRIGGER owner_free_terms_scope BEFORE INSERT ON public.owner_free_academic_terms FOR EACH ROW EXECUTE FUNCTION public.validate_free_term_scope();
ALTER TABLE public.owner_free_academic_terms ENABLE TRIGGER owner_free_terms_scope;
COMMIT;
