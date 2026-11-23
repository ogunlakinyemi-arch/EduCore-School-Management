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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text($inventory$["current_subscription_operations","current_subscription_operation_events","current_subscription_reference_claims","current_bulk_allocations","current_bulk_bro_entitlements","current_payment_batches","current_bulk_confirmations","current_bulk_events","current_bro_withdrawals","current_bro_withdrawal_lines","current_bro_withdrawal_decisions","bro_field_sms_permissions","bro_field_sms_campaigns","bro_field_sms_recipients","bro_field_sms_events"]$inventory$::jsonb) n(name)
   WHERE to_regclass('public.'||name) IS NULL) THEN RAISE EXCEPTION 'Required structural tables missing; no triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset($inventory$[{"name":"guard_student_direct_history","body_md5":"06020fe5a25c579f9157746f4ba847b0"},{"name":"guard_current_bulk_scope","body_md5":"f1af32ded245bbd6ca05388de4aacee6"}]$inventory$::jsonb) AS e(name text,body_md5 text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.name||'()')
 LEFT JOIN pg_language l ON l.oid=p.prolang
   WHERE NOT COALESCE((p.oid IS NOT NULL AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.proretset AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict
 AND NOT p.proleakproof AND p.proparallel='u' AND p.proconfig IS NULL AND l.lanname='plpgsql'
 AND md5(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^[[:space:]]+|[[:space:]]+$','','g'))=e.body_md5),false)) THEN RAISE EXCEPTION 'Approved function body/properties missing; no triggers changed'; END IF;
 END $preflight$;
CREATE OR REPLACE TRIGGER current_subscription_operations_history BEFORE UPDATE OR DELETE ON public.current_subscription_operations FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_subscription_operations ENABLE TRIGGER current_subscription_operations_history;
CREATE OR REPLACE TRIGGER current_subscription_events_history BEFORE UPDATE OR DELETE ON public.current_subscription_operation_events FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_subscription_operation_events ENABLE TRIGGER current_subscription_events_history;
CREATE OR REPLACE TRIGGER current_subscription_claims_history BEFORE UPDATE OR DELETE ON public.current_subscription_reference_claims FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_subscription_reference_claims ENABLE TRIGGER current_subscription_claims_history;
CREATE OR REPLACE TRIGGER current_bulk_allocation_scope BEFORE INSERT ON public.current_bulk_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_current_bulk_scope();
ALTER TABLE public.current_bulk_allocations ENABLE TRIGGER current_bulk_allocation_scope;
CREATE OR REPLACE TRIGGER current_bulk_bro_scope BEFORE INSERT ON public.current_bulk_bro_entitlements FOR EACH ROW EXECUTE FUNCTION public.guard_current_bulk_scope();
ALTER TABLE public.current_bulk_bro_entitlements ENABLE TRIGGER current_bulk_bro_scope;
CREATE OR REPLACE TRIGGER current_payment_batches_history BEFORE UPDATE OR DELETE ON public.current_payment_batches FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_payment_batches ENABLE TRIGGER current_payment_batches_history;
CREATE OR REPLACE TRIGGER current_bulk_allocations_history BEFORE UPDATE OR DELETE ON public.current_bulk_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bulk_allocations ENABLE TRIGGER current_bulk_allocations_history;
CREATE OR REPLACE TRIGGER current_bulk_confirmations_history BEFORE UPDATE OR DELETE ON public.current_bulk_confirmations FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bulk_confirmations ENABLE TRIGGER current_bulk_confirmations_history;
CREATE OR REPLACE TRIGGER current_bulk_events_history BEFORE UPDATE OR DELETE ON public.current_bulk_events FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bulk_events ENABLE TRIGGER current_bulk_events_history;
CREATE OR REPLACE TRIGGER current_bulk_bro_entitlements_history BEFORE UPDATE OR DELETE ON public.current_bulk_bro_entitlements FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bulk_bro_entitlements ENABLE TRIGGER current_bulk_bro_entitlements_history;
CREATE OR REPLACE TRIGGER current_bro_withdrawals_history BEFORE UPDATE OR DELETE ON public.current_bro_withdrawals FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bro_withdrawals ENABLE TRIGGER current_bro_withdrawals_history;
CREATE OR REPLACE TRIGGER current_bro_withdrawal_lines_history BEFORE UPDATE OR DELETE ON public.current_bro_withdrawal_lines FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bro_withdrawal_lines ENABLE TRIGGER current_bro_withdrawal_lines_history;
CREATE OR REPLACE TRIGGER current_bro_withdrawal_decisions_history BEFORE UPDATE OR DELETE ON public.current_bro_withdrawal_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.current_bro_withdrawal_decisions ENABLE TRIGGER current_bro_withdrawal_decisions_history;
CREATE OR REPLACE TRIGGER bro_field_sms_permissions_history BEFORE UPDATE OR DELETE ON public.bro_field_sms_permissions FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.bro_field_sms_permissions ENABLE TRIGGER bro_field_sms_permissions_history;
CREATE OR REPLACE TRIGGER bro_field_sms_campaigns_history BEFORE UPDATE OR DELETE ON public.bro_field_sms_campaigns FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.bro_field_sms_campaigns ENABLE TRIGGER bro_field_sms_campaigns_history;
CREATE OR REPLACE TRIGGER bro_field_sms_recipients_history BEFORE UPDATE OR DELETE ON public.bro_field_sms_recipients FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.bro_field_sms_recipients ENABLE TRIGGER bro_field_sms_recipients_history;
CREATE OR REPLACE TRIGGER bro_field_sms_events_history BEFORE UPDATE OR DELETE ON public.bro_field_sms_events FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
ALTER TABLE public.bro_field_sms_events ENABLE TRIGGER bro_field_sms_events_history;
COMMIT;
