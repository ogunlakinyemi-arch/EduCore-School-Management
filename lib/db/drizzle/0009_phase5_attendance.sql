-- Phase 5 attendance, NFC lifecycle, device security and identification foundation.
-- Additive only: existing rows and historical records are preserved.
ALTER TABLE "platform_devices" ADD COLUMN IF NOT EXISTS "location" text;
ALTER TABLE "platform_devices" ADD COLUMN IF NOT EXISTS "school_class_id" integer;
ALTER TABLE "platform_devices" ADD COLUMN IF NOT EXISTS "configuration_status" text NOT NULL DEFAULT 'PENDING';
ALTER TABLE "platform_devices" DROP CONSTRAINT IF EXISTS "platform_devices_status_check";
ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_status_check"
  CHECK ("status" IN ('ACTIVE','INACTIVE','MAINTENANCE','SUSPENDED','UNASSIGNED'));
CREATE UNIQUE INDEX IF NOT EXISTS "platform_devices_id_school_unique" ON "platform_devices" ("id","school_id");
ALTER TABLE "platform_devices" ADD CONSTRAINT "platform_devices_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "school_classes"("id","school_id") NOT VALID;

ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "issued_at" timestamptz;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "activated_at" timestamptz;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "replaced_at" timestamptz;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "replaced_by_card_id" integer;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "replaced_by_school_id" integer;
ALTER TABLE "nfc_cards" ADD COLUMN IF NOT EXISTS "last_device_id" integer;
CREATE UNIQUE INDEX IF NOT EXISTS "nfc_cards_id_school_unique" ON "nfc_cards" ("id","school_id");
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_last_device_school_fk" FOREIGN KEY ("last_device_id","school_id") REFERENCES "platform_devices"("id","school_id");
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_id_fk" FOREIGN KEY ("replaced_by_card_id") REFERENCES "nfc_cards"("id");
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_replaced_by_school_fk" FOREIGN KEY ("replaced_by_card_id","replaced_by_school_id") REFERENCES "nfc_cards"("id","school_id");
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id");

CREATE TABLE "device_credentials" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "device_id" integer NOT NULL REFERENCES "platform_devices"("id"),
  "credential_identifier" text NOT NULL UNIQUE,
  "secret_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "device_credentials_device_status_idx" ON "device_credentials" ("device_id","status");

CREATE TABLE "device_assignment_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "device_id" integer NOT NULL REFERENCES "platform_devices"("id"),
  "previous_school_id" integer REFERENCES "schools"("id"),
  "previous_location" text,
  "location" text,
  "action" text NOT NULL,
  "reason" text,
  "actor_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "device_assignment_history_school_idx" ON "device_assignment_history" ("school_id","created_at");
CREATE INDEX "device_assignment_history_device_idx" ON "device_assignment_history" ("device_id","created_at");

CREATE TABLE "student_identification_policies" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer NOT NULL REFERENCES "students"("id"),
  "policy" text NOT NULL DEFAULT 'NFC_ONLY',
  "effective_from" date,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_by" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_identification_policies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id")
);
CREATE UNIQUE INDEX "student_identification_policies_student_unique" ON "student_identification_policies" ("student_id");
CREATE INDEX "student_identification_policies_school_idx" ON "student_identification_policies" ("school_id","status");

CREATE TABLE "biometric_enrollments" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer REFERENCES "students"("id"),
  "employee_id" integer REFERENCES "employees"("id"),
  "device_id" integer REFERENCES "platform_devices"("id"),
  "provider" text NOT NULL,
  "provider_reference" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "enrolled_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "metadata" jsonb,
  CONSTRAINT "biometric_enrollments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id"),
  CONSTRAINT "biometric_enrollments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id"),
  CONSTRAINT "biometric_enrollments_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "platform_devices"("id","school_id"),
  CONSTRAINT "biometric_enrollments_subject_check" CHECK ((("student_id" IS NOT NULL)::int + ("employee_id" IS NOT NULL)::int) = 1)
);
CREATE UNIQUE INDEX "biometric_enrollments_provider_reference_unique" ON "biometric_enrollments" ("provider","provider_reference");
CREATE INDEX "biometric_enrollments_school_status_idx" ON "biometric_enrollments" ("school_id","status");

CREATE TABLE "attendance_settings" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL UNIQUE REFERENCES "schools"("id"),
  "entry_window_start" time,
  "entry_window_end" time,
  "exit_window_start" time,
  "exit_window_end" time,
  "classroom_window_start" time,
  "classroom_window_end" time,
  "duplicate_suppression_seconds" integer NOT NULL DEFAULT 30,
  "notify_on_entry" boolean NOT NULL DEFAULT true,
  "notify_on_exit" boolean NOT NULL DEFAULT true,
  "notify_on_discrepancy" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "attendance_events" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer REFERENCES "students"("id"),
  "employee_id" integer REFERENCES "employees"("id"),
  "device_id" integer REFERENCES "platform_devices"("id"),
  "nfc_card_id" integer REFERENCES "nfc_cards"("id"),
  "identification_method" text NOT NULL,
  "event_type" text NOT NULL,
  "result" text NOT NULL,
  "attendance_status" text NOT NULL DEFAULT 'PRESENT',
  "event_date" date NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "academic_session_id" integer REFERENCES "academic_sessions"("id"),
  "academic_term_id" integer REFERENCES "academic_terms"("id"),
  "school_class_id" integer REFERENCES "school_classes"("id"),
  "class_name_snapshot" text,
  "section_snapshot" text,
  "reason" text,
  "actor_user_id" integer REFERENCES "app_users"("id"),
  "failure_reason" text,
  "dedupe_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_events_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id"),
  CONSTRAINT "attendance_events_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id"),
  CONSTRAINT "attendance_events_device_school_fk" FOREIGN KEY ("device_id","school_id") REFERENCES "platform_devices"("id","school_id"),
  CONSTRAINT "attendance_events_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "academic_sessions"("id","school_id"),
  CONSTRAINT "attendance_events_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "academic_terms"("id","school_id"),
  CONSTRAINT "attendance_events_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "school_classes"("id","school_id"),
  CONSTRAINT "attendance_events_subject_check" CHECK ((("student_id" IS NOT NULL)::int + ("employee_id" IS NOT NULL)::int) = 1)
);
CREATE UNIQUE INDEX "attendance_events_school_dedupe_unique" ON "attendance_events" ("school_id","dedupe_key");
CREATE UNIQUE INDEX "attendance_events_id_school_unique" ON "attendance_events" ("id","school_id");
CREATE INDEX "attendance_events_school_date_idx" ON "attendance_events" ("school_id","event_date","occurred_at");
CREATE INDEX "attendance_events_student_idx" ON "attendance_events" ("student_id","occurred_at");
CREATE INDEX "attendance_events_employee_idx" ON "attendance_events" ("employee_id","occurred_at");

CREATE TABLE "attendance_corrections" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "attendance_event_id" integer NOT NULL REFERENCES "attendance_events"("id"),
  "original_value" jsonb NOT NULL,
  "corrected_value" jsonb NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_corrections_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "attendance_events"("id","school_id")
);
CREATE INDEX "attendance_corrections_school_idx" ON "attendance_corrections" ("school_id","created_at");

CREATE TABLE "attendance_discrepancies" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer NOT NULL REFERENCES "students"("id"),
  "attendance_event_id" integer REFERENCES "attendance_events"("id"),
  "discrepancy_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "details" jsonb,
  "resolved_by" integer REFERENCES "app_users"("id"),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_discrepancies_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id"),
  CONSTRAINT "attendance_discrepancies_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "attendance_events"("id","school_id")
);
CREATE UNIQUE INDEX "attendance_discrepancies_id_school_unique" ON "attendance_discrepancies" ("id","school_id");
CREATE UNIQUE INDEX "attendance_discrepancies_event_kind_unique" ON "attendance_discrepancies" ("attendance_event_id","discrepancy_type");
CREATE INDEX "attendance_discrepancies_school_status_idx" ON "attendance_discrepancies" ("school_id","status","created_at");

CREATE TABLE "attendance_notification_events" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "attendance_event_id" integer REFERENCES "attendance_events"("id"),
  "discrepancy_id" integer REFERENCES "attendance_discrepancies"("id"),
  "notification_type" text NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "recipient_user_id" integer REFERENCES "app_users"("id"),
  "payload" jsonb,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attendance_notification_events_event_school_fk" FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "attendance_events"("id","school_id"),
  CONSTRAINT "attendance_notification_events_discrepancy_school_fk" FOREIGN KEY ("discrepancy_id","school_id") REFERENCES "attendance_discrepancies"("id","school_id")
);
CREATE INDEX "attendance_notification_events_queue_idx" ON "attendance_notification_events" ("school_id","status","created_at");

CREATE TABLE "nfc_card_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "nfc_card_id" integer NOT NULL REFERENCES "nfc_cards"("id"),
  "student_id" integer REFERENCES "students"("id"),
  "action" text NOT NULL,
  "previous_status" text,
  "new_status" text,
  "replaced_by_card_id" integer REFERENCES "nfc_cards"("id"),
  "reason" text,
  "actor_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nfc_card_history_card_school_fk" FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "nfc_cards"("id","school_id"),
  CONSTRAINT "nfc_card_history_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id")
);
CREATE INDEX "nfc_card_history_school_idx" ON "nfc_card_history" ("school_id","created_at");
CREATE INDEX "nfc_card_history_card_idx" ON "nfc_card_history" ("nfc_card_id","created_at");