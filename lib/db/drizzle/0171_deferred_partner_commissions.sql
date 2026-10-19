-- Development review migration. No historical allocations or ledger rows are rewritten.
BEGIN;
ALTER TABLE commission_ledger ADD COLUMN payment_id integer REFERENCES student_subscription_payments(id);
ALTER TABLE flutterwave_split_payments ADD COLUMN provider_flw_reference text;
CREATE UNIQUE INDEX deferred_split_flw_reference_uq ON flutterwave_split_payments(provider_flw_reference)
 WHERE provider_flw_reference IS NOT NULL;
CREATE TABLE deferred_commission_adverse_events (
 event_hash text PRIMARY KEY,
 payment_id integer NOT NULL REFERENCES student_subscription_payments(id),
 event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX deferred_commission_payment_uq ON commission_ledger(payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX deferred_commission_student_partner_term_uq
 ON commission_ledger(school_id,student_id,partner_profile_id,academic_session_id,term) WHERE payment_id IS NOT NULL;
CREATE TABLE partner_payout_batches (
 id serial PRIMARY KEY,
 idempotency_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','REVIEW_REQUIRED')),
 approved_by integer NOT NULL REFERENCES app_users(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 snapshot jsonb NOT NULL
);
CREATE TABLE partner_payout_batch_items (
 batch_id integer NOT NULL REFERENCES partner_payout_batches(id),
 commission_id integer NOT NULL UNIQUE REFERENCES commission_ledger(id),
 payout_id integer NOT NULL REFERENCES partner_payouts(id),
 PRIMARY KEY(batch_id,commission_id)
);
ALTER TABLE flutterwave_split_payments DROP CONSTRAINT flw_split_amounts_ck;
ALTER TABLE flutterwave_split_payments ADD CONSTRAINT flw_split_amounts_ck CHECK (
 currency='NGN' AND school_amount_minor=CASE WHEN left(reference,5) IN ('SCV2_','SCV3_') THEN 190000 ELSE 200000 END
 AND (
   (partner_recipient_id IS NULL AND partner_profile_id IS NULL AND attribution_id IS NULL
    AND commission_rule_id IS NULL AND partner_amount_minor=0 AND platform_amount_minor=500000-school_amount_minor)
   OR
   ((partner_recipient_id IS NOT NULL OR left(reference,5)='SCV3_')
    AND (left(reference,5)<>'SCV3_' OR partner_recipient_id IS NULL)
    AND partner_profile_id IS NOT NULL AND attribution_id IS NOT NULL AND commission_rule_id IS NOT NULL
    AND partner_amount_minor=10000 AND platform_amount_minor=490000-school_amount_minor)
 )
);
-- Read-only evidence, not a historical backfill or a claim of bank settlement.
CREATE VIEW deferred_partner_commission_evidence AS
 SELECT l.id,l.partner_profile_id,l.school_id,l.student_id,l.academic_session_id,l.term,l.amount,l.status,l.payout_id,
 p.id payment_id,p.reference,p.academic_term_id,t.end_date,pp.full_name partner_name,ses.name session_name,
 p.gross_amount_minor,s.school_amount_minor,s.provider_fee_minor,s.provider_additional_fee_minor,
 s.status split_status,p.settlement_status,
 (t.end_date < CURRENT_DATE) term_ended,
 (p.status='PAID' AND p.provider_transaction_id IS NOT NULL AND p.reconciliation_status='RECONCILED'
  AND p.provider='FLUTTERWAVE' AND p.provider_mode='SANDBOX'
  AND p.gross_amount_minor=500000 AND p.currency='NGN'
  AND sub.verification_status='verified' AND sub.status='active' AND sub.provider_reference=p.reference
  AND s.status IN ('COLLECTION_PAID','TEST_PROVIDER_REPORTED_COMPLETE')
  AND s.partner_recipient_id IS NULL AND s.partner_amount_minor=10000
  AND s.school_amount_minor=190000 AND s.platform_amount_minor=300000
  AND l.amount=100 AND l.currency='NGN' AND pp.status='ACTIVE'
  AND NOT EXISTS(SELECT 1 FROM flutterwave_split_adjustments a WHERE a.payment_id=p.id AND a.status<>'FAILED')
 ) verified_eligible
 FROM commission_ledger l
 JOIN student_subscription_payments p ON p.id=l.payment_id AND left(p.reference,5)='SCV3_'
  AND p.school_id=l.school_id AND p.student_id=l.student_id AND p.subscription_id=l.subscription_id
  AND p.academic_session_id=l.academic_session_id
 JOIN flutterwave_split_payments s ON s.payment_id=p.id AND s.reference=p.reference
  AND s.partner_profile_id=l.partner_profile_id AND s.school_id=p.school_id AND s.student_id=p.student_id
  AND s.subscription_id=p.subscription_id AND s.term_id=p.academic_term_id AND s.session_id=p.academic_session_id
 JOIN subscriptions sub ON sub.id=l.subscription_id
 JOIN academic_terms t ON t.id=p.academic_term_id AND t.school_id=p.school_id AND t.name=l.term
 JOIN academic_sessions ses ON ses.id=p.academic_session_id AND ses.school_id=p.school_id
 JOIN partner_profiles pp ON pp.id=l.partner_profile_id;

-- A late refund/exception immediately invalidates unexecuted approvals, including
-- those already exported. Keep immutable approval/export audit; never free a claim.
CREATE FUNCTION hold_deferred_partner_commission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment integer;
BEGIN
 IF TG_TABLE_NAME='student_subscription_payments' THEN
   target_payment := NEW.id;
   -- Finalization records the successful collection immediately after its ledger
   -- insert in the same transaction. The split is still CHECKOUT_FROZEN here.
   IF OLD.status<>'PAID' AND NEW.status='PAID' THEN RETURN NEW; END IF;
 ELSE
   target_payment := NEW.payment_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM commission_ledger WHERE payment_id=target_payment) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM deferred_partner_commission_evidence WHERE payment_id=target_payment AND verified_eligible)
 THEN RETURN NEW; END IF;
 UPDATE partner_payout_batches SET status='REVIEW_REQUIRED'
  WHERE id IN (SELECT bi.batch_id FROM partner_payout_batch_items bi
    JOIN commission_ledger l ON l.id=bi.commission_id WHERE l.payment_id=target_payment);
 UPDATE partner_payouts SET status='FAILED',notes=concat_ws(E'\n',notes,'Deferred commission exception: approval invalidated; reconcile any exported instructions')
  WHERE id IN (SELECT bi.payout_id FROM partner_payout_batch_items bi JOIN commission_ledger l ON l.id=bi.commission_id
    WHERE l.payment_id=target_payment) AND status IN ('PENDING','PROCESSING');
 UPDATE commission_ledger SET status=CASE WHEN status='PAID' THEN 'REVERSED' ELSE 'HELD' END,held_at=now(),
  reversed_at=CASE WHEN status='PAID' THEN now() ELSE reversed_at END
  WHERE payment_id=target_payment AND status NOT IN ('HELD','REVERSED','CANCELLED');
 RETURN NEW;
END $$;
CREATE TRIGGER deferred_commission_payment_exception
 AFTER UPDATE OF status,reconciliation_status ON student_subscription_payments
 FOR EACH ROW EXECUTE FUNCTION hold_deferred_partner_commission();
CREATE TRIGGER deferred_commission_split_exception
 AFTER UPDATE OF status ON flutterwave_split_payments
 FOR EACH ROW EXECUTE FUNCTION hold_deferred_partner_commission();
CREATE TRIGGER deferred_commission_adjustment_exception
 AFTER INSERT OR UPDATE OF status ON flutterwave_split_adjustments
 FOR EACH ROW EXECUTE FUNCTION hold_deferred_partner_commission();
COMMIT;
