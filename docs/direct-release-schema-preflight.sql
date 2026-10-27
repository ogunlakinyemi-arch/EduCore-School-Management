-- READ-ONLY CATALOG REPORT. No migrations, settings changes, financial rows or credentials.
-- First bind this SQL connection to the independently confirmed intended resource.
-- A replica result is an observation, NOT certification of the serving primary.
-- Inventory readiness is necessary, NOT semantic certification: compare function
-- bodies/properties and trigger definitions with inspectFinancialGuards and 0179.
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
), expected_guards(trigger_name,table_name,function_name,trigger_type) AS (VALUES
 ('student_direct_review_history','student_direct_live_reviews','guard_student_direct_history',27),
 ('student_direct_obligation_history','student_direct_live_obligations','guard_student_direct_history',27),
 ('student_direct_event_history','student_direct_live_events','guard_student_direct_history',27),
 ('student_direct_attempt_history','student_direct_live_attempts','guard_student_direct_attempt',27),
 ('student_direct_release_request_history','student_direct_live_release_requests','guard_student_direct_history',27),
 ('student_direct_release_decision_history','student_direct_live_release_decisions','guard_student_direct_history',27),
 ('student_direct_release_binding_history','student_direct_live_review_bindings','guard_student_direct_history',27),
 ('bro_term_commission_append_only','bro_term_commission_entitlements','guard_bro_term_commission_history',27),
 ('bro_term_commission_scope_guard','bro_term_commission_entitlements','guard_bro_term_commission_scope',7)
), guard_inventory AS (
 SELECT e.*,tg.tgname IS NOT NULL AS trigger_present,p.oid IS NOT NULL AS function_present,
   tg.tgenabled,tg.tgtype,pg_get_triggerdef(tg.oid) AS trigger_definition,
   COALESCE(tg.tgenabled='O' AND tg.tgtype=e.trigger_type AND tg.tgfoid=p.oid
     AND tg.tgnargs=0 AND tg.tgqual IS NULL AND tg.tgconstraint=0 AND tg.tgattr::text='',false) AS matches
 FROM expected_guards e
 LEFT JOIN pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind='r'
 LEFT JOIN pg_trigger tg ON tg.tgrelid=c.oid AND tg.tgname=e.trigger_name AND NOT tg.tgisinternal
 LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name AND p.pronargs=0
   AND p.prorettype='pg_catalog.trigger'::regtype
), objects AS (
 SELECT e.*,c.oid,c.relrowsecurity
 FROM expected e LEFT JOIN pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind='r'
)
SELECT now() AS inspected_at,
 pg_is_in_recovery() AS endpoint_is_replica,
 current_setting('transaction_read_only') AS transaction_read_only,
 to_regclass('_system.replit_database_migrations_v1') IS NOT NULL AS platform_ledger_present,
 (SELECT bool_and(matches) FROM guard_inventory) AS procedural_names_and_enablement_match,
 (SELECT jsonb_agg(to_jsonb(g) ORDER BY trigger_name) FROM guard_inventory g) AS procedural_guard_inventory,
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
 (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),
    'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,
    'strict',p.proisstrict,'leakproof',p.proleakproof,'configuration',p.proconfig) ORDER BY p.proname)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND p.proname IN(
    'guard_student_direct_history','guard_student_direct_attempt',
    'guard_bro_term_commission_history','guard_bro_term_commission_scope')) AS required_functions;
