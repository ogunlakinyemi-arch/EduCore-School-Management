-- REVIEW ONLY, stage 4. After inbox -> finalization -> workflow. Not journalled.
-- No backfill, shared-table DDL or automatic application-target execution.
BEGIN;
ALTER TABLE flutterwave_live_authority_reviews
 ADD CONSTRAINT live_review_scope_ck CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 ADD CONSTRAINT live_review_expiry_ck CHECK(expires_at>created_at),
 ADD CONSTRAINT live_review_tenant_uq UNIQUE(id,environment,merchant_scope,school_id,school_subaccount_id);
ALTER TABLE flutterwave_live_subscription_intents
 ADD CONSTRAINT live_intent_review_scope_fk
 FOREIGN KEY(authority_review_id,environment,merchant_scope,school_id,school_subaccount_id)
 REFERENCES flutterwave_live_authority_reviews(id,environment,merchant_scope,school_id,school_subaccount_id),
 ADD CONSTRAINT live_intent_verified_transaction_uq UNIQUE(id,environment,verified_transaction_id),
 ADD CONSTRAINT live_intent_verified_identity_uq UNIQUE(id,environment,verified_transaction_id,verified_provider_reference);
ALTER TABLE flutterwave_live_collection_evidence ADD CONSTRAINT live_collection_verified_identity_fk
 FOREIGN KEY(intent_id,environment,transaction_id,provider_reference)
 REFERENCES flutterwave_live_subscription_intents(id,environment,verified_transaction_id,verified_provider_reference);
ALTER TABLE flutterwave_live_finalization_events
 ADD COLUMN source_provider text NOT NULL DEFAULT 'FLUTTERWAVE' CHECK(source_provider='FLUTTERWAVE'),
 ADD CONSTRAINT live_event_verified_identity_fk FOREIGN KEY(intent_id,environment,transaction_id)
 REFERENCES flutterwave_live_subscription_intents(id,environment,verified_transaction_id),
 ADD CONSTRAINT live_event_authenticated_source_fk FOREIGN KEY(source_provider,environment,source_payload_sha256)
 REFERENCES flutterwave_live_webhook_receipts(provider,environment,payload_sha256);
ALTER TABLE flutterwave_live_commission_batches
 ADD CONSTRAINT live_batch_scope_ck CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 ADD CONSTRAINT live_batch_request_hash_ck CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT live_batch_snapshot_ck CHECK(jsonb_typeof(snapshot)='object');
CREATE INDEX live_authority_lookup_idx ON flutterwave_live_authority_reviews(merchant_scope,school_id,id DESC);
CREATE INDEX live_application_scope_idx ON flutterwave_live_subscription_intents(environment,merchant_scope,school_id,term_id,student_id);
CREATE INDEX live_intent_authority_fk_idx ON flutterwave_live_subscription_intents(authority_review_id);
CREATE INDEX live_receipt_result_event_idx ON flutterwave_live_receipt_results(event_id);
CREATE INDEX live_event_source_idx ON flutterwave_live_finalization_events(environment,source_payload_sha256);
CREATE INDEX live_workflow_audit_batch_idx ON flutterwave_live_workflow_audits(batch_id);
CREATE TABLE flutterwave_live_operator_reviews (
 id bigserial PRIMARY KEY,
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 merchant_scope text NOT NULL CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 receipt_id bigint NOT NULL REFERENCES flutterwave_live_webhook_receipts(id),
 actor_id integer NOT NULL CHECK(actor_id>0),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action IN ('REVIEW','CONFIRM_DURABILITY','RETRY')),
 reason text NOT NULL CHECK(reason IN ('PENDING','DUPLICATE','UNCERTAIN_COMMIT','REFUND','REVERSAL','DISPUTE')),
 outcome text NOT NULL CHECK(outcome IN ('REVIEW_RECORDED','EVIDENCE_REQUIRED','RECORDED_UNRELEASED','HELD_RETAINED','RETRY_REFUSED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,merchant_scope,idempotency_key)
);
CREATE INDEX live_operator_receipt_idx ON flutterwave_live_operator_reviews(receipt_id,id);
CREATE TRIGGER live_operator_history BEFORE UPDATE OR DELETE ON flutterwave_live_operator_reviews
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
COMMIT;
