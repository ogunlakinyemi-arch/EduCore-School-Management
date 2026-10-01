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
  CONSTRAINT "school_calendar_events_source_check"
    CHECK ("source" IN ('GENERATED', 'SCHOOL_EVENT')),
  CONSTRAINT "school_calendar_events_category_check"
    CHECK ("category" IN ('RESUMPTION','MID_TERM_BREAK','HOLIDAY','EXAMINATION','RESULT_PUBLICATION','SCHOOL_EVENT','OTHER')),
  CONSTRAINT "school_calendar_events_status_check"
    CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "school_calendar_events_dates_check"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "school_calendar_events_audience_check"
    CHECK (cardinality("audience") > 0 AND "audience" <@ ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[]),
  CONSTRAINT "school_calendar_events_id_school_tenant_key"
    UNIQUE ("id", "school_id")
);
--> statement-breakpoint
ALTER TABLE "school_calendar_events"
  ADD CONSTRAINT "school_calendar_events_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "school_calendar_events"
  ADD CONSTRAINT "school_calendar_events_session_school_fk"
  FOREIGN KEY ("academic_session_id", "school_id")
  REFERENCES "public"."academic_sessions"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "school_calendar_events"
  ADD CONSTRAINT "school_calendar_events_term_school_fk"
  FOREIGN KEY ("academic_term_id", "school_id")
  REFERENCES "public"."academic_terms"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "school_calendar_events"
  ADD CONSTRAINT "school_calendar_events_created_by_user_id_app_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "school_calendar_events"
  ADD CONSTRAINT "school_calendar_events_updated_by_user_id_app_users_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "school_calendar_events_school_source_key_unique"
  ON "school_calendar_events" USING btree ("school_id", "source_key");
--> statement-breakpoint
CREATE INDEX "school_calendar_events_school_dates_status_idx"
  ON "school_calendar_events" USING btree ("school_id", "start_date", "status");
--> statement-breakpoint
CREATE INDEX "school_calendar_events_school_session_term_idx"
  ON "school_calendar_events" USING btree ("school_id", "academic_session_id", "academic_term_id");
--> statement-breakpoint
CREATE TABLE "school_branding_logos" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL,
  "object_path" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "is_current" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "school_branding_logos_content_type_check"
    CHECK ("content_type" IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT "school_branding_logos_byte_size_check"
    CHECK ("byte_size" BETWEEN 1 AND 3145728)
);
--> statement-breakpoint
ALTER TABLE "school_branding_logos"
  ADD CONSTRAINT "school_branding_logos_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "school_branding_logos"
  ADD CONSTRAINT "school_branding_logos_updated_by_user_id_app_users_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "school_branding_logos_school_current_unique"
  ON "school_branding_logos" USING btree ("school_id")
  WHERE "is_current" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "school_branding_logos_object_path_unique"
  ON "school_branding_logos" USING btree ("object_path");
--> statement-breakpoint
CREATE INDEX "school_branding_logos_school_versions_idx"
  ON "school_branding_logos" USING btree ("school_id", "id");
--> statement-breakpoint
CREATE INDEX "school_branding_logos_updated_by_idx"
  ON "school_branding_logos" USING btree ("updated_by_user_id", "updated_at");
--> statement-breakpoint
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
  CONSTRAINT "teacher_subject_assignments_dates_check"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "teacher_subject_assignments_status_check"
    CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "teacher_subject_assignments_id_school_tenant_key"
    UNIQUE ("id", "school_id")
);
--> statement-breakpoint
ALTER TABLE "teacher_subject_assignments"
  ADD CONSTRAINT "teacher_subject_assignments_employee_school_fk"
  FOREIGN KEY ("employee_id", "school_id")
  REFERENCES "public"."employees"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_subject_assignments"
  ADD CONSTRAINT "teacher_subject_assignments_subject_school_fk"
  FOREIGN KEY ("subject_id", "school_id")
  REFERENCES "public"."subjects"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_subject_assignments"
  ADD CONSTRAINT "teacher_subject_assignments_session_school_fk"
  FOREIGN KEY ("academic_session_id", "school_id")
  REFERENCES "public"."academic_sessions"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_subject_assignments"
  ADD CONSTRAINT "teacher_subject_assignments_created_by_user_id_app_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_subject_assignments"
  ADD CONSTRAINT "teacher_subject_assignments_updated_by_user_id_app_users_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_subject_assignments_active_unique"
  ON "teacher_subject_assignments" USING btree ("school_id", "employee_id", "subject_id", "academic_session_id")
  WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "teacher_subject_assignments_school_session_status_idx"
  ON "teacher_subject_assignments" USING btree ("school_id", "academic_session_id", "status");
--> statement-breakpoint
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
  CONSTRAINT "teacher_duty_roster_dates_check"
    CHECK ("end_date" >= "start_date"),
  CONSTRAINT "teacher_duty_roster_status_check"
    CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "teacher_duty_roster_id_school_tenant_key"
    UNIQUE ("id", "school_id")
);
--> statement-breakpoint
ALTER TABLE "teacher_duty_roster"
  ADD CONSTRAINT "teacher_duty_roster_school_id_schools_id_fk"
  FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_duty_roster"
  ADD CONSTRAINT "teacher_duty_roster_employee_school_fk"
  FOREIGN KEY ("employee_id", "school_id")
  REFERENCES "public"."employees"("id", "school_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_duty_roster"
  ADD CONSTRAINT "teacher_duty_roster_created_by_user_id_app_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "teacher_duty_roster"
  ADD CONSTRAINT "teacher_duty_roster_updated_by_user_id_app_users_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_duty_roster_employee_exact_active_unique"
  ON "teacher_duty_roster" USING btree ("school_id", "employee_id", "start_date", "end_date")
  WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "teacher_duty_roster_school_dates_status_idx"
  ON "teacher_duty_roster" USING btree ("school_id", "start_date", "end_date", "status");
--> statement-breakpoint
CREATE INDEX "teacher_duty_roster_employee_history_idx"
  ON "teacher_duty_roster" USING btree ("school_id", "employee_id", "start_date");