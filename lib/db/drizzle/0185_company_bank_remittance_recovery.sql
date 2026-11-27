-- REVIEW SOURCE ONLY. Never run automatically or against an application database.
-- Requires 0181/0182. No seeds, settings, financial updates or provider operations.
BEGIN;
SET LOCAL lock_timeout='3s';
LOCK TABLE current_bulk_allocations IN ACCESS EXCLUSIVE MODE;
CREATE TABLE current_bank_credits (
 batch_id bigint PRIMARY KEY REFERENCES current_payment_batches(id),
 bank_name text NOT NULL CHECK(length(btrim(bank_name)) BETWEEN 2 AND 100),
 statement_reference text NOT NULL CHECK(statement_reference ~ '^[A-Za-z0-9/._ -]{6,120}$'),
 normalized_reference text NOT NULL UNIQUE
   CHECK(normalized_reference=lower(regexp_replace(statement_reference,'[[:space:]]','','g'))
     AND length(normalized_reference)>=6 AND normalized_reference ~ '[a-z0-9]'),
 credit_date date NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor%320000=0),
 independently_checked boolean NOT NULL CHECK(independently_checked IS TRUE),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 request_key text NOT NULL UNIQUE, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 verified_by integer NOT NULL REFERENCES app_users(id),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE current_bulk_allocation_releases (
 allocation_id bigint PRIMARY KEY REFERENCES current_bulk_allocations(id),
 event_id bigint NOT NULL REFERENCES current_bulk_events(id),
 released_by integer NOT NULL REFERENCES app_users(id),
 released_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE current_bulk_checkout_attempts (
 id bigserial PRIMARY KEY, batch_id bigint NOT NULL REFERENCES current_payment_batches(id),
 reference text NOT NULL UNIQUE CHECK(reference ~ '^SCV4_live_bulk_[A-Za-z0-9_-]{8,70}$'),
 request_key text NOT NULL UNIQUE,
 previous_transaction_id text NOT NULL CHECK(previous_transaction_id ~ '^[1-9][0-9]{0,15}$'),
 evidence jsonb NOT NULL CHECK((CASE WHEN jsonb_typeof(evidence)='object'
   AND jsonb_typeof(evidence->'status')='string' AND evidence->>'status' IN ('failed','cancelled')
   AND jsonb_typeof(evidence->'chargedAmountMinor')='number'
   THEN (evidence->>'chargedAmountMinor')::numeric=0 ELSE false END) IS TRUE),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 created_by integer NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Mutable uniqueness index, NOT financial evidence. Backfill only these index
-- entries from retained allocations under the lock; do not reprice any record.
CREATE TABLE current_bulk_term_claims (
 student_id integer NOT NULL, academic_term_id integer NOT NULL,
 allocation_id bigint NOT NULL UNIQUE REFERENCES current_bulk_allocations(id),
 PRIMARY KEY(student_id,academic_term_id)
);
INSERT INTO current_bulk_term_claims(student_id,academic_term_id,allocation_id)
 SELECT student_id,academic_term_id,id FROM current_bulk_allocations;
-- Keep immutable allocation history, but cancelled *unpaid bank* reservations
-- may be released through separately retained, strictly checked release evidence.
ALTER TABLE current_bulk_allocations ALTER COLUMN review_id DROP NOT NULL;
ALTER TABLE current_bulk_allocations DROP CONSTRAINT current_bulk_allocations_student_id_academic_term_id_key;

CREATE OR REPLACE FUNCTION guard_current_bulk_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='current_bulk_allocations' THEN
  IF EXISTS(SELECT 1 FROM current_payment_batches b WHERE b.id=NEW.batch_id AND b.snapshot->>'method'='COMPANY_BANK') THEN
   IF NEW.review_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM current_payment_batches b
     JOIN academic_terms t ON t.id=b.academic_term_id AND t.school_id=b.school_id
     JOIN students s ON s.id=NEW.student_id AND s.school_id=b.school_id
     WHERE b.id=NEW.batch_id AND b.school_id=NEW.school_id AND t.id=NEW.academic_term_id
       AND lower(s.status)='active' AND upper(s.admission_status)='ADMITTED'
       AND b.amount_minor=jsonb_array_length(b.snapshot->'students')::bigint*320000
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.snapshot->'students') v
         WHERE (v->>'studentId')::int=NEW.student_id AND (v->>'amountMinor')::int=320000))
   THEN RAISE EXCEPTION 'Company bank allocation scope mismatch'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM current_payment_batches b
    JOIN academic_terms t ON t.id=b.academic_term_id AND t.school_id=b.school_id
    JOIN students s ON s.id=NEW.student_id AND s.school_id=b.school_id
    JOIN student_direct_live_reviews r ON r.id=NEW.review_id AND r.school_id=b.school_id AND r.academic_term_id=t.id
    WHERE b.id=NEW.batch_id AND b.school_id=NEW.school_id AND t.id=NEW.academic_term_id
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.snapshot->'students') v
        WHERE (v->>'studentId')::int=NEW.student_id AND (v->>'reviewId')::bigint=NEW.review_id))
   THEN RAISE EXCEPTION 'Aggregate allocation scope mismatch'; END IF;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM current_bulk_allocations a
    JOIN (SELECT batch_id,verified_at,amount_minor FROM current_bulk_confirmations
      UNION ALL SELECT batch_id,verified_at,amount_minor FROM current_bank_credits) c ON c.batch_id=a.batch_id
    JOIN current_payment_batches b ON b.id=c.batch_id AND b.amount_minor=c.amount_minor
    JOIN academic_terms t ON t.id=a.academic_term_id AND t.school_id=a.school_id
    JOIN school_partner_attributions at ON at.id=NEW.attribution_id AND at.school_id=a.school_id AND at.partner_profile_id=NEW.partner_profile_id
    JOIN subscription_rule_proposals p ON p.id=NEW.policy_id AND p.product='BRO_COMMISSION'
      AND p.status IN ('ACTIVE','SCHEDULED') AND p.amount_minor=15000 AND p.activated_at IS NOT NULL
    WHERE a.id=NEW.allocation_id AND a.school_id=NEW.school_id AND a.student_id=NEW.student_id
      AND a.academic_term_id=NEW.academic_term_id AND c.verified_at=NEW.earned_at
      AND p.effective_at<=t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'
      AND (p.ends_at IS NULL OR p.ends_at>t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
      AND EXISTS(SELECT 1 FROM current_bulk_events ev WHERE ev.allocation_id=a.id AND ev.state='POSTED'))
  THEN RAISE EXCEPTION 'Aggregate BRO source mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_current_bank_workflow() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b current_payment_batches%ROWTYPE; normalized text;
BEGIN
 IF TG_TABLE_NAME='current_bulk_allocations' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('direct-student:'||NEW.school_id||':'||NEW.student_id||':'||NEW.academic_term_id,0));
  IF EXISTS(SELECT 1 FROM current_bulk_allocations a WHERE a.student_id=NEW.student_id AND a.academic_term_id=NEW.academic_term_id
    AND NOT EXISTS(SELECT 1 FROM current_bulk_allocation_releases r WHERE r.allocation_id=a.id))
    OR EXISTS(SELECT 1 FROM student_subscription_terms t WHERE t.student_id=NEW.student_id AND t.academic_term_id=NEW.academic_term_id)
    OR EXISTS(SELECT 1 FROM subscription_payment_assistance_requests ar WHERE ar.student_id=NEW.student_id
      AND ar.academic_term_id=NEW.academic_term_id AND ar.status<>'CANCELLED')
    OR EXISTS(SELECT 1 FROM student_direct_live_obligations o WHERE o.student_id=NEW.student_id AND o.academic_term_id=NEW.academic_term_id
      AND (o.assistance_request_id IS NOT NULL OR o.amount_minor<>320000 OR EXISTS(
        SELECT 1 FROM student_direct_live_attempts a WHERE a.obligation_id=o.id AND a.state<>'FAILED')))
  THEN RAISE EXCEPTION 'Student term already reserved or paid'; END IF;
 ELSIF TG_TABLE_NAME='current_bulk_allocation_releases' THEN
  IF NOT EXISTS(SELECT 1 FROM current_bulk_allocations a JOIN current_payment_batches b ON b.id=a.batch_id
    JOIN current_bulk_events e ON e.id=NEW.event_id AND e.batch_id=b.id AND e.actor_user_id=NEW.released_by
    WHERE a.id=NEW.allocation_id AND b.snapshot->>'method'='COMPANY_BANK'
      AND e.state IN ('CANCELLED','REJECTED') AND length(btrim(e.details->>'reason')) BETWEEN 3 AND 500
      AND NOT EXISTS(SELECT 1 FROM current_bank_credits c WHERE c.batch_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM current_bulk_confirmations c WHERE c.batch_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM current_bulk_events p WHERE p.batch_id=b.id AND p.state='POSTED'))
  THEN RAISE EXCEPTION 'Only uncredited bank reservations can be released'; END IF;
  DELETE FROM current_bulk_term_claims WHERE allocation_id=NEW.allocation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active reservation index requires reconciliation'; END IF;
 ELSIF TG_TABLE_NAME='current_bank_credits' THEN
  SELECT * INTO b FROM current_payment_batches WHERE id=NEW.batch_id FOR SHARE;
  IF b.snapshot->>'method' IS DISTINCT FROM 'COMPANY_BANK' OR NEW.amount_minor<>b.amount_minor
    OR NEW.credit_date>(clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date
     OR NOT EXISTS(SELECT 1 FROM academic_terms t WHERE t.id=b.academic_term_id AND t.school_id=b.school_id
       AND NEW.credit_date BETWEEN t.start_date AND t.end_date)
    OR (SELECT count(*)*320000 FROM current_bulk_allocations a WHERE a.batch_id=b.id)<>b.amount_minor
    OR EXISTS(SELECT 1 FROM current_bulk_allocations a JOIN current_bulk_allocation_releases r ON r.allocation_id=a.id WHERE a.batch_id=b.id)
    OR COALESCE((SELECT state FROM current_bulk_events e WHERE e.batch_id=b.id AND e.allocation_id IS NULL ORDER BY id DESC LIMIT 1),'')<>'REQUESTED'
    OR NOT EXISTS(SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
      WHERE u.id=NEW.verified_by AND u.status='ACTIVE' AND m.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL)
  THEN RAISE EXCEPTION 'Invalid independently checked aggregate company credit'; END IF;
  normalized:=NEW.normalized_reference;
 ELSE
  IF NEW.status<>'BANK_VERIFIED' THEN RETURN NEW; END IF;
  normalized:=lower(regexp_replace(NEW.bank_statement_reference,'[[:space:]]','','g'));
 END IF;
 IF normalized IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('company-credit:'||normalized,0));
  IF TG_TABLE_NAME='current_bank_credits' AND EXISTS(SELECT 1 FROM subscription_payment_assistance_requests a
    WHERE a.status='BANK_VERIFIED' AND lower(regexp_replace(a.bank_statement_reference,'[[:space:]]','','g'))=normalized)
    OR TG_TABLE_NAME='subscription_payment_assistance_requests' AND EXISTS(
      SELECT 1 FROM current_bank_credits c WHERE c.normalized_reference=normalized)
  THEN RAISE EXCEPTION 'Company bank reference already used'; END IF;
  IF TG_TABLE_NAME='subscription_payment_assistance_requests' THEN
   IF EXISTS(SELECT 1 FROM subscription_payment_assistance_requests ar WHERE ar.id<>NEW.id AND ar.status='BANK_VERIFIED'
     AND lower(regexp_replace(ar.bank_statement_reference,'[[:space:]]','','g'))=normalized)
   THEN RAISE EXCEPTION 'Company bank reference already used'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_current_bulk_term_claims() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='current_bulk_allocations' THEN
  INSERT INTO current_bulk_term_claims(student_id,academic_term_id,allocation_id)
    VALUES(NEW.student_id,NEW.academic_term_id,NEW.id);
  RETURN NEW;
 END IF;
 IF pg_trigger_depth()<>2 OR TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'Active reservation index is managed only by allocation/release triggers';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT EXISTS(SELECT 1 FROM current_bulk_allocations a WHERE a.id=NEW.allocation_id
   AND a.student_id=NEW.student_id AND a.academic_term_id=NEW.academic_term_id) THEN
  RAISE EXCEPTION 'Active reservation index scope mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER current_bulk_claim_index AFTER INSERT ON current_bulk_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_current_bulk_term_claims();
CREATE TRIGGER current_bulk_claim_index_protection BEFORE INSERT OR UPDATE OR DELETE ON current_bulk_term_claims
 FOR EACH ROW EXECUTE FUNCTION guard_current_bulk_term_claims();
CREATE TRIGGER current_bank_credit_scope BEFORE INSERT ON current_bank_credits FOR EACH ROW EXECUTE FUNCTION guard_current_bank_workflow();
CREATE TRIGGER current_bulk_reservation_scope BEFORE INSERT ON current_bulk_allocations FOR EACH ROW EXECUTE FUNCTION guard_current_bank_workflow();
CREATE TRIGGER current_bulk_release_scope BEFORE INSERT ON current_bulk_allocation_releases FOR EACH ROW EXECUTE FUNCTION guard_current_bank_workflow();
CREATE TRIGGER current_legacy_bank_reference_scope BEFORE INSERT OR UPDATE ON subscription_payment_assistance_requests
 FOR EACH ROW EXECUTE FUNCTION guard_current_bank_workflow();
CREATE TRIGGER current_bank_credits_history BEFORE UPDATE OR DELETE ON current_bank_credits FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER current_bulk_allocation_releases_history BEFORE UPDATE OR DELETE ON current_bulk_allocation_releases FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
CREATE TRIGGER current_bulk_checkout_attempts_history BEFORE UPDATE OR DELETE ON current_bulk_checkout_attempts FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history();
COMMIT;
