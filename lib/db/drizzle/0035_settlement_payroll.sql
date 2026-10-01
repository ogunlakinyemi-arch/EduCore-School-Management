-- Incremental school/company payroll and recipient configuration.
-- Does not rewrite existing Finance/NFC/commission records or contact any provider.
CREATE TABLE "settlement_payroll_profiles" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer REFERENCES "schools"("id") ON DELETE RESTRICT,
  "business_name" text NOT NULL,
  "business_registration_number" text,
  "settlement_contact_email" text NOT NULL,
  "settlement_contact_phone" text,
  "bank_name_encrypted" text NOT NULL,
  "bank_code_encrypted" text NOT NULL,
  "account_name_encrypted" text NOT NULL,
  "account_number_encrypted" text NOT NULL,
  "account_last4" text NOT NULL,
  "encryption_key_version" text NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "provider" text DEFAULT 'FLUTTERWAVE' NOT NULL,
  "provider_business_id" text,
  "provider_subaccount_id" text,
  "verification_status" text DEFAULT 'PENDING_VERIFICATION' NOT NULL,
  "verified_at" timestamp with time zone,
  "verified_by" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "updated_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "settlement_payroll_profiles_id_scope_school_unique" UNIQUE ("id","scope","school_id"),
  CONSTRAINT "settlement_payroll_profiles_tenant_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL)),
  CONSTRAINT "settlement_payroll_profiles_currency_check" CHECK ("currency"='NGN'),
  CONSTRAINT "settlement_payroll_profiles_provider_check" CHECK ("provider"='FLUTTERWAVE'),
  CONSTRAINT "settlement_payroll_profiles_account_last4_check" CHECK ("account_last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "settlement_payroll_profiles_encrypted_fields_check"
    CHECK (length(btrim("bank_name_encrypted"))>0 AND length(btrim("bank_code_encrypted"))>0
      AND length(btrim("account_name_encrypted"))>0 AND length(btrim("account_number_encrypted"))>0
      AND length(btrim("encryption_key_version"))>0),
  CONSTRAINT "settlement_payroll_profiles_verification_check"
    CHECK (("verification_status"='VERIFIED' AND "verified_at" IS NOT NULL AND "verified_by" IS NOT NULL)
        OR ("verification_status"<>'VERIFIED' AND "verified_at" IS NULL AND "verified_by" IS NULL))
);
CREATE UNIQUE INDEX "settlement_payroll_profiles_school_unique"
  ON "settlement_payroll_profiles" ("school_id") WHERE "scope"='SCHOOL';
CREATE UNIQUE INDEX "settlement_payroll_profiles_company_unique"
  ON "settlement_payroll_profiles" ("scope") WHERE "scope"='YEMAIT_COMPANY';
CREATE INDEX "settlement_payroll_profiles_verification_idx"
  ON "settlement_payroll_profiles" ("verification_status","updated_at");

CREATE TABLE "payroll_employee_profiles" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer REFERENCES "schools"("id") ON DELETE RESTRICT,
  "employee_id" integer,
  "company_employee_id" integer REFERENCES "platform_company_employees"("id") ON DELETE RESTRICT,
  "monthly_salary_minor" integer NOT NULL,
  "allowance_minor" integer DEFAULT 0 NOT NULL,
  "deduction_minor" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "bank_name_encrypted" text NOT NULL,
  "bank_code_encrypted" text NOT NULL,
  "account_name_encrypted" text NOT NULL,
  "account_number_encrypted" text NOT NULL,
  "account_last4" text NOT NULL,
  "encryption_key_version" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "updated_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_employee_profiles_id_scope_school_unique" UNIQUE ("id","scope","school_id"),
  CONSTRAINT "payroll_employee_profiles_tenant_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL AND "employee_id" IS NOT NULL AND "company_employee_id" IS NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL AND "employee_id" IS NULL AND "company_employee_id" IS NOT NULL)),
  CONSTRAINT "payroll_employee_profiles_salary_check"
    CHECK ("monthly_salary_minor">=0 AND "allowance_minor">=0 AND "deduction_minor">=0
      AND "deduction_minor"<="monthly_salary_minor"+"allowance_minor"),
  CONSTRAINT "payroll_employee_profiles_currency_check" CHECK ("currency"='NGN'),
  CONSTRAINT "payroll_employee_profiles_account_last4_check" CHECK ("account_last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "payroll_employee_profiles_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "payroll_employee_profiles_encrypted_fields_check"
    CHECK (length(btrim("bank_name_encrypted"))>0 AND length(btrim("bank_code_encrypted"))>0
      AND length(btrim("account_name_encrypted"))>0 AND length(btrim("account_number_encrypted"))>0
      AND length(btrim("encryption_key_version"))>0),
  CONSTRAINT "payroll_employee_profiles_employee_school_fk"
    FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "payroll_employee_profiles_school_employee_unique"
  ON "payroll_employee_profiles" ("school_id","employee_id") WHERE "scope"='SCHOOL';
CREATE UNIQUE INDEX "payroll_employee_profiles_company_employee_unique"
  ON "payroll_employee_profiles" ("company_employee_id") WHERE "scope"='YEMAIT_COMPANY';
CREATE INDEX "payroll_employee_profiles_school_status_idx"
  ON "payroll_employee_profiles" ("school_id","status","updated_at");
CREATE INDEX "payroll_employee_profiles_company_status_idx"
  ON "payroll_employee_profiles" ("company_employee_id","status");

CREATE TABLE "payroll_periods" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer REFERENCES "schools"("id") ON DELETE RESTRICT,
  "period_month" text NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "employee_count" integer NOT NULL,
  "gross_salary_minor" integer NOT NULL,
  "allowance_minor" integer NOT NULL,
  "bonus_minor" integer DEFAULT 0 NOT NULL,
  "deduction_minor" integer NOT NULL,
  "adjustment_minor" integer DEFAULT 0 NOT NULL,
  "net_salary_minor" integer NOT NULL,
  "created_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "submitted_by" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "submitted_at" timestamp with time zone,
  "approved_by" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_periods_id_scope_school_unique" UNIQUE ("id","scope","school_id"),
  CONSTRAINT "payroll_periods_tenant_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL)),
  CONSTRAINT "payroll_periods_month_check" CHECK ("period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_periods_status_check"
    CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT "payroll_periods_totals_check"
     CHECK ("employee_count">0 AND "gross_salary_minor">=0 AND "allowance_minor">=0 AND "bonus_minor">=0
       AND "deduction_minor">=0 AND "net_salary_minor">=0
       AND "gross_salary_minor"+"allowance_minor"+"bonus_minor"+"adjustment_minor">="deduction_minor"
       AND "net_salary_minor"="gross_salary_minor"+"allowance_minor"+"bonus_minor"+"adjustment_minor"-"deduction_minor"),
  CONSTRAINT "payroll_periods_submit_state_check"
    CHECK (("status" IN ('DRAFT','FAILED','CANCELLED') AND "submitted_at" IS NULL)
        OR ("status" NOT IN ('DRAFT','FAILED','CANCELLED') AND "submitted_at" IS NOT NULL AND "submitted_by" IS NOT NULL)),
  CONSTRAINT "payroll_periods_approval_state_check"
    CHECK ("status" NOT IN ('APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED')
        OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "payroll_periods_school_month_unique"
  ON "payroll_periods" ("school_id","period_month") WHERE "scope"='SCHOOL';
CREATE UNIQUE INDEX "payroll_periods_company_month_unique"
  ON "payroll_periods" ("scope","period_month") WHERE "scope"='YEMAIT_COMPANY';
CREATE INDEX "payroll_periods_school_status_month_idx"
  ON "payroll_periods" ("school_id","status","period_month");
CREATE INDEX "payroll_periods_company_status_month_idx"
  ON "payroll_periods" ("scope","status","period_month");

CREATE TABLE "payroll_items" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer,
  "period_id" integer NOT NULL,
  "employee_profile_id" integer NOT NULL,
  "period_month" text NOT NULL,
  "employee_name_snapshot" text NOT NULL,
  "employee_number_snapshot" text,
  "role_snapshot" text NOT NULL,
  "base_salary_minor" integer NOT NULL,
  "allowance_minor" integer DEFAULT 0 NOT NULL,
  "bonus_minor" integer DEFAULT 0 NOT NULL,
  "deduction_minor" integer DEFAULT 0 NOT NULL,
  "adjustment_minor" integer DEFAULT 0 NOT NULL,
  "adjustment_reason" text,
  "net_salary_minor" integer NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "bank_name_encrypted" text NOT NULL,
  "bank_code_encrypted" text NOT NULL,
  "account_name_encrypted" text NOT NULL,
  "account_number_encrypted" text NOT NULL,
  "account_last4" text NOT NULL,
  "encryption_key_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_items_id_period_unique" UNIQUE ("id","period_id"),
  CONSTRAINT "payroll_items_tenant_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL)),
  CONSTRAINT "payroll_items_period_month_check" CHECK ("period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_items_amounts_check"
    CHECK ("base_salary_minor">=0 AND "allowance_minor">=0 AND "bonus_minor">=0 AND "deduction_minor">=0
      AND "net_salary_minor"="base_salary_minor"+"allowance_minor"+"bonus_minor"+"adjustment_minor"-"deduction_minor"
      AND "net_salary_minor">=0),
  CONSTRAINT "payroll_items_currency_check" CHECK ("currency"='NGN'),
  CONSTRAINT "payroll_items_bank_snapshot_check"
    CHECK (length(btrim("bank_name_encrypted"))>0 AND length(btrim("bank_code_encrypted"))>0
      AND length(btrim("account_name_encrypted"))>0 AND length(btrim("account_number_encrypted"))>0
      AND "account_last4" ~ '^[0-9]{4}$' AND length(btrim("encryption_key_version"))>0),
  CONSTRAINT "payroll_items_role_check" CHECK ("role_snapshot" IN ('TEACHER','STAFF','COMPANY_EMPLOYEE')),
  CONSTRAINT "payroll_items_adjustment_audit_check"
    CHECK (("adjustment_minor"=0 AND "adjustment_reason" IS NULL)
        OR ("adjustment_minor"<>0 AND NULLIF(BTRIM("adjustment_reason"),'') IS NOT NULL)),
  CONSTRAINT "payroll_items_period_scope_school_fk"
    FOREIGN KEY ("period_id","scope","school_id")
    REFERENCES "payroll_periods"("id","scope","school_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_items_profile_scope_school_fk"
    FOREIGN KEY ("employee_profile_id","scope","school_id")
    REFERENCES "payroll_employee_profiles"("id","scope","school_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "payroll_items_employee_period_unique" ON "payroll_items" ("period_id","employee_profile_id");
CREATE INDEX "payroll_items_scope_school_period_idx" ON "payroll_items" ("scope","school_id","period_id");

CREATE TABLE "payroll_transfers" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer,
  "period_id" integer NOT NULL,
  "payroll_item_id" integer NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "idempotency_key_hash" text NOT NULL,
  "provider" text NOT NULL,
  "provider_mode" text NOT NULL,
  "provider_reference" text NOT NULL,
  "provider_transaction_id" text,
  "amount_minor" integer NOT NULL,
  "provider_fee_minor" integer DEFAULT 0 NOT NULL,
  "settlement_amount_minor" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "status" text DEFAULT 'CLAIMED' NOT NULL,
  "requires_reconciliation" boolean DEFAULT false NOT NULL,
  "external_transfer_verified" boolean DEFAULT false NOT NULL,
  "provider_status" text,
  "failure_message" text,
  "requested_by" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "verified_by" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_transfers_id_scope_school_unique" UNIQUE ("id","scope","school_id"),
  CONSTRAINT "payroll_transfers_tenant_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL)),
  CONSTRAINT "payroll_transfers_provider_check"
    CHECK (("provider"='FLUTTERWAVE' AND "provider_mode" IN ('TEST','LIVE'))
        OR ("provider"='MOCK' AND "provider_mode"='MOCK')),
  CONSTRAINT "payroll_transfers_status_check"
    CHECK ("status" IN ('CLAIMED','PROCESSING','PENDING','MOCK_PENDING','PAID','FAILED','UNCERTAIN','RECONCILIATION_REQUIRED')),
  CONSTRAINT "payroll_transfers_amount_check"
    CHECK ("amount_minor">0 AND "provider_fee_minor">=0 AND "settlement_amount_minor">=0
      AND "currency"='NGN' AND "settlement_amount_minor"<="amount_minor"),
  CONSTRAINT "payroll_transfers_reference_check"
    CHECK (NULLIF(BTRIM("idempotency_key_hash"),'') IS NOT NULL
      AND NULLIF(BTRIM("provider_reference"),'') IS NOT NULL AND "attempt_number">0),
  CONSTRAINT "payroll_transfers_paid_verification_check"
    CHECK ("status"<>'PAID' OR ("provider"='FLUTTERWAVE' AND "provider_mode"<>'MOCK'
      AND "external_transfer_verified"=true AND "verified_at" IS NOT NULL
      AND "verified_by" IS NOT NULL AND "provider_transaction_id" IS NOT NULL)),
  CONSTRAINT "payroll_transfers_mock_never_paid_check"
    CHECK ("provider"<>'MOCK' OR ("status"='MOCK_PENDING' AND "external_transfer_verified"=false)),
  CONSTRAINT "payroll_transfers_ambiguous_no_retry_check"
    CHECK (NOT "requires_reconciliation" OR "status" IN ('UNCERTAIN','RECONCILIATION_REQUIRED')),
  CONSTRAINT "payroll_transfers_item_period_fk"
    FOREIGN KEY ("payroll_item_id","period_id")
    REFERENCES "payroll_items"("id","period_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "payroll_transfers_provider_reference_unique" ON "payroll_transfers" ("provider","provider_reference");
CREATE UNIQUE INDEX "payroll_transfers_idempotency_period_unique" ON "payroll_transfers" ("period_id","idempotency_key_hash");
CREATE UNIQUE INDEX "payroll_transfers_item_attempt_unique" ON "payroll_transfers" ("payroll_item_id","attempt_number");
CREATE INDEX "payroll_transfers_scope_school_period_status_idx"
  ON "payroll_transfers" ("scope","school_id","period_id","status");
CREATE INDEX "payroll_transfers_provider_transaction_idx"
  ON "payroll_transfers" ("provider","provider_transaction_id");

CREATE TABLE "payroll_payslips" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer,
  "period_id" integer NOT NULL,
  "payroll_item_id" integer NOT NULL,
  "transfer_id" integer NOT NULL,
  "payslip_number" text NOT NULL,
  "employee_name_snapshot" text NOT NULL,
  "employee_role_snapshot" text NOT NULL,
  "period_month" text NOT NULL,
  "base_salary_minor" integer NOT NULL,
  "allowance_minor" integer NOT NULL,
  "bonus_minor" integer NOT NULL,
  "deduction_minor" integer NOT NULL,
  "adjustment_minor" integer NOT NULL,
  "net_salary_minor" integer NOT NULL,
  "currency" text DEFAULT 'NGN' NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payroll_payslips_id_scope_school_unique" UNIQUE ("id","scope","school_id"),
  CONSTRAINT "payroll_payslips_scope_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope"='YEMAIT_COMPANY' AND "school_id" IS NULL)),
  CONSTRAINT "payroll_payslips_period_month_check" CHECK ("period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_payslips_currency_check" CHECK ("currency"='NGN'),
  CONSTRAINT "payroll_payslips_amounts_check"
    CHECK ("base_salary_minor">=0 AND "allowance_minor">=0 AND "bonus_minor">=0
      AND "deduction_minor">=0 AND "net_salary_minor">0),
  CONSTRAINT "payroll_payslips_role_check"
    CHECK ("employee_role_snapshot" IN ('TEACHER','STAFF','COMPANY_EMPLOYEE')),
  CONSTRAINT "payroll_payslips_item_period_fk"
    FOREIGN KEY ("payroll_item_id","period_id") REFERENCES "payroll_items"("id","period_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_payslips_verified_transfer_scope_fk"
    FOREIGN KEY ("transfer_id","scope","school_id") REFERENCES "payroll_transfers"("id","scope","school_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "payroll_payslips_item_unique" ON "payroll_payslips" ("payroll_item_id");
CREATE UNIQUE INDEX "payroll_payslips_number_unique" ON "payroll_payslips" ("payslip_number");

CREATE TABLE "settlement_payroll_audit_events" (
  "id" serial PRIMARY KEY,
  "scope" text NOT NULL,
  "school_id" integer REFERENCES "schools"("id") ON DELETE RESTRICT,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "actor_role" text NOT NULL,
  "record_type" text NOT NULL,
  "record_id" integer,
  "action" text NOT NULL,
  "amount_minor" integer,
  "currency" text,
  "provider_reference" text,
  "previous_status" text,
  "new_status" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "settlement_payroll_audit_scope_check"
    CHECK (("scope"='SCHOOL' AND "school_id" IS NOT NULL)
        OR ("scope" IN ('YEMAIT_COMPANY','PLATFORM') AND "school_id" IS NULL)),
  CONSTRAINT "settlement_payroll_audit_amount_check"
    CHECK (("amount_minor" IS NULL AND "currency" IS NULL)
        OR ("amount_minor">=0 AND "currency"='NGN')),
  CONSTRAINT "settlement_payroll_audit_record_type_check"
    CHECK ("record_type" IN ('SETTLEMENT_PROFILE','PAYROLL_PROFILE','PAYROLL_PERIOD','PAYROLL_ITEM','PAYROLL_TRANSFER','PAYSLIP'))
);
CREATE INDEX "settlement_payroll_audit_scope_timeline_idx"
  ON "settlement_payroll_audit_events" ("scope","school_id","occurred_at","id");
CREATE INDEX "settlement_payroll_audit_record_timeline_idx"
  ON "settlement_payroll_audit_events" ("record_type","record_id","occurred_at","id");
CREATE INDEX "settlement_payroll_audit_actor_timeline_idx"
  ON "settlement_payroll_audit_events" ("actor_user_id","occurred_at","id");

CREATE FUNCTION "prevent_settlement_payroll_audit_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Settlement and payroll audit records are append-only'
    USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "settlement_payroll_audit_append_only"
  BEFORE UPDATE OR DELETE ON "settlement_payroll_audit_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_settlement_payroll_audit_mutation"();

CREATE FUNCTION "prevent_payroll_payslip_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Paid employee payslips are immutable'
    USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "payroll_payslips_append_only"
  BEFORE UPDATE OR DELETE ON "payroll_payslips"
  FOR EACH ROW EXECUTE FUNCTION "prevent_payroll_payslip_mutation"();