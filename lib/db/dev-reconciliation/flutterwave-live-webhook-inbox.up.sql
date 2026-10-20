-- REVIEW-ONLY additive migration. Not in the automatic migration journal.
-- Apply only to a separately verified Development target after review.
-- This inbox is not payment, settlement, refund or commission evidence.
BEGIN;
CREATE TABLE flutterwave_live_webhook_receipts (
  id bigserial PRIMARY KEY,
  provider text NOT NULL DEFAULT 'FLUTTERWAVE' CHECK (provider = 'FLUTTERWAVE'),
  environment text NOT NULL DEFAULT 'LIVE' CHECK (environment = 'LIVE'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_bytes integer NOT NULL CHECK (payload_bytes BETWEEN 1 AND 65536),
  -- Whitelisted untrusted claims only: no raw body, headers or customer/bank data.
  claims jsonb NOT NULL CHECK (jsonb_typeof(claims) = 'object' AND octet_length(claims::text) <= 4096),
  signature_verified boolean NOT NULL CHECK (signature_verified = true),
  processing_status text NOT NULL DEFAULT 'BLOCKED_PENDING_REVIEW'
    CHECK (processing_status = 'BLOCKED_PENDING_REVIEW'),
  delivery_count integer NOT NULL DEFAULT 1 CHECK (delivery_count > 0),
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flutterwave_live_receipt_namespace_uq UNIQUE (provider, environment, payload_sha256)
);
COMMENT ON TABLE flutterwave_live_webhook_receipts IS
  'Authenticated LIVE delivery fingerprints and unverified claims only. Never implies payment verification, durable financial processing or HTTP200 eligibility. Raw payload is deliberately not retained for replay.';
COMMIT;
