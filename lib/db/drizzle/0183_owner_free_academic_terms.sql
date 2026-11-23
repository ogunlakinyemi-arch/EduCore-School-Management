-- REVIEW CANDIDATE ONLY. Do not apply to shared Development/Production.
-- Append-only entitlement evidence, deliberately separate from financial ledgers.
CREATE TABLE IF NOT EXISTS owner_free_academic_terms (
 id serial PRIMARY KEY,
 school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 academic_session_id integer NOT NULL,
 academic_term_id integer NOT NULL,
 start_date date NOT NULL,
 end_date date NOT NULL,
 actor_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
 status text NOT NULL DEFAULT 'TRIAL_GRANTED' CHECK (status='TRIAL_GRANTED'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,academic_term_id),
 FOREIGN KEY(academic_term_id,school_id) REFERENCES academic_terms(id,school_id) ON DELETE RESTRICT,
 FOREIGN KEY(academic_session_id,school_id) REFERENCES academic_sessions(id,school_id) ON DELETE RESTRICT,
 CHECK(end_date>=start_date)
);
CREATE TABLE IF NOT EXISTS owner_free_academic_term_events (
 id serial PRIMARY KEY,
 grant_id integer NOT NULL REFERENCES owner_free_academic_terms(id) ON DELETE RESTRICT,
 actor_user_id integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status IN ('TRIAL_GRANTED','SUSPENDED')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(grant_id,status)
);
CREATE OR REPLACE FUNCTION reject_free_term_evidence_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Free academic-term evidence is immutable';
 END $$;
DROP TRIGGER IF EXISTS owner_free_terms_immutable ON owner_free_academic_terms;
CREATE TRIGGER owner_free_terms_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_free_academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION reject_free_term_evidence_mutation();
DROP TRIGGER IF EXISTS owner_free_term_events_immutable ON owner_free_academic_term_events;
CREATE TRIGGER owner_free_term_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON owner_free_academic_term_events
 FOR EACH STATEMENT EXECUTE FUNCTION reject_free_term_evidence_mutation();
CREATE OR REPLACE FUNCTION validate_free_term_scope() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM academic_terms t WHERE t.id=NEW.academic_term_id
   AND t.school_id=NEW.school_id AND t.academic_session_id=NEW.academic_session_id
   AND t.start_date=NEW.start_date AND t.end_date=NEW.end_date) THEN
   RAISE EXCEPTION 'Free term must match the saved school/session/term calendar';
 END IF;
 RETURN NEW;
 END $$;
DROP TRIGGER IF EXISTS owner_free_terms_scope ON owner_free_academic_terms;
CREATE TRIGGER owner_free_terms_scope BEFORE INSERT ON owner_free_academic_terms
 FOR EACH ROW EXECUTE FUNCTION validate_free_term_scope();
