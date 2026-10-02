-- Additive admissions foundation. Existing schools receive closed-by-default portals;
-- future schools receive one in the same transaction as their school row.
CREATE UNIQUE INDEX IF NOT EXISTS parents_id_school_unique
  ON public.parents (id, school_id);

CREATE TABLE public.admission_portal_settings (
  school_id integer PRIMARY KEY REFERENCES public.schools(id) ON DELETE RESTRICT,
  portal_key text NOT NULL,
  is_open boolean NOT NULL DEFAULT false,
  academic_session_id integer,
  academic_term_id integer,
  deadline date,
  fee_info text,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  instructions text,
  entrance_examination text,
  interview_information text,
  public_description text,
  public_address text,
  public_phone text,
  public_email text,
  logo_object_path text,
  updated_by_user_id integer REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_portal_settings_slug_check
    CHECK (portal_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  CONSTRAINT admission_portal_settings_phone_check
    CHECK (public_phone IS NULL OR public_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT admission_portal_settings_requirements_array_check
    CHECK (jsonb_typeof(requirements) = 'array'),
  CONSTRAINT admission_portal_settings_documents_array_check
    CHECK (jsonb_typeof(required_documents) = 'array'),
  CONSTRAINT admission_portal_settings_session_school_fk
    FOREIGN KEY (academic_session_id, school_id)
    REFERENCES public.academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_portal_settings_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES public.academic_terms(id, school_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX admission_portal_settings_portal_key_unique
  ON public.admission_portal_settings(portal_key);

CREATE FUNCTION public.admission_default_portal_key(p_school_id integer, p_registration text, p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT left(
    coalesce(
      nullif(trim(both '-' from regexp_replace(lower(coalesce(nullif(trim(p_registration), ''), nullif(trim(p_code), ''), '')), '[^a-z0-9]+', '-', 'g')), ''),
      'school'
    ),
    60
  ) || '-' || p_school_id::text
$$;

INSERT INTO public.admission_portal_settings (school_id, portal_key, is_open)
SELECT s.id, public.admission_default_portal_key(s.id, s.registration_number, s.code), false
FROM public.schools s
ON CONFLICT (school_id) DO NOTHING;

CREATE FUNCTION public.admission_create_school_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.admission_portal_settings (school_id, portal_key, is_open)
  VALUES (NEW.id, public.admission_default_portal_key(NEW.id, NEW.registration_number, NEW.code), false)
  ON CONFLICT (school_id) DO NOTHING;
  INSERT INTO public.admission_application_counters (school_id, current_value)
  VALUES (NEW.id, 0)
  ON CONFLICT (school_id) DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TABLE public.admission_portal_classes (
  school_id integer NOT NULL,
  class_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_portal_classes_pk PRIMARY KEY (school_id, class_id),
  CONSTRAINT admission_portal_classes_settings_school_fk
    FOREIGN KEY (school_id) REFERENCES public.admission_portal_settings(school_id) ON DELETE CASCADE,
  CONSTRAINT admission_portal_classes_class_school_fk
    FOREIGN KEY (class_id, school_id) REFERENCES public.school_classes(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX admission_portal_classes_class_school_idx
  ON public.admission_portal_classes(class_id, school_id);

CREATE TABLE public.admission_application_counters (
  school_id integer PRIMARY KEY REFERENCES public.schools(id) ON DELETE RESTRICT,
  current_value integer NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.admission_application_counters (school_id, current_value)
SELECT id, 0 FROM public.schools
ON CONFLICT (school_id) DO NOTHING;

CREATE TABLE public.admission_applications (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  application_number text NOT NULL,
  status text NOT NULL DEFAULT 'Submitted',
  source text NOT NULL,
  applicant_first_name text NOT NULL,
  applicant_middle_name text,
  applicant_last_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL,
  photo_object_path text,
  previous_school text,
  previous_class text,
  intended_class_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer,
  applicant_address text,
  guardian_name text NOT NULL,
  guardian_phone text NOT NULL,
  guardian_email text,
  guardian_relationship text,
  guardian_address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  receipt_secret_hash text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  assessment jsonb,
  interview jsonb,
  internal_notes text,
  public_message text,
  converted_student_id integer,
  converted_parent_id integer,
  created_by_user_id integer REFERENCES public.app_users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_applications_id_school_tenant_key UNIQUE (id, school_id),
  CONSTRAINT admission_applications_school_number_unique UNIQUE (school_id, application_number),
  CONSTRAINT admission_applications_status_check CHECK (status IN
    ('Draft','Submitted','UnderReview','Shortlisted','InterviewScheduled','AssessmentPending',
     'AssessmentCompleted','Accepted','Waitlisted','Rejected','Withdrawn','Enrolled')),
  CONSTRAINT admission_applications_source_check CHECK (source IN ('PUBLIC','STAFF')),
  CONSTRAINT admission_applications_gender_check CHECK (gender IN ('Female','Male','Other','PreferNotToSay')),
  CONSTRAINT admission_applications_phone_check CHECK (guardian_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT admission_applications_emergency_phone_check
    CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT admission_applications_emergency_contact_pair_check
    CHECK ((emergency_contact_name IS NULL) = (emergency_contact_phone IS NULL)),
  CONSTRAINT admission_applications_receipt_hash_check
    CHECK (receipt_secret_hash IS NULL OR receipt_secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admission_applications_payload_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admission_applications_idempotency_key_check
    CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  CONSTRAINT admission_applications_photo_path_check
    CHECK (photo_object_path IS NULL OR photo_object_path ~ '^/objects/admissions/'),
  CONSTRAINT admission_applications_version_check CHECK (version >= 1),
  CONSTRAINT admission_applications_class_school_fk
    FOREIGN KEY (intended_class_id, school_id)
    REFERENCES public.school_classes(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_applications_session_school_fk
    FOREIGN KEY (academic_session_id, school_id)
    REFERENCES public.academic_sessions(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_applications_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES public.academic_terms(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_applications_student_school_fk
    FOREIGN KEY (converted_student_id, school_id)
    REFERENCES public.students(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_applications_parent_school_fk
    FOREIGN KEY (converted_parent_id, school_id)
    REFERENCES public.parents(id, school_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX admission_applications_idempotency_key_unique
  ON public.admission_applications(school_id, idempotency_key);
CREATE UNIQUE INDEX admission_applications_student_unique
  ON public.admission_applications(school_id, converted_student_id)
  WHERE converted_student_id IS NOT NULL;
CREATE INDEX admission_applications_school_status_created_idx
  ON public.admission_applications(school_id, status, created_at DESC);
CREATE INDEX admission_applications_school_name_idx
  ON public.admission_applications(school_id, applicant_last_name, applicant_first_name);
CREATE INDEX admission_applications_guardian_phone_idx
  ON public.admission_applications(school_id, guardian_phone);

CREATE TABLE public.admission_application_documents (
  id serial PRIMARY KEY,
  school_id integer NOT NULL,
  application_id integer NOT NULL,
  document_type text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  object_path text NOT NULL,
  created_by_user_id integer REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_application_documents_application_school_fk
    FOREIGN KEY (application_id, school_id)
    REFERENCES public.admission_applications(id, school_id) ON DELETE RESTRICT,
  CONSTRAINT admission_application_documents_content_type_check
    CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  CONSTRAINT admission_application_documents_size_check CHECK (byte_size BETWEEN 1 AND 10485760),
  CONSTRAINT admission_application_documents_object_path_check CHECK (
    object_path ~ '^/objects/admissions/(intake/[a-z0-9][a-z0-9-]{2,79}|[1-9][0-9]*/[1-9][0-9]*)/(photo-)?[0-9a-f-]{36}$'
  ),
  CONSTRAINT admission_application_documents_object_path_unique UNIQUE (object_path)
);
CREATE INDEX admission_application_documents_app_school_idx
  ON public.admission_application_documents(application_id, school_id);

CREATE TABLE public.admission_request_rate_limits (
  bucket_hash text PRIMARY KEY,
  bucket_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admission_request_rate_limits_started_idx
  ON public.admission_request_rate_limits(bucket_started_at);

CREATE TRIGGER schools_admission_portal_defaults_after_insert
AFTER INSERT ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.admission_create_school_defaults();