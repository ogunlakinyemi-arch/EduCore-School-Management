-- Extend the existing replacement and finance ledgers. Historical student records are unchanged.
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS employee_id integer;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS employee_id integer;
ALTER TABLE student_nfc_replacement_requests ADD COLUMN IF NOT EXISTS employee_id integer;
ALTER TABLE fee_invoices ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE fee_payments ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE student_nfc_replacement_requests ALTER COLUMN student_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='fee_invoices'::regclass AND conname='fee_invoices_person_check') THEN
    ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoices_person_check CHECK((student_id IS NULL)<>(employee_id IS NULL));
    ALTER TABLE fee_invoices ADD CONSTRAINT fee_invoices_employee_school_fk FOREIGN KEY(employee_id,school_id) REFERENCES employees(id,school_id);
    ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_person_check CHECK((student_id IS NULL)<>(employee_id IS NULL));
    ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_employee_school_fk FOREIGN KEY(employee_id,school_id) REFERENCES employees(id,school_id);
    ALTER TABLE student_nfc_replacement_requests ADD CONSTRAINT replacement_person_check CHECK((student_id IS NULL)<>(employee_id IS NULL));
    ALTER TABLE student_nfc_replacement_requests ADD CONSTRAINT replacement_employee_school_fk FOREIGN KEY(employee_id,school_id) REFERENCES employees(id,school_id);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION preserve_fee_payment_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_student integer; invoice_employee integer;
BEGIN
  SELECT student_id,employee_id INTO invoice_student,invoice_employee FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice identity missing'; END IF;
  IF NEW.employee_id IS NULL AND NEW.student_id IS NULL THEN NEW.employee_id:=invoice_employee; END IF;
  IF NEW.student_id IS DISTINCT FROM invoice_student OR NEW.employee_id IS DISTINCT FROM invoice_employee THEN
    RAISE EXCEPTION 'Payment and invoice cardholder identities must match';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fee_payment_person_guard ON fee_payments;
CREATE TRIGGER fee_payment_person_guard BEFORE INSERT OR UPDATE OF invoice_id,school_id,student_id,employee_id
  ON fee_payments FOR EACH ROW EXECUTE FUNCTION preserve_fee_payment_person();
CREATE OR REPLACE FUNCTION preserve_replacement_old_uid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM student_nfc_replacement_requests r WHERE r.old_card_id=NEW.id)
    AND NEW.status NOT IN ('lost','blocked','inactive','suspended','replaced') THEN
    RAISE EXCEPTION 'A replacement old UID is permanently revoked';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS replacement_old_uid_guard ON nfc_cards;
CREATE TRIGGER replacement_old_uid_guard BEFORE UPDATE OF status ON nfc_cards
  FOR EACH ROW EXECUTE FUNCTION preserve_replacement_old_uid();
CREATE OR REPLACE FUNCTION preserve_employee_replacement_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('ASSIGNED','ACTIVE','LOCKED') AND EXISTS(
    SELECT 1 FROM employee_nfc_card_bindings b JOIN nfc_cards c ON c.id=b.nfc_card_id AND c.school_id=b.school_id
    WHERE b.employee_id=NEW.employee_id AND b.school_id=NEW.school_id AND b.nfc_card_id<>NEW.nfc_card_id
      AND c.status IN ('lost','replaced')) AND NOT EXISTS(
    SELECT 1 FROM student_nfc_replacement_requests r JOIN fee_invoices i ON i.id=r.invoice_id AND i.school_id=r.school_id
    WHERE r.employee_id=NEW.employee_id AND r.school_id=NEW.school_id AND r.new_card_id=NEW.nfc_card_id
      AND r.status='ISSUED' AND i.status='PAID' AND i.total_minor=200000 AND i.paid_minor=200000 AND i.outstanding_minor=0
      AND (SELECT COALESCE(sum(p.amount_minor),0) FROM fee_payments p JOIN fee_receipts receipt ON receipt.payment_id=p.id AND receipt.school_id=p.school_id
        WHERE p.invoice_id=i.id AND p.school_id=i.school_id AND p.employee_id=r.employee_id AND p.status='VERIFIED'
          AND NOT EXISTS(SELECT 1 FROM fee_refunds f WHERE f.payment_id=p.id AND f.school_id=p.school_id AND f.status IN ('PENDING','APPROVED','PROCESSING','COMPLETED','RECONCILIATION_REQUIRED')))=200000
  ) THEN RAISE EXCEPTION 'Employee replacement requires paid evidence and Owner issuance'; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS employee_replacement_gate ON employee_nfc_card_bindings;
CREATE CONSTRAINT TRIGGER employee_replacement_gate AFTER INSERT OR UPDATE OF status ON employee_nfc_card_bindings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_employee_replacement_gate();