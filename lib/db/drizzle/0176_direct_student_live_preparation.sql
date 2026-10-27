-- PREPARATION ONLY. Not applied by this change. Additive, no legacy repricing/backfill.
CREATE TABLE student_direct_live_reviews (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  academic_term_id integer NOT NULL REFERENCES academic_terms(id),
  rule_id bigint NOT NULL REFERENCES subscription_rule_proposals(id),
  report_digest text NOT NULL CHECK(report_digest ~ '^[a-f0-9]{64}$'),
  merchant_scope text NOT NULL CHECK(length(trim(merchant_scope)) BETWEEN 3 AND 120),
  no_split_confirmed boolean NOT NULL CHECK(no_split_confirmed),
  approved_by integer NOT NULL REFERENCES app_users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK(expires_at>approved_at),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500)
);
CREATE TABLE student_direct_live_obligations (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  student_id integer NOT NULL REFERENCES students(id),
  academic_term_id integer NOT NULL REFERENCES academic_terms(id),
  rule_id bigint NOT NULL REFERENCES subscription_rule_proposals(id),
  review_id bigint NOT NULL REFERENCES student_direct_live_reviews(id),
  merchant_scope text NOT NULL,
  amount_minor integer NOT NULL DEFAULT 320000 CHECK(amount_minor=320000),
  school_share_minor integer NOT NULL DEFAULT 0 CHECK(school_share_minor=0),
  bro_share_minor integer NOT NULL DEFAULT 0 CHECK(bro_share_minor=0),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  assistance_request_id bigint UNIQUE REFERENCES subscription_payment_assistance_requests(id),
  created_by integer NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,student_id,academic_term_id)
);
CREATE TABLE student_direct_live_attempts (
  id bigserial PRIMARY KEY,
  obligation_id bigint NOT NULL REFERENCES student_direct_live_obligations(id),
  reference text NOT NULL UNIQUE CHECK(reference ~ '^SCV4_live_[A-Za-z0-9_-]{8,80}$'),
  idempotency_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('RESERVED','READY','UNKNOWN','PENDING','FAILED','PAID')),
  checkout_url text,
  provider_transaction_id text UNIQUE,
  provider_reference text,
  provider_fee_minor integer CHECK(provider_fee_minor>=0),
  additional_fee_minor integer CHECK(additional_fee_minor>=0),
  verified_at timestamptz,
  created_by integer NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(state NOT IN ('PAID','FAILED') OR (provider_transaction_id ~ '^[1-9][0-9]*$' AND verified_at IS NOT NULL)),
  CHECK(state<>'PAID' OR (provider_reference IS NOT NULL AND provider_fee_minor IS NOT NULL
    AND additional_fee_minor IS NOT NULL AND provider_fee_minor+additional_fee_minor<320000)),
  UNIQUE(obligation_id,idempotency_key)
);
CREATE UNIQUE INDEX student_direct_one_open_or_paid ON student_direct_live_attempts(obligation_id)
  WHERE state<>'FAILED';
CREATE TABLE student_direct_live_events (
  id bigserial PRIMARY KEY,
  attempt_id bigint NOT NULL REFERENCES student_direct_live_attempts(id),
  kind text NOT NULL,
  actor_user_id integer REFERENCES app_users(id),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Reviews, frozen obligations and event history are append-only.
CREATE FUNCTION guard_student_direct_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Direct LIVE history is append-only'; END $$;
CREATE TRIGGER student_direct_review_history BEFORE UPDATE OR DELETE ON student_direct_live_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER student_direct_obligation_history BEFORE UPDATE OR DELETE ON student_direct_live_obligations
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER student_direct_event_history BEFORE UPDATE OR DELETE ON student_direct_live_events
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE FUNCTION guard_student_direct_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Direct LIVE attempts cannot be deleted'; END IF;
  IF (NEW.obligation_id,NEW.reference,NEW.idempotency_key,NEW.created_by,NEW.created_at)
       IS DISTINCT FROM (OLD.obligation_id,OLD.reference,OLD.idempotency_key,OLD.created_by,OLD.created_at)
     OR OLD.state IN ('PAID','FAILED') THEN RAISE EXCEPTION 'Direct LIVE attempt history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_direct_attempt_history BEFORE UPDATE OR DELETE ON student_direct_live_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_attempt();
