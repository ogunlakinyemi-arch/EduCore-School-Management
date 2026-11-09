-- REVIEWED RELEASE CANDIDATE ONLY. Not a startup/build/Publish migration hook.
-- Execution is BLOCKED until the operator verifies the serving app's exact
-- Production primary resource, current recovery evidence and release isolation.
-- This file creates only the four existing BRO functions and four triggers.
-- Existing matching objects are retained. Unexpected definitions abort atomically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
  IF pg_is_in_recovery() OR current_setting('transaction_read_only')::boolean THEN
    RAISE EXCEPTION 'BRO protection migration requires a verified writable primary, not a replica';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('bro_field_leads'),('bro_field_claims'),
    ('bro_field_transfers'),('audit_logs')) required(name)
    WHERE to_regclass(format('public.%I',required.name)) IS NULL) THEN
    RAISE EXCEPTION 'Required existing BRO/audit tables are missing; no tables will be created';
  END IF;
END $preflight$;
LOCK TABLE public.bro_field_leads, public.bro_field_claims,
  public.bro_field_transfers, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
DO $functions$
DECLARE spec record; existing record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('bro_field_immutable',$body$
BEGIN RAISE EXCEPTION 'BRO field history and claims are immutable' USING ERRCODE='23514'; END $body$),
    ('bro_field_owner_guard',$body$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BRO leads cannot be deleted'; END IF;
  IF NEW.original_owner_id<>OLD.original_owner_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Original ownership and version history must be preserved';
  END IF;
  IF NEW.current_owner_id IS DISTINCT FROM OLD.current_owner_id AND NOT EXISTS(
    SELECT 1 FROM bro_field_transfers t WHERE t.lead_id=OLD.id AND t.status='APPROVED'
      AND t.from_owner_id IS NOT DISTINCT FROM OLD.current_owner_id
      AND t.target_owner_id IS NOT DISTINCT FROM NEW.current_owner_id AND t.lead_version=OLD.version
  ) THEN RAISE EXCEPTION 'Owner-approved transfer evidence required'; END IF;
  RETURN NEW;
END $body$),
    ('bro_field_transfer_guard',$body$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfer history is immutable'; END IF;
  IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED')
    OR (to_jsonb(NEW)-ARRAY['status','decided_by','decision_reason','decided_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decided_by','decision_reason','decided_at']) THEN
    RAISE EXCEPTION 'Only one audited transfer decision is permitted';
  END IF;
  RETURN NEW;
END $body$),
    ('bro_field_audit_guard',$body$
BEGIN
  IF OLD.module='BROFieldOperations' OR (TG_OP='UPDATE' AND NEW.module='BROFieldOperations') THEN
    RAISE EXCEPTION 'BRO field audit history is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $body$)
  ) definitions(name,body)
  LOOP
    SELECT p.*,l.lanname INTO existing FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(format('public.%I()',spec.name));
    IF FOUND THEN
      IF existing.prosrc IS DISTINCT FROM spec.body OR existing.prorettype<>'trigger'::regtype
        OR existing.lanname<>'plpgsql' OR existing.prokind<>'f'
        OR existing.provolatile<>'v' OR existing.proparallel<>'u'
        OR existing.prosecdef OR existing.proisstrict OR existing.proleakproof OR existing.proretset
        OR coalesce(array_length(existing.proconfig,1),0)<>0 THEN
        RAISE EXCEPTION 'Existing BRO function differs from approved definition: %',spec.name;
      END IF;
    ELSE
      EXECUTE format('CREATE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS %L',spec.name,spec.body);
    END IF;
  END LOOP;
END $functions$;
DO $triggers$
DECLARE spec record; existing record; target regclass; function_id regprocedure;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('bro_field_claim_history','bro_field_claims','bro_field_immutable'),
    ('bro_field_ownership','bro_field_leads','bro_field_owner_guard'),
    ('bro_field_transfer_history','bro_field_transfers','bro_field_transfer_guard'),
    ('bro_field_audit_history','audit_logs','bro_field_audit_guard')
  ) definitions(name,table_name,function_name)
  LOOP
    target:=to_regclass(format('public.%I',spec.table_name));
    function_id:=to_regprocedure(format('public.%I()',spec.function_name));
    SELECT * INTO existing FROM pg_trigger WHERE tgrelid=target AND tgname=spec.name;
    IF FOUND THEN
      IF existing.tgisinternal OR existing.tgfoid<>function_id OR existing.tgtype<>27
        OR existing.tgenabled<>'O' OR existing.tgnargs<>0 OR existing.tgqual IS NOT NULL
        OR existing.tgconstraint<>0 OR existing.tgattr::text<>''
        OR existing.tgoldtable IS NOT NULL OR existing.tgnewtable IS NOT NULL THEN
        RAISE EXCEPTION 'Existing BRO trigger differs from approved definition: %',spec.name;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
        spec.name,spec.table_name,spec.function_name);
    END IF;
  END LOOP;
END $triggers$;
COMMIT;
