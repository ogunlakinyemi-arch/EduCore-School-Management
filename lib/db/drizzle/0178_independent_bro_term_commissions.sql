-- PREPARED ONLY. Do not apply until recovery safety clearance and explicit schema approval.
-- No seed, activation, legacy repricing, provider configuration or payment.
BEGIN;
CREATE TABLE bro_term_commission_entitlements (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_term_id integer NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  partner_profile_id integer NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT,
  attribution_id integer NOT NULL REFERENCES school_partner_attributions(id) ON DELETE RESTRICT,
  policy_id bigint NOT NULL REFERENCES subscription_rule_proposals(id) ON DELETE RESTRICT,
  direct_obligation_id bigint NOT NULL REFERENCES student_direct_live_obligations(id) ON DELETE RESTRICT,
  direct_attempt_id bigint NOT NULL UNIQUE REFERENCES student_direct_live_attempts(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CHECK(amount_minor=15000),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  status text NOT NULL DEFAULT 'PENDING_OWNER_APPROVAL' CHECK(status='PENDING_OWNER_APPROVAL'),
  earned_at timestamptz NOT NULL,
  evidence jsonb NOT NULL CHECK((jsonb_typeof(evidence)='object'
    AND evidence->>'funding'='SEPARATE_PLATFORM_EXPENSE'
    AND (evidence->>'studentCollectionMinor')::integer=320000
    AND (evidence->>'collectionBroShareMinor')::integer=0) IS TRUE),
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bro_term_commission_scope_uq UNIQUE(student_id,academic_term_id)
);
CREATE FUNCTION guard_bro_term_commission_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BRO term commission evidence is append-only'; END $$;
CREATE TRIGGER bro_term_commission_append_only BEFORE UPDATE OR DELETE ON bro_term_commission_entitlements
  FOR EACH ROW EXECUTE FUNCTION guard_bro_term_commission_history();
CREATE FUNCTION guard_bro_term_commission_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o
    JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
    JOIN school_partner_attributions at ON at.id=NEW.attribution_id AND at.school_id=o.school_id
      AND at.partner_profile_id=NEW.partner_profile_id
    JOIN subscription_rule_proposals p ON p.id=NEW.policy_id AND p.product='BRO_COMMISSION'
      AND p.status IN ('ACTIVE','SCHEDULED') AND p.amount_minor=15000 AND p.activated_at IS NOT NULL
    WHERE o.id=NEW.direct_obligation_id AND a.id=NEW.direct_attempt_id
      AND o.school_id=NEW.school_id AND o.student_id=NEW.student_id AND o.academic_term_id=NEW.academic_term_id
      AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0 AND o.currency='NGN'
      AND a.state='PAID' AND a.verified_at=NEW.earned_at AND a.provider_transaction_id IS NOT NULL
      AND p.effective_at<=(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
      AND (p.ends_at IS NULL OR p.ends_at>(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'))
  ) THEN RAISE EXCEPTION 'Independent BRO earning scope or approval is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bro_term_commission_scope_guard BEFORE INSERT ON bro_term_commission_entitlements
  FOR EACH ROW EXECUTE FUNCTION guard_bro_term_commission_scope();
COMMIT;
