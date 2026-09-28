-- Additive online-fee provider enablement, checkout sessions, and durable webhook reconciliation.
ALTER TABLE "fee_school_settings"
  ADD COLUMN "paystack_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "flutterwave_enabled" boolean NOT NULL DEFAULT false;

CREATE TABLE "fee_provider_checkout_sessions" (
  "payment_id" integer PRIMARY KEY,
  "school_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "provider" text NOT NULL,
  "reference" text NOT NULL UNIQUE,
  "idempotency_key" text NOT NULL,
  "state" text NOT NULL DEFAULT 'INITIALIZING',
  "claim_token" text,
  "claim_expires_at" timestamp with time zone,
  "checkout_url" text,
  "provider_session_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempt_count" integer NOT NULL DEFAULT 1,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_provider_checkout_sessions_payment_school_fk"
    FOREIGN KEY ("payment_id", "school_id") REFERENCES "fee_payments" ("id", "school_id"),
  CONSTRAINT "fee_provider_checkout_sessions_invoice_school_fk"
    FOREIGN KEY ("invoice_id", "school_id") REFERENCES "fee_invoices" ("id", "school_id"),
  CONSTRAINT "fee_provider_checkout_sessions_provider_check"
    CHECK ("provider" IN ('PAYSTACK','FLUTTERWAVE')),
  CONSTRAINT "fee_provider_checkout_sessions_state_check"
    CHECK ("state" IN ('INITIALIZING','READY','FAILED','SETTLED','RELEASED')),
  CONSTRAINT "fee_provider_checkout_sessions_attempts_check"
    CHECK ("attempt_count" > 0),
  CONSTRAINT "fee_provider_checkout_sessions_claim_pair_check"
    CHECK (("claim_token" IS NULL) = ("claim_expires_at" IS NULL)),
  CONSTRAINT "fee_provider_checkout_sessions_ready_url_check"
    CHECK ("state" <> 'READY' OR "checkout_url" IS NOT NULL),
  CONSTRAINT "fee_provider_checkout_sessions_school_provider_idem_unique"
    UNIQUE ("school_id", "provider", "idempotency_key")
);

CREATE UNIQUE INDEX "fee_provider_checkout_sessions_one_open_invoice_unique"
  ON "fee_provider_checkout_sessions" ("school_id", "invoice_id")
  WHERE "state" IN ('INITIALIZING','READY','FAILED');

CREATE TABLE "fee_provider_webhook_events" (
  "id" serial PRIMARY KEY,
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "payment_id" integer,
  "school_id" integer,
  "provider_reference" text,
  "webhook_transaction_id" text,
  "verified_transaction_id" text,
  "status" text NOT NULL DEFAULT 'RECEIVED',
  "signature_verified" boolean NOT NULL DEFAULT false,
  "payload_sha256" text NOT NULL,
  "error_message" text,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  CONSTRAINT "fee_provider_webhook_events_provider_check"
    CHECK ("provider" IN ('PAYSTACK','FLUTTERWAVE')),
  CONSTRAINT "fee_provider_webhook_events_status_check"
    CHECK ("status" IN ('RECEIVED','VERIFIED','PENDING','FAILED','RECONCILIATION_REQUIRED')),
  CONSTRAINT "fee_provider_webhook_events_signature_link_check"
    CHECK ("payment_id" IS NULL OR ("school_id" IS NOT NULL
      AND ("signature_verified" OR "verified_transaction_id" IS NOT NULL))),
  CONSTRAINT "fee_provider_webhook_events_payment_school_fk"
    FOREIGN KEY ("payment_id", "school_id") REFERENCES "fee_payments" ("id", "school_id"),
  CONSTRAINT "fee_provider_webhook_events_school_fk"
    FOREIGN KEY ("school_id") REFERENCES "schools" ("id"),
  CONSTRAINT "fee_provider_webhook_events_provider_event_unique"
    UNIQUE ("provider", "event_id")
);

CREATE INDEX "fee_provider_webhook_events_school_status_idx"
  ON "fee_provider_webhook_events" ("school_id", "status", "received_at" DESC);
CREATE INDEX "fee_provider_webhook_events_reference_idx"
  ON "fee_provider_webhook_events" ("provider", "provider_reference", "received_at" DESC);