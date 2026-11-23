-- REVIEW PACKAGE ONLY. NOT EXECUTED OR CONNECTED BY THIS TOOL.
-- Separate target, recovery, SQL-console and publication approval required.
-- Functions/triggers only; structural tables use the reviewed Publish flow.
-- PostgreSQL 14+; keep release/send gates closed. Never run at startup/build.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;
DO $operator$ BEGIN
 IF current_user<>'neondb_owner' OR current_setting('server_version_num')::int<140000 THEN
 RAISE EXCEPTION 'Requires approved managed-database owner and PostgreSQL 14+; target identity still needs independent approval';
 END IF;
END $operator$;
CREATE OR REPLACE FUNCTION public.guard_current_bulk_scope() RETURNS trigger LANGUAGE plpgsql AS $$
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
COMMIT;
