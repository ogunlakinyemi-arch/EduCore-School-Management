-- Empty-only reverse of stage 4. Earlier drafts roll back only AFTER this one.
BEGIN;
LOCK TABLE flutterwave_live_operator_reviews,flutterwave_live_subscription_intents,
 flutterwave_live_webhook_receipts,flutterwave_live_authority_reviews IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM flutterwave_live_operator_reviews)
 OR EXISTS(SELECT 1 FROM flutterwave_live_subscription_intents)
 OR EXISTS(SELECT 1 FROM flutterwave_live_webhook_receipts)
 OR EXISTS(SELECT 1 FROM flutterwave_live_authority_reviews) THEN
  RAISE EXCEPTION 'LIVE readiness evidence retained: preservation review required';
 END IF;
END $$;
DROP TABLE flutterwave_live_operator_reviews;
DROP INDEX live_authority_lookup_idx,live_application_scope_idx,live_intent_authority_fk_idx,
 live_receipt_result_event_idx,live_event_source_idx,live_workflow_audit_batch_idx;
ALTER TABLE flutterwave_live_commission_batches DROP CONSTRAINT live_batch_scope_ck,
 DROP CONSTRAINT live_batch_request_hash_ck,DROP CONSTRAINT live_batch_snapshot_ck;
ALTER TABLE flutterwave_live_finalization_events DROP CONSTRAINT live_event_verified_identity_fk,
 DROP CONSTRAINT live_event_authenticated_source_fk;
ALTER TABLE flutterwave_live_finalization_events DROP COLUMN source_provider;
ALTER TABLE flutterwave_live_collection_evidence DROP CONSTRAINT live_collection_verified_identity_fk;
ALTER TABLE flutterwave_live_subscription_intents DROP CONSTRAINT live_intent_review_scope_fk,
 DROP CONSTRAINT live_intent_verified_transaction_uq,DROP CONSTRAINT live_intent_verified_identity_uq;
ALTER TABLE flutterwave_live_authority_reviews DROP CONSTRAINT live_review_tenant_uq,
 DROP CONSTRAINT live_review_scope_ck,DROP CONSTRAINT live_review_expiry_ck;
COMMIT;
