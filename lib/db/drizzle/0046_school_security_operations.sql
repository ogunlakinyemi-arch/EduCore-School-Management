-- Visitor, authorized-pickup, pickup-request, and security-incident operations.
-- Campus locations/readers/security events remain owned by the security-core migration.
CREATE TABLE IF NOT EXISTS school_security_visitors (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  visitor_name text NOT NULL,
  phone text,
  id_reference text,
  purpose text NOT NULL,
  host_name text,
  host_student_id integer,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  checkout_idempotency_key text,
  status text NOT NULL DEFAULT 'ON_SITE',
  notes text,
  security_officer_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  security_location_id integer,
  security_device_id integer,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_security_visitors_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT school_security_visitors_checkout_key_unique UNIQUE (school_id,checkout_idempotency_key),
  CONSTRAINT school_security_visitors_host_student_school_fk
    FOREIGN KEY (host_student_id,school_id) REFERENCES students(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_visitors_location_school_fk
    FOREIGN KEY (security_location_id,school_id) REFERENCES security_locations(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_visitors_device_school_fk
    FOREIGN KEY (security_device_id,school_id) REFERENCES device_school_bindings(device_id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_visitors_name_check CHECK (length(btrim(visitor_name)) BETWEEN 1 AND 160),
  CONSTRAINT school_security_visitors_purpose_check CHECK (length(btrim(purpose)) BETWEEN 1 AND 1000),
  CONSTRAINT school_security_visitors_status_check CHECK (status IN ('ON_SITE','CHECKED_OUT')),
  CONSTRAINT school_security_visitors_checkout_shape_check CHECK (
    (status='ON_SITE' AND checked_out_at IS NULL AND checkout_idempotency_key IS NULL)
    OR (status='CHECKED_OUT' AND checked_out_at IS NOT NULL AND checkout_idempotency_key IS NOT NULL)
  ),
  CONSTRAINT school_security_visitors_version_check CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS school_security_visitors_school_status_date_idx
  ON school_security_visitors (school_id,status,checked_in_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS school_authorized_pickup_persons (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  nominated_by_parent_id integer NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  phone text NOT NULL,
  relationship text,
  identity_reference text,
  status text NOT NULL DEFAULT 'PENDING',
  valid_from timestamptz,
  valid_until timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision_by_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  decision_reason text,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_pickup_person_id_school_student_unique UNIQUE (id,school_id,student_id),
  CONSTRAINT school_pickup_person_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_pickup_person_name_check CHECK (length(btrim(full_name)) BETWEEN 1 AND 160),
  CONSTRAINT school_pickup_person_phone_check CHECK (length(btrim(phone)) BETWEEN 3 AND 40),
  CONSTRAINT school_pickup_person_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
  CONSTRAINT school_pickup_person_decision_shape_check CHECK (
    (status='PENDING' AND decision_by_user_id IS NULL AND decided_at IS NULL)
    OR (status<>'PENDING' AND decision_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT school_pickup_person_validity_check CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until>valid_from
  ),
  CONSTRAINT school_pickup_person_version_check CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS school_pickup_person_student_status_idx
  ON school_authorized_pickup_persons (school_id,student_id,status,id);

CREATE TABLE IF NOT EXISTS school_pickup_requests (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  requested_by_parent_id integer NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
  pickup_person_id integer NOT NULL,
  requested_pickup_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'PENDING',
  decision_by_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  decision_reason text,
  decided_at timestamptz,
  completed_at timestamptz,
  completed_by_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  completion_pickup_person_id integer,
  recorded_security_event_id bigint,
  completion_idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_pickup_requests_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT school_pickup_requests_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_pickup_requests_person_school_student_fk
    FOREIGN KEY (pickup_person_id,school_id,student_id)
    REFERENCES school_authorized_pickup_persons(id,school_id,student_id) ON DELETE RESTRICT,
  CONSTRAINT school_pickup_requests_completion_person_school_student_fk
    FOREIGN KEY (completion_pickup_person_id,school_id,student_id)
    REFERENCES school_authorized_pickup_persons(id,school_id,student_id) ON DELETE RESTRICT,
  CONSTRAINT school_pickup_requests_security_event_school_fk
    FOREIGN KEY (recorded_security_event_id,school_id) REFERENCES security_events(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_pickup_requests_school_exit_event_unique UNIQUE (school_id,recorded_security_event_id),
  CONSTRAINT school_pickup_requests_completion_key_unique UNIQUE (school_id,completion_idempotency_key),
  CONSTRAINT school_pickup_requests_status_check
    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','REFUSED','COMPLETED')),
  CONSTRAINT school_pickup_requests_validity_check CHECK (valid_until>valid_from),
  CONSTRAINT school_pickup_requests_completion_shape_check CHECK (
    (status='COMPLETED' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL
      AND completion_pickup_person_id IS NOT NULL AND recorded_security_event_id IS NOT NULL
      AND completion_idempotency_key IS NOT NULL)
    OR (status<>'COMPLETED' AND completed_at IS NULL AND completed_by_user_id IS NULL
      AND completion_pickup_person_id IS NULL AND recorded_security_event_id IS NULL
      AND completion_idempotency_key IS NULL)
  ),
  CONSTRAINT school_pickup_requests_version_check CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS school_pickup_requests_school_student_status_idx
  ON school_pickup_requests (school_id,student_id,status,requested_pickup_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS school_pickup_requests_parent_idx
  ON school_pickup_requests (requested_by_parent_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS school_security_incidents (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  incident_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  security_location_id integer,
  security_device_id integer,
  student_id integer,
  involved_persons jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_staff_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'LOW',
  status text NOT NULL DEFAULT 'OPEN',
  resolution text,
  created_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_security_incidents_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT school_security_incidents_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_incidents_location_school_fk
    FOREIGN KEY (security_location_id,school_id) REFERENCES security_locations(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_incidents_device_school_fk
    FOREIGN KEY (security_device_id,school_id) REFERENCES device_school_bindings(device_id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_incidents_type_check CHECK (
    incident_type IN ('UNAUTHORIZED_ACCESS','LOST_CARD','VISITOR_ISSUE','STUDENT_RELEASE','GATE_INCIDENT','SECURITY_CONCERN','OTHER')
  ),
  CONSTRAINT school_security_incidents_severity_check CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
  CONSTRAINT school_security_incidents_status_check CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED')),
  CONSTRAINT school_security_incidents_involved_persons_check CHECK (jsonb_typeof(involved_persons)='array'),
  CONSTRAINT school_security_incidents_resolution_shape_check CHECK (
    status<>'RESOLVED' OR (resolution IS NOT NULL AND length(btrim(resolution))>0)
  ),
  CONSTRAINT school_security_incidents_version_check CHECK (version>0)
);
CREATE INDEX IF NOT EXISTS school_security_incidents_school_status_date_idx
  ON school_security_incidents (school_id,status,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS school_security_incident_attachments (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  incident_id integer NOT NULL,
  object_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_UPLOAD',
  uploaded_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  upload_expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_security_incident_attachments_id_scope_unique UNIQUE (id,school_id,incident_id),
  CONSTRAINT school_security_incident_attachments_school_object_unique UNIQUE (school_id,object_path),
  CONSTRAINT school_security_incident_attachments_incident_school_fk
    FOREIGN KEY (incident_id,school_id) REFERENCES school_security_incidents(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_incident_attachments_type_check
    CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  CONSTRAINT school_security_incident_attachments_size_check CHECK (byte_size BETWEEN 1 AND 10485760),
  CONSTRAINT school_security_incident_attachments_status_shape_check
    CHECK ((status='PENDING_UPLOAD' AND confirmed_at IS NULL) OR (status='CONFIRMED' AND confirmed_at IS NOT NULL)),
  CONSTRAINT school_security_incident_attachments_path_check
    CHECK (object_path ~ '^/objects/school-security/[1-9][0-9]*/[1-9][0-9]*/[0-9a-fA-F-]{36}$'),
  CONSTRAINT school_security_incident_attachments_name_check
    CHECK (length(btrim(file_name)) BETWEEN 1 AND 255)
);
CREATE INDEX IF NOT EXISTS school_security_incident_attachments_scope_status_idx
  ON school_security_incident_attachments (school_id,incident_id,status);

CREATE TABLE IF NOT EXISTS school_security_operation_history (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  revision integer NOT NULL,
  event_type text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  result text NOT NULL DEFAULT 'SUCCESS',
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_security_operation_history_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id) ON DELETE RESTRICT,
  CONSTRAINT school_security_operation_history_entity_check
    CHECK (entity_type IN ('VISITOR','PICKUP_PERSON','PICKUP_REQUEST','INCIDENT')),
  CONSTRAINT school_security_operation_history_result_check CHECK (result IN ('SUCCESS','REJECTED')),
  CONSTRAINT school_security_operation_history_revision_check CHECK (revision>0),
  CONSTRAINT school_security_operation_history_revision_unique UNIQUE (entity_type,entity_id,revision)
);
CREATE INDEX IF NOT EXISTS school_security_operation_history_school_created_idx
  ON school_security_operation_history (school_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS school_security_operation_history_student_idx
  ON school_security_operation_history (school_id,student_id,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_school_security_operation_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'school security operation history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS school_security_operation_history_immutable ON school_security_operation_history;
CREATE TRIGGER school_security_operation_history_immutable
  BEFORE UPDATE OR DELETE ON school_security_operation_history
  FOR EACH ROW EXECUTE FUNCTION prevent_school_security_operation_history_mutation();