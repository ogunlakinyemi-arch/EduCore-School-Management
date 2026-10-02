#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---finance}"
case "$MODE" in
  --finance)
    TEST_CONFIG="vitest.finance-integration.config.ts"
    TEST_FILE="src/routes/finance-postgres.integration.test.ts"
    ;;
  --nfc-current-record)
    TEST_CONFIG="vitest.config.ts"
    TEST_FILE="src/routes/attendance-nfc-current-record.integration.test.ts"
    ;;
  *) echo "Use --finance or --nfc-current-record" >&2; exit 1 ;;
esac
MIGRATIONS_DIR="$ROOT_DIR/lib/db/drizzle"
for command_name in initdb pg_ctl psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required PostgreSQL utility not found: $command_name" >&2
    exit 1
  fi
done

PG_BIN="$(dirname "$(command -v initdb)")"
TMP_DIR="$(mktemp -d /tmp/finance-ledger.XXXXXX)"
DATA_DIR="$TMP_DIR/data"
SOCKET_DIR="$TMP_DIR/socket"
PORT="$((54000 + ($$ % 10000)))"
mkdir "$SOCKET_DIR"

cleanup() {
  # This guard makes cleanup incapable of targeting any path other than this
  # test's freshly-created disposable cluster beneath /tmp.
  if [[ "$TMP_DIR" == /tmp/finance-ledger.* && -d "$DATA_DIR" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ "$TMP_DIR" == /tmp/finance-ledger.* ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT

# No TCP listener is enabled. The database is initialized in the test-owned
# temp directory and all client connections use its private Unix socket.
"$PG_BIN/initdb" -D "$DATA_DIR" --auth=trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" \
  -o "-F -h '' -k $SOCKET_DIR -p $PORT -c listen_addresses=''" -w start >/dev/null

LOCAL_DB_USER="$(id -un)"
psql_local() {
  # Ignore inherited libpq/service configuration so this test can never
  # accidentally connect to a developer, shared, or production database.
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    psql -X -q -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" \
      -U "$LOCAL_DB_USER" -d postgres "$@"
}

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql)
if ((${#migrations[@]} == 0)); then
  echo "No checked-in SQL migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi
for migration in "${migrations[@]}"; do
  echo "Applying $(basename "$migration") to disposable local cluster"
  psql_local -c "SET client_min_messages=WARNING" -f "$migration" >/dev/null
done

psql_local <<'SQL'
-- Fixtures use authentic foreign-key-linked school and family records.
INSERT INTO schools (id, code, name, city, state)
VALUES
  (1, 'LEDGER-IT-001', 'Ledger Integration School', 'Lagos', 'Lagos'),
  (2, 'LEDGER-IT-002', 'Other Ledger Integration School', 'Abuja', 'FCT');

INSERT INTO app_users (id, clerk_user_id, email, first_name, last_name)
VALUES
  (1, 'ledger-admin', 'finance-admin@example.invalid', 'Ada', 'Accountant'),
  (2, 'ledger-parent-one', 'parent-one@example.invalid', 'Sam', 'Guardian'),
  (3, 'ledger-parent-two', 'parent-two@example.invalid', 'Lee', 'Guardian'),
  (4, 'ledger-teacher', 'teacher@example.invalid', 'Taylor', 'Teacher'),
  (5, 'ledger-partner', 'partner@example.invalid', 'Pat', 'Partner'),
  (6, 'ledger-student-one', 'student-one@example.invalid', 'Tomi', 'Student'),
  (7, 'ledger-student-two', 'student-two@example.invalid', 'Mina', 'Student'),
  (8, 'ledger-school-admin', 'school-admin@example.invalid', 'Alex', 'Admin'),
  (9, 'ledger-platform-owner', 'platform-owner@example.invalid', 'Morgan', 'Owner');
INSERT INTO school_memberships (id, user_id, school_id, role, status)
VALUES
  (1, 1, 1, 'ACCOUNTANT', 'ACTIVE'),
  (2, 4, 1, 'TEACHER', 'ACTIVE'),
  (3, 5, NULL, 'PARTNER', 'ACTIVE'),
  (4, 8, 1, 'SCHOOL_ADMIN', 'ACTIVE'),
  (5, 9, NULL, 'PLATFORM_OWNER', 'ACTIVE');

INSERT INTO school_classes (id, school_id, name, section)
VALUES
  (1, 1, 'Primary 4', 'Blue'),
  (2, 2, 'Primary 4', 'Blue'),
  (3, 1, 'Primary 4', 'Green');
INSERT INTO students (id, school_id, user_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES
  (1, 1, 6, 'LEDGER-STU-001', 'Tomi', 'Student', 'OTHER', 'Primary 4', 'Blue'),
  (2, 2, 7, 'LEDGER-STU-002', 'Mina', 'Student', 'OTHER', 'Primary 4', 'Blue');
INSERT INTO parents (id, school_id, user_id, name, email, phone)
VALUES
  (1, 1, 2, 'Sam Guardian', 'parent-one@example.invalid', '+2348000000000'),
  (2, 2, 3, 'Lee Guardian', 'parent-two@example.invalid', '+2348000000001');
INSERT INTO parent_student_relationships
  (id, parent_id, student_id, relationship_type, is_primary_guardian, status)
VALUES
  (1, 1, 1, 'Parent', true, 'ACTIVE'),
  (2, 2, 2, 'Parent', true, 'ACTIVE');
INSERT INTO academic_sessions (id, school_id, name, start_date, end_date)
VALUES
  (1, 1, '2025/2026', '2025-09-01', '2026-08-31'),
  (2, 2, '2025/2026', '2025-09-01', '2026-08-31');
INSERT INTO academic_terms (id, school_id, academic_session_id, name, start_date, end_date)
VALUES
  (1, 1, 1, 'First Term', '2025-09-01', '2025-12-20'),
  (2, 2, 2, 'First Term', '2025-09-01', '2025-12-20');
INSERT INTO fee_school_settings
  (school_id, partial_payments_enabled, bank_transfer_enabled, bank_name,
   bank_account_name, bank_account_number, updated_by)
VALUES
  (1, true, true, 'Example Bank', 'Ledger Integration School', '1234567890', 1),
  (2, true, true, 'Example Bank', 'Other Ledger Integration School', '1234567891', 1);

INSERT INTO fee_categories (id, school_id, name, description, compulsory, created_by)
VALUES
  (1, 1, 'Tuition', 'Term tuition', true, 1),
  (2, 2, 'Tuition', 'Term tuition', true, 1);
INSERT INTO fee_structures
  (id, school_id, academic_session_id, academic_term_id, school_class_id, section,
   version, status, created_by, published_by, published_at)
VALUES
  (1, 1, 1, 1, 1, 'Blue', 1, 'PUBLISHED', 1, 1, '2025-08-20T09:00:00Z'),
  (2, 1, 1, 1, 1, 'Blue', 2, 'PUBLISHED', 1, 1, '2025-08-21T09:00:00Z'),
  (3, 2, 2, 2, 2, 'Blue', 1, 'PUBLISHED', 1, 1, '2025-08-20T09:00:00Z'),
  (4, 1, 1, 1, 3, 'Green', 1, 'PUBLISHED', 1, 1, '2025-09-20T09:00:00Z');
INSERT INTO fee_structure_lines
  (id, school_id, structure_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES
  (1, 1, 1, 1, 'Tuition', 'First term tuition', 10000),
  (2, 1, 2, 1, 'Tuition', 'First term tuition route invoice', 10000),
  (3, 2, 3, 2, 'Tuition', 'Other school first term tuition', 5000),
  (4, 1, 4, 1, 'Tuition', 'Green section tuition', 2000);

INSERT INTO fee_invoices
  (id, school_id, student_id, parent_id, structure_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot, class_name_snapshot, section_snapshot,
   issue_date, due_date, subtotal_minor, total_minor, outstanding_minor, status, created_by)
VALUES
  (1, 1, 1, 1, 1, 1, 1, 'LEDGER-INV-001', 'Tomi Student', 'LEDGER-STU-001',
   'Primary 4', 'Blue', '2025-09-01', '2025-09-30', 10000, 10000, 10000, 'UNPAID', 1);
INSERT INTO fee_invoice_lines
  (id, school_id, invoice_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES (1, 1, 1, 1, 'Tuition', 'First term tuition', 10000);

-- Dedicated route-test invoice uses the same real school/class/session/term context.
INSERT INTO fee_invoices
  (id, school_id, student_id, parent_id, structure_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot, class_name_snapshot, section_snapshot,
   issue_date, due_date, subtotal_minor, total_minor, outstanding_minor, status, created_by)
VALUES
  (2, 1, 1, 1, 2, 1, 1, 'LEDGER-HTTP-INV-002', 'Tomi Student', 'LEDGER-STU-001',
   'Primary 4', 'Blue', '2025-09-01', '2025-09-30', 10000, 10000, 10000, 'UNPAID', 1);
INSERT INTO fee_invoice_lines
  (id, school_id, invoice_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES (2, 1, 2, 1, 'Tuition', 'HTTP lifecycle route-test tuition', 10000);

INSERT INTO fee_invoices
  (id, school_id, student_id, parent_id, structure_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot, class_name_snapshot, section_snapshot,
   issue_date, due_date, subtotal_minor, total_minor, paid_minor, outstanding_minor, status, created_by)
VALUES
  (3, 2, 2, 2, 3, 2, 2, 'LEDGER-OTHER-INV-003', 'Mina Student', 'LEDGER-STU-002',
   'Primary 4', 'Blue', '2025-09-01', '2025-09-30', 5000, 5000, 2500, 2500, 'PARTIALLY_PAID', 1),
  (4, 1, 1, 1, 4, 1, 1, 'LEDGER-GREEN-INV-004', 'Tomi Student', 'LEDGER-STU-001',
   'Primary 4', 'Green', '2025-10-10', '2025-10-31', 2000, 2000, 0, 2000, 'UNPAID', 1);
INSERT INTO fee_invoice_lines
  (id, school_id, invoice_id, category_id, category_name_snapshot, description_snapshot, amount_minor)
VALUES
  (3, 2, 3, 2, 'Tuition', 'Other school first term tuition', 5000),
  (4, 1, 4, 1, 'Tuition', 'Green section tuition', 2000);

INSERT INTO fee_payments
  (id, school_id, invoice_id, student_id, parent_id, reference, idempotency_key,
   amount_minor, currency, method, status, transfer_bank, transfer_reference, transfer_date,
   submitted_by, verified_by, verified_at, verification_evidence_ref, reviewer_notes, verification_metadata)
VALUES (50, 2, 3, 2, 2, 'LEDGER-OTHER-PAY-050', 'ledger-other-payment-050', 2500, 'NGN',
  'BANK_TRANSFER', 'VERIFIED', 'Example Bank', 'OTHER-BANK-050', '2025-09-08', 3, 8,
  '2025-09-08T12:00:00Z', 'OTHER-EVIDENCE-050', 'Other school bank transfer confirmed',
  '{"source":"other-school-bank"}'::jsonb);
INSERT INTO fee_receipts (id, school_id, payment_id, invoice_id, receipt_number, snapshot)
VALUES (50, 2, 50, 3, 'OTHER-RCP-050',
  '{"invoiceId":3,"schoolId":2,"amountMinor":2500,"currency":"NGN"}');
INSERT INTO fee_refunds
  (id, school_id, payment_id, invoice_id, reference, idempotency_key, amount_minor, currency,
   reason, status, requested_by)
VALUES (50, 2, 50, 3, 'OTHER-REF-050', 'other-refund-050', 500, 'NGN',
  'Other school pending refund', 'PENDING', 8);
INSERT INTO fee_payment_notifications
  (id, school_id, payment_id, invoice_id, recipient_user_id, recipient_role, event_type)
VALUES (50, 2, 50, 3, 3, 'PARENT', 'PAYMENT_VERIFIED');
INSERT INTO fee_payment_notification_outbox
  (id, school_id, payment_id, invoice_id, event_type, event_reference_id, last_error)
VALUES (50, 2, 50, 3, 'PAYMENT_VERIFIED', 0, 'Other school test event');

-- A manual bank transfer begins pending; two settled partial payments take
-- the invoice through PARTIALLY_PAID to PAID. Extra pending and failed history
-- must not affect invoice balances or collection totals.
INSERT INTO fee_payments
  (id, school_id, invoice_id, student_id, parent_id, reference, idempotency_key,
   amount_minor, currency, method, status, transfer_bank, transfer_reference, transfer_date, submitted_by)
VALUES
  (1, 1, 1, 1, 1, 'LEDGER-PAY-001', 'ledger-idem-001', 3000, 'NGN', 'BANK_TRANSFER', 'PENDING',
   'Example Bank', 'LEDGER-BANK-001', '2025-09-05', 2),
  (2, 1, 1, 1, 1, 'LEDGER-PAY-002', 'ledger-idem-002', 7000, 'NGN', 'BANK_TRANSFER', 'PENDING',
   'Example Bank', 'LEDGER-BANK-002', '2025-09-06', 2),
  (3, 1, 1, 1, 1, 'LEDGER-PAY-003', 'ledger-idem-003', 500, 'NGN', 'BANK_TRANSFER', 'FAILED',
   'Example Bank', 'LEDGER-BANK-003', '2025-09-07', 2),
  (4, 1, 1, 1, 1, 'LEDGER-PAY-004', 'ledger-idem-004', 200, 'NGN', 'BANK_TRANSFER', 'PENDING',
   'Example Bank', 'LEDGER-BANK-004', '2025-09-08', 2);

UPDATE fee_payments SET status='VERIFIED', verified_by=1, verified_at='2025-09-05T12:00:00Z',
  verification_evidence_ref='LEDGER-EVIDENCE-001', reviewer_notes='Matched bank statement',
  verification_metadata='{"source":"bank-statement","batch":"2025-09"}'::jsonb
WHERE id=1;
UPDATE fee_invoices SET paid_minor=3000, outstanding_minor=7000, status='PARTIALLY_PAID' WHERE id=1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fee_invoices WHERE id=1 AND paid_minor=3000
      AND outstanding_minor=7000 AND status='PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'partial payment balance/status assertion failed';
  END IF;
  IF (SELECT COUNT(*) FROM fee_payments WHERE id=1 AND status='VERIFIED'
      AND verification_evidence_ref='LEDGER-EVIDENCE-001') <> 1 THEN
    RAISE EXCEPTION 'manual payment verification assertion failed';
  END IF;
END;
$$;

UPDATE fee_payments SET status='VERIFIED', verified_by=1, verified_at='2025-09-06T12:00:00Z',
  verification_evidence_ref='LEDGER-EVIDENCE-002', reviewer_notes='Matched second bank statement',
  verification_metadata='{"source":"bank-statement","batch":"2025-09"}'::jsonb
WHERE id=2;
UPDATE fee_invoices SET paid_minor=10000, outstanding_minor=0, status='PAID' WHERE id=1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fee_invoices WHERE id=1 AND paid_minor=10000
      AND outstanding_minor=0 AND status='PAID') THEN
    RAISE EXCEPTION 'full payment balance/status assertion failed';
  END IF;
END;
$$;
INSERT INTO fee_receipts (id, school_id, payment_id, invoice_id, receipt_number, snapshot)
VALUES (1, 1, 2, 1, 'LEDGER-RCP-001',
  '{"invoiceNumber":"LEDGER-INV-001","student":"Tomi Student","amountMinor":7000,"currency":"NGN"}');

-- Approved internal ledger records preserve original payment/receipt rows.
INSERT INTO fee_refunds
  (id, school_id, payment_id, invoice_id, transaction_type, reference, idempotency_key,
   amount_minor, currency, reason, status, requested_by, approved_by, evidence_reference,
   reviewer_notes, approved_at)
VALUES
  (1, 1, 1, 1, 'REFUND', 'LEDGER-REF-001', 'ledger-refund-idem-001', 1000, 'NGN',
   'Overpayment adjustment', 'APPROVED', 1, 1, 'LEDGER-REFUND-EVIDENCE-001',
   'Bank refund confirmed', '2025-09-10T12:00:00Z'),
  (2, 1, 2, 1, 'REVERSAL', 'LEDGER-REV-001', 'ledger-reversal-idem-001', 7000, 'NGN',
   'Duplicate transfer reversed', 'APPROVED', 1, 1, 'LEDGER-REV-EVIDENCE-001',
   'Full transfer reversal confirmed', '2025-09-11T12:00:00Z');
UPDATE fee_payments SET status='REVERSED' WHERE id=2;
UPDATE fee_invoices SET paid_minor=2000, outstanding_minor=8000, status='PARTIALLY_PAID' WHERE id=1;

INSERT INTO fee_payment_notifications
  (id, school_id, payment_id, invoice_id, recipient_user_id, recipient_role, event_type)
VALUES (1, 1, 1, 1, 2, 'PARENT', 'PAYMENT_VERIFIED');
INSERT INTO fee_payment_notifications
  (id, school_id, payment_id, invoice_id, event_type, event_reference_id, recipient_user_id, recipient_role)
VALUES
  (2, 1, 1, 1, 'REFUND_APPROVED', 1, 2, 'PARENT'),
  (3, 1, 2, 1, 'REVERSAL_APPROVED', 2, 2, 'PARENT');
INSERT INTO fee_payment_notification_outbox
  (id, school_id, payment_id, invoice_id, event_type, event_reference_id, metadata, last_error)
VALUES
  (1, 1, 1, 1, 'PAYMENT_VERIFIED', 0, '{"parentUserId":2}', 'delivery pending'),
  (2, 1, 1, 1, 'REFUND_APPROVED', 1, '{"refundId":1}', 'delivery pending'),
  (3, 1, 2, 1, 'REVERSAL_APPROVED', 2, '{"refundId":2}', 'delivery pending');

INSERT INTO audit_logs
  ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id,
   severity, event_type, result, metadata)
VALUES ('Ada Accountant', 'ACCOUNTANT', 1, 'ledger-admin', 1, 'approved refund and reversal',
  'Finance', 1, 'info', 'FINANCE_EVENT', 'SUCCESS',
  '{"refundId":1,"reversalId":2,"paymentIds":[1,2]}');

-- Independent report/balance expectations (same published report semantics,
-- computed directly from source ledgers rather than application helpers).
DO $$
DECLARE r record;
BEGIN
  SELECT i.total_minor AS billed,
    i.paid_minor AS invoice_paid, i.outstanding_minor AS outstanding, i.status,
    (SELECT COALESCE(SUM(GREATEST(p.amount_minor - COALESCE((
       SELECT SUM(fr.amount_minor) FROM fee_refunds fr
       WHERE fr.payment_id=p.id AND fr.school_id=p.school_id AND fr.status='APPROVED'
    ),0),0)),0)
     FROM fee_payments p WHERE p.invoice_id=i.id AND p.school_id=i.school_id
       AND p.status IN ('VERIFIED','REFUNDED','REVERSED')) AS net_collected,
    (SELECT COALESCE(SUM(amount_minor),0) FROM fee_refunds
       WHERE invoice_id=i.id AND school_id=i.school_id AND status='APPROVED'
         AND transaction_type='REFUND') AS refunded,
    (SELECT COALESCE(SUM(amount_minor),0) FROM fee_refunds
       WHERE invoice_id=i.id AND school_id=i.school_id AND status='APPROVED'
         AND transaction_type='REVERSAL') AS reversed,
    (SELECT COUNT(*) FROM fee_payments WHERE invoice_id=i.id AND status='PENDING') AS pending_count
  INTO r FROM fee_invoices i WHERE i.id=1;

  IF r.billed <> 10000 OR r.invoice_paid <> 2000 OR r.outstanding <> 8000
     OR r.status <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'invoice lifecycle totals incorrect: %', row_to_json(r);
  END IF;
  IF r.net_collected <> 2000 OR r.refunded <> 1000 OR r.reversed <> 7000
     OR r.pending_count <> 1 THEN
    RAISE EXCEPTION 'independent reporting ledger totals incorrect: %', row_to_json(r);
  END IF;

  IF (SELECT COUNT(*) FROM fee_payments WHERE invoice_id=1 AND status='VERIFIED') <> 1
     OR (SELECT COUNT(*) FROM fee_payments WHERE invoice_id=1 AND status='REVERSED') <> 1
     OR (SELECT COUNT(*) FROM fee_payments WHERE invoice_id=1 AND status='FAILED') <> 1
     OR (SELECT COUNT(*) FROM fee_payments WHERE invoice_id=1 AND status='PENDING') <> 1 THEN
    RAISE EXCEPTION 'payment lifecycle/history rows not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM fee_receipts WHERE payment_id=2 AND receipt_number='LEDGER-RCP-001') <> 1 THEN
    RAISE EXCEPTION 'receipt missing after payment reversal';
  END IF;
  IF (SELECT COUNT(*) FROM audit_logs WHERE school_id=1 AND module='Finance'
      AND event_type='FINANCE_EVENT') <> 1 THEN
    RAISE EXCEPTION 'finance audit row missing';
  END IF;
END;
$$;

-- Prove real database uniqueness/check/FK constraints. Notice/outbox retries
-- use ON CONFLICT DO NOTHING and are explicitly asserted idempotent.
DO $$
DECLARE rejected boolean; violated_constraint text;
BEGIN
  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_payments
      (id, school_id, invoice_id, student_id, reference, idempotency_key, amount_minor,
       method, status, submitted_by)
    VALUES (100, 1, 1, 1, 'LEDGER-PAY-001', 'ledger-dupe-ref', 10, 'REMITA', 'PENDING', 1);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_payments_reference_key' THEN
    RAISE EXCEPTION 'duplicate payment reference did not hit its intended unique constraint: %', violated_constraint;
  END IF;

  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_refunds
      (id, school_id, payment_id, invoice_id, reference, idempotency_key, amount_minor,
       currency, reason, requested_by)
    VALUES (100, 1, 1, 1, 'LEDGER-REF-001', 'ledger-ref-dupe-key', 100, 'NGN', 'duplicate', 1);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_refunds_reference_unique' THEN
    RAISE EXCEPTION 'duplicate refund reference did not hit its intended unique constraint: %', violated_constraint;
  END IF;

  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_receipts (id, school_id, payment_id, invoice_id, receipt_number, snapshot)
    VALUES (100, 1, 2, 1, 'LEDGER-RCP-DUP', '{}');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_receipts_payment_unique' THEN
    RAISE EXCEPTION 'duplicate receipt payment did not hit its intended unique constraint: %', violated_constraint;
  END IF;

  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_receipts (id, school_id, payment_id, invoice_id, receipt_number, snapshot)
    VALUES (101, 1, 4, 1, 'LEDGER-RCP-001', '{}');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_receipts_school_number_unique' THEN
    RAISE EXCEPTION 'duplicate receipt number did not hit its intended unique constraint: %', violated_constraint;
  END IF;
  IF EXISTS (SELECT 1 FROM fee_receipts WHERE receipt_number='LEDGER-RCP-DUP') THEN
    RAISE EXCEPTION 'receipt insert survived rejected duplicate-number transaction';
  END IF;

  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_payments
      (id, school_id, invoice_id, student_id, reference, idempotency_key, amount_minor,
       method, status, submitted_by, transfer_bank, transfer_reference, transfer_date)
    VALUES (101, 1, 1, 1, 'LEDGER-PAY-BAD', 'ledger-bad-status', 10,
       'BANK_TRANSFER', 'VERIFIED', 1, 'Example Bank', 'LEDGER-BAD-XFER', '2025-09-12');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_payments_verified_evidence_check' THEN
    RAISE EXCEPTION 'missing verified evidence did not hit its intended check constraint: %', violated_constraint;
  END IF;

  rejected := false;
  violated_constraint := NULL;
  BEGIN
    INSERT INTO fee_payment_notifications
      (id, school_id, payment_id, invoice_id, recipient_user_id, recipient_role, event_type)
    VALUES (100, 1, 1, 1, 2, 'PARENT', 'PAYMENT_VERIFIED');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    rejected := true;
  END;
  IF NOT rejected OR violated_constraint IS DISTINCT FROM 'fee_payment_notifications_delivery_unique' THEN
    RAISE EXCEPTION 'duplicate notification did not hit its intended unique constraint: %', violated_constraint;
  END IF;
END;
$$;

INSERT INTO fee_payment_notifications
  (id, school_id, payment_id, invoice_id, recipient_user_id, recipient_role, event_type)
VALUES (100, 1, 1, 1, 2, 'PARENT', 'PAYMENT_VERIFIED')
ON CONFLICT (payment_id, recipient_user_id, recipient_role, event_type, event_reference_id) DO NOTHING;
INSERT INTO fee_payment_notification_outbox
  (id, school_id, payment_id, invoice_id, event_type, event_reference_id, last_error)
VALUES (100, 1, 1, 1, 'PAYMENT_VERIFIED', 0, 'retry')
ON CONFLICT (payment_id, event_type, event_reference_id) DO NOTHING;
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM fee_payment_notifications
      WHERE payment_id=1 AND recipient_user_id=2 AND event_type='PAYMENT_VERIFIED') <> 1 THEN
    RAISE EXCEPTION 'notification retry was not idempotent';
  END IF;
  IF (SELECT COUNT(*) FROM fee_payment_notification_outbox
      WHERE payment_id=1 AND event_type='PAYMENT_VERIFIED' AND event_reference_id=0) <> 1 THEN
    RAISE EXCEPTION 'outbox retry was not idempotent';
  END IF;
END;
$$;

-- Route requests use real serial IDs and therefore start beyond explicit fixtures.
DO $$
BEGIN
  PERFORM setval(pg_get_serial_sequence('fee_payments','id'), 50, true);
  PERFORM setval(pg_get_serial_sequence('fee_receipts','id'), 50, true);
  PERFORM setval(pg_get_serial_sequence('fee_refunds','id'), 50, true);
  PERFORM setval(pg_get_serial_sequence('fee_payment_notifications','id'), 50, true);
  PERFORM setval(pg_get_serial_sequence('fee_payment_notification_outbox','id'), 50, true);
  PERFORM setval(pg_get_serial_sequence('audit_logs','id'), 1, true);
END;
$$;
SQL

SOCKET_URL="${SOCKET_DIR//\//%2F}"
DATABASE_URL="postgresql://${LOCAL_DB_USER}@/postgres?host=${SOCKET_URL}&port=${PORT}"
echo "Running focused $MODE integration test on the disposable Unix-socket database"
env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C NODE_ENV=test DATABASE_URL="$DATABASE_URL" \
  pnpm --filter @workspace/api-server exec vitest run \
    --config "$TEST_CONFIG" "$TEST_FILE"

echo "PASS: SQL and $MODE integration assertions completed on disposable PostgreSQL."