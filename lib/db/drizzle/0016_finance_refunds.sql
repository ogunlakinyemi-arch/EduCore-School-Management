-- Immutable refund ledger records. Original fee payments and receipts are never rewritten.
CREATE TABLE "fee_refunds" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "payment_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "reference" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "requested_by" integer NOT NULL REFERENCES "app_users"("id"),
  "approved_by" integer REFERENCES "app_users"("id"),
  "evidence_reference" text,
  "reviewer_notes" text,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fee_refunds_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_refunds_reference_unique" UNIQUE ("reference"),
  CONSTRAINT "fee_refunds_school_idempotency_unique" UNIQUE ("school_id", "idempotency_key"),
  CONSTRAINT "fee_refunds_payment_invoice_school_fk"
    FOREIGN KEY ("payment_id", "invoice_id", "school_id")
    REFERENCES "fee_payments"("id", "invoice_id", "school_id"),
  CONSTRAINT "fee_refunds_amount_check"
    CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "fee_refunds_status_check"
    CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT "fee_refunds_approval_evidence_check"
    CHECK ("status" <> 'APPROVED' OR (
      "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL
      AND NULLIF(BTRIM("evidence_reference"), '') IS NOT NULL
      AND NULLIF(BTRIM("reviewer_notes"), '') IS NOT NULL
    ))
);
CREATE INDEX "fee_refunds_school_status_idx"
  ON "fee_refunds" ("school_id", "status", "created_at");
CREATE UNIQUE INDEX "fee_refunds_school_evidence_unique"
  ON "fee_refunds" ("school_id", LOWER(BTRIM("evidence_reference")))
  WHERE "status"='APPROVED' AND NULLIF(BTRIM("evidence_reference"), '') IS NOT NULL;