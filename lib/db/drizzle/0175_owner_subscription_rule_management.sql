-- Additive management metadata. Existing billing and commission tables remain the
-- authoritative engines; drafts never create a payment or alter historical rows.
ALTER TABLE public.staff_nfc_billing_rules ADD COLUMN IF NOT EXISTS ends_at timestamptz;

CREATE TABLE IF NOT EXISTS public.subscription_rule_proposals (
  id bigserial PRIMARY KEY,
  product text NOT NULL CHECK (product IN ('STUDENT_PLATFORM','TEACHER_STAFF_PLATFORM','BRO_COMMISSION')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','RETIRED')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  billing_period text NOT NULL DEFAULT 'ACADEMIC_TERM' CHECK (billing_period = 'ACADEMIC_TERM'),
  school_share_minor integer NOT NULL DEFAULT 0 CHECK (school_share_minor = 0),
  effective_at timestamptz NOT NULL,
  ends_at timestamptz,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  native_rule_id integer,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by integer NOT NULL,
  updated_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > effective_at),
  CHECK (product <> 'TEACHER_STAFF_PLATFORM' OR amount_minor = 200000)
);
CREATE INDEX IF NOT EXISTS subscription_rule_proposals_product_window_idx
  ON public.subscription_rule_proposals (product,effective_at,ends_at,status);

CREATE TABLE IF NOT EXISTS public.subscription_payment_assistance_requests (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL,
  student_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','BANK_VERIFIED','CANCELLED')),
  request_note text NOT NULL DEFAULT '',
  bank_name text,
  bank_statement_reference text,
  bank_credit_date date,
  verified_amount_minor integer CHECK (verified_amount_minor > 0),
  verified_by integer,
  verified_at timestamptz,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'BANK_VERIFIED' OR (
    bank_name IS NOT NULL AND bank_statement_reference IS NOT NULL
    AND bank_credit_date IS NOT NULL AND verified_amount_minor = amount_minor
    AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS subscription_payment_assistance_queue_idx
  ON public.subscription_payment_assistance_requests (status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_assistance_open_uq
  ON public.subscription_payment_assistance_requests(school_id,student_id,academic_term_id)
  WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_assistance_bank_credit_uq
  ON public.subscription_payment_assistance_requests(bank_statement_reference)
  WHERE status = 'BANK_VERIFIED';
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_assistance_bank_credit_normalized_uq
  ON public.subscription_payment_assistance_requests(lower(btrim(bank_statement_reference)))
  WHERE status = 'BANK_VERIFIED';
