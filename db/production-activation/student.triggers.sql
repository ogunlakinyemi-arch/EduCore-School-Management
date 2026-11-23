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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text($inventory$["student_direct_live_reviews","student_direct_live_obligations","student_direct_live_events","student_direct_live_attempts","student_direct_live_release_requests","student_direct_live_release_decisions","student_direct_live_review_bindings","bro_term_commission_entitlements"]$inventory$::jsonb) n(name)
   WHERE to_regclass('public.'||name) IS NULL) THEN RAISE EXCEPTION 'Required structural tables missing; no triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset($inventory$[{"name":"guard_student_direct_history","body_md5":"06020fe5a25c579f9157746f4ba847b0"},{"name":"guard_student_direct_attempt","body_md5":"9ba4c246e69a19d4a20d05acd57cdfef"},{"name":"guard_bro_term_commission_history","body_md5":"e18a68b527bc1434fbc86b0abe969f23"},{"name":"guard_bro_term_commission_scope","body_md5":"6803a3b7173c3d9e677d35616a789046"}]$inventory$::jsonb) AS e(name text,body_md5 text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.name||'()')
 LEFT JOIN pg_language l ON l.oid=p.prolang
   WHERE NOT COALESCE((p.oid IS NOT NULL AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.proretset AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict
 AND NOT p.proleakproof AND p.proparallel='u' AND p.proconfig IS NULL AND l.lanname='plpgsql'
 AND md5(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^[[:space:]]+|[[:space:]]+$','','g'))=e.body_md5),false)) THEN RAISE EXCEPTION 'Approved function body/properties missing; no triggers changed'; END IF;
 END $preflight$;
CREATE OR REPLACE TRIGGER student_direct_review_history BEFORE UPDATE OR DELETE ON public.student_direct_live_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_reviews ENABLE TRIGGER student_direct_review_history;
CREATE OR REPLACE TRIGGER student_direct_obligation_history BEFORE UPDATE OR DELETE ON public.student_direct_live_obligations FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_obligations ENABLE TRIGGER student_direct_obligation_history;
CREATE OR REPLACE TRIGGER student_direct_event_history BEFORE UPDATE OR DELETE ON public.student_direct_live_events FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_events ENABLE TRIGGER student_direct_event_history;
CREATE OR REPLACE TRIGGER student_direct_attempt_history BEFORE UPDATE OR DELETE ON public.student_direct_live_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_attempt();
ALTER TABLE public.student_direct_live_attempts ENABLE TRIGGER student_direct_attempt_history;
CREATE OR REPLACE TRIGGER student_direct_release_request_history BEFORE UPDATE OR DELETE ON public.student_direct_live_release_requests FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_release_requests ENABLE TRIGGER student_direct_release_request_history;
CREATE OR REPLACE TRIGGER student_direct_release_decision_history BEFORE UPDATE OR DELETE ON public.student_direct_live_release_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_release_decisions ENABLE TRIGGER student_direct_release_decision_history;
CREATE OR REPLACE TRIGGER student_direct_release_binding_history BEFORE UPDATE OR DELETE ON public.student_direct_live_review_bindings FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.student_direct_live_review_bindings ENABLE TRIGGER student_direct_release_binding_history;
CREATE OR REPLACE TRIGGER bro_term_commission_append_only BEFORE UPDATE OR DELETE ON public.bro_term_commission_entitlements FOR EACH ROW EXECUTE FUNCTION public.guard_bro_term_commission_history();
ALTER TABLE public.bro_term_commission_entitlements ENABLE TRIGGER bro_term_commission_append_only;
CREATE OR REPLACE TRIGGER bro_term_commission_scope_guard BEFORE INSERT ON public.bro_term_commission_entitlements FOR EACH ROW EXECUTE FUNCTION public.guard_bro_term_commission_scope();
ALTER TABLE public.bro_term_commission_entitlements ENABLE TRIGGER bro_term_commission_scope_guard;
COMMIT;
