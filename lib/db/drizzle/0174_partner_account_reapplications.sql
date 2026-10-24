-- No existing identity, membership, application or profile is rewritten.
ALTER TABLE app_users ALTER COLUMN clerk_user_id DROP NOT NULL;
CREATE TABLE partner_account_reapplications (
 id serial PRIMARY KEY,
 new_user_id integer NOT NULL REFERENCES app_users(id),
 clerk_user_id text NOT NULL,
 email text NOT NULL CHECK(email=lower(btrim(email))),
 initial_session_id text NOT NULL,
 previous_user_ids integer[] NOT NULL,
 previous_partner_ids integer[] NOT NULL,
 archive_batch_ids text[] NOT NULL,
 request_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_reapplications_user_unique ON partner_account_reapplications(new_user_id);
CREATE UNIQUE INDEX partner_reapplications_initial_session_unique ON partner_account_reapplications(initial_session_id);
CREATE INDEX partner_reapplications_subject_idx ON partner_account_reapplications(clerk_user_id,id);
CREATE TABLE partner_reapplication_sessions (
 session_id text PRIMARY KEY,
 reapplication_id integer NOT NULL REFERENCES partner_account_reapplications(id),
 clerk_user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_applications ADD COLUMN reapplication_id integer REFERENCES partner_account_reapplications(id);
ALTER TABLE account_applications ADD CONSTRAINT account_applications_reapplication_partner_check
 CHECK(reapplication_id IS NULL OR applicant_type='PARTNER');
CREATE UNIQUE INDEX account_applications_reapplication_unique ON account_applications(reapplication_id);
DROP INDEX account_applications_email_unique;
CREATE UNIQUE INDEX account_applications_email_unique ON account_applications(lower(email)) WHERE reapplication_id IS NULL;
