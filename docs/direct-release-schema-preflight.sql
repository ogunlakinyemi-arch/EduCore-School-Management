-- READ-ONLY CATALOG REPORT. No migrations, settings changes, financial rows or credentials.
-- First bind this SQL connection to the independently confirmed intended resource.
-- A replica result is an observation, NOT certification of the serving primary.
WITH expected(migration,table_name) AS (VALUES
 ('0175','subscription_rule_proposals'),
 ('0175','subscription_payment_assistance_requests'),
 ('0176','student_direct_live_reviews'),
 ('0176','student_direct_live_obligations'),
 ('0176','student_direct_live_attempts'),
 ('0176','student_direct_live_events'),
 ('0177','student_direct_live_release_requests'),
 ('0177','student_direct_live_release_decisions'),
 ('0177','student_direct_live_review_bindings'),
 ('0178','bro_term_commission_entitlements')
), objects AS (
 SELECT e.*,c.oid,c.relrowsecurity
 FROM expected e LEFT JOIN pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind='r'
)
SELECT now() AS inspected_at,
 pg_is_in_recovery() AS endpoint_is_replica,
 current_setting('transaction_read_only') AS transaction_read_only,
 to_regclass('_system.replit_database_migrations_v1') IS NOT NULL AS platform_ledger_present,
 (SELECT EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff_nfc_billing_rules' AND column_name='ends_at'))
   AS staff_rule_ends_at_present,
 (SELECT jsonb_agg(jsonb_build_object(
   'migration',o.migration,'table',o.table_name,'exists',o.oid IS NOT NULL,'rls',o.relrowsecurity,
   'privileges',CASE WHEN o.oid IS NOT NULL THEN jsonb_build_object(
     'select',has_table_privilege(o.oid,'SELECT'),'insert',has_table_privilege(o.oid,'INSERT')) END,
   'columns',(SELECT jsonb_agg(jsonb_build_object(
       'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
       'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=o.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname)
     FROM pg_constraint WHERE conrelid=o.oid),
   'indexes',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(indexrelid),'valid',indisvalid,'ready',indisready) ORDER BY indexrelid)
     FROM pg_index WHERE indrelid=o.oid),
   'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) ORDER BY tgname)
     FROM pg_trigger WHERE tgrelid=o.oid AND NOT tgisinternal)
 ) ORDER BY o.migration,o.table_name) FROM objects o) AS required_tables,
 (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid)) ORDER BY p.proname)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN(
    'guard_student_direct_history','guard_student_direct_attempt',
    'guard_bro_term_commission_history','guard_bro_term_commission_scope')) AS required_functions;
