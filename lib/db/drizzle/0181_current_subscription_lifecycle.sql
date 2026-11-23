-- CANDIDATE ONLY. Never run at startup. No shared application authorized.
-- Original direct payments, entitlement roots and legacy arrangements are untouched.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE current_subscription_operations (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('REFUND','BRO','BRO_PAYOUT','BRO_RECOVERY','BULK_PLAN')),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 100),
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_term_id integer NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  attempt_id bigint REFERENCES student_direct_live_attempts(id) ON DELETE RESTRICT,
  entitlement_id bigint REFERENCES bro_term_commission_entitlements(id) ON DELETE RESTRICT,
  parent_id bigint REFERENCES current_subscription_operations(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=9007199254740991),
  currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  created_by integer NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,request_key),
  CHECK(
    (kind='REFUND' AND attempt_id IS NOT NULL AND entitlement_id IS NULL AND parent_id IS NULL AND amount_minor<=320000)
    OR (kind='BRO' AND attempt_id IS NOT NULL AND entitlement_id IS NOT NULL AND parent_id IS NULL AND amount_minor=15000)
    OR (kind='BRO_PAYOUT' AND attempt_id IS NOT NULL AND entitlement_id IS NOT NULL AND parent_id IS NOT NULL AND amount_minor=15000)
    OR (kind='BRO_RECOVERY' AND attempt_id IS NOT NULL AND entitlement_id IS NOT NULL AND parent_id IS NOT NULL AND amount_minor<=15000)
    OR (kind='BULK_PLAN' AND attempt_id IS NULL AND entitlement_id IS NULL AND parent_id IS NULL AND amount_minor%320000=0)
  )
);
CREATE UNIQUE INDEX current_subscription_bro_root_uq
  ON current_subscription_operations(entitlement_id) WHERE kind='BRO';
CREATE TABLE current_subscription_operation_events (
  id bigserial PRIMARY KEY,
  operation_id bigint NOT NULL REFERENCES current_subscription_operations(id) ON DELETE RESTRICT,
  event_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN
    ('REQUESTED','APPROVED','PROCESSING','UNKNOWN','PENDING','SUCCEEDED','FAILED','REVERSED',
     'HELD','RECOVERY_REQUIRED','RECOVERY_RECORDED','REVIEW_ONLY')),
  actor_user_id integer REFERENCES app_users(id) ON DELETE RESTRICT,
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX current_subscription_operation_event_order
  ON current_subscription_operation_events(operation_id,id DESC);
CREATE TABLE current_subscription_reference_claims (
  namespace text NOT NULL CHECK(namespace IN ('REFUND','COLLECTION_REVERSAL','BRO_PAYOUT','BRO_RECOVERY')),
  reference text NOT NULL CHECK(reference=lower(btrim(reference)) AND length(reference) BETWEEN 3 AND 200),
  operation_id bigint NOT NULL REFERENCES current_subscription_operations(id) ON DELETE RESTRICT,
  PRIMARY KEY(namespace,reference)
);
-- Reuse, do not replace, the already required immutable-history function.
CREATE TRIGGER current_subscription_operations_history BEFORE UPDATE OR DELETE ON current_subscription_operations
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER current_subscription_events_history BEFORE UPDATE OR DELETE ON current_subscription_operation_events
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER current_subscription_claims_history BEFORE UPDATE OR DELETE ON current_subscription_reference_claims
  FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
COMMIT;
