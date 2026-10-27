-- REVIEW DRAFT ONLY: validate on a disposable fixture; no application target is authorized.
-- Extends 0176; never updates historical split approvals, obligations or payments.
CREATE TABLE student_direct_live_release_requests (
  id bigserial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  academic_term_id integer NOT NULL REFERENCES academic_terms(id),
  rule_id bigint NOT NULL REFERENCES subscription_rule_proposals(id),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  facts_digest text NOT NULL CHECK(facts_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL UNIQUE CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  merchant_evidence_reference text NOT NULL CHECK(length(trim(merchant_evidence_reference)) BETWEEN 8 AND 300),
  merchant_evidence_hash text NOT NULL CHECK(merchant_evidence_hash ~ '^[a-f0-9]{64}$'),
  policy text NOT NULL CHECK(policy='NEW_ONLY_PRESERVE_LEGACY'),
  no_split_confirmed boolean NOT NULL CHECK(no_split_confirmed),
  expires_at timestamptz NOT NULL,
  created_by integer NOT NULL REFERENCES app_users(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days')
);
CREATE TABLE student_direct_live_release_decisions (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES student_direct_live_release_requests(id),
  action text NOT NULL CHECK(action IN ('REVIEWED','APPROVED','REJECTED','EXPIRED')),
  actor_user_id integer NOT NULL REFERENCES app_users(id),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_direct_release_latest_decision
  ON student_direct_live_release_decisions(request_id,id DESC);
CREATE TABLE student_direct_live_review_bindings (
  review_id bigint PRIMARY KEY REFERENCES student_direct_live_reviews(id),
  request_id bigint NOT NULL UNIQUE REFERENCES student_direct_live_release_requests(id),
  rule_version integer NOT NULL CHECK(rule_version>0),
  release text NOT NULL CHECK(release='STUDENT_DIRECT_3200_V1'),
  environment text NOT NULL CHECK(environment='LIVE'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER student_direct_release_request_history BEFORE UPDATE OR DELETE
  ON student_direct_live_release_requests FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER student_direct_release_decision_history BEFORE UPDATE OR DELETE
  ON student_direct_live_release_decisions FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER student_direct_release_binding_history BEFORE UPDATE OR DELETE
  ON student_direct_live_review_bindings FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
