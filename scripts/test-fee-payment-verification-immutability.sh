#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/lib/db/drizzle"

for command_name in initdb pg_ctl psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required PostgreSQL utility not found: $command_name" >&2
    exit 1
  fi
done

PG_BIN="$(dirname "$(command -v initdb)")"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fee-payment-immutability.XXXXXX")"
DATA_DIR="$TMP_DIR/data"
SOCKET_DIR="$TMP_DIR/socket"
PORT=55439
mkdir "$SOCKET_DIR"

cleanup() {
  if [[ -d "$DATA_DIR" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# The server accepts no TCP connections and stores all data in this disposable directory.
"$PG_BIN/initdb" -D "$DATA_DIR" --auth=trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" \
  -o "-F -h '' -k $SOCKET_DIR -p $PORT" -w start >/dev/null

psql_local() {
  env -u PGHOST -u PGPORT -u PGSERVICE \
    psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -U runner -d postgres "$@"
}

# Replay the checked-in migrations, including the migration that defines the trigger.
for migration in "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
  echo "Applying $(basename "$migration")"
  psql_local -f "$migration" >/dev/null
done

psql_local <<'SQL'
INSERT INTO schools (id, code, name, city, state)
VALUES (1, 'IMMUTABILITY-TEST', 'Disposable Test School', 'Test City', 'Test State');

INSERT INTO app_users (id, clerk_user_id, email, first_name, last_name)
VALUES
  (1, 'immutability-test-submitter', 'submitter@example.invalid', 'Test', 'Submitter'),
  (2, 'immutability-test-reviewer', 'reviewer@example.invalid', 'Test', 'Reviewer');

INSERT INTO students (id, school_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES (1, 1, 'TEST-001', 'Test', 'Student', 'OTHER', 'Test Class', 'A');

INSERT INTO academic_sessions (id, school_id, name, start_date, end_date)
VALUES (1, 1, 'Test Session', '2025-01-01', '2025-12-31');

INSERT INTO academic_terms (id, school_id, academic_session_id, name, start_date, end_date)
VALUES (1, 1, 1, 'Test Term', '2025-01-01', '2025-04-30');

INSERT INTO fee_invoices (
  id, school_id, student_id, academic_session_id, academic_term_id,
  invoice_number, student_name_snapshot, admission_no_snapshot,
  class_name_snapshot, section_snapshot, issue_date, due_date,
  subtotal_minor, total_minor, outstanding_minor, created_by
) VALUES (
  1, 1, 1, 1, 1, 'TEST-INVOICE-001', 'Test Student', 'TEST-001',
  'Test Class', 'A', '2025-01-01', '2025-01-31',
  1000, 1000, 1000, 1
);

INSERT INTO fee_payments (
  id, school_id, invoice_id, student_id, reference, idempotency_key,
  amount_minor, currency, method, status, transfer_bank, transfer_reference,
  transfer_date, submitted_by, verified_by, verified_at,
  verification_evidence_ref, reviewer_notes, verification_metadata
) VALUES (
  1, 1, 1, 1, 'TEST-PAYMENT-001', 'test-idempotency-001',
  1000, 'NGN', 'BANK_TRANSFER', 'VERIFIED', 'Test Bank', 'TEST-TRANSFER-001',
  '2025-01-02', 1, 2, '2025-01-03T10:00:00Z',
  'evidence-original-001', 'Confirmed against bank statement',
  '{"source":"disposable-regression","check":"original"}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'fee_payments_verification_metadata_immutable'
      AND tgrelid = 'fee_payments'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'checked-in immutability trigger was not installed';
  END IF;
END;
$$;

-- Each protected field is mutated independently, with the full row checked
-- against its original settled evidence after each rejected update.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE fee_payments
    SET verification_evidence_ref = 'tampered-evidence-001'
    WHERE id = 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'verified payment metadata is immutable' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'changing verification_evidence_ref was not rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fee_payments
    WHERE id = 1 AND status = 'VERIFIED' AND verified_by = 2
      AND verified_at = '2025-01-03T10:00:00Z'::timestamptz
      AND verification_evidence_ref = 'evidence-original-001'
      AND reviewer_notes = 'Confirmed against bank statement'
      AND verification_metadata =
        '{"source":"disposable-regression","check":"original"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'payment row changed after rejected evidence update';
  END IF;

  rejected := false;
  BEGIN
    UPDATE fee_payments
    SET reviewer_notes = 'Tampered reviewer notes'
    WHERE id = 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'verified payment metadata is immutable' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'changing reviewer_notes was not rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fee_payments
    WHERE id = 1 AND status = 'VERIFIED' AND verified_by = 2
      AND verified_at = '2025-01-03T10:00:00Z'::timestamptz
      AND verification_evidence_ref = 'evidence-original-001'
      AND reviewer_notes = 'Confirmed against bank statement'
      AND verification_metadata =
        '{"source":"disposable-regression","check":"original"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'payment row changed after rejected reviewer_notes update';
  END IF;

  rejected := false;
  BEGIN
    UPDATE fee_payments
    SET verification_metadata = '{"source":"tampered"}'::jsonb
    WHERE id = 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'verified payment metadata is immutable' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'changing verification_metadata was not rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fee_payments
    WHERE id = 1 AND status = 'VERIFIED' AND verified_by = 2
      AND verified_at = '2025-01-03T10:00:00Z'::timestamptz
      AND verification_evidence_ref = 'evidence-original-001'
      AND reviewer_notes = 'Confirmed against bank statement'
      AND verification_metadata =
        '{"source":"disposable-regression","check":"original"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'payment row changed after rejected verification_metadata update';
  END IF;

  rejected := false;
  BEGIN
    UPDATE fee_payments
    SET verified_by = 1
    WHERE id = 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'verified payment metadata is immutable' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'changing verified_by was not rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fee_payments
    WHERE id = 1 AND status = 'VERIFIED' AND verified_by = 2
      AND verified_at = '2025-01-03T10:00:00Z'::timestamptz
      AND verification_evidence_ref = 'evidence-original-001'
      AND reviewer_notes = 'Confirmed against bank statement'
      AND verification_metadata =
        '{"source":"disposable-regression","check":"original"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'payment row changed after rejected verified_by update';
  END IF;

  rejected := false;
  BEGIN
    UPDATE fee_payments
    SET verified_at = '2025-01-04T10:00:00Z'
    WHERE id = 1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'verified payment metadata is immutable' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'changing verified_at was not rejected';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM fee_payments
    WHERE id = 1
      AND status = 'VERIFIED'
      AND verified_by = 2
      AND verified_at = '2025-01-03T10:00:00Z'::timestamptz
      AND verification_evidence_ref = 'evidence-original-001'
      AND reviewer_notes = 'Confirmed against bank statement'
      AND verification_metadata =
        '{"source":"disposable-regression","check":"original"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'payment row changed after rejected verified_at update';
  END IF;
END;
$$;
SQL

echo "PASS: checked-in fee-payment trigger rejects evidence/reviewer changes and preserves the settled row."