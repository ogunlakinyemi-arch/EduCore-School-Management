#!/usr/bin/env bash
set -euo pipefail

# Rehearses only the pre-0010/0011 and pre-0014 migration states. The cluster
# has a private Unix socket, no TCP listener, and is always discarded on exit.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/lib/db/drizzle"
for command_name in initdb pg_ctl psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required PostgreSQL utility not found: $command_name" >&2
    exit 1
  fi
done

if [[ "$(id -un)" != runner ]]; then
  echo "This rehearsal must run as local user runner; refusing to continue." >&2
  exit 1
fi

PG_BIN="$(dirname "$(command -v initdb)")"
TMP_DIR="/tmp/phase11b_disposable_history_$$"
DATA_DIR="$TMP_DIR/data"
SOCKET_DIR="$TMP_DIR/socket"
PORT=15439
DEVICE_DB=phase11b_disposable_history_device
FINANCE_DB=phase11b_disposable_history_finance

if [[ -e "$TMP_DIR" ]]; then
  echo "Refusing to reuse existing disposable cluster path: $TMP_DIR" >&2
  exit 1
fi
mkdir -m 700 "$TMP_DIR" "$SOCKET_DIR"

cleanup() {
  # Cleanup is confined to the uniquely named cluster created above.
  if [[ "$TMP_DIR" == /tmp/phase11b_disposable_history_* && -d "$DATA_DIR" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ "$TMP_DIR" == /tmp/phase11b_disposable_history_* ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$DATA_DIR" -U runner --auth=trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" \
  -o "-F -h '' -k $SOCKET_DIR -p $PORT -c listen_addresses=''" -w start >/dev/null

psql_local() {
  local db_name="$1"
  shift
  case "$db_name" in
    "$DEVICE_DB"|"$FINANCE_DB"|postgres) ;;
    *) echo "Refusing unexpected database name: $db_name" >&2; return 2 ;;
  esac
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    psql -X -q -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" \
      -U runner -d "$db_name" "$@"
}

createdb_local() {
  case "$1" in
    "$DEVICE_DB"|"$FINANCE_DB") ;;
    *) echo "Refusing unexpected database name: $1" >&2; return 2 ;;
  esac
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    "$PG_BIN/createdb" -h "$SOCKET_DIR" -p "$PORT" -U runner "$1"
}

apply_migrations() {
  local database="$1"
  local last_index="$2"
  local migration
  local index=0
  shopt -s nullglob
  local migrations=("$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql)
  shopt -u nullglob
  if ((${#migrations[@]} <= last_index)); then
    echo "Expected checked-in migrations through index $last_index." >&2
    return 1
  fi
  for migration in "${migrations[@]}"; do
    if ((index > last_index)); then
      break
    fi
    echo "[$database] applying pre-target $(basename "$migration")"
    psql_local "$database" -c "SET client_min_messages=WARNING" -f "$migration" >/dev/null
    ((index += 1))
  done
}

createdb_local "$DEVICE_DB"
apply_migrations "$DEVICE_DB" 9
psql_local "$DEVICE_DB" <<'SQL'
-- Synthetic two-school legacy state immediately after 0009.
INSERT INTO schools (id, code, name, city, state) VALUES
  (1, 'P11B-HIST-001', 'History Test School One', 'Lagos', 'Lagos'),
  (2, 'P11B-HIST-002', 'History Test School Two', 'Abuja', 'FCT'),
  (3, 'P11B-HIST-003', 'History Test School Three', 'Kano', 'Kano');
INSERT INTO app_users (id, clerk_user_id, email, first_name, last_name) VALUES
  (1, 'p11b-history-device-user', 'history-device@example.invalid', 'History', 'Tester');
INSERT INTO students
  (id, school_id, user_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES
  (1, 1, NULL, 'P11B-HIST-STU-1', 'Ari', 'One', 'OTHER', 'Primary 1', 'A'),
  (2, 2, NULL, 'P11B-HIST-STU-2', 'Bea', 'Two', 'OTHER', 'Primary 1', 'A'),
  (3, 3, NULL, 'P11B-HIST-STU-3', 'Cy', 'Three', 'OTHER', 'Primary 1', 'A');
INSERT INTO platform_devices (id, serial_number, name, device_type, school_id)
VALUES (1, 'P11B-HISTORY-DEVICE-1', 'Synthetic history reader', 'HYBRID', 2);

-- Current-owner pair from attendance, historical school pair from credentials
-- and assignment history, plus valid legacy biometric/NFC references.
INSERT INTO attendance_events
  (id, school_id, student_id, device_id, identification_method, event_type,
   result, attendance_status, event_date, occurred_at, dedupe_key)
VALUES
  (1, 2, 2, 1, 'NFC', 'CHECK_IN', 'SUCCESS', 'PRESENT', DATE '2025-01-10',
   TIMESTAMPTZ '2025-01-10 08:00:00+00', 'p11b-history-existing-event');
INSERT INTO device_credentials
  (id, school_id, device_id, credential_identifier, secret_hash)
VALUES (1, 1, 1, 'p11b-history-credential', 'synthetic-not-a-secret');
INSERT INTO device_assignment_history
  (id, school_id, device_id, previous_school_id, action, reason)
VALUES (1, 2, 1, 1, 'REASSIGNED', 'synthetic historical school pair');
INSERT INTO biometric_enrollments
  (id, school_id, student_id, device_id, provider, provider_reference)
VALUES (1, 2, 2, 1, 'SYNTHETIC', 'p11b-history-biometric');
INSERT INTO nfc_cards
  (id, school_id, uid, student_id, last_device_id)
VALUES (1, 2, 'P11B-HISTORY-CARD', 2, 1);
SQL

echo "[$DEVICE_DB] applying 0010 and 0011 against pre-migration rows"
psql_local "$DEVICE_DB" -c "SET client_min_messages=WARNING" \
  -f "$MIGRATIONS_DIR/0010_historical_device_school_bindings.sql" >/dev/null
psql_local "$DEVICE_DB" -c "SET client_min_messages=WARNING" \
  -f "$MIGRATIONS_DIR/0011_historical_device_references.sql" >/dev/null
psql_local "$DEVICE_DB" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM device_school_bindings WHERE device_id=1 AND school_id=1)
     OR NOT EXISTS (SELECT 1 FROM device_school_bindings WHERE device_id=1 AND school_id=2) THEN
    RAISE EXCEPTION 'historical school bindings from pre-0010 sources were not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM attendance_events WHERE id=1 AND school_id=2 AND device_id=1) THEN
    RAISE EXCEPTION 'pre-existing attendance event disappeared';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM biometric_enrollments WHERE id=1 AND device_id=1 AND school_id=2)
     OR NOT EXISTS (SELECT 1 FROM nfc_cards WHERE id=1 AND last_device_id=1 AND school_id=2) THEN
    RAISE EXCEPTION 'pre-existing biometric/NFC historical references disappeared';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conname IN ('biometric_enrollments_device_school_fk',
                        'nfc_cards_last_device_school_fk')
        AND convalidated) <> 2 THEN
    RAISE EXCEPTION '0011 biometric/NFC school constraints are not validated';
  END IF;
END
$$;

-- School one is now a legitimate historical attendance-device pairing,
-- although the device is currently assigned to school two.
INSERT INTO attendance_events
  (id, school_id, student_id, device_id, identification_method, event_type,
   result, attendance_status, event_date, occurred_at, dedupe_key)
VALUES
  (2, 1, 1, 1, 'NFC', 'CHECK_IN', 'SUCCESS', 'PRESENT', DATE '2025-01-11',
   TIMESTAMPTZ '2025-01-11 08:00:00+00', 'p11b-history-valid-old-school-event');

-- A school with no persisted binding must remain rejected by the new FK.
DO $$
DECLARE rejected boolean := false;
DECLARE rejected_constraint text;
BEGIN
  BEGIN
    INSERT INTO attendance_events
      (id, school_id, student_id, device_id, identification_method, event_type,
       result, attendance_status, event_date, occurred_at, dedupe_key)
    VALUES
      (3, 3, 3, 1, 'NFC', 'CHECK_IN', 'SUCCESS', 'PRESENT', DATE '2025-01-12',
       TIMESTAMPTZ '2025-01-12 08:00:00+00', 'p11b-history-cross-school-rejected');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    rejected := rejected_constraint = 'attendance_events_device_school_fk';
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'cross-school device/event pairing was not rejected by expected FK';
  END IF;
END
$$;
SELECT 'device historical backfill and cross-school rejection: PASS';
SQL

createdb_local "$FINANCE_DB"
apply_migrations "$FINANCE_DB" 13
psql_local "$FINANCE_DB" <<'SQL'
-- Synthetic, internally valid historical finance rows immediately after 0013.
INSERT INTO schools (id, code, name, city, state)
VALUES (1, 'P11B-FIN-HIST', 'Finance History Test School', 'Lagos', 'Lagos');
INSERT INTO app_users (id, clerk_user_id, email, first_name, last_name)
VALUES (1, 'p11b-history-finance-user', 'history-finance@example.invalid', 'Fin', 'Tester');
INSERT INTO school_classes (id, school_id, name, section)
VALUES (1, 1, 'Primary 1', 'A');
INSERT INTO students
  (id, school_id, user_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES (1, 1, NULL, 'P11B-FIN-STU-1', 'Dee', 'Student', 'OTHER', 'Primary 1', 'A');
INSERT INTO academic_sessions (id, school_id, name, start_date, end_date)
VALUES (1, 1, '2024/2025', DATE '2024-09-01', DATE '2025-08-31');
INSERT INTO academic_terms (id, school_id, academic_session_id, name, start_date, end_date)
VALUES (1, 1, 1, 'First Term', DATE '2024-09-01', DATE '2024-12-20');
INSERT INTO fee_invoices
  (id, school_id, student_id, academic_session_id, academic_term_id, invoice_number,
   student_name_snapshot, admission_no_snapshot, class_name_snapshot, section_snapshot,
   issue_date, due_date, subtotal_minor, discount_minor, waiver_minor, total_minor,
   paid_minor, outstanding_minor, status, created_by)
VALUES
  (1, 1, 1, 1, 1, 'P11B-SYNTHETIC-INVOICE',
   'Dee Student', 'P11B-FIN-STU-1', 'Primary 1', 'A',
   DATE '2024-09-01', DATE '2024-09-30', 12345, 0, 0, 12345,
   12345, 0, 'PAID', 1);
INSERT INTO fee_payments
  (id, school_id, invoice_id, student_id, reference, idempotency_key,
   amount_minor, method, provider, status, submitted_by)
VALUES
  (1, 1, 1, 1, 'P11B-SYNTHETIC-PAYMENT', 'p11b-history-payment-1',
   12345, 'REMITA', 'SYNTHETIC', 'VERIFIED', 1);
INSERT INTO fee_receipts (id, school_id, payment_id, receipt_number, snapshot)
VALUES
  (1, 1, 1, 'P11B-SYNTHETIC-RECEIPT',
   '{"receiptNumber":"P11B-SYNTHETIC-RECEIPT","amountMinor":12345,"currency":"NGN"}'::jsonb);
SQL

echo "[$FINANCE_DB] applying 0014 against pre-migration receipt"
psql_local "$FINANCE_DB" -c "SET client_min_messages=WARNING" \
  -f "$MIGRATIONS_DIR/0014_finance_payment_integrity.sql" >/dev/null
psql_local "$FINANCE_DB" <<'SQL'
DO $$
DECLARE receipt_row fee_receipts%ROWTYPE;
BEGIN
  SELECT * INTO receipt_row FROM fee_receipts WHERE id=1;
  IF receipt_row.invoice_id IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'receipt invoice_id backfill mismatch: expected 1, got %', receipt_row.invoice_id;
  END IF;
  IF receipt_row.snapshot->>'invoiceId' IS DISTINCT FROM '1'
     OR receipt_row.snapshot->>'schoolId' IS DISTINCT FROM '1'
     OR receipt_row.snapshot->>'amountMinor' IS DISTINCT FROM '12345' THEN
    RAISE EXCEPTION 'receipt snapshot backfill mismatch: %', receipt_row.snapshot;
  END IF;
  IF (SELECT amount_minor FROM fee_payments WHERE id=1) <> 12345 THEN
    RAISE EXCEPTION 'synthetic payment amount was not preserved';
  END IF;
END
$$;
SELECT 'finance receipt invoice/snapshot backfill: PASS';
SQL

echo "Historical migration rehearsals passed in disposable databases: $DEVICE_DB, $FINANCE_DB"
echo "Scope limitation: 0011 is seeded with valid pre-existing biometric/NFC references;"
echo "the prior 0009 composite FKs require those rows to match the device's current school."
echo "Pre-0010 device history has no new_school_id column; 0010 adds it as NULL,"
echo "so this rehearsal cannot provide a pre-migration new_school_id source row."