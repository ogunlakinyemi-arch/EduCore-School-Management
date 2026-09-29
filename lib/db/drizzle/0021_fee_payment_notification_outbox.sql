CREATE TABLE "fee_payment_notification_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "payment_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "event_reference_id" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fee_payment_notification_outbox_delivery_unique"
    UNIQUE ("payment_id","event_type","event_reference_id"),
  CONSTRAINT "fee_payment_notification_outbox_payment_invoice_school_fk"
    FOREIGN KEY ("payment_id","invoice_id","school_id")
    REFERENCES "fee_payments"("id","invoice_id","school_id"),
  CONSTRAINT "fee_payment_notification_outbox_event_check"
    CHECK (
      ("event_type" IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED') AND "event_reference_id"=0)
      OR ("event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "event_reference_id">0)
    )
);
CREATE INDEX "fee_payment_notification_outbox_retry_idx"
  ON "fee_payment_notification_outbox" ("school_id","next_attempt_at","created_at");