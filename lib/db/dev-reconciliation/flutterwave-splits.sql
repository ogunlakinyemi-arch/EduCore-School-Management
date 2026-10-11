-- Additive Development rehearsal/application only. No historical payments are backfilled.
CREATE TABLE flutterwave_split_recipients (
 id serial PRIMARY KEY, kind text NOT NULL, school_id integer REFERENCES schools(id),
 partner_profile_id integer REFERENCES partner_profiles(id), entity_name text NOT NULL,
 bank_ciphertext text NOT NULL, bank_fingerprint text NOT NULL, account_last4 text NOT NULL,
 bank_name text NOT NULL, status text NOT NULL DEFAULT 'BANK_RESOLVED',
 provider_id integer, provider_subaccount_id text, submitted_by integer NOT NULL REFERENCES app_users(id),
 reviewed_by integer REFERENCES app_users(id), review_note text, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT flw_recipient_scope_ck CHECK ((kind='SCHOOL' AND school_id IS NOT NULL AND partner_profile_id IS NULL) OR (kind='PARTNER' AND partner_profile_id IS NOT NULL AND school_id IS NULL)),
 CONSTRAINT flw_recipient_state_ck CHECK (status IN ('BANK_RESOLVED','CREATING','CREATION_UNKNOWN','TEST_READY','SUSPENDED','RETIRED')),
 CONSTRAINT flw_recipient_ready_ck CHECK (status<>'TEST_READY' OR (provider_id IS NOT NULL AND provider_id>0 AND provider_subaccount_id IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX flw_recipient_school_uq ON flutterwave_split_recipients(school_id) WHERE status<>'RETIRED';
CREATE UNIQUE INDEX flw_recipient_partner_uq ON flutterwave_split_recipients(partner_profile_id) WHERE status<>'RETIRED';
CREATE UNIQUE INDEX flw_recipient_bank_uq ON flutterwave_split_recipients(bank_fingerprint) WHERE status<>'RETIRED';
CREATE UNIQUE INDEX flw_recipient_provider_uq ON flutterwave_split_recipients(provider_subaccount_id);
CREATE UNIQUE INDEX flw_recipient_provider_id_uq ON flutterwave_split_recipients(provider_id);
CREATE TABLE flutterwave_split_settings (
 school_id integer PRIMARY KEY REFERENCES schools(id), enabled boolean NOT NULL DEFAULT false,
 automatic_settlement_confirmed boolean NOT NULL DEFAULT false,
 reviewed_by integer NOT NULL REFERENCES app_users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT flw_settings_ready_ck CHECK (NOT enabled OR automatic_settlement_confirmed)
);
CREATE TABLE flutterwave_split_payments (
 payment_id integer PRIMARY KEY REFERENCES student_subscription_payments(id),
 school_id integer NOT NULL REFERENCES schools(id), student_id integer NOT NULL REFERENCES students(id),
 subscription_id integer NOT NULL REFERENCES subscriptions(id),
 session_id integer NOT NULL REFERENCES academic_sessions(id), term_id integer NOT NULL REFERENCES academic_terms(id),
 reference text NOT NULL UNIQUE, school_recipient_id integer NOT NULL REFERENCES flutterwave_split_recipients(id),
 partner_recipient_id integer REFERENCES flutterwave_split_recipients(id),
 partner_profile_id integer REFERENCES partner_profiles(id), attribution_id integer REFERENCES school_partner_attributions(id),
 commission_rule_id integer REFERENCES commission_rules(id), instructions jsonb NOT NULL,
 school_amount_minor integer NOT NULL DEFAULT 200000, partner_amount_minor integer NOT NULL DEFAULT 0,
 platform_amount_minor integer NOT NULL, currency text NOT NULL DEFAULT 'NGN',
 status text NOT NULL DEFAULT 'CHECKOUT_FROZEN', provider_fee_minor integer, provider_additional_fee_minor integer,
 reconciliation_note text, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT flw_split_amounts_ck CHECK (school_amount_minor=200000 AND currency='NGN' AND
 ((partner_recipient_id IS NULL AND partner_profile_id IS NULL AND attribution_id IS NULL AND commission_rule_id IS NULL AND partner_amount_minor=0 AND platform_amount_minor=300000)
 OR (partner_recipient_id IS NOT NULL AND partner_profile_id IS NOT NULL AND attribution_id IS NOT NULL AND commission_rule_id IS NOT NULL AND partner_amount_minor=10000 AND platform_amount_minor=290000))),
 CONSTRAINT flw_split_status_ck CHECK (status IN ('CHECKOUT_FROZEN','COLLECTION_PAID','COLLECTION_FAILED','COLLECTION_EXCEPTION','REPORT_EXCEPTION','TEST_PROVIDER_REPORTED_COMPLETE','REFUND_REVIEW','REFUNDED')),
 CONSTRAINT flw_split_costs_ck CHECK ((provider_fee_minor IS NULL OR provider_fee_minor>=0) AND (provider_additional_fee_minor IS NULL OR provider_additional_fee_minor>=0))
);
CREATE TABLE flutterwave_split_settlements (
 id serial PRIMARY KEY, payment_id integer NOT NULL REFERENCES flutterwave_split_payments(payment_id),
 recipient_id integer NOT NULL REFERENCES flutterwave_split_recipients(id), expected_amount_minor integer NOT NULL,
 observed_amount_minor integer, provider_settlement_id text, status text NOT NULL DEFAULT 'UNVERIFIED', exception text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT flw_settlement_amount_ck CHECK (expected_amount_minor IN (200000,10000) AND (observed_amount_minor IS NULL OR observed_amount_minor>=0)),
 CONSTRAINT flw_settlement_status_ck CHECK (status IN ('UNVERIFIED','PENDING','FAILED','MISMATCH','TEST_PROVIDER_REPORTED_COMPLETE'))
);
CREATE UNIQUE INDEX flw_settlement_payment_recipient_uq ON flutterwave_split_settlements(payment_id,recipient_id);
CREATE UNIQUE INDEX flw_settlement_report_payment_recipient_uq ON flutterwave_split_settlements(provider_settlement_id,payment_id,recipient_id);
CREATE TABLE flutterwave_split_adjustments (
 id serial PRIMARY KEY, payment_id integer NOT NULL REFERENCES flutterwave_split_payments(payment_id),
 idempotency_key text NOT NULL UNIQUE, amount_minor integer NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'REQUESTING', provider_refund_id text UNIQUE,
 recovery_status text NOT NULL DEFAULT 'NOT_APPLIED', school_recovery_minor integer,
 partner_recovery_minor integer, platform_reversal_minor integer,
 created_by integer NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT flw_refund_amount_ck CHECK (amount_minor BETWEEN 10000 AND 500000),
 CONSTRAINT flw_refund_status_ck CHECK (status IN ('REQUESTING','OUTCOME_UNKNOWN','PROCESSING','CONFIRMED','FAILED')),
 CONSTRAINT flw_refund_recovery_ck CHECK (recovery_status IN ('NOT_APPLIED','RECIPIENT_RECOVERY_REVIEW'))
);
-- Tenant/snapshot checks intentionally use existing authoritative payment bindings.
CREATE FUNCTION flw_guard_split_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p student_subscription_payments; sr flutterwave_split_recipients; pr flutterwave_split_recipients;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','provider_fee_minor','provider_additional_fee_minor','reconciliation_note'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','provider_fee_minor','provider_additional_fee_minor','reconciliation_note']) THEN
   RAISE EXCEPTION 'Split financial snapshot is immutable';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO p FROM student_subscription_payments WHERE id=NEW.payment_id;
 IF p.id IS NULL OR p.status<>'PENDING' OR p.provider<>'FLUTTERWAVE' OR p.provider_mode<>'SANDBOX'
  OR p.gross_amount_minor<>500000 OR p.currency<>'NGN'
  OR ROW(p.school_id,p.student_id,p.subscription_id,p.academic_session_id,p.academic_term_id,p.reference)
    IS DISTINCT FROM ROW(NEW.school_id,NEW.student_id,NEW.subscription_id,NEW.session_id,NEW.term_id,NEW.reference) THEN
  RAISE EXCEPTION 'Split snapshot does not match its pending TEST payment';
 END IF;
 SELECT * INTO sr FROM flutterwave_split_recipients WHERE id=NEW.school_recipient_id;
 IF sr.school_id IS DISTINCT FROM NEW.school_id OR sr.status<>'TEST_READY' THEN
  RAISE EXCEPTION 'Unverified or foreign school recipient';
 END IF;
 IF NEW.partner_recipient_id IS NOT NULL THEN
  SELECT * INTO pr FROM flutterwave_split_recipients WHERE id=NEW.partner_recipient_id;
  IF pr.partner_profile_id IS DISTINCT FROM NEW.partner_profile_id OR pr.status<>'TEST_READY'
    OR NOT EXISTS(SELECT 1 FROM school_partner_attributions a JOIN partner_profiles pp ON pp.id=a.partner_profile_id
     WHERE a.id=NEW.attribution_id AND a.school_id=NEW.school_id AND a.partner_profile_id=NEW.partner_profile_id
      AND a.is_current AND a.status='ACTIVE' AND pp.status='ACTIVE'
      AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()))
    OR NOT EXISTS(SELECT 1 FROM commission_rules c WHERE c.id=NEW.commission_rule_id AND c.status='ACTIVE'
      AND c.currency='NGN' AND c.allocation_total=5000 AND c.school_amount=2000 AND c.partner_amount=100 AND c.edupulse_amount=2900
      AND c.effective_at<=now() AND (c.ends_at IS NULL OR c.ends_at>now())
      AND (c.term IS NULL OR c.term=(SELECT term FROM subscriptions WHERE id=NEW.subscription_id))) THEN
   RAISE EXCEPTION 'Partner split lacks authoritative eligibility';
  END IF;
 END IF;
 IF NEW.instructions IS DISTINCT FROM
   (jsonb_build_array(jsonb_build_object('id',sr.provider_subaccount_id,'transaction_charge_type','flat_subaccount','transaction_charge',2000))
    || CASE WHEN NEW.partner_recipient_id IS NULL THEN '[]'::jsonb
       ELSE jsonb_build_array(jsonb_build_object('id',pr.provider_subaccount_id,'transaction_charge_type','flat_subaccount','transaction_charge',100)) END) THEN
  RAISE EXCEPTION 'Split instructions differ from verified recipients or fixed amounts';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER flw_guard_split_snapshot BEFORE INSERT OR UPDATE ON flutterwave_split_payments
 FOR EACH ROW EXECUTE FUNCTION flw_guard_split_snapshot();
CREATE FUNCTION flw_guard_recipient_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.kind,NEW.school_id,NEW.partner_profile_id,NEW.entity_name,NEW.bank_ciphertext,NEW.bank_fingerprint,NEW.account_last4,NEW.submitted_by)
   IS DISTINCT FROM ROW(OLD.kind,OLD.school_id,OLD.partner_profile_id,OLD.entity_name,OLD.bank_ciphertext,OLD.bank_fingerprint,OLD.account_last4,OLD.submitted_by)
  OR (OLD.provider_subaccount_id IS NOT NULL AND ROW(NEW.provider_id,NEW.provider_subaccount_id) IS DISTINCT FROM ROW(OLD.provider_id,OLD.provider_subaccount_id)) THEN
  RAISE EXCEPTION 'Recipient identity and verified provider binding are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER flw_guard_recipient_history BEFORE UPDATE ON flutterwave_split_recipients
 FOR EACH ROW EXECUTE FUNCTION flw_guard_recipient_history();
CREATE FUNCTION flw_guard_settlement_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p flutterwave_split_payments;
BEGIN
 SELECT * INTO p FROM flutterwave_split_payments WHERE payment_id=NEW.payment_id;
 IF NOT ((NEW.recipient_id=p.school_recipient_id AND NEW.expected_amount_minor=p.school_amount_minor)
   OR (NEW.recipient_id=p.partner_recipient_id AND NEW.expected_amount_minor=p.partner_amount_minor)) IS TRUE THEN
  RAISE EXCEPTION 'Recipient settlement is not bound to the frozen split';
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.payment_id,NEW.recipient_id,NEW.expected_amount_minor)
   IS DISTINCT FROM ROW(OLD.payment_id,OLD.recipient_id,OLD.expected_amount_minor) THEN
  RAISE EXCEPTION 'Recipient settlement binding is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER flw_guard_settlement_binding BEFORE INSERT OR UPDATE ON flutterwave_split_settlements
 FOR EACH ROW EXECUTE FUNCTION flw_guard_settlement_binding();
