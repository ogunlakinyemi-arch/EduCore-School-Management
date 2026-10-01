-- Append-only student subscription checkout, verification and allocation ledger.
-- Historical subscriptions and commission_ledger entries are intentionally unchanged.
-- Apply only through the project owner's approved Development schema workflow.

CREATE UNIQUE INDEX subscriptions_id_school_student_uq
  ON subscriptions (id, school_id, student_id);

CREATE UNIQUE INDEX school_partner_attributions_id_partner_uq
  ON school_partner_attributions (id, partner_profile_id);

CREATE TABLE student_subscription_payments (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL,
  school_id integer NOT NULL,
  student_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  payer_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'FLUTTERWAVE',
  provider_mode text NOT NULL DEFAULT 'SANDBOX',
  reference text NOT NULL,
  idempotency_key text NOT NULL,
  gross_amount_minor integer NOT NULL DEFAULT 500000,
  provider_fee_minor integer,
  settlement_amount_minor integer,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'PENDING',
  settlement_status text NOT NULL DEFAULT 'PENDING',
  reconciliation_status text NOT NULL DEFAULT 'PENDING',
  checkout_url text,
  provider_transaction_id text,
  provider_paid_at timestamptz,
  paid_at timestamptz,
  failure_code text,
  receipt_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_subscription_payments_subscription_owner_fk
    FOREIGN KEY (subscription_id, school_id, student_id)
    REFERENCES subscriptions(id, school_id, student_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_payments_session_school_fk
    FOREIGN KEY (academic_session_id, school_id)
    REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_payments_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_payments_provider_ck CHECK (provider = 'FLUTTERWAVE'),
  CONSTRAINT student_subscription_payments_provider_mode_ck CHECK (provider_mode = 'SANDBOX'),
  CONSTRAINT student_subscription_payments_reference_ck
    CHECK (reference ~ '^[A-Za-z0-9_-]{8,100}$'),
  CONSTRAINT student_subscription_payments_money_ck CHECK (
    gross_amount_minor = 500000 AND currency = 'NGN'
    AND (provider_fee_minor IS NULL OR provider_fee_minor >= 0)
    AND (settlement_amount_minor IS NULL OR settlement_amount_minor BETWEEN 0 AND gross_amount_minor)
  ),
  CONSTRAINT student_subscription_payments_status_ck
    CHECK (status IN ('PENDING','PAID','FAILED','RECONCILIATION_REQUIRED')),
  CONSTRAINT student_subscription_payments_settlement_ck
    CHECK (settlement_status IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
  CONSTRAINT student_subscription_payments_reconciliation_ck
    CHECK (reconciliation_status IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
  CONSTRAINT student_subscription_payments_id_owner_term_uq
    UNIQUE (id, subscription_id, school_id, student_id, academic_session_id, academic_term_id)
);

CREATE UNIQUE INDEX student_subscription_payments_reference_uq
  ON student_subscription_payments (reference);
CREATE UNIQUE INDEX student_subscription_payments_provider_transaction_uq
  ON student_subscription_payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX student_subscription_payments_subscription_idempotency_uq
  ON student_subscription_payments (subscription_id, idempotency_key);
CREATE UNIQUE INDEX student_subscription_payments_one_open_attempt_uq
  ON student_subscription_payments (subscription_id)
  WHERE status IN ('PENDING','RECONCILIATION_REQUIRED');
CREATE UNIQUE INDEX student_subscription_payments_one_business_term_uq
  ON student_subscription_payments (school_id,student_id,academic_session_id,academic_term_id)
  WHERE status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
     OR reconciliation_status='RECONCILIATION_REQUIRED';
CREATE INDEX student_subscription_payments_school_status_idx
  ON student_subscription_payments (school_id, status, created_at DESC);
CREATE INDEX student_subscription_payments_term_idx
  ON student_subscription_payments (school_id, academic_session_id, academic_term_id);

CREATE FUNCTION protect_student_subscription_receipt_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.receipt_snapshot IS NOT NULL
     AND NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot THEN
    RAISE EXCEPTION 'Student subscription receipt snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER student_subscription_payment_receipt_immutable
  BEFORE UPDATE ON student_subscription_payments
  FOR EACH ROW EXECUTE FUNCTION protect_student_subscription_receipt_snapshot();

CREATE TABLE student_subscription_allocations (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL,
  entry_type text NOT NULL DEFAULT 'CREDIT',
  recipient_type text NOT NULL,
  recipient_id integer,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  payer_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  subscription_id integer NOT NULL,
  payment_id integer NOT NULL,
  attribution_id integer,
  commission_rule_id integer REFERENCES commission_rules(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_subscription_allocations_payment_owner_term_fk
    FOREIGN KEY (
      payment_id, subscription_id, school_id, student_id, academic_session_id, academic_term_id
    )
    REFERENCES student_subscription_payments (
      id, subscription_id, school_id, student_id, academic_session_id, academic_term_id
    ) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_allocations_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_allocations_session_school_fk
    FOREIGN KEY (academic_session_id, school_id)
    REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_allocations_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_allocations_attribution_partner_fk
    FOREIGN KEY (attribution_id, recipient_id)
    REFERENCES school_partner_attributions(id, partner_profile_id) ON DELETE RESTRICT,
  CONSTRAINT student_subscription_allocations_recipient_ck
    CHECK (recipient_type IN ('SCHOOL','PLATFORM','PARTNER','PLATFORM_PROVIDER_FEE')),
  CONSTRAINT student_subscription_allocations_entry_ck CHECK (entry_type IN ('CREDIT','REVERSAL','EXPENSE')),
  CONSTRAINT student_subscription_allocations_amount_ck CHECK (
    amount_minor > 0 AND currency = 'NGN'
    AND ((entry_type = 'CREDIT' AND recipient_type IN ('SCHOOL','PLATFORM','PARTNER'))
      OR (entry_type = 'REVERSAL' AND recipient_type IN ('SCHOOL','PLATFORM','PARTNER'))
      OR (entry_type = 'EXPENSE' AND recipient_type = 'PLATFORM_PROVIDER_FEE'))
  ),
  CONSTRAINT student_subscription_allocations_partner_ck CHECK (
    (recipient_type = 'PARTNER' AND recipient_id IS NOT NULL
      AND attribution_id IS NOT NULL AND commission_rule_id IS NOT NULL)
    OR (recipient_type <> 'PARTNER' AND recipient_id IS NULL)
  ),
  CONSTRAINT student_subscription_allocations_id_payment_entry_recipient_uq
    UNIQUE (id, payment_id, entry_type, recipient_type)
);

CREATE UNIQUE INDEX student_subscription_allocations_idempotency_uq
  ON student_subscription_allocations (idempotency_key);
CREATE UNIQUE INDEX student_subscription_allocations_payment_credit_recipient_uq
  ON student_subscription_allocations (payment_id, recipient_type)
  WHERE entry_type = 'CREDIT';
CREATE UNIQUE INDEX student_subscription_allocations_payment_fee_expense_uq
  ON student_subscription_allocations (payment_id)
  WHERE entry_type = 'EXPENSE' AND recipient_type = 'PLATFORM_PROVIDER_FEE';
CREATE INDEX student_subscription_allocations_school_term_idx
  ON student_subscription_allocations (school_id, academic_session_id, academic_term_id, created_at DESC);
CREATE INDEX student_subscription_allocations_partner_idx
  ON student_subscription_allocations (recipient_id, created_at DESC)
  WHERE recipient_type = 'PARTNER';

CREATE FUNCTION protect_student_subscription_allocations() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Student subscription allocations are immutable';
END;
$$;
CREATE TRIGGER student_subscription_allocations_immutable
  BEFORE UPDATE OR DELETE ON student_subscription_allocations
  FOR EACH ROW EXECUTE FUNCTION protect_student_subscription_allocations();