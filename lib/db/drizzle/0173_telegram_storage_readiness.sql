-- Explicit controlled schema correction; never run at application startup/build.
-- New CHECK names make the broadened channel contract visible to schema diffs.
-- No business rows are inserted, updated, deleted, reset or rewritten.
BEGIN;

CREATE TABLE IF NOT EXISTS parent_telegram_links (
  parent_id integer PRIMARY KEY REFERENCES parents(id), bot_id text NOT NULL,
  chat_ciphertext text, chat_hash text, consented_at timestamptz, revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parent_telegram_links_consent_check CHECK (
    (consented_at IS NOT NULL AND revoked_at IS NULL AND chat_ciphertext IS NOT NULL AND chat_hash IS NOT NULL)
    OR (consented_at IS NULL AND revoked_at IS NOT NULL AND chat_ciphertext IS NULL AND chat_hash IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS parent_telegram_links_chat_unique ON parent_telegram_links(chat_hash);

CREATE TABLE IF NOT EXISTS telegram_link_challenges (
  id serial PRIMARY KEY, parent_id integer NOT NULL REFERENCES parents(id),
  school_id integer NOT NULL REFERENCES schools(id), bot_id text NOT NULL, token_hash text NOT NULL,
  pending_ciphertext text, chat_hash text, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, claimed_at timestamptz, confirmed_at timestamptz, revoked_at timestamptz,
  CONSTRAINT telegram_link_challenges_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_link_challenges_token_unique ON telegram_link_challenges(token_hash);

CREATE TABLE IF NOT EXISTS telegram_poll_state (
  id integer PRIMARY KEY, bot_id text NOT NULL, last_update_id integer NOT NULL DEFAULT 0,
  CONSTRAINT telegram_poll_state_singleton CHECK (id = 1 AND last_update_id >= 0)
);

DO $$
DECLARE
  relation_name text;
  replacement_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'communication_deliveries', 'communication_preferences', 'communication_templates'
  ] LOOP
    replacement_name := relation_name || '_telegram_channel_check';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass(relation_name) AND conname = replacement_name
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (channel IN (''IN_APP'',''SMS'',''EMAIL'',''PUSH'',''TELEGRAM'')) NOT VALID',
        relation_name, replacement_name);
    END IF;
    -- Validate before removing the old guard; incompatible data aborts atomically.
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', relation_name, replacement_name);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      relation_name, relation_name || '_channel_check');
  END LOOP;
END $$;

COMMIT;
