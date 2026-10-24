-- REVIEW ONLY: refuse rollback once any LIVE runtime records exist.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM flutterwave_live_checkout_attempts)
 OR EXISTS(SELECT 1 FROM flutterwave_live_allocation_reviews)
 OR EXISTS(SELECT 1 FROM flutterwave_live_school_configuration)
 OR EXISTS(SELECT 1 FROM flutterwave_live_release_manifests)
 THEN RAISE EXCEPTION 'Preserve populated LIVE runtime history; rollback refused'; END IF;
END $$;
DROP TABLE flutterwave_live_allocation_reviews,flutterwave_live_checkout_attempts,
 flutterwave_live_school_configuration,flutterwave_live_release_manifests;
DROP FUNCTION guard_live_checkout_attempt();
COMMIT;
