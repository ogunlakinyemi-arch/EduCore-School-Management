-- Explicit Development-only application; never executed at startup or publish.
BEGIN;
CREATE TABLE teacher_telegram_links (
  user_id integer PRIMARY KEY REFERENCES app_users(id),
  school_id integer NOT NULL REFERENCES schools(id),
  bot_id text NOT NULL,
  chat_ciphertext text, chat_hash text,
  consented_at timestamptz, revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_telegram_consent_check CHECK (
    (consented_at IS NOT NULL AND revoked_at IS NULL AND chat_ciphertext IS NOT NULL AND chat_hash IS NOT NULL)
    OR (consented_at IS NULL AND revoked_at IS NOT NULL AND chat_ciphertext IS NULL AND chat_hash IS NULL))
);
CREATE UNIQUE INDEX teacher_telegram_chat_unique ON teacher_telegram_links(chat_hash);
CREATE TABLE teacher_telegram_challenges (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES app_users(id),
  school_id integer NOT NULL REFERENCES schools(id), bot_id text NOT NULL,
  token_hash text NOT NULL, pending_ciphertext text, chat_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  claimed_at timestamptz, confirmed_at timestamptz, revoked_at timestamptz,
  CONSTRAINT teacher_telegram_expiry_check CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE UNIQUE INDEX teacher_telegram_token_unique ON teacher_telegram_challenges(token_hash);
-- Preserve the parent representation and allow the SAME account's two roles.
-- A shared database lock also protects concurrent parent/teacher confirmations.
CREATE FUNCTION telegram_account_chat_exclusive() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE account_id integer;
BEGIN
  IF NEW.chat_hash IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chat_hash,31978));
  IF TG_TABLE_NAME='parent_telegram_links' THEN
    SELECT user_id INTO account_id FROM public.parents WHERE id=NEW.parent_id;
    IF EXISTS(SELECT 1 FROM public.teacher_telegram_links
      WHERE chat_hash=NEW.chat_hash AND user_id IS DISTINCT FROM account_id) THEN
      RAISE EXCEPTION 'Telegram chat is already linked to another account' USING ERRCODE='23505';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.parent_telegram_links l JOIN public.parents p ON p.id=l.parent_id
      WHERE l.chat_hash=NEW.chat_hash AND p.user_id IS DISTINCT FROM NEW.user_id) THEN
      RAISE EXCEPTION 'Telegram chat is already linked to another account' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER parent_telegram_account_exclusive BEFORE INSERT OR UPDATE OF chat_hash ON parent_telegram_links
  FOR EACH ROW EXECUTE FUNCTION telegram_account_chat_exclusive();
CREATE TRIGGER teacher_telegram_account_exclusive BEFORE INSERT OR UPDATE OF chat_hash ON teacher_telegram_links
  FOR EACH ROW EXECUTE FUNCTION telegram_account_chat_exclusive();
COMMIT;
