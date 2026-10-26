-- REVIEW-ONLY rollback. Never discard onboarding, provider, audit or release evidence.
-- Run only on an independently verified target, before any onboarding use.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE flutterwave_live_school_onboarding_releases,
  flutterwave_live_school_onboarding,
  flutterwave_live_school_onboarding_audits IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM flutterwave_live_school_onboarding_releases)
    OR EXISTS (SELECT 1 FROM flutterwave_live_school_onboarding)
    OR EXISTS (SELECT 1 FROM flutterwave_live_school_onboarding_audits) THEN
    RAISE EXCEPTION 'LIVE onboarding evidence retained: rollback requires an independently reviewed preservation plan';
  END IF;
END $$;
DROP TABLE flutterwave_live_school_onboarding_audits;
DROP TABLE flutterwave_live_school_onboarding;
DROP TABLE flutterwave_live_school_onboarding_releases;
DROP FUNCTION live_school_onboarding_no_audit_mutation();
DROP FUNCTION live_school_onboarding_audit_fn();
DROP FUNCTION live_school_onboarding_history_fn();
COMMIT;
