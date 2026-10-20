-- REVIEW-ONLY isolated design; NOT an automatic migration or operational billing.
-- Depends only on the separately reviewed LIVE receipt inbox draft.
-- No foreign keys to or changes in shared/SANDBOX financial or academic tables.
BEGIN;
CREATE TABLE flutterwave_live_subscription_intents (
  id bigserial PRIMARY KEY,
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  merchant_scope text NOT NULL CHECK (merchant_scope ~ '^[A-Za-z0-9_-]{8,80}$'),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^SCV3_[A-Za-z0-9_-]{8,95}$'),
  school_id integer NOT NULL CHECK (school_id > 0),
  student_id integer NOT NULL CHECK (student_id > 0),
  session_id integer NOT NULL CHECK (session_id > 0),
  term_id integer NOT NULL CHECK (term_id > 0),
  term_end_date date NOT NULL,
  school_subaccount_id text NOT NULL CHECK (school_subaccount_id ~ '^RS_[A-Za-z0-9]{12,80}$'),
  partner_profile_id integer CHECK (partner_profile_id > 0),
  gross_minor integer NOT NULL DEFAULT 500000 CHECK (gross_minor = 500000),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  school_minor integer NOT NULL DEFAULT 190000 CHECK (school_minor = 190000),
  merchant_gross_minor integer NOT NULL DEFAULT 310000 CHECK (merchant_gross_minor = 310000),
  partner_accrual_minor integer NOT NULL CHECK (
    (partner_profile_id IS NULL AND partner_accrual_minor = 0)
    OR (partner_profile_id IS NOT NULL AND partner_accrual_minor = 10000)),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','COLLECTION_VERIFIED','REVIEW_REQUIRED')),
  on_hold boolean NOT NULL DEFAULT false,
  verified_transaction_id text CHECK (verified_transaction_id ~ '^[1-9][0-9]{0,15}$'),
  verified_provider_reference text CHECK (length(verified_provider_reference) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, environment, merchant_scope, school_subaccount_id, partner_accrual_minor),
  UNIQUE (id, environment, partner_profile_id, partner_accrual_minor),
  UNIQUE (environment, merchant_scope, verified_transaction_id),
  UNIQUE (environment, merchant_scope, verified_provider_reference),
  UNIQUE (environment, merchant_scope, school_id, student_id, session_id, term_id)
);
CREATE TABLE flutterwave_live_collection_evidence (
  intent_id bigint PRIMARY KEY REFERENCES flutterwave_live_subscription_intents(id),
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  merchant_scope text NOT NULL,
  school_subaccount_id text NOT NULL,
  transaction_id text NOT NULL CHECK (transaction_id ~ '^[1-9][0-9]{0,15}$'),
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 200),
  gross_minor integer NOT NULL CHECK (gross_minor = 500000),
  currency text NOT NULL CHECK (currency = 'NGN'),
  school_minor integer NOT NULL CHECK (school_minor = 190000),
  merchant_gross_minor integer NOT NULL CHECK (merchant_gross_minor = 310000),
  partner_accrual_minor integer NOT NULL CHECK (partner_accrual_minor IN (0,10000)),
  provider_fee_minor integer NOT NULL CHECK (provider_fee_minor >= 0),
  additional_fee_minor integer NOT NULL CHECK (additional_fee_minor >= 0),
  calculated_merchant_remainder_minor integer GENERATED ALWAYS AS
    (310000 - provider_fee_minor - additional_fee_minor) STORED,
  calculated_owner_net_minor integer GENERATED ALWAYS AS
    (310000 - provider_fee_minor - additional_fee_minor - partner_accrual_minor) STORED,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_fee_minor::bigint + additional_fee_minor < 310000 - partner_accrual_minor),
  UNIQUE (environment, merchant_scope, transaction_id),
  FOREIGN KEY (intent_id,environment,merchant_scope,school_subaccount_id,partner_accrual_minor)
    REFERENCES flutterwave_live_subscription_intents
      (id,environment,merchant_scope,school_subaccount_id,partner_accrual_minor)
);
CREATE TABLE flutterwave_live_finalization_events (
  id bigserial PRIMARY KEY,
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  intent_id bigint NOT NULL REFERENCES flutterwave_live_subscription_intents(id),
  semantic_key text NOT NULL CHECK (semantic_key ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('COLLECTION','ADVERSE_HOLD')),
  transaction_id text NOT NULL CHECK (transaction_id ~ '^[1-9][0-9]{0,15}$'),
  source_payload_sha256 text NOT NULL CHECK (source_payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, semantic_key),
  UNIQUE (intent_id, kind)
);
CREATE TABLE flutterwave_live_receipt_results (
  receipt_id bigint PRIMARY KEY REFERENCES flutterwave_live_webhook_receipts(id),
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  event_id bigint NOT NULL REFERENCES flutterwave_live_finalization_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE flutterwave_live_partner_accruals (
  intent_id bigint PRIMARY KEY REFERENCES flutterwave_live_collection_evidence(intent_id),
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  partner_profile_id integer NOT NULL CHECK (partner_profile_id > 0),
  amount_minor integer NOT NULL CHECK (amount_minor = 10000),
  state text NOT NULL CHECK (state IN ('ACCRUED','HELD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (intent_id,environment,partner_profile_id,amount_minor)
    REFERENCES flutterwave_live_subscription_intents
      (id,environment,partner_profile_id,partner_accrual_minor)
);

-- Freeze reviewed identity/recipient/eligibility snapshots; never release a hold.
CREATE FUNCTION guard_flutterwave_live_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain LIVE intent history'; END IF;
  IF (to_jsonb(NEW) - 'state' - 'on_hold' - 'verified_transaction_id' - 'verified_provider_reference') IS DISTINCT FROM
     (to_jsonb(OLD) - 'state' - 'on_hold' - 'verified_transaction_id' - 'verified_provider_reference')
    OR (OLD.on_hold AND NOT NEW.on_hold)
    OR (OLD.verified_transaction_id IS NOT NULL AND OLD.verified_transaction_id IS DISTINCT FROM NEW.verified_transaction_id)
    OR (OLD.verified_provider_reference IS NOT NULL AND OLD.verified_provider_reference IS DISTINCT FROM NEW.verified_provider_reference) THEN
    RAISE EXCEPTION 'LIVE intent snapshot and holds are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER live_intent_history_guard BEFORE UPDATE OR DELETE ON flutterwave_live_subscription_intents
  FOR EACH ROW EXECUTE FUNCTION guard_flutterwave_live_intent();

CREATE FUNCTION retain_flutterwave_live_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Retain immutable LIVE design evidence'; END $$;
CREATE TRIGGER live_collection_history_guard BEFORE UPDATE OR DELETE ON flutterwave_live_collection_evidence
  FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TRIGGER live_event_history_guard BEFORE UPDATE OR DELETE ON flutterwave_live_finalization_events
  FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();
CREATE TRIGGER live_receipt_result_guard BEFORE UPDATE OR DELETE ON flutterwave_live_receipt_results
  FOR EACH ROW EXECUTE FUNCTION retain_flutterwave_live_history();

CREATE FUNCTION guard_flutterwave_live_accrual() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain LIVE accrual history'; END IF;
  IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state')
    OR (OLD.state = 'HELD' AND NEW.state <> 'HELD') THEN
    RAISE EXCEPTION 'LIVE accrual amounts and holds are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER live_accrual_history_guard BEFORE UPDATE OR DELETE ON flutterwave_live_partner_accruals
  FOR EACH ROW EXECUTE FUNCTION guard_flutterwave_live_accrual();
COMMENT ON TABLE flutterwave_live_collection_evidence IS
  'Offline-reviewed LIVE finalization design only; no shared subscription activation, official receipt, bank settlement, VAT or refund recovery proof.';
COMMENT ON TABLE flutterwave_live_partner_accruals IS
  'Internal liability only. No checkout recipient, approval/export/transfer/Paid capability. Term-end review integration remains blocked.';
COMMIT;
