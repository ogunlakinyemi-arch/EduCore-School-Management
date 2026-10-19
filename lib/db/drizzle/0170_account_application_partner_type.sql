-- Approved additive Development-only application profile extension.
BEGIN;
ALTER TABLE account_applications ADD COLUMN partner_type text;
ALTER TABLE account_applications ADD CONSTRAINT account_applications_partner_type_check
  CHECK (partner_type IS NULL OR (applicant_type='PARTNER' AND partner_type IN ('BUSINESS','INDIVIDUAL')));
COMMIT;
