-- Additive application review storage. Apply only with explicit target approval.
BEGIN;
CREATE TABLE account_applications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES app_users(id),
  applicant_type text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  school_name text,
  business_name text,
  city text NOT NULL,
  state text NOT NULL,
  address text,
  referral_link_id integer REFERENCES partner_referral_links(id),
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by integer REFERENCES app_users(id),
  rejection_reason text,
  school_id integer REFERENCES schools(id),
  partner_profile_id integer REFERENCES partner_profiles(id),
  notification_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  CONSTRAINT account_applications_type_check CHECK (applicant_type IN ('SCHOOL_ADMIN','PARTNER')),
  CONSTRAINT account_applications_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT account_applications_notification_check CHECK (notification_status IN ('NOT_REQUESTED','SENDING','ACCEPTED','FAILED','UNKNOWN','UNAVAILABLE')),
  CONSTRAINT account_applications_school_name_check CHECK (applicant_type<>'SCHOOL_ADMIN' OR length(btrim(school_name))>=2 AND school_name IS NOT NULL),
  CONSTRAINT account_applications_decision_check CHECK (
    (status='PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND rejection_reason IS NULL AND school_id IS NULL AND partner_profile_id IS NULL)
    OR (status='REJECTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason))>0 AND school_id IS NULL AND partner_profile_id IS NULL)
    OR (status='APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND rejection_reason IS NULL AND
      ((applicant_type='SCHOOL_ADMIN' AND school_id IS NOT NULL AND partner_profile_id IS NULL)
       OR (applicant_type='PARTNER' AND partner_profile_id IS NOT NULL AND school_id IS NULL)))
  )
);
CREATE UNIQUE INDEX account_applications_user_unique ON account_applications(user_id);
CREATE UNIQUE INDEX account_applications_email_unique ON account_applications(lower(email));
CREATE INDEX account_applications_status_created_idx ON account_applications(status,created_at);
COMMIT;
