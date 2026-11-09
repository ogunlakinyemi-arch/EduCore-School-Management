-- DEVELOPMENT ONLY. Explicit application; no startup or deployment migration hook.
BEGIN;
CREATE TABLE bro_field_leads (
  id serial PRIMARY KEY,
  original_owner_id integer NOT NULL REFERENCES app_users(id),
  current_owner_id integer REFERENCES app_users(id),
  school_id integer REFERENCES schools(id),
  school_name text NOT NULL, address text NOT NULL,
  contact_person text, contact_phone text,
  visit_date date NOT NULL, person_met text NOT NULL, notes text NOT NULL,
  interest_level text NOT NULL CHECK (interest_level IN ('Unknown','Low','Medium','High')),
  status text NOT NULL CHECK (status IN ('Visited','Interested','Demo Scheduled','Negotiation','Adopted','Not Interested','Follow-up')),
  next_follow_up_date date,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status<>'Adopted' OR school_id IS NOT NULL)
);
CREATE INDEX bro_field_owner_followup ON bro_field_leads(current_owner_id,next_follow_up_date);
CREATE TABLE bro_field_claims (
  claim_key text PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES bro_field_leads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bro_field_transfers (
  id serial PRIMARY KEY, lead_id integer NOT NULL REFERENCES bro_field_leads(id),
  from_owner_id integer REFERENCES app_users(id), target_owner_id integer REFERENCES app_users(id),
  lead_version integer NOT NULL, requested_by integer NOT NULL REFERENCES app_users(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  decided_by integer REFERENCES app_users(id), decision_reason text, decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status='PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL
    AND length(trim(decision_reason)) BETWEEN 5 AND 500)),
  CHECK(from_owner_id IS DISTINCT FROM target_owner_id)
);
CREATE UNIQUE INDEX bro_field_pending_transfer ON bro_field_transfers(lead_id) WHERE status='PENDING';
CREATE FUNCTION bro_field_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BRO field history and claims are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER bro_field_claim_history BEFORE UPDATE OR DELETE ON bro_field_claims
  FOR EACH ROW EXECUTE FUNCTION bro_field_immutable();
CREATE FUNCTION bro_field_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
CREATE TRIGGER bro_field_ownership BEFORE UPDATE OR DELETE ON bro_field_leads
  FOR EACH ROW EXECUTE FUNCTION bro_field_owner_guard();
CREATE FUNCTION bro_field_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfer history is immutable'; END IF;
  IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED')
    OR (to_jsonb(NEW)-ARRAY['status','decided_by','decision_reason','decided_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decided_by','decision_reason','decided_at']) THEN
    RAISE EXCEPTION 'Only one audited transfer decision is permitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bro_field_transfer_history BEFORE UPDATE OR DELETE ON bro_field_transfers
  FOR EACH ROW EXECUTE FUNCTION bro_field_transfer_guard();
CREATE FUNCTION bro_field_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.module='BROFieldOperations' OR (TG_OP='UPDATE' AND NEW.module='BROFieldOperations') THEN
    RAISE EXCEPTION 'BRO field audit history is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER bro_field_audit_history BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION bro_field_audit_guard();
COMMIT;
