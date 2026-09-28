-- Additive Phase 7 finance integrity constraints. Review before applying.
ALTER TABLE "fee_payments"
  ADD CONSTRAINT "fee_payments_bank_transfer_details_check"
  CHECK (
    "method" <> 'BANK_TRANSFER' OR (
      COALESCE(LENGTH(BTRIM("transfer_bank")), 0) >= 2
      AND COALESCE(LENGTH(BTRIM("transfer_reference")), 0) >= 2
      AND "transfer_date" IS NOT NULL
    )
  );

ALTER TABLE "fee_payments"
  ADD CONSTRAINT "fee_payments_verification_evidence_length_check"
  CHECK (
    "method" <> 'BANK_TRANSFER' OR "status" <> 'VERIFIED' OR (
      LENGTH(BTRIM("verification_evidence_ref")) >= 3
      AND LENGTH(BTRIM("reviewer_notes")) >= 3
    )
  );

CREATE UNIQUE INDEX "fee_payments_school_bank_transfer_ref_unique"
  ON "fee_payments" ("school_id", LOWER(BTRIM("transfer_bank")), LOWER(BTRIM("transfer_reference")))
  WHERE "method" = 'BANK_TRANSFER'
    AND NULLIF(BTRIM("transfer_bank"), '') IS NOT NULL
    AND NULLIF(BTRIM("transfer_reference"), '') IS NOT NULL;

CREATE UNIQUE INDEX "fee_payments_school_verified_evidence_ref_unique"
  ON "fee_payments" ("school_id", LOWER(BTRIM("verification_evidence_ref")))
  WHERE "method" = 'BANK_TRANSFER'
    AND "status" = 'VERIFIED'
    AND NULLIF(BTRIM("verification_evidence_ref"), '') IS NOT NULL;

ALTER TABLE "fee_payments"
  ADD CONSTRAINT "fee_payments_id_invoice_school_unique"
  UNIQUE ("id", "invoice_id", "school_id");

ALTER TABLE "fee_receipts" ADD COLUMN "invoice_id" integer;
UPDATE "fee_receipts" r
  SET "invoice_id" = p."invoice_id"
  FROM "fee_payments" p
  WHERE p."id" = r."payment_id" AND p."school_id" = r."school_id";
UPDATE "fee_receipts" r
  SET "snapshot" = r."snapshot" || jsonb_build_object('invoiceId', r."invoice_id", 'schoolId', r."school_id");
ALTER TABLE "fee_receipts" ALTER COLUMN "invoice_id" SET NOT NULL;
ALTER TABLE "fee_receipts"
  ADD CONSTRAINT "fee_receipts_payment_invoice_school_fk"
  FOREIGN KEY ("payment_id", "invoice_id", "school_id")
  REFERENCES "fee_payments" ("id", "invoice_id", "school_id");