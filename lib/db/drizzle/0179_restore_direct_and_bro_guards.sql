-- FORWARD-ONLY SOURCE ARTIFACT. Validate only on an independently verified disposable fixture.
-- Does NOT authorize execution on Production or installation through startup/build hooks.
-- Exact function bodies and trigger events from approved 0176/0177/0178.
-- CREATE OR REPLACE retains function identity and existing grants; no table/row changes.
-- PostgreSQL 14+ required for CREATE OR REPLACE TRIGGER. Entire repair is transactional.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION public.guard_student_direct_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Direct LIVE history is append-only'; END $$;
CREATE OR REPLACE FUNCTION public.guard_student_direct_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Direct LIVE attempts cannot be deleted'; END IF;
  IF (NEW.obligation_id,NEW.reference,NEW.idempotency_key,NEW.created_by,NEW.created_at)
       IS DISTINCT FROM (OLD.obligation_id,OLD.reference,OLD.idempotency_key,OLD.created_by,OLD.created_at)
     OR OLD.state IN ('PAID','FAILED') THEN RAISE EXCEPTION 'Direct LIVE attempt history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_bro_term_commission_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BRO term commission evidence is append-only'; END $$;
CREATE OR REPLACE FUNCTION public.guard_bro_term_commission_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o
    JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
    JOIN school_partner_attributions at ON at.id=NEW.attribution_id AND at.school_id=o.school_id
      AND at.partner_profile_id=NEW.partner_profile_id
    JOIN subscription_rule_proposals p ON p.id=NEW.policy_id AND p.product='BRO_COMMISSION'
      AND p.status IN ('ACTIVE','SCHEDULED') AND p.amount_minor=15000 AND p.activated_at IS NOT NULL
    WHERE o.id=NEW.direct_obligation_id AND a.id=NEW.direct_attempt_id
      AND o.school_id=NEW.school_id AND o.student_id=NEW.student_id AND o.academic_term_id=NEW.academic_term_id
      AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0 AND o.currency='NGN'
      AND a.state='PAID' AND a.verified_at=NEW.earned_at AND a.provider_transaction_id IS NOT NULL
      AND p.effective_at<=(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
      AND (p.ends_at IS NULL OR p.ends_at>(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'))
  ) THEN RAISE EXCEPTION 'Independent BRO earning scope or approval is invalid'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER student_direct_review_history BEFORE UPDATE OR DELETE ON public.student_direct_live_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER student_direct_obligation_history BEFORE UPDATE OR DELETE ON public.student_direct_live_obligations
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER student_direct_event_history BEFORE UPDATE OR DELETE ON public.student_direct_live_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER student_direct_attempt_history BEFORE UPDATE OR DELETE ON public.student_direct_live_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_attempt();
CREATE OR REPLACE TRIGGER student_direct_release_request_history BEFORE UPDATE OR DELETE ON public.student_direct_live_release_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER student_direct_release_decision_history BEFORE UPDATE OR DELETE ON public.student_direct_live_release_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER student_direct_release_binding_history BEFORE UPDATE OR DELETE ON public.student_direct_live_review_bindings
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history();
CREATE OR REPLACE TRIGGER bro_term_commission_append_only BEFORE UPDATE OR DELETE ON public.bro_term_commission_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_bro_term_commission_history();
CREATE OR REPLACE TRIGGER bro_term_commission_scope_guard BEFORE INSERT ON public.bro_term_commission_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.guard_bro_term_commission_scope();

-- A previously disabled trigger must not remain silently disabled after replacement.
ALTER TABLE public.student_direct_live_reviews ENABLE TRIGGER student_direct_review_history;
ALTER TABLE public.student_direct_live_obligations ENABLE TRIGGER student_direct_obligation_history;
ALTER TABLE public.student_direct_live_events ENABLE TRIGGER student_direct_event_history;
ALTER TABLE public.student_direct_live_attempts ENABLE TRIGGER student_direct_attempt_history;
ALTER TABLE public.student_direct_live_release_requests ENABLE TRIGGER student_direct_release_request_history;
ALTER TABLE public.student_direct_live_release_decisions ENABLE TRIGGER student_direct_release_decision_history;
ALTER TABLE public.student_direct_live_review_bindings ENABLE TRIGGER student_direct_release_binding_history;
ALTER TABLE public.bro_term_commission_entitlements ENABLE TRIGGER bro_term_commission_append_only;
ALTER TABLE public.bro_term_commission_entitlements ENABLE TRIGGER bro_term_commission_scope_guard;
COMMIT;
