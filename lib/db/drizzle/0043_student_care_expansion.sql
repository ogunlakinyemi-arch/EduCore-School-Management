-- Additive student medical, welfare, behaviour, grants, immutable revisions,
-- and idempotent request records. This migration never modifies student identity.
CREATE TABLE student_medical_profiles (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  blood_group text,
  genotype text,
  allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  support_needs jsonb NOT NULL DEFAULT '[]'::jsonb,
  medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  emergency_medical_notes text,
  provider_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  emergency_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT student_medical_profiles_student_school_unique UNIQUE (student_id, school_id),
  CONSTRAINT student_medical_profiles_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT student_medical_profiles_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_medical_profiles_allergies_array CHECK (jsonb_typeof(allergies) = 'array'),
  CONSTRAINT student_medical_profiles_conditions_array CHECK (jsonb_typeof(conditions) = 'array'),
  CONSTRAINT student_medical_profiles_support_array CHECK (jsonb_typeof(support_needs) = 'array'),
  CONSTRAINT student_medical_profiles_medications_array CHECK (jsonb_typeof(medications) = 'array'),
  CONSTRAINT student_medical_profiles_providers_array CHECK (jsonb_typeof(provider_contacts) = 'array'),
  CONSTRAINT student_medical_profiles_contacts_array CHECK (jsonb_typeof(emergency_contacts) = 'array')
);
CREATE INDEX student_medical_profiles_school_student_idx
  ON student_medical_profiles(school_id, student_id);

CREATE TABLE student_medical_visits (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  symptoms text,
  observations text,
  action_taken text,
  treatment text,
  referral text,
  follow_up_at timestamptz,
  follow_up_notes text,
  notes text,
  recorded_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT student_medical_visits_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT student_medical_visits_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX student_medical_visits_school_student_date_idx
  ON student_medical_visits(school_id, student_id, occurred_at DESC);

CREATE TABLE student_welfare_records (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  category text NOT NULL CHECK (category IN (
    'WELFARE_CONCERN','COUNSELLING_REFERRAL','SAFEGUARDING','FAMILY_SUPPORT','LEARNING_SUPPORT'
  )),
  concern text NOT NULL CHECK (length(btrim(concern)) > 0),
  assigned_staff_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  follow_up_at timestamptz,
  follow_up_status text NOT NULL DEFAULT 'PENDING'
    CHECK (follow_up_status IN ('NOT_REQUIRED','PENDING','IN_PROGRESS','COMPLETE')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  resolution text,
  internal_notes text,
  parent_visible boolean NOT NULL DEFAULT false,
  created_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT student_welfare_records_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT student_welfare_records_safeguarding_private_check
    CHECK (category <> 'SAFEGUARDING' OR parent_visible=FALSE),
  CONSTRAINT student_welfare_records_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX student_welfare_records_school_student_category_idx
  ON student_welfare_records(school_id, student_id, category);
CREATE INDEX student_welfare_records_assigned_followup_idx
  ON student_welfare_records(school_id, assigned_staff_user_id, follow_up_at);

CREATE TABLE student_behaviour_configurations (
  school_id integer PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT,
  categories jsonb NOT NULL DEFAULT '["POSITIVE","CONCERN","INCIDENT","RULE_VIOLATION","RECOGNITION"]'::jsonb
    CHECK (jsonb_typeof(categories) = 'array'),
  actions jsonb NOT NULL DEFAULT '["Verbal warning","Written warning","Detention","Counselling","Parent meeting","Behaviour agreement","Suspension"]'::jsonb
    CHECK (jsonb_typeof(actions) = 'array'),
  updated_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_behaviour_records (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  school_class_id integer,
  subject_id integer,
  category text NOT NULL
    CHECK (category IN ('POSITIVE','CONCERN','INCIDENT','RULE_VIOLATION','RECOGNITION')),
  severity text NOT NULL CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  location text,
  reporter_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  action text,
  parent_notification_status text NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (parent_notification_status IN ('NOT_REQUESTED','QUEUED','PARTIAL','NOT_CONFIGURED','FAILED')),
  parent_notification_id integer REFERENCES communication_notifications(id) ON DELETE RESTRICT,
  follow_up_at timestamptz,
  follow_up_notes text,
  status text NOT NULL DEFAULT 'REVIEW'
    CHECK (status IN ('REVIEW','ACTION','PARENT_NOTIFICATION','FOLLOW_UP','RESOLVED')),
  resolution text,
  internal_notes text,
  parent_visible boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT student_behaviour_records_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT student_behaviour_records_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_behaviour_records_class_school_fk
    FOREIGN KEY (school_class_id, school_id) REFERENCES school_classes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_behaviour_records_subject_school_fk
    FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX student_behaviour_records_school_student_date_idx
  ON student_behaviour_records(school_id, student_id, occurred_at DESC);
CREATE INDEX student_behaviour_records_followup_idx
  ON student_behaviour_records(school_id, status, follow_up_at);

CREATE TABLE student_care_grants (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  permissions text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  granted_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_care_grants_school_user_unique UNIQUE (school_id, user_id),
  CONSTRAINT student_care_grants_id_school_unique UNIQUE (id, school_id),
  CONSTRAINT student_care_grants_permissions_check CHECK (
    permissions <@ ARRAY[
      'MEDICAL_READ','MEDICAL_WRITE','WELFARE_READ','WELFARE_WRITE',
      'SAFEGUARDING_READ','SAFEGUARDING_WRITE','BEHAVIOUR_READ','BEHAVIOUR_WRITE',
      'BEHAVIOUR_REVIEW','BEHAVIOUR_ACTION'
    ]::text[]
  )
);
CREATE INDEX student_care_grants_user_active_idx ON student_care_grants(user_id, active);

CREATE TABLE student_care_record_history (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  record_type text NOT NULL CHECK (record_type IN (
    'MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR','BEHAVIOUR_CONFIGURATION'
  )),
  record_id integer NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  changed_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_care_history_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_care_history_record_revision_unique UNIQUE (record_type, record_id, revision)
);
CREATE INDEX student_care_history_school_student_idx
  ON student_care_record_history(school_id, student_id, changed_at DESC);

CREATE TABLE student_care_idempotency (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  resource_type text NOT NULL CHECK (resource_type IN ('MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR')),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  resource_id integer NOT NULL,
  response_revision integer NOT NULL DEFAULT 1 CHECK (response_revision > 0),
  created_by_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_care_idempotency_student_school_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT student_care_idempotency_scope_key_unique
    UNIQUE (school_id, student_id, resource_type, request_key, created_by_user_id)
);
CREATE INDEX student_care_idempotency_resource_idx
  ON student_care_idempotency(resource_type, resource_id);