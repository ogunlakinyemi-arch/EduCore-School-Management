-- Incremental schema for per-staff/per-academic-term NFC billing.
-- Intentionally does not edit or replay any existing structural migration.
-- Apply only through the project owner's approved Development schema workflow.

CREATE TABLE staff_nfc_billing_rules (
  id serial PRIMARY KEY,
  version integer NOT NULL,
  product text NOT NULL DEFAULT 'TEACHER_STAFF_NFC_EID',
  billing_frequency text NOT NULL DEFAULT 'ACADEMIC_TERM',
  price_minor integer NOT NULL,
  school_share_minor integer NOT NULL,
  platform_share_minor integer NOT NULL,
  partner_commission_minor integer NOT NULL,
  no_partner_platform_share_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'ACTIVE',
  effective_at timestamptz NOT NULL,
  created_by integer REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_nfc_billing_rules_product_ck
    CHECK (product = 'TEACHER_STAFF_NFC_EID'),
  CONSTRAINT staff_nfc_billing_rules_frequency_ck
    CHECK (billing_frequency = 'ACADEMIC_TERM'),
  CONSTRAINT staff_nfc_billing_rules_currency_ck CHECK (currency = 'NGN'),
  CONSTRAINT staff_nfc_billing_rules_status_ck CHECK (status = 'ACTIVE'),
  CONSTRAINT staff_nfc_billing_rules_amounts_ck CHECK (
    price_minor > 0 AND school_share_minor >= 0 AND platform_share_minor >= 0
    AND partner_commission_minor >= 0 AND no_partner_platform_share_minor >= 0
    AND school_share_minor + platform_share_minor + partner_commission_minor = price_minor
    AND school_share_minor + no_partner_platform_share_minor = price_minor
  ),
  CONSTRAINT staff_nfc_billing_rules_product_version_uq UNIQUE (product, version),
  CONSTRAINT staff_nfc_billing_rules_product_effective_uq UNIQUE (product, effective_at),
  CONSTRAINT staff_nfc_billing_rules_id_product_uq UNIQUE (id, product),
  CONSTRAINT staff_nfc_billing_rules_id_version_uq UNIQUE (id, version)
);
CREATE INDEX staff_nfc_billing_rules_effective_idx
  ON staff_nfc_billing_rules (product, effective_at DESC);

-- Seed a single initial policy. This inserts a rule only: no live subscriptions
-- are backfilled, activated, repriced, or charged during migration.
INSERT INTO staff_nfc_billing_rules
  (version, price_minor, school_share_minor, platform_share_minor,
   partner_commission_minor, no_partner_platform_share_minor, currency, effective_at)
VALUES
  (1, 200000, 80000, 110000, 10000, 120000, 'NGN', '1970-01-01T00:00:00Z')
ON CONFLICT (product, version) DO NOTHING;

CREATE TABLE staff_nfc_subscriptions (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  employee_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  product text NOT NULL DEFAULT 'TEACHER_STAFF_NFC_EID',
  billing_rule_id integer NOT NULL,
  billing_rule_version integer NOT NULL,
  price_minor integer NOT NULL,
  school_share_minor integer NOT NULL,
  platform_share_minor integer NOT NULL,
  partner_share_minor integer NOT NULL DEFAULT 0,
  partner_profile_id integer REFERENCES partner_profiles(id) ON DELETE RESTRICT,
  attribution_id integer REFERENCES school_partner_attributions(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'UNPAID',
  due_date date NOT NULL,
  created_by integer REFERENCES app_users(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_nfc_subscriptions_employee_term_uq
    UNIQUE (employee_id, school_id, academic_session_id, academic_term_id),
  CONSTRAINT staff_nfc_subscriptions_id_school_uq UNIQUE (id, school_id),
  CONSTRAINT staff_nfc_subscriptions_id_employee_school_term_uq
    UNIQUE (id, employee_id, school_id, academic_session_id, academic_term_id),
  CONSTRAINT staff_nfc_subscriptions_employee_school_fk
    FOREIGN KEY (employee_id, school_id) REFERENCES employees(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_subscriptions_session_school_fk
    FOREIGN KEY (academic_session_id, school_id)
    REFERENCES academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_subscriptions_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES academic_terms(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_subscriptions_rule_version_fk
    FOREIGN KEY (billing_rule_id, billing_rule_version)
    REFERENCES staff_nfc_billing_rules(id, version) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_subscriptions_product_ck
    CHECK (product = 'TEACHER_STAFF_NFC_EID'),
  CONSTRAINT staff_nfc_subscriptions_allocation_ck CHECK (
    price_minor > 0 AND school_share_minor >= 0 AND platform_share_minor >= 0
    AND partner_share_minor >= 0
    AND school_share_minor + platform_share_minor + partner_share_minor = price_minor
    AND ((partner_profile_id IS NULL AND partner_share_minor = 0 AND attribution_id IS NULL)
      OR (partner_profile_id IS NOT NULL AND attribution_id IS NOT NULL))
  ),
  CONSTRAINT staff_nfc_subscriptions_status_ck
    CHECK (status IN ('UNPAID','PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  CONSTRAINT staff_nfc_subscriptions_currency_ck CHECK (currency = 'NGN')
);
CREATE INDEX staff_nfc_subscriptions_school_term_status_idx
  ON staff_nfc_subscriptions (school_id, academic_session_id, academic_term_id, status);
CREATE INDEX staff_nfc_subscriptions_partner_term_idx
  ON staff_nfc_subscriptions (partner_profile_id, academic_session_id, academic_term_id)
  WHERE partner_profile_id IS NOT NULL;

CREATE TABLE staff_nfc_payments (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL,
  employee_id integer NOT NULL,
  school_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  provider text NOT NULL,
  provider_mode text NOT NULL,
  reference text NOT NULL,
  idempotency_key text NOT NULL,
  gross_amount_minor integer NOT NULL,
  provider_fee_minor integer,
  settlement_amount_minor integer,
  refunded_amount_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'PENDING',
  settlement_status text NOT NULL DEFAULT 'PENDING',
  reconciliation_status text NOT NULL DEFAULT 'PENDING',
  refund_status text NOT NULL DEFAULT 'NONE',
  checkout_url text,
  provider_transaction_id text,
  provider_paid_at timestamptz,
  paid_at timestamptz,
  failure_code text,
  created_by integer REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_nfc_payments_reference_uq UNIQUE (reference),
  CONSTRAINT staff_nfc_payments_employee_idempotency_uq UNIQUE (employee_id, idempotency_key),
  CONSTRAINT staff_nfc_payments_id_subscription_school_uq UNIQUE (id, subscription_id, school_id),
  CONSTRAINT staff_nfc_payments_subscription_owner_term_fk
    FOREIGN KEY (subscription_id, employee_id, school_id, academic_session_id, academic_term_id)
    REFERENCES staff_nfc_subscriptions(id, employee_id, school_id, academic_session_id, academic_term_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_payments_provider_ck CHECK (provider IN ('FLUTTERWAVE','MOCK')),
  CONSTRAINT staff_nfc_payments_provider_mode_ck CHECK (provider_mode IN ('SANDBOX','DEVELOPMENT_MOCK')),
  CONSTRAINT staff_nfc_payments_money_ck CHECK (
    gross_amount_minor > 0 AND (provider_fee_minor IS NULL OR provider_fee_minor >= 0)
    AND (settlement_amount_minor IS NULL OR settlement_amount_minor >= 0)
    AND refunded_amount_minor >= 0 AND refunded_amount_minor <= gross_amount_minor
    AND currency = 'NGN'
  ),
  CONSTRAINT staff_nfc_payments_status_ck
    CHECK (status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED','RECONCILIATION_REQUIRED')),
  CONSTRAINT staff_nfc_payments_settlement_ck
    CHECK (settlement_status IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
  CONSTRAINT staff_nfc_payments_reconciliation_ck
    CHECK (reconciliation_status IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
  CONSTRAINT staff_nfc_payments_refund_ck
    CHECK (refund_status IN ('NONE','PENDING','PARTIALLY_REFUNDED','REFUNDED','RECONCILIATION_REQUIRED'))
);
CREATE UNIQUE INDEX staff_nfc_payments_provider_transaction_uq
  ON staff_nfc_payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX staff_nfc_payments_one_pending_attempt_per_subscription_uq
  ON staff_nfc_payments (subscription_id)
  WHERE status IN ('PENDING','RECONCILIATION_REQUIRED');
CREATE INDEX staff_nfc_payments_school_status_idx
  ON staff_nfc_payments (school_id, status, created_at DESC);
CREATE INDEX staff_nfc_payments_term_idx
  ON staff_nfc_payments (school_id, academic_session_id, academic_term_id);

CREATE TABLE staff_nfc_refunds (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL,
  school_id integer NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  idempotency_key text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED',
  provider_refund_id text,
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  provider_verified_at timestamptz,
  failure_code text,
  CONSTRAINT staff_nfc_refunds_payment_idempotency_uq UNIQUE (payment_id, idempotency_key),
  CONSTRAINT staff_nfc_refunds_id_payment_school_uq UNIQUE (id, payment_id, school_id),
  CONSTRAINT staff_nfc_refunds_payment_school_fk
    FOREIGN KEY (payment_id, school_id)
    REFERENCES staff_nfc_payments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_refunds_status_ck
    CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  CONSTRAINT staff_nfc_refunds_reason_ck
    CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500)
);
CREATE UNIQUE INDEX staff_nfc_refunds_provider_id_uq
  ON staff_nfc_refunds (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
CREATE INDEX staff_nfc_refunds_school_status_idx
  ON staff_nfc_refunds (school_id, status, created_at DESC);

CREATE TABLE staff_nfc_allocations (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  entry_type text NOT NULL DEFAULT 'CREDIT',
  product text NOT NULL DEFAULT 'TEACHER_STAFF_NFC_EID',
  recipient_type text NOT NULL,
  recipient_id integer,
  school_id integer NOT NULL,
  employee_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  subscription_id integer NOT NULL,
  payment_id integer NOT NULL,
  refund_id integer,
  allocation_rule_id integer NOT NULL,
  billing_rule_version integer NOT NULL,
  attribution_id integer REFERENCES school_partner_attributions(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'NGN',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_nfc_allocations_id_payment_type_uq UNIQUE (id, payment_id, recipient_type),
  CONSTRAINT staff_nfc_allocations_subscription_owner_term_fk
    FOREIGN KEY (subscription_id, employee_id, school_id, academic_session_id, academic_term_id)
    REFERENCES staff_nfc_subscriptions(id, employee_id, school_id, academic_session_id, academic_term_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_allocations_payment_subscription_school_fk
    FOREIGN KEY (payment_id, subscription_id, school_id)
    REFERENCES staff_nfc_payments(id, subscription_id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_allocations_refund_payment_school_fk
    FOREIGN KEY (refund_id, payment_id, school_id)
    REFERENCES staff_nfc_refunds(id, payment_id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_allocations_rule_product_fk
    FOREIGN KEY (allocation_rule_id, product)
    REFERENCES staff_nfc_billing_rules(id, product) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_allocations_type_ck CHECK (recipient_type IN ('SCHOOL','PLATFORM','PARTNER')),
  CONSTRAINT staff_nfc_allocations_product_ck CHECK (product = 'TEACHER_STAFF_NFC_EID'),
  CONSTRAINT staff_nfc_allocations_entry_ck CHECK (entry_type IN ('CREDIT','REVERSAL')),
  CONSTRAINT staff_nfc_allocations_currency_ck CHECK (currency = 'NGN'),
  CONSTRAINT staff_nfc_allocations_refund_entry_ck
    CHECK ((entry_type = 'CREDIT' AND recipient_type IN ('SCHOOL','PLATFORM','PARTNER') AND refund_id IS NULL)
      OR (entry_type = 'REVERSAL' AND recipient_type IN ('SCHOOL','PLATFORM','PARTNER') AND refund_id IS NOT NULL)
      OR (entry_type = 'EXPENSE' AND recipient_type = 'PLATFORM_PROVIDER_FEE' AND refund_id IS NULL))
);
CREATE UNIQUE INDEX staff_nfc_allocations_credit_payment_type_uq
  ON staff_nfc_allocations (payment_id, recipient_type)
  WHERE entry_type = 'CREDIT';
CREATE INDEX staff_nfc_allocations_school_term_idx
  ON staff_nfc_allocations (school_id, academic_session_id, academic_term_id, created_at DESC);
CREATE INDEX staff_nfc_allocations_partner_idx
  ON staff_nfc_allocations (recipient_id, created_at DESC)
  WHERE recipient_type = 'PARTNER';

CREATE TABLE staff_nfc_provider_events (
  id serial PRIMARY KEY,
  provider text NOT NULL DEFAULT 'FLUTTERWAVE',
  event_id text NOT NULL,
  provider_reference text NOT NULL,
  provider_transaction_id text NOT NULL,
  payload_sha256 text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT true,
  outcome text NOT NULL DEFAULT 'RECEIVED',
  payment_id integer,
  school_id integer,
  failure_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT staff_nfc_provider_events_provider_event_uq UNIQUE (provider, event_id),
  CONSTRAINT staff_nfc_provider_events_payment_school_fk
    FOREIGN KEY (payment_id, school_id)
    REFERENCES staff_nfc_payments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_provider_events_provider_ck CHECK (provider = 'FLUTTERWAVE'),
  CONSTRAINT staff_nfc_provider_events_digest_ck CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT staff_nfc_provider_events_outcome_ck
    CHECK (outcome IN ('RECEIVED','VERIFIED','PENDING','FAILED','DUPLICATE','RECONCILIATION_REQUIRED','REFUND_PENDING','REFUNDED','PARTIAL_REFUND'))
);
CREATE INDEX staff_nfc_provider_events_payment_idx
  ON staff_nfc_provider_events (payment_id, outcome);

CREATE TABLE staff_nfc_partner_commissions (
  id serial PRIMARY KEY,
  allocation_id integer NOT NULL UNIQUE,
  partner_profile_id integer NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  employee_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  subscription_id integer NOT NULL,
  payment_id integer NOT NULL,
  recipient_type text NOT NULL DEFAULT 'PARTNER',
  commission_minor integer NOT NULL CHECK (commission_minor > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status text NOT NULL DEFAULT 'PENDING',
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_nfc_partner_commissions_subscription_uq UNIQUE (subscription_id),
  CONSTRAINT staff_nfc_partner_commissions_subscription_tenant_fk
    FOREIGN KEY (subscription_id, employee_id, school_id, academic_session_id, academic_term_id)
    REFERENCES staff_nfc_subscriptions(id, employee_id, school_id, academic_session_id, academic_term_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_partner_commissions_payment_tenant_fk
    FOREIGN KEY (payment_id, subscription_id, school_id)
    REFERENCES staff_nfc_payments(id, subscription_id, school_id) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_partner_commissions_allocation_fk
    FOREIGN KEY (allocation_id, payment_id, recipient_type)
    REFERENCES staff_nfc_allocations(id, payment_id, recipient_type) ON DELETE RESTRICT,
  CONSTRAINT staff_nfc_partner_commissions_recipient_ck CHECK (recipient_type = 'PARTNER'),
  CONSTRAINT staff_nfc_partner_commissions_status_ck CHECK (status IN ('PENDING','PAID','REVERSED'))
);
CREATE INDEX staff_nfc_partner_commissions_partner_idx
  ON staff_nfc_partner_commissions (partner_profile_id, status, created_at DESC);

CREATE TABLE staff_nfc_receipts (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL UNIQUE,
  subscription_id integer NOT NULL,
  school_id integer NOT NULL,
  receipt_number text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT staff_nfc_receipts_payment_owner_uq UNIQUE (payment_id, subscription_id, school_id),
  CONSTRAINT staff_nfc_receipts_payment_owner_fk
    FOREIGN KEY (payment_id, subscription_id, school_id)
    REFERENCES staff_nfc_payments(id, subscription_id, school_id) ON DELETE RESTRICT
);
CREATE INDEX staff_nfc_receipts_school_issue_idx ON staff_nfc_receipts (school_id, issued_at DESC);

-- Append-only history: failed attempts, provider transaction snapshots, refunds
-- and their reversible accounting entries remain independently auditable.
CREATE FUNCTION protect_staff_nfc_financial_snapshots() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Staff NFC billing rules, allocations, and issued receipts are immutable';
END;
$$;
CREATE TRIGGER staff_nfc_billing_rules_immutable
  BEFORE UPDATE OR DELETE ON staff_nfc_billing_rules
  FOR EACH ROW EXECUTE FUNCTION protect_staff_nfc_financial_snapshots();
CREATE TRIGGER staff_nfc_allocations_immutable
  BEFORE UPDATE OR DELETE ON staff_nfc_allocations
  FOR EACH ROW EXECUTE FUNCTION protect_staff_nfc_financial_snapshots();
CREATE TRIGGER staff_nfc_receipts_immutable
  BEFORE UPDATE OR DELETE ON staff_nfc_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_staff_nfc_financial_snapshots();
