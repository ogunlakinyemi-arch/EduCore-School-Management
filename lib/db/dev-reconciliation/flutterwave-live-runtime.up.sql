-- REVIEW DRAFT ONLY. No auto-run journal entry.
-- Requires, in order: LIVE webhook inbox, finalization, workflow, readiness drafts.
-- Apply only after backup, target identity verification and separate approval.
BEGIN;
CREATE TABLE flutterwave_live_release_manifests (
 release_id text PRIMARY KEY CHECK(release_id='SCV3_V1'),
 merchant_scope text NOT NULL CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 enabled boolean NOT NULL DEFAULT false,
 reviewed_by integer NOT NULL CHECK(reviewed_by>0),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz NOT NULL
);
-- No seed: applying DDL cannot approve/enable the release.
CREATE TABLE flutterwave_live_school_configuration (
 id bigserial PRIMARY KEY,
 school_id integer NOT NULL CHECK(school_id>0),
 merchant_scope text NOT NULL CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 authority_review_id bigint NOT NULL UNIQUE REFERENCES flutterwave_live_authority_reviews(id),
 authority_evidence jsonb NOT NULL CHECK(jsonb_typeof(authority_evidence)='object')
);
CREATE TRIGGER live_school_config_history BEFORE UPDATE OR DELETE ON flutterwave_live_school_configuration
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TABLE flutterwave_live_checkout_attempts (
 intent_id bigint PRIMARY KEY REFERENCES flutterwave_live_subscription_intents(id),
 state text NOT NULL CHECK(state IN ('RESERVED','READY','UNKNOWN')),
 checkout_url text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='READY' AND checkout_url IS NOT NULL) OR (state<>'READY' AND checkout_url IS NULL))
);
CREATE TABLE flutterwave_live_allocation_reviews (
 merchant_scope text NOT NULL CHECK(merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
 reference text NOT NULL REFERENCES flutterwave_live_subscription_intents(reference)
   CHECK(reference ~ '^SCV3_live_[A-Za-z0-9_-]{8,80}$'),
 transaction_id text NOT NULL CHECK(transaction_id ~ '^[1-9][0-9]{0,15}$'),
 provider_reference text NOT NULL CHECK(length(provider_reference) BETWEEN 1 AND 200),
 school_subaccount_id text NOT NULL CHECK(school_subaccount_id ~ '^RS_[A-Za-z0-9]{12,80}$'),
 currency text NOT NULL CHECK(currency='NGN'),
 gross_minor integer NOT NULL CHECK(gross_minor=500000),
 school_minor integer NOT NULL CHECK(school_minor=190000),
 provider_fee_minor integer NOT NULL CHECK(provider_fee_minor>=0),
 additional_fee_minor integer NOT NULL CHECK(additional_fee_minor>=0),
 source text NOT NULL CHECK(source='FLUTTERWAVE_TRANSACTION_REPORT'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_by integer NOT NULL CHECK(reviewed_by>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_scope,reference),
 UNIQUE(merchant_scope,transaction_id),
 CHECK(provider_fee_minor+additional_fee_minor<300000)
);
CREATE TRIGGER live_allocation_review_history BEFORE UPDATE OR DELETE ON flutterwave_live_allocation_reviews
 FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE FUNCTION guard_live_checkout_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'RESERVED'
   OR NEW.state NOT IN ('READY','UNKNOWN')
   OR NEW.intent_id<>OLD.intent_id OR NEW.created_at<>OLD.created_at
 THEN RAISE EXCEPTION 'Retain LIVE checkout claim; uncertain checkout must be reconciled'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER live_checkout_attempt_history BEFORE UPDATE OR DELETE ON flutterwave_live_checkout_attempts
 FOR EACH ROW EXECUTE FUNCTION guard_live_checkout_attempt();
COMMIT;
