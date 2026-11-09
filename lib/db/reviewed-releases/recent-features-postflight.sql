-- READ ONLY. Run in the SAME verified primary resource after installation.
-- Require 5 approved functions and all 6 expected trigger bindings, enabled O.
SELECT p.proname,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('bro_field_immutable',
  'bro_field_owner_guard','bro_field_transfer_guard','bro_field_audit_guard',
  'telegram_account_chat_exclusive') ORDER BY p.proname;
SELECT t.tgname,c.relname AS table_name,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN
  ('bro_field_claim_history','bro_field_ownership','bro_field_transfer_history',
   'bro_field_audit_history','parent_telegram_account_exclusive',
   'teacher_telegram_account_exclusive') ORDER BY t.tgname;
SELECT c.relname AS table_name,x.conname,pg_get_constraintdef(x.oid) AS definition
FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('teacher_telegram_links','teacher_telegram_challenges')
ORDER BY c.relname,x.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND tablename IN ('teacher_telegram_links','teacher_telegram_challenges')
ORDER BY tablename,indexname;
-- No row means Production defaults: paused, all channels off, no recipients.
-- Inspect only control state, never message bodies, tokens or subscriptions.
SELECT metadata->'controls'->'paused' AS paused,
  metadata->'controls'->'smsEnabled' AS sms_enabled,
  metadata->'controls'->'pushEnabled' AS push_enabled,
  metadata->'controls'->'telegramEnabled' AS telegram_enabled,
  jsonb_array_length(metadata->'controls'->'pushParentIds') AS selected_push_count
FROM public.audit_logs WHERE module='OwnerNotificationDelivery'
  AND event_type='PRODUCTION_DELIVERY_CONTROLS_UPDATED'
  AND role='PLATFORM_OWNER' AND school_id IS NULL AND result='SUCCESS'
ORDER BY id DESC LIMIT 1;
