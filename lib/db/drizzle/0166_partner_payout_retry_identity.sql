-- Forward-only, review-required migration. Never run automatically at app startup.
-- Existing histories and migration ledgers are not rewritten or marked applied.
-- The unique-index build intentionally FAILS on duplicate nonblank trimmed manual
-- references. An operator must review duplicates; never delete or rewrite history.
BEGIN;

CREATE TABLE public.partner_payout_requests (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL,
  payout_id integer NOT NULL REFERENCES public.partner_payouts(id) ON DELETE RESTRICT,
  response_snapshot jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_payout_requests_payout_unique UNIQUE (payout_id),
  CONSTRAINT partner_payout_requests_key_check CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  CONSTRAINT partner_payout_requests_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_payout_requests_response_check CHECK (jsonb_typeof(response_snapshot) = 'object')
);

CREATE UNIQUE INDEX partner_payouts_manual_reference_uq
  ON public.partner_payouts (btrim(payment_reference))
  WHERE payment_reference IS NOT NULL AND btrim(payment_reference) <> '';

COMMIT;
