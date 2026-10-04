-- Additive metadata only: historical creators remain unknown rather than guessed.
ALTER TABLE academic_sessions ADD COLUMN IF NOT EXISTS created_by integer REFERENCES app_users(id);
ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS created_by integer REFERENCES app_users(id);
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS selected_line_ids integer[];
CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_cash_evidence_unique
  ON fee_payments(school_id,lower(btrim(verification_evidence_ref))) WHERE method='CASH';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fee_payments_cash_evidence_check' AND conrelid='fee_payments'::regclass) THEN
    ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_cash_evidence_check CHECK(method<>'CASH' OR
      (verified_by IS NOT NULL AND verified_at IS NOT NULL AND length(btrim(verification_evidence_ref))>=3
       AND length(btrim(reviewer_notes))>=3 AND verification_metadata IS NOT NULL));
  END IF;
END $$;

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_method_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fee_payments_method_with_cash_check' AND conrelid='fee_payments'::regclass) THEN
    ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_method_with_cash_check CHECK(method IN ('BANK_TRANSFER','REMITA','FLUTTERWAVE','PAYSTACK','CASH'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fee_payment_line_allocations (
  id serial PRIMARY KEY,
  school_id integer NOT NULL,
  invoice_id integer NOT NULL,
  payment_id integer NOT NULL,
  line_id integer NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id,line_id),
  FOREIGN KEY(payment_id,invoice_id,school_id) REFERENCES fee_payments(id,invoice_id,school_id),
  FOREIGN KEY(line_id,school_id) REFERENCES fee_invoice_lines(id,school_id)
);

CREATE OR REPLACE FUNCTION allocate_verified_fee_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record; due bigint; count_lines integer; selected_count integer;
BEGIN
  IF TG_OP='UPDATE' AND OLD.selected_line_ids IS DISTINCT FROM NEW.selected_line_ids THEN
    RAISE EXCEPTION 'Payment fee selection is immutable';
  END IF;
  IF NEW.status<>'VERIFIED' OR (TG_OP='UPDATE' AND OLD.status='VERIFIED') THEN RETURN NEW; END IF;
  SELECT * INTO inv FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id FOR UPDATE;
  -- Existing discounts or unallocated historical partial receipts are never silently apportioned.
  SELECT COALESCE(SUM(a.amount_minor),0) INTO due FROM fee_payment_line_allocations a
    JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id
    WHERE a.invoice_id=inv.id AND a.school_id=inv.school_id AND p.status='VERIFIED';
  IF inv.discount_minor+inv.waiver_minor>0 OR inv.paid_minor<>due THEN
    IF NEW.selected_line_ids IS NOT NULL THEN RAISE EXCEPTION 'Fee lines require explicit allocation of existing adjustments/payments'; END IF;
    RETURN NEW;
  END IF;
  SELECT count(*),COALESCE(sum(l.amount_minor-COALESCE(paid.n,0)),0) INTO count_lines,due
    FROM fee_invoice_lines l LEFT JOIN LATERAL (
      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p
      ON p.id=a.payment_id AND p.school_id=a.school_id
      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'
    ) paid ON true
    WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id
      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))
      AND l.amount_minor>COALESCE(paid.n,0);
  IF NEW.selected_line_ids IS NOT NULL THEN
    SELECT count(DISTINCT x) INTO selected_count FROM unnest(NEW.selected_line_ids) x;
    IF count_lines<>selected_count OR selected_count<>cardinality(NEW.selected_line_ids) OR selected_count=0 OR due<>NEW.amount_minor THEN
      RAISE EXCEPTION 'Selected fee line balances do not match this payment';
    END IF;
  ELSIF due<>NEW.amount_minor THEN RETURN NEW;
  END IF;
  INSERT INTO fee_payment_line_allocations(school_id,invoice_id,payment_id,line_id,amount_minor)
    SELECT l.school_id,l.invoice_id,NEW.id,l.id,l.amount_minor-COALESCE(paid.n,0)
    FROM fee_invoice_lines l LEFT JOIN LATERAL (
      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p
      ON p.id=a.payment_id AND p.school_id=a.school_id
      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'
    ) paid ON true WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id
      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))
      AND l.amount_minor>COALESCE(paid.n,0);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fee_payment_allocate_lines ON fee_payments;
CREATE TRIGGER fee_payment_allocate_lines AFTER INSERT OR UPDATE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION allocate_verified_fee_lines();