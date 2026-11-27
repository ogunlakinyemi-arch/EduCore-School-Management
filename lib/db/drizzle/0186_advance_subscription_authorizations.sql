-- CANDIDATE SOURCE ONLY. No application target or execution authorized.
-- Separate from 0177's unchanged seven-day current-term reviews.
BEGIN;
CREATE TABLE advance_subscription_changes (
 id bigserial PRIMARY KEY, school_id integer,
 academic_term_id integer, academic_session_id integer,
 source_table text NOT NULL, changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE advance_subscription_authorizations (
 id bigserial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 academic_term_id integer NOT NULL REFERENCES academic_terms(id),
 rule_id bigint NOT NULL REFERENCES subscription_rule_proposals(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 facts_digest text NOT NULL CHECK(facts_digest ~ '^[a-f0-9]{64}$'),
 evidence_digest text NOT NULL UNIQUE CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 request_key text NOT NULL UNIQUE CHECK(request_key ~ '^[A-Za-z0-9_-]{16,100}$'),
 merchant_evidence_reference text NOT NULL CHECK(length(trim(merchant_evidence_reference)) BETWEEN 8 AND 300),
 merchant_evidence_hash text NOT NULL CHECK(merchant_evidence_hash ~ '^[a-f0-9]{64}$'),
 not_before timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>not_before),
 created_by integer NOT NULL REFERENCES app_users(id), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE advance_subscription_decisions (
 id bigserial PRIMARY KEY, authorization_id bigint NOT NULL REFERENCES advance_subscription_authorizations(id),
 action text NOT NULL CHECK(action IN ('REVIEWED','APPROVED','REJECTED','WITHDRAWN','INVALIDATED','EXPIRED')),
 review_id bigint UNIQUE REFERENCES student_direct_live_reviews(id),
 actor_user_id integer REFERENCES app_users(id), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='APPROVED')=(review_id IS NOT NULL))
);
CREATE INDEX advance_subscription_scope ON advance_subscription_authorizations(school_id,academic_term_id,id DESC);
CREATE INDEX advance_subscription_latest ON advance_subscription_decisions(authorization_id,id DESC);
CREATE INDEX advance_subscription_change_scope ON advance_subscription_changes(school_id,id);
CREATE FUNCTION record_advance_subscription_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oldj jsonb; newj jsonb; oldschool integer; newschool integer;
BEGIN
 IF TG_OP<>'INSERT' THEN oldj:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN newj:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' AND oldj=newj THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('academic_terms','academic_sessions')
   AND oldj-ARRAY['status','is_current','updated_at']=newj-ARRAY['status','is_current','updated_at']
   AND (oldj->>'status'=newj->>'status' OR (oldj->>'status'='PLANNED' AND newj->>'status'='ACTIVE'))
   AND (oldj->>'is_current' IS NOT DISTINCT FROM newj->>'is_current'
     OR (COALESCE((oldj->>'is_current')::boolean,false)=false AND (newj->>'is_current')::boolean=true))
 THEN RETURN NEW; END IF;
 oldschool:=NULLIF(oldj->>'school_id','')::integer;
 newschool:=NULLIF(newj->>'school_id','')::integer;
 IF TG_TABLE_NAME='schools' THEN oldschool:=(oldj->>'id')::integer; newschool:=(newj->>'id')::integer; END IF;
 -- Link-only legacy evidence has no direct school key: invalidate conservatively
 -- across scopes rather than silently ignore a possible material change.
 INSERT INTO advance_subscription_changes(school_id,academic_term_id,academic_session_id,source_table)
 VALUES(COALESCE(oldschool,newschool),
  CASE WHEN TG_TABLE_NAME='academic_terms' THEN COALESCE(newj->>'id',oldj->>'id')::integer END,
  CASE WHEN TG_TABLE_NAME='academic_sessions' THEN COALESCE(newj->>'id',oldj->>'id')::integer END,TG_TABLE_NAME);
 IF oldschool IS DISTINCT FROM newschool AND oldschool IS NOT NULL AND newschool IS NOT NULL THEN
   INSERT INTO advance_subscription_changes(school_id,source_table) VALUES(newschool,TG_TABLE_NAME);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
-- Install on every currently present authoritative reconciliation source.
-- Runtime inspection also demands coverage for newly discovered sources.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
   (c.relname IN ('schools','academic_terms','academic_sessions','students','subscriptions',
    'fee_invoices','fee_invoice_lines','fee_payments','fee_receipts','fee_payment_line_allocations',
    'fee_adjustments','fee_refunds','fee_provider_checkout_sessions','fee_provider_webhook_events',
    'hosted_checkout_orders','hosted_checkout_events','subscription_rule_proposals',
    'owner_free_academic_terms','owner_free_academic_term_events')
    OR c.relname ~ '^(flutterwave_live_|student_subscription_|hosted_checkout_|deferred_commission_)')
 LOOP
  EXECUTE format('CREATE TRIGGER advance_material_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION record_advance_subscription_change()',r.relname);
 END LOOP;
END $$;
CREATE FUNCTION guard_advance_subscription_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t academic_terms%ROWTYPE; a advance_subscription_authorizations%ROWTYPE; r student_direct_live_reviews%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='advance_subscription_authorizations' THEN
  SELECT * INTO t FROM academic_terms WHERE id=NEW.academic_term_id AND school_id=NEW.school_id FOR SHARE;
  IF t.id IS NULL OR NEW.not_before IS DISTINCT FROM (t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
    OR NEW.expires_at IS DISTINCT FROM ((t.end_date+1)::timestamp AT TIME ZONE 'Africa/Lagos')
    OR NEW.snapshot->>'release' IS DISTINCT FROM 'STUDENT_DIRECT_ADVANCE_3200_V1'
    OR NOT EXISTS(SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
      WHERE u.id=NEW.created_by AND u.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE')
  THEN RAISE EXCEPTION 'Invalid advance authorization scope or term window'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO a FROM advance_subscription_authorizations WHERE id=NEW.authorization_id FOR UPDATE;
 IF NEW.action IN ('REVIEWED','APPROVED','REJECTED','WITHDRAWN') AND NOT EXISTS(
   SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
   WHERE u.id=NEW.actor_user_id AND u.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE')
 THEN RAISE EXCEPTION 'Active Owner advance decision required'; END IF;
 IF NEW.action='APPROVED' THEN
  SELECT * INTO r FROM student_direct_live_reviews WHERE id=NEW.review_id;
  IF r.id IS NULL OR (r.school_id,r.academic_term_id,r.rule_id,r.report_digest,r.merchant_scope,r.expires_at,r.approved_by)
    IS DISTINCT FROM (a.school_id,a.academic_term_id,a.rule_id,a.snapshot->>'reportDigest',
      a.snapshot->>'merchantScope',a.expires_at,NEW.actor_user_id)
    OR COALESCE((SELECT action FROM advance_subscription_decisions WHERE authorization_id=a.id ORDER BY id DESC LIMIT 1),'')<>'REVIEWED'
  THEN RAISE EXCEPTION 'Advance approval requires an exact separately reviewed binding'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER advance_authorization_scope BEFORE INSERT ON advance_subscription_authorizations
 FOR EACH ROW EXECUTE FUNCTION guard_advance_subscription_authorization();
CREATE TRIGGER advance_decision_scope BEFORE INSERT ON advance_subscription_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_advance_subscription_authorization();
CREATE TRIGGER advance_authorization_history BEFORE UPDATE OR DELETE ON advance_subscription_authorizations
 FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER advance_decision_history BEFORE UPDATE OR DELETE ON advance_subscription_decisions
 FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER advance_changes_history BEFORE UPDATE OR DELETE ON advance_subscription_changes
 FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE FUNCTION guard_advance_subscription_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reviewid bigint; studentid integer; a advance_subscription_authorizations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME IN ('student_direct_live_obligations','current_bulk_allocations') THEN reviewid:=NEW.review_id; studentid:=NEW.student_id;
 ELSE SELECT o.review_id,o.student_id INTO reviewid,studentid FROM student_direct_live_obligations o WHERE o.id=NEW.obligation_id; END IF;
 SELECT au.* INTO a FROM advance_subscription_authorizations au JOIN advance_subscription_decisions d
   ON d.authorization_id=au.id AND d.action='APPROVED' WHERE d.review_id=reviewid;
 IF NOT FOUND THEN RETURN NEW; END IF; -- Ordinary seven-day workflow stays unchanged.
 IF TG_TABLE_NAME='student_direct_live_obligations' THEN
  IF (NEW.school_id,NEW.academic_term_id,NEW.rule_id,NEW.merchant_scope)
   IS DISTINCT FROM (a.school_id,a.academic_term_id,a.rule_id,a.snapshot->>'merchantScope')
  THEN RAISE EXCEPTION 'Advance obligation scope mismatch'; END IF;
 ELSIF TG_TABLE_NAME='current_bulk_allocations' THEN
  IF (NEW.school_id,NEW.academic_term_id) IS DISTINCT FROM (a.school_id,a.academic_term_id)
  THEN RAISE EXCEPTION 'Advance allocation scope mismatch'; END IF;
 END IF;
 IF clock_timestamp()<a.not_before OR clock_timestamp()>=a.expires_at
  OR a.id<>(SELECT max(id) FROM advance_subscription_authorizations WHERE school_id=a.school_id AND academic_term_id=a.academic_term_id)
  OR (SELECT action FROM advance_subscription_decisions WHERE authorization_id=a.id ORDER BY id DESC LIMIT 1) IS DISTINCT FROM 'APPROVED'
  OR (a.snapshot->'eligibleStudentIds' @> to_jsonb(ARRAY[studentid])) IS NOT TRUE
  OR (SELECT COALESCE(max(id),0)::text FROM advance_subscription_changes WHERE school_id IS NULL
    OR (school_id=a.school_id AND (academic_term_id IS NULL OR academic_term_id=a.academic_term_id)
     AND (academic_session_id IS NULL OR academic_session_id=(a.snapshot->'calendar'->>'academic_session_id')::integer)))
       IS DISTINCT FROM a.snapshot->>'materialVersion'
  OR NOT EXISTS(SELECT 1 FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
    WHERE t.id=a.academic_term_id AND t.school_id=a.school_id AND t.is_current=true AND t.status='ACTIVE'
     AND s.is_current=true AND s.status='ACTIVE'
     AND (SELECT count(*) FROM academic_terms ct WHERE ct.school_id=t.school_id AND ct.is_current=true AND ct.status='ACTIVE')=1
     AND (SELECT count(*) FROM academic_sessions cs WHERE cs.school_id=t.school_id AND cs.is_current=true AND cs.status='ACTIVE')=1
     AND t.start_date::text=a.snapshot->'calendar'->>'start_date' AND t.end_date::text=a.snapshot->'calendar'->>'end_date'
     AND (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date)
 THEN RAISE EXCEPTION 'Advance authorization does not permit checkout now'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER advance_obligation_calendar BEFORE INSERT ON student_direct_live_obligations
 FOR EACH ROW EXECUTE FUNCTION guard_advance_subscription_checkout();
CREATE TRIGGER advance_attempt_calendar BEFORE INSERT ON student_direct_live_attempts
 FOR EACH ROW EXECUTE FUNCTION guard_advance_subscription_checkout();
DO $$ BEGIN
 IF to_regclass('public.current_bulk_allocations') IS NOT NULL THEN
  CREATE TRIGGER advance_bulk_calendar BEFORE INSERT ON current_bulk_allocations
   FOR EACH ROW EXECUTE FUNCTION guard_advance_subscription_checkout();
 END IF;
END $$;
COMMIT;
