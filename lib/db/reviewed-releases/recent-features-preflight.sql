-- READ ONLY. For the authorized operator's verified serving PRIMARY console.
-- This output alone does not establish deployment/resource binding or backups.
-- Require is_replica=false and read_only=off; stop otherwise.
SELECT current_database() AS database,current_user AS role,
  pg_is_in_recovery() AS is_replica,
  current_setting('transaction_read_only') AS read_only;
SELECT name,to_regclass('public.'||name) IS NOT NULL AS present
FROM unnest(ARRAY['app_users','schools','parents','parent_telegram_links',
  'bro_field_leads','bro_field_claims','bro_field_transfers','audit_logs',
  'academic_timetable_entries','communication_notifications',
  'communication_deliveries','communication_preferences','communication_push_devices',
  'teacher_telegram_links','teacher_telegram_challenges']) name;
-- Teacher tables may be absent before installation. All other prerequisites
-- must exist. Reconcile unexpected existing definitions; do not overwrite them.
SELECT p.proname,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('bro_field_immutable',
  'bro_field_owner_guard','bro_field_transfer_guard','bro_field_audit_guard',
  'telegram_account_chat_exclusive') ORDER BY p.proname;
