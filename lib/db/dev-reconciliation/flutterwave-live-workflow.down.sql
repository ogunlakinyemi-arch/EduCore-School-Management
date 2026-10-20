-- Empty-only rollback. Retained business evidence requires preservation review.
BEGIN;
LOCK TABLE flutterwave_live_subscription_intents,flutterwave_live_authority_reviews,
 flutterwave_live_subscription_activations,flutterwave_live_official_receipts,
 flutterwave_live_commission_batches,flutterwave_live_commission_items,
 flutterwave_live_workflow_audits,flutterwave_live_reconciliation_cases IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM flutterwave_live_subscription_intents)
 OR EXISTS(SELECT 1 FROM flutterwave_live_authority_reviews)
 OR EXISTS(SELECT 1 FROM flutterwave_live_reconciliation_cases) THEN
 RAISE EXCEPTION 'LIVE workflow evidence retained: preservation review required'; END IF;
END $$;
DROP TRIGGER live_hold_invalidates_export ON flutterwave_live_partner_accruals;
DROP FUNCTION hold_live_workflow();
DROP TABLE flutterwave_live_workflow_audits,flutterwave_live_commission_items;
DROP TABLE flutterwave_live_commission_batches;
DROP TABLE flutterwave_live_official_receipts,flutterwave_live_subscription_activations;
DROP TABLE flutterwave_live_reconciliation_cases;
ALTER TABLE flutterwave_live_subscription_intents DROP CONSTRAINT live_issued_snapshot_ck;
DROP INDEX live_intent_issuer_key_uq;
ALTER TABLE flutterwave_live_subscription_intents DROP COLUMN issued_by,DROP COLUMN issuer_key,
 DROP COLUMN authority_review_id,DROP COLUMN authority_snapshot;
DROP TABLE flutterwave_live_authority_reviews;
DROP FUNCTION guard_live_workflow_state();
COMMIT;
