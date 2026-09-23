CREATE TABLE "academic_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"academic_session_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "parents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "lga" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "school_type" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "middle_name" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "photo" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "admission_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "admission_status" text DEFAULT 'ADMITTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_school" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "medical_info" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_term_school_fk" FOREIGN KEY ("academic_term_id","school_id") REFERENCES "public"."academic_terms"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class_assignments" ADD CONSTRAINT "student_class_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_school_class_id_school_classes_id_fk" FOREIGN KEY ("school_class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_employee_school_fk" FOREIGN KEY ("employee_id","school_id") REFERENCES "public"."employees"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_session_school_fk" FOREIGN KEY ("academic_session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_class_school_fk" FOREIGN KEY ("school_class_id","school_id") REFERENCES "public"."school_classes"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments" ADD CONSTRAINT "teacher_class_assignments_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_school_name_unique" ON "academic_sessions" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_id_school_unique" ON "academic_sessions" USING btree ("id","school_id");--> statement-breakpoint
CREATE INDEX "academic_sessions_school_status_idx" ON "academic_sessions" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_session_name_unique" ON "academic_terms" USING btree ("academic_session_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_id_school_unique" ON "academic_terms" USING btree ("id","school_id");--> statement-breakpoint
CREATE INDEX "academic_terms_school_status_idx" ON "academic_terms" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "class_subjects_unique" ON "class_subjects" USING btree ("school_class_id","subject_id","academic_session_id",coalesce("academic_term_id", 0),coalesce("section", '')) WHERE "class_subjects"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "class_subjects_school_status_idx" ON "class_subjects" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_school_employee_no_unique" ON "employees" USING btree ("school_id","employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_id_school_unique" ON "employees" USING btree ("id","school_id");--> statement-breakpoint
CREATE INDEX "employees_school_type_status_idx" ON "employees" USING btree ("school_id","employee_type","employment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "student_class_assignments_active_unique" ON "student_class_assignments" USING btree ("student_id","academic_session_id",coalesce("academic_term_id", 0),"school_class_id","section") WHERE "student_class_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "student_class_assignments_id_school_unique" ON "student_class_assignments" USING btree ("id","school_id");--> statement-breakpoint
CREATE INDEX "student_class_assignments_school_current_idx" ON "student_class_assignments" USING btree ("school_id","is_current");--> statement-breakpoint
CREATE INDEX "student_class_assignments_student_history_idx" ON "student_class_assignments" USING btree ("student_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_school_code_unique" ON "subjects" USING btree ("school_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_id_school_unique" ON "subjects" USING btree ("id","school_id");--> statement-breakpoint
CREATE INDEX "subjects_school_status_idx" ON "subjects" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_class_assignments_unique" ON "teacher_class_assignments" USING btree ("employee_id","academic_session_id","school_class_id","section","assignment_type",coalesce("subject_id", 0)) WHERE "teacher_class_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "teacher_class_assignments_school_status_idx" ON "teacher_class_assignments" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "school_classes_id_school_unique" ON "school_classes" USING btree ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_id_school_unique" ON "students" USING btree ("id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_class_assignments_current_unique" ON "student_class_assignments" ("student_id") WHERE "is_current" = true;--> statement-breakpoint
INSERT INTO "academic_sessions" ("school_id", "name", "start_date", "end_date", "status", "is_current")
SELECT "id", 'LEGACY', CURRENT_DATE, CURRENT_DATE, 'COMPLETED', false
FROM "schools"
ON CONFLICT ("school_id", "name") DO NOTHING;--> statement-breakpoint
INSERT INTO "student_class_assignments"
  ("school_id", "student_id", "academic_session_id", "school_class_id", "section",
   "status", "is_current", "start_date")
SELECT st."school_id", st."id", s."id", sc."id", st."section",
       CASE WHEN upper(st."status") = 'ACTIVE' THEN 'ACTIVE' ELSE upper(st."status") END,
       upper(st."status") = 'ACTIVE', st."joined_at"::date
FROM "students" st
JOIN "school_classes" sc ON sc."school_id" = st."school_id"
  AND sc."name" = st."class_name" AND sc."section" = st."section"
JOIN "academic_sessions" s ON s."school_id" = st."school_id" AND s."name" = 'LEGACY'
WHERE NOT EXISTS (
  SELECT 1 FROM "student_class_assignments" a
  WHERE a."student_id" = st."id" AND a."academic_session_id" = s."id"
);