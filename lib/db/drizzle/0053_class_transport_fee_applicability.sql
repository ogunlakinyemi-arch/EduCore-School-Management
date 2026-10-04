-- Development hardening: opt-in category applicability. No existing fee is reclassified.
ALTER TABLE fee_categories ADD COLUMN IF NOT EXISTS transport_only boolean NOT NULL DEFAULT false;