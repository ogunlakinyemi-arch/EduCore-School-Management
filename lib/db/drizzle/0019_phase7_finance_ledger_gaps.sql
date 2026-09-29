ALTER TABLE "fee_adjustments"
  ADD COLUMN "requested_percentage" numeric(5,2),
  ADD COLUMN "approved_amount_minor" integer,
  ADD COLUMN "original_balance_minor" integer,
  ADD COLUMN "resulting_balance_minor" integer;

ALTER TABLE "fee_adjustments"
  ADD CONSTRAINT "fee_adjustments_percentage_check"
    CHECK ("requested_percentage" IS NULL OR ("requested_percentage" > 0 AND "requested_percentage" <= 100)),
  ADD CONSTRAINT "fee_adjustments_approved_amount_check"
    CHECK ("approved_amount_minor" IS NULL OR "approved_amount_minor" > 0),
  ADD CONSTRAINT "fee_adjustments_balance_check"
    CHECK ("original_balance_minor" IS NULL OR "original_balance_minor" >= 0),
  ADD CONSTRAINT "fee_adjustments_resulting_balance_check"
    CHECK ("resulting_balance_minor" IS NULL OR "resulting_balance_minor" >= 0);

ALTER TABLE "fee_refunds"
  ADD COLUMN "transaction_type" text NOT NULL DEFAULT 'REFUND',
  ADD CONSTRAINT "fee_refunds_transaction_type_check"
    CHECK ("transaction_type" IN ('REFUND','REVERSAL'));