-- Prepared for review and isolated tests only; no shared database application.
-- Add/validate before dropping the old name. Existing amounts/references stay intact.
-- Any incompatible populated row aborts the transaction, retaining the old CHECK.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public.flutterwave_split_payments
  ADD CONSTRAINT flw_split_amounts_v3_ck CHECK (
    currency='NGN'
    AND school_amount_minor=CASE WHEN left(reference,5) IN ('SCV2_','SCV3_') THEN 190000 ELSE 200000 END
    AND (
      (partner_recipient_id IS NULL AND partner_profile_id IS NULL AND attribution_id IS NULL
        AND commission_rule_id IS NULL AND partner_amount_minor=0
        AND platform_amount_minor=500000-school_amount_minor)
      OR
      ((partner_recipient_id IS NOT NULL OR left(reference,5)='SCV3_')
        AND (left(reference,5)<>'SCV3_' OR partner_recipient_id IS NULL)
        AND partner_profile_id IS NOT NULL AND attribution_id IS NOT NULL AND commission_rule_id IS NOT NULL
        AND partner_amount_minor=10000 AND platform_amount_minor=490000-school_amount_minor)
    )
  );
ALTER TABLE public.flutterwave_split_payments DROP CONSTRAINT flw_split_amounts_ck;
COMMIT;
