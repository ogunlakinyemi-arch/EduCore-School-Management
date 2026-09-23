CREATE UNIQUE INDEX IF NOT EXISTS "academic_sessions_id_school_unique" ON "academic_sessions" ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "academic_terms_id_school_unique" ON "academic_terms" ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_id_school_unique" ON "employees" ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "school_classes_id_school_unique" ON "school_classes" ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "students_id_school_unique" ON "students" ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subjects_id_school_unique" ON "subjects" ("id","school_id");--> statement-breakpoint
DO $$
DECLARE mismatch_count integer;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM "student_class_assignments" a
  LEFT JOIN "school_classes" c
    ON c."id" = a."school_class_id" AND c."school_id" = a."school_id"
  WHERE c."id" IS NULL;
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Cannot repair student_class_assignments_class_school_fk: % mismatched rows require manual reconciliation; no data was changed',
      mismatch_count;
  END IF;
  ALTER TABLE "student_class_assignments"
    DROP CONSTRAINT IF EXISTS "student_class_assignments_class_school_fk";
  ALTER TABLE "student_class_assignments"
    ADD CONSTRAINT "student_class_assignments_class_school_fk"
    FOREIGN KEY ("school_class_id","school_id")
    REFERENCES "school_classes"("id","school_id") NOT VALID;
  ALTER TABLE "student_class_assignments"
    VALIDATE CONSTRAINT "student_class_assignments_class_school_fk";
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_devices" (
  "id" serial PRIMARY KEY,
  "serial_number" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "device_type" text NOT NULL,
  "school_id" integer REFERENCES "schools"("id"),
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_devices_type_check" CHECK ("device_type" IN ('NFC','BIOMETRIC','HYBRID')),
  CONSTRAINT "platform_devices_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE','MAINTENANCE'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_devices_school_idx" ON "platform_devices" ("school_id","status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_notifications" (
  "id" serial PRIMARY KEY,
  "recipient_user_id" integer REFERENCES "app_users"("id"),
  "title" text NOT NULL,
  "message" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_notifications_severity_check" CHECK ("severity" IN ('info','warning','critical'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_notifications_recipient_idx"
  ON "platform_notifications" ("recipient_user_id","is_read","created_at");