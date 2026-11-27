-- CANDIDATE ONLY. No application execution, seed, calendar repair or billing.
-- Existing duplicate current markers MUST be reviewed before index creation.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE academic_calendar_rollovers (
 id bigserial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 effective_date date NOT NULL, event_key text NOT NULL UNIQUE CHECK(event_key ~ '^[a-f0-9]{64}$'),
 calendar_digest text NOT NULL CHECK(calendar_digest ~ '^[a-f0-9]{64}$'),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 result text NOT NULL CHECK(result IN ('TRANSITIONED','BLOCKED')),
 academic_session_id integer, academic_term_id integer,
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'),
 issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array'),
 calendar_snapshot jsonb NOT NULL CHECK(jsonb_typeof(calendar_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX academic_calendar_rollovers_school_date ON academic_calendar_rollovers(school_id,effective_date);
CREATE FUNCTION guard_academic_calendar_rollover_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
 BEGIN RAISE EXCEPTION 'Academic calendar rollover history is immutable'; END $$;
CREATE TRIGGER academic_calendar_rollover_history BEFORE UPDATE OR DELETE ON academic_calendar_rollovers
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_rollover_history();
CREATE TRIGGER academic_calendar_rollover_truncate BEFORE TRUNCATE ON academic_calendar_rollovers
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_rollover_history();
CREATE UNIQUE INDEX academic_sessions_one_current_school ON academic_sessions(school_id) WHERE is_current;
CREATE UNIQUE INDEX academic_terms_one_current_school ON academic_terms(school_id) WHERE is_current;
CREATE FUNCTION academic_calendar_term_ordinal(value text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE regexp_replace(lower(value),'[[:space:]_-]','','g')
  WHEN 'firstterm' THEN 1 WHEN 'firstacademicterm' THEN 1 WHEN 'term1' THEN 1 WHEN '1stterm' THEN 1 WHEN 'first' THEN 1 WHEN '1' THEN 1
  WHEN 'secondterm' THEN 2 WHEN 'secondacademicterm' THEN 2 WHEN 'term2' THEN 2 WHEN '2ndterm' THEN 2 WHEN 'second' THEN 2 WHEN '2' THEN 2
  WHEN 'thirdterm' THEN 3 WHEN 'thirdacademicterm' THEN 3 WHEN 'term3' THEN 3 WHEN '3rdterm' THEN 3 WHEN 'third' THEN 3 WHEN '3' THEN 3 END;
$$;
CREATE FUNCTION academic_calendar_session_complete(school integer,session integer) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM academic_sessions s
  JOIN academic_terms t ON t.academic_session_id=s.id AND t.school_id=s.school_id
  WHERE s.id=session AND s.school_id=school AND s.start_date<=s.end_date
  GROUP BY s.id,s.start_date,s.end_date HAVING count(*)=3
   AND count(DISTINCT academic_calendar_term_ordinal(t.name))=3
   AND bool_and(t.start_date IS NOT NULL AND t.end_date IS NOT NULL
    AND t.start_date<=t.end_date AND t.start_date>=s.start_date AND t.end_date<=s.end_date))
 AND NOT EXISTS(SELECT 1 FROM academic_terms a JOIN academic_terms b
   ON a.school_id=b.school_id AND a.academic_session_id=b.academic_session_id
   AND academic_calendar_term_ordinal(a.name)<academic_calendar_term_ordinal(b.name)
  WHERE a.school_id=school AND a.academic_session_id=session AND a.end_date>=b.start_date);
$$;
-- Statement gate precedes row acquisition even for non-HTTP writers. Existing
-- API writers already use this gate; do not invert the global/calendar order.
CREATE FUNCTION guard_academic_calendar_write_gate() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
 BEGIN
  PERFORM pg_advisory_xact_lock(1946482034,1);
  -- An invoker must see the whole calendar, not a policy-filtered subset.
  -- Do not elevate to SECURITY DEFINER or silently bypass RLS.
  IF row_security_active('public.academic_sessions'::regclass)
   OR row_security_active('public.academic_terms'::regclass)
  THEN RAISE EXCEPTION 'Calendar integrity requires unfiltered calendar visibility'; END IF;
  RETURN NULL;
 END $$;
CREATE FUNCTION guard_academic_calendar_current_scope() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid integer; oldschool integer; newschool integer;
BEGIN
 IF TG_OP<>'INSERT' THEN oldschool:=OLD.school_id; END IF;
 IF TG_OP<>'DELETE' THEN newschool:=NEW.school_id; END IF;
 FOR sid IN SELECT DISTINCT v FROM unnest(ARRAY[oldschool,newschool]) v WHERE v IS NOT NULL ORDER BY v LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('academic-calendar:'||sid,0));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
-- Validate final stored rows, not a BEFORE trigger's OLD rows or intermediate
-- NEW images. Current-session holidays may have no current term; a saved due
-- term must be active/current. Incomplete noncurrent setup remains permitted.
CREATE FUNCTION assert_academic_calendar_current_school(school integer) RETURNS void LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.academic_sessions%ROWTYPE; today date; sessions integer; terms integer;
BEGIN
 IF row_security_active('public.academic_sessions'::regclass)
  OR row_security_active('public.academic_terms'::regclass)
 THEN RAISE EXCEPTION 'Calendar integrity requires unfiltered calendar visibility'; END IF;
 today:=(clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
 SELECT count(*) INTO sessions FROM public.academic_sessions WHERE school_id=school AND is_current;
 SELECT count(*) INTO terms FROM public.academic_terms WHERE school_id=school AND is_current;
 IF sessions=0 AND terms=0 THEN RETURN; END IF;
 IF sessions<>1 THEN RAISE EXCEPTION 'Current academic term requires exactly one current session'; END IF;
 SELECT * INTO s FROM public.academic_sessions WHERE school_id=school AND is_current;
 IF s.status IS DISTINCT FROM 'ACTIVE' OR s.start_date IS NULL OR s.end_date IS NULL
  OR s.name IS NULL OR length(trim(s.name)) NOT BETWEEN 1 AND 120
  OR s.start_date>s.end_date OR today NOT BETWEEN s.start_date AND s.end_date
  OR EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.school_id=school AND t.is_current
   AND (t.status IS DISTINCT FROM 'ACTIVE' OR t.start_date IS NULL OR t.end_date IS NULL
    OR t.name IS NULL OR length(trim(t.name)) NOT BETWEEN 1 AND 120
    OR t.start_date>t.end_date OR today NOT BETWEEN t.start_date AND t.end_date))
 THEN RAISE EXCEPTION 'Current academic period must be active within its saved WAT dates'; END IF;
 IF NOT public.academic_calendar_session_complete(school,s.id) OR EXISTS(
   SELECT 1 FROM public.academic_sessions x WHERE x.school_id=school AND x.id<>s.id
    AND x.start_date<=s.end_date AND x.end_date>=s.start_date)
 THEN RAISE EXCEPTION 'Current academic session requires a complete unambiguous calendar'; END IF;
 IF terms>1 OR EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.school_id=school AND t.is_current
    AND (t.academic_session_id IS DISTINCT FROM s.id OR t.status IS DISTINCT FROM 'ACTIVE'
     OR t.name IS NULL OR length(trim(t.name)) NOT BETWEEN 1 AND 120
     OR today NOT BETWEEN t.start_date AND t.end_date))
   OR EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.school_id=school AND t.academic_session_id=s.id
    AND today BETWEEN t.start_date AND t.end_date AND (t.is_current IS NOT TRUE OR t.status IS DISTINCT FROM 'ACTIVE'))
   OR EXISTS(SELECT 1 FROM public.academic_terms t JOIN public.academic_terms cur ON cur.school_id=t.school_id
      AND cur.is_current AND cur.id<>t.id WHERE t.school_id=school
      AND t.start_date<=cur.end_date AND t.end_date>=cur.start_date)
 THEN RAISE EXCEPTION 'Current academic term requires its active current session and ordered nonoverlapping terms'; END IF;
END $$;
CREATE FUNCTION guard_academic_calendar_final_state() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid integer; oldschool integer; newschool integer;
BEGIN
 IF TG_OP<>'INSERT' THEN oldschool:=OLD.school_id; END IF;
 IF TG_OP<>'DELETE' THEN newschool:=NEW.school_id; END IF;
 FOR sid IN SELECT DISTINCT v FROM unnest(ARRAY[oldschool,newschool]) v WHERE v IS NOT NULL ORDER BY v LOOP
  PERFORM public.assert_academic_calendar_current_school(sid);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION guard_academic_calendar_truncate() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Calendar truncation would bypass transaction-final integrity';
END $$;
-- Keep immediate one-current uniqueness; rollover clears outgoing markers
-- before setting incoming ones. Only cross-row completeness is deferred.
CREATE CONSTRAINT TRIGGER academic_calendar_final_state AFTER INSERT OR UPDATE OR DELETE ON academic_sessions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_final_state();
CREATE CONSTRAINT TRIGGER academic_calendar_final_state AFTER INSERT OR UPDATE OR DELETE ON academic_terms
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_final_state();
CREATE TRIGGER academic_calendar_truncate BEFORE TRUNCATE ON academic_sessions
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_truncate();
CREATE TRIGGER academic_calendar_truncate BEFORE TRUNCATE ON academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_truncate();
CREATE TRIGGER academic_calendar_write_gate BEFORE INSERT OR UPDATE OR DELETE ON academic_sessions
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_write_gate();
CREATE TRIGGER academic_calendar_write_gate BEFORE INSERT OR UPDATE OR DELETE ON academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_write_gate();
CREATE TRIGGER academic_calendar_current_scope BEFORE INSERT OR UPDATE OR DELETE ON academic_sessions
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_current_scope();
CREATE TRIGGER academic_calendar_current_scope BEFORE INSERT OR UPDATE OR DELETE ON academic_terms
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_current_scope();
COMMIT;
