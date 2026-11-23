-- SOURCE CANDIDATE ONLY. Apply only to disposable fixtures until separately approved.
-- No activation, automatic startup registration, seed or historical repricing.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE current_payment_batches (
 id bigserial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 academic_term_id integer NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
 reference text NOT NULL UNIQUE, request_key text NOT NULL UNIQUE,
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor%320000=0 AND amount_minor<=9007199254740991),
 currency text NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
 created_by integer NOT NULL REFERENCES app_users(id), snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE current_bulk_allocations (
 id bigserial PRIMARY KEY, batch_id bigint NOT NULL REFERENCES current_payment_batches(id),
 school_id integer NOT NULL REFERENCES schools(id), student_id integer NOT NULL REFERENCES students(id),
 academic_term_id integer NOT NULL REFERENCES academic_terms(id),
 amount_minor integer NOT NULL DEFAULT 320000 CHECK(amount_minor=320000),
 review_id bigint NOT NULL REFERENCES student_direct_live_reviews(id),
 UNIQUE(student_id,academic_term_id), UNIQUE(batch_id,student_id)
);
CREATE TABLE current_bulk_confirmations (
 batch_id bigint PRIMARY KEY REFERENCES current_payment_batches(id),
 provider_transaction_id text NOT NULL UNIQUE, provider_reference text NOT NULL UNIQUE,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), verified_at timestamptz NOT NULL DEFAULT now(),
 evidence jsonb NOT NULL
);
CREATE TABLE current_bulk_events (
 id bigserial PRIMARY KEY, batch_id bigint NOT NULL REFERENCES current_payment_batches(id),
 allocation_id bigint REFERENCES current_bulk_allocations(id), event_key text NOT NULL UNIQUE,
 state text NOT NULL, actor_user_id integer NOT NULL REFERENCES app_users(id),
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX current_bulk_posted_once ON current_bulk_events(allocation_id) WHERE state='POSTED';
CREATE TABLE current_bulk_bro_entitlements (
 id bigserial PRIMARY KEY, allocation_id bigint NOT NULL UNIQUE REFERENCES current_bulk_allocations(id),
 school_id integer NOT NULL REFERENCES schools(id), student_id integer NOT NULL REFERENCES students(id),
 academic_term_id integer NOT NULL REFERENCES academic_terms(id),
 partner_profile_id integer NOT NULL REFERENCES partner_profiles(id),
 attribution_id integer NOT NULL REFERENCES school_partner_attributions(id),
 policy_id bigint NOT NULL REFERENCES subscription_rule_proposals(id),
 amount_minor integer NOT NULL DEFAULT 15000 CHECK(amount_minor=15000),
 earned_at timestamptz NOT NULL, evidence jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES app_users(id), UNIQUE(student_id,academic_term_id)
);
ALTER TABLE current_subscription_operations
 ADD COLUMN allocation_id bigint REFERENCES current_bulk_allocations(id),
 ADD COLUMN bulk_entitlement_id bigint REFERENCES current_bulk_bro_entitlements(id);
ALTER TABLE current_subscription_operations DROP CONSTRAINT current_subscription_operations_check;
ALTER TABLE current_subscription_operations ADD CONSTRAINT current_subscription_source_ck CHECK (
 (kind='BULK_PLAN' AND attempt_id IS NULL AND allocation_id IS NULL
   AND entitlement_id IS NULL AND bulk_entitlement_id IS NULL AND parent_id IS NULL AND amount_minor%320000=0)
 OR (
   ((attempt_id IS NOT NULL AND allocation_id IS NULL AND bulk_entitlement_id IS NULL)
    OR (allocation_id IS NOT NULL AND attempt_id IS NULL AND entitlement_id IS NULL))
   AND (
    (kind='REFUND' AND entitlement_id IS NULL AND bulk_entitlement_id IS NULL AND parent_id IS NULL AND amount_minor<=320000)
    OR (kind='BRO' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NULL AND amount_minor=15000)
    OR (kind='BRO_PAYOUT' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NOT NULL AND amount_minor=15000)
    OR (kind='BRO_RECOVERY' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NOT NULL AND amount_minor<=15000)
   )
 )
);
CREATE UNIQUE INDEX current_subscription_bulk_bro_root_uq
 ON current_subscription_operations(bulk_entitlement_id) WHERE kind='BRO';
CREATE TABLE current_bro_withdrawals (
 id bigserial PRIMARY KEY, partner_profile_id integer NOT NULL REFERENCES partner_profiles(id),
 created_by integer NOT NULL REFERENCES app_users(id), request_key text NOT NULL UNIQUE,
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor%15000=0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500), snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE current_bro_withdrawal_lines (
 id bigserial PRIMARY KEY, request_id bigint NOT NULL REFERENCES current_bro_withdrawals(id),
 entitlement_id bigint UNIQUE REFERENCES bro_term_commission_entitlements(id),
 bulk_entitlement_id bigint UNIQUE REFERENCES current_bulk_bro_entitlements(id),
 journal_id bigint NOT NULL UNIQUE REFERENCES current_subscription_operations(id),
 CHECK((entitlement_id IS NOT NULL)::int+(bulk_entitlement_id IS NOT NULL)::int=1)
);
CREATE TABLE current_bro_withdrawal_decisions (
 line_id bigint PRIMARY KEY REFERENCES current_bro_withdrawal_lines(id),
 decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
 decided_by integer NOT NULL REFERENCES app_users(id), reason text NOT NULL,
 request_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bro_field_sms_permissions (
 id bigserial PRIMARY KEY, lead_id bigint NOT NULL REFERENCES bro_field_leads(id),
 allowed boolean NOT NULL, phone text NOT NULL, reason text NOT NULL, actor_user_id integer NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bro_field_sms_campaigns (
 id bigserial PRIMARY KEY, request_key text NOT NULL UNIQUE, message text NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 digest text NOT NULL, snapshot jsonb NOT NULL, created_by integer NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bro_field_sms_recipients (
 id bigserial PRIMARY KEY, campaign_id bigint NOT NULL REFERENCES bro_field_sms_campaigns(id),
 lead_id bigint NOT NULL REFERENCES bro_field_leads(id), phone text NOT NULL, school_name text NOT NULL,
 UNIQUE(campaign_id,phone), UNIQUE(campaign_id,lead_id)
);
CREATE TABLE bro_field_sms_events (
 id bigserial PRIMARY KEY, recipient_id bigint NOT NULL REFERENCES bro_field_sms_recipients(id),
 state text NOT NULL CHECK(state IN ('PROCESSING','UNKNOWN','ACCEPTED','DELIVERED','FAILED','EXCLUDED')),
 actor_user_id integer NOT NULL REFERENCES app_users(id), details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve and reuse the required existing append-only guard, never replace it.
DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['current_payment_batches','current_bulk_allocations','current_bulk_confirmations',
  'current_bulk_events','current_bulk_bro_entitlements','current_bro_withdrawals','current_bro_withdrawal_lines',
  'current_bro_withdrawal_decisions','bro_field_sms_permissions','bro_field_sms_campaigns',
  'bro_field_sms_recipients','bro_field_sms_events']
 LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history()',
    tab||'_history',tab);
 END LOOP;
END $$;
CREATE FUNCTION guard_current_bulk_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='current_bulk_allocations' THEN
  IF NOT EXISTS(SELECT 1 FROM current_payment_batches b
   JOIN academic_terms t ON t.id=b.academic_term_id AND t.school_id=b.school_id
   JOIN students s ON s.id=NEW.student_id AND s.school_id=b.school_id
   JOIN student_direct_live_reviews r ON r.id=NEW.review_id AND r.school_id=b.school_id AND r.academic_term_id=t.id
   WHERE b.id=NEW.batch_id AND b.school_id=NEW.school_id AND t.id=NEW.academic_term_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.snapshot->'students') v
     WHERE (v->>'studentId')::int=NEW.student_id AND (v->>'reviewId')::bigint=NEW.review_id))
  THEN RAISE EXCEPTION 'Aggregate allocation scope mismatch'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM current_bulk_allocations a
   JOIN current_bulk_confirmations c ON c.batch_id=a.batch_id
   JOIN current_payment_batches b ON b.id=c.batch_id AND b.amount_minor=c.amount_minor
   JOIN academic_terms t ON t.id=a.academic_term_id AND t.school_id=a.school_id
   JOIN school_partner_attributions at ON at.id=NEW.attribution_id AND at.school_id=a.school_id
     AND at.partner_profile_id=NEW.partner_profile_id
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
CREATE TRIGGER current_bulk_allocation_scope BEFORE INSERT ON current_bulk_allocations
 FOR EACH ROW EXECUTE FUNCTION guard_current_bulk_scope();
CREATE TRIGGER current_bulk_bro_scope BEFORE INSERT ON current_bulk_bro_entitlements
 FOR EACH ROW EXECUTE FUNCTION guard_current_bulk_scope();
COMMIT;
