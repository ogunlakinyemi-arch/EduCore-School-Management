-- Additive extension of the existing delivery and device models only.
ALTER TABLE public.communication_push_devices
  ADD COLUMN IF NOT EXISTS subscription jsonb,
  ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE public.communication_deliveries
  ADD COLUMN IF NOT EXISTS push_attempts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.communication_deliveries ADD COLUMN IF NOT EXISTS provider_name text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS communication_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Payloads and provider responses never contain API/VAPID private keys.
-- Existing foreign keys, unique delivery identities and immutable triggers are unchanged.