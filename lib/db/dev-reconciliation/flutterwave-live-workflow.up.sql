-- REVIEW ONLY. Depends on LIVE inbox + finalization drafts; no automatic journal.
-- Never apply to an application DB without separately verified target approval.
BEGIN;
CREATE TABLE flutterwave_live_authority_reviews (
 id bigserial PRIMARY KEY,
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 merchant_scope text NOT NULL,
 school_id integer NOT NULL CHECK(school_id>0),
 school_subaccount_id text NOT NULL CHECK(school_subaccount_id ~ '^RS_[A-Za-z0-9]{12,80}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_by integer NOT NULL CHECK(reviewed_by>0),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_authority_history BEFORE UPDATE OR DELETE ON flutterwave_live_authority_reviews
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
ALTER TABLE flutterwave_live_subscription_intents
 ADD COLUMN issued_by integer,
 ADD COLUMN issuer_key text,
 ADD COLUMN authority_review_id bigint REFERENCES flutterwave_live_authority_reviews(id),
 ADD COLUMN authority_snapshot jsonb;
ALTER TABLE flutterwave_live_subscription_intents ADD CONSTRAINT live_issued_snapshot_ck CHECK (
 (issued_by IS NULL AND issuer_key IS NULL AND authority_review_id IS NULL AND authority_snapshot IS NULL)
 OR (issued_by IS NOT NULL AND issued_by>0 AND issuer_key IS NOT NULL
     AND issuer_key ~ '^[A-Za-z0-9_-]{16,100}$' AND authority_review_id IS NOT NULL
     AND authority_snapshot IS NOT NULL AND jsonb_typeof(authority_snapshot)='object'));
CREATE UNIQUE INDEX live_intent_issuer_key_uq ON flutterwave_live_subscription_intents
 (environment,merchant_scope,issued_by,issuer_key) WHERE issuer_key IS NOT NULL;
CREATE TABLE flutterwave_live_subscription_activations (
 intent_id bigint PRIMARY KEY REFERENCES flutterwave_live_collection_evidence(intent_id),
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 status text NOT NULL CHECK(status IN ('ACTIVE','HELD')),
 activated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE TABLE flutterwave_live_official_receipts (
 intent_id bigint PRIMARY KEY REFERENCES flutterwave_live_subscription_activations(intent_id),
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 receipt_number text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_official_receipt_history BEFORE UPDATE OR DELETE ON flutterwave_live_official_receipts
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TABLE flutterwave_live_reconciliation_cases (
 receipt_id bigint PRIMARY KEY REFERENCES flutterwave_live_webhook_receipts(id),
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 reason_code text NOT NULL CHECK(reason_code IN ('SIGNED_ADVERSE_EVENT','VERIFICATION_OR_FINALIZATION_UNRESOLVED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_reconciliation_history BEFORE UPDATE OR DELETE ON flutterwave_live_reconciliation_cases
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TABLE flutterwave_live_commission_batches (
 id bigserial PRIMARY KEY,
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 merchant_scope text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{16,100}$'),
 request_hash text NOT NULL,
 approved_by integer NOT NULL CHECK(approved_by>0),
 snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','REVIEW_REQUIRED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment,merchant_scope,idempotency_key)
);
CREATE TABLE flutterwave_live_commission_items (
 batch_id bigint NOT NULL REFERENCES flutterwave_live_commission_batches(id),
 intent_id bigint NOT NULL UNIQUE REFERENCES flutterwave_live_partner_accruals(intent_id),
 PRIMARY KEY(batch_id,intent_id)
);
CREATE TRIGGER live_commission_items_history BEFORE UPDATE OR DELETE ON flutterwave_live_commission_items
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TABLE flutterwave_live_workflow_audits (
 id bigserial PRIMARY KEY,
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 actor_id integer NOT NULL CHECK(actor_id>0),
 action text NOT NULL CHECK(action IN ('APPROVE_EXPORT_ONLY','EXPORT_ONLY')),
 batch_id bigint NOT NULL REFERENCES flutterwave_live_commission_batches(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_workflow_audit_history BEFORE UPDATE OR DELETE ON flutterwave_live_workflow_audits
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE FUNCTION guard_live_workflow_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain LIVE workflow history'; END IF;
 IF TG_TABLE_NAME='flutterwave_live_commission_batches' THEN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR (OLD.status='REVIEW_REQUIRED' AND NEW.status<>'REVIEW_REQUIRED') THEN
   RAISE EXCEPTION 'Immutable LIVE batch or held batch'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR (OLD.status='HELD' AND NEW.status<>'HELD') THEN
   RAISE EXCEPTION 'Immutable LIVE activation or held activation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER live_activation_history BEFORE UPDATE OR DELETE ON flutterwave_live_subscription_activations
 FOR EACH ROW EXECUTE FUNCTION guard_live_workflow_state();
CREATE TRIGGER live_batch_history BEFORE UPDATE OR DELETE ON flutterwave_live_commission_batches
 FOR EACH ROW EXECUTE FUNCTION guard_live_workflow_state();
CREATE FUNCTION hold_live_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='HELD' THEN
  UPDATE flutterwave_live_commission_batches SET status='REVIEW_REQUIRED' WHERE id IN
   (SELECT batch_id FROM flutterwave_live_commission_items WHERE intent_id=NEW.intent_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER live_hold_invalidates_export AFTER UPDATE ON flutterwave_live_partner_accruals
 FOR EACH ROW EXECUTE FUNCTION hold_live_workflow();
COMMIT;
