-- Promotion batches are review snapshots, not placement mutations. Finalization is
-- performed by the API in one transaction and preserves source assignments.
CREATE TABLE IF NOT EXISTS promotion_batches (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  source_session_id integer NOT NULL,
  target_session_id integer NOT NULL,
  status text NOT NULL DEFAULT 'PREPARED',
  idempotency_actor_user_id integer NOT NULL REFERENCES app_users(id),
  idempotency_key text NOT NULL,
  prepared_by integer NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by integer REFERENCES app_users(id),
  finalized_at timestamptz,
  finalization_actor_user_id integer REFERENCES app_users(id),
  finalization_idempotency_key text,
  CONSTRAINT promotion_batches_status_check CHECK (status IN ('PREPARED', 'FINALIZED')),
  CONSTRAINT promotion_batches_distinct_sessions_check CHECK (source_session_id <> target_session_id),
  CONSTRAINT promotion_batches_finalization_shape_check CHECK (
    (status = 'PREPARED' AND finalized_by IS NULL AND finalized_at IS NULL
      AND finalization_actor_user_id IS NULL AND finalization_idempotency_key IS NULL)
    OR (status = 'FINALIZED' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL
      AND finalization_actor_user_id IS NOT NULL AND finalization_idempotency_key IS NOT NULL)
  ),
  CONSTRAINT promotion_batches_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT promotion_batches_session_pair_unique UNIQUE (school_id, source_session_id, target_session_id),
  CONSTRAINT promotion_batches_idempotency_unique UNIQUE (school_id, idempotency_actor_user_id, idempotency_key),
  CONSTRAINT promotion_batches_finalization_idempotency_unique UNIQUE
    (school_id, finalization_actor_user_id, finalization_idempotency_key),
  CONSTRAINT promotion_batches_source_session_school_fk
    FOREIGN KEY (source_session_id, school_id) REFERENCES academic_sessions(id, school_id),
  CONSTRAINT promotion_batches_target_session_school_fk
    FOREIGN KEY (target_session_id, school_id) REFERENCES academic_sessions(id, school_id)
);

CREATE INDEX IF NOT EXISTS promotion_batches_school_created_idx
  ON promotion_batches (school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS promotion_batch_students (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  batch_id integer NOT NULL,
  student_id integer NOT NULL,
  student_name_snapshot text NOT NULL,
  admission_no_snapshot text NOT NULL,
  source_assignment_id integer NOT NULL,
  source_session_id integer NOT NULL,
  source_term_id integer,
  source_class_id integer NOT NULL,
  source_class_name text NOT NULL,
  source_section text NOT NULL,
  recommendation text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  reason text,
  academic_performance jsonb NOT NULL,
  attendance_summary jsonb NOT NULL,
  target_term_id integer,
  target_class_id integer,
  target_section text,
  reviewed_by integer REFERENCES app_users(id),
  reviewed_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_batch_students_status_check
    CHECK (status IN ('Pending', 'Eligible', 'Promoted', 'Repeat', 'Graduated', 'Withdrawn', 'Transferred')),
  CONSTRAINT promotion_batch_students_recommendation_check
    CHECK (recommendation IN ('Pending', 'Eligible')),
  CONSTRAINT promotion_batch_students_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT promotion_batch_students_batch_student_unique UNIQUE (batch_id, student_id),
  CONSTRAINT promotion_batch_students_batch_school_fk
    FOREIGN KEY (batch_id, school_id) REFERENCES promotion_batches(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT promotion_batch_students_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT promotion_batch_students_assignment_school_fk
    FOREIGN KEY (source_assignment_id, school_id) REFERENCES student_class_assignments(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT promotion_batch_students_source_session_school_fk
    FOREIGN KEY (source_session_id, school_id) REFERENCES academic_sessions(id, school_id),
  CONSTRAINT promotion_batch_students_source_term_school_fk
    FOREIGN KEY (source_term_id, school_id) REFERENCES academic_terms(id, school_id),
  CONSTRAINT promotion_batch_students_source_class_school_fk
    FOREIGN KEY (source_class_id, school_id) REFERENCES school_classes(id, school_id),
  CONSTRAINT promotion_batch_students_target_term_school_fk
    FOREIGN KEY (target_term_id, school_id) REFERENCES academic_terms(id, school_id),
  CONSTRAINT promotion_batch_students_target_class_school_fk
    FOREIGN KEY (target_class_id, school_id) REFERENCES school_classes(id, school_id),
  CONSTRAINT promotion_batch_students_target_required_check CHECK (
    (status IN ('Promoted', 'Repeat') AND target_term_id IS NOT NULL AND target_class_id IS NOT NULL
      AND target_section IS NOT NULL AND length(btrim(target_section)) > 0)
    OR (status NOT IN ('Promoted', 'Repeat') AND target_term_id IS NULL AND target_class_id IS NULL
      AND target_section IS NULL)
  ),
  CONSTRAINT promotion_batch_students_review_shape_check CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS promotion_batch_students_batch_status_idx
  ON promotion_batch_students (batch_id, status);
CREATE INDEX IF NOT EXISTS promotion_batch_students_student_idx
  ON promotion_batch_students (school_id, student_id, created_at DESC);

-- Durable append-only record for review and outcome history, including rejected/
-- stale attempts. It never changes student identity or NFC card records.
CREATE TABLE IF NOT EXISTS promotion_history (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  batch_id integer,
  batch_student_id integer,
  student_id integer,
  actor_user_id integer REFERENCES app_users(id),
  event_type text NOT NULL,
  result text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_history_event_check CHECK (event_type IN (
    'BATCH_PREPARED', 'STUDENT_SNAPSHOTTED', 'STUDENT_REVIEWED', 'STUDENT_FINALIZED', 'BATCH_FINALIZED', 'FINALIZATION_REJECTED'
  )),
  CONSTRAINT promotion_history_result_check CHECK (result IN ('SUCCESS', 'REJECTED')),
  CONSTRAINT promotion_history_batch_school_fk
    FOREIGN KEY (batch_id, school_id) REFERENCES promotion_batches(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT promotion_history_student_batch_school_fk
    FOREIGN KEY (batch_student_id, school_id) REFERENCES promotion_batch_students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT promotion_history_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS promotion_history_school_created_idx
  ON promotion_history (school_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS promotion_history_student_idx
  ON promotion_history (school_id, student_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_promotion_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'promotion history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS promotion_history_immutable ON promotion_history;
CREATE TRIGGER promotion_history_immutable
  BEFORE UPDATE OR DELETE ON promotion_history
  FOR EACH ROW EXECUTE FUNCTION prevent_promotion_history_mutation();