-- REVIEW DRAFT ONLY. Never auto-run against an application/shared database.
-- Dependency: existing settlement_payroll_profiles and canonical school/user tables.
BEGIN;
CREATE TABLE flutterwave_live_school_onboarding_releases(
 release_id text NOT NULL CHECK(release_id='SCV3_SCHOOL_ONBOARDING_V1'),
 merchant_scope text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 schema_version integer NOT NULL CHECK(schema_version=1),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_by integer NOT NULL REFERENCES app_users(id),
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(release_id,merchant_scope)
);
CREATE TABLE flutterwave_live_school_onboarding(
 id serial PRIMARY KEY,
 environment text NOT NULL DEFAULT 'LIVE' CHECK(environment='LIVE'),
 merchant_scope text NOT NULL,
 school_id integer NOT NULL REFERENCES schools(id),
 profile_id integer NOT NULL REFERENCES settlement_payroll_profiles(id),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot_ciphertext text NOT NULL,
 encryption_key_version text NOT NULL,
 bank_fingerprint text NOT NULL,
 account_last4 text NOT NULL CHECK(account_last4 ~ '^[0-9]{4}$'),
 submitted_by integer NOT NULL REFERENCES app_users(id),
 last_actor_id integer NOT NULL REFERENCES app_users(id),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN
  ('SUBMITTED','BANK_VERIFIED','ACTION_REQUIRED','STALE','REJECTED','CREATING','CREATION_UNKNOWN','LIVE_VERIFIED')),
 bank_verified_at timestamptz,
 approved_by integer REFERENCES app_users(id),
 approval_evidence jsonb,
 creation_claimed_at timestamptz,
 provider_id bigint,
 provider_subaccount_id text CHECK(provider_subaccount_id IS NULL OR provider_subaccount_id ~ '^RS_[A-Za-z0-9]{12,80}$'),
 error_code text,
 provider_http_status integer CHECK(provider_http_status BETWEEN 100 AND 599),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_scope,school_id,snapshot_sha256),
 CHECK((creation_claimed_at IS NULL AND status NOT IN('CREATING','CREATION_UNKNOWN','LIVE_VERIFIED'))
   OR (creation_claimed_at IS NOT NULL AND approved_by IS NOT NULL AND approval_evidence IS NOT NULL)),
 CHECK(status<>'LIVE_VERIFIED' OR(provider_id IS NOT NULL AND provider_subaccount_id IS NOT NULL))
);
CREATE UNIQUE INDEX live_school_onboarding_active_school ON flutterwave_live_school_onboarding(merchant_scope,school_id)
 WHERE status NOT IN('STALE','REJECTED');
CREATE UNIQUE INDEX live_school_onboarding_active_bank ON flutterwave_live_school_onboarding(merchant_scope,bank_fingerprint)
 WHERE status NOT IN('STALE','REJECTED');
CREATE UNIQUE INDEX live_school_onboarding_provider_id ON flutterwave_live_school_onboarding(merchant_scope,provider_id) WHERE provider_id IS NOT NULL;
CREATE UNIQUE INDEX live_school_onboarding_provider_ref ON flutterwave_live_school_onboarding(merchant_scope,provider_subaccount_id) WHERE provider_subaccount_id IS NOT NULL;
CREATE TABLE flutterwave_live_school_onboarding_audits(
 id serial PRIMARY KEY,
 onboarding_id integer NOT NULL REFERENCES flutterwave_live_school_onboarding(id),
 school_id integer NOT NULL REFERENCES schools(id),
 merchant_scope text NOT NULL,
 previous_status text,
 status text NOT NULL,
 approved_by integer,
 actor_id integer NOT NULL,
 provider_id bigint,
 provider_subaccount_id text,
 error_code text,
 provider_http_status integer,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION live_school_onboarding_history_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve LIVE onboarding history'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.environment,NEW.merchant_scope,NEW.school_id,NEW.profile_id,NEW.snapshot_sha256,
    NEW.snapshot_ciphertext,NEW.encryption_key_version,NEW.bank_fingerprint,NEW.account_last4,NEW.submitted_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.environment,OLD.merchant_scope,OLD.school_id,OLD.profile_id,OLD.snapshot_sha256,
    OLD.snapshot_ciphertext,OLD.encryption_key_version,OLD.bank_fingerprint,OLD.account_last4,OLD.submitted_by,OLD.created_at)
   THEN RAISE EXCEPTION 'LIVE school snapshot is immutable'; END IF;
  IF OLD.creation_claimed_at IS NOT NULL AND
   ROW(NEW.creation_claimed_at,NEW.approved_by,NEW.approval_evidence) IS DISTINCT FROM
   ROW(OLD.creation_claimed_at,OLD.approved_by,OLD.approval_evidence)
   THEN RAISE EXCEPTION 'Never reset a LIVE creation claim'; END IF;
  IF (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
   OR (OLD.provider_subaccount_id IS NOT NULL AND NEW.provider_subaccount_id IS DISTINCT FROM OLD.provider_subaccount_id)
   THEN RAISE EXCEPTION 'Preserve provider identity'; END IF;
  IF (OLD.status IN('CREATING','CREATION_UNKNOWN') AND NEW.status NOT IN('CREATING','CREATION_UNKNOWN','LIVE_VERIFIED'))
   OR(OLD.status IN('LIVE_VERIFIED','STALE','REJECTED') AND NEW.status<>OLD.status)
   THEN RAISE EXCEPTION 'Invalid LIVE onboarding transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER live_school_onboarding_history BEFORE UPDATE OR DELETE ON flutterwave_live_school_onboarding
 FOR EACH ROW EXECUTE FUNCTION live_school_onboarding_history_fn();
CREATE FUNCTION live_school_onboarding_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO flutterwave_live_school_onboarding_audits(onboarding_id,school_id,merchant_scope,previous_status,status,
  approved_by,actor_id,provider_id,provider_subaccount_id,error_code,provider_http_status)
 VALUES(NEW.id,NEW.school_id,NEW.merchant_scope,CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status,
  NEW.approved_by,NEW.last_actor_id,NEW.provider_id,NEW.provider_subaccount_id,NEW.error_code,NEW.provider_http_status);
 RETURN NEW;
END $$;
CREATE TRIGGER live_school_onboarding_audit AFTER INSERT OR UPDATE ON flutterwave_live_school_onboarding
 FOR EACH ROW EXECUTE FUNCTION live_school_onboarding_audit_fn();
CREATE FUNCTION live_school_onboarding_no_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Preserve LIVE onboarding audit history'; END $$;
CREATE TRIGGER live_school_onboarding_audit_history BEFORE UPDATE OR DELETE ON flutterwave_live_school_onboarding_audits
 FOR EACH ROW EXECUTE FUNCTION live_school_onboarding_no_audit_mutation();
-- Deliberately no enabled release row, backfill, TEST conversion or checkout change.
COMMIT;
