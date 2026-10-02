-- Core campus security is an additive identity-event layer. It reuses the
-- existing NFC, person, device, attendance, audit and communication records.
CREATE TABLE IF NOT EXISTS security_locations (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  description text,
  zone_type text NOT NULL DEFAULT 'OTHER',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id integer REFERENCES app_users(id),
  updated_by_user_id integer REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_locations_zone_type_check CHECK (zone_type IN ('GATE','CAMPUS','BUILDING','OTHER')),
  CONSTRAINT security_locations_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT security_locations_name_unique UNIQUE (school_id,name),
  CONSTRAINT security_locations_id_school_unique UNIQUE (id,school_id)
);
CREATE INDEX IF NOT EXISTS security_locations_school_status_idx
  ON security_locations(school_id,status,name);

-- Reader rows bind an existing configured platform device to a security
-- location; they do not create device credentials or assert physical unlocking.
CREATE TABLE IF NOT EXISTS security_readers (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  location_id integer NOT NULL,
  device_id integer NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  permissions text[] NOT NULL DEFAULT ARRAY['ENTRY','EXIT']::text[],
  created_by_user_id integer REFERENCES app_users(id),
  updated_by_user_id integer REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_readers_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT security_readers_permissions_check CHECK (
    cardinality(permissions) > 0 AND permissions <@ ARRAY['ENTRY','EXIT']::text[]
  ),
  CONSTRAINT security_readers_device_school_unique UNIQUE (school_id,device_id),
  CONSTRAINT security_readers_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT security_readers_location_school_fk
    FOREIGN KEY (location_id,school_id) REFERENCES security_locations(id,school_id),
  CONSTRAINT security_readers_device_school_fk
    FOREIGN KEY (device_id,school_id) REFERENCES device_school_bindings(device_id,school_id)
);
CREATE INDEX IF NOT EXISTS security_readers_school_status_idx
  ON security_readers(school_id,status,location_id);

-- School Admin grants are explicit, revocable and expiry-bounded. There is no
-- global "security staff" role and a Platform Owner grant never authorizes writes.
CREATE TABLE IF NOT EXISTS security_staff_grants (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  user_id integer NOT NULL REFERENCES app_users(id),
  permissions text[] NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz,
  granted_by_user_id integer NOT NULL REFERENCES app_users(id),
  revoked_by_user_id integer REFERENCES app_users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_staff_grants_permissions_check CHECK (
    cardinality(permissions) > 0 AND permissions <@ ARRAY[
      'READ','MANAGE_READERS','MANAGE_CARDS','REVIEW_PRESENCE',
      'SECURITY_READ','SECURITY_MANAGE','VISITOR_MANAGE','PICKUP_APPROVE',
      'INCIDENT_MANAGE','EMERGENCY_BROADCAST','COMMUNICATION_SEND'
    ]::text[]
  ),
  CONSTRAINT security_staff_grants_status_check CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  CONSTRAINT security_staff_grants_revocation_shape_check CHECK (
    (status='ACTIVE' AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (status IN ('REVOKED','EXPIRED') AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT security_staff_grants_id_school_unique UNIQUE (id,school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS security_staff_grants_one_active_unique
  ON security_staff_grants(school_id,user_id)
  WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS security_staff_grants_user_idx
  ON security_staff_grants(user_id,school_id,status);

CREATE TABLE IF NOT EXISTS security_school_settings (
  school_id integer PRIMARY KEY REFERENCES schools(id),
  security_enabled boolean NOT NULL DEFAULT true,
  parent_entry_alerts boolean NOT NULL DEFAULT true,
  parent_exit_alerts boolean NOT NULL DEFAULT true,
  updated_by_user_id integer REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_events (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  reader_id integer,
  location_id integer,
  device_id integer NOT NULL,
  attendance_event_id integer,
  nfc_card_id integer,
  student_id integer,
  employee_id integer,
  person_type text NOT NULL,
  person_name_snapshot text,
  admission_number_snapshot text,
  employee_number_snapshot text,
  class_name_snapshot text,
  section_snapshot text,
  location_name_snapshot text,
  reader_name_snapshot text,
  event_type text NOT NULL,
  identity_result text NOT NULL,
  reason_code text,
  card_uid_sha256 text,
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'SYNCED',
  physical_control_status text NOT NULL DEFAULT 'NOT_CONNECTED',
  actor_user_id integer REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_events_person_type_check CHECK (person_type IN ('STUDENT','STAFF','UNKNOWN')),
  CONSTRAINT security_events_type_check CHECK (event_type IN ('ENTRY','EXIT')),
  CONSTRAINT security_events_identity_result_check CHECK (identity_result IN ('CONFIRMED','REJECTED')),
  CONSTRAINT security_events_reason_code_check CHECK (reason_code IS NULL OR reason_code IN (
    'UNKNOWN_CARD','WRONG_SCHOOL','LOST_CARD','REVOKED_CARD','EXPIRED_CARD',
    'INACTIVE_CARD','NOT_ASSIGNED','INACTIVE_PERSON','NO_CURRENT_PLACEMENT',
    'STAFF_BILLING_INELIGIBLE','READER_INACTIVE','READER_PERMISSION_DENIED',
    'SECURITY_DISABLED','IDENTITY_MISMATCH','OTHER'
  )),
  CONSTRAINT security_events_sync_status_check CHECK (sync_status IN ('SYNCED')),
  CONSTRAINT security_events_physical_control_check CHECK (physical_control_status='NOT_CONNECTED'),
  CONSTRAINT security_events_card_hash_check CHECK (card_uid_sha256 IS NULL OR card_uid_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT security_events_event_key_check CHECK (length(event_key) BETWEEN 1 AND 256),
  CONSTRAINT security_events_person_shape_check CHECK (
    (person_type='STUDENT' AND student_id IS NOT NULL AND employee_id IS NULL)
    OR (person_type='STAFF' AND employee_id IS NOT NULL AND student_id IS NULL)
    OR (person_type='UNKNOWN' AND student_id IS NULL AND employee_id IS NULL)
  ),
  CONSTRAINT security_events_outcome_reason_check CHECK (
    (identity_result='CONFIRMED' AND reason_code IS NULL AND person_type<>'UNKNOWN')
    OR (identity_result='REJECTED' AND reason_code IS NOT NULL)
  ),
  CONSTRAINT security_events_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT security_events_device_key_unique UNIQUE (school_id,device_id,event_key),
  CONSTRAINT security_events_reader_school_fk
    FOREIGN KEY (reader_id,school_id) REFERENCES security_readers(id,school_id),
  CONSTRAINT security_events_location_school_fk
    FOREIGN KEY (location_id,school_id) REFERENCES security_locations(id,school_id),
  CONSTRAINT security_events_device_school_fk
    FOREIGN KEY (device_id,school_id) REFERENCES device_school_bindings(device_id,school_id),
  CONSTRAINT security_events_attendance_school_fk
    FOREIGN KEY (attendance_event_id,school_id) REFERENCES attendance_events(id,school_id),
  CONSTRAINT security_events_card_school_fk
    FOREIGN KEY (nfc_card_id,school_id) REFERENCES nfc_cards(id,school_id),
  CONSTRAINT security_events_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id),
  CONSTRAINT security_events_employee_school_fk
    FOREIGN KEY (employee_id,school_id) REFERENCES employees(id,school_id)
);
CREATE INDEX IF NOT EXISTS security_events_school_time_idx
  ON security_events(school_id,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS security_events_school_result_time_idx
  ON security_events(school_id,identity_result,occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_events_student_time_idx
  ON security_events(school_id,student_id,occurred_at DESC)
  WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS security_events_employee_time_idx
  ON security_events(school_id,employee_id,occurred_at DESC)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS security_events_card_hash_idx
  ON security_events(school_id,card_uid_sha256,occurred_at DESC)
  WHERE card_uid_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS campus_presence (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  person_type text NOT NULL,
  student_id integer,
  employee_id integer,
  state text NOT NULL,
  last_security_event_id bigint NOT NULL,
  last_occurred_at timestamptz NOT NULL,
  review_reason text,
  resolved_by_user_id integer REFERENCES app_users(id),
  resolution_reason text,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campus_presence_person_type_check CHECK (person_type IN ('STUDENT','STAFF')),
  CONSTRAINT campus_presence_state_check CHECK (state IN ('ON_CAMPUS','OFF_CAMPUS','REQUIRES_REVIEW')),
  CONSTRAINT campus_presence_person_shape_check CHECK (
    (person_type='STUDENT' AND student_id IS NOT NULL AND employee_id IS NULL)
    OR (person_type='STAFF' AND employee_id IS NOT NULL AND student_id IS NULL)
  ),
  CONSTRAINT campus_presence_id_school_unique UNIQUE (id,school_id),
  CONSTRAINT campus_presence_event_school_fk
    FOREIGN KEY (last_security_event_id,school_id) REFERENCES security_events(id,school_id),
  CONSTRAINT campus_presence_student_school_fk
    FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id),
  CONSTRAINT campus_presence_employee_school_fk
    FOREIGN KEY (employee_id,school_id) REFERENCES employees(id,school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_presence_student_unique
  ON campus_presence(school_id,student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campus_presence_employee_unique
  ON campus_presence(school_id,employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campus_presence_dashboard_idx
  ON campus_presence(school_id,state,person_type,last_occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_security_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security events are immutable';
END;
$$;
DROP TRIGGER IF EXISTS security_events_immutable ON security_events;
CREATE TRIGGER security_events_immutable
  BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION prevent_security_event_mutation();