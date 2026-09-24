-- Device assignment may change without changing the school on a historical
-- biometric enrollment or a card's last-seen device reference.
INSERT INTO "device_school_bindings" ("device_id","school_id")
SELECT device_id,school_id FROM "biometric_enrollments" WHERE device_id IS NOT NULL
UNION
SELECT last_device_id,school_id FROM "nfc_cards" WHERE last_device_id IS NOT NULL
ON CONFLICT ("device_id","school_id") DO NOTHING;

ALTER TABLE "biometric_enrollments"
  DROP CONSTRAINT IF EXISTS "biometric_enrollments_device_school_fk";
ALTER TABLE "biometric_enrollments"
  ADD CONSTRAINT "biometric_enrollments_device_school_fk"
  FOREIGN KEY ("device_id","school_id")
  REFERENCES "device_school_bindings"("device_id","school_id") NOT VALID;
ALTER TABLE "biometric_enrollments"
  VALIDATE CONSTRAINT "biometric_enrollments_device_school_fk";

ALTER TABLE "nfc_cards"
  DROP CONSTRAINT IF EXISTS "nfc_cards_last_device_school_fk";
ALTER TABLE "nfc_cards"
  ADD CONSTRAINT "nfc_cards_last_device_school_fk"
  FOREIGN KEY ("last_device_id","school_id")
  REFERENCES "device_school_bindings"("device_id","school_id") NOT VALID;
ALTER TABLE "nfc_cards"
  VALIDATE CONSTRAINT "nfc_cards_last_device_school_fk";