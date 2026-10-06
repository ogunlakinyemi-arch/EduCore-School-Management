-- DISPOSABLE / AUDIT ONLY — NOT FOR PRODUCTION EXECUTION
-- Export-only dependency ordering; no DDL statements added or removed.
CREATE TABLE "admission_request_rate_limits" (
	"bucket_hash" text PRIMARY KEY NOT NULL,
	"bucket_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_request_rate_limits_count_check" CHECK ("admission_request_rate_limits"."request_count" >= 0)
);

CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"term" text,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"calculation_basis" text DEFAULT 'FIXED' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"partner_rate" numeric(12, 4) DEFAULT '100' NOT NULL,
	"allocation_total" numeric(12, 2) DEFAULT '5000' NOT NULL,
	"partner_amount" numeric(12, 2) DEFAULT '100' NOT NULL,
	"school_amount" numeric(12, 2) DEFAULT '2000' NOT NULL,
	"edupulse_amount" numeric(12, 2) DEFAULT '2900' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_allocation_integrity" CHECK ("commission_rules"."partner_amount" >= 0 AND "commission_rules"."school_amount" >= 0 AND "commission_rules"."edupulse_amount" >= 0 AND "commission_rules"."partner_amount" + "commission_rules"."school_amount" + "commission_rules"."edupulse_amount" = "commission_rules"."allocation_total")
);

CREATE TABLE "platform_company_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"job_title" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_company_employees_status_check" CHECK ("platform_company_employees"."status" IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE "schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registration_number" text,
	"address" text,
	"lga" text,
	"phone" text,
	"email" text,
	"website" text,
	"logo" text,
	"school_type" text,
	"communication_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "academic_assessment_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "academic_assessment_types_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assessment_types_school_code_unique" UNIQUE("school_id","code"),
	CONSTRAINT "academic_assessment_types_status_check" CHECK ("academic_assessment_types"."status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE "academic_grading_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"min_score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text NOT NULL,
	"grade_point" numeric(5, 2),
	"remark" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_grading_rules_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_grading_rules_score_range_check" CHECK ("academic_grading_rules"."min_score" >= 0 AND "academic_grading_rules"."max_score" >= "academic_grading_rules"."min_score"),
	CONSTRAINT "academic_grading_rules_status_check" CHECK ("academic_grading_rules"."status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE "academic_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_sessions_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "admission_application_counters" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_application_counters_nonnegative_check" CHECK ("admission_application_counters"."current_value" >= 0)
);

CREATE TABLE "attendance_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"entry_window_start" time,
	"entry_window_end" time,
	"exit_window_start" time,
	"exit_window_end" time,
	"classroom_window_start" time,
	"classroom_window_end" time,
	"duplicate_suppression_seconds" integer DEFAULT 30 NOT NULL,
	"notify_on_entry" boolean DEFAULT true NOT NULL,
	"notify_on_exit" boolean DEFAULT true NOT NULL,
	"notify_on_discrepancy" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"role" text NOT NULL,
	"actor_user_id" integer,
	"clerk_user_id" text,
	"school_id" integer,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"record_id" integer,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"event_type" text DEFAULT 'APPLICATION_EVENT' NOT NULL,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"metadata" jsonb
);

CREATE TABLE "communication_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_preferences_category_check" CHECK ("communication_preferences"."category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
	CONSTRAINT "communication_preferences_channel_check" CHECK ("communication_preferences"."channel" IN ('IN_APP','SMS','EMAIL','PUSH'))
);

CREATE TABLE "communication_push_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"provider" text DEFAULT 'WEB_PUSH' NOT NULL,
	"opaque_device_reference" text NOT NULL,
	"subscription" jsonb,
	"session_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "communication_push_devices_provider_check" CHECK ("communication_push_devices"."provider" IN ('WEB_PUSH')),
	CONSTRAINT "communication_push_devices_status_check" CHECK (
      ("communication_push_devices"."status" = 'ACTIVE' AND "communication_push_devices"."revoked_at" IS NULL)
      OR ("communication_push_devices"."status" = 'REVOKED' AND "communication_push_devices"."revoked_at" IS NOT NULL)
    ),
	CONSTRAINT "communication_push_devices_reference_check" CHECK (length(btrim("communication_push_devices"."opaque_device_reference")) BETWEEN 1 AND 256)
);

CREATE TABLE "communication_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"allowed_variables" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_templates_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "communication_templates_school_key_channel_unique" UNIQUE("school_id","template_key","channel"),
	CONSTRAINT "communication_templates_category_check" CHECK ("communication_templates"."category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
	CONSTRAINT "communication_templates_channel_check" CHECK ("communication_templates"."channel" IN ('IN_APP','SMS','EMAIL','PUSH')),
	CONSTRAINT "communication_templates_variables_check" CHECK (
      "communication_templates"."allowed_variables" <@ ARRAY[
        'student_name','parent_name','school_name','class_name','amount','invoice_number',
        'payment_date','attendance_date','term_name','assignment_title'
      ]::text[]
    )
);

CREATE TABLE "curriculum_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"education_level" text NOT NULL,
	"class_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_kind" text NOT NULL,
	"source_organization" text NOT NULL,
	"source_reference" text NOT NULL,
	"source_version" text,
	"effective_date" date,
	"verified_date" date,
	"description" text,
	"source_document_path" text,
	"derived_from_version_id" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "curriculum_versions_id_unique" UNIQUE("id"),
	CONSTRAINT "curriculum_versions_source_kind_check" CHECK ("curriculum_versions"."source_kind" IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')),
	CONSTRAINT "curriculum_versions_status_check" CHECK ("curriculum_versions"."status" IN ('DRAFT','PUBLISHED','ARCHIVED'))
);

CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer,
	"employee_no" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"photo" text,
	"gender" text,
	"employee_type" text DEFAULT 'TEACHER' NOT NULL,
	"employment_status" text DEFAULT 'ACTIVE' NOT NULL,
	"date_employed" date,
	"department" text,
	"qualification" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "fee_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"compulsory" boolean DEFAULT false NOT NULL,
	"transport_only" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_categories_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_categories_school_name_unique" UNIQUE("school_id","name"),
	CONSTRAINT "fee_categories_status_check" CHECK ("fee_categories"."status" IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE "fee_school_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"partial_payments_enabled" boolean DEFAULT false NOT NULL,
	"bank_transfer_enabled" boolean DEFAULT false NOT NULL,
	"paystack_enabled" boolean DEFAULT false NOT NULL,
	"flutterwave_enabled" boolean DEFAULT false NOT NULL,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_school_settings_bank_account_fields_check" CHECK (
    ("fee_school_settings"."bank_name" IS NULL OR COALESCE(LENGTH(BTRIM("fee_school_settings"."bank_name")), 0) BETWEEN 2 AND 100)
    AND ("fee_school_settings"."bank_account_name" IS NULL OR COALESCE(LENGTH(BTRIM("fee_school_settings"."bank_account_name")), 0) BETWEEN 2 AND 150)
    AND ("fee_school_settings"."bank_account_number" IS NULL OR "fee_school_settings"."bank_account_number" ~ '^[0-9]{10}$')
    AND (NOT "fee_school_settings"."bank_transfer_enabled" OR (
      "fee_school_settings"."bank_name" IS NOT NULL AND "fee_school_settings"."bank_account_name" IS NOT NULL AND "fee_school_settings"."bank_account_number" IS NOT NULL
    ))
  )
);

CREATE TABLE "library_authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_authors_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_authors_name_check" CHECK (length(btrim("library_authors"."name")) BETWEEN 1 AND 200)
);

CREATE TABLE "library_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_categories_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_categories_name_check" CHECK (length(btrim("library_categories"."name")) BETWEEN 1 AND 100)
);

CREATE TABLE "library_publishers" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_publishers_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_publishers_name_check" CHECK (length(btrim("library_publishers"."name")) BETWEEN 1 AND 200)
);

CREATE TABLE "library_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"student_borrowing_enabled" boolean DEFAULT true NOT NULL,
	"teacher_borrowing_enabled" boolean DEFAULT false NOT NULL,
	"staff_borrowing_enabled" boolean DEFAULT false NOT NULL,
	"max_books_per_student" integer DEFAULT 3 NOT NULL,
	"max_books_per_teacher" integer DEFAULT 5 NOT NULL,
	"max_books_per_staff" integer DEFAULT 5 NOT NULL,
	"student_loan_days" integer DEFAULT 14 NOT NULL,
	"teacher_loan_days" integer DEFAULT 30 NOT NULL,
	"staff_loan_days" integer DEFAULT 30 NOT NULL,
	"max_renewals" integer DEFAULT 1 NOT NULL,
	"renewal_requires_not_overdue" boolean DEFAULT true NOT NULL,
	"fines_enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_settings_student_limit_check" CHECK ("library_settings"."max_books_per_student" BETWEEN 1 AND 50),
	CONSTRAINT "library_settings_teacher_limit_check" CHECK ("library_settings"."max_books_per_teacher" BETWEEN 1 AND 50),
	CONSTRAINT "library_settings_staff_limit_check" CHECK ("library_settings"."max_books_per_staff" BETWEEN 1 AND 50),
	CONSTRAINT "library_settings_student_days_check" CHECK ("library_settings"."student_loan_days" BETWEEN 1 AND 180),
	CONSTRAINT "library_settings_teacher_days_check" CHECK ("library_settings"."teacher_loan_days" BETWEEN 1 AND 180),
	CONSTRAINT "library_settings_staff_days_check" CHECK ("library_settings"."staff_loan_days" BETWEEN 1 AND 180),
	CONSTRAINT "library_settings_renewals_check" CHECK ("library_settings"."max_renewals" BETWEEN 0 AND 20),
	CONSTRAINT "library_settings_fines_disabled_check" CHECK ("library_settings"."fines_enabled" = false)
);

CREATE TABLE "library_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"can_manage_catalogue" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_staff_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_staff_school_user_unique" UNIQUE("school_id","user_id")
);

CREATE TABLE "parents" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"default_relationship_type" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "partner_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"partner_code" text NOT NULL,
	"type" text DEFAULT 'RESELLER' NOT NULL,
	"full_name" text NOT NULL,
	"business_name" text,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"state" text,
	"lga" text,
	"registration_number" text,
	"nfc_activation_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"school_id" integer,
	"period_month" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"employee_count" integer NOT NULL,
	"gross_salary_minor" integer NOT NULL,
	"allowance_minor" integer NOT NULL,
	"bonus_minor" integer DEFAULT 0 NOT NULL,
	"deduction_minor" integer NOT NULL,
	"adjustment_minor" integer DEFAULT 0 NOT NULL,
	"net_salary_minor" integer NOT NULL,
	"created_by" integer NOT NULL,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_id_scope_school_unique" UNIQUE("id","scope","school_id"),
	CONSTRAINT "payroll_periods_tenant_check" CHECK (
    ("payroll_periods"."scope"='SCHOOL' AND "payroll_periods"."school_id" IS NOT NULL)
    OR ("payroll_periods"."scope"='YEMAIT_COMPANY' AND "payroll_periods"."school_id" IS NULL)),
	CONSTRAINT "payroll_periods_month_check" CHECK ("payroll_periods"."period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_periods_status_check" CHECK ("payroll_periods"."status" IN (
    'DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "payroll_periods_totals_check" CHECK (
    "payroll_periods"."employee_count" > 0 AND "payroll_periods"."gross_salary_minor" >= 0 AND "payroll_periods"."allowance_minor" >= 0
    AND "payroll_periods"."bonus_minor" >= 0 AND "payroll_periods"."deduction_minor" >= 0 AND "payroll_periods"."net_salary_minor" >= 0
    AND "payroll_periods"."gross_salary_minor" + "payroll_periods"."allowance_minor" + "payroll_periods"."bonus_minor" + "payroll_periods"."adjustment_minor" >= "payroll_periods"."deduction_minor"
    AND "payroll_periods"."net_salary_minor" = "payroll_periods"."gross_salary_minor" + "payroll_periods"."allowance_minor" + "payroll_periods"."bonus_minor"
      + "payroll_periods"."adjustment_minor" - "payroll_periods"."deduction_minor"),
	CONSTRAINT "payroll_periods_submit_state_check" CHECK (
    ("payroll_periods"."status" IN ('DRAFT','FAILED','CANCELLED') AND "payroll_periods"."submitted_at" IS NULL)
    OR ("payroll_periods"."status" NOT IN ('DRAFT','FAILED','CANCELLED') AND "payroll_periods"."submitted_at" IS NOT NULL AND "payroll_periods"."submitted_by" IS NOT NULL)),
	CONSTRAINT "payroll_periods_approval_state_check" CHECK (
    ("payroll_periods"."status" NOT IN ('APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED')
       OR ("payroll_periods"."approved_by" IS NOT NULL AND "payroll_periods"."approved_at" IS NOT NULL)))
);

CREATE TABLE "platform_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "school_branding_logos" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"object_path" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_branding_logos_content_type_check" CHECK ("school_branding_logos"."content_type" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "school_branding_logos_byte_size_check" CHECK ("school_branding_logos"."byte_size" BETWEEN 1 AND 3145728)
);

CREATE TABLE "school_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"class_teacher" text,
	"capacity" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "school_classes_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "school_facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"facility_type" text NOT NULL,
	"location" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"capacity" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_facilities_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_facilities_capacity_check" CHECK ("school_facilities"."capacity" IS NULL OR "school_facilities"."capacity" >= 0),
	CONSTRAINT "school_facilities_condition_check" CHECK ("school_facilities"."condition" IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
	CONSTRAINT "school_facilities_status_check" CHECK ("school_facilities"."status" IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'))
);

CREATE TABLE "school_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "school_operation_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_operation_categories_id_school_type_key" UNIQUE("id","school_id","category_type"),
	CONSTRAINT "school_operation_categories_type_check" CHECK ("school_operation_categories"."category_type" IN ('ASSET', 'MAINTENANCE', 'TASK'))
);

CREATE TABLE "school_operations_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"default_maintenance_priority" text DEFAULT 'MEDIUM' NOT NULL,
	"default_task_priority" text DEFAULT 'MEDIUM' NOT NULL,
	"staff_can_report_maintenance" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_operations_default_maintenance_priority_check" CHECK ("school_operations_settings"."default_maintenance_priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
	CONSTRAINT "school_operations_default_task_priority_check" CHECK ("school_operations_settings"."default_task_priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'))
);

CREATE TABLE "school_subscription_manual_locks" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" integer,
	"last_unlocked_at" timestamp with time zone,
	"last_unlocked_by_user_id" integer,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_manual_lock_version_nonnegative" CHECK ("school_subscription_manual_locks"."version" >= 0)
);

CREATE TABLE "security_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"zone_type" text DEFAULT 'OTHER' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_locations_name_unique" UNIQUE("school_id","name"),
	CONSTRAINT "security_locations_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "security_locations_zone_type_check" CHECK ("security_locations"."zone_type" IN ('GATE','CAMPUS','BUILDING','OTHER')),
	CONSTRAINT "security_locations_status_check" CHECK ("security_locations"."status" IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE "security_school_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"security_enabled" boolean DEFAULT true NOT NULL,
	"parent_entry_alerts" boolean DEFAULT true NOT NULL,
	"parent_exit_alerts" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "security_staff_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"permissions" text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by_user_id" integer NOT NULL,
	"revoked_by_user_id" integer,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_staff_grants_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "security_staff_grants_permissions_check" CHECK (cardinality("security_staff_grants"."permissions") > 0 AND "security_staff_grants"."permissions" <@ ARRAY['READ','MANAGE_READERS','MANAGE_CARDS','REVIEW_PRESENCE','SECURITY_READ','SECURITY_MANAGE','VISITOR_MANAGE','PICKUP_APPROVE','INCIDENT_MANAGE','EMERGENCY_BROADCAST','COMMUNICATION_SEND']::text[]),
	CONSTRAINT "security_staff_grants_status_check" CHECK ("security_staff_grants"."status" IN ('ACTIVE','REVOKED','EXPIRED')),
	CONSTRAINT "security_staff_grants_revocation_shape_check" CHECK (("security_staff_grants"."status"='ACTIVE' AND "security_staff_grants"."revoked_at" IS NULL AND "security_staff_grants"."revoked_by_user_id" IS NULL) OR ("security_staff_grants"."status" IN ('REVOKED','EXPIRED') AND "security_staff_grants"."revoked_at" IS NOT NULL))
);

CREATE TABLE "settlement_payroll_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"school_id" integer,
	"actor_user_id" integer NOT NULL,
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
	CONSTRAINT "settlement_payroll_audit_scope_check" CHECK (
    ("settlement_payroll_audit_events"."scope"='SCHOOL' AND "settlement_payroll_audit_events"."school_id" IS NOT NULL)
    OR ("settlement_payroll_audit_events"."scope"='YEMAIT_COMPANY' AND "settlement_payroll_audit_events"."school_id" IS NULL)
    OR ("settlement_payroll_audit_events"."scope"='PLATFORM' AND "settlement_payroll_audit_events"."school_id" IS NULL)),
	CONSTRAINT "settlement_payroll_audit_amount_check" CHECK (
    ("settlement_payroll_audit_events"."amount_minor" IS NULL AND "settlement_payroll_audit_events"."currency" IS NULL)
    OR ("settlement_payroll_audit_events"."amount_minor" IS NOT NULL AND "settlement_payroll_audit_events"."amount_minor" >= 0 AND "settlement_payroll_audit_events"."currency"='NGN')),
	CONSTRAINT "settlement_payroll_audit_record_type_check" CHECK ("settlement_payroll_audit_events"."record_type" IN (
    'SETTLEMENT_PROFILE','PAYROLL_PROFILE','PAYROLL_PERIOD','PAYROLL_ITEM','PAYROLL_TRANSFER','PAYSLIP'))
);

CREATE TABLE "settlement_payroll_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"school_id" integer,
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
	"verified_by" integer,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_payroll_profiles_id_scope_school_unique" UNIQUE("id","scope","school_id"),
	CONSTRAINT "settlement_payroll_profiles_tenant_check" CHECK (
    ("settlement_payroll_profiles"."scope"='SCHOOL' AND "settlement_payroll_profiles"."school_id" IS NOT NULL)
    OR ("settlement_payroll_profiles"."scope"='YEMAIT_COMPANY' AND "settlement_payroll_profiles"."school_id" IS NULL)),
	CONSTRAINT "settlement_payroll_profiles_currency_check" CHECK ("settlement_payroll_profiles"."currency"='NGN'),
	CONSTRAINT "settlement_payroll_profiles_provider_check" CHECK ("settlement_payroll_profiles"."provider"='FLUTTERWAVE'),
	CONSTRAINT "settlement_payroll_profiles_account_last4_check" CHECK ("settlement_payroll_profiles"."account_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "settlement_payroll_profiles_encrypted_fields_check" CHECK (
    NULLIF(BTRIM("settlement_payroll_profiles"."bank_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("settlement_payroll_profiles"."bank_code_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("settlement_payroll_profiles"."account_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("settlement_payroll_profiles"."account_number_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("settlement_payroll_profiles"."encryption_key_version"),'') IS NOT NULL),
	CONSTRAINT "settlement_payroll_profiles_verification_check" CHECK (
    ("settlement_payroll_profiles"."verification_status"='VERIFIED' AND "settlement_payroll_profiles"."verified_at" IS NOT NULL AND "settlement_payroll_profiles"."verified_by" IS NOT NULL)
    OR ("settlement_payroll_profiles"."verification_status"<>'VERIFIED' AND "settlement_payroll_profiles"."verified_at" IS NULL AND "settlement_payroll_profiles"."verified_by" IS NULL))
);

CREATE TABLE "staff_nfc_billing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"product" text DEFAULT 'TEACHER_STAFF_NFC_EID' NOT NULL,
	"billing_frequency" text DEFAULT 'ACADEMIC_TERM' NOT NULL,
	"price_minor" integer NOT NULL,
	"school_share_minor" integer NOT NULL,
	"platform_share_minor" integer NOT NULL,
	"partner_commission_minor" integer NOT NULL,
	"no_partner_platform_share_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_nfc_billing_rules_product_ck" CHECK ("staff_nfc_billing_rules"."product" = 'TEACHER_STAFF_NFC_EID'),
	CONSTRAINT "staff_nfc_billing_rules_frequency_ck" CHECK ("staff_nfc_billing_rules"."billing_frequency" = 'ACADEMIC_TERM'),
	CONSTRAINT "staff_nfc_billing_rules_currency_ck" CHECK ("staff_nfc_billing_rules"."currency" = 'NGN'),
	CONSTRAINT "staff_nfc_billing_rules_status_ck" CHECK ("staff_nfc_billing_rules"."status" = 'ACTIVE'),
	CONSTRAINT "staff_nfc_billing_rules_amounts_ck" CHECK ("staff_nfc_billing_rules"."price_minor" > 0 AND "staff_nfc_billing_rules"."school_share_minor" >= 0
          AND "staff_nfc_billing_rules"."platform_share_minor" >= 0 AND "staff_nfc_billing_rules"."partner_commission_minor" >= 0
          AND "staff_nfc_billing_rules"."no_partner_platform_share_minor" >= 0
          AND "staff_nfc_billing_rules"."school_share_minor" + "staff_nfc_billing_rules"."platform_share_minor" + "staff_nfc_billing_rules"."partner_commission_minor" = "staff_nfc_billing_rules"."price_minor"
          AND "staff_nfc_billing_rules"."school_share_minor" + "staff_nfc_billing_rules"."no_partner_platform_share_minor" = "staff_nfc_billing_rules"."price_minor")
);

CREATE TABLE "student_behaviour_configurations" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"categories" jsonb DEFAULT '["POSITIVE","CONCERN","INCIDENT","RULE_VIOLATION","RECOGNITION"]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '["Verbal warning","Written warning","Detention","Counselling","Parent meeting","Behaviour agreement","Suspension"]'::jsonb NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_behaviour_configurations_categories_array" CHECK (jsonb_typeof("student_behaviour_configurations"."categories")='array'),
	CONSTRAINT "student_behaviour_configurations_actions_array" CHECK (jsonb_typeof("student_behaviour_configurations"."actions")='array'),
	CONSTRAINT "student_behaviour_configurations_version_check" CHECK ("student_behaviour_configurations"."version" > 0)
);

CREATE TABLE "student_care_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"granted_by_user_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_care_grants_school_user_unique" UNIQUE("school_id","user_id"),
	CONSTRAINT "student_care_grants_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "student_care_grants_permissions_check" CHECK ("student_care_grants"."permissions" <@ ARRAY['MEDICAL_READ','MEDICAL_WRITE','WELFARE_READ','WELFARE_WRITE','SAFEGUARDING_READ','SAFEGUARDING_WRITE','BEHAVIOUR_READ','BEHAVIOUR_WRITE','BEHAVIOUR_REVIEW','BEHAVIOUR_ACTION']::text[])
);

CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer,
	"admission_no" text NOT NULL,
	"email" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"gender" text NOT NULL,
	"class_name" text NOT NULL,
	"section" text NOT NULL,
	"parent_name" text,
	"parent_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"middle_name" text,
	"date_of_birth" date,
	"photo" text,
	"admission_date" date,
	"admission_status" text DEFAULT 'ADMITTED' NOT NULL,
	"previous_school" text,
	"address" text,
	"medical_info" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "transport_buses" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"registration_number" text NOT NULL,
	"make" text,
	"capacity" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_buses_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_buses_capacity_check" CHECK ("transport_buses"."capacity" BETWEEN 1 AND 250),
	CONSTRAINT "transport_buses_status_check" CHECK ("transport_buses"."status" IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE'))
);

CREATE TABLE "transport_school_policies" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"payment_required" boolean DEFAULT false NOT NULL,
	"suspend_when_overdue" boolean DEFAULT false NOT NULL,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_school_policies_payment_gate_check" CHECK (NOT "transport_school_policies"."suspend_when_overdue" OR "transport_school_policies"."payment_required")
);

CREATE TABLE "academic_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "academic_terms_nfc_session_key" UNIQUE("id","school_id","academic_session_id")
);

CREATE TABLE "communication_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"template_id" integer,
	"idempotency_key" text,
	"title" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"category" text DEFAULT 'ANNOUNCEMENT' NOT NULL,
	"target_type" text NOT NULL,
	"target_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_campaigns_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "communication_campaigns_category_check" CHECK ("communication_campaigns"."category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
	CONSTRAINT "communication_campaigns_target_type_check" CHECK ("communication_campaigns"."target_type" IN (
      'SCHOOL','PARENTS','STUDENTS','TEACHERS','STAFF','CLASS','SECTION','USERS'
    )),
	CONSTRAINT "communication_campaigns_channels_check" CHECK (
      cardinality("communication_campaigns"."channels") > 0
      AND "communication_campaigns"."channels" <@ ARRAY['IN_APP','SMS','EMAIL','PUSH']::text[]
    ),
	CONSTRAINT "communication_campaigns_status_check" CHECK ("communication_campaigns"."status" IN (
      'DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED'
    )),
	CONSTRAINT "communication_campaigns_recipient_count_check" CHECK ("communication_campaigns"."recipient_count" >= 0),
	CONSTRAINT "communication_campaigns_target_criteria_check" CHECK (jsonb_typeof("communication_campaigns"."target_criteria") = 'object'),
	CONSTRAINT "communication_campaigns_emergency_category_check" CHECK (NOT "communication_campaigns"."is_emergency" OR "communication_campaigns"."category" = 'SECURITY')
);

CREATE TABLE "communication_message_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"subject_class_id" integer,
	"parent_user_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'GENERAL' NOT NULL,
	"parent_last_read_at" timestamp with time zone,
	"school_last_read_at" timestamp with time zone,
	"parent_archived_at" timestamp with time zone,
	"school_archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_message_threads_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "communication_message_threads_request_key_check" CHECK (length("communication_message_threads"."request_key") BETWEEN 8 AND 128),
	CONSTRAINT "communication_message_threads_request_hash_check" CHECK (length("communication_message_threads"."request_hash") = 64),
	CONSTRAINT "communication_message_threads_subject_check" CHECK (length(btrim("communication_message_threads"."subject")) BETWEEN 1 AND 200),
	CONSTRAINT "communication_message_threads_category_check" CHECK ("communication_message_threads"."category" IN ('GENERAL','ACADEMIC','ASSIGNMENT','FINANCE'))
);

CREATE TABLE "communication_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"school_id" integer,
	"subject_student_id" integer,
	"subject_class_id" integer,
	"sender_user_id" integer,
	"category" text NOT NULL,
	"event_key" text,
	"subject" text,
	"body" text NOT NULL,
	"link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_notifications_id_school_recipient_unique" UNIQUE("id","school_id","recipient_user_id"),
	CONSTRAINT "communication_notifications_subject_student_school_check" CHECK ("communication_notifications"."subject_student_id" IS NULL OR "communication_notifications"."school_id" IS NOT NULL),
	CONSTRAINT "communication_notifications_subject_class_school_check" CHECK ("communication_notifications"."subject_class_id" IS NULL OR "communication_notifications"."school_id" IS NOT NULL),
	CONSTRAINT "communication_notifications_category_check" CHECK ("communication_notifications"."category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
	CONSTRAINT "communication_notifications_read_check" CHECK (("communication_notifications"."is_read" = false AND "communication_notifications"."read_at" IS NULL) OR ("communication_notifications"."is_read" = true AND "communication_notifications"."read_at" IS NOT NULL))
);

CREATE TABLE "curriculum_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"object_path" text NOT NULL,
	"detected_type" text NOT NULL,
	"preview_rows" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_version_id" integer,
	CONSTRAINT "curriculum_imports_id_unique" UNIQUE("id")
);

CREATE TABLE "library_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"isbn" text,
	"author_id" integer,
	"publisher_id" integer,
	"category_id" integer,
	"publication_year" integer,
	"edition" text,
	"subject" text,
	"description" text,
	"cover_reference" text,
	"language" text DEFAULT 'English' NOT NULL,
	"shelf_location" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_books_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_books_title_check" CHECK (length(btrim("library_books"."title")) BETWEEN 1 AND 300),
	CONSTRAINT "library_books_publication_year_check" CHECK (
      "library_books"."publication_year" IS NULL OR "library_books"."publication_year" BETWEEN 1000 AND 2200
    ),
	CONSTRAINT "library_books_status_check" CHECK ("library_books"."status" IN ('ACTIVE','ARCHIVED'))
);

CREATE TABLE "operational_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'TASK' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_user_id" integer,
	"created_by_user_id" integer NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_on" date,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_tasks_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "operational_tasks_category_type_check" CHECK ("operational_tasks"."category_type" = 'TASK'),
	CONSTRAINT "operational_tasks_priority_check" CHECK ("operational_tasks"."priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
	CONSTRAINT "operational_tasks_status_check" CHECK ("operational_tasks"."status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE "parent_student_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"relationship_type" text DEFAULT 'Guardian' NOT NULL,
	"is_primary_guardian" boolean DEFAULT false NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"contact_priority" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_student_relationship_unique" UNIQUE("parent_id","student_id")
);

CREATE TABLE "partner_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"invited_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "partner_payout_information" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"method" text NOT NULL,
	"bank_name_encrypted" text NOT NULL,
	"account_name_encrypted" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"bank_code_encrypted" text,
	"account_last4" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "partner_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"academic_session_id" integer,
	"term" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_reference" text,
	"payment_date" timestamp with time zone,
	"method" text,
	"notes" text,
	"provider" text,
	"provider_reference" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversal_reference" text,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payouts_amount_nonnegative" CHECK ("partner_payouts"."amount" >= 0),
	CONSTRAINT "partner_payouts_status_check" CHECK ("partner_payouts"."status" IN ('PENDING','PROCESSING','PAID','FAILED','REVERSED'))
);

CREATE TABLE "partner_profile_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'PARTNER' NOT NULL,
	"nfc_activation_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "partner_referral_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

CREATE TABLE "payroll_employee_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"school_id" integer,
	"employee_id" integer,
	"company_employee_id" integer,
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
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employee_profiles_id_scope_school_unique" UNIQUE("id","scope","school_id"),
	CONSTRAINT "payroll_employee_profiles_tenant_check" CHECK (
    ("payroll_employee_profiles"."scope"='SCHOOL' AND "payroll_employee_profiles"."school_id" IS NOT NULL AND "payroll_employee_profiles"."employee_id" IS NOT NULL AND "payroll_employee_profiles"."company_employee_id" IS NULL)
    OR ("payroll_employee_profiles"."scope"='YEMAIT_COMPANY' AND "payroll_employee_profiles"."school_id" IS NULL AND "payroll_employee_profiles"."employee_id" IS NULL
      AND "payroll_employee_profiles"."company_employee_id" IS NOT NULL)),
	CONSTRAINT "payroll_employee_profiles_salary_check" CHECK (
    "payroll_employee_profiles"."monthly_salary_minor" >= 0 AND "payroll_employee_profiles"."allowance_minor" >= 0 AND "payroll_employee_profiles"."deduction_minor" >= 0
    AND "payroll_employee_profiles"."deduction_minor" <= "payroll_employee_profiles"."monthly_salary_minor" + "payroll_employee_profiles"."allowance_minor"),
	CONSTRAINT "payroll_employee_profiles_currency_check" CHECK ("payroll_employee_profiles"."currency"='NGN'),
	CONSTRAINT "payroll_employee_profiles_account_last4_check" CHECK ("payroll_employee_profiles"."account_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payroll_employee_profiles_encrypted_fields_check" CHECK (
    NULLIF(BTRIM("payroll_employee_profiles"."bank_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_employee_profiles"."bank_code_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_employee_profiles"."account_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_employee_profiles"."account_number_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_employee_profiles"."encryption_key_version"),'') IS NOT NULL)
);

CREATE TABLE "platform_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial_number" text NOT NULL,
	"name" text NOT NULL,
	"device_type" text NOT NULL,
	"school_id" integer,
	"location" text,
	"school_class_id" integer,
	"configuration_status" text DEFAULT 'PENDING' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_devices_status_supported_check" CHECK ("platform_devices"."status" IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED', 'UNASSIGNED'))
);

CREATE TABLE "promotion_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"source_session_id" integer NOT NULL,
	"target_session_id" integer NOT NULL,
	"status" text DEFAULT 'PREPARED' NOT NULL,
	"idempotency_actor_user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"prepared_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_by" integer,
	"finalized_at" timestamp with time zone,
	"finalization_actor_user_id" integer,
	"finalization_idempotency_key" text,
	CONSTRAINT "promotion_batches_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "promotion_batches_session_pair_unique" UNIQUE("school_id","source_session_id","target_session_id"),
	CONSTRAINT "promotion_batches_idempotency_unique" UNIQUE("school_id","idempotency_actor_user_id","idempotency_key"),
	CONSTRAINT "promotion_batches_finalization_idempotency_unique" UNIQUE("school_id","finalization_actor_user_id","finalization_idempotency_key"),
	CONSTRAINT "promotion_batches_status_check" CHECK ("promotion_batches"."status" IN ('PREPARED', 'FINALIZED')),
	CONSTRAINT "promotion_batches_distinct_sessions_check" CHECK ("promotion_batches"."source_session_id" <> "promotion_batches"."target_session_id"),
	CONSTRAINT "promotion_batches_finalization_shape_check" CHECK (("promotion_batches"."status" = 'PREPARED' AND "promotion_batches"."finalized_by" IS NULL AND "promotion_batches"."finalized_at" IS NULL AND "promotion_batches"."finalization_actor_user_id" IS NULL AND "promotion_batches"."finalization_idempotency_key" IS NULL) OR ("promotion_batches"."status" = 'FINALIZED' AND "promotion_batches"."finalized_by" IS NOT NULL AND "promotion_batches"."finalized_at" IS NOT NULL AND "promotion_batches"."finalization_actor_user_id" IS NOT NULL AND "promotion_batches"."finalization_idempotency_key" IS NOT NULL))
);

CREATE TABLE "school_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'ASSET' NOT NULL,
	"asset_code" text,
	"name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'item' NOT NULL,
	"location" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"assigned_to_user_id" integer,
	"acquired_on" date,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_assets_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_assets_quantity_check" CHECK ("school_assets"."quantity" >= 0),
	CONSTRAINT "school_assets_condition_check" CHECK ("school_assets"."condition" IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
	CONSTRAINT "school_assets_category_type_check" CHECK ("school_assets"."category_type" = 'ASSET'),
	CONSTRAINT "school_assets_status_check" CHECK ("school_assets"."status" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))
);

CREATE TABLE "school_authorized_pickup_persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"nominated_by_parent_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"relationship" text,
	"identity_reference" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision_by_user_id" integer,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_pickup_person_id_school_student_unique" UNIQUE("id","school_id","student_id"),
	CONSTRAINT "school_pickup_person_name_check" CHECK (length(btrim("school_authorized_pickup_persons"."full_name")) BETWEEN 1 AND 160),
	CONSTRAINT "school_pickup_person_phone_check" CHECK (length(btrim("school_authorized_pickup_persons"."phone")) BETWEEN 3 AND 40),
	CONSTRAINT "school_pickup_person_status_check" CHECK ("school_authorized_pickup_persons"."status" IN ('PENDING','APPROVED','REJECTED','REVOKED')),
	CONSTRAINT "school_pickup_person_decision_shape_check" CHECK (("school_authorized_pickup_persons"."status"='PENDING' AND "school_authorized_pickup_persons"."decision_by_user_id" IS NULL AND "school_authorized_pickup_persons"."decided_at" IS NULL) OR ("school_authorized_pickup_persons"."status"<>'PENDING' AND "school_authorized_pickup_persons"."decision_by_user_id" IS NOT NULL AND "school_authorized_pickup_persons"."decided_at" IS NOT NULL)),
	CONSTRAINT "school_pickup_person_validity_check" CHECK ("school_authorized_pickup_persons"."valid_from" IS NULL OR "school_authorized_pickup_persons"."valid_until" IS NULL OR "school_authorized_pickup_persons"."valid_until">"school_authorized_pickup_persons"."valid_from"),
	CONSTRAINT "school_pickup_person_version_check" CHECK ("school_authorized_pickup_persons"."version">0)
);

CREATE TABLE "school_security_operation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_security_operation_history_revision_unique" UNIQUE("entity_type","entity_id","revision"),
	CONSTRAINT "school_security_operation_history_entity_check" CHECK ("school_security_operation_history"."entity_type" IN ('VISITOR','PICKUP_PERSON','PICKUP_REQUEST','INCIDENT')),
	CONSTRAINT "school_security_operation_history_result_check" CHECK ("school_security_operation_history"."result" IN ('SUCCESS','REJECTED')),
	CONSTRAINT "school_security_operation_history_revision_check" CHECK ("school_security_operation_history"."revision">0)
);

CREATE TABLE "student_care_idempotency" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"request_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" integer NOT NULL,
	"response_revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_care_idempotency_scope_key_unique" UNIQUE("school_id","student_id","resource_type","request_key","created_by_user_id"),
	CONSTRAINT "student_care_idempotency_request_key_check" CHECK (length("student_care_idempotency"."request_key") BETWEEN 8 AND 128),
	CONSTRAINT "student_care_idempotency_request_hash_check" CHECK (length("student_care_idempotency"."request_hash")=64),
	CONSTRAINT "student_care_idempotency_resource_type_check" CHECK ("student_care_idempotency"."resource_type" IN ('MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR'))
);

CREATE TABLE "student_care_record_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"record_type" text NOT NULL,
	"record_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"changed_by_user_id" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_care_history_record_revision_unique" UNIQUE("record_type","record_id","revision"),
	CONSTRAINT "student_care_history_record_type_check" CHECK ("student_care_record_history"."record_type" IN ('MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR','BEHAVIOUR_CONFIGURATION'))
);

CREATE TABLE "student_identification_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"policy" text DEFAULT 'NFC_ONLY' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "student_medical_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"blood_group" text,
	"genotype" text,
	"allergies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"support_needs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"medications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emergency_medical_notes" text,
	"provider_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "student_medical_profiles_student_school_unique" UNIQUE("student_id","school_id"),
	CONSTRAINT "student_medical_profiles_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "student_medical_profiles_allergies_array" CHECK (jsonb_typeof("student_medical_profiles"."allergies")='array'),
	CONSTRAINT "student_medical_profiles_conditions_array" CHECK (jsonb_typeof("student_medical_profiles"."conditions")='array'),
	CONSTRAINT "student_medical_profiles_support_array" CHECK (jsonb_typeof("student_medical_profiles"."support_needs")='array'),
	CONSTRAINT "student_medical_profiles_medications_array" CHECK (jsonb_typeof("student_medical_profiles"."medications")='array'),
	CONSTRAINT "student_medical_profiles_providers_array" CHECK (jsonb_typeof("student_medical_profiles"."provider_contacts")='array'),
	CONSTRAINT "student_medical_profiles_contacts_array" CHECK (jsonb_typeof("student_medical_profiles"."emergency_contacts")='array'),
	CONSTRAINT "student_medical_profiles_version_positive_check" CHECK ("student_medical_profiles"."version" > 0)
);

CREATE TABLE "student_medical_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"symptoms" text,
	"observations" text,
	"action_taken" text,
	"treatment" text,
	"referral" text,
	"follow_up_at" timestamp with time zone,
	"follow_up_notes" text,
	"notes" text,
	"recorded_by_user_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "student_medical_visits_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "student_medical_visits_version_positive_check" CHECK ("student_medical_visits"."version" > 0)
);

CREATE TABLE "student_welfare_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"category" text NOT NULL,
	"concern" text NOT NULL,
	"assigned_staff_user_id" integer,
	"follow_up_at" timestamp with time zone,
	"follow_up_status" text DEFAULT 'PENDING' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"internal_notes" text,
	"parent_visible" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "student_welfare_records_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "student_welfare_records_category_check" CHECK ("student_welfare_records"."category" IN ('WELFARE_CONCERN','COUNSELLING_REFERRAL','SAFEGUARDING','FAMILY_SUPPORT','LEARNING_SUPPORT')),
	CONSTRAINT "student_welfare_records_status_check" CHECK ("student_welfare_records"."status" IN ('OPEN','IN_PROGRESS','RESOLVED')),
	CONSTRAINT "student_welfare_records_follow_up_check" CHECK ("student_welfare_records"."follow_up_status" IN ('NOT_REQUIRED','PENDING','IN_PROGRESS','COMPLETE')),
	CONSTRAINT "student_welfare_records_version_positive_check" CHECK ("student_welfare_records"."version" > 0),
	CONSTRAINT "student_welfare_records_safeguarding_private_check" CHECK ("student_welfare_records"."category" <> 'SAFEGUARDING' OR "student_welfare_records"."parent_visible"=FALSE)
);

CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"term" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '5000' NOT NULL,
	"school_share" numeric(12, 2) DEFAULT '2000' NOT NULL,
	"edupulse_share" numeric(12, 2) DEFAULT '3000' NOT NULL,
	"partner_profile_id" integer,
	"partner_share" numeric(12, 2),
	"allocation_snapshot" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'test' NOT NULL,
	"provider_reference" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_partner_allocation_integrity" CHECK ("subscriptions"."partner_profile_id" IS NULL OR ("subscriptions"."partner_share" IS NOT NULL AND "subscriptions"."amount" = "subscriptions"."school_share" + "subscriptions"."edupulse_share" + "subscriptions"."partner_share"))
);

CREATE TABLE "teacher_class_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"subject_id" integer,
	"section" text NOT NULL,
	"assignment_type" text DEFAULT 'CLASS_TEACHER' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "teacher_duty_roster" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"duty_role" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_duty_roster_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "teacher_duty_roster_dates_check" CHECK ("teacher_duty_roster"."end_date" >= "teacher_duty_roster"."start_date"),
	CONSTRAINT "teacher_duty_roster_status_check" CHECK ("teacher_duty_roster"."status" IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE "teacher_subject_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_subject_assignments_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "teacher_subject_assignments_dates_check" CHECK ("teacher_subject_assignments"."end_date" IS NULL OR "teacher_subject_assignments"."end_date" >= "teacher_subject_assignments"."start_date"),
	CONSTRAINT "teacher_subject_assignments_status_check" CHECK ("teacher_subject_assignments"."status" IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE "transport_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"bus_id" integer NOT NULL,
	"driver_employee_id" integer NOT NULL,
	"name" text NOT NULL,
	"weekdays" text[] NOT NULL,
	"departure_time" text NOT NULL,
	"arrival_time" text NOT NULL,
	"fare_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_routes_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_routes_name_check" CHECK (length(btrim("transport_routes"."name")) BETWEEN 2 AND 120),
	CONSTRAINT "transport_routes_weekdays_check" CHECK (
      cardinality("transport_routes"."weekdays") BETWEEN 1 AND 7
      AND "transport_routes"."weekdays" <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::text[]
    ),
	CONSTRAINT "transport_routes_departure_time_check" CHECK ("transport_routes"."departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
	CONSTRAINT "transport_routes_arrival_time_check" CHECK ("transport_routes"."arrival_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
	CONSTRAINT "transport_routes_schedule_order_check" CHECK ("transport_routes"."arrival_time" > "transport_routes"."departure_time"),
	CONSTRAINT "transport_routes_fare_currency_check" CHECK ("transport_routes"."fare_minor" >= 0 AND "transport_routes"."currency" = 'NGN'),
	CONSTRAINT "transport_routes_status_check" CHECK ("transport_routes"."status" IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE "academic_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"subject_id" integer NOT NULL,
	"assessment_type_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"assessment_date" date NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_assessments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assessments_max_score_check" CHECK ("academic_assessments"."max_score" > 0),
	CONSTRAINT "academic_assessments_status_check" CHECK ("academic_assessments"."status" IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'ARCHIVED'))
);

CREATE TABLE "academic_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_assignments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_assignments_max_score_check" CHECK ("academic_assignments"."max_score" > 0),
	CONSTRAINT "academic_assignments_dates_check" CHECK ("academic_assignments"."due_date" >= "academic_assignments"."issue_date"),
	CONSTRAINT "academic_assignments_status_check" CHECK ("academic_assignments"."status" IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'))
);

CREATE TABLE "academic_result_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"return_comment" text,
	CONSTRAINT "academic_result_batches_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_result_batches_context_unique" UNIQUE("school_id","academic_session_id","academic_term_id","school_class_id","section","subject_id"),
	CONSTRAINT "academic_result_batches_revision_check" CHECK ("academic_result_batches"."revision">=0),
	CONSTRAINT "academic_result_batches_status_check" CHECK ("academic_result_batches"."status" IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','LOCKED')),
	CONSTRAINT "academic_result_batches_components_check" CHECK (jsonb_typeof("academic_result_batches"."components")='array')
);

CREATE TABLE "academic_timetable_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text NOT NULL,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"weekday" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_timetable_entries_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_timetable_entries_weekday_check" CHECK ("academic_timetable_entries"."weekday" IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')),
	CONSTRAINT "academic_timetable_entries_time_check" CHECK ("academic_timetable_entries"."end_time" > "academic_timetable_entries"."start_time"),
	CONSTRAINT "academic_timetable_entries_status_check" CHECK ("academic_timetable_entries"."status" IN ('ACTIVE', 'CANCELLED', 'ARCHIVED'))
);

CREATE TABLE "admission_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"application_number" text NOT NULL,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"source" text NOT NULL,
	"applicant_first_name" text NOT NULL,
	"applicant_middle_name" text,
	"applicant_last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text NOT NULL,
	"photo_object_path" text,
	"previous_school" text,
	"previous_class" text,
	"intended_class_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer,
	"applicant_address" text,
	"guardian_name" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"guardian_email" text,
	"guardian_relationship" text,
	"guardian_address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relationship" text,
	"receipt_secret_hash" text,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"assessment" jsonb,
	"interview" jsonb,
	"internal_notes" text,
	"public_message" text,
	"converted_student_id" integer,
	"converted_parent_id" integer,
	"created_by_user_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_applications_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "admission_applications_status_check" CHECK ("admission_applications"."status" IN ('Draft','Submitted','UnderReview','Shortlisted','InterviewScheduled','AssessmentPending','AssessmentCompleted','Accepted','Waitlisted','Rejected','Withdrawn','Enrolled')),
	CONSTRAINT "admission_applications_source_check" CHECK ("admission_applications"."source" IN ('PUBLIC','STAFF')),
	CONSTRAINT "admission_applications_gender_check" CHECK ("admission_applications"."gender" IN ('Female','Male','Other','PreferNotToSay')),
	CONSTRAINT "admission_applications_phone_check" CHECK ("admission_applications"."guardian_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "admission_applications_emergency_phone_check" CHECK ("admission_applications"."emergency_contact_phone" IS NULL OR "admission_applications"."emergency_contact_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "admission_applications_emergency_contact_pair_check" CHECK (("admission_applications"."emergency_contact_name" IS NULL) = ("admission_applications"."emergency_contact_phone" IS NULL)),
	CONSTRAINT "admission_applications_receipt_hash_check" CHECK ("admission_applications"."receipt_secret_hash" IS NULL OR "admission_applications"."receipt_secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admission_applications_payload_hash_check" CHECK ("admission_applications"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admission_applications_idempotency_key_check" CHECK (length("admission_applications"."idempotency_key") BETWEEN 16 AND 128),
	CONSTRAINT "admission_applications_photo_path_check" CHECK ("admission_applications"."photo_object_path" IS NULL OR "admission_applications"."photo_object_path" ~ '^/objects/admissions/'),
	CONSTRAINT "admission_applications_version_check" CHECK ("admission_applications"."version" >= 1)
);

CREATE TABLE "admission_portal_settings" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"portal_key" text NOT NULL,
	"is_open" boolean DEFAULT false NOT NULL,
	"academic_session_id" integer,
	"academic_term_id" integer,
	"deadline" date,
	"fee_info" text,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructions" text,
	"entrance_examination" text,
	"interview_information" text,
	"public_description" text,
	"public_address" text,
	"public_phone" text,
	"public_email" text,
	"logo_object_path" text,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_portal_settings_slug_check" CHECK ("admission_portal_settings"."portal_key" ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
	CONSTRAINT "admission_portal_settings_public_phone_check" CHECK ("admission_portal_settings"."public_phone" IS NULL OR "admission_portal_settings"."public_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "admission_portal_settings_requirements_array_check" CHECK (jsonb_typeof("admission_portal_settings"."requirements") = 'array'),
	CONSTRAINT "admission_portal_settings_documents_array_check" CHECK (jsonb_typeof("admission_portal_settings"."required_documents") = 'array')
);

CREATE TABLE "class_subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer,
	"employee_id" integer,
	"section" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "commission_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"commission_rule_id" integer NOT NULL,
	"academic_session_id" integer,
	"term" text NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payout_id" integer,
	"approved_at" timestamp with time zone,
	"payable_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"held_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"payment_reference" text,
	"adjustment_reference" text,
	"reversal_reference" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_ledger_amount_nonnegative" CHECK ("commission_ledger"."amount" >= 0 AND "commission_ledger"."count" > 0),
	CONSTRAINT "commission_ledger_status_check" CHECK ("commission_ledger"."status" IN ('PENDING','APPROVED','PAYABLE','PAID','HELD','REVERSED','CANCELLED'))
);

CREATE TABLE "communication_campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"notification_id" integer,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "communication_campaign_recipients_campaign_user_unique" UNIQUE("campaign_id","recipient_user_id"),
	CONSTRAINT "communication_campaign_recipients_status_check" CHECK ("communication_campaign_recipients"."status" IN (
      'QUEUED','SENT','FAILED','SKIPPED'
    ))
);

CREATE TABLE "communication_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"provider_name" text,
	"push_attempts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"receipt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_acknowledged_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_deliveries_notification_channel_unique" UNIQUE("notification_id","channel"),
	CONSTRAINT "communication_deliveries_channel_check" CHECK ("communication_deliveries"."channel" IN ('IN_APP','SMS','EMAIL','PUSH')),
	CONSTRAINT "communication_deliveries_status_check" CHECK ("communication_deliveries"."status" IN (
      'QUEUED','PROCESSING','SENT','DELIVERED','READ','FAILED','CANCELLED'
    )),
	CONSTRAINT "communication_deliveries_attempts_check" CHECK ("communication_deliveries"."attempts" >= 0),
	CONSTRAINT "communication_deliveries_delivered_status_check" CHECK (
      "communication_deliveries"."delivered_at" IS NULL OR "communication_deliveries"."status" IN ('DELIVERED','READ')
    ),
	CONSTRAINT "communication_deliveries_provider_ack_channel_check" CHECK (
      "communication_deliveries"."provider_acknowledged_at" IS NULL OR "communication_deliveries"."channel" <> 'IN_APP'
    )
);

CREATE TABLE "communication_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"sender_user_id" integer NOT NULL,
	"request_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_messages_request_key_check" CHECK (length("communication_messages"."request_key") BETWEEN 8 AND 128),
	CONSTRAINT "communication_messages_content_hash_check" CHECK (length("communication_messages"."content_hash") = 64),
	CONSTRAINT "communication_messages_body_check" CHECK (length(btrim("communication_messages"."body")) BETWEEN 1 AND 5000)
);

CREATE TABLE "device_assignment_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"previous_school_id" integer,
	"new_school_id" integer,
	"previous_location" text,
	"location" text,
	"action" text NOT NULL,
	"reason" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "device_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"credential_identifier" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "device_school_bindings" (
	"device_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_school_bindings_pkey" PRIMARY KEY("device_id","school_id")
);

CREATE TABLE "exam_question_papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"examination_name" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"duration" text,
	"total_marks" numeric(10, 2),
	"approved_at" timestamp with time zone,
	CONSTRAINT "exam_question_papers_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "exam_question_papers_revision_check" CHECK ("exam_question_papers"."revision">=0),
	CONSTRAINT "exam_question_papers_status_check" CHECK ("exam_question_papers"."status" IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED')),
	CONSTRAINT "exam_question_papers_marks_check" CHECK ("exam_question_papers"."total_marks" IS NULL OR "exam_question_papers"."total_marks">0),
	CONSTRAINT "exam_question_papers_approval_check" CHECK ("exam_question_papers"."status"<>'APPROVED' OR "exam_question_papers"."approved_at" IS NOT NULL)
);

CREATE TABLE "fee_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structures_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_structures_status_check" CHECK ("fee_structures"."status" IN ('DRAFT','PUBLISHED','INACTIVE'))
);

CREATE TABLE "library_book_copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"copy_code" text NOT NULL,
	"barcode" text,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"location" text,
	"acquired_on" date,
	"acquisition_reference" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_book_copies_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_book_copies_school_book_id_unique" UNIQUE("school_id","book_id","id"),
	CONSTRAINT "library_book_copies_code_check" CHECK (length(btrim("library_book_copies"."copy_code")) BETWEEN 1 AND 100),
	CONSTRAINT "library_book_copies_condition_check" CHECK ("library_book_copies"."condition" IN ('NEW','GOOD','FAIR','POOR')),
	CONSTRAINT "library_book_copies_status_check" CHECK (
      "library_book_copies"."status" IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')
    )
);

CREATE TABLE "maintenance_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"category_id" integer,
	"category_type" text DEFAULT 'MAINTENANCE' NOT NULL,
	"asset_id" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"reported_by_user_id" integer NOT NULL,
	"assigned_to_user_id" integer,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_requests_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "maintenance_requests_category_type_check" CHECK ("maintenance_requests"."category_type" = 'MAINTENANCE'),
	CONSTRAINT "maintenance_requests_priority_check" CHECK ("maintenance_requests"."priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
	CONSTRAINT "maintenance_requests_status_check" CHECK ("maintenance_requests"."status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE "operational_task_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_task_status_history_status_check" CHECK (("operational_task_status_history"."from_status" IS NULL OR "operational_task_status_history"."from_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
        AND "operational_task_status_history"."to_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE "partner_attribution_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"existing_partner_profile_id" integer,
	"attempted_partner_profile_id" integer NOT NULL,
	"referral_link_id" integer,
	"source" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"metadata" jsonb,
	"evidence" jsonb,
	"resolved_by" integer,
	"decision" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_items" (
	"id" serial PRIMARY KEY NOT NULL,
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
	CONSTRAINT "payroll_items_id_period_unique" UNIQUE("id","period_id"),
	CONSTRAINT "payroll_items_tenant_check" CHECK (
    ("payroll_items"."scope"='SCHOOL' AND "payroll_items"."school_id" IS NOT NULL)
    OR ("payroll_items"."scope"='YEMAIT_COMPANY' AND "payroll_items"."school_id" IS NULL)),
	CONSTRAINT "payroll_items_amounts_check" CHECK (
    "payroll_items"."base_salary_minor" >= 0 AND "payroll_items"."allowance_minor" >= 0 AND "payroll_items"."bonus_minor" >= 0
    AND "payroll_items"."deduction_minor" >= 0
    AND "payroll_items"."net_salary_minor" = "payroll_items"."base_salary_minor"+"payroll_items"."allowance_minor"+"payroll_items"."bonus_minor"
      +"payroll_items"."adjustment_minor"-"payroll_items"."deduction_minor" AND "payroll_items"."net_salary_minor" >= 0),
	CONSTRAINT "payroll_items_currency_check" CHECK ("payroll_items"."currency"='NGN'),
	CONSTRAINT "payroll_items_bank_snapshot_check" CHECK (
    NULLIF(BTRIM("payroll_items"."bank_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_items"."bank_code_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_items"."account_name_encrypted"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_items"."account_number_encrypted"),'') IS NOT NULL
    AND "payroll_items"."account_last4" ~ '^[0-9]{4}$'
    AND NULLIF(BTRIM("payroll_items"."encryption_key_version"),'') IS NOT NULL),
	CONSTRAINT "payroll_items_role_check" CHECK ("payroll_items"."role_snapshot" IN ('TEACHER','STAFF','COMPANY_EMPLOYEE')),
	CONSTRAINT "payroll_items_adjustment_audit_check" CHECK (
    ("payroll_items"."adjustment_minor"=0 AND "payroll_items"."adjustment_reason" IS NULL)
    OR ("payroll_items"."adjustment_minor"<>0 AND NULLIF(BTRIM("payroll_items"."adjustment_reason"),'') IS NOT NULL))
);

CREATE TABLE "school_asset_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"quantity_before" integer,
	"quantity_after" integer,
	"assigned_to_before_user_id" integer,
	"assigned_to_after_user_id" integer,
	"status_before" text,
	"status_after" text,
	"actor_user_id" integer NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "school_asset_history_event_type_check" CHECK ("school_asset_history"."event_type" IN ('CREATED', 'QUANTITY_CHANGED', 'ASSIGNMENT_CHANGED', 'STATUS_CHANGED', 'UPDATED')),
	CONSTRAINT "school_asset_history_quantity_check" CHECK (("school_asset_history"."quantity_before" IS NULL OR "school_asset_history"."quantity_before" >= 0)
        AND ("school_asset_history"."quantity_after" IS NULL OR "school_asset_history"."quantity_after" >= 0)),
	CONSTRAINT "school_asset_history_status_check" CHECK (("school_asset_history"."status_before" IS NULL OR "school_asset_history"."status_before" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))
        AND ("school_asset_history"."status_after" IS NULL OR "school_asset_history"."status_after" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED')))
);

CREATE TABLE "school_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer,
	"academic_term_id" integer,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_academic" boolean DEFAULT true NOT NULL,
	"audience" text[] DEFAULT ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_calendar_events_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "school_calendar_events_source_check" CHECK ("school_calendar_events"."source" IN ('GENERATED', 'SCHOOL_EVENT')),
	CONSTRAINT "school_calendar_events_category_check" CHECK ("school_calendar_events"."category" IN ('RESUMPTION','MID_TERM_BREAK','HOLIDAY','EXAMINATION','RESULT_PUBLICATION','SCHOOL_EVENT','OTHER')),
	CONSTRAINT "school_calendar_events_status_check" CHECK ("school_calendar_events"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "school_calendar_events_dates_check" CHECK ("school_calendar_events"."end_date" IS NULL OR "school_calendar_events"."end_date" >= "school_calendar_events"."start_date"),
	CONSTRAINT "school_calendar_events_audience_check" CHECK (cardinality("school_calendar_events"."audience") > 0
        AND "school_calendar_events"."audience" <@ ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[])
);

CREATE TABLE "school_curriculum_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"curriculum_version_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"confirmed_by" integer NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_curriculum_assignments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_curriculum_assignments_status_check" CHECK ("school_curriculum_assignments"."status" IN ('ACTIVE','ARCHIVED'))
);

CREATE TABLE "school_partner_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"referral_link_id" integer,
	"source" text DEFAULT 'REFERRAL_LINK' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "school_subscription_enforcement" (
	"school_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"restricted_student_ids" integer[] DEFAULT '{}' NOT NULL,
	"school_locked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_subscription_enforcement_school_id_academic_term_id_pk" PRIMARY KEY("school_id","academic_term_id")
);

CREATE TABLE "student_behaviour_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"school_class_id" integer,
	"subject_id" integer,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"reporter_user_id" integer NOT NULL,
	"action" text,
	"parent_notification_status" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	"parent_notification_id" integer,
	"follow_up_at" timestamp with time zone,
	"follow_up_notes" text,
	"status" text DEFAULT 'REVIEW' NOT NULL,
	"resolution" text,
	"internal_notes" text,
	"parent_visible" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "student_behaviour_records_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "student_behaviour_records_category_check" CHECK ("student_behaviour_records"."category" IN ('POSITIVE','CONCERN','INCIDENT','RULE_VIOLATION','RECOGNITION')),
	CONSTRAINT "student_behaviour_records_description_nonempty_check" CHECK (length(btrim("student_behaviour_records"."description")) > 0),
	CONSTRAINT "student_behaviour_records_severity_check" CHECK ("student_behaviour_records"."severity" IN ('LOW','MODERATE','HIGH','CRITICAL')),
	CONSTRAINT "student_behaviour_records_status_check" CHECK ("student_behaviour_records"."status" IN ('REVIEW','ACTION','PARENT_NOTIFICATION','FOLLOW_UP','RESOLVED')),
	CONSTRAINT "student_behaviour_records_parent_notification_check" CHECK ("student_behaviour_records"."parent_notification_status" IN ('NOT_REQUESTED','QUEUED','PARTIAL','NOT_CONFIGURED','FAILED')),
	CONSTRAINT "student_behaviour_records_version_check" CHECK ("student_behaviour_records"."version" > 0)
);

CREATE TABLE "student_class_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer,
	"school_class_id" integer NOT NULL,
	"section" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_class_assignments_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "student_subscription_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"payer_user_id" integer NOT NULL,
	"provider" text DEFAULT 'FLUTTERWAVE' NOT NULL,
	"provider_mode" text DEFAULT 'SANDBOX' NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"gross_amount_minor" integer DEFAULT 500000 NOT NULL,
	"provider_fee_minor" integer,
	"settlement_amount_minor" integer,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"settlement_status" text DEFAULT 'PENDING' NOT NULL,
	"reconciliation_status" text DEFAULT 'PENDING' NOT NULL,
	"checkout_url" text,
	"provider_transaction_id" text,
	"provider_paid_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failure_code" text,
	"receipt_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_subscription_payments_provider_ck" CHECK ("student_subscription_payments"."provider" = 'FLUTTERWAVE'),
	CONSTRAINT "student_subscription_payments_provider_mode_ck" CHECK ("student_subscription_payments"."provider_mode" = 'SANDBOX'),
	CONSTRAINT "student_subscription_payments_reference_ck" CHECK ("student_subscription_payments"."reference" ~ '^[A-Za-z0-9_-]{8,100}$'),
	CONSTRAINT "student_subscription_payments_gross_ck" CHECK ("student_subscription_payments"."gross_amount_minor" = 500000 AND "student_subscription_payments"."currency" = 'NGN'
        AND ("student_subscription_payments"."provider_fee_minor" IS NULL OR "student_subscription_payments"."provider_fee_minor" >= 0)
        AND ("student_subscription_payments"."settlement_amount_minor" IS NULL
          OR "student_subscription_payments"."settlement_amount_minor" BETWEEN 0 AND "student_subscription_payments"."gross_amount_minor")),
	CONSTRAINT "student_subscription_payments_status_ck" CHECK ("student_subscription_payments"."status" IN ('PENDING','PAID','FAILED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "student_subscription_payments_settlement_ck" CHECK ("student_subscription_payments"."settlement_status" IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
	CONSTRAINT "student_subscription_payments_reconciliation_ck" CHECK ("student_subscription_payments"."reconciliation_status" IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE'))
);

CREATE TABLE "transport_route_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"role" text DEFAULT 'ACCOMPANIER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_route_staff_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_route_staff_role_check" CHECK ("transport_route_staff"."role" IN ('TEACHER', 'STAFF', 'ACCOMPANIER'))
);

CREATE TABLE "transport_route_stops" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"name" text NOT NULL,
	"stop_type" text NOT NULL,
	"sequence" integer NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_route_stops_id_route_school_unique" UNIQUE("id","route_id","school_id"),
	CONSTRAINT "transport_route_stops_name_check" CHECK (length(btrim("transport_route_stops"."name")) BETWEEN 2 AND 120),
	CONSTRAINT "transport_route_stops_type_check" CHECK ("transport_route_stops"."stop_type" IN ('PICKUP', 'DROPOFF', 'BOTH')),
	CONSTRAINT "transport_route_stops_sequence_check" CHECK ("transport_route_stops"."sequence" > 0)
);

CREATE TABLE "academic_report_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"student_class_assignment_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"class_name_snapshot" text NOT NULL,
	"section_snapshot" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"teacher_remark" text NOT NULL,
	"school_remark" text NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_report_cards_student_session_term_unique" UNIQUE("student_id","academic_session_id","academic_term_id"),
	CONSTRAINT "academic_report_cards_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_report_cards_status_check" CHECK ("academic_report_cards"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "academic_report_cards_publication_check" CHECK (("academic_report_cards"."status" = 'PUBLISHED' AND "academic_report_cards"."published_by" IS NOT NULL AND "academic_report_cards"."published_at" IS NOT NULL) OR ("academic_report_cards"."status" <> 'PUBLISHED'))
);

CREATE TABLE "academic_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"student_class_assignment_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"section_snapshot" text NOT NULL,
	"subject_id" integer NOT NULL,
	"score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text,
	"grade_point" numeric(5, 2),
	"remark" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"review_status" text DEFAULT 'NOT_REVIEWED' NOT NULL,
	"review_comment" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_results_assessment_student_unique" UNIQUE("assessment_id","student_id"),
	CONSTRAINT "academic_results_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_results_score_check" CHECK ("academic_results"."score" >= 0 AND "academic_results"."max_score" > 0 AND "academic_results"."score" <= "academic_results"."max_score"),
	CONSTRAINT "academic_results_status_check" CHECK ("academic_results"."status" IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "academic_results_publication_check" CHECK (("academic_results"."status" = 'PUBLISHED' AND "academic_results"."published_by" IS NOT NULL AND "academic_results"."published_at" IS NOT NULL) OR ("academic_results"."status" <> 'PUBLISHED'))
);

CREATE TABLE "admission_application_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"object_path" text NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_application_documents_content_type_check" CHECK ("admission_application_documents"."content_type" IN ('application/pdf','image/jpeg','image/png','image/webp')),
	CONSTRAINT "admission_application_documents_size_check" CHECK ("admission_application_documents"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "admission_application_documents_object_path_check" CHECK ("admission_application_documents"."object_path" ~ '^/objects/admissions/(intake/[a-z0-9][a-z0-9-]{2,79}|[1-9][0-9]*/[1-9][0-9]*)/(photo-)?[0-9a-f-]{36}$')
);

CREATE TABLE "admission_portal_classes" (
	"school_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_portal_classes_pk" PRIMARY KEY("school_id","class_id")
);

CREATE TABLE "biometric_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"device_id" integer,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "biometric_enrollments_subject_check" CHECK ((("student_id" IS NOT NULL)::int + ("employee_id" IS NOT NULL)::int) = 1)
);

CREATE TABLE "curriculum_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"mapping_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"progress_status" text NOT NULL,
	"completed_date" date,
	"comment" text,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculum_progress_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "curriculum_progress_mapping_topic_unique" UNIQUE("school_id","mapping_id","topic_id"),
	CONSTRAINT "curriculum_progress_status_check" CHECK ("curriculum_progress"."progress_status" IN ('PLANNED','IN_PROGRESS','COMPLETED','DEFERRED'))
);

CREATE TABLE "curriculum_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"curriculum_version_id" integer,
	"school_id" integer,
	"mapping_id" integer,
	"class_level" text NOT NULL,
	"subject_code" text NOT NULL,
	"parent_topic_id" integer,
	"title" text NOT NULL,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"learning_outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_kind" text NOT NULL,
	"sequence_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculum_topics_id_version_unique" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "curriculum_topics_id_mapping_school_unique" UNIQUE("id","mapping_id","school_id"),
	CONSTRAINT "curriculum_topics_source_check" CHECK ("curriculum_topics"."source_kind" IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')),
	CONSTRAINT "curriculum_topics_origin_check" CHECK (("curriculum_topics"."curriculum_version_id" IS NOT NULL AND "curriculum_topics"."mapping_id" IS NULL AND "curriculum_topics"."school_id" IS NULL) OR ("curriculum_topics"."curriculum_version_id" IS NULL AND "curriculum_topics"."mapping_id" IS NOT NULL AND "curriculum_topics"."school_id" IS NOT NULL AND "curriculum_topics"."source_kind" = 'SCHOOL_SPECIFIC'))
);

CREATE TABLE "exam_question_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"paper_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"object_path" text NOT NULL,
	"sha256" text NOT NULL,
	"preview_text" text DEFAULT '' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_versions_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "exam_question_versions_paper_revision_unique" UNIQUE("paper_id","revision"),
	CONSTRAINT "exam_question_versions_revision_check" CHECK ("exam_question_versions"."revision">0),
	CONSTRAINT "exam_question_versions_object_check" CHECK ("exam_question_versions"."object_path" LIKE '/objects/exam-questions/%'),
	CONSTRAINT "exam_question_versions_sha_check" CHECK (length("exam_question_versions"."sha256")=64)
);

CREATE TABLE "fee_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
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
	"currency" text DEFAULT 'NGN' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"waiver_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"paid_minor" integer DEFAULT 0 NOT NULL,
	"outstanding_minor" integer NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoices_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoices_school_number_unique" UNIQUE("school_id","invoice_number"),
	CONSTRAINT "fee_invoices_assignment_unique" UNIQUE("school_id","student_id","structure_id"),
	CONSTRAINT "fee_invoices_person_check" CHECK (("fee_invoices"."student_id" IS NULL)<>("fee_invoices"."employee_id" IS NULL)),
	CONSTRAINT "fee_invoices_amounts_check" CHECK ("fee_invoices"."subtotal_minor" >= 0 AND "fee_invoices"."discount_minor" >= 0 AND "fee_invoices"."waiver_minor" >= 0
      AND "fee_invoices"."discount_minor" + "fee_invoices"."waiver_minor" <= "fee_invoices"."subtotal_minor"
      AND "fee_invoices"."total_minor" = "fee_invoices"."subtotal_minor" - "fee_invoices"."discount_minor" - "fee_invoices"."waiver_minor"
      AND "fee_invoices"."paid_minor" >= 0 AND "fee_invoices"."paid_minor" <= "fee_invoices"."total_minor"
      AND "fee_invoices"."outstanding_minor" = "fee_invoices"."total_minor" - "fee_invoices"."paid_minor"),
	CONSTRAINT "fee_invoices_status_check" CHECK ("fee_invoices"."status" IN ('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','WAIVED','CANCELLED'))
);

CREATE TABLE "fee_structure_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"structure_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"category_name_snapshot" text NOT NULL,
	"description_snapshot" text NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "fee_structure_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_structure_lines_structure_category_unique" UNIQUE("structure_id","category_id"),
	CONSTRAINT "fee_structure_lines_amount_check" CHECK ("fee_structure_lines"."amount_minor" > 0)
);

CREATE TABLE "lesson_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"school_class_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"teacher_employee_id" integer NOT NULL,
	"section" text,
	"week" integer NOT NULL,
	"lesson_date" date NOT NULL,
	"curriculum_mapping_id" integer,
	"curriculum_version_id" integer,
	"topic_id" integer,
	"sub_topic_id" integer,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" integer NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_notes_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "lesson_notes_week_check" CHECK ("lesson_notes"."week" BETWEEN 1 AND 60),
	CONSTRAINT "lesson_notes_revision_check" CHECK ("lesson_notes"."revision" >= 0),
	CONSTRAINT "lesson_notes_status_check" CHECK ("lesson_notes"."status" IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED','ARCHIVED'))
);

CREATE TABLE "library_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"borrower_type" text NOT NULL,
	"borrower_user_id" integer NOT NULL,
	"borrower_student_id" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date NOT NULL,
	"returned_at" timestamp with time zone,
	"returned_overdue" boolean,
	"days_overdue_at_return" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"issued_by_user_id" integer NOT NULL,
	"returned_by_user_id" integer,
	"renewal_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_loans_school_id_unique" UNIQUE("school_id","id"),
	CONSTRAINT "library_loans_borrower_type_check" CHECK ("library_loans"."borrower_type" IN ('STUDENT','TEACHER','STAFF')),
	CONSTRAINT "library_loans_status_check" CHECK ("library_loans"."status" IN ('OPEN','RETURNED','LOST')),
	CONSTRAINT "library_loans_renewal_count_check" CHECK ("library_loans"."renewal_count" >= 0),
	CONSTRAINT "library_loans_days_overdue_check" CHECK (
      "library_loans"."days_overdue_at_return" IS NULL OR "library_loans"."days_overdue_at_return" >= 0
    ),
	CONSTRAINT "library_loans_borrower_student_check" CHECK (
      ("library_loans"."borrower_type" = 'STUDENT' AND "library_loans"."borrower_student_id" IS NOT NULL) OR
      ("library_loans"."borrower_type" IN ('TEACHER','STAFF') AND "library_loans"."borrower_student_id" IS NULL)
    ),
	CONSTRAINT "library_loans_returned_state_check" CHECK (
      ("library_loans"."status"='RETURNED' AND "library_loans"."returned_at" IS NOT NULL AND "library_loans"."returned_by_user_id" IS NOT NULL
        AND "library_loans"."returned_overdue" IS NOT NULL AND "library_loans"."days_overdue_at_return" IS NOT NULL)
      OR ("library_loans"."status"<>'RETURNED' AND "library_loans"."returned_at" IS NULL AND "library_loans"."returned_by_user_id" IS NULL
        AND "library_loans"."returned_overdue" IS NULL AND "library_loans"."days_overdue_at_return" IS NULL)
    )
);

CREATE TABLE "maintenance_request_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"maintenance_request_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_request_status_history_status_check" CHECK (("maintenance_request_status_history"."from_status" IS NULL OR "maintenance_request_status_history"."from_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
        AND "maintenance_request_status_history"."to_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE "nfc_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"uid" text NOT NULL,
	"student_id" integer,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"last_scan" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"replaced_by_card_id" integer,
	"replaced_by_school_id" integer,
	"last_device_id" integer,
	CONSTRAINT "nfc_cards_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "payroll_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"requested_by" integer NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_transfers_id_scope_school_unique" UNIQUE("id","scope","school_id"),
	CONSTRAINT "payroll_transfers_tenant_check" CHECK (
    ("payroll_transfers"."scope"='SCHOOL' AND "payroll_transfers"."school_id" IS NOT NULL)
    OR ("payroll_transfers"."scope"='YEMAIT_COMPANY' AND "payroll_transfers"."school_id" IS NULL)),
	CONSTRAINT "payroll_transfers_provider_check" CHECK (
    ("payroll_transfers"."provider"='FLUTTERWAVE' AND "payroll_transfers"."provider_mode" IN ('TEST','LIVE'))
    OR ("payroll_transfers"."provider"='MOCK' AND "payroll_transfers"."provider_mode"='MOCK')),
	CONSTRAINT "payroll_transfers_status_check" CHECK ("payroll_transfers"."status" IN (
    'CLAIMED','PROCESSING','PENDING','MOCK_PENDING','PAID','FAILED','UNCERTAIN','RECONCILIATION_REQUIRED')),
	CONSTRAINT "payroll_transfers_amount_check" CHECK (
    "payroll_transfers"."amount_minor" > 0 AND "payroll_transfers"."provider_fee_minor" >= 0 AND "payroll_transfers"."settlement_amount_minor" >= 0
    AND "payroll_transfers"."currency"='NGN' AND "payroll_transfers"."settlement_amount_minor" <= "payroll_transfers"."amount_minor"),
	CONSTRAINT "payroll_transfers_reference_check" CHECK (
    NULLIF(BTRIM("payroll_transfers"."idempotency_key_hash"),'') IS NOT NULL
    AND NULLIF(BTRIM("payroll_transfers"."provider_reference"),'') IS NOT NULL AND "payroll_transfers"."attempt_number" > 0),
	CONSTRAINT "payroll_transfers_paid_verification_check" CHECK (
    "payroll_transfers"."status"<>'PAID' OR (
      "payroll_transfers"."provider"='FLUTTERWAVE' AND "payroll_transfers"."provider_mode"<>'MOCK'
      AND "payroll_transfers"."external_transfer_verified"=true AND "payroll_transfers"."verified_at" IS NOT NULL AND "payroll_transfers"."verified_by" IS NOT NULL
      AND "payroll_transfers"."provider_transaction_id" IS NOT NULL)),
	CONSTRAINT "payroll_transfers_mock_never_paid_check" CHECK (
    "payroll_transfers"."provider"<>'MOCK' OR ("payroll_transfers"."status"='MOCK_PENDING' AND "payroll_transfers"."external_transfer_verified"=false)),
	CONSTRAINT "payroll_transfers_ambiguous_no_retry_check" CHECK (
    NOT "payroll_transfers"."requires_reconciliation" OR "payroll_transfers"."status" IN ('UNCERTAIN','RECONCILIATION_REQUIRED'))
);

CREATE TABLE "promotion_batch_students" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"student_name_snapshot" text NOT NULL,
	"admission_no_snapshot" text NOT NULL,
	"source_assignment_id" integer NOT NULL,
	"source_session_id" integer NOT NULL,
	"source_term_id" integer,
	"source_class_id" integer NOT NULL,
	"source_class_name" text NOT NULL,
	"source_section" text NOT NULL,
	"recommendation" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"reason" text,
	"academic_performance" jsonb NOT NULL,
	"attendance_summary" jsonb NOT NULL,
	"target_term_id" integer,
	"target_class_id" integer,
	"target_section" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_batch_students_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "promotion_batch_students_batch_student_unique" UNIQUE("batch_id","student_id"),
	CONSTRAINT "promotion_batch_students_status_check" CHECK ("promotion_batch_students"."status" IN ('Pending', 'Eligible', 'Promoted', 'Repeat', 'Graduated', 'Withdrawn', 'Transferred')),
	CONSTRAINT "promotion_batch_students_recommendation_check" CHECK ("promotion_batch_students"."recommendation" IN ('Pending', 'Eligible')),
	CONSTRAINT "promotion_batch_students_target_required_check" CHECK ((("promotion_batch_students"."status" IN ('Promoted', 'Repeat') AND "promotion_batch_students"."target_term_id" IS NOT NULL AND "promotion_batch_students"."target_class_id" IS NOT NULL AND "promotion_batch_students"."target_section" IS NOT NULL AND length(btrim("promotion_batch_students"."target_section")) > 0) OR ("promotion_batch_students"."status" NOT IN ('Promoted', 'Repeat') AND "promotion_batch_students"."target_term_id" IS NULL AND "promotion_batch_students"."target_class_id" IS NULL AND "promotion_batch_students"."target_section" IS NULL))),
	CONSTRAINT "promotion_batch_students_review_shape_check" CHECK (("promotion_batch_students"."reviewed_at" IS NULL AND "promotion_batch_students"."reviewed_by" IS NULL) OR ("promotion_batch_students"."reviewed_at" IS NOT NULL AND "promotion_batch_students"."reviewed_by" IS NOT NULL AND "promotion_batch_students"."reason" IS NOT NULL AND length(btrim("promotion_batch_students"."reason")) > 0))
);

CREATE TABLE "school_security_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"incident_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"security_location_id" integer,
	"security_device_id" integer,
	"student_id" integer,
	"involved_persons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_staff_user_id" integer,
	"description" text NOT NULL,
	"severity" text DEFAULT 'LOW' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"created_by_user_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_security_incidents_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_security_incidents_type_check" CHECK ("school_security_incidents"."incident_type" IN ('UNAUTHORIZED_ACCESS','LOST_CARD','VISITOR_ISSUE','STUDENT_RELEASE','GATE_INCIDENT','SECURITY_CONCERN','OTHER')),
	CONSTRAINT "school_security_incidents_severity_check" CHECK ("school_security_incidents"."severity" IN ('LOW','MODERATE','HIGH','CRITICAL')),
	CONSTRAINT "school_security_incidents_status_check" CHECK ("school_security_incidents"."status" IN ('OPEN','INVESTIGATING','RESOLVED')),
	CONSTRAINT "school_security_incidents_involved_persons_check" CHECK (jsonb_typeof("school_security_incidents"."involved_persons")='array'),
	CONSTRAINT "school_security_incidents_resolution_shape_check" CHECK ("school_security_incidents"."status"<>'RESOLVED' OR ("school_security_incidents"."resolution" IS NOT NULL AND length(btrim("school_security_incidents"."resolution"))>0)),
	CONSTRAINT "school_security_incidents_version_check" CHECK ("school_security_incidents"."version">0)
);

CREATE TABLE "school_security_visitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"visitor_name" text NOT NULL,
	"phone" text,
	"id_reference" text,
	"purpose" text NOT NULL,
	"host_name" text,
	"host_student_id" integer,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_out_at" timestamp with time zone,
	"checkout_idempotency_key" text,
	"status" text DEFAULT 'ON_SITE' NOT NULL,
	"notes" text,
	"security_officer_user_id" integer NOT NULL,
	"security_location_id" integer,
	"security_device_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_security_visitors_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_security_visitors_checkout_key_unique" UNIQUE("school_id","checkout_idempotency_key"),
	CONSTRAINT "school_security_visitors_name_check" CHECK (length(btrim("school_security_visitors"."visitor_name")) BETWEEN 1 AND 160),
	CONSTRAINT "school_security_visitors_purpose_check" CHECK (length(btrim("school_security_visitors"."purpose")) BETWEEN 1 AND 1000),
	CONSTRAINT "school_security_visitors_status_check" CHECK ("school_security_visitors"."status" IN ('ON_SITE','CHECKED_OUT')),
	CONSTRAINT "school_security_visitors_checkout_shape_check" CHECK (("school_security_visitors"."status"='ON_SITE' AND "school_security_visitors"."checked_out_at" IS NULL AND "school_security_visitors"."checkout_idempotency_key" IS NULL) OR ("school_security_visitors"."status"='CHECKED_OUT' AND "school_security_visitors"."checked_out_at" IS NOT NULL AND "school_security_visitors"."checkout_idempotency_key" IS NOT NULL)),
	CONSTRAINT "school_security_visitors_version_check" CHECK ("school_security_visitors"."version">0)
);

CREATE TABLE "security_readers" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"permissions" text[] DEFAULT ARRAY['ENTRY','EXIT']::text[] NOT NULL,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_readers_device_school_unique" UNIQUE("school_id","device_id"),
	CONSTRAINT "security_readers_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "security_readers_status_check" CHECK ("security_readers"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "security_readers_permissions_check" CHECK (cardinality("security_readers"."permissions") > 0 AND "security_readers"."permissions" <@ ARRAY['ENTRY','EXIT']::text[])
);

CREATE TABLE "staff_nfc_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"product" text DEFAULT 'TEACHER_STAFF_NFC_EID' NOT NULL,
	"billing_rule_id" integer NOT NULL,
	"billing_rule_version" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"school_share_minor" integer NOT NULL,
	"platform_share_minor" integer NOT NULL,
	"partner_share_minor" integer NOT NULL,
	"partner_profile_id" integer,
	"attribution_id" integer,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"due_date" date NOT NULL,
	"created_by" integer,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_nfc_subscriptions_allocation_ck" CHECK ("staff_nfc_subscriptions"."price_minor" > 0 AND "staff_nfc_subscriptions"."school_share_minor" >= 0
          AND "staff_nfc_subscriptions"."platform_share_minor" >= 0 AND "staff_nfc_subscriptions"."partner_share_minor" >= 0
          AND "staff_nfc_subscriptions"."school_share_minor" + "staff_nfc_subscriptions"."platform_share_minor" + "staff_nfc_subscriptions"."partner_share_minor" = "staff_nfc_subscriptions"."price_minor"
          AND (("staff_nfc_subscriptions"."partner_profile_id" IS NULL AND "staff_nfc_subscriptions"."partner_share_minor" = 0 AND "staff_nfc_subscriptions"."attribution_id" IS NULL)
            OR ("staff_nfc_subscriptions"."partner_profile_id" IS NOT NULL AND "staff_nfc_subscriptions"."attribution_id" IS NOT NULL))),
	CONSTRAINT "staff_nfc_subscriptions_status_ck" CHECK ("staff_nfc_subscriptions"."status" IN ('UNPAID','PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
	CONSTRAINT "staff_nfc_subscriptions_currency_ck" CHECK ("staff_nfc_subscriptions"."currency" = 'NGN')
);

CREATE TABLE "student_subscription_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"entry_type" text DEFAULT 'CREDIT' NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" integer,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"payer_user_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"attribution_id" integer,
	"commission_rule_id" integer,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_subscription_allocations_recipient_ck" CHECK ("student_subscription_allocations"."recipient_type" IN ('SCHOOL','PLATFORM','PARTNER','PLATFORM_PROVIDER_FEE')),
	CONSTRAINT "student_subscription_allocations_entry_ck" CHECK ("student_subscription_allocations"."entry_type" IN ('CREDIT','REVERSAL','EXPENSE')),
	CONSTRAINT "student_subscription_allocations_amount_ck" CHECK ("student_subscription_allocations"."amount_minor" > 0 AND "student_subscription_allocations"."currency" = 'NGN'
        AND (("student_subscription_allocations"."entry_type" = 'CREDIT' AND "student_subscription_allocations"."recipient_type" IN ('SCHOOL','PLATFORM','PARTNER'))
          OR ("student_subscription_allocations"."entry_type" = 'REVERSAL' AND "student_subscription_allocations"."recipient_type" IN ('SCHOOL','PLATFORM','PARTNER'))
          OR ("student_subscription_allocations"."entry_type" = 'EXPENSE' AND "student_subscription_allocations"."recipient_type" = 'PLATFORM_PROVIDER_FEE'))),
	CONSTRAINT "student_subscription_allocations_partner_ck" CHECK (("student_subscription_allocations"."recipient_type" = 'PARTNER' AND "student_subscription_allocations"."recipient_id" IS NOT NULL
          AND "student_subscription_allocations"."attribution_id" IS NOT NULL AND "student_subscription_allocations"."commission_rule_id" IS NOT NULL)
        OR ("student_subscription_allocations"."recipient_type" <> 'PARTNER' AND "student_subscription_allocations"."recipient_id" IS NULL))
);

CREATE TABLE "transport_student_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"pickup_stop_id" integer NOT NULL,
	"dropoff_stop_id" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"effective_date" date NOT NULL,
	"end_date" date,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_student_assignments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_student_assignments_status_check" CHECK ("transport_student_assignments"."status" IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
	CONSTRAINT "transport_student_assignments_stops_check" CHECK ("transport_student_assignments"."pickup_stop_id" <> "transport_student_assignments"."dropoff_stop_id"),
	CONSTRAINT "transport_student_assignments_dates_check" CHECK ("transport_student_assignments"."end_date" IS NULL OR "transport_student_assignments"."end_date" >= "transport_student_assignments"."effective_date"),
	CONSTRAINT "transport_student_assignments_reason_check" CHECK (length(btrim("transport_student_assignments"."reason")) BETWEEN 3 AND 500)
);

CREATE TABLE "academic_report_card_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"report_card_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"subject_name_snapshot" text NOT NULL,
	"assessment_name_snapshot" text NOT NULL,
	"score" numeric(10, 2) NOT NULL,
	"max_score" numeric(10, 2) NOT NULL,
	"grade" text NOT NULL,
	"grade_point" numeric(5, 2) NOT NULL,
	"remark" text NOT NULL,
	CONSTRAINT "academic_report_card_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "academic_report_card_lines_report_card_result_unique" UNIQUE("report_card_id","result_id"),
	CONSTRAINT "academic_report_card_lines_score_check" CHECK ("academic_report_card_lines"."score" >= 0 AND "academic_report_card_lines"."max_score" > 0 AND "academic_report_card_lines"."score" <= "academic_report_card_lines"."max_score")
);

CREATE TABLE "attendance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"device_id" integer,
	"nfc_card_id" integer,
	"identification_method" text NOT NULL,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"attendance_status" text DEFAULT 'PRESENT' NOT NULL,
	"event_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"academic_session_id" integer,
	"academic_term_id" integer,
	"school_class_id" integer,
	"class_name_snapshot" text,
	"section_snapshot" text,
	"reason" text,
	"actor_user_id" integer,
	"failure_reason" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_events_id_school_tenant_key" UNIQUE("id","school_id"),
	CONSTRAINT "attendance_events_subject_check" CHECK ((("student_id" IS NOT NULL)::int + ("employee_id" IS NOT NULL)::int = 1))
);

CREATE TABLE "employee_nfc_card_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"nfc_card_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_nfc_card_bindings_status_check" CHECK ("employee_nfc_card_bindings"."status" IN ('ASSIGNED', 'ACTIVE', 'LOCKED', 'DEACTIVATED', 'REPLACED'))
);

CREATE TABLE "exam_question_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"paper_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_reviews_decision_check" CHECK ("exam_question_reviews"."decision" IN ('RETURN','APPROVE')),
	CONSTRAINT "exam_question_reviews_reason_check" CHECK ("exam_question_reviews"."decision"<>'RETURN' OR length(btrim("exam_question_reviews"."comment"))>0)
);

CREATE TABLE "fee_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"requested_percentage" numeric(5, 2),
	"approved_amount_minor" integer,
	"original_balance_minor" integer,
	"resulting_balance_minor" integer,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_adjustments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_adjustments_kind_check" CHECK ("fee_adjustments"."kind" IN ('DISCOUNT','SCHOLARSHIP','WAIVER')),
	CONSTRAINT "fee_adjustments_status_check" CHECK ("fee_adjustments"."status" IN ('PENDING','APPROVED','REJECTED')),
	CONSTRAINT "fee_adjustments_amount_check" CHECK ("fee_adjustments"."amount_minor" > 0),
	CONSTRAINT "fee_adjustments_percentage_check" CHECK ("fee_adjustments"."requested_percentage" IS NULL OR "fee_adjustments"."requested_percentage"::numeric > 0 AND "fee_adjustments"."requested_percentage"::numeric <= 100),
	CONSTRAINT "fee_adjustments_approved_amount_check" CHECK ("fee_adjustments"."approved_amount_minor" IS NULL OR "fee_adjustments"."approved_amount_minor" > 0),
	CONSTRAINT "fee_adjustments_balance_check" CHECK ("fee_adjustments"."original_balance_minor" IS NULL OR "fee_adjustments"."original_balance_minor" >= 0),
	CONSTRAINT "fee_adjustments_resulting_balance_check" CHECK ("fee_adjustments"."resulting_balance_minor" IS NULL OR "fee_adjustments"."resulting_balance_minor" >= 0)
);

CREATE TABLE "fee_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"category_id" integer,
	"category_name_snapshot" text NOT NULL,
	"description_snapshot" text NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "fee_invoice_lines_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoice_lines_amount_check" CHECK ("fee_invoice_lines"."amount_minor" >= 0)
);

CREATE TABLE "fee_invoice_notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoice_notification_outbox_delivery_unique" UNIQUE("school_id","invoice_id","event_type"),
	CONSTRAINT "fee_invoice_notification_outbox_event_check" CHECK ("fee_invoice_notification_outbox"."event_type" = 'INVOICE_GENERATED'),
	CONSTRAINT "fee_invoice_notification_outbox_attempts_check" CHECK ("fee_invoice_notification_outbox"."attempts" >= 0)
);

CREATE TABLE "fee_invoice_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"event_type" text DEFAULT 'INVOICE_GENERATED' NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_invoice_notifications_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_invoice_notifications_delivery_unique" UNIQUE("school_id","invoice_id","recipient_user_id","recipient_role","event_type"),
	CONSTRAINT "fee_invoice_notifications_role_check" CHECK ("fee_invoice_notifications"."recipient_role" IN ('PARENT','STUDENT','SCHOOL_ADMIN','ACCOUNTANT')),
	CONSTRAINT "fee_invoice_notifications_event_check" CHECK ("fee_invoice_notifications"."event_type" = 'INVOICE_GENERATED'),
	CONSTRAINT "fee_invoice_notifications_channel_check" CHECK ("fee_invoice_notifications"."channel" = 'IN_APP'),
	CONSTRAINT "fee_invoice_notifications_read_check" CHECK (("fee_invoice_notifications"."is_read" = false AND "fee_invoice_notifications"."read_at" IS NULL) OR ("fee_invoice_notifications"."is_read" = true AND "fee_invoice_notifications"."read_at" IS NOT NULL))
);

CREATE TABLE "fee_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"parent_id" integer,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"method" text NOT NULL,
	"provider" text DEFAULT 'MANUAL_BANK_TRANSFER' NOT NULL,
	"provider_transaction_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"transfer_bank" text,
	"transfer_reference" text,
	"transfer_date" date,
	"proof_url" text,
	"submitted_by" integer NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"verification_evidence_ref" text,
	"reviewer_notes" text,
	"verification_metadata" jsonb,
	"rejection_reason" text,
	"provider_metadata" jsonb,
	"selected_line_ids" integer[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "fee_payments_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "fee_payments_id_invoice_school_unique" UNIQUE("id","invoice_id","school_id"),
	CONSTRAINT "fee_payments_provider_tx_unique" UNIQUE("provider","provider_transaction_id"),
	CONSTRAINT "fee_payments_person_check" CHECK (("fee_payments"."student_id" IS NULL)<>("fee_payments"."employee_id" IS NULL)),
	CONSTRAINT "fee_payments_amount_currency_check" CHECK ("fee_payments"."amount_minor" > 0 AND "fee_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fee_payments_method_with_cash_check" CHECK ("fee_payments"."method" IN ('BANK_TRANSFER','REMITA','FLUTTERWAVE','PAYSTACK','CASH')),
	CONSTRAINT "fee_payments_cash_evidence_check" CHECK ("fee_payments"."method"<>'CASH' OR
    ("fee_payments"."verified_by" IS NOT NULL AND "fee_payments"."verified_at" IS NOT NULL AND length(btrim("fee_payments"."verification_evidence_ref"))>=3
     AND length(btrim("fee_payments"."reviewer_notes"))>=3 AND "fee_payments"."verification_metadata" IS NOT NULL)),
	CONSTRAINT "fee_payments_status_check" CHECK ("fee_payments"."status" IN ('PENDING','PROCESSING','VERIFIED','FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED')),
	CONSTRAINT "fee_payments_verified_evidence_check" CHECK (("fee_payments"."method" <> 'BANK_TRANSFER' OR "fee_payments"."status" <> 'VERIFIED' OR
      ("fee_payments"."verified_by" IS NOT NULL AND "fee_payments"."verified_at" IS NOT NULL
       AND NULLIF(BTRIM("fee_payments"."verification_evidence_ref"), '') IS NOT NULL
       AND NULLIF(BTRIM("fee_payments"."reviewer_notes"), '') IS NOT NULL
       AND "fee_payments"."verification_metadata" IS NOT NULL))),
	CONSTRAINT "fee_payments_bank_transfer_details_check" CHECK ("fee_payments"."method" <> 'BANK_TRANSFER' OR
      (COALESCE(LENGTH(BTRIM("fee_payments"."transfer_bank")), 0) >= 2
       AND COALESCE(LENGTH(BTRIM("fee_payments"."transfer_reference")), 0) >= 2
       AND "fee_payments"."transfer_date" IS NOT NULL)),
	CONSTRAINT "fee_payments_verification_evidence_length_check" CHECK ("fee_payments"."method" <> 'BANK_TRANSFER' OR "fee_payments"."status" <> 'VERIFIED' OR
      (LENGTH(BTRIM("fee_payments"."verification_evidence_ref")) >= 3
       AND LENGTH(BTRIM("fee_payments"."reviewer_notes")) >= 3)),
	CONSTRAINT "fee_payments_rejection_reason_check" CHECK ("fee_payments"."status" <> 'REJECTED' OR NULLIF(BTRIM("fee_payments"."rejection_reason"), '') IS NOT NULL)
);

CREATE TABLE "lesson_note_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"lesson_note_id" integer NOT NULL,
	"note_revision" integer NOT NULL,
	"filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"staging_path" text NOT NULL,
	"object_path" text NOT NULL,
	"sha256" text,
	"context" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"uploaded_by" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "lesson_document_object_path_unique" UNIQUE("object_path"),
	CONSTRAINT "lesson_document_status_check" CHECK ("lesson_note_documents"."status" IN ('PENDING','READY')),
	CONSTRAINT "lesson_document_bytes_check" CHECK ("lesson_note_documents"."byte_size" BETWEEN 1 AND 10485760)
);

CREATE TABLE "lesson_note_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"lesson_note_id" integer NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"note_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_note_reviews_decision_check" CHECK ("lesson_note_reviews"."decision" IN ('RETURN','APPROVE')),
	CONSTRAINT "lesson_note_reviews_return_comment_check" CHECK ("lesson_note_reviews"."decision" <> 'RETURN' OR length(btrim(COALESCE("lesson_note_reviews"."comment",''))) > 0)
);

CREATE TABLE "library_copy_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"loan_id" integer,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"changed_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_copy_status_history_new_status_check" CHECK (
      "library_copy_status_history"."new_status" IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')
    ),
	CONSTRAINT "library_copy_status_history_reason_check" CHECK (length(btrim("library_copy_status_history"."reason")) BETWEEN 1 AND 500)
);

CREATE TABLE "library_renewals" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"loan_id" integer NOT NULL,
	"renewed_by_user_id" integer NOT NULL,
	"previous_due_on" date NOT NULL,
	"new_due_on" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_renewals_school_loan_key_unique" UNIQUE("school_id","loan_id","idempotency_key")
);

CREATE TABLE "nfc_card_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"nfc_card_id" integer NOT NULL,
	"student_id" integer,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"replaced_by_card_id" integer,
	"reason" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payroll_payslips" (
	"id" serial PRIMARY KEY NOT NULL,
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
	CONSTRAINT "payroll_payslips_id_scope_school_unique" UNIQUE("id","scope","school_id"),
	CONSTRAINT "payroll_payslips_scope_check" CHECK (
    ("payroll_payslips"."scope"='SCHOOL' AND "payroll_payslips"."school_id" IS NOT NULL)
    OR ("payroll_payslips"."scope"='YEMAIT_COMPANY' AND "payroll_payslips"."school_id" IS NULL)),
	CONSTRAINT "payroll_payslips_currency_check" CHECK ("payroll_payslips"."currency"='NGN'),
	CONSTRAINT "payroll_payslips_amounts_check" CHECK (
    "payroll_payslips"."base_salary_minor" >= 0 AND "payroll_payslips"."allowance_minor" >= 0 AND "payroll_payslips"."bonus_minor" >= 0
    AND "payroll_payslips"."deduction_minor" >= 0 AND "payroll_payslips"."net_salary_minor" > 0)
);

CREATE TABLE "promotion_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"batch_id" integer,
	"batch_student_id" integer,
	"student_id" integer,
	"actor_user_id" integer,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_history_event_check" CHECK ("promotion_history"."event_type" IN ('BATCH_PREPARED', 'STUDENT_SNAPSHOTTED', 'STUDENT_REVIEWED', 'STUDENT_FINALIZED', 'BATCH_FINALIZED', 'FINALIZATION_REJECTED')),
	CONSTRAINT "promotion_history_result_check" CHECK ("promotion_history"."result" IN ('SUCCESS', 'REJECTED'))
);

CREATE TABLE "school_security_incident_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"incident_id" integer NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_security_incident_attachments_id_scope_unique" UNIQUE("id","school_id","incident_id"),
	CONSTRAINT "school_security_incident_attachments_school_object_unique" UNIQUE("school_id","object_path"),
	CONSTRAINT "school_security_incident_attachments_type_check" CHECK ("school_security_incident_attachments"."content_type" IN ('application/pdf','image/jpeg','image/png','image/webp')),
	CONSTRAINT "school_security_incident_attachments_size_check" CHECK ("school_security_incident_attachments"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "school_security_incident_attachments_path_check" CHECK ("school_security_incident_attachments"."object_path" ~ '^/objects/school-security/[1-9][0-9]*/[1-9][0-9]*/[0-9a-fA-F-]{36}$'),
	CONSTRAINT "school_security_incident_attachments_name_check" CHECK (length(btrim("school_security_incident_attachments"."file_name")) BETWEEN 1 AND 255),
	CONSTRAINT "school_security_incident_attachments_status_shape_check" CHECK (("school_security_incident_attachments"."status"='PENDING_UPLOAD' AND "school_security_incident_attachments"."confirmed_at" IS NULL) OR ("school_security_incident_attachments"."status"='CONFIRMED' AND "school_security_incident_attachments"."confirmed_at" IS NOT NULL))
);

CREATE TABLE "staff_nfc_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_mode" text NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"gross_amount_minor" integer NOT NULL,
	"provider_fee_minor" integer,
	"settlement_amount_minor" integer,
	"refunded_amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"settlement_status" text DEFAULT 'PENDING' NOT NULL,
	"reconciliation_status" text DEFAULT 'PENDING' NOT NULL,
	"refund_status" text DEFAULT 'NONE' NOT NULL,
	"checkout_url" text,
	"provider_transaction_id" text,
	"provider_paid_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failure_code" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_nfc_payments_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "staff_nfc_payments_provider_ck" CHECK ("staff_nfc_payments"."provider" IN ('FLUTTERWAVE','MOCK')),
	CONSTRAINT "staff_nfc_payments_provider_mode_ck" CHECK ("staff_nfc_payments"."provider_mode" IN ('SANDBOX','DEVELOPMENT_MOCK')),
	CONSTRAINT "staff_nfc_payments_money_ck" CHECK ("staff_nfc_payments"."gross_amount_minor" > 0 AND ("staff_nfc_payments"."provider_fee_minor" IS NULL OR "staff_nfc_payments"."provider_fee_minor" >= 0)
          AND ("staff_nfc_payments"."settlement_amount_minor" IS NULL OR "staff_nfc_payments"."settlement_amount_minor" >= 0)
          AND "staff_nfc_payments"."refunded_amount_minor" >= 0 AND "staff_nfc_payments"."refunded_amount_minor" <= "staff_nfc_payments"."gross_amount_minor"
          AND "staff_nfc_payments"."currency" = 'NGN'),
	CONSTRAINT "staff_nfc_payments_status_ck" CHECK ("staff_nfc_payments"."status" IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "staff_nfc_payments_settlement_ck" CHECK ("staff_nfc_payments"."settlement_status" IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
	CONSTRAINT "staff_nfc_payments_reconciliation_ck" CHECK ("staff_nfc_payments"."reconciliation_status" IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')),
	CONSTRAINT "staff_nfc_payments_refund_ck" CHECK ("staff_nfc_payments"."refund_status" IN ('NONE','PENDING','PARTIALLY_REFUNDED','REFUNDED','RECONCILIATION_REQUIRED'))
);

CREATE TABLE "student_nfc_replacement_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"old_card_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"requested_by" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"new_card_id" integer,
	"issued_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_at" timestamp with time zone,
	CONSTRAINT "student_nfc_replacement_requests_old_card_id_key" UNIQUE("old_card_id"),
	CONSTRAINT "student_nfc_replacement_requests_invoice_id_key" UNIQUE("invoice_id"),
	CONSTRAINT "student_nfc_replacement_requests_new_card_id_key" UNIQUE("new_card_id"),
	CONSTRAINT "replacement_person_check" CHECK (("student_nfc_replacement_requests"."student_id" IS NULL)<>("student_nfc_replacement_requests"."employee_id" IS NULL)),
	CONSTRAINT "student_nfc_replacement_requests_status_check" CHECK ("student_nfc_replacement_requests"."status" IN ('REQUESTED','ISSUED')),
	CONSTRAINT "student_nfc_replacement_requests_check" CHECK ("student_nfc_replacement_requests"."old_card_id" IS DISTINCT FROM "student_nfc_replacement_requests"."new_card_id"),
	CONSTRAINT "student_nfc_replacement_requests_check1" CHECK (("student_nfc_replacement_requests"."status"='REQUESTED' AND "student_nfc_replacement_requests"."new_card_id" IS NULL AND "student_nfc_replacement_requests"."issued_by" IS NULL AND "student_nfc_replacement_requests"."issued_at" IS NULL) OR ("student_nfc_replacement_requests"."status"='ISSUED' AND "student_nfc_replacement_requests"."new_card_id" IS NOT NULL AND "student_nfc_replacement_requests"."issued_by" IS NOT NULL AND "student_nfc_replacement_requests"."issued_at" IS NOT NULL))
);

CREATE TABLE "student_subscription_terms" (
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"subscription_id" integer,
	"legacy_invoice_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_subscription_terms_school_id_student_id_academic_session_id_academic_term_id_pk" PRIMARY KEY("school_id","student_id","academic_session_id","academic_term_id"),
	CONSTRAINT "student_subscription_terms_subscription_id_unique" UNIQUE("subscription_id"),
	CONSTRAINT "student_subscription_terms_one_source" CHECK (("student_subscription_terms"."subscription_id" IS NOT NULL)::integer + ("student_subscription_terms"."legacy_invoice_id" IS NOT NULL)::integer = 1)
);

CREATE TABLE "transport_fee_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"assignment_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"fee_category_id" integer,
	"amount_minor" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"fee_invoice_id" integer,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_fee_invoices_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_fee_invoices_assignment_term_unique" UNIQUE("assignment_id","academic_term_id"),
	CONSTRAINT "transport_fee_invoices_fee_invoice_unique" UNIQUE("fee_invoice_id"),
	CONSTRAINT "transport_fee_invoices_amount_check" CHECK ("transport_fee_invoices"."amount_minor" >= 0),
	CONSTRAINT "transport_fee_invoices_status_check" CHECK ("transport_fee_invoices"."status" IN ('PLANNED','INVOICED','CANCELLED')),
	CONSTRAINT "transport_fee_invoices_invoice_state_check" CHECK (
      ("transport_fee_invoices"."status" = 'INVOICED' AND "transport_fee_invoices"."fee_invoice_id" IS NOT NULL AND "transport_fee_invoices"."amount_minor" > 0)
      OR ("transport_fee_invoices"."status" IN ('PLANNED','CANCELLED') AND "transport_fee_invoices"."fee_invoice_id" IS NULL)
    ),
	CONSTRAINT "transport_fee_invoices_category_check" CHECK ("transport_fee_invoices"."amount_minor" = 0 OR "transport_fee_invoices"."fee_category_id" IS NOT NULL)
);

CREATE TABLE "transport_parent_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"assignment_id" integer,
	"request_type" text NOT NULL,
	"request_date" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"school_action" text,
	"school_note" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_parent_requests_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "transport_parent_requests_type_check" CHECK ("transport_parent_requests"."request_type" IN ('ACTIVATE', 'DEACTIVATE')),
	CONSTRAINT "transport_parent_requests_status_check" CHECK ("transport_parent_requests"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
	CONSTRAINT "transport_parent_requests_action_check" CHECK ("transport_parent_requests"."school_action" IS NULL OR "transport_parent_requests"."school_action" IN ('ACTIVATE','SUSPEND','DEACTIVATE','NO_CHANGE')),
	CONSTRAINT "transport_parent_requests_reason_check" CHECK (length(btrim("transport_parent_requests"."reason")) BETWEEN 3 AND 1000),
	CONSTRAINT "transport_parent_requests_review_check" CHECK (
      ("transport_parent_requests"."status" = 'PENDING' AND "transport_parent_requests"."reviewed_by" IS NULL AND "transport_parent_requests"."reviewed_at" IS NULL)
      OR ("transport_parent_requests"."status" <> 'PENDING' AND "transport_parent_requests"."reviewed_by" IS NOT NULL AND "transport_parent_requests"."reviewed_at" IS NOT NULL)
    )
);

CREATE TABLE "attendance_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"attendance_event_id" integer NOT NULL,
	"original_value" jsonb NOT NULL,
	"corrected_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "attendance_discrepancies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"attendance_event_id" integer,
	"discrepancy_type" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"details" jsonb,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_discrepancies_id_school_tenant_key" UNIQUE("id","school_id")
);

CREATE TABLE "employee_nfc_attendance_discrepancies" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"attendance_event_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_nfc_attendance_discrepancies_status_check" CHECK ("employee_nfc_attendance_discrepancies"."status" IN ('OPEN', 'RESOLVED'))
);

CREATE TABLE "employee_nfc_card_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"binding_id" integer NOT NULL,
	"nfc_card_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"replacement_nfc_card_id" integer,
	"reason" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fee_payment_line_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_line_allocations_payment_id_line_id_key" UNIQUE("payment_id","line_id"),
	CONSTRAINT "fee_payment_line_allocations_amount_minor_check" CHECK ("fee_payment_line_allocations"."amount_minor">0)
);

CREATE TABLE "fee_payment_notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_reference_id" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_notification_outbox_delivery_unique" UNIQUE("payment_id","event_type","event_reference_id"),
	CONSTRAINT "fee_payment_notification_outbox_event_check" CHECK (
    ("fee_payment_notification_outbox"."event_type" IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED','PROVIDER_CHECKOUT_INITIATED',
      'PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED','MANUAL_TRANSFER_SUBMITTED',
      'MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED') AND "fee_payment_notification_outbox"."event_reference_id"=0)
    OR ("fee_payment_notification_outbox"."event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "fee_payment_notification_outbox"."event_reference_id">0)
  )
);

CREATE TABLE "fee_payment_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"event_reference_id" integer DEFAULT 0 NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"event_type" text DEFAULT 'PAYMENT_VERIFIED' NOT NULL,
	"channel" text DEFAULT 'IN_APP' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payment_notifications_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_payment_notifications_delivery_unique" UNIQUE("payment_id","recipient_user_id","recipient_role","event_type","event_reference_id"),
	CONSTRAINT "fee_payment_notifications_role_check" CHECK ("fee_payment_notifications"."recipient_role" IN ('PARENT','STUDENT','SCHOOL_ADMIN','ACCOUNTANT')),
	CONSTRAINT "fee_payment_notifications_event_check" CHECK ("fee_payment_notifications"."event_type" IN (
    'PAYMENT_VERIFIED','PAYMENT_REJECTED','PROVIDER_CHECKOUT_INITIATED','PROVIDER_CHECKOUT_PROCESSING',
    'PROVIDER_PAYMENT_FAILED','MANUAL_TRANSFER_SUBMITTED','MANUAL_TRANSFER_APPROVED',
    'MANUAL_TRANSFER_REJECTED','REFUND_APPROVED','REVERSAL_APPROVED')),
	CONSTRAINT "fee_payment_notifications_event_reference_check" CHECK (
    ("fee_payment_notifications"."event_type" IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED','PROVIDER_CHECKOUT_INITIATED',
      'PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED','MANUAL_TRANSFER_SUBMITTED',
      'MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED') AND "fee_payment_notifications"."event_reference_id"=0)
    OR ("fee_payment_notifications"."event_type" IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND "fee_payment_notifications"."event_reference_id">0)
  ),
	CONSTRAINT "fee_payment_notifications_channel_check" CHECK ("fee_payment_notifications"."channel" = 'IN_APP'),
	CONSTRAINT "fee_payment_notifications_read_check" CHECK (("fee_payment_notifications"."is_read" = false AND "fee_payment_notifications"."read_at" IS NULL) OR ("fee_payment_notifications"."is_read" = true AND "fee_payment_notifications"."read_at" IS NOT NULL))
);

CREATE TABLE "fee_provider_checkout_sessions" (
	"payment_id" integer PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'INITIALIZING' NOT NULL,
	"claim_token" text,
	"claim_expires_at" timestamp with time zone,
	"checkout_url" text,
	"provider_session_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_provider_checkout_sessions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "fee_provider_checkout_sessions_school_provider_idem_unique" UNIQUE("school_id","provider","idempotency_key"),
	CONSTRAINT "fee_provider_checkout_sessions_provider_check" CHECK ("fee_provider_checkout_sessions"."provider" IN ('PAYSTACK','FLUTTERWAVE')),
	CONSTRAINT "fee_provider_checkout_sessions_state_check" CHECK ("fee_provider_checkout_sessions"."state" IN ('INITIALIZING','READY','FAILED','SETTLED','RELEASED')),
	CONSTRAINT "fee_provider_checkout_sessions_attempts_check" CHECK ("fee_provider_checkout_sessions"."attempt_count" > 0),
	CONSTRAINT "fee_provider_checkout_sessions_claim_pair_check" CHECK (("fee_provider_checkout_sessions"."claim_token" IS NULL) = ("fee_provider_checkout_sessions"."claim_expires_at" IS NULL)),
	CONSTRAINT "fee_provider_checkout_sessions_ready_url_check" CHECK ("fee_provider_checkout_sessions"."state" <> 'READY' OR "fee_provider_checkout_sessions"."checkout_url" IS NOT NULL)
);

CREATE TABLE "fee_provider_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" integer,
	"school_id" integer,
	"provider_reference" text,
	"webhook_transaction_id" text,
	"verified_transaction_id" text,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"payload_sha256" text NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "fee_provider_webhook_events_provider_event_unique" UNIQUE("provider","event_id"),
	CONSTRAINT "fee_provider_webhook_events_provider_check" CHECK ("fee_provider_webhook_events"."provider" IN ('PAYSTACK','FLUTTERWAVE')),
	CONSTRAINT "fee_provider_webhook_events_status_check" CHECK ("fee_provider_webhook_events"."status" IN ('RECEIVED','VERIFIED','PENDING','FAILED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "fee_provider_webhook_events_signature_link_check" CHECK ("fee_provider_webhook_events"."payment_id" IS NULL OR (
      "fee_provider_webhook_events"."school_id" IS NOT NULL AND ("fee_provider_webhook_events"."signature_verified" OR "fee_provider_webhook_events"."verified_transaction_id" IS NOT NULL)
    ))
);

CREATE TABLE "fee_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"receipt_number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_receipts_payment_unique" UNIQUE("payment_id"),
	CONSTRAINT "fee_receipts_school_number_unique" UNIQUE("school_id","receipt_number")
);

CREATE TABLE "fee_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"transaction_type" text DEFAULT 'REFUND' NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"evidence_reference" text,
	"reviewer_notes" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_refunds_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "fee_refunds_reference_unique" UNIQUE("reference"),
	CONSTRAINT "fee_refunds_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "fee_refunds_amount_check" CHECK ("fee_refunds"."amount_minor" > 0 AND "fee_refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fee_refunds_status_check" CHECK ("fee_refunds"."status" IN ('PENDING','APPROVED','REJECTED')),
	CONSTRAINT "fee_refunds_transaction_type_check" CHECK ("fee_refunds"."transaction_type" IN ('REFUND','REVERSAL')),
	CONSTRAINT "fee_refunds_approval_evidence_check" CHECK ("fee_refunds"."status" <> 'APPROVED' OR (
    "fee_refunds"."approved_by" IS NOT NULL AND "fee_refunds"."approved_at" IS NOT NULL
    AND NULLIF(BTRIM("fee_refunds"."evidence_reference"), '') IS NOT NULL
    AND NULLIF(BTRIM("fee_refunds"."reviewer_notes"), '') IS NOT NULL
  ))
);

CREATE TABLE "security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"reader_id" integer,
	"location_id" integer,
	"device_id" integer NOT NULL,
	"attendance_event_id" integer,
	"nfc_card_id" integer,
	"student_id" integer,
	"employee_id" integer,
	"person_type" text NOT NULL,
	"person_name_snapshot" text,
	"admission_number_snapshot" text,
	"employee_number_snapshot" text,
	"class_name_snapshot" text,
	"section_snapshot" text,
	"location_name_snapshot" text,
	"reader_name_snapshot" text,
	"event_type" text NOT NULL,
	"identity_result" text NOT NULL,
	"reason_code" text,
	"card_uid_sha256" text,
	"event_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_status" text DEFAULT 'SYNCED' NOT NULL,
	"physical_control_status" text DEFAULT 'NOT_CONNECTED' NOT NULL,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_events_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "security_events_device_key_unique" UNIQUE("school_id","device_id","event_key"),
	CONSTRAINT "security_events_person_type_check" CHECK ("security_events"."person_type" IN ('STUDENT','STAFF','UNKNOWN')),
	CONSTRAINT "security_events_type_check" CHECK ("security_events"."event_type" IN ('ENTRY','EXIT')),
	CONSTRAINT "security_events_identity_result_check" CHECK ("security_events"."identity_result" IN ('CONFIRMED','REJECTED')),
	CONSTRAINT "security_events_reason_code_check" CHECK ("security_events"."reason_code" IS NULL OR "security_events"."reason_code" IN ('UNKNOWN_CARD','WRONG_SCHOOL','LOST_CARD','REVOKED_CARD','EXPIRED_CARD','INACTIVE_CARD','NOT_ASSIGNED','INACTIVE_PERSON','NO_CURRENT_PLACEMENT','STAFF_BILLING_INELIGIBLE','READER_INACTIVE','READER_PERMISSION_DENIED','SECURITY_DISABLED','IDENTITY_MISMATCH','OTHER')),
	CONSTRAINT "security_events_sync_status_check" CHECK ("security_events"."sync_status" IN ('SYNCED')),
	CONSTRAINT "security_events_physical_control_check" CHECK ("security_events"."physical_control_status"='NOT_CONNECTED'),
	CONSTRAINT "security_events_card_hash_check" CHECK ("security_events"."card_uid_sha256" IS NULL OR "security_events"."card_uid_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "security_events_event_key_check" CHECK (length("security_events"."event_key") BETWEEN 1 AND 256),
	CONSTRAINT "security_events_person_shape_check" CHECK (("security_events"."person_type"='STUDENT' AND "security_events"."student_id" IS NOT NULL AND "security_events"."employee_id" IS NULL) OR ("security_events"."person_type"='STAFF' AND "security_events"."employee_id" IS NOT NULL AND "security_events"."student_id" IS NULL) OR ("security_events"."person_type"='UNKNOWN' AND "security_events"."student_id" IS NULL AND "security_events"."employee_id" IS NULL)),
	CONSTRAINT "security_events_outcome_reason_check" CHECK (("security_events"."identity_result"='CONFIRMED' AND "security_events"."reason_code" IS NULL AND "security_events"."person_type"<>'UNKNOWN') OR ("security_events"."identity_result"='REJECTED' AND "security_events"."reason_code" IS NOT NULL))
);

CREATE TABLE "staff_nfc_provider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'FLUTTERWAVE' NOT NULL,
	"event_id" text NOT NULL,
	"provider_reference" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"signature_verified" boolean DEFAULT true NOT NULL,
	"outcome" text DEFAULT 'RECEIVED' NOT NULL,
	"payment_id" integer,
	"school_id" integer,
	"failure_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "staff_nfc_provider_events_provider_ck" CHECK ("staff_nfc_provider_events"."provider" = 'FLUTTERWAVE'),
	CONSTRAINT "staff_nfc_provider_events_outcome_ck" CHECK ("staff_nfc_provider_events"."outcome" IN ('RECEIVED','VERIFIED','PENDING','FAILED','DUPLICATE','RECONCILIATION_REQUIRED','REFUND_PENDING','REFUNDED','PARTIAL_REFUND'))
);

CREATE TABLE "staff_nfc_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"receipt_number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "staff_nfc_receipts_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "staff_nfc_receipts_receipt_number_unique" UNIQUE("receipt_number")
);

CREATE TABLE "staff_nfc_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"provider_refund_id" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"provider_verified_at" timestamp with time zone,
	"failure_code" text,
	CONSTRAINT "staff_nfc_refunds_amount_ck" CHECK ("staff_nfc_refunds"."amount_minor" > 0),
	CONSTRAINT "staff_nfc_refunds_status_ck" CHECK ("staff_nfc_refunds"."status" IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
);

CREATE TABLE "transport_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"assignment_id" integer,
	"route_id" integer,
	"bus_id" integer,
	"request_id" integer,
	"route_staff_id" integer,
	"student_id" integer,
	"event_type" text NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" integer,
	"actor_role" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_history_one_event_entity_check" CHECK (num_nonnulls("transport_history"."assignment_id", "transport_history"."route_id", "transport_history"."bus_id", "transport_history"."request_id", "transport_history"."route_staff_id") = 1),
	CONSTRAINT "transport_history_event_reason_check" CHECK (length(btrim("transport_history"."event_type")) BETWEEN 3 AND 80 AND length(btrim("transport_history"."reason")) BETWEEN 3 AND 1000)
);

CREATE TABLE "attendance_notification_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"attendance_event_id" integer,
	"discrepancy_id" integer,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"recipient_user_id" integer,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "campus_presence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"person_type" text NOT NULL,
	"student_id" integer,
	"employee_id" integer,
	"state" text NOT NULL,
	"last_security_event_id" bigint NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"review_reason" text,
	"resolved_by_user_id" integer,
	"resolution_reason" text,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campus_presence_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "campus_presence_person_type_check" CHECK ("campus_presence"."person_type" IN ('STUDENT','STAFF')),
	CONSTRAINT "campus_presence_state_check" CHECK ("campus_presence"."state" IN ('ON_CAMPUS','OFF_CAMPUS','REQUIRES_REVIEW')),
	CONSTRAINT "campus_presence_person_shape_check" CHECK (("campus_presence"."person_type"='STUDENT' AND "campus_presence"."student_id" IS NOT NULL AND "campus_presence"."employee_id" IS NULL) OR ("campus_presence"."person_type"='STAFF' AND "campus_presence"."employee_id" IS NOT NULL AND "campus_presence"."student_id" IS NULL))
);

CREATE TABLE "employee_nfc_discrepancy_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"discrepancy_id" integer NOT NULL,
	"resolution" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "school_pickup_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"requested_by_parent_id" integer NOT NULL,
	"pickup_person_id" integer NOT NULL,
	"requested_pickup_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decision_by_user_id" integer,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" integer,
	"completion_pickup_person_id" integer,
	"recorded_security_event_id" bigint,
	"completion_idempotency_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_pickup_requests_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "school_pickup_requests_school_exit_event_unique" UNIQUE("school_id","recorded_security_event_id"),
	CONSTRAINT "school_pickup_requests_completion_key_unique" UNIQUE("school_id","completion_idempotency_key"),
	CONSTRAINT "school_pickup_requests_status_check" CHECK ("school_pickup_requests"."status" IN ('PENDING','APPROVED','REJECTED','CANCELLED','REFUSED','COMPLETED')),
	CONSTRAINT "school_pickup_requests_validity_check" CHECK ("school_pickup_requests"."valid_until">"school_pickup_requests"."valid_from"),
	CONSTRAINT "school_pickup_requests_completion_shape_check" CHECK (("school_pickup_requests"."status"='COMPLETED' AND "school_pickup_requests"."completed_at" IS NOT NULL AND "school_pickup_requests"."completed_by_user_id" IS NOT NULL AND "school_pickup_requests"."completion_pickup_person_id" IS NOT NULL AND "school_pickup_requests"."recorded_security_event_id" IS NOT NULL AND "school_pickup_requests"."completion_idempotency_key" IS NOT NULL) OR ("school_pickup_requests"."status"<>'COMPLETED' AND "school_pickup_requests"."completed_at" IS NULL AND "school_pickup_requests"."completed_by_user_id" IS NULL AND "school_pickup_requests"."completion_pickup_person_id" IS NULL AND "school_pickup_requests"."recorded_security_event_id" IS NULL AND "school_pickup_requests"."completion_idempotency_key" IS NULL)),
	CONSTRAINT "school_pickup_requests_version_check" CHECK ("school_pickup_requests"."version">0)
);

CREATE TABLE "staff_nfc_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"entry_type" text DEFAULT 'CREDIT' NOT NULL,
	"product" text DEFAULT 'TEACHER_STAFF_NFC_EID' NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" integer,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"attribution_id" integer,
	"refund_id" integer,
	"allocation_rule_id" integer NOT NULL,
	"billing_rule_version" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_nfc_allocations_type_ck" CHECK ("staff_nfc_allocations"."recipient_type" IN ('SCHOOL','PLATFORM','PARTNER','PLATFORM_PROVIDER_FEE')),
	CONSTRAINT "staff_nfc_allocations_product_ck" CHECK ("staff_nfc_allocations"."product" = 'TEACHER_STAFF_NFC_EID'),
	CONSTRAINT "staff_nfc_allocations_entry_ck" CHECK ("staff_nfc_allocations"."entry_type" IN ('CREDIT','REVERSAL','EXPENSE')),
	CONSTRAINT "staff_nfc_allocations_amount_ck" CHECK ("staff_nfc_allocations"."amount_minor" > 0 AND "staff_nfc_allocations"."currency" = 'NGN'
        AND (("staff_nfc_allocations"."entry_type" = 'CREDIT' AND "staff_nfc_allocations"."refund_id" IS NULL AND "staff_nfc_allocations"."recipient_type" IN ('SCHOOL','PLATFORM','PARTNER'))
          OR ("staff_nfc_allocations"."entry_type" = 'REVERSAL' AND "staff_nfc_allocations"."refund_id" IS NOT NULL)
          OR ("staff_nfc_allocations"."entry_type" = 'EXPENSE' AND "staff_nfc_allocations"."recipient_type" = 'PLATFORM_PROVIDER_FEE' AND "staff_nfc_allocations"."refund_id" IS NULL))),
	CONSTRAINT "staff_nfc_allocations_provider_fee_expense_ck" CHECK (("staff_nfc_allocations"."recipient_type" = 'PLATFORM_PROVIDER_FEE'
          AND "staff_nfc_allocations"."entry_type" = 'EXPENSE' AND "staff_nfc_allocations"."refund_id" IS NULL)
        OR ("staff_nfc_allocations"."recipient_type" <> 'PLATFORM_PROVIDER_FEE' AND "staff_nfc_allocations"."entry_type" IN ('CREDIT','REVERSAL')))
);

CREATE TABLE "staff_nfc_partner_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"allocation_id" integer NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"academic_term_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"recipient_type" text DEFAULT 'PARTNER' NOT NULL,
	"commission_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_nfc_partner_commissions_allocation_id_unique" UNIQUE("allocation_id"),
	CONSTRAINT "staff_nfc_partner_commissions_amount_ck" CHECK ("staff_nfc_partner_commissions"."commission_minor" > 0 AND "staff_nfc_partner_commissions"."currency" = 'NGN'),
	CONSTRAINT "staff_nfc_partner_commissions_recipient_ck" CHECK ("staff_nfc_partner_commissions"."recipient_type" = 'PARTNER'),
	CONSTRAINT "staff_nfc_partner_commissions_status_ck" CHECK ("staff_nfc_partner_commissions"."status" IN ('PENDING','PAID','REVERSED'))
);

CREATE UNIQUE INDEX "academic_sessions_id_school_unique" ON "academic_sessions" USING btree ("id","school_id");

CREATE UNIQUE INDEX "academic_sessions_school_name_unique" ON "academic_sessions" USING btree ("school_id","name");

CREATE UNIQUE INDEX "academic_terms_id_school_unique" ON "academic_terms" USING btree ("id","school_id");

CREATE UNIQUE INDEX "academic_terms_session_name_unique" ON "academic_terms" USING btree ("academic_session_id","name");

CREATE UNIQUE INDEX "admission_application_documents_object_path_unique" ON "admission_application_documents" USING btree ("object_path");

CREATE UNIQUE INDEX "admission_applications_idempotency_key_unique" ON "admission_applications" USING btree ("school_id","idempotency_key");

CREATE UNIQUE INDEX "admission_applications_school_number_unique" ON "admission_applications" USING btree ("school_id","application_number");

CREATE UNIQUE INDEX "admission_applications_student_unique" ON "admission_applications" USING btree ("school_id","converted_student_id") WHERE "admission_applications"."converted_student_id" IS NOT NULL;

CREATE UNIQUE INDEX "admission_portal_settings_portal_key_unique" ON "admission_portal_settings" USING btree ("portal_key");

CREATE UNIQUE INDEX "app_users_clerk_user_id_unique" ON "app_users" USING btree ("clerk_user_id");

CREATE UNIQUE INDEX "attendance_discrepancies_id_school_unique" ON "attendance_discrepancies" USING btree ("id","school_id");

CREATE UNIQUE INDEX "attendance_events_id_school_unique" ON "attendance_events" USING btree ("id","school_id");

CREATE UNIQUE INDEX "attendance_events_school_dedupe_unique" ON "attendance_events" USING btree ("school_id","dedupe_key");

CREATE UNIQUE INDEX "attendance_settings_school_unique" ON "attendance_settings" USING btree ("school_id");

CREATE UNIQUE INDEX "biometric_enrollments_provider_reference_unique" ON "biometric_enrollments" USING btree ("provider","provider_reference");

CREATE UNIQUE INDEX "campus_presence_employee_unique" ON "campus_presence" USING btree ("school_id","employee_id") WHERE "campus_presence"."employee_id" IS NOT NULL;

CREATE UNIQUE INDEX "campus_presence_student_unique" ON "campus_presence" USING btree ("school_id","student_id") WHERE "campus_presence"."student_id" IS NOT NULL;

CREATE UNIQUE INDEX "class_subjects_unique" ON "class_subjects" USING btree ("school_class_id","subject_id","academic_session_id",coalesce("academic_term_id", 0),coalesce("section", '')) WHERE "class_subjects"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "commission_ledger_subscription_period_unique" ON "commission_ledger" USING btree ("subscription_id","term");

CREATE UNIQUE INDEX "communication_campaigns_school_idempotency_unique" ON "communication_campaigns" USING btree ("school_id","idempotency_key") WHERE "communication_campaigns"."idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "communication_message_threads_request_unique" ON "communication_message_threads" USING btree ("school_id","created_by_user_id","request_key");

CREATE UNIQUE INDEX "communication_messages_request_unique" ON "communication_messages" USING btree ("thread_id","sender_user_id","request_key");

CREATE UNIQUE INDEX "communication_notifications_global_event_recipient_unique" ON "communication_notifications" USING btree ("event_key","recipient_user_id") WHERE "communication_notifications"."school_id" IS NULL AND "communication_notifications"."event_key" IS NOT NULL;

CREATE UNIQUE INDEX "communication_notifications_school_event_recipient_unique" ON "communication_notifications" USING btree ("school_id","event_key","recipient_user_id") WHERE "communication_notifications"."school_id" IS NOT NULL AND "communication_notifications"."event_key" IS NOT NULL;

CREATE UNIQUE INDEX "communication_preferences_global_unique" ON "communication_preferences" USING btree ("user_id","category","channel") WHERE "communication_preferences"."school_id" IS NULL;

CREATE UNIQUE INDEX "communication_preferences_school_unique" ON "communication_preferences" USING btree ("user_id","school_id","category","channel") WHERE "communication_preferences"."school_id" IS NOT NULL;

CREATE UNIQUE INDEX "communication_push_devices_global_active_unique" ON "communication_push_devices" USING btree ("user_id","provider","opaque_device_reference") WHERE "communication_push_devices"."school_id" IS NULL AND "communication_push_devices"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "communication_push_devices_school_active_unique" ON "communication_push_devices" USING btree ("user_id","school_id","provider","opaque_device_reference") WHERE "communication_push_devices"."school_id" IS NOT NULL AND "communication_push_devices"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "device_credentials_identifier_unique" ON "device_credentials" USING btree ("credential_identifier");

CREATE UNIQUE INDEX "employee_nfc_attendance_discrepancies_event_kind_unique" ON "employee_nfc_attendance_discrepancies" USING btree ("school_id","attendance_event_id","kind");

CREATE UNIQUE INDEX "employee_nfc_attendance_discrepancies_id_school_unique" ON "employee_nfc_attendance_discrepancies" USING btree ("id","school_id");

CREATE UNIQUE INDEX "employee_nfc_card_bindings_card_unique" ON "employee_nfc_card_bindings" USING btree ("nfc_card_id");

CREATE UNIQUE INDEX "employee_nfc_card_bindings_id_school_unique" ON "employee_nfc_card_bindings" USING btree ("id","school_id");

CREATE UNIQUE INDEX "employee_nfc_card_bindings_one_current_per_employee" ON "employee_nfc_card_bindings" USING btree ("school_id","employee_id") WHERE "employee_nfc_card_bindings"."status" IN ('ASSIGNED', 'ACTIVE', 'LOCKED');

CREATE UNIQUE INDEX "employee_nfc_card_history_id_school_unique" ON "employee_nfc_card_history" USING btree ("id","school_id");

CREATE UNIQUE INDEX "employees_id_school_unique" ON "employees" USING btree ("id","school_id");

CREATE UNIQUE INDEX "employees_school_employee_no_unique" ON "employees" USING btree ("school_id","employee_no");

CREATE UNIQUE INDEX "fee_payments_cash_evidence_unique" ON "fee_payments" USING btree ("school_id",lower(btrim("verification_evidence_ref"))) WHERE "fee_payments"."method"='CASH';

CREATE UNIQUE INDEX "fee_payments_school_bank_transfer_ref_unique" ON "fee_payments" USING btree ("school_id",LOWER(BTRIM("transfer_bank")),LOWER(BTRIM("transfer_reference"))) WHERE "fee_payments"."method" = 'BANK_TRANSFER' AND NULLIF(BTRIM("fee_payments"."transfer_bank"), '') IS NOT NULL
      AND NULLIF(BTRIM("fee_payments"."transfer_reference"), '') IS NOT NULL;

CREATE UNIQUE INDEX "fee_payments_school_verified_evidence_ref_unique" ON "fee_payments" USING btree ("school_id",LOWER(BTRIM("verification_evidence_ref"))) WHERE "fee_payments"."method" = 'BANK_TRANSFER' AND "fee_payments"."status" = 'VERIFIED'
      AND NULLIF(BTRIM("fee_payments"."verification_evidence_ref"), '') IS NOT NULL;

CREATE UNIQUE INDEX "fee_provider_checkout_sessions_one_open_invoice_unique" ON "fee_provider_checkout_sessions" USING btree ("school_id","invoice_id") WHERE "fee_provider_checkout_sessions"."state" IN ('INITIALIZING','READY','FAILED');

CREATE UNIQUE INDEX "fee_refunds_school_evidence_unique" ON "fee_refunds" USING btree ("school_id",LOWER(BTRIM("evidence_reference"))) WHERE "fee_refunds"."status"='APPROVED' AND NULLIF(BTRIM("fee_refunds"."evidence_reference"), '') IS NOT NULL;

CREATE UNIQUE INDEX "fee_structures_version_context_unique" ON "fee_structures" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id",COALESCE("section", ''),"version");

CREATE UNIQUE INDEX "lesson_notes_week_assignment_unique" ON "lesson_notes" USING btree ("school_id","academic_session_id","academic_term_id","teacher_employee_id","school_class_id","subject_id","week",COALESCE("section", ''));

CREATE UNIQUE INDEX "library_authors_school_name_unique" ON "library_authors" USING btree ("school_id",lower("name"));

CREATE UNIQUE INDEX "library_book_copies_school_barcode_unique" ON "library_book_copies" USING btree ("school_id","barcode") WHERE "library_book_copies"."barcode" IS NOT NULL;

CREATE UNIQUE INDEX "library_book_copies_school_code_unique" ON "library_book_copies" USING btree ("school_id",lower("copy_code"));

CREATE UNIQUE INDEX "library_categories_school_name_unique" ON "library_categories" USING btree ("school_id",lower("name"));

CREATE UNIQUE INDEX "library_loans_open_copy_unique" ON "library_loans" USING btree ("school_id","copy_id") WHERE "library_loans"."status" = 'OPEN';

CREATE UNIQUE INDEX "library_loans_school_idempotency_unique" ON "library_loans" USING btree ("school_id","idempotency_key") WHERE "library_loans"."idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "library_publishers_school_name_unique" ON "library_publishers" USING btree ("school_id",lower("name"));

CREATE UNIQUE INDEX "nfc_cards_id_school_unique" ON "nfc_cards" USING btree ("id","school_id");

CREATE UNIQUE INDEX "nfc_cards_uid_unique" ON "nfc_cards" USING btree ("uid");

CREATE UNIQUE INDEX "parents_id_school_unique" ON "parents" USING btree ("id","school_id");

CREATE UNIQUE INDEX "parents_user_unique" ON "parents" USING btree ("user_id");

CREATE UNIQUE INDEX "partner_invitations_token_hash_unique" ON "partner_invitations" USING btree ("token_hash");

CREATE UNIQUE INDEX "partner_payout_information_partner_unique" ON "partner_payout_information" USING btree ("partner_profile_id");

CREATE UNIQUE INDEX "partner_payouts_provider_reference_unique" ON "partner_payouts" USING btree ("provider_reference");

CREATE UNIQUE INDEX "partner_profile_users_unique" ON "partner_profile_users" USING btree ("partner_profile_id","user_id");

CREATE UNIQUE INDEX "partner_profile_users_user_role_unique" ON "partner_profile_users" USING btree ("user_id","role");

CREATE UNIQUE INDEX "partner_profiles_code_unique" ON "partner_profiles" USING btree ("partner_code");

CREATE UNIQUE INDEX "partner_profiles_user_unique" ON "partner_profiles" USING btree ("user_id");

CREATE UNIQUE INDEX "partner_referral_links_hash_unique" ON "partner_referral_links" USING btree ("token_hash");

CREATE UNIQUE INDEX "payroll_employee_profiles_company_employee_unique" ON "payroll_employee_profiles" USING btree ("company_employee_id") WHERE "payroll_employee_profiles"."scope"='YEMAIT_COMPANY';

CREATE UNIQUE INDEX "payroll_employee_profiles_school_employee_unique" ON "payroll_employee_profiles" USING btree ("school_id","employee_id") WHERE "payroll_employee_profiles"."scope"='SCHOOL';

CREATE UNIQUE INDEX "payroll_items_employee_period_unique" ON "payroll_items" USING btree ("period_id","employee_profile_id");

CREATE UNIQUE INDEX "payroll_payslips_item_unique" ON "payroll_payslips" USING btree ("payroll_item_id");

CREATE UNIQUE INDEX "payroll_payslips_number_unique" ON "payroll_payslips" USING btree ("payslip_number");

CREATE UNIQUE INDEX "payroll_periods_company_month_unique" ON "payroll_periods" USING btree ("scope","period_month") WHERE "payroll_periods"."scope"='YEMAIT_COMPANY';

CREATE UNIQUE INDEX "payroll_periods_school_month_unique" ON "payroll_periods" USING btree ("school_id","period_month") WHERE "payroll_periods"."scope"='SCHOOL';

CREATE UNIQUE INDEX "payroll_transfers_idempotency_period_unique" ON "payroll_transfers" USING btree ("period_id","idempotency_key_hash");

CREATE UNIQUE INDEX "payroll_transfers_item_attempt_unique" ON "payroll_transfers" USING btree ("payroll_item_id","attempt_number");

CREATE UNIQUE INDEX "payroll_transfers_provider_reference_unique" ON "payroll_transfers" USING btree ("provider","provider_reference");

CREATE UNIQUE INDEX "platform_company_employees_email_unique" ON "platform_company_employees" USING btree (lower("email"));

CREATE UNIQUE INDEX "platform_devices_id_school_unique" ON "platform_devices" USING btree ("id","school_id");

CREATE UNIQUE INDEX "platform_devices_serial_number_unique" ON "platform_devices" USING btree ("serial_number");

CREATE UNIQUE INDEX "school_assets_school_code_unique" ON "school_assets" USING btree ("school_id",lower("asset_code")) WHERE "school_assets"."asset_code" IS NOT NULL;

CREATE UNIQUE INDEX "school_branding_logos_object_path_unique" ON "school_branding_logos" USING btree ("object_path");

CREATE UNIQUE INDEX "school_branding_logos_school_current_unique" ON "school_branding_logos" USING btree ("school_id") WHERE "school_branding_logos"."is_current";

CREATE UNIQUE INDEX "school_calendar_events_school_source_key_unique" ON "school_calendar_events" USING btree ("school_id","source_key");

CREATE UNIQUE INDEX "school_classes_id_school_unique" ON "school_classes" USING btree ("id","school_id");

CREATE UNIQUE INDEX "school_classes_unique" ON "school_classes" USING btree ("school_id","name","section");

CREATE UNIQUE INDEX "school_curriculum_assignments_active_context_unique" ON "school_curriculum_assignments" USING btree ("school_id","school_class_id","subject_id","academic_session_id","academic_term_id") WHERE "school_curriculum_assignments"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "school_facilities_school_name_unique" ON "school_facilities" USING btree ("school_id",lower("name"));

CREATE UNIQUE INDEX "school_memberships_platform_role_unique" ON "school_memberships" USING btree ("user_id","role") WHERE "school_memberships"."school_id" is null;

CREATE UNIQUE INDEX "school_memberships_user_school_role_unique" ON "school_memberships" USING btree ("user_id","school_id","role");

CREATE UNIQUE INDEX "school_operation_categories_id_school_type_unique" ON "school_operation_categories" USING btree ("id","school_id","category_type");

CREATE UNIQUE INDEX "school_operation_categories_school_type_name_unique" ON "school_operation_categories" USING btree ("school_id","category_type",lower("name"));

CREATE UNIQUE INDEX "school_partner_attributions_current_unique" ON "school_partner_attributions" USING btree ("school_id") WHERE "school_partner_attributions"."is_current" = true;

CREATE UNIQUE INDEX "school_partner_attributions_id_partner_uq" ON "school_partner_attributions" USING btree ("id","partner_profile_id");

CREATE UNIQUE INDEX "schools_code_unique" ON "schools" USING btree ("code");

CREATE UNIQUE INDEX "schools_registration_number_unique" ON "schools" USING btree ("registration_number");

CREATE UNIQUE INDEX "security_staff_grants_one_active_unique" ON "security_staff_grants" USING btree ("school_id","user_id") WHERE "security_staff_grants"."status"='ACTIVE';

CREATE UNIQUE INDEX "settlement_payroll_profiles_company_unique" ON "settlement_payroll_profiles" USING btree ("scope") WHERE "settlement_payroll_profiles"."scope"='YEMAIT_COMPANY';

CREATE UNIQUE INDEX "settlement_payroll_profiles_school_unique" ON "settlement_payroll_profiles" USING btree ("school_id") WHERE "settlement_payroll_profiles"."scope"='SCHOOL';

CREATE UNIQUE INDEX "staff_nfc_allocations_credit_payment_type_uq" ON "staff_nfc_allocations" USING btree ("payment_id","recipient_type") WHERE "staff_nfc_allocations"."entry_type" = 'CREDIT';

CREATE UNIQUE INDEX "staff_nfc_allocations_id_payment_type_uq" ON "staff_nfc_allocations" USING btree ("id","payment_id","recipient_type");

CREATE UNIQUE INDEX "staff_nfc_allocations_idempotency_uq" ON "staff_nfc_allocations" USING btree ("idempotency_key");

CREATE UNIQUE INDEX "staff_nfc_billing_rules_id_product_uq" ON "staff_nfc_billing_rules" USING btree ("id","product");

CREATE UNIQUE INDEX "staff_nfc_billing_rules_id_version_uq" ON "staff_nfc_billing_rules" USING btree ("id","version");

CREATE UNIQUE INDEX "staff_nfc_billing_rules_product_effective_uq" ON "staff_nfc_billing_rules" USING btree ("product","effective_at");

CREATE UNIQUE INDEX "staff_nfc_billing_rules_product_version_uq" ON "staff_nfc_billing_rules" USING btree ("product","version");

CREATE UNIQUE INDEX "staff_nfc_partner_commissions_subscription_uq" ON "staff_nfc_partner_commissions" USING btree ("subscription_id");

CREATE UNIQUE INDEX "staff_nfc_payments_employee_idempotency_uq" ON "staff_nfc_payments" USING btree ("employee_id","idempotency_key");

CREATE UNIQUE INDEX "staff_nfc_payments_id_subscription_school_uq" ON "staff_nfc_payments" USING btree ("id","subscription_id","school_id");

CREATE UNIQUE INDEX "staff_nfc_payments_one_pending_attempt_per_subscription_uq" ON "staff_nfc_payments" USING btree ("subscription_id") WHERE "staff_nfc_payments"."status" IN ('PENDING','RECONCILIATION_REQUIRED');

CREATE UNIQUE INDEX "staff_nfc_payments_provider_transaction_uq" ON "staff_nfc_payments" USING btree ("provider","provider_transaction_id") WHERE "staff_nfc_payments"."provider_transaction_id" IS NOT NULL;

CREATE UNIQUE INDEX "staff_nfc_payments_reference_uq" ON "staff_nfc_payments" USING btree ("reference");

CREATE UNIQUE INDEX "staff_nfc_provider_events_provider_event_uq" ON "staff_nfc_provider_events" USING btree ("provider","event_id");

CREATE UNIQUE INDEX "staff_nfc_receipts_payment_owner_uq" ON "staff_nfc_receipts" USING btree ("payment_id","subscription_id","school_id");

CREATE UNIQUE INDEX "staff_nfc_refunds_id_payment_school_uq" ON "staff_nfc_refunds" USING btree ("id","payment_id","school_id");

CREATE UNIQUE INDEX "staff_nfc_refunds_one_active_per_payment_uq" ON "staff_nfc_refunds" USING btree ("payment_id") WHERE "staff_nfc_refunds"."status" IN ('REQUESTED','PENDING','RECONCILIATION_REQUIRED');

CREATE UNIQUE INDEX "staff_nfc_refunds_payment_idempotency_uq" ON "staff_nfc_refunds" USING btree ("payment_id","idempotency_key");

CREATE UNIQUE INDEX "staff_nfc_refunds_provider_id_uq" ON "staff_nfc_refunds" USING btree ("provider_refund_id");

CREATE UNIQUE INDEX "staff_nfc_subscriptions_employee_term_uq" ON "staff_nfc_subscriptions" USING btree ("employee_id","school_id","academic_session_id","academic_term_id");

CREATE UNIQUE INDEX "staff_nfc_subscriptions_id_employee_school_term_uq" ON "staff_nfc_subscriptions" USING btree ("id","employee_id","school_id","academic_session_id","academic_term_id");

CREATE UNIQUE INDEX "staff_nfc_subscriptions_id_school_uq" ON "staff_nfc_subscriptions" USING btree ("id","school_id");

CREATE UNIQUE INDEX "student_class_assignments_active_unique" ON "student_class_assignments" USING btree ("student_id","academic_session_id",coalesce("academic_term_id", 0),"school_class_id","section") WHERE "student_class_assignments"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "student_class_assignments_id_school_unique" ON "student_class_assignments" USING btree ("id","school_id");

CREATE UNIQUE INDEX "student_identification_policies_student_unique" ON "student_identification_policies" USING btree ("student_id");

CREATE UNIQUE INDEX "student_subscription_allocations_id_payment_entry_recipient_uq" ON "student_subscription_allocations" USING btree ("id","payment_id","entry_type","recipient_type");

CREATE UNIQUE INDEX "student_subscription_allocations_idempotency_uq" ON "student_subscription_allocations" USING btree ("idempotency_key");

CREATE UNIQUE INDEX "student_subscription_allocations_payment_credit_recipient_uq" ON "student_subscription_allocations" USING btree ("payment_id","recipient_type") WHERE "student_subscription_allocations"."entry_type" = 'CREDIT';

CREATE UNIQUE INDEX "student_subscription_allocations_payment_fee_expense_uq" ON "student_subscription_allocations" USING btree ("payment_id") WHERE "student_subscription_allocations"."entry_type" = 'EXPENSE' AND "student_subscription_allocations"."recipient_type" = 'PLATFORM_PROVIDER_FEE';

CREATE UNIQUE INDEX "student_subscription_payments_id_owner_term_uq" ON "student_subscription_payments" USING btree ("id","subscription_id","school_id","student_id","academic_session_id","academic_term_id");

CREATE UNIQUE INDEX "student_subscription_payments_one_business_term_uq" ON "student_subscription_payments" USING btree ("school_id","student_id","academic_session_id","academic_term_id") WHERE "student_subscription_payments"."status" IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
        OR "student_subscription_payments"."reconciliation_status" = 'RECONCILIATION_REQUIRED';

CREATE UNIQUE INDEX "student_subscription_payments_one_open_attempt_uq" ON "student_subscription_payments" USING btree ("subscription_id") WHERE "student_subscription_payments"."status" IN ('PENDING','RECONCILIATION_REQUIRED');

CREATE UNIQUE INDEX "student_subscription_payments_provider_transaction_uq" ON "student_subscription_payments" USING btree ("provider","provider_transaction_id") WHERE "student_subscription_payments"."provider_transaction_id" IS NOT NULL;

CREATE UNIQUE INDEX "student_subscription_payments_reference_uq" ON "student_subscription_payments" USING btree ("reference");

CREATE UNIQUE INDEX "student_subscription_payments_subscription_idempotency_uq" ON "student_subscription_payments" USING btree ("subscription_id","idempotency_key");

CREATE UNIQUE INDEX "students_id_school_unique" ON "students" USING btree ("id","school_id");

CREATE UNIQUE INDEX "students_school_admission_unique" ON "students" USING btree ("school_id","admission_no");

CREATE UNIQUE INDEX "students_user_unique" ON "students" USING btree ("user_id");

CREATE UNIQUE INDEX "subjects_id_school_unique" ON "subjects" USING btree ("id","school_id");

CREATE UNIQUE INDEX "subjects_school_code_unique" ON "subjects" USING btree ("school_id","code");

CREATE UNIQUE INDEX "subscriptions_id_school_student_uq" ON "subscriptions" USING btree ("id","school_id","student_id");

CREATE UNIQUE INDEX "subscriptions_provider_reference_unique" ON "subscriptions" USING btree ("provider_reference");

CREATE UNIQUE INDEX "teacher_class_assignments_unique" ON "teacher_class_assignments" USING btree ("employee_id","academic_session_id","school_class_id","section","assignment_type",coalesce("subject_id", 0)) WHERE "teacher_class_assignments"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "teacher_duty_roster_employee_exact_active_unique" ON "teacher_duty_roster" USING btree ("school_id","employee_id","start_date","end_date") WHERE "teacher_duty_roster"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "teacher_subject_assignments_active_unique" ON "teacher_subject_assignments" USING btree ("school_id","employee_id","subject_id","academic_session_id") WHERE "teacher_subject_assignments"."status" = 'ACTIVE';

CREATE UNIQUE INDEX "transport_buses_school_registration_unique" ON "transport_buses" USING btree ("school_id",lower(btrim("registration_number")));

CREATE UNIQUE INDEX "transport_parent_requests_one_pending_student" ON "transport_parent_requests" USING btree ("student_id") WHERE "transport_parent_requests"."status" = 'PENDING';

CREATE UNIQUE INDEX "transport_route_staff_route_employee_active_unique" ON "transport_route_staff" USING btree ("route_id","employee_id") WHERE "transport_route_staff"."is_active";

CREATE UNIQUE INDEX "transport_route_stops_route_sequence_unique" ON "transport_route_stops" USING btree ("route_id","sequence");

CREATE UNIQUE INDEX "transport_student_assignments_one_current_per_student" ON "transport_student_assignments" USING btree ("student_id") WHERE "transport_student_assignments"."status" IN ('ACTIVE', 'SUSPENDED');

CREATE INDEX "academic_assessment_types_school_status_idx" ON "academic_assessment_types" USING btree ("school_id","status");

CREATE INDEX "academic_assessments_school_context_idx" ON "academic_assessments" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

CREATE INDEX "academic_assignments_school_context_idx" ON "academic_assignments" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

CREATE INDEX "academic_grading_rules_school_status_idx" ON "academic_grading_rules" USING btree ("school_id","status");

CREATE INDEX "academic_report_card_lines_report_card_idx" ON "academic_report_card_lines" USING btree ("school_id","report_card_id");

CREATE INDEX "academic_report_cards_school_student_idx" ON "academic_report_cards" USING btree ("school_id","student_id","academic_session_id","academic_term_id");

CREATE INDEX "academic_result_batches_teacher_idx" ON "academic_result_batches" USING btree ("school_id","teacher_employee_id","academic_session_id","academic_term_id");

CREATE INDEX "academic_results_school_context_idx" ON "academic_results" USING btree ("school_id","academic_session_id","academic_term_id","student_id");

CREATE INDEX "academic_sessions_school_status_idx" ON "academic_sessions" USING btree ("school_id","status");

CREATE INDEX "academic_terms_school_status_idx" ON "academic_terms" USING btree ("school_id","status");

CREATE INDEX "academic_timetable_entries_school_context_idx" ON "academic_timetable_entries" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id","section");

CREATE INDEX "admission_application_documents_app_school_idx" ON "admission_application_documents" USING btree ("application_id","school_id");

CREATE INDEX "admission_applications_guardian_phone_idx" ON "admission_applications" USING btree ("school_id","guardian_phone");

CREATE INDEX "admission_applications_school_name_idx" ON "admission_applications" USING btree ("school_id","applicant_last_name","applicant_first_name");

CREATE INDEX "admission_applications_school_status_created_idx" ON "admission_applications" USING btree ("school_id","status","created_at");

CREATE INDEX "admission_portal_classes_class_school_idx" ON "admission_portal_classes" USING btree ("class_id","school_id");

CREATE INDEX "admission_request_rate_limits_started_idx" ON "admission_request_rate_limits" USING btree ("bucket_started_at");

CREATE INDEX "app_users_email_idx" ON "app_users" USING btree ("email");

CREATE INDEX "attendance_corrections_school_idx" ON "attendance_corrections" USING btree ("school_id","created_at");

CREATE INDEX "attendance_discrepancies_school_status_idx" ON "attendance_discrepancies" USING btree ("school_id","status","created_at");

CREATE INDEX "attendance_events_employee_idx" ON "attendance_events" USING btree ("employee_id","occurred_at");

CREATE INDEX "attendance_events_school_date_idx" ON "attendance_events" USING btree ("school_id","event_date","occurred_at");

CREATE INDEX "attendance_events_student_idx" ON "attendance_events" USING btree ("student_id","occurred_at");

CREATE INDEX "attendance_notification_events_queue_idx" ON "attendance_notification_events" USING btree ("school_id","status","created_at");

CREATE INDEX "audit_logs_school_idx" ON "audit_logs" USING btree ("school_id","timestamp");

CREATE INDEX "biometric_enrollments_school_status_idx" ON "biometric_enrollments" USING btree ("school_id","status");

CREATE INDEX "campus_presence_dashboard_idx" ON "campus_presence" USING btree ("school_id","state","person_type","last_occurred_at");

CREATE INDEX "class_subjects_school_status_idx" ON "class_subjects" USING btree ("school_id","status");

CREATE INDEX "commission_ledger_partner_status_idx" ON "commission_ledger" USING btree ("partner_profile_id","status");

CREATE INDEX "commission_rules_status_term_idx" ON "commission_rules" USING btree ("status","term");

CREATE INDEX "communication_campaign_recipients_school_status_idx" ON "communication_campaign_recipients" USING btree ("school_id","status","created_at");

CREATE INDEX "communication_campaign_recipients_user_idx" ON "communication_campaign_recipients" USING btree ("recipient_user_id","school_id","created_at");

CREATE INDEX "communication_campaigns_active_expiry_idx" ON "communication_campaigns" USING btree ("school_id","expires_at","created_at") WHERE "communication_campaigns"."expires_at" IS NOT NULL;

CREATE INDEX "communication_campaigns_school_status_idx" ON "communication_campaigns" USING btree ("school_id","status","created_at");

CREATE INDEX "communication_deliveries_provider_message_idx" ON "communication_deliveries" USING btree ("channel","provider_message_id");

CREATE INDEX "communication_deliveries_retry_idx" ON "communication_deliveries" USING btree ("status","next_attempt_at","created_at");

CREATE INDEX "communication_message_threads_parent_student_idx" ON "communication_message_threads" USING btree ("parent_user_id","student_id","last_message_at");

CREATE INDEX "communication_message_threads_school_student_idx" ON "communication_message_threads" USING btree ("school_id","student_id","last_message_at");

CREATE INDEX "communication_messages_thread_created_idx" ON "communication_messages" USING btree ("thread_id","created_at","id");

CREATE INDEX "communication_notifications_event_idx" ON "communication_notifications" USING btree ("school_id","category","created_at");

CREATE INDEX "communication_notifications_recipient_read_idx" ON "communication_notifications" USING btree ("recipient_user_id","is_read","created_at");

CREATE INDEX "communication_notifications_school_created_idx" ON "communication_notifications" USING btree ("school_id","created_at");

CREATE INDEX "communication_notifications_subject_class_dispatch_idx" ON "communication_notifications" USING btree ("school_id","subject_class_id","created_at") WHERE "communication_notifications"."subject_class_id" IS NOT NULL;

CREATE INDEX "communication_notifications_subject_student_dispatch_idx" ON "communication_notifications" USING btree ("school_id","subject_student_id","created_at") WHERE "communication_notifications"."subject_student_id" IS NOT NULL;

CREATE INDEX "communication_preferences_user_idx" ON "communication_preferences" USING btree ("user_id","school_id");

CREATE INDEX "communication_push_devices_user_school_idx" ON "communication_push_devices" USING btree ("user_id","school_id","status");

CREATE INDEX "communication_templates_school_active_idx" ON "communication_templates" USING btree ("school_id","is_active","category");

CREATE INDEX "curriculum_imports_owner_created_idx" ON "curriculum_imports" USING btree ("uploaded_by","created_at");

CREATE INDEX "curriculum_progress_school_mapping_idx" ON "curriculum_progress" USING btree ("school_id","mapping_id");

CREATE INDEX "curriculum_topics_mapping_idx" ON "curriculum_topics" USING btree ("school_id","mapping_id");

CREATE INDEX "curriculum_topics_version_class_subject_idx" ON "curriculum_topics" USING btree ("curriculum_version_id","class_level","subject_code");

CREATE INDEX "curriculum_versions_status_idx" ON "curriculum_versions" USING btree ("status","education_level");

CREATE INDEX "device_assignment_history_device_idx" ON "device_assignment_history" USING btree ("device_id","created_at");

CREATE INDEX "device_assignment_history_school_idx" ON "device_assignment_history" USING btree ("school_id","created_at");

CREATE INDEX "device_credentials_device_status_idx" ON "device_credentials" USING btree ("device_id","status");

CREATE INDEX "device_school_bindings_school_idx" ON "device_school_bindings" USING btree ("school_id");

CREATE INDEX "employee_nfc_attendance_discrepancies_school_status_idx" ON "employee_nfc_attendance_discrepancies" USING btree ("school_id","status","created_at");

CREATE INDEX "employee_nfc_card_bindings_school_status_idx" ON "employee_nfc_card_bindings" USING btree ("school_id","status");

CREATE INDEX "employee_nfc_card_history_card_idx" ON "employee_nfc_card_history" USING btree ("nfc_card_id","created_at");

CREATE INDEX "employee_nfc_card_history_employee_idx" ON "employee_nfc_card_history" USING btree ("school_id","employee_id","created_at");

CREATE INDEX "employee_nfc_discrepancy_actions_history_idx" ON "employee_nfc_discrepancy_actions" USING btree ("school_id","discrepancy_id","created_at");

CREATE INDEX "employees_school_type_status_idx" ON "employees" USING btree ("school_id","employee_type","employment_status");

CREATE INDEX "exam_question_papers_context_idx" ON "exam_question_papers" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id","section","subject_id");

CREATE INDEX "exam_question_reviews_history_idx" ON "exam_question_reviews" USING btree ("school_id","paper_id","created_at");

CREATE INDEX "fee_adjustments_invoice_idx" ON "fee_adjustments" USING btree ("school_id","invoice_id","status");

CREATE INDEX "fee_categories_school_status_idx" ON "fee_categories" USING btree ("school_id","status");

CREATE INDEX "fee_invoice_lines_invoice_idx" ON "fee_invoice_lines" USING btree ("school_id","invoice_id");

CREATE INDEX "fee_invoice_notification_outbox_retry_idx" ON "fee_invoice_notification_outbox" USING btree ("school_id","next_attempt_at","created_at");

CREATE INDEX "fee_invoice_notifications_recipient_idx" ON "fee_invoice_notifications" USING btree ("recipient_user_id","is_read","created_at");

CREATE INDEX "fee_invoice_notifications_school_idx" ON "fee_invoice_notifications" USING btree ("school_id","created_at");

CREATE INDEX "fee_invoices_school_student_idx" ON "fee_invoices" USING btree ("school_id","student_id","academic_session_id","academic_term_id");

CREATE INDEX "fee_payment_notification_outbox_retry_idx" ON "fee_payment_notification_outbox" USING btree ("school_id","next_attempt_at","created_at");

CREATE INDEX "fee_payment_notifications_recipient_idx" ON "fee_payment_notifications" USING btree ("recipient_user_id","is_read","created_at");

CREATE INDEX "fee_payment_notifications_school_idx" ON "fee_payment_notifications" USING btree ("school_id","created_at");

CREATE INDEX "fee_payments_school_status_idx" ON "fee_payments" USING btree ("school_id","status","created_at");

CREATE INDEX "fee_provider_webhook_events_reference_idx" ON "fee_provider_webhook_events" USING btree ("provider","provider_reference","received_at");

CREATE INDEX "fee_provider_webhook_events_school_status_idx" ON "fee_provider_webhook_events" USING btree ("school_id","status","received_at");

CREATE INDEX "fee_refunds_school_status_idx" ON "fee_refunds" USING btree ("school_id","status","created_at");

CREATE INDEX "fee_structures_school_context_idx" ON "fee_structures" USING btree ("school_id","academic_session_id","academic_term_id","school_class_id");

CREATE INDEX "lesson_document_note_idx" ON "lesson_note_documents" USING btree ("school_id","lesson_note_id","status");

CREATE INDEX "lesson_note_reviews_note_history_idx" ON "lesson_note_reviews" USING btree ("school_id","lesson_note_id","created_at");

CREATE INDEX "lesson_notes_teacher_context_idx" ON "lesson_notes" USING btree ("school_id","teacher_employee_id","academic_session_id","academic_term_id");

CREATE INDEX "lesson_notes_weekly_idx" ON "lesson_notes" USING btree ("school_id","academic_session_id","academic_term_id","week","status");

CREATE INDEX "library_book_copies_available_idx" ON "library_book_copies" USING btree ("school_id","book_id","status");

CREATE INDEX "library_books_isbn_idx" ON "library_books" USING btree ("school_id","isbn") WHERE "library_books"."isbn" IS NOT NULL;

CREATE INDEX "library_books_school_search_idx" ON "library_books" USING btree ("school_id","status",lower("title"));

CREATE INDEX "library_copy_status_history_idx" ON "library_copy_status_history" USING btree ("school_id","copy_id","created_at" DESC NULLS LAST);

CREATE INDEX "library_loans_borrower_history_idx" ON "library_loans" USING btree ("school_id","borrower_user_id","issued_at" DESC NULLS LAST);

CREATE INDEX "library_loans_overdue_idx" ON "library_loans" USING btree ("school_id","due_on") WHERE "library_loans"."status" = 'OPEN';

CREATE INDEX "library_renewals_loan_history_idx" ON "library_renewals" USING btree ("school_id","loan_id","created_at");

CREATE INDEX "library_staff_school_active_idx" ON "library_staff" USING btree ("school_id","is_active");

CREATE INDEX "maintenance_request_status_history_timeline_idx" ON "maintenance_request_status_history" USING btree ("school_id","maintenance_request_id","occurred_at","id");

CREATE INDEX "maintenance_requests_assignee_idx" ON "maintenance_requests" USING btree ("school_id","assigned_to_user_id","status");

CREATE INDEX "maintenance_requests_reporter_idx" ON "maintenance_requests" USING btree ("school_id","reported_by_user_id","reported_at");

CREATE INDEX "maintenance_requests_school_status_idx" ON "maintenance_requests" USING btree ("school_id","status","priority","reported_at");

CREATE INDEX "nfc_card_history_card_idx" ON "nfc_card_history" USING btree ("nfc_card_id","created_at");

CREATE INDEX "nfc_card_history_school_idx" ON "nfc_card_history" USING btree ("school_id","created_at");

CREATE INDEX "nfc_cards_last_device_idx" ON "nfc_cards" USING btree ("last_device_id");

CREATE INDEX "nfc_cards_school_idx" ON "nfc_cards" USING btree ("school_id");

CREATE INDEX "operational_task_status_history_timeline_idx" ON "operational_task_status_history" USING btree ("school_id","task_id","occurred_at","id");

CREATE INDEX "operational_tasks_assignee_idx" ON "operational_tasks" USING btree ("school_id","assigned_to_user_id","status");

CREATE INDEX "operational_tasks_school_status_idx" ON "operational_tasks" USING btree ("school_id","status","priority","due_on");

CREATE INDEX "parent_student_relationship_parent_idx" ON "parent_student_relationships" USING btree ("parent_id","status");

CREATE INDEX "parent_student_relationship_student_idx" ON "parent_student_relationships" USING btree ("student_id","status");

CREATE INDEX "parents_school_idx" ON "parents" USING btree ("school_id");

CREATE INDEX "partner_attribution_conflicts_attempted_idx" ON "partner_attribution_conflicts" USING btree ("attempted_partner_profile_id");

CREATE INDEX "partner_attribution_conflicts_school_status_idx" ON "partner_attribution_conflicts" USING btree ("school_id","status");

CREATE INDEX "partner_invitations_partner_status_idx" ON "partner_invitations" USING btree ("partner_profile_id","status");

CREATE INDEX "partner_payout_information_status_idx" ON "partner_payout_information" USING btree ("status");

CREATE INDEX "partner_payouts_partner_status_idx" ON "partner_payouts" USING btree ("partner_profile_id","status");

CREATE INDEX "partner_profile_users_partner_idx" ON "partner_profile_users" USING btree ("partner_profile_id","status");

CREATE INDEX "partner_profiles_email_idx" ON "partner_profiles" USING btree ("email");

CREATE INDEX "partner_profiles_status_idx" ON "partner_profiles" USING btree ("status");

CREATE INDEX "partner_referral_links_partner_status_idx" ON "partner_referral_links" USING btree ("partner_profile_id","status");

CREATE INDEX "payroll_employee_profiles_company_status_idx" ON "payroll_employee_profiles" USING btree ("company_employee_id","status");

CREATE INDEX "payroll_employee_profiles_school_status_idx" ON "payroll_employee_profiles" USING btree ("school_id","status","updated_at");

CREATE INDEX "payroll_items_scope_school_period_idx" ON "payroll_items" USING btree ("scope","school_id","period_id");

CREATE INDEX "payroll_periods_company_status_month_idx" ON "payroll_periods" USING btree ("scope","status","period_month");

CREATE INDEX "payroll_periods_school_status_month_idx" ON "payroll_periods" USING btree ("school_id","status","period_month");

CREATE INDEX "payroll_transfers_provider_transaction_idx" ON "payroll_transfers" USING btree ("provider","provider_transaction_id");

CREATE INDEX "payroll_transfers_scope_school_period_status_idx" ON "payroll_transfers" USING btree ("scope","school_id","period_id","status");

CREATE INDEX "platform_company_employees_status_idx" ON "platform_company_employees" USING btree ("status");

CREATE INDEX "platform_devices_school_idx" ON "platform_devices" USING btree ("school_id","status");

CREATE INDEX "platform_notifications_recipient_idx" ON "platform_notifications" USING btree ("recipient_user_id","is_read","created_at");

CREATE INDEX "promotion_batch_students_batch_status_idx" ON "promotion_batch_students" USING btree ("batch_id","status");

CREATE INDEX "promotion_batch_students_student_idx" ON "promotion_batch_students" USING btree ("school_id","student_id","created_at");

CREATE INDEX "promotion_batches_school_created_idx" ON "promotion_batches" USING btree ("school_id","created_at");

CREATE INDEX "promotion_history_school_created_idx" ON "promotion_history" USING btree ("school_id","created_at","id");

CREATE INDEX "promotion_history_student_idx" ON "promotion_history" USING btree ("school_id","student_id","created_at");

CREATE INDEX "school_asset_history_asset_timeline_idx" ON "school_asset_history" USING btree ("school_id","asset_id","event_at","id");

CREATE INDEX "school_assets_school_status_idx" ON "school_assets" USING btree ("school_id","status","name");

CREATE INDEX "school_branding_logos_school_versions_idx" ON "school_branding_logos" USING btree ("school_id","id");

CREATE INDEX "school_branding_logos_updated_by_idx" ON "school_branding_logos" USING btree ("updated_by_user_id","updated_at");

CREATE INDEX "school_calendar_events_school_dates_status_idx" ON "school_calendar_events" USING btree ("school_id","start_date","status");

CREATE INDEX "school_calendar_events_school_session_term_idx" ON "school_calendar_events" USING btree ("school_id","academic_session_id","academic_term_id");

CREATE INDEX "school_curriculum_assignments_context_idx" ON "school_curriculum_assignments" USING btree ("school_id","academic_session_id","academic_term_id");

CREATE INDEX "school_facilities_school_status_idx" ON "school_facilities" USING btree ("school_id","status","name");

CREATE INDEX "school_memberships_school_idx" ON "school_memberships" USING btree ("school_id","status");

CREATE INDEX "school_memberships_user_idx" ON "school_memberships" USING btree ("user_id","status");

CREATE INDEX "school_operation_categories_school_active_idx" ON "school_operation_categories" USING btree ("school_id","category_type","is_active");

CREATE INDEX "school_partner_attributions_partner_idx" ON "school_partner_attributions" USING btree ("partner_profile_id","status");

CREATE INDEX "school_partner_attributions_school_history_idx" ON "school_partner_attributions" USING btree ("school_id","starts_at");

CREATE INDEX "school_pickup_person_student_status_idx" ON "school_authorized_pickup_persons" USING btree ("school_id","student_id","status");

CREATE INDEX "school_pickup_requests_parent_idx" ON "school_pickup_requests" USING btree ("requested_by_parent_id","created_at");

CREATE INDEX "school_pickup_requests_school_student_status_idx" ON "school_pickup_requests" USING btree ("school_id","student_id","status","requested_pickup_at");

CREATE INDEX "school_security_incident_attachments_scope_status_idx" ON "school_security_incident_attachments" USING btree ("school_id","incident_id","status");

CREATE INDEX "school_security_incidents_school_status_date_idx" ON "school_security_incidents" USING btree ("school_id","status","occurred_at");

CREATE INDEX "school_security_operation_history_school_created_idx" ON "school_security_operation_history" USING btree ("school_id","created_at","id");

CREATE INDEX "school_security_operation_history_student_idx" ON "school_security_operation_history" USING btree ("school_id","student_id","created_at");

CREATE INDEX "school_security_visitors_school_status_date_idx" ON "school_security_visitors" USING btree ("school_id","status","checked_in_at");

CREATE INDEX "security_events_card_hash_idx" ON "security_events" USING btree ("school_id","card_uid_sha256","occurred_at") WHERE "security_events"."card_uid_sha256" IS NOT NULL;

CREATE INDEX "security_events_employee_time_idx" ON "security_events" USING btree ("school_id","employee_id","occurred_at") WHERE "security_events"."employee_id" IS NOT NULL;

CREATE INDEX "security_events_school_result_time_idx" ON "security_events" USING btree ("school_id","identity_result","occurred_at");

CREATE INDEX "security_events_school_time_idx" ON "security_events" USING btree ("school_id","occurred_at","id");

CREATE INDEX "security_events_student_time_idx" ON "security_events" USING btree ("school_id","student_id","occurred_at") WHERE "security_events"."student_id" IS NOT NULL;

CREATE INDEX "security_locations_school_status_idx" ON "security_locations" USING btree ("school_id","status","name");

CREATE INDEX "security_readers_school_status_idx" ON "security_readers" USING btree ("school_id","status","location_id");

CREATE INDEX "security_staff_grants_user_idx" ON "security_staff_grants" USING btree ("user_id","school_id","status");

CREATE INDEX "settlement_payroll_audit_actor_timeline_idx" ON "settlement_payroll_audit_events" USING btree ("actor_user_id","occurred_at","id");

CREATE INDEX "settlement_payroll_audit_record_timeline_idx" ON "settlement_payroll_audit_events" USING btree ("record_type","record_id","occurred_at","id");

CREATE INDEX "settlement_payroll_audit_scope_timeline_idx" ON "settlement_payroll_audit_events" USING btree ("scope","school_id","occurred_at","id");

CREATE INDEX "settlement_payroll_profiles_verification_idx" ON "settlement_payroll_profiles" USING btree ("verification_status","updated_at");

CREATE INDEX "staff_nfc_allocations_partner_idx" ON "staff_nfc_allocations" USING btree ("recipient_id","created_at" DESC NULLS LAST) WHERE "staff_nfc_allocations"."recipient_type" = 'PARTNER';

CREATE INDEX "staff_nfc_allocations_school_term_idx" ON "staff_nfc_allocations" USING btree ("school_id","academic_session_id","academic_term_id","created_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_billing_rules_effective_idx" ON "staff_nfc_billing_rules" USING btree ("product","effective_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_partner_commissions_partner_idx" ON "staff_nfc_partner_commissions" USING btree ("partner_profile_id","status","created_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_payments_school_status_idx" ON "staff_nfc_payments" USING btree ("school_id","status","created_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_payments_term_idx" ON "staff_nfc_payments" USING btree ("school_id","academic_session_id","academic_term_id");

CREATE INDEX "staff_nfc_provider_events_payment_idx" ON "staff_nfc_provider_events" USING btree ("payment_id","outcome");

CREATE INDEX "staff_nfc_receipts_school_issue_idx" ON "staff_nfc_receipts" USING btree ("school_id","issued_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_refunds_school_status_idx" ON "staff_nfc_refunds" USING btree ("school_id","status","created_at" DESC NULLS LAST);

CREATE INDEX "staff_nfc_subscriptions_partner_term_idx" ON "staff_nfc_subscriptions" USING btree ("partner_profile_id","academic_session_id","academic_term_id");

CREATE INDEX "staff_nfc_subscriptions_school_term_status_idx" ON "staff_nfc_subscriptions" USING btree ("school_id","academic_session_id","academic_term_id","status");

CREATE INDEX "student_behaviour_records_followup_idx" ON "student_behaviour_records" USING btree ("school_id","status","follow_up_at");

CREATE INDEX "student_behaviour_records_school_student_date_idx" ON "student_behaviour_records" USING btree ("school_id","student_id","occurred_at");

CREATE INDEX "student_care_grants_user_active_idx" ON "student_care_grants" USING btree ("user_id","active");

CREATE INDEX "student_care_history_school_student_idx" ON "student_care_record_history" USING btree ("school_id","student_id","changed_at");

CREATE INDEX "student_care_idempotency_resource_idx" ON "student_care_idempotency" USING btree ("resource_type","resource_id");

CREATE INDEX "student_class_assignments_school_current_idx" ON "student_class_assignments" USING btree ("school_id","is_current");

CREATE INDEX "student_class_assignments_student_history_idx" ON "student_class_assignments" USING btree ("student_id","start_date");

CREATE INDEX "student_identification_policies_school_idx" ON "student_identification_policies" USING btree ("school_id","status");

CREATE INDEX "student_medical_profiles_school_student_idx" ON "student_medical_profiles" USING btree ("school_id","student_id");

CREATE INDEX "student_medical_visits_school_student_date_idx" ON "student_medical_visits" USING btree ("school_id","student_id","occurred_at");

CREATE INDEX "student_nfc_replacement_school_idx" ON "student_nfc_replacement_requests" USING btree ("school_id","student_id");

CREATE INDEX "student_subscription_allocations_partner_idx" ON "student_subscription_allocations" USING btree ("recipient_id","created_at" DESC NULLS LAST) WHERE "student_subscription_allocations"."recipient_type" = 'PARTNER';

CREATE INDEX "student_subscription_allocations_school_term_idx" ON "student_subscription_allocations" USING btree ("school_id","academic_session_id","academic_term_id","created_at" DESC NULLS LAST);

CREATE INDEX "student_subscription_payments_school_status_idx" ON "student_subscription_payments" USING btree ("school_id","status","created_at" DESC NULLS LAST);

CREATE INDEX "student_subscription_payments_term_idx" ON "student_subscription_payments" USING btree ("school_id","academic_session_id","academic_term_id");

CREATE INDEX "student_welfare_records_assigned_followup_idx" ON "student_welfare_records" USING btree ("school_id","assigned_staff_user_id","follow_up_at");

CREATE INDEX "student_welfare_records_school_student_category_idx" ON "student_welfare_records" USING btree ("school_id","student_id","category");

CREATE INDEX "students_school_idx" ON "students" USING btree ("school_id");

CREATE INDEX "subjects_school_status_idx" ON "subjects" USING btree ("school_id","status");

CREATE INDEX "subscriptions_partner_profile_idx" ON "subscriptions" USING btree ("partner_profile_id");

CREATE INDEX "subscriptions_school_idx" ON "subscriptions" USING btree ("school_id");

CREATE INDEX "teacher_class_assignments_school_status_idx" ON "teacher_class_assignments" USING btree ("school_id","status");

CREATE INDEX "teacher_duty_roster_employee_history_idx" ON "teacher_duty_roster" USING btree ("school_id","employee_id","start_date");

CREATE INDEX "teacher_duty_roster_school_dates_status_idx" ON "teacher_duty_roster" USING btree ("school_id","start_date","end_date","status");

CREATE INDEX "teacher_subject_assignments_school_session_status_idx" ON "teacher_subject_assignments" USING btree ("school_id","academic_session_id","status");

CREATE INDEX "transport_buses_school_status_idx" ON "transport_buses" USING btree ("school_id","status");

CREATE INDEX "transport_fee_invoices_school_term_idx" ON "transport_fee_invoices" USING btree ("school_id","academic_term_id");

CREATE INDEX "transport_history_school_assignment_created_idx" ON "transport_history" USING btree ("school_id","assignment_id","created_at");

CREATE INDEX "transport_history_school_request_created_idx" ON "transport_history" USING btree ("school_id","request_id","created_at");

CREATE INDEX "transport_history_school_route_created_idx" ON "transport_history" USING btree ("school_id","route_id","created_at");

CREATE INDEX "transport_history_school_student_created_idx" ON "transport_history" USING btree ("school_id","student_id","created_at");

CREATE INDEX "transport_parent_requests_parent_student_created_idx" ON "transport_parent_requests" USING btree ("parent_id","student_id","created_at");

CREATE INDEX "transport_parent_requests_school_status_created_idx" ON "transport_parent_requests" USING btree ("school_id","status","created_at");

CREATE INDEX "transport_route_staff_school_route_active_idx" ON "transport_route_staff" USING btree ("school_id","route_id","is_active");

CREATE INDEX "transport_route_stops_school_route_active_idx" ON "transport_route_stops" USING btree ("school_id","route_id","is_active");

CREATE INDEX "transport_routes_school_bus_status_idx" ON "transport_routes" USING btree ("school_id","bus_id","status");

CREATE INDEX "transport_routes_school_driver_idx" ON "transport_routes" USING btree ("school_id","driver_employee_id","status");

CREATE INDEX "transport_student_assignments_route_status_idx" ON "transport_student_assignments" USING btree ("school_id","route_id","status");

CREATE INDEX "transport_student_assignments_school_status_student_idx" ON "transport_student_assignments" USING btree ("school_id","status","student_id");

ALTER TABLE "academic_assessment_types" ADD CONSTRAINT "academic_assessment_types_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assessments" ADD CONSTRAINT "academic_assessments_type_school_fk" FOREIGN KEY ("assessment_type_id","school_id") REFERENCES "public"."academic_assessment_types"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_assignments" ADD CONSTRAINT "academic_assignments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_grading_rules" ADD CONSTRAINT "academic_grading_rules_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_report_card_school_fk" FOREIGN KEY ("report_card_id","school_id") REFERENCES "public"."academic_report_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_result_school_fk" FOREIGN KEY ("result_id","school_id") REFERENCES "public"."academic_results"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_card_lines" ADD CONSTRAINT "academic_report_card_lines_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_class_assignment_school_fk" FOREIGN KEY ("student_class_assignment_id","school_id") REFERENCES "public"."student_class_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_published_by_app_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_report_cards" ADD CONSTRAINT "academic_report_cards_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_class_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_session_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_subject_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_teacher_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_result_batches" ADD CONSTRAINT "academic_result_batches_term_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_assessment_school_fk" FOREIGN KEY ("assessment_id","school_id") REFERENCES "public"."academic_assessments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_class_assignment_school_fk" FOREIGN KEY ("student_class_assignment_id","school_id") REFERENCES "public"."student_class_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_published_by_app_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_results" ADD CONSTRAINT "academic_results_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "academic_timetable_entries" ADD CONSTRAINT "academic_timetable_entries_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "admission_application_counters" ADD CONSTRAINT "admission_application_counters_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_application_documents" ADD CONSTRAINT "admission_application_documents_application_school_fk" FOREIGN KEY ("application_id","school_id") REFERENCES "public"."admission_applications"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_application_documents" ADD CONSTRAINT "admission_application_documents_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_class_school_fk" FOREIGN KEY ("intended_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_parent_school_fk" FOREIGN KEY ("converted_parent_id","school_id") REFERENCES "public"."parents"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_school_fk" FOREIGN KEY ("converted_student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_portal_classes" ADD CONSTRAINT "admission_portal_classes_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_portal_classes" ADD CONSTRAINT "admission_portal_classes_settings_school_fk" FOREIGN KEY ("school_id") REFERENCES "public"."admission_portal_settings"("school_id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "admission_portal_settings" ADD CONSTRAINT "admission_portal_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_portal_settings" ADD CONSTRAINT "admission_portal_settings_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_portal_settings" ADD CONSTRAINT "admission_portal_settings_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "admission_portal_settings" ADD CONSTRAINT "admission_portal_settings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_event_id_attendance_events_id_fk" FOREIGN KEY ("attendance_event_id") REFERENCES "public"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "public"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_attendance_event_id_attendance_events_id_fk" FOREIGN KEY ("attendance_event_id") REFERENCES "public"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "public"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_resolved_by_app_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_discrepancies" ADD CONSTRAINT "attendance_discrepancies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_device_id_platform_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_nfc_card_id_nfc_cards_id_fk" FOREIGN KEY ("nfc_card_id") REFERENCES "public"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_attendance_event_id_attendance_events_id_fk" FOREIGN KEY ("attendance_event_id") REFERENCES "public"."attendance_events"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_discrepancy_id_attendance_discrepancies_id_fk" FOREIGN KEY ("discrepancy_id") REFERENCES "public"."attendance_discrepancies"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_discrepancy_school_fk" FOREIGN KEY ("discrepancy_id","school_id") REFERENCES "public"."attendance_discrepancies"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "public"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_notification_events" ADD CONSTRAINT "attendance_notification_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_device_id_platform_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "biometric_enrollments" ADD CONSTRAINT "biometric_enrollments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "campus_presence" ADD CONSTRAINT "campus_presence_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "campus_presence" ADD CONSTRAINT "campus_presence_event_school_fk" FOREIGN KEY ("last_security_event_id","school_id") REFERENCES "public"."security_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "campus_presence" ADD CONSTRAINT "campus_presence_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "campus_presence" ADD CONSTRAINT "campus_presence_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "campus_presence" ADD CONSTRAINT "campus_presence_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_campaign_school_fk" FOREIGN KEY ("campaign_id","school_id") REFERENCES "public"."communication_campaigns"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_notification_school_user_fk" FOREIGN KEY ("notification_id","school_id","recipient_user_id") REFERENCES "public"."communication_notifications"("id","school_id","recipient_user_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaign_recipients" ADD CONSTRAINT "communication_campaign_recipients_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_template_school_fk" FOREIGN KEY ("template_id","school_id") REFERENCES "public"."communication_templates"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_deliveries" ADD CONSTRAINT "communication_deliveries_notification_id_communication_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."communication_notifications"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "communication_message_threads" ADD CONSTRAINT "communication_message_threads_class_school_fk" FOREIGN KEY ("subject_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_message_threads" ADD CONSTRAINT "communication_message_threads_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_message_threads" ADD CONSTRAINT "communication_message_threads_parent_user_id_app_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_message_threads" ADD CONSTRAINT "communication_message_threads_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_message_threads" ADD CONSTRAINT "communication_message_threads_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_sender_user_id_app_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_thread_school_fk" FOREIGN KEY ("thread_id","school_id") REFERENCES "public"."communication_message_threads"("id","school_id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_sender_user_id_app_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_subject_class_school_fk" FOREIGN KEY ("subject_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_notifications" ADD CONSTRAINT "communication_notifications_subject_student_school_fk" FOREIGN KEY ("subject_student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_push_devices" ADD CONSTRAINT "communication_push_devices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_push_devices" ADD CONSTRAINT "communication_push_devices_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_imports" ADD CONSTRAINT "curriculum_imports_confirmed_version_id_curriculum_versions_id_fk" FOREIGN KEY ("confirmed_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_imports" ADD CONSTRAINT "curriculum_imports_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_progress" ADD CONSTRAINT "curriculum_progress_mapping_school_fk" FOREIGN KEY ("mapping_id","school_id") REFERENCES "public"."school_curriculum_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_progress" ADD CONSTRAINT "curriculum_progress_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_progress" ADD CONSTRAINT "curriculum_progress_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_topics" ADD CONSTRAINT "curriculum_topics_mapping_school_fk" FOREIGN KEY ("mapping_id","school_id") REFERENCES "public"."school_curriculum_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_topics" ADD CONSTRAINT "curriculum_topics_version_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_derived_from_fk" FOREIGN KEY ("derived_from_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_device_id_platform_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_new_school_id_schools_id_fk" FOREIGN KEY ("new_school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_previous_school_id_schools_id_fk" FOREIGN KEY ("previous_school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_assignment_history" ADD CONSTRAINT "device_assignment_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_platform_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_school_bindings" ADD CONSTRAINT "device_school_bindings_device_id_platform_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."platform_devices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "device_school_bindings" ADD CONSTRAINT "device_school_bindings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_attendance_discrepancies" ADD CONSTRAINT "employee_nfc_attendance_discrepancies_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_attendance_discrepancies" ADD CONSTRAINT "employee_nfc_attendance_discrepancies_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "public"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_attendance_discrepancies" ADD CONSTRAINT "employee_nfc_attendance_discrepancies_resolved_by_user_id_app_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_attendance_discrepancies" ADD CONSTRAINT "employee_nfc_attendance_discrepancies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_bindings" ADD CONSTRAINT "employee_nfc_card_bindings_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_bindings" ADD CONSTRAINT "employee_nfc_card_bindings_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_bindings" ADD CONSTRAINT "employee_nfc_card_bindings_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_bindings" ADD CONSTRAINT "employee_nfc_card_bindings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_binding_school_fk" FOREIGN KEY ("binding_id","school_id") REFERENCES "public"."employee_nfc_card_bindings"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_replacement_card_school_fk" FOREIGN KEY ("replacement_nfc_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_card_history" ADD CONSTRAINT "employee_nfc_card_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_discrepancy_actions" ADD CONSTRAINT "employee_nfc_discrepancy_actions_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_discrepancy_actions" ADD CONSTRAINT "employee_nfc_discrepancy_actions_discrepancy_school_fk" FOREIGN KEY ("discrepancy_id","school_id") REFERENCES "public"."employee_nfc_attendance_discrepancies"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employee_nfc_discrepancy_actions" ADD CONSTRAINT "employee_nfc_discrepancy_actions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employees" ADD CONSTRAINT "employees_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_class_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_session_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_subject_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_teacher_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_term_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_reviews" ADD CONSTRAINT "exam_question_reviews_paper_fk" FOREIGN KEY ("paper_id","school_id") REFERENCES "public"."exam_question_papers"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_reviews" ADD CONSTRAINT "exam_question_reviews_reviewer_user_id_app_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_reviews" ADD CONSTRAINT "exam_question_reviews_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_reviews" ADD CONSTRAINT "exam_question_reviews_version_fk" FOREIGN KEY ("version_id","school_id") REFERENCES "public"."exam_question_versions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_versions" ADD CONSTRAINT "exam_question_versions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_versions" ADD CONSTRAINT "exam_question_versions_paper_fk" FOREIGN KEY ("paper_id","school_id") REFERENCES "public"."exam_question_papers"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "exam_question_versions" ADD CONSTRAINT "exam_question_versions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_approved_by_app_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_adjustments" ADD CONSTRAINT "fee_adjustments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "public"."fee_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_notification_outbox" ADD CONSTRAINT "fee_invoice_notification_outbox_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_notification_outbox" ADD CONSTRAINT "fee_invoice_notification_outbox_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoice_notifications" ADD CONSTRAINT "fee_invoice_notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_structure_school_fk" FOREIGN KEY ("structure_id","school_id") REFERENCES "public"."fee_structures"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_line_allocations" ADD CONSTRAINT "fee_payment_line_allocations_line_id_school_id_fkey" FOREIGN KEY ("line_id","school_id") REFERENCES "public"."fee_invoice_lines"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_line_allocations" ADD CONSTRAINT "fee_payment_line_allocations_payment_id_invoice_id_school_id_fkey" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "public"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_notification_outbox" ADD CONSTRAINT "fee_payment_notification_outbox_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "public"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_notification_outbox" ADD CONSTRAINT "fee_payment_notification_outbox_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "public"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payment_notifications" ADD CONSTRAINT "fee_payment_notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_submitted_by_app_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_verified_by_app_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_provider_checkout_sessions" ADD CONSTRAINT "fee_provider_checkout_sessions_invoice_school_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_provider_checkout_sessions" ADD CONSTRAINT "fee_provider_checkout_sessions_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_provider_webhook_events" ADD CONSTRAINT "fee_provider_webhook_events_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_provider_webhook_events" ADD CONSTRAINT "fee_provider_webhook_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "public"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."fee_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_approved_by_app_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_payment_invoice_school_fk" FOREIGN KEY ("payment_id","invoice_id","school_id") REFERENCES "public"."fee_payments"("id","invoice_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_school_settings" ADD CONSTRAINT "fee_school_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_school_settings" ADD CONSTRAINT "fee_school_settings_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "public"."fee_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_structure_school_fk" FOREIGN KEY ("structure_id","school_id") REFERENCES "public"."fee_structures"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_published_by_app_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_note_documents" ADD CONSTRAINT "lesson_document_note_school_fk" FOREIGN KEY ("lesson_note_id","school_id") REFERENCES "public"."lesson_notes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_note_documents" ADD CONSTRAINT "lesson_note_documents_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_note_reviews" ADD CONSTRAINT "lesson_note_reviews_note_school_fk" FOREIGN KEY ("lesson_note_id","school_id") REFERENCES "public"."lesson_notes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_note_reviews" ADD CONSTRAINT "lesson_note_reviews_reviewer_user_id_app_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_note_reviews" ADD CONSTRAINT "lesson_note_reviews_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_mapping_school_fk" FOREIGN KEY ("curriculum_mapping_id","school_id") REFERENCES "public"."school_curriculum_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_teacher_school_fk" FOREIGN KEY ("teacher_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_version_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_authors" ADD CONSTRAINT "library_authors_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_authors" ADD CONSTRAINT "library_authors_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_book_copies" ADD CONSTRAINT "library_book_copies_book_school_fk" FOREIGN KEY ("book_id","school_id") REFERENCES "public"."library_books"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_book_copies" ADD CONSTRAINT "library_book_copies_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_books" ADD CONSTRAINT "library_books_author_school_fk" FOREIGN KEY ("author_id","school_id") REFERENCES "public"."library_authors"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_books" ADD CONSTRAINT "library_books_category_school_fk" FOREIGN KEY ("category_id","school_id") REFERENCES "public"."library_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_books" ADD CONSTRAINT "library_books_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_books" ADD CONSTRAINT "library_books_publisher_school_fk" FOREIGN KEY ("publisher_id","school_id") REFERENCES "public"."library_publishers"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_books" ADD CONSTRAINT "library_books_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_changed_by_user_id_app_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_copy_school_fk" FOREIGN KEY ("copy_id","school_id") REFERENCES "public"."library_book_copies"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_copy_status_history" ADD CONSTRAINT "library_copy_status_history_loan_school_fk" FOREIGN KEY ("loan_id","school_id") REFERENCES "public"."library_loans"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_book_school_fk" FOREIGN KEY ("book_id","school_id") REFERENCES "public"."library_books"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_borrower_user_id_app_users_id_fk" FOREIGN KEY ("borrower_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copy_book_school_fk" FOREIGN KEY ("school_id","book_id","copy_id") REFERENCES "public"."library_book_copies"("school_id","book_id","id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_issued_by_user_id_app_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_returned_by_user_id_app_users_id_fk" FOREIGN KEY ("returned_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_student_school_fk" FOREIGN KEY ("borrower_student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_publishers" ADD CONSTRAINT "library_publishers_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_publishers" ADD CONSTRAINT "library_publishers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_renewals" ADD CONSTRAINT "library_renewals_loan_school_fk" FOREIGN KEY ("loan_id","school_id") REFERENCES "public"."library_loans"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_renewals" ADD CONSTRAINT "library_renewals_renewed_by_user_id_app_users_id_fk" FOREIGN KEY ("renewed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_assigned_by_user_id_app_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "library_staff" ADD CONSTRAINT "library_staff_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "maintenance_request_status_history" ADD CONSTRAINT "maintenance_request_status_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "maintenance_request_status_history" ADD CONSTRAINT "maintenance_request_status_history_request_school_fk" FOREIGN KEY ("maintenance_request_id","school_id") REFERENCES "public"."maintenance_requests"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_asset_school_fk" FOREIGN KEY ("asset_id","school_id") REFERENCES "public"."school_assets"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assigned_to_user_id_app_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "public"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_user_id_app_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_nfc_card_id_nfc_cards_id_fk" FOREIGN KEY ("nfc_card_id") REFERENCES "public"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_replaced_by_card_id_nfc_cards_id_fk" FOREIGN KEY ("replaced_by_card_id") REFERENCES "public"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_card_history" ADD CONSTRAINT "nfc_card_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_last_device_school_fk" FOREIGN KEY ("last_device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_id_fk" FOREIGN KEY ("replaced_by_card_id") REFERENCES "public"."nfc_cards"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_school_fk" FOREIGN KEY ("replaced_by_card_id","replaced_by_school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "operational_task_status_history" ADD CONSTRAINT "operational_task_status_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "operational_task_status_history" ADD CONSTRAINT "operational_task_status_history_task_school_fk" FOREIGN KEY ("task_id","school_id") REFERENCES "public"."operational_tasks"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_assigned_to_user_id_app_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "public"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "parent_student_relationships" ADD CONSTRAINT "parent_student_relationships_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "parent_student_relationships" ADD CONSTRAINT "parent_student_relationships_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "parents" ADD CONSTRAINT "parents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_attempted_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("attempted_partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_existing_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("existing_partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_referral_link_id_partner_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_resolved_by_app_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_payout_information" ADD CONSTRAINT "partner_payout_information_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_profile_users" ADD CONSTRAINT "partner_profile_users_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_profile_users" ADD CONSTRAINT "partner_profile_users_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_company_employee_id_platform_company_employees_id_fk" FOREIGN KEY ("company_employee_id") REFERENCES "public"."platform_company_employees"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_period_scope_school_fk" FOREIGN KEY ("period_id","scope","school_id") REFERENCES "public"."payroll_periods"("id","scope","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_profile_scope_school_fk" FOREIGN KEY ("employee_profile_id","scope","school_id") REFERENCES "public"."payroll_employee_profiles"("id","scope","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_item_period_fk" FOREIGN KEY ("payroll_item_id","period_id") REFERENCES "public"."payroll_items"("id","period_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_verified_transfer_scope_fk" FOREIGN KEY ("transfer_id","scope","school_id") REFERENCES "public"."payroll_transfers"("id","scope","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approved_by_app_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_submitted_by_app_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_transfers" ADD CONSTRAINT "payroll_transfers_item_period_fk" FOREIGN KEY ("payroll_item_id","period_id") REFERENCES "public"."payroll_items"("id","period_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_transfers" ADD CONSTRAINT "payroll_transfers_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "payroll_transfers" ADD CONSTRAINT "payroll_transfers_verified_by_app_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_assignment_school_fk" FOREIGN KEY ("source_assignment_id","school_id") REFERENCES "public"."student_class_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_batch_school_fk" FOREIGN KEY ("batch_id","school_id") REFERENCES "public"."promotion_batches"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_source_class_school_fk" FOREIGN KEY ("source_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_source_session_school_fk" FOREIGN KEY ("source_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_source_term_school_fk" FOREIGN KEY ("source_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_target_class_school_fk" FOREIGN KEY ("target_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batch_students" ADD CONSTRAINT "promotion_batch_students_target_term_school_fk" FOREIGN KEY ("target_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_finalization_actor_user_id_app_users_id_fk" FOREIGN KEY ("finalization_actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_finalized_by_app_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_idempotency_actor_user_id_app_users_id_fk" FOREIGN KEY ("idempotency_actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_prepared_by_app_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_source_session_school_fk" FOREIGN KEY ("source_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_batches" ADD CONSTRAINT "promotion_batches_target_session_school_fk" FOREIGN KEY ("target_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_history" ADD CONSTRAINT "promotion_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_history" ADD CONSTRAINT "promotion_history_batch_school_fk" FOREIGN KEY ("batch_id","school_id") REFERENCES "public"."promotion_batches"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_history" ADD CONSTRAINT "promotion_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_history" ADD CONSTRAINT "promotion_history_student_batch_school_fk" FOREIGN KEY ("batch_student_id","school_id") REFERENCES "public"."promotion_batch_students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "promotion_history" ADD CONSTRAINT "promotion_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_asset_school_fk" FOREIGN KEY ("asset_id","school_id") REFERENCES "public"."school_assets"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_assigned_to_after_user_id_app_users_id_fk" FOREIGN KEY ("assigned_to_after_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_asset_history" ADD CONSTRAINT "school_asset_history_assigned_to_before_user_id_app_users_id_fk" FOREIGN KEY ("assigned_to_before_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_assigned_to_user_id_app_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_category_school_fk" FOREIGN KEY ("category_id","school_id","category_type") REFERENCES "public"."school_operation_categories"("id","school_id","category_type") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_assets" ADD CONSTRAINT "school_assets_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_authorized_pickup_persons" ADD CONSTRAINT "school_authorized_pickup_persons_decision_by_user_id_app_users_id_fk" FOREIGN KEY ("decision_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_authorized_pickup_persons" ADD CONSTRAINT "school_authorized_pickup_persons_nominated_by_parent_id_parents_id_fk" FOREIGN KEY ("nominated_by_parent_id") REFERENCES "public"."parents"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_authorized_pickup_persons" ADD CONSTRAINT "school_authorized_pickup_persons_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_authorized_pickup_persons" ADD CONSTRAINT "school_pickup_person_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_branding_logos" ADD CONSTRAINT "school_branding_logos_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_branding_logos" ADD CONSTRAINT "school_branding_logos_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_calendar_events" ADD CONSTRAINT "school_calendar_events_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_confirmed_by_app_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_curriculum_assignments" ADD CONSTRAINT "school_curriculum_assignments_version_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "public"."curriculum_versions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_facilities" ADD CONSTRAINT "school_facilities_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_facilities" ADD CONSTRAINT "school_facilities_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_memberships" ADD CONSTRAINT "school_memberships_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_memberships" ADD CONSTRAINT "school_memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_operation_categories" ADD CONSTRAINT "school_operation_categories_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_operation_categories" ADD CONSTRAINT "school_operation_categories_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_operations_settings" ADD CONSTRAINT "school_operations_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_operations_settings" ADD CONSTRAINT "school_operations_settings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_referral_link_id_partner_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_completed_by_user_id_app_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_completion_person_school_student_fk" FOREIGN KEY ("completion_pickup_person_id","school_id","student_id") REFERENCES "public"."school_authorized_pickup_persons"("id","school_id","student_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_decision_by_user_id_app_users_id_fk" FOREIGN KEY ("decision_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_person_school_student_fk" FOREIGN KEY ("pickup_person_id","school_id","student_id") REFERENCES "public"."school_authorized_pickup_persons"("id","school_id","student_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_requested_by_parent_id_parents_id_fk" FOREIGN KEY ("requested_by_parent_id") REFERENCES "public"."parents"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_security_event_school_fk" FOREIGN KEY ("recorded_security_event_id","school_id") REFERENCES "public"."security_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_pickup_requests" ADD CONSTRAINT "school_pickup_requests_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_incident_attachments" ADD CONSTRAINT "school_security_incident_attachments_incident_school_fk" FOREIGN KEY ("incident_id","school_id") REFERENCES "public"."school_security_incidents"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_incident_attachments" ADD CONSTRAINT "school_security_incident_attachments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_incident_attachments" ADD CONSTRAINT "school_security_incident_attachments_uploaded_by_user_id_app_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_assigned_staff_user_id_app_users_id_fk" FOREIGN KEY ("assigned_staff_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_device_school_fk" FOREIGN KEY ("security_device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_location_school_fk" FOREIGN KEY ("security_location_id","school_id") REFERENCES "public"."security_locations"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_incidents" ADD CONSTRAINT "school_security_incidents_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_operation_history" ADD CONSTRAINT "school_security_operation_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_operation_history" ADD CONSTRAINT "school_security_operation_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_operation_history" ADD CONSTRAINT "school_security_operation_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_visitors" ADD CONSTRAINT "school_security_visitors_device_school_fk" FOREIGN KEY ("security_device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_visitors" ADD CONSTRAINT "school_security_visitors_host_student_school_fk" FOREIGN KEY ("host_student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_visitors" ADD CONSTRAINT "school_security_visitors_location_school_fk" FOREIGN KEY ("security_location_id","school_id") REFERENCES "public"."security_locations"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_security_visitors" ADD CONSTRAINT "school_security_visitors_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_security_visitors" ADD CONSTRAINT "school_security_visitors_security_officer_user_id_app_users_id_fk" FOREIGN KEY ("security_officer_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_subscription_enforcement" ADD CONSTRAINT "school_subscription_enforcement_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_subscription_enforcement" ADD CONSTRAINT "subscription_enforcement_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "school_subscription_manual_locks" ADD CONSTRAINT "school_subscription_manual_locks_last_unlocked_by_user_id_app_users_id_fk" FOREIGN KEY ("last_unlocked_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_subscription_manual_locks" ADD CONSTRAINT "school_subscription_manual_locks_locked_by_user_id_app_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "school_subscription_manual_locks" ADD CONSTRAINT "school_subscription_manual_locks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_attendance_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "public"."attendance_events"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_location_school_fk" FOREIGN KEY ("location_id","school_id") REFERENCES "public"."security_locations"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reader_school_fk" FOREIGN KEY ("reader_id","school_id") REFERENCES "public"."security_readers"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_locations" ADD CONSTRAINT "security_locations_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_locations" ADD CONSTRAINT "security_locations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_locations" ADD CONSTRAINT "security_locations_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_readers" ADD CONSTRAINT "security_readers_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_readers" ADD CONSTRAINT "security_readers_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "public"."device_school_bindings"("device_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_readers" ADD CONSTRAINT "security_readers_location_school_fk" FOREIGN KEY ("location_id","school_id") REFERENCES "public"."security_locations"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_readers" ADD CONSTRAINT "security_readers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_readers" ADD CONSTRAINT "security_readers_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_school_settings" ADD CONSTRAINT "security_school_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_school_settings" ADD CONSTRAINT "security_school_settings_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_staff_grants" ADD CONSTRAINT "security_staff_grants_granted_by_user_id_app_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_staff_grants" ADD CONSTRAINT "security_staff_grants_revoked_by_user_id_app_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_staff_grants" ADD CONSTRAINT "security_staff_grants_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "security_staff_grants" ADD CONSTRAINT "security_staff_grants_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "settlement_payroll_audit_events" ADD CONSTRAINT "settlement_payroll_audit_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "settlement_payroll_audit_events" ADD CONSTRAINT "settlement_payroll_audit_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "settlement_payroll_profiles" ADD CONSTRAINT "settlement_payroll_profiles_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "settlement_payroll_profiles" ADD CONSTRAINT "settlement_payroll_profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "settlement_payroll_profiles" ADD CONSTRAINT "settlement_payroll_profiles_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "settlement_payroll_profiles" ADD CONSTRAINT "settlement_payroll_profiles_verified_by_app_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_allocations" ADD CONSTRAINT "staff_nfc_allocations_attribution_id_school_partner_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."school_partner_attributions"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_allocations" ADD CONSTRAINT "staff_nfc_allocations_payment_subscription_school_fk" FOREIGN KEY ("payment_id","subscription_id","school_id") REFERENCES "public"."staff_nfc_payments"("id","subscription_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_allocations" ADD CONSTRAINT "staff_nfc_allocations_refund_payment_school_fk" FOREIGN KEY ("refund_id","payment_id","school_id") REFERENCES "public"."staff_nfc_refunds"("id","payment_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_allocations" ADD CONSTRAINT "staff_nfc_allocations_rule_product_fk" FOREIGN KEY ("allocation_rule_id","product") REFERENCES "public"."staff_nfc_billing_rules"("id","product") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_allocations" ADD CONSTRAINT "staff_nfc_allocations_subscription_owner_term_fk" FOREIGN KEY ("subscription_id","employee_id","school_id","academic_session_id","academic_term_id") REFERENCES "public"."staff_nfc_subscriptions"("id","employee_id","school_id","academic_session_id","academic_term_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_billing_rules" ADD CONSTRAINT "staff_nfc_billing_rules_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_partner_commissions" ADD CONSTRAINT "staff_nfc_partner_commissions_allocation_fk" FOREIGN KEY ("allocation_id","payment_id","recipient_type") REFERENCES "public"."staff_nfc_allocations"("id","payment_id","recipient_type") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_partner_commissions" ADD CONSTRAINT "staff_nfc_partner_commissions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_partner_commissions" ADD CONSTRAINT "staff_nfc_partner_commissions_payment_tenant_fk" FOREIGN KEY ("payment_id","subscription_id","school_id") REFERENCES "public"."staff_nfc_payments"("id","subscription_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_partner_commissions" ADD CONSTRAINT "staff_nfc_partner_commissions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_partner_commissions" ADD CONSTRAINT "staff_nfc_partner_commissions_subscription_tenant_fk" FOREIGN KEY ("subscription_id","employee_id","school_id","academic_session_id","academic_term_id") REFERENCES "public"."staff_nfc_subscriptions"("id","employee_id","school_id","academic_session_id","academic_term_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_payments" ADD CONSTRAINT "staff_nfc_payments_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_payments" ADD CONSTRAINT "staff_nfc_payments_subscription_owner_term_fk" FOREIGN KEY ("subscription_id","employee_id","school_id","academic_session_id","academic_term_id") REFERENCES "public"."staff_nfc_subscriptions"("id","employee_id","school_id","academic_session_id","academic_term_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_provider_events" ADD CONSTRAINT "staff_nfc_provider_events_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."staff_nfc_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_receipts" ADD CONSTRAINT "staff_nfc_receipts_payment_owner_fk" FOREIGN KEY ("payment_id","subscription_id","school_id") REFERENCES "public"."staff_nfc_payments"("id","subscription_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_refunds" ADD CONSTRAINT "staff_nfc_refunds_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_refunds" ADD CONSTRAINT "staff_nfc_refunds_payment_school_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."staff_nfc_payments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_attribution_id_school_partner_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."school_partner_attributions"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_rule_version_fk" FOREIGN KEY ("billing_rule_id","billing_rule_version") REFERENCES "public"."staff_nfc_billing_rules"("id","version") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "staff_nfc_subscriptions" ADD CONSTRAINT "staff_nfc_subscriptions_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_behaviour_configurations" ADD CONSTRAINT "student_behaviour_configurations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_behaviour_configurations" ADD CONSTRAINT "student_behaviour_configurations_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_parent_notification_id_communication_notifications_id_fk" FOREIGN KEY ("parent_notification_id") REFERENCES "public"."communication_notifications"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_reporter_user_id_app_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_behaviour_records" ADD CONSTRAINT "student_behaviour_records_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_care_grants" ADD CONSTRAINT "student_care_grants_granted_by_user_id_app_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_grants" ADD CONSTRAINT "student_care_grants_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_grants" ADD CONSTRAINT "student_care_grants_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_idempotency" ADD CONSTRAINT "student_care_idempotency_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_idempotency" ADD CONSTRAINT "student_care_idempotency_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_idempotency" ADD CONSTRAINT "student_care_idempotency_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_care_record_history" ADD CONSTRAINT "student_care_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_care_record_history" ADD CONSTRAINT "student_care_record_history_changed_by_user_id_app_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_care_record_history" ADD CONSTRAINT "student_care_record_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_identification_policies" ADD CONSTRAINT "student_identification_policies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_medical_profiles" ADD CONSTRAINT "student_medical_profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_medical_profiles" ADD CONSTRAINT "student_medical_profiles_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_medical_profiles" ADD CONSTRAINT "student_medical_profiles_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_medical_visits" ADD CONSTRAINT "student_medical_visits_recorded_by_user_id_app_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_medical_visits" ADD CONSTRAINT "student_medical_visits_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_medical_visits" ADD CONSTRAINT "student_medical_visits_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "replacement_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_invoice_id_school_id_fee_invoices_id_school_id_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_issued_by_app_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_new_card_id_school_id_nfc_cards_id_school_id_fk" FOREIGN KEY ("new_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_old_card_id_school_id_nfc_cards_id_school_id_fk" FOREIGN KEY ("old_card_id","school_id") REFERENCES "public"."nfc_cards"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_requested_by_app_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_nfc_replacement_requests" ADD CONSTRAINT "student_nfc_replacement_requests_student_id_school_id_students_id_school_id_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_attribution_id_school_partner_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."school_partner_attributions"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_attribution_partner_fk" FOREIGN KEY ("attribution_id","recipient_id") REFERENCES "public"."school_partner_attributions"("id","partner_profile_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_payer_user_id_app_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_payment_owner_term_fk" FOREIGN KEY ("payment_id","subscription_id","school_id","student_id","academic_session_id","academic_term_id") REFERENCES "public"."student_subscription_payments"("id","subscription_id","school_id","student_id","academic_session_id","academic_term_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_allocations" ADD CONSTRAINT "student_subscription_allocations_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_payments" ADD CONSTRAINT "student_subscription_payments_payer_user_id_app_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_subscription_payments" ADD CONSTRAINT "student_subscription_payments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_payments" ADD CONSTRAINT "student_subscription_payments_subscription_owner_fk" FOREIGN KEY ("subscription_id","school_id","student_id") REFERENCES "public"."subscriptions"("id","school_id","student_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_payments" ADD CONSTRAINT "student_subscription_payments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_academic_session_id_school_id_academic_sessions_id_school_id_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_academic_term_id_school_id_academic_session_id_academic_terms_id_school_id_academic_session_id_fk" FOREIGN KEY ("academic_term_id","school_id","academic_session_id") REFERENCES "public"."academic_terms"("id","school_id","academic_session_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_legacy_invoice_id_school_id_fee_invoices_id_school_id_fk" FOREIGN KEY ("legacy_invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_student_id_school_id_students_id_school_id_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_subscription_terms" ADD CONSTRAINT "student_subscription_terms_subscription_id_school_id_student_id_subscriptions_id_school_id_student_id_fk" FOREIGN KEY ("subscription_id","school_id","student_id") REFERENCES "public"."subscriptions"("id","school_id","student_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "student_welfare_records" ADD CONSTRAINT "student_welfare_records_assigned_staff_user_id_app_users_id_fk" FOREIGN KEY ("assigned_staff_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_welfare_records" ADD CONSTRAINT "student_welfare_records_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_welfare_records" ADD CONSTRAINT "student_welfare_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "student_welfare_records" ADD CONSTRAINT "student_welfare_records_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "students" ADD CONSTRAINT "students_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "teacher_duty_roster" ADD CONSTRAINT "teacher_duty_roster_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_duty_roster" ADD CONSTRAINT "teacher_duty_roster_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_duty_roster" ADD CONSTRAINT "teacher_duty_roster_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_duty_roster" ADD CONSTRAINT "teacher_duty_roster_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_subject_assignments" ADD CONSTRAINT "teacher_subject_assignments_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_subject_assignments" ADD CONSTRAINT "teacher_subject_assignments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_subject_assignments" ADD CONSTRAINT "teacher_subject_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_subject_assignments" ADD CONSTRAINT "teacher_subject_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "teacher_subject_assignments" ADD CONSTRAINT "teacher_subject_assignments_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_buses" ADD CONSTRAINT "transport_buses_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_buses" ADD CONSTRAINT "transport_buses_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_assignment_school_fk" FOREIGN KEY ("assignment_id","school_id") REFERENCES "public"."transport_student_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_category_school_fk" FOREIGN KEY ("fee_category_id","school_id") REFERENCES "public"."fee_categories"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_finance_invoice_school_fk" FOREIGN KEY ("fee_invoice_id","school_id") REFERENCES "public"."fee_invoices"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_fee_invoices" ADD CONSTRAINT "transport_fee_invoices_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_assignment_school_fk" FOREIGN KEY ("assignment_id","school_id") REFERENCES "public"."transport_student_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_bus_school_fk" FOREIGN KEY ("bus_id","school_id") REFERENCES "public"."transport_buses"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_request_school_fk" FOREIGN KEY ("request_id","school_id") REFERENCES "public"."transport_parent_requests"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_route_school_fk" FOREIGN KEY ("route_id","school_id") REFERENCES "public"."transport_routes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_route_staff_school_fk" FOREIGN KEY ("route_staff_id","school_id") REFERENCES "public"."transport_route_staff"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_history" ADD CONSTRAINT "transport_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_parent_requests" ADD CONSTRAINT "transport_parent_requests_active_relationship_fk" FOREIGN KEY ("parent_id","student_id") REFERENCES "public"."parent_student_relationships"("parent_id","student_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_parent_requests" ADD CONSTRAINT "transport_parent_requests_assignment_school_fk" FOREIGN KEY ("assignment_id","school_id") REFERENCES "public"."transport_student_assignments"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_parent_requests" ADD CONSTRAINT "transport_parent_requests_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_parent_requests" ADD CONSTRAINT "transport_parent_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_parent_requests" ADD CONSTRAINT "transport_parent_requests_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_route_staff" ADD CONSTRAINT "transport_route_staff_assigned_by_app_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_route_staff" ADD CONSTRAINT "transport_route_staff_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_route_staff" ADD CONSTRAINT "transport_route_staff_route_school_fk" FOREIGN KEY ("route_id","school_id") REFERENCES "public"."transport_routes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_route_staff" ADD CONSTRAINT "transport_route_staff_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_route_stops" ADD CONSTRAINT "transport_route_stops_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_route_stops" ADD CONSTRAINT "transport_route_stops_route_school_fk" FOREIGN KEY ("route_id","school_id") REFERENCES "public"."transport_routes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_route_stops" ADD CONSTRAINT "transport_route_stops_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_bus_school_fk" FOREIGN KEY ("bus_id","school_id") REFERENCES "public"."transport_buses"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_driver_school_fk" FOREIGN KEY ("driver_employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_school_policies" ADD CONSTRAINT "transport_school_policies_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_school_policies" ADD CONSTRAINT "transport_school_policies_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_dropoff_route_school_fk" FOREIGN KEY ("dropoff_stop_id","route_id","school_id") REFERENCES "public"."transport_route_stops"("id","route_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_pickup_route_school_fk" FOREIGN KEY ("pickup_stop_id","route_id","school_id") REFERENCES "public"."transport_route_stops"("id","route_id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_route_school_fk" FOREIGN KEY ("route_id","school_id") REFERENCES "public"."transport_routes"("id","school_id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transport_student_assignments" ADD CONSTRAINT "transport_student_assignments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;
