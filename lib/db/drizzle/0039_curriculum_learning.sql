-- Additive Development prerequisite for the curriculum library and weekly lesson notes.
-- This file deliberately does not modify any existing table, constraint, index, or FK.

CREATE TABLE curriculum_versions (
  id serial PRIMARY KEY,
  title text NOT NULL,
  education_level text NOT NULL,
  class_levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind text NOT NULL,
  source_organization text NOT NULL,
  source_reference text NOT NULL,
  source_version text,
  effective_date date,
  verified_date date,
  description text,
  source_document_path text,
  derived_from_version_id integer REFERENCES curriculum_versions(id),
  status text NOT NULL DEFAULT 'DRAFT',
  created_by integer NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT curriculum_versions_id_unique UNIQUE (id),
  CONSTRAINT curriculum_versions_source_kind_check CHECK (source_kind IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')),
  CONSTRAINT curriculum_versions_status_check CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'))
);
CREATE INDEX curriculum_versions_status_idx ON curriculum_versions(status, education_level);

CREATE TABLE school_curriculum_assignments (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  curriculum_version_id integer NOT NULL REFERENCES curriculum_versions(id),
  school_class_id integer NOT NULL,
  subject_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  confirmed_by integer NOT NULL REFERENCES app_users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_curriculum_assignments_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT school_curriculum_assignments_class_school_fk FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id),
  CONSTRAINT school_curriculum_assignments_subject_school_fk FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id),
  CONSTRAINT school_curriculum_assignments_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id),
  CONSTRAINT school_curriculum_assignments_term_school_fk FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id),
  CONSTRAINT school_curriculum_assignments_status_check CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX school_curriculum_assignments_active_context_unique ON school_curriculum_assignments(
  school_id, school_class_id, subject_id, academic_session_id, academic_term_id
) WHERE status='ACTIVE';
CREATE INDEX school_curriculum_assignments_context_idx ON school_curriculum_assignments(school_id, academic_session_id, academic_term_id);

CREATE TABLE curriculum_topics (
  id serial PRIMARY KEY,
  curriculum_version_id integer,
  school_id integer,
  mapping_id integer,
  class_level text NOT NULL,
  subject_code text NOT NULL,
  parent_topic_id integer,
  title text NOT NULL,
  learning_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind text NOT NULL,
  sequence_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_topics_id_version_unique UNIQUE (id, curriculum_version_id),
  CONSTRAINT curriculum_topics_id_mapping_school_unique UNIQUE (id, mapping_id, school_id),
  CONSTRAINT curriculum_topics_version_fk FOREIGN KEY (curriculum_version_id) REFERENCES curriculum_versions(id),
  CONSTRAINT curriculum_topics_mapping_school_fk FOREIGN KEY (mapping_id, school_id) REFERENCES school_curriculum_assignments(id, school_id),
  CONSTRAINT curriculum_topics_source_check CHECK (source_kind IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')),
  CONSTRAINT curriculum_topics_origin_check CHECK (
    (curriculum_version_id IS NOT NULL AND mapping_id IS NULL AND school_id IS NULL)
    OR (curriculum_version_id IS NULL AND mapping_id IS NOT NULL AND school_id IS NOT NULL AND source_kind = 'SCHOOL_SPECIFIC')
  )
);
CREATE INDEX curriculum_topics_version_class_subject_idx ON curriculum_topics(curriculum_version_id, class_level, subject_code);
CREATE INDEX curriculum_topics_mapping_idx ON curriculum_topics(school_id, mapping_id);

CREATE TABLE curriculum_progress (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  mapping_id integer NOT NULL,
  topic_id integer NOT NULL,
  progress_status text NOT NULL,
  completed_date date,
  comment text,
  updated_by integer NOT NULL REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_progress_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT curriculum_progress_mapping_topic_unique UNIQUE (school_id, mapping_id, topic_id),
  CONSTRAINT curriculum_progress_mapping_school_fk FOREIGN KEY (mapping_id, school_id) REFERENCES school_curriculum_assignments(id, school_id),
  CONSTRAINT curriculum_progress_status_check CHECK (progress_status IN ('PLANNED','IN_PROGRESS','COMPLETED','DEFERRED'))
);
CREATE INDEX curriculum_progress_school_mapping_idx ON curriculum_progress(school_id, mapping_id);

CREATE TABLE curriculum_imports (
  id serial PRIMARY KEY,
  uploaded_by integer NOT NULL REFERENCES app_users(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  object_path text NOT NULL,
  detected_type text NOT NULL,
  preview_rows jsonb NOT NULL,
  headers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_version_id integer REFERENCES curriculum_versions(id),
  CONSTRAINT curriculum_imports_id_unique UNIQUE (id)
);
CREATE INDEX curriculum_imports_owner_created_idx ON curriculum_imports(uploaded_by, created_at);

CREATE TABLE lesson_notes (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  school_class_id integer NOT NULL,
  subject_id integer NOT NULL,
  teacher_employee_id integer NOT NULL,
  section text,
  week integer NOT NULL,
  lesson_date date NOT NULL,
  curriculum_mapping_id integer,
  curriculum_version_id integer REFERENCES curriculum_versions(id),
  topic_id integer,
  sub_topic_id integer,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  revision integer NOT NULL DEFAULT 0,
  created_by integer NOT NULL REFERENCES app_users(id),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_notes_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT lesson_notes_session_school_fk FOREIGN KEY (academic_session_id, school_id) REFERENCES academic_sessions(id, school_id),
  CONSTRAINT lesson_notes_term_school_fk FOREIGN KEY (academic_term_id, school_id) REFERENCES academic_terms(id, school_id),
  CONSTRAINT lesson_notes_class_school_fk FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id),
  CONSTRAINT lesson_notes_subject_school_fk FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id),
  CONSTRAINT lesson_notes_teacher_school_fk FOREIGN KEY (teacher_employee_id, school_id) REFERENCES employees(id, school_id),
  CONSTRAINT lesson_notes_mapping_school_fk FOREIGN KEY (curriculum_mapping_id, school_id) REFERENCES school_curriculum_assignments(id, school_id),
  CONSTRAINT lesson_notes_week_check CHECK (week BETWEEN 1 AND 60),
  CONSTRAINT lesson_notes_revision_check CHECK (revision >= 0),
  CONSTRAINT lesson_notes_status_check CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED','ARCHIVED'))
);
CREATE INDEX lesson_notes_weekly_idx ON lesson_notes(school_id, academic_session_id, academic_term_id, week, status);
CREATE INDEX lesson_notes_teacher_context_idx ON lesson_notes(school_id, teacher_employee_id, academic_session_id, academic_term_id);
CREATE UNIQUE INDEX lesson_notes_week_assignment_unique ON lesson_notes(
  school_id, academic_session_id, academic_term_id, teacher_employee_id, school_class_id, subject_id, week, COALESCE(section,'')
);

CREATE TABLE lesson_note_reviews (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  lesson_note_id integer NOT NULL,
  reviewer_user_id integer NOT NULL REFERENCES app_users(id),
  decision text NOT NULL,
  comment text,
  note_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_note_reviews_note_school_fk FOREIGN KEY (lesson_note_id, school_id) REFERENCES lesson_notes(id, school_id),
  CONSTRAINT lesson_note_reviews_decision_check CHECK (decision IN ('RETURN','APPROVE')),
  CONSTRAINT lesson_note_reviews_return_comment_check CHECK (decision <> 'RETURN' OR length(btrim(coalesce(comment,''))) > 0)
);
CREATE INDEX lesson_note_reviews_note_history_idx ON lesson_note_reviews(school_id, lesson_note_id, created_at);