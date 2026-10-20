-- REVIEW-ONLY rollback: refuse to destroy any retained delivery evidence.
BEGIN;
LOCK TABLE flutterwave_live_webhook_receipts IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM flutterwave_live_webhook_receipts) THEN
    RAISE EXCEPTION 'LIVE webhook receipts retained: rollback requires an independently reviewed preservation plan';
  END IF;
END $$;
DROP TABLE flutterwave_live_webhook_receipts;
COMMIT;
