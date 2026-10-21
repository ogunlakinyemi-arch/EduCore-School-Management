-- Additive Telegram support. Explicitly applied only to verified Development.
CREATE TABLE parent_telegram_links (
 parent_id integer PRIMARY KEY REFERENCES parents(id),bot_id text NOT NULL,
 chat_ciphertext text,chat_hash text,consented_at timestamptz,revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT parent_telegram_links_consent_check CHECK (
 (consented_at IS NOT NULL AND revoked_at IS NULL AND chat_ciphertext IS NOT NULL AND chat_hash IS NOT NULL)
 OR (consented_at IS NULL AND revoked_at IS NOT NULL AND chat_ciphertext IS NULL AND chat_hash IS NULL))
);
CREATE UNIQUE INDEX parent_telegram_links_chat_unique ON parent_telegram_links(chat_hash);
CREATE TABLE telegram_link_challenges (
 id serial PRIMARY KEY,parent_id integer NOT NULL REFERENCES parents(id),
 school_id integer NOT NULL REFERENCES schools(id),bot_id text NOT NULL,token_hash text NOT NULL,
 pending_ciphertext text,chat_hash text,created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,claimed_at timestamptz,confirmed_at timestamptz,revoked_at timestamptz,
 CONSTRAINT telegram_link_challenges_expiry_check CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '10 minutes')
);
CREATE UNIQUE INDEX telegram_link_challenges_token_unique ON telegram_link_challenges(token_hash);
CREATE TABLE telegram_poll_state(id integer PRIMARY KEY,bot_id text NOT NULL,last_update_id integer NOT NULL DEFAULT 0,
 CONSTRAINT telegram_poll_state_singleton CHECK(id=1 AND last_update_id>=0));
ALTER TABLE communication_deliveries DROP CONSTRAINT communication_deliveries_channel_check;
ALTER TABLE communication_deliveries ADD CONSTRAINT communication_deliveries_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH','TELEGRAM'));
ALTER TABLE communication_preferences DROP CONSTRAINT communication_preferences_channel_check;
ALTER TABLE communication_preferences ADD CONSTRAINT communication_preferences_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH','TELEGRAM'));
ALTER TABLE communication_templates DROP CONSTRAINT communication_templates_channel_check;
ALTER TABLE communication_templates ADD CONSTRAINT communication_templates_channel_check CHECK(channel IN ('IN_APP','SMS','EMAIL','PUSH','TELEGRAM'));
