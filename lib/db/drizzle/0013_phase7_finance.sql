-- Phase 7 finance foundation. Additive only; review before applying.
CREATE TABLE "fee_school_settings" (
  "school_id" integer PRIMARY KEY REFERENCES "schools"("id"),
  "partial_payments_enabled" boolean NOT NULL DEFAULT false,
  "updated_by" integer REFERENCES "app_users"("id"),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "fee_categories" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "name" text NOT NULL,
  "description" text,
  "compulsory" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_categories_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_categories_school_name_unique" UNIQUE ("school_id", "name"),
  CONSTRAINT "fee_categories_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX "fee_categories_school_status_idx" ON "fee_categories" ("school_id", "status");

CREATE TABLE "fee_structures" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "academic_session_id" integer NOT NULL,
  "academic_term_id" integer NOT NULL,
  "school_class_id" integer NOT NULL,
  "section" text,
  "version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "published_by" integer REFERENCES "app_users"("id"),
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_structures_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_structures_session_school_fk" FOREIGN KEY ("academic_session_id", "school_id") REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "fee_structures_term_school_fk" FOREIGN KEY ("academic_term_id", "school_id") REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "fee_structures_class_school_fk" FOREIGN KEY ("school_class_id", "school_id") REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "fee_structures_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','INACTIVE'))
);
CREATE UNIQUE INDEX "fee_structures_version_context_unique"
  ON "fee_structures" ("school_id", "academic_session_id", "academic_term_id", "school_class_id", COALESCE("section", ''), "version");
CREATE INDEX "fee_structures_school_context_idx" ON "fee_structures" ("school_id", "academic_session_id", "academic_term_id", "school_class_id");

CREATE TABLE "fee_structure_lines" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "structure_id" integer NOT NULL,
  "category_id" integer NOT NULL,
  "category_name_snapshot" text NOT NULL,
  "description_snapshot" text NOT NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
  CONSTRAINT "fee_structure_lines_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_structure_lines_structure_school_fk" FOREIGN KEY ("structure_id", "school_id") REFERENCES "fee_structures"("id", "school_id"),
  CONSTRAINT "fee_structure_lines_category_school_fk" FOREIGN KEY ("category_id", "school_id") REFERENCES "fee_categories"("id", "school_id"),
  CONSTRAINT "fee_structure_lines_structure_category_unique" UNIQUE ("structure_id", "category_id")
);

CREATE TABLE "fee_invoices" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer NOT NULL,
  "parent_id" integer,
  "structure_id" integer,
  "academic_session_id" integer NOT NULL,
  "academic_term_id" integer NOT NULL,
  "invoice_number" text NOT NULL,
  "student_name_snapshot" text NOT NULL,
  "admission_no_snapshot" text NOT NULL,
  "class_name_snapshot" text NOT NULL,
  "section_snapshot" text NOT NULL,
  "issue_date" date NOT NULL,
  "due_date" date NOT NULL,
  "currency" text NOT NULL DEFAULT 'NGN',
  "subtotal_minor" integer NOT NULL,
  "discount_minor" integer NOT NULL DEFAULT 0,
  "waiver_minor" integer NOT NULL DEFAULT 0,
  "total_minor" integer NOT NULL,
  "paid_minor" integer NOT NULL DEFAULT 0,
  "outstanding_minor" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'UNPAID',
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_invoices_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_invoices_school_number_unique" UNIQUE ("school_id", "invoice_number"),
  CONSTRAINT "fee_invoices_assignment_unique" UNIQUE ("school_id", "student_id", "structure_id"),
  CONSTRAINT "fee_invoices_student_school_fk" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id"),
  CONSTRAINT "fee_invoices_structure_school_fk" FOREIGN KEY ("structure_id", "school_id") REFERENCES "fee_structures"("id", "school_id"),
  CONSTRAINT "fee_invoices_session_school_fk" FOREIGN KEY ("academic_session_id", "school_id") REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "fee_invoices_term_school_fk" FOREIGN KEY ("academic_term_id", "school_id") REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "fee_invoices_amounts_check" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "waiver_minor" >= 0
    AND "discount_minor" + "waiver_minor" <= "subtotal_minor"
    AND "total_minor" = "subtotal_minor" - "discount_minor" - "waiver_minor"
    AND "paid_minor" >= 0 AND "paid_minor" <= "total_minor"
    AND "outstanding_minor" = "total_minor" - "paid_minor"
  ),
  CONSTRAINT "fee_invoices_status_check" CHECK ("status" IN ('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','WAIVED','CANCELLED'))
);
CREATE INDEX "fee_invoices_school_student_idx" ON "fee_invoices" ("school_id", "student_id", "academic_session_id", "academic_term_id");

CREATE TABLE "fee_invoice_lines" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "invoice_id" integer NOT NULL,
  "category_id" integer,
  "category_name_snapshot" text NOT NULL,
  "description_snapshot" text NOT NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" >= 0),
  CONSTRAINT "fee_invoice_lines_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_invoice_lines_invoice_school_fk" FOREIGN KEY ("invoice_id", "school_id") REFERENCES "fee_invoices"("id", "school_id"),
  CONSTRAINT "fee_invoice_lines_category_school_fk" FOREIGN KEY ("category_id", "school_id") REFERENCES "fee_categories"("id", "school_id")
);
CREATE INDEX "fee_invoice_lines_invoice_idx" ON "fee_invoice_lines" ("school_id", "invoice_id");

CREATE TABLE "fee_adjustments" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "invoice_id" integer NOT NULL,
  "kind" text NOT NULL,
  "amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "requested_by" integer NOT NULL REFERENCES "app_users"("id"),
  "approved_by" integer REFERENCES "app_users"("id"),
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_adjustments_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_adjustments_invoice_school_fk" FOREIGN KEY ("invoice_id", "school_id") REFERENCES "fee_invoices"("id", "school_id"),
  CONSTRAINT "fee_adjustments_kind_check" CHECK ("kind" IN ('DISCOUNT','SCHOLARSHIP','WAIVER')),
  CONSTRAINT "fee_adjustments_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED'))
);
CREATE INDEX "fee_adjustments_invoice_idx" ON "fee_adjustments" ("school_id", "invoice_id", "status");

CREATE TABLE "fee_payments" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "invoice_id" integer NOT NULL,
  "student_id" integer NOT NULL,
  "parent_id" integer,
  "reference" text NOT NULL UNIQUE,
  "idempotency_key" text NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'NGN',
  "method" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'MANUAL_BANK_TRANSFER',
  "provider_transaction_id" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "transfer_bank" text,
  "transfer_reference" text,
  "transfer_date" date,
  "proof_url" text,
  "submitted_by" integer NOT NULL REFERENCES "app_users"("id"),
  "verified_by" integer REFERENCES "app_users"("id"),
  "verified_at" timestamp with time zone,
  "verification_evidence_ref" text,
  "reviewer_notes" text,
  "verification_metadata" jsonb,
  "rejection_reason" text,
  "provider_metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_payments_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "fee_payments_school_idempotency_unique" UNIQUE ("school_id", "idempotency_key"),
  CONSTRAINT "fee_payments_provider_tx_unique" UNIQUE ("provider", "provider_transaction_id"),
  CONSTRAINT "fee_payments_invoice_school_fk" FOREIGN KEY ("invoice_id", "school_id") REFERENCES "fee_invoices"("id", "school_id"),
  CONSTRAINT "fee_payments_student_school_fk" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id"),
  CONSTRAINT "fee_payments_method_check" CHECK ("method" IN ('BANK_TRANSFER','REMITA','FLUTTERWAVE','PAYSTACK')),
  CONSTRAINT "fee_payments_status_check" CHECK ("status" IN ('PENDING','PROCESSING','VERIFIED','FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED')),
  CONSTRAINT "fee_payments_amount_currency_check" CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "fee_payments_verified_evidence_check" CHECK (
    "method" <> 'BANK_TRANSFER' OR "status" <> 'VERIFIED' OR (
      "verified_by" IS NOT NULL AND "verified_at" IS NOT NULL
      AND NULLIF(BTRIM("verification_evidence_ref"), '') IS NOT NULL
      AND NULLIF(BTRIM("reviewer_notes"), '') IS NOT NULL
      AND "verification_metadata" IS NOT NULL
    )
  ),
  CONSTRAINT "fee_payments_rejection_reason_check" CHECK (
    "status" <> 'REJECTED' OR NULLIF(BTRIM("rejection_reason"), '') IS NOT NULL
  )
);
CREATE INDEX "fee_payments_school_status_idx" ON "fee_payments" ("school_id", "status", "created_at");

CREATE FUNCTION "protect_fee_payment_verification_metadata"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.verification_metadata IS NOT NULL AND (
    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref
    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes
    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata
    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
  ) THEN
    RAISE EXCEPTION 'verified payment metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fee_payments_verification_metadata_immutable"
  BEFORE UPDATE ON "fee_payments"
  FOR EACH ROW EXECUTE FUNCTION "protect_fee_payment_verification_metadata"();

CREATE TABLE "fee_receipts" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "payment_id" integer NOT NULL,
  "receipt_number" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fee_receipts_payment_unique" UNIQUE ("payment_id"),
  CONSTRAINT "fee_receipts_school_number_unique" UNIQUE ("school_id", "receipt_number"),
  CONSTRAINT "fee_receipts_payment_school_fk" FOREIGN KEY ("payment_id", "school_id") REFERENCES "fee_payments"("id", "school_id")
);