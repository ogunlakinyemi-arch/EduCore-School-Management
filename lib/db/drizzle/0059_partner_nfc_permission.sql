-- Additive, default-deny operational permissions. No financial/card backfill.
ALTER TABLE partner_profiles ADD COLUMN nfc_activation_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE partner_profile_users ADD COLUMN nfc_activation_enabled boolean NOT NULL DEFAULT false;
