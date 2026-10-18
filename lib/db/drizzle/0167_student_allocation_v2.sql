-- Reviewed code migration only: do not execute against Production automatically.
-- Legacy frozen splits keep their reference-selected amounts; no row is rewritten.
BEGIN;
ALTER TABLE flutterwave_split_payments DROP CONSTRAINT flw_split_amounts_ck;
ALTER TABLE flutterwave_split_payments ADD CONSTRAINT flw_split_amounts_ck CHECK (
  currency='NGN'
  AND school_amount_minor=CASE WHEN left(reference,5)='SCV2_' THEN 190000 ELSE 200000 END
  AND (
    (partner_recipient_id IS NULL AND partner_profile_id IS NULL AND attribution_id IS NULL
     AND commission_rule_id IS NULL AND partner_amount_minor=0 AND platform_amount_minor=500000-school_amount_minor)
    OR
    (partner_recipient_id IS NOT NULL AND partner_profile_id IS NOT NULL AND attribution_id IS NOT NULL
     AND commission_rule_id IS NOT NULL AND partner_amount_minor=10000 AND platform_amount_minor=490000-school_amount_minor)
  )
);
ALTER TABLE flutterwave_split_settlements DROP CONSTRAINT flw_settlement_amount_ck;
ALTER TABLE flutterwave_split_settlements ADD CONSTRAINT flw_settlement_amount_ck
  CHECK (expected_amount_minor IN (190000,200000,10000) AND (observed_amount_minor IS NULL OR observed_amount_minor>=0));
COMMIT;
