-- Additive school-owned bank-transfer configuration. Review before applying.
ALTER TABLE "fee_school_settings"
  ADD COLUMN "bank_transfer_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "bank_name" text,
  ADD COLUMN "bank_account_name" text,
  ADD COLUMN "bank_account_number" text;

ALTER TABLE "fee_school_settings"
  ADD CONSTRAINT "fee_school_settings_bank_account_fields_check"
  CHECK (
    ("bank_name" IS NULL OR COALESCE(LENGTH(BTRIM("bank_name")), 0) BETWEEN 2 AND 100)
    AND ("bank_account_name" IS NULL OR COALESCE(LENGTH(BTRIM("bank_account_name")), 0) BETWEEN 2 AND 150)
    AND ("bank_account_number" IS NULL OR "bank_account_number" ~ '^[0-9]{10}$')
    AND (
      NOT "bank_transfer_enabled"
      OR ("bank_name" IS NOT NULL AND "bank_account_name" IS NOT NULL AND "bank_account_number" IS NOT NULL)
    )
  );