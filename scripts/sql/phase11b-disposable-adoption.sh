#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# REHEARSAL ONLY. This script adopts migration-ledger entries on one
# pre-existing local disposable clone; it does not execute migration SQL.
# Never read, inherit, or use DATABASE_URL from the caller's environment.
# drizzle-kit receives a temporary config with a fixed local Unix-socket URL.

readonly TARGET_DB="phase11b_disposable_current"
readonly REFERENCE_DB="phase11b_disposable_empty"
readonly DB_PREFIX="phase11b_disposable_"
readonly PGUSER_FIXED="runner"
readonly SOCKET_DIR="/tmp"
readonly PGPORT_FIXED="15439"
readonly EVIDENCE="/tmp/phase11b-disposable-adoption-${BASHPID}.audit"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly JOURNAL="$ROOT_DIR/lib/db/drizzle/meta/_journal.json"
readonly EXPECTED_DRIZZLE_KIT="0.31.10"
readonly EXPECTED_OLD_0001_HASH="f198518b395d52dc374249d73780eb28acf1c4f404c1cdb70ec27663049671c9"
readonly OBSERVED_UNVERIFIED_0004_HASH="eda974665826aa4d5affc07f24f658122ac81502a7190313f0edcd99d24206ba"

[[ "$(id -un)" == "$PGUSER_FIXED" ]] || {
  echo "Refusing rehearsal: must run as local Unix user runner." >&2
  exit 1
}
for name in "$TARGET_DB" "$REFERENCE_DB"; do
  [[ "$name" == "$DB_PREFIX"* ]] || {
    echo "Internal safety error: database is outside the disposable prefix." >&2
    exit 1
  }
done
[[ ! -e "$EVIDENCE" ]] || {
  echo "Refusing to overwrite existing audit evidence: $EVIDENCE" >&2
  exit 1
}
for command_name in psql sha256sum sort comm awk pnpm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done
[[ -f "$JOURNAL" ]] || {
  echo "Migration journal is missing; refusing adoption." >&2
  exit 1
}

readonly PSQL_BIN="$(command -v psql)"
readonly PNPM_BIN="$(command -v pnpm)"
WORK_DIR="$(mktemp -d /tmp/phase11b-adoption.XXXXXXXX)"
chmod 700 "$WORK_DIR"
readonly ADOPTION_CONFIG="$ROOT_DIR/lib/db/.phase11b-adoption-${BASHPID}.config.ts"
[[ ! -e "$ADOPTION_CONFIG" ]] || {
  echo "Refusing to overwrite temporary drizzle config path." >&2
  exit 1
}
touch "$EVIDENCE"
chmod 600 "$EVIDENCE"
OUTCOME="ABORTED"
trap 'printf "outcome=%s\n" "$OUTCOME" >> "$EVIDENCE"; rm -f -- "$ADOPTION_CONFIG"; rm -rf -- "$WORK_DIR"' EXIT

evidence() { printf '%s\n' "$*" >> "$EVIDENCE"; }
abort() {
  evidence "failure_category=$1"
  echo "Phase11B adoption stopped ($1); see redacted evidence: $EVIDENCE" >&2
  exit 1
}

evidence "mode=REHEARSAL-ONLY"
evidence "target=$TARGET_DB"
evidence "clean_reference=$REFERENCE_DB"
evidence "connection=Unix socket /tmp, port 15439, role runner"
evidence "ambient_DATABASE_URL=NOT_READ"
evidence "label=VERIFIED ADOPTION (not originally executed)"

# -i strips inherited PG* settings and DATABASE_URL. All SQL access is via the
# fixed socket, port, role and one of the two hardcoded databases.
psql_local() {
  local database="$1"
  shift
  case "$database" in
    "$TARGET_DB"|"$REFERENCE_DB") ;;
    *) echo "Refusing database outside the two hardcoded disposable databases." >&2; return 2 ;;
  esac
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    "$PSQL_BIN" -X -q -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PGPORT_FIXED" \
      -U "$PGUSER_FIXED" -d "$database" "$@"
}

check_connection_identity() {
  local database="$1"
  local got
  got="$(psql_local "$database" -At -c \
    "SELECT current_database() || '|' || current_user || '|' || current_setting('port') || '|' || (inet_server_addr() IS NULL)::text")" \
      2>"$WORK_DIR/psql.err" || abort "postgres_connection"
  [[ "$got" == "$database|$PGUSER_FIXED|$PGPORT_FIXED|true" ]] ||
    abort "postgres_connection_identity"
}
check_connection_identity "$TARGET_DB"
check_connection_identity "$REFERENCE_DB"

# Catalog snapshots contain definitions only in private temporary files; the
# persistent audit contains only their digests and aggregate counts.
catalog_snapshot() {
  local database="$1" output="$2"
  psql_local "$database" -At -F '|' -c "
    SELECT 'T|' || c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'C|' || c.relname || '|' || a.attname || '|' ||
           format_type(a.atttypid,a.atttypmod) || '|' || a.attnotnull || '|' ||
           replace(coalesce(pg_get_expr(d.adbin,d.adrelid),''), E'\\n',' ')
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'K|' || CASE con.contype WHEN 'f' THEN 'f' WHEN 'u' THEN 'u'
                    WHEN 'p' THEN 'p' WHEN 'c' THEN 'c' ELSE con.contype::text END ||
           '|' || rel.relname || '|' || con.conname || '|' ||
           coalesce((SELECT string_agg(att.attname, ',' ORDER BY key.ord)
                       FROM unnest(con.conkey) WITH ORDINALITY key(attnum,ord)
                       JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=key.attnum), '') ||
           '|' || con.convalidated || '|' ||
           replace(replace(pg_get_constraintdef(con.oid,true), E'\\n',' '), '|','!')
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE n.nspname='public'
    UNION ALL
    SELECT 'I|' || tbl.relname || '|' || idx.relname || '|' || pi.indisunique || '|' ||
           coalesce((SELECT string_agg(att.attname, ',' ORDER BY key.ord)
                       FROM unnest(pi.indkey) WITH ORDINALITY key(attnum,ord)
                       JOIN pg_attribute att ON att.attrelid=tbl.oid AND att.attnum=key.attnum
                      WHERE key.ord <= pi.indnkeyatts), '') || '|' ||
           replace(replace(pg_get_indexdef(pi.indexrelid), E'\\n',' '), '|','!')
      FROM pg_index pi
      JOIN pg_class tbl ON tbl.oid=pi.indrelid
      JOIN pg_class idx ON idx.oid=pi.indexrelid
      JOIN pg_namespace n ON n.oid=tbl.relnamespace
     WHERE n.nspname='public'
    UNION ALL
    SELECT 'F|' || p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' ||
           replace(replace(pg_get_functiondef(p.oid), E'\\n',' '), '|','!')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
    UNION ALL
    SELECT 'R|' || rel.relname || '|' || trg.tgname || '|' ||
           replace(replace(pg_get_triggerdef(trg.oid,true), E'\\n',' '), '|','!')
      FROM pg_trigger trg
      JOIN pg_class rel ON rel.oid=trg.tgrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE n.nspname='public' AND NOT trg.tgisinternal
  " 2>"$WORK_DIR/psql.err" | LC_ALL=C sort > "$output" ||
    abort "catalog_snapshot"
}

catalog_stats() {
  local database="$1"
  psql_local "$database" -At -F '|' -c "
    SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')) || '|' ||
      (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
          AND a.attnum>0 AND NOT a.attisdropped) || '|' ||
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f') || '|' ||
      (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal) || '|' ||
      (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') || '|' ||
      (SELECT count(*) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
  " 2>"$WORK_DIR/psql.err" || abort "catalog_counts"
}

catalog_snapshot "$REFERENCE_DB" "$WORK_DIR/reference.catalog"
catalog_snapshot "$TARGET_DB" "$WORK_DIR/target.catalog"
REF_STATS="$(catalog_stats "$REFERENCE_DB")"
TARGET_STATS="$(catalog_stats "$TARGET_DB")"
evidence "reference_catalog_counts=$REF_STATS"
evidence "target_catalog_counts=$TARGET_STATS"
evidence "reference_catalog_digest=$(sha256sum "$WORK_DIR/reference.catalog" | awk '{print $1}')"
evidence "target_catalog_digest=$(sha256sum "$WORK_DIR/target.catalog" | awk '{print $1}')"
[[ "$REF_STATS" == "91|1127|3|6|334|623" ]] || abort "reference_catalog_counts_mismatch"
[[ "$TARGET_STATS" == "91|1127|3|6|338|613" ]] || abort "target_catalog_counts_mismatch"

LC_ALL=C comm -23 "$WORK_DIR/reference.catalog" "$WORK_DIR/target.catalog" > "$WORK_DIR/reference_only"
LC_ALL=C comm -13 "$WORK_DIR/reference.catalog" "$WORK_DIR/target.catalog" > "$WORK_DIR/target_only"

# The complete catalog snapshots must match except for exactly the differences
# recorded in the hardening report and confirmed in this disposable clone:
# 14 clean-only single-column legacy FKs, plus four target-only tenant UNIQUE
# constraints and their four indexes.
awk -F '|' '
  /^K\|f\|/ { if ($5 !~ /^[^,]+$/) bad=1; fk++; next }
  { bad=1 }
  END { if (bad || fk != 14) exit 1 }
' "$WORK_DIR/reference_only" || abort "unexpected_clean_only_catalog_difference"
awk -F '|' '
  /^K\|u\|/ {
    allowed="|attendance_discrepancies|attendance_events|nfc_cards|student_class_assignments|"
    if (index(allowed, "|" $3 "|") == 0 || $4 != $3 "_id_school_tenant_key" ||
        $5 != "id,school_id") bad=1
    uq++; next
  }
  /^I\|/ {
    allowed="|attendance_discrepancies|attendance_events|nfc_cards|student_class_assignments|"
    if (index(allowed, "|" $2 "|") == 0 || $3 != $2 "_id_school_tenant_key" ||
        $4 != "true" || $5 != "id,school_id") bad=1
    indexes++; next
  }
  { bad=1 }
  END { if (bad || uq != 4 || indexes != 4) exit 1 }
' "$WORK_DIR/target_only" || abort "unexpected_target_only_catalog_difference"
evidence "catalog_differences=14_clean_only_single_column_FKs;4_target_only_tenant_UNIQUE_constraints_and_indexes"
evidence "clean_only_difference_count=$(wc -l < "$WORK_DIR/reference_only" | tr -d ' ')"
evidence "target_only_difference_count=$(wc -l < "$WORK_DIR/target_only" | tr -d ' ')"

# Verify the disposable fixture without persisting any record text or PII.
psql_local "$TARGET_DB" -At -F '|' > "$WORK_DIR/integrity-counts" \
  2>"$WORK_DIR/psql.err" <<'SQL' || abort "synthetic_fixture_preflight"
DO $fixture$
DECLARE
  item record;
  actual_count bigint;
  missing_pairs bigint;
  bad_receipts bigint;
BEGIN
  IF (SELECT count(*) FROM schools
       WHERE (id=911101 AND code='P11B-DISP-A')
          OR (id=911102 AND code='P11B-DISP-B')) <> 2
     OR (SELECT count(*) FROM schools WHERE id BETWEEN 911001 AND 912999) <> 2 THEN
    RAISE EXCEPTION 'expected exactly two synthetic schools';
  END IF;
  IF (SELECT count(*) FROM school_memberships
       WHERE id BETWEEN 911001 AND 912999
         AND status='ACTIVE'
         AND (id,school_id,role) IN
             ((911011,911101,'SCHOOL_ADMIN'),(911012,911101,'TEACHER'),
              (911013,911102,'SCHOOL_ADMIN'),(911014,911102,'TEACHER'))) <> 4
     OR EXISTS (
       SELECT 1 FROM school_memberships
        WHERE id BETWEEN 911001 AND 912999 AND status='ACTIVE'
        GROUP BY school_id,role,status HAVING count(*) > 1
     ) THEN
    RAISE EXCEPTION 'unexpected synthetic membership role/status assignment';
  END IF;
  FOR item IN
    SELECT * FROM (VALUES
      ('app_users',8),('school_memberships',4),('school_classes',2),('students',2),
      ('parents',2),('parent_student_relationships',2),('employees',2),
      ('academic_sessions',2),('academic_terms',2),('student_class_assignments',2),
      ('subjects',2),('class_subjects',2),('teacher_class_assignments',2),
      ('academic_assessment_types',2),('academic_assessments',2),('academic_results',2),
      ('partner_profiles',1),('school_partner_attributions',2),('subscriptions',2),
      ('fee_categories',2),('fee_structures',2),('fee_structure_lines',2),
      ('fee_invoices',2),('fee_invoice_lines',2),('platform_devices',2),('nfc_cards',2),
      ('nfc_card_history',2),('attendance_settings',2),('attendance_events',2),
      ('communication_notifications',2),('library_authors',2),('library_publishers',2),
      ('library_categories',2),('library_books',2),('library_book_copies',2),
      ('school_operation_categories',4),('school_assets',2),('school_facilities',2),
      ('operational_tasks',2),('audit_logs',2),('schools',2)
    ) AS expected(table_name,row_count)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE id BETWEEN 911001 AND 912999',
      item.table_name
    ) INTO actual_count;
    IF actual_count <> item.row_count THEN
      RAISE EXCEPTION 'unexpected synthetic row count for table %', item.table_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM device_school_bindings
       WHERE (device_id,school_id) IN ((911701,911101),(911702,911102))) <> 2 THEN
    RAISE EXCEPTION 'expected synthetic device-school pairs missing';
  END IF;
  WITH referenced_pairs(device_id,school_id) AS (
    SELECT device_id,school_id FROM attendance_events WHERE device_id IS NOT NULL
    UNION SELECT device_id,school_id FROM device_credentials WHERE device_id IS NOT NULL
    UNION SELECT device_id,school_id FROM device_assignment_history WHERE device_id IS NOT NULL
    UNION SELECT device_id,previous_school_id FROM device_assignment_history
           WHERE device_id IS NOT NULL AND previous_school_id IS NOT NULL
    UNION SELECT device_id,new_school_id FROM device_assignment_history
           WHERE device_id IS NOT NULL AND new_school_id IS NOT NULL
    UNION SELECT id,school_id FROM platform_devices WHERE school_id IS NOT NULL
    UNION SELECT device_id,school_id FROM biometric_enrollments WHERE device_id IS NOT NULL
    UNION SELECT last_device_id,school_id FROM nfc_cards WHERE last_device_id IS NOT NULL
  )
  SELECT count(*) INTO missing_pairs
    FROM referenced_pairs p
   WHERE NOT EXISTS (
     SELECT 1 FROM device_school_bindings b
      WHERE b.device_id=p.device_id AND b.school_id=p.school_id
   );
  IF missing_pairs <> 0 THEN
    RAISE EXCEPTION 'missing historical device-school binding pairs: %', missing_pairs;
  END IF;
  SELECT count(*) INTO bad_receipts
    FROM fee_receipts r
    LEFT JOIN fee_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
   WHERE p.id IS NULL
      OR r.invoice_id IS DISTINCT FROM p.invoice_id
      OR r.snapshot->>'invoiceId' IS DISTINCT FROM r.invoice_id::text
      OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text;
  IF bad_receipts <> 0 THEN
    RAISE EXCEPTION 'invalid receipt mappings: %', bad_receipts;
  END IF;
END
$fixture$;
WITH referenced_pairs(device_id,school_id) AS (
  SELECT device_id,school_id FROM attendance_events WHERE device_id IS NOT NULL
  UNION SELECT device_id,school_id FROM device_credentials WHERE device_id IS NOT NULL
  UNION SELECT device_id,school_id FROM device_assignment_history WHERE device_id IS NOT NULL
  UNION SELECT device_id,previous_school_id FROM device_assignment_history
         WHERE device_id IS NOT NULL AND previous_school_id IS NOT NULL
  UNION SELECT device_id,new_school_id FROM device_assignment_history
         WHERE device_id IS NOT NULL AND new_school_id IS NOT NULL
  UNION SELECT id,school_id FROM platform_devices WHERE school_id IS NOT NULL
  UNION SELECT device_id,school_id FROM biometric_enrollments WHERE device_id IS NOT NULL
  UNION SELECT last_device_id,school_id FROM nfc_cards WHERE last_device_id IS NOT NULL
)
SELECT 'missing_historical_device_binding_pairs|' || count(*)
  FROM referenced_pairs p
 WHERE NOT EXISTS (SELECT 1 FROM device_school_bindings b
                    WHERE b.device_id=p.device_id AND b.school_id=p.school_id)
UNION ALL
SELECT 'invalid_receipt_mappings|' || count(*)
  FROM fee_receipts r
  LEFT JOIN fee_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
 WHERE p.id IS NULL OR r.invoice_id IS DISTINCT FROM p.invoice_id
    OR r.snapshot->>'invoiceId' IS DISTINCT FROM r.invoice_id::text
    OR r.snapshot->>'schoolId' IS DISTINCT FROM r.school_id::text
UNION ALL
SELECT 'duplicate_synthetic_role_status_groups|' || count(*)
  FROM (
    SELECT school_id,role,status
      FROM school_memberships
     WHERE id BETWEEN 911001 AND 912999
     GROUP BY school_id,role,status HAVING count(*) > 1
  ) duplicate_groups;
SQL
grep -qx 'missing_historical_device_binding_pairs|0' "$WORK_DIR/integrity-counts" ||
  abort "missing_device_binding_pairs"
grep -qx 'invalid_receipt_mappings|0' "$WORK_DIR/integrity-counts" ||
  abort "invalid_receipt_mappings"
grep -qx 'duplicate_synthetic_role_status_groups|0' "$WORK_DIR/integrity-counts" ||
  abort "duplicate_synthetic_role_status"
evidence "synthetic_school_count=2"
evidence "missing_historical_device_binding_pairs=0"
evidence "invalid_receipt_mappings=0"
evidence "duplicate_synthetic_role_status_groups=0"

FIXTURE_COUNTS_SQL="$WORK_DIR/fixture-counts.sql"
cat > "$FIXTURE_COUNTS_SQL" <<'SQL'
SELECT 'app_users|' || count(*) FROM app_users WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_memberships|' || count(*) FROM school_memberships WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_classes|' || count(*) FROM school_classes WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'students|' || count(*) FROM students WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'parents|' || count(*) FROM parents WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'parent_student_relationships|' || count(*) FROM parent_student_relationships WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'employees|' || count(*) FROM employees WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'academic_sessions|' || count(*) FROM academic_sessions WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'academic_terms|' || count(*) FROM academic_terms WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'student_class_assignments|' || count(*) FROM student_class_assignments WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'subjects|' || count(*) FROM subjects WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'class_subjects|' || count(*) FROM class_subjects WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'teacher_class_assignments|' || count(*) FROM teacher_class_assignments WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'academic_assessment_types|' || count(*) FROM academic_assessment_types WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'academic_assessments|' || count(*) FROM academic_assessments WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'academic_results|' || count(*) FROM academic_results WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'partner_profiles|' || count(*) FROM partner_profiles WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_partner_attributions|' || count(*) FROM school_partner_attributions WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'subscriptions|' || count(*) FROM subscriptions WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'fee_categories|' || count(*) FROM fee_categories WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'fee_structures|' || count(*) FROM fee_structures WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'fee_structure_lines|' || count(*) FROM fee_structure_lines WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'fee_invoices|' || count(*) FROM fee_invoices WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'fee_invoice_lines|' || count(*) FROM fee_invoice_lines WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'platform_devices|' || count(*) FROM platform_devices WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'nfc_cards|' || count(*) FROM nfc_cards WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'nfc_card_history|' || count(*) FROM nfc_card_history WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'attendance_settings|' || count(*) FROM attendance_settings WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'attendance_events|' || count(*) FROM attendance_events WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'communication_notifications|' || count(*) FROM communication_notifications WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'library_authors|' || count(*) FROM library_authors WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'library_publishers|' || count(*) FROM library_publishers WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'library_categories|' || count(*) FROM library_categories WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'library_books|' || count(*) FROM library_books WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'library_book_copies|' || count(*) FROM library_book_copies WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_operation_categories|' || count(*) FROM school_operation_categories WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_assets|' || count(*) FROM school_assets WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'school_facilities|' || count(*) FROM school_facilities WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'operational_tasks|' || count(*) FROM operational_tasks WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'audit_logs|' || count(*) FROM audit_logs WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'schools|' || count(*) FROM schools WHERE id BETWEEN 911001 AND 912999
UNION ALL SELECT 'device_school_bindings|' || count(*) FROM device_school_bindings
  WHERE (device_id,school_id) IN ((911701,911101),(911702,911102))
ORDER BY 1;
SQL
psql_local "$TARGET_DB" -At -f "$FIXTURE_COUNTS_SQL" \
  > "$WORK_DIR/fixture-counts.before" 2>"$WORK_DIR/psql.err" ||
  abort "synthetic_counts"
evidence "synthetic_record_count_rows=$(wc -l < "$WORK_DIR/fixture-counts.before" | tr -d ' ')"
evidence "synthetic_record_counts_digest=$(sha256sum "$WORK_DIR/fixture-counts.before" | awk '{print $1}')"

# Assert the ledger is exactly the expected historical five rows, and that the
# clean reference provides the complete consecutive 1..31 ledger. Rows 2/5
# (migrations 0001/0004) are the two observed historical hash differences; row
# 2 matches the old 0001 blob at git revision 41e0595. Row 5 provenance is
# unknown, so retain its observed value exactly without claiming provenance.
psql_local "$TARGET_DB" -At -F '|' -c \
  "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id" \
  > "$WORK_DIR/target-ledger.before" 2>"$WORK_DIR/psql.err" ||
  abort "target_ledger_unavailable"
psql_local "$REFERENCE_DB" -At -F '|' -c \
  "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id" \
  > "$WORK_DIR/reference-ledger" 2>"$WORK_DIR/psql.err" ||
  abort "reference_ledger_unavailable"
awk -F '|' '
  NR != $1 || $1 < 1 || $1 > 5 || length($2) != 64 || $2 ~ /[^[:xdigit:]]/ || $3 !~ /^[0-9]+$/ { bad=1 }
  END { if (bad || NR != 5) exit 1 }
' "$WORK_DIR/target-ledger.before" || abort "target_ledger_not_exactly_ids_1_to_5"
awk -F '|' '
  NR != $1 || $1 < 1 || $1 > 31 || length($2) != 64 || $2 ~ /[^[:xdigit:]]/ || $3 !~ /^[0-9]+$/ { bad=1 }
  END { if (bad || NR != 31) exit 1 }
' "$WORK_DIR/reference-ledger" || abort "reference_ledger_not_exactly_ids_1_to_31"
awk -F '|' -v old0001="$EXPECTED_OLD_0001_HASH" -v old0004="$OBSERVED_UNVERIFIED_0004_HASH" '
  NR==FNR {
    ref_hash[$1]=$2
    ref_created[$1]=$3
    reference_rows++
    next
  }
  {
    target_rows++
    if (!($1 in ref_hash) || $3 != ref_created[$1]) bad=1
    if ($1 == 2) {
      if ($2 != old0001 || $2 == ref_hash[$1]) bad=1
      mismatch2++
    } else if ($1 == 5) {
      if ($2 != old0004 || $2 == ref_hash[$1]) bad=1
      mismatch5++
    } else if ($2 != ref_hash[$1]) {
      bad=1
    }
  }
  END {
    if (bad || reference_rows != 31 || target_rows != 5 || mismatch2 != 1 || mismatch5 != 1) exit 1
  }
' "$WORK_DIR/reference-ledger" "$WORK_DIR/target-ledger.before" ||
  abort "original_ledger_differences_not_exactly_ids_2_and_5"
evidence "original_ledger_rows=5"
evidence "original_ledger_hash_mismatch_ids=2,5"
evidence "id_2_hash_provenance=old_git_blob_0001_at_41e0595"
evidence "id_5_hash_provenance=unknown;observed_hash_preserved"
evidence "original_ledger_digest=$(sha256sum "$WORK_DIR/target-ledger.before" | awk '{print $1}')"
evidence "reference_ledger_digest=$(sha256sum "$WORK_DIR/reference-ledger" | awk '{print $1}')"

# Validate the expected migration tags/index count and installed CLI version
# before the only write. Journal is read-only; no checked-in migration is edited.
JOURNAL_TAG_COUNT="$(grep -c '"tag":' "$JOURNAL")"
[[ "$JOURNAL_TAG_COUNT" == 31 ]] || abort "migration_journal_count"
DRIZZLE_VERSION_OUTPUT="$(
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    "$PNPM_BIN" --dir "$ROOT_DIR/lib/db" exec drizzle-kit --version 2>"$WORK_DIR/drizzle.err"
)" || abort "drizzle_kit_unavailable"
DRIZZLE_VERSION="$(printf '%s\n' "$DRIZZLE_VERSION_OUTPUT" | sed -nE 's/.*v?([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n 1)"
[[ "$DRIZZLE_VERSION" == "$EXPECTED_DRIZZLE_KIT" ]] ||
  abort "unsupported_drizzle_kit_version"
evidence "drizzle_kit_version=$DRIZZLE_VERSION"

# Capture only rows 6..31 from the clean reference. Strictly validate values
# before interpolating them into a transaction against the target clone.
awk -F '|' 'NR > 5 { print }' "$WORK_DIR/reference-ledger" > "$WORK_DIR/adoption-rows"
awk -F '|' '
  NR + 5 != $1 || length($2) != 64 || $2 ~ /[^[:xdigit:]]/ || $3 !~ /^[0-9]+$/ { bad=1 }
  END { if (bad || NR != 26) exit 1 }
' "$WORK_DIR/adoption-rows" || abort "adoption_ledger_source_invalid"

{
  cat <<'SQL'
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'phase11b_disposable_current'
     OR current_user <> 'runner'
     OR current_setting('port') <> '15439'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'adoption transaction connection guard failed';
  END IF;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 5
     OR (SELECT min(id) FROM drizzle.__drizzle_migrations) <> 1
     OR (SELECT max(id) FROM drizzle.__drizzle_migrations) <> 5 THEN
    RAISE EXCEPTION 'target ledger changed after preflight';
  END IF;
END
$guard$;
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES
SQL
  awk -F '|' '{
    printf "  (%s, '\''%s'\'', %s)%s\n", $1, $2, $3, (NR == 26 ? ";" : ",")
  }' "$WORK_DIR/adoption-rows"
  cat <<'SQL'
SELECT setval(
  pg_get_serial_sequence('drizzle.__drizzle_migrations','id'),
  (SELECT max(id) FROM drizzle.__drizzle_migrations),
  true
);
COMMIT;
SQL
} > "$WORK_DIR/adopt.sql"
psql_local "$TARGET_DB" -f "$WORK_DIR/adopt.sql" \
  > /dev/null 2>"$WORK_DIR/psql.err" || abort "transactional_adoption_failed"

psql_local "$TARGET_DB" -At -F '|' -c \
  "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id" \
  > "$WORK_DIR/target-ledger.adopted" 2>"$WORK_DIR/psql.err" ||
  abort "adopted_ledger_unavailable"
[[ "$(wc -l < "$WORK_DIR/target-ledger.adopted" | tr -d ' ')" == 31 ]] ||
  abort "adopted_ledger_count"
head -n 5 "$WORK_DIR/target-ledger.adopted" | cmp -s - "$WORK_DIR/target-ledger.before" ||
  abort "original_ledger_rows_changed"
tail -n 26 "$WORK_DIR/target-ledger.adopted" | cmp -s - "$WORK_DIR/adoption-rows" ||
  abort "adopted_ledger_rows_mismatch"
evidence "adopted_ledger_rows=26"
evidence "adopted_ledger_ids=6-31"
evidence "adopted_ledger_digest=$(sha256sum "$WORK_DIR/target-ledger.adopted" | awk '{print $1}')"
evidence "original_five_rows_preserved=true"
evidence "adopted_rows_semantics=VERIFIED ADOPTION; not originally executed"

# Use a temporary config next to the package so drizzle-kit resolves its
# installed dependency normally. It hardcodes only the approved socket target;
# no DATABASE_URL variable is set or read. The EXIT trap removes the config.
[[ "$ROOT_DIR" != *'"* && "$ROOT_DIR" != *'\'* ]] ||
  abort "workspace_path_not_safely_representable"
cat > "$ADOPTION_CONFIG" <<EOF
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "$ROOT_DIR/lib/db/src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: "postgresql://runner@localhost:15439/${TARGET_DB}?host=%2Ftmp&port=15439",
  },
});
EOF
for pass in 1 2; do
  cp "$WORK_DIR/target-ledger.adopted" "$WORK_DIR/ledger.before-migrate"
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LANG=C \
    "$PNPM_BIN" --dir "$ROOT_DIR/lib/db" exec drizzle-kit migrate \
      --config "$ADOPTION_CONFIG" >"$WORK_DIR/drizzle-migrate-$pass.out" \
      2>"$WORK_DIR/drizzle-migrate-$pass.err" ||
      abort "drizzle_migrate_pass_${pass}_failed"
  psql_local "$TARGET_DB" -At -F '|' -c \
    "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id" \
    > "$WORK_DIR/ledger.after-migrate-$pass" 2>"$WORK_DIR/psql.err" ||
    abort "ledger_verification_after_migrate_${pass}"
  cmp -s "$WORK_DIR/ledger.before-migrate" "$WORK_DIR/ledger.after-migrate-$pass" ||
    abort "drizzle_migrate_was_not_noop_pass_${pass}"
  [[ "$(wc -l < "$WORK_DIR/ledger.after-migrate-$pass" | tr -d ' ')" == 31 ]] ||
    abort "ledger_count_after_migrate_${pass}"
  evidence "drizzle_migrate_pass_${pass}=no-op;ledger_rows=31"
done

psql_local "$TARGET_DB" -At -f "$FIXTURE_COUNTS_SQL" \
  > "$WORK_DIR/fixture-counts.after" 2>"$WORK_DIR/psql.err" ||
  abort "synthetic_counts_after_migrate"
cmp -s "$WORK_DIR/fixture-counts.before" "$WORK_DIR/fixture-counts.after" ||
  abort "synthetic_record_counts_changed"
evidence "synthetic_record_counts_unchanged=true"
evidence "synthetic_record_counts_after_digest=$(sha256sum "$WORK_DIR/fixture-counts.after" | awk '{print $1}')"
OUTCOME="SUCCESS"
echo "Disposable-only verified adoption complete. Redacted evidence: $EVIDENCE"