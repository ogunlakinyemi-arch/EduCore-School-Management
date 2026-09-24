CREATE TABLE "academic_assignments" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "academic_session_id" integer NOT NULL,
  "academic_term_id" integer NOT NULL,
  "school_class_id" integer NOT NULL,
  "section" text,
  "subject_id" integer NOT NULL,
  "teacher_employee_id" integer NOT NULL,
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "title" text NOT NULL,
  "description" text NOT NULL,
  "issue_date" date NOT NULL,
  "due_date" date NOT NULL,
  "max_score" numeric(10, 2) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_assignments_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_assignments_session_school_fk"
    FOREIGN KEY ("academic_session_id", "school_id")
    REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "academic_assignments_term_school_fk"
    FOREIGN KEY ("academic_term_id", "school_id")
    REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "academic_assignments_class_school_fk"
    FOREIGN KEY ("school_class_id", "school_id")
    REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "academic_assignments_subject_school_fk"
    FOREIGN KEY ("subject_id", "school_id")
    REFERENCES "subjects"("id", "school_id"),
  CONSTRAINT "academic_assignments_teacher_school_fk"
    FOREIGN KEY ("teacher_employee_id", "school_id")
    REFERENCES "employees"("id", "school_id"),
  CONSTRAINT "academic_assignments_max_score_check" CHECK ("max_score" > 0),
  CONSTRAINT "academic_assignments_dates_check" CHECK ("due_date" >= "issue_date"),
  CONSTRAINT "academic_assignments_status_check"
    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'))
);
CREATE INDEX "academic_assignments_school_context_idx"
  ON "academic_assignments" ("school_id", "academic_session_id", "academic_term_id", "school_class_id");

CREATE TABLE "academic_assessment_types" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "name" text NOT NULL,
  "code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "academic_assessment_types_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_assessment_types_school_code_unique" UNIQUE ("school_id", "code"),
  CONSTRAINT "academic_assessment_types_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
CREATE INDEX "academic_assessment_types_school_status_idx"
  ON "academic_assessment_types" ("school_id", "status");

CREATE TABLE "academic_assessments" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "academic_session_id" integer NOT NULL,
  "academic_term_id" integer NOT NULL,
  "school_class_id" integer NOT NULL,
  "section" text,
  "subject_id" integer NOT NULL,
  "assessment_type_id" integer NOT NULL,
  "teacher_employee_id" integer NOT NULL,
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "title" text NOT NULL,
  "description" text NOT NULL,
  "assessment_date" date NOT NULL,
  "max_score" numeric(10, 2) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_assessments_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_assessments_session_school_fk"
    FOREIGN KEY ("academic_session_id", "school_id")
    REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "academic_assessments_term_school_fk"
    FOREIGN KEY ("academic_term_id", "school_id")
    REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "academic_assessments_class_school_fk"
    FOREIGN KEY ("school_class_id", "school_id")
    REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "academic_assessments_subject_school_fk"
    FOREIGN KEY ("subject_id", "school_id")
    REFERENCES "subjects"("id", "school_id"),
  CONSTRAINT "academic_assessments_type_school_fk"
    FOREIGN KEY ("assessment_type_id", "school_id")
    REFERENCES "academic_assessment_types"("id", "school_id"),
  CONSTRAINT "academic_assessments_teacher_school_fk"
    FOREIGN KEY ("teacher_employee_id", "school_id")
    REFERENCES "employees"("id", "school_id"),
  CONSTRAINT "academic_assessments_max_score_check" CHECK ("max_score" > 0),
  CONSTRAINT "academic_assessments_status_check"
    CHECK ("status" IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'ARCHIVED'))
);
CREATE INDEX "academic_assessments_school_context_idx"
  ON "academic_assessments" ("school_id", "academic_session_id", "academic_term_id", "school_class_id");

CREATE TABLE "academic_grading_rules" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "min_score" numeric(10, 2) NOT NULL,
  "max_score" numeric(10, 2) NOT NULL,
  "grade" text NOT NULL,
  "grade_point" numeric(5, 2),
  "remark" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_grading_rules_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_grading_rules_score_range_check"
    CHECK ("min_score" >= 0 AND "max_score" >= "min_score"),
  CONSTRAINT "academic_grading_rules_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);
CREATE INDEX "academic_grading_rules_school_status_idx"
  ON "academic_grading_rules" ("school_id", "status");

CREATE TABLE "academic_results" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
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
  "status" text NOT NULL DEFAULT 'DRAFT',
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "published_by" integer REFERENCES "app_users"("id"),
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_results_assessment_student_unique" UNIQUE ("assessment_id", "student_id"),
  CONSTRAINT "academic_results_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_results_assessment_school_fk"
    FOREIGN KEY ("assessment_id", "school_id")
    REFERENCES "academic_assessments"("id", "school_id"),
  CONSTRAINT "academic_results_student_school_fk"
    FOREIGN KEY ("student_id", "school_id")
    REFERENCES "students"("id", "school_id"),
  CONSTRAINT "academic_results_class_assignment_school_fk"
    FOREIGN KEY ("student_class_assignment_id", "school_id")
    REFERENCES "student_class_assignments"("id", "school_id"),
  CONSTRAINT "academic_results_teacher_school_fk"
    FOREIGN KEY ("teacher_employee_id", "school_id")
    REFERENCES "employees"("id", "school_id"),
  CONSTRAINT "academic_results_session_school_fk"
    FOREIGN KEY ("academic_session_id", "school_id")
    REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "academic_results_term_school_fk"
    FOREIGN KEY ("academic_term_id", "school_id")
    REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "academic_results_class_school_fk"
    FOREIGN KEY ("school_class_id", "school_id")
    REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "academic_results_subject_school_fk"
    FOREIGN KEY ("subject_id", "school_id")
    REFERENCES "subjects"("id", "school_id"),
  CONSTRAINT "academic_results_score_check"
    CHECK ("score" >= 0 AND "max_score" > 0 AND "score" <= "max_score"),
  CONSTRAINT "academic_results_status_check"
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT "academic_results_publication_check"
    CHECK (("status" = 'PUBLISHED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL)
      OR "status" <> 'PUBLISHED')
);
CREATE INDEX "academic_results_school_context_idx"
  ON "academic_results" ("school_id", "academic_session_id", "academic_term_id", "student_id");

CREATE TABLE "academic_report_cards" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer NOT NULL,
  "academic_session_id" integer NOT NULL,
  "academic_term_id" integer NOT NULL,
  "student_class_assignment_id" integer NOT NULL,
  "school_class_id" integer NOT NULL,
  "class_name_snapshot" text NOT NULL,
  "section_snapshot" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "teacher_remark" text NOT NULL,
  "school_remark" text NOT NULL,
  "published_by" integer REFERENCES "app_users"("id"),
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_report_cards_student_session_term_unique"
    UNIQUE ("student_id", "academic_session_id", "academic_term_id"),
  CONSTRAINT "academic_report_cards_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_report_cards_student_school_fk"
    FOREIGN KEY ("student_id", "school_id")
    REFERENCES "students"("id", "school_id"),
  CONSTRAINT "academic_report_cards_session_school_fk"
    FOREIGN KEY ("academic_session_id", "school_id")
    REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "academic_report_cards_term_school_fk"
    FOREIGN KEY ("academic_term_id", "school_id")
    REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "academic_report_cards_class_assignment_school_fk"
    FOREIGN KEY ("student_class_assignment_id", "school_id")
    REFERENCES "student_class_assignments"("id", "school_id"),
  CONSTRAINT "academic_report_cards_class_school_fk"
    FOREIGN KEY ("school_class_id", "school_id")
    REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "academic_report_cards_status_check"
    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT "academic_report_cards_publication_check"
    CHECK (("status" = 'PUBLISHED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL)
      OR "status" <> 'PUBLISHED')
);
CREATE INDEX "academic_report_cards_school_student_idx"
  ON "academic_report_cards" ("school_id", "student_id", "academic_session_id", "academic_term_id");

CREATE TABLE "academic_report_card_lines" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
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
  CONSTRAINT "academic_report_card_lines_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_report_card_lines_report_card_result_unique"
    UNIQUE ("report_card_id", "result_id"),
  CONSTRAINT "academic_report_card_lines_report_card_school_fk"
    FOREIGN KEY ("report_card_id", "school_id")
    REFERENCES "academic_report_cards"("id", "school_id"),
  CONSTRAINT "academic_report_card_lines_result_school_fk"
    FOREIGN KEY ("result_id", "school_id")
    REFERENCES "academic_results"("id", "school_id"),
  CONSTRAINT "academic_report_card_lines_subject_school_fk"
    FOREIGN KEY ("subject_id", "school_id")
    REFERENCES "subjects"("id", "school_id"),
  CONSTRAINT "academic_report_card_lines_score_check"
    CHECK ("score" >= 0 AND "max_score" > 0 AND "score" <= "max_score")
);
CREATE INDEX "academic_report_card_lines_report_card_idx"
  ON "academic_report_card_lines" ("school_id", "report_card_id");

CREATE TABLE "academic_timetable_entries" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
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
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_by" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "academic_timetable_entries_id_school_unique" UNIQUE ("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_session_school_fk"
    FOREIGN KEY ("academic_session_id", "school_id")
    REFERENCES "academic_sessions"("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_term_school_fk"
    FOREIGN KEY ("academic_term_id", "school_id")
    REFERENCES "academic_terms"("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_class_school_fk"
    FOREIGN KEY ("school_class_id", "school_id")
    REFERENCES "school_classes"("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_subject_school_fk"
    FOREIGN KEY ("subject_id", "school_id")
    REFERENCES "subjects"("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_teacher_school_fk"
    FOREIGN KEY ("teacher_employee_id", "school_id")
    REFERENCES "employees"("id", "school_id"),
  CONSTRAINT "academic_timetable_entries_weekday_check"
    CHECK ("weekday" IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')),
  CONSTRAINT "academic_timetable_entries_time_check" CHECK ("end_time" > "start_time"),
  CONSTRAINT "academic_timetable_entries_status_check"
    CHECK ("status" IN ('ACTIVE', 'CANCELLED', 'ARCHIVED'))
);
CREATE INDEX "academic_timetable_entries_school_context_idx"
  ON "academic_timetable_entries"
  ("school_id", "academic_session_id", "academic_term_id", "school_class_id", "section");