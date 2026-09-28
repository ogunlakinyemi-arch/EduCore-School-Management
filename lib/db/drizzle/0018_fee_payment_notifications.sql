-- School-scoped IN_APP notification ledger for verified fee payments.
-- A role-scoped uniqueness key allows a user with multiple school roles to
-- receive the appropriate independent notification for each role/event.
CREATE TABLE "fee_payment_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "payment_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "recipient_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "recipient_role" text NOT NULL,
  "event_type" text DEFAULT 'PAYMENT_VERIFIED' NOT NULL,
  "channel" text DEFAULT 'IN_APP' NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fee_payment_notifications_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_payment_notifications_delivery_unique"
    UNIQUE ("payment_id", "recipient_user_id", "recipient_role", "event_type"),
  CONSTRAINT "fee_payment_notifications_payment_invoice_school_fk"
    FOREIGN KEY ("payment_id", "invoice_id", "school_id")
    REFERENCES "fee_payments"("id", "invoice_id", "school_id"),
  CONSTRAINT "fee_payment_notifications_role_check"
    CHECK ("recipient_role" IN ('PARENT','STUDENT','SCHOOL_ADMIN','ACCOUNTANT')),
  CONSTRAINT "fee_payment_notifications_event_check"
    CHECK ("event_type" = 'PAYMENT_VERIFIED'),
  CONSTRAINT "fee_payment_notifications_channel_check"
    CHECK ("channel" = 'IN_APP'),
  CONSTRAINT "fee_payment_notifications_read_check"
    CHECK (("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL))
);
CREATE INDEX "fee_payment_notifications_recipient_idx"
  ON "fee_payment_notifications" ("recipient_user_id", "is_read", "created_at");
CREATE INDEX "fee_payment_notifications_school_idx"
  ON "fee_payment_notifications" ("school_id", "created_at");