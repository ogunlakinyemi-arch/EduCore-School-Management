-- REVIEW-ONLY rollback; never erase retained intent or financial evidence.
BEGIN;
LOCK TABLE flutterwave_live_subscription_intents, flutterwave_live_collection_evidence,
  flutterwave_live_finalization_events, flutterwave_live_receipt_results,
  flutterwave_live_partner_accruals IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM flutterwave_live_subscription_intents)
    OR EXISTS (SELECT 1 FROM flutterwave_live_finalization_events)
    OR EXISTS (SELECT 1 FROM flutterwave_live_receipt_results) THEN
    RAISE EXCEPTION 'LIVE finalization history retained: preservation review required';
  END IF;
END $$;
DROP TABLE flutterwave_live_partner_accruals;
DROP TABLE flutterwave_live_receipt_results;
DROP TABLE flutterwave_live_finalization_events;
DROP TABLE flutterwave_live_collection_evidence;
DROP TABLE flutterwave_live_subscription_intents;
DROP FUNCTION guard_flutterwave_live_accrual();
DROP FUNCTION retain_flutterwave_live_history();
DROP FUNCTION guard_flutterwave_live_intent();
COMMIT;
