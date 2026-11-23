-- READ ONLY. Object-definition evidence, NOT a database/data backup.
SELECT 'function' AS kind,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,
 pg_get_functiondef(p.oid) AS definition,NULL::text AS enablement
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.pronargs=0
 AND p.proname=ANY(ARRAY['guard_student_direct_history','guard_student_direct_attempt','guard_bro_term_commission_history','guard_bro_term_commission_scope','guard_current_bulk_scope','reject_free_term_evidence_mutation','validate_free_term_scope'])
UNION ALL
SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_userbyid(c.relowner),
 pg_get_triggerdef(t.oid),t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 AND t.tgname=ANY(ARRAY['student_direct_review_history','student_direct_obligation_history','student_direct_event_history','student_direct_attempt_history','student_direct_release_request_history','student_direct_release_decision_history','student_direct_release_binding_history','bro_term_commission_append_only','bro_term_commission_scope_guard','current_subscription_operations_history','current_subscription_events_history','current_subscription_claims_history','current_bulk_allocation_scope','current_bulk_bro_scope','current_payment_batches_history','current_bulk_allocations_history','current_bulk_confirmations_history','current_bulk_events_history','current_bulk_bro_entitlements_history','current_bro_withdrawals_history','current_bro_withdrawal_lines_history','current_bro_withdrawal_decisions_history','bro_field_sms_permissions_history','bro_field_sms_campaigns_history','bro_field_sms_recipients_history','bro_field_sms_events_history','owner_free_terms_immutable','owner_free_term_events_immutable','owner_free_terms_scope'])
ORDER BY kind,name;
