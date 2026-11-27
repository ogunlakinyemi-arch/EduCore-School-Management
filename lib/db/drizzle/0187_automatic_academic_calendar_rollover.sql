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
CREATE FUNCTION guard_academic_calendar_rollover_history() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Academic calendar rollover history is immutable'; END $$;
CREATE TRIGGER academic_calendar_rollover_history BEFORE UPDATE OR DELETE ON academic_calendar_rollovers
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_rollover_history();
CREATE TRIGGER academic_calendar_rollover_truncate BEFORE TRUNCATE ON academic_calendar_rollovers
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_rollover_history();
CREATE UNIQUE INDEX academic_sessions_one_current_school ON academic_sessions(school_id) WHERE is_current;
CREATE UNIQUE INDEX academic_terms_one_current_school ON academic_terms(school_id) WHERE is_current;
CREATE FUNCTION academic_calendar_term_ordinal(value text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE regexp_replace(lower(value),'[[:space:]_-]','','g')
  WHEN 'firstterm' THEN 1 WHEN 'firstacademicterm' THEN 1 WHEN 'term1' THEN 1 WHEN '1stterm' THEN 1 WHEN 'first' THEN 1 WHEN '1' THEN 1
  WHEN 'secondterm' THEN 2 WHEN 'secondacademicterm' THEN 2 WHEN 'term2' THEN 2 WHEN '2ndterm' THEN 2 WHEN 'second' THEN 2 WHEN '2' THEN 2
  WHEN 'thirdterm' THEN 3 WHEN 'thirdacademicterm' THEN 3 WHEN 'term3' THEN 3 WHEN '3rdterm' THEN 3 WHEN 'third' THEN 3 WHEN '3' THEN 3 END;
$$;
CREATE FUNCTION academic_calendar_session_complete(school integer,session integer) RETURNS boolean LANGUAGE sql STABLE AS $$
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
CREATE FUNCTION guard_academic_calendar_write_gate() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN PERFORM pg_advisory_xact_lock(1946482034,1); RETURN NULL; END $$;
CREATE FUNCTION guard_academic_calendar_current_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid integer; oldschool integer; newschool integer; today date;
BEGIN
 IF TG_OP<>'INSERT' THEN oldschool:=OLD.school_id; END IF;
 IF TG_OP<>'DELETE' THEN newschool:=NEW.school_id; END IF;
 FOR sid IN SELECT DISTINCT v FROM unnest(ARRAY[oldschool,newschool]) v WHERE v IS NOT NULL ORDER BY v LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('academic-calendar:'||sid,0));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.is_current IS NOT TRUE THEN RETURN NEW; END IF;
 today:=(clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
 IF NEW.status IS DISTINCT FROM 'ACTIVE' OR NEW.start_date IS NULL OR NEW.end_date IS NULL
  OR NEW.name IS NULL OR length(trim(NEW.name)) NOT BETWEEN 1 AND 120
  OR NEW.start_date>NEW.end_date OR today NOT BETWEEN NEW.start_date AND NEW.end_date
 THEN RAISE EXCEPTION 'Current academic period must be active within its saved WAT dates'; END IF;
 IF TG_TABLE_NAME='academic_sessions' THEN
  IF NOT academic_calendar_session_complete(NEW.school_id,NEW.id) OR EXISTS(
   SELECT 1 FROM academic_sessions s WHERE s.school_id=NEW.school_id AND s.id<>NEW.id
    AND s.start_date<=NEW.end_date AND s.end_date>=NEW.start_date)
   OR EXISTS(SELECT 1 FROM academic_terms t WHERE t.school_id=NEW.school_id AND t.academic_session_id=NEW.id
    AND (t.start_date<NEW.start_date OR t.end_date>NEW.end_date))
  THEN RAISE EXCEPTION 'Current academic session requires a complete unambiguous calendar'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM academic_sessions s WHERE s.id=NEW.academic_session_id AND s.school_id=NEW.school_id
    AND s.is_current=true AND s.status='ACTIVE' AND NEW.start_date>=s.start_date AND NEW.end_date<=s.end_date
    AND today BETWEEN s.start_date AND s.end_date)
   OR academic_calendar_term_ordinal(NEW.name) IS NULL
   OR NOT academic_calendar_session_complete(NEW.school_id,NEW.academic_session_id)
   OR EXISTS(SELECT 1 FROM academic_terms t WHERE t.school_id=NEW.school_id AND t.id<>NEW.id
    AND (t.start_date<=NEW.end_date AND t.end_date>=NEW.start_date
     OR (t.academic_session_id=NEW.academic_session_id AND (
       academic_calendar_term_ordinal(t.name)=academic_calendar_term_ordinal(NEW.name)
       OR (academic_calendar_term_ordinal(t.name)<academic_calendar_term_ordinal(NEW.name) AND t.end_date>=NEW.start_date)
       OR (academic_calendar_term_ordinal(t.name)>academic_calendar_term_ordinal(NEW.name) AND t.start_date<=NEW.end_date)))))
  THEN RAISE EXCEPTION 'Current academic term requires its active current session and ordered nonoverlapping terms'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academic_calendar_write_gate BEFORE INSERT OR UPDATE OR DELETE ON academic_sessions
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_write_gate();
CREATE TRIGGER academic_calendar_write_gate BEFORE INSERT OR UPDATE OR DELETE ON academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION guard_academic_calendar_write_gate();
CREATE TRIGGER academic_calendar_current_scope BEFORE INSERT OR UPDATE OR DELETE ON academic_sessions
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_current_scope();
CREATE TRIGGER academic_calendar_current_scope BEFORE INSERT OR UPDATE OR DELETE ON academic_terms
 FOR EACH ROW EXECUTE FUNCTION guard_academic_calendar_current_scope();
COMMIT;
