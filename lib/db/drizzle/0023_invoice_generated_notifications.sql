CREATE TABLE "fee_invoice_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "invoice_id" integer NOT NULL,
  "recipient_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "recipient_role" text NOT NULL,
  "event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
  "channel" text DEFAULT 'IN_APP' NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fee_invoice_notifications_id_school_unique" UNIQUE ("id","school_id"),
  CONSTRAINT "fee_invoice_notifications_delivery_unique" UNIQUE ("school_id","invoice_id","recipient_user_id","recipient_role","event_type"),
  CONSTRAINT "fee_invoice_notifications_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id")
    REFERENCES "fee_invoices"("id","school_id"),
  CONSTRAINT "fee_invoice_notifications_role_check" CHECK ("recipient_role" IN ('PARENT','STUDENT','SCHOOL_ADMIN','ACCOUNTANT')),
  CONSTRAINT "fee_invoice_notifications_event_check" CHECK ("event_type" = 'INVOICE_GENERATED'),
  CONSTRAINT "fee_invoice_notifications_channel_check" CHECK ("channel" = 'IN_APP'),
  CONSTRAINT "fee_invoice_notifications_read_check" CHECK (
    ("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL)
  )
);

CREATE INDEX "fee_invoice_notifications_recipient_idx"
  ON "fee_invoice_notifications" ("recipient_user_id","is_read","created_at");
CREATE INDEX "fee_invoice_notifications_school_idx"
  ON "fee_invoice_notifications" ("school_id","created_at");

CREATE TABLE "fee_invoice_notification_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "invoice_id" integer NOT NULL,
  "event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fee_invoice_notification_outbox_delivery_unique" UNIQUE ("school_id","invoice_id","event_type"),
  CONSTRAINT "fee_invoice_notification_outbox_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id")
    REFERENCES "fee_invoices"("id","school_id"),
  CONSTRAINT "fee_invoice_notification_outbox_event_check" CHECK ("event_type" = 'INVOICE_GENERATED'),
  CONSTRAINT "fee_invoice_notification_outbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "fee_invoice_notification_outbox_retry_idx"
  ON "fee_invoice_notification_outbox" ("school_id","next_attempt_at","created_at");