-- REVIEW CANDIDATE ONLY. Explicit operator execution on the verified serving
-- writable primary after recovery review. Never a startup/build migration.
-- May run before or after Publish creates the two tables. Existing compatible
-- tables/objects are retained; incompatible definitions abort the transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public;
DO $preflight$
BEGIN
  IF pg_is_in_recovery() OR current_setting('transaction_read_only')::boolean THEN
    RAISE EXCEPTION 'Teacher Telegram migration requires a verified writable primary';
  END IF;
  IF to_regclass('public.app_users') IS NULL OR to_regclass('public.schools') IS NULL
    OR to_regclass('public.parents') IS NULL OR to_regclass('public.parent_telegram_links') IS NULL THEN
    RAISE EXCEPTION 'Existing user/school/parent prerequisites are missing';
  END IF;
END $preflight$;
CREATE TABLE IF NOT EXISTS public.teacher_telegram_links (
  user_id integer PRIMARY KEY REFERENCES public.app_users(id),
  school_id integer NOT NULL REFERENCES public.schools(id),
  bot_id text NOT NULL,
  chat_ciphertext text, chat_hash text,
  consented_at timestamptz, revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_telegram_consent_check CHECK (
    (consented_at IS NOT NULL AND revoked_at IS NULL AND chat_ciphertext IS NOT NULL AND chat_hash IS NOT NULL)
    OR (consented_at IS NULL AND revoked_at IS NOT NULL AND chat_ciphertext IS NULL AND chat_hash IS NULL))
);
CREATE TABLE IF NOT EXISTS public.teacher_telegram_challenges (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES public.app_users(id),
  school_id integer NOT NULL REFERENCES public.schools(id), bot_id text NOT NULL,
  token_hash text NOT NULL, pending_ciphertext text, chat_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  claimed_at timestamptz, confirmed_at timestamptz, revoked_at timestamptz,
  CONSTRAINT teacher_telegram_expiry_check CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
LOCK TABLE public.teacher_telegram_links,public.teacher_telegram_challenges,
  public.parent_telegram_links IN SHARE ROW EXCLUSIVE MODE;
DO $shape$
DECLARE spec record; actual text; definition text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('teacher_telegram_links','user_id:integer:true,school_id:integer:true,bot_id:text:true,chat_ciphertext:text:false,chat_hash:text:false,consented_at:timestamp with time zone:false,revoked_at:timestamp with time zone:false,updated_at:timestamp with time zone:true'),
    ('teacher_telegram_challenges','id:integer:true,user_id:integer:true,school_id:integer:true,bot_id:text:true,token_hash:text:true,pending_ciphertext:text:false,chat_hash:text:false,created_at:timestamp with time zone:true,expires_at:timestamp with time zone:true,claimed_at:timestamp with time zone:false,confirmed_at:timestamp with time zone:false,revoked_at:timestamp with time zone:false')
  ) shapes(name,columns)
  LOOP
    SELECT string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' ORDER BY attnum)
      INTO actual FROM pg_attribute WHERE attrelid=to_regclass('public.'||spec.name) AND attnum>0 AND NOT attisdropped;
    IF actual IS DISTINCT FROM spec.columns THEN
      RAISE EXCEPTION 'Existing teacher Telegram table has unexpected columns: %',spec.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d
      ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=to_regclass('public.'||spec.name) AND a.attnum>0 AND NOT a.attisdropped
        AND (a.attidentity<>'' OR a.attgenerated<>''
          OR (d.oid IS NOT NULL AND a.attname NOT IN ('id','created_at','updated_at')))) THEN
      RAISE EXCEPTION 'Unexpected generated/default column: %',spec.name;
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.'||spec.name))<>4 THEN
      RAISE EXCEPTION 'Existing teacher Telegram table has unexpected constraints: %',spec.name;
    END IF;
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('teacher_telegram_links','teacher_telegram_links_pkey','PRIMARY KEY (user_id)'),
    ('teacher_telegram_links','teacher_telegram_links_user_id_fkey','FOREIGN KEY (user_id) REFERENCES app_users(id)'),
    ('teacher_telegram_links','teacher_telegram_links_school_id_fkey','FOREIGN KEY (school_id) REFERENCES schools(id)'),
    ('teacher_telegram_links','teacher_telegram_consent_check','CHECK ((((consented_at IS NOT NULL) AND (revoked_at IS NULL) AND (chat_ciphertext IS NOT NULL) AND (chat_hash IS NOT NULL)) OR ((consented_at IS NULL) AND (revoked_at IS NOT NULL) AND (chat_ciphertext IS NULL) AND (chat_hash IS NULL))))'),
    ('teacher_telegram_challenges','teacher_telegram_challenges_pkey','PRIMARY KEY (id)'),
    ('teacher_telegram_challenges','teacher_telegram_challenges_user_id_fkey','FOREIGN KEY (user_id) REFERENCES app_users(id)'),
    ('teacher_telegram_challenges','teacher_telegram_challenges_school_id_fkey','FOREIGN KEY (school_id) REFERENCES schools(id)'),
    ('teacher_telegram_challenges','teacher_telegram_expiry_check','CHECK (((expires_at > created_at) AND (expires_at <= (created_at + ''00:10:00''::interval))))')
  ) constraints(table_name,name,expected)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
      WHERE conrelid=to_regclass('public.'||spec.table_name) AND conname=spec.name
        AND convalidated AND NOT condeferrable;
    IF regexp_replace(definition,'\s','','g') IS DISTINCT FROM regexp_replace(spec.expected,'\s','','g') THEN
      RAISE EXCEPTION 'Existing teacher Telegram constraint differs from approved definition: %',spec.name;
    END IF;
  END LOOP;
  FOR spec IN SELECT * FROM (VALUES
    ('teacher_telegram_links','updated_at'),('teacher_telegram_challenges','created_at')
  ) defaults(table_name,column_name)
  LOOP
    SELECT pg_get_expr(d.adbin,d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_attribute a
      ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=to_regclass('public.'||spec.table_name) AND a.attname=spec.column_name;
    IF actual IS DISTINCT FROM 'now()' THEN RAISE EXCEPTION 'Unexpected timestamp default: %.%',spec.table_name,spec.column_name; END IF;
  END LOOP;
  IF pg_get_serial_sequence('public.teacher_telegram_challenges','id') IS NULL THEN
    RAISE EXCEPTION 'Teacher challenge ID sequence is missing';
  END IF;
END $shape$;
CREATE UNIQUE INDEX IF NOT EXISTS teacher_telegram_chat_unique ON public.teacher_telegram_links(chat_hash);
CREATE UNIQUE INDEX IF NOT EXISTS teacher_telegram_token_unique ON public.teacher_telegram_challenges(token_hash);
DO $indexes$
DECLARE spec record; actual text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('teacher_telegram_chat_unique','teacher_telegram_links','chat_hash'),
    ('teacher_telegram_token_unique','teacher_telegram_challenges','token_hash')
  ) indexes(name,table_name,column_name)
  LOOP
    SELECT pg_get_indexdef(indexrelid) INTO actual FROM pg_index
      WHERE indexrelid=to_regclass('public.'||spec.name) AND indisvalid AND indisready;
    IF actual IS DISTINCT FROM format('CREATE UNIQUE INDEX %I ON public.%I USING btree (%I)',spec.name,spec.table_name,spec.column_name) THEN
      RAISE EXCEPTION 'Existing teacher Telegram index differs from approved definition: %',spec.name;
    END IF;
  END LOOP;
END $indexes$;
DO $function$
DECLARE body text:=$body$
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
END $body$;
existing record;
BEGIN
  SELECT p.*,l.lanname INTO existing FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('public.telegram_account_chat_exclusive()');
  IF FOUND THEN
    IF existing.prosrc IS DISTINCT FROM body OR existing.prorettype<>'trigger'::regtype
      OR existing.lanname<>'plpgsql' OR existing.prokind<>'f' OR existing.provolatile<>'v'
      OR existing.proparallel<>'u' OR existing.prosecdef OR existing.proisstrict
      OR existing.proleakproof OR existing.proretset
      OR existing.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
      RAISE EXCEPTION 'Existing Telegram exclusivity function differs from approved definition';
    END IF;
  ELSE
    EXECUTE format('CREATE FUNCTION public.telegram_account_chat_exclusive() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS %L',body);
  END IF;
END $function$;
DO $triggers$
DECLARE spec record; existing record; column_number smallint;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('parent_telegram_account_exclusive','parent_telegram_links'),
    ('teacher_telegram_account_exclusive','teacher_telegram_links')
  ) triggers(name,table_name)
  LOOP
    SELECT attnum INTO column_number FROM pg_attribute
      WHERE attrelid=to_regclass('public.'||spec.table_name) AND attname='chat_hash' AND NOT attisdropped;
    SELECT * INTO existing FROM pg_trigger
      WHERE tgrelid=to_regclass('public.'||spec.table_name) AND tgname=spec.name;
    IF FOUND THEN
      IF existing.tgisinternal OR existing.tgfoid<>'public.telegram_account_chat_exclusive()'::regprocedure
        OR existing.tgtype<>23 OR existing.tgenabled<>'O' OR existing.tgnargs<>0
        OR existing.tgqual IS NOT NULL OR existing.tgconstraint<>0
        OR existing.tgattr::text IS DISTINCT FROM column_number::text
        OR existing.tgoldtable IS NOT NULL OR existing.tgnewtable IS NOT NULL THEN
        RAISE EXCEPTION 'Existing Telegram exclusivity trigger differs from approved definition: %',spec.name;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF chat_hash ON public.%I FOR EACH ROW EXECUTE FUNCTION public.telegram_account_chat_exclusive()',spec.name,spec.table_name);
    END IF;
  END LOOP;
END $triggers$;
COMMIT;
