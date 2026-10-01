#!/usr/bin/env node

// Offline-only builder for the reconciliation rehearsal SQL. This file reads
// the two checked-in JSON reports and writes a SQL artifact; it has no database,
// provider, network, workflow, or environment-variable access.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewPath = path.join(
  root,
  "reports/development-production-preview-2026-10-01.json",
);
const structurePath = path.join(
  root,
  "reports/production-structure-for-rehearsal-2026-10-01.json",
);
const outputPath = path.join(
  root,
  "reports/reconciliation-rehearsal-2026-10-01.sql",
);
const rehearsalSchema = "edupulse_reconciliation_rehearsal";

const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
const structure = JSON.parse(fs.readFileSync(structurePath, "utf8"));

if (preview.statementsToExecute.length !== 410) {
  throw new Error(
    `Expected exactly 410 preview statements; found ${preview.statementsToExecute.length}.`,
  );
}
if (structure.tables.length !== 29 || structure.constraints.length !== 114) {
  throw new Error(
    `Unexpected structure report size: ${structure.tables.length} tables, ${structure.constraints.length} constraints.`,
  );
}
if (!Array.isArray(structure.indexes)) {
  throw new Error("The structure report is missing its indexes array.");
}

const quoteIdent = (value) => `"${value.replaceAll('"', '""')}"`;
const oneLine = (value) => value.replace(/\s+/g, " ").trim();
const ensureSemicolon = (sql) => {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
};

// Only schema-qualifier tokens are changed. Identifiers, SQL text, and statement
// ordering are otherwise retained byte-for-byte from the JSON preview.
function rewritePublicQualifier(sql) {
  return sql.replace(/(?:"public"|public)\s*\./g, `${quoteIdent(rehearsalSchema)}.`);
}

function parsePlainColumnList(text) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) {
      result.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(text.slice(start).trim());
  const normalized = result.map((part) => {
    const match = part.match(/^"?([a-zA-Z_][\w$]*)"?$/);
    return match ? match[1].toLowerCase() : null;
  });
  return normalized.every(Boolean) ? normalized : null;
}

// The structural report has already excluded indexes owned by p/u/x
// constraints. Preserve every reported standalone index, including a
// standalone index whose columns are equivalent to a UNIQUE constraint.
const nonConstraintIndexes = structure.indexes;

const existingTenantKeyNames = [
  "academic_sessions_id_school_tenant_key",
  "academic_terms_id_school_tenant_key",
  "employees_id_school_tenant_key",
  "nfc_cards_id_school_tenant_key",
  "school_classes_id_school_tenant_key",
  "students_id_school_tenant_key",
  "subjects_id_school_tenant_key",
];
const existingTenantKeys = existingTenantKeyNames.map((name) => {
  const key = structure.constraints.find(
    (constraint) => constraint.name === name && constraint.type === "u",
  );
  if (!key) throw new Error(`Expected existing snapshot key ${name}.`);
  return key;
});
if (existingTenantKeys.length !== 7) {
  throw new Error(`Expected seven existing tenant keys; got ${existingTenantKeys.length}.`);
}

const previewForeignKeys = preview.statementsToExecute
  .map((sql, index) => ({ sql, index }))
  .filter(({ sql }) => /\bADD\s+CONSTRAINT\b[\s\S]*\bFOREIGN\s+KEY\b/i.test(sql));
if (previewForeignKeys.length !== 236) {
  throw new Error(`Expected 236 preview foreign keys; found ${previewForeignKeys.length}.`);
}
const previewForeignKeyNames = previewForeignKeys.map(
  ({ sql }) => sql.match(/\bADD\s+CONSTRAINT\s+"?([\w$]+)"?/i)?.[1],
);
if (
  previewForeignKeyNames.some((name) => !name) ||
  new Set(previewForeignKeyNames).size !== 236
) {
  throw new Error("Could not identify 236 distinct preview foreign-key names.");
}

// The seven snapshot tenant keys must remain supplied by the production
// structure and must not be redundantly introduced again by the preview.
for (const key of existingTenantKeys) {
  const keySql = key.sql.match(/\bUNIQUE\s*\(([^)]+)\)/i)?.[1];
  const columns = keySql && parsePlainColumnList(keySql);
  if (!columns) throw new Error(`Cannot inspect existing unique key ${key.name}.`);
  const recreated = preview.statementsToExecute.some((sql) => {
    const match = sql.match(
      /\bALTER\s+TABLE\s+"?([a-zA-Z_][\w$]*)"?\s+ADD\s+CONSTRAINT\s+"?[\w$]+"?\s+UNIQUE\s*\(([^)]+)\)/i,
    );
    if (!match || match[1] !== key.table) return false;
    const previewColumns = parsePlainColumnList(match[2]);
    return (
      previewColumns?.length === columns.length &&
      previewColumns.every((column, i) => column === columns[i])
    );
  });
  if (recreated) {
    throw new Error(`Preview redundantly recreates existing key ${key.name}.`);
  }
}

const previewStatements = preview.statementsToExecute.map((sql, index) => {
  const rewritten = rewritePublicQualifier(sql);
  if (/(?:"public"|public)\s*\./.test(rewritten)) {
    throw new Error(`Could not isolate public qualifier in preview statement ${index + 1}.`);
  }
  return `-- Original preview statement ${String(index + 1).padStart(3, "0")} / 410\n${ensureSemicolon(rewritten)}`;
});

const nonForeignKeyConstraints = structure.constraints.filter((constraint) =>
  ["p", "u", "c", "x"].includes(constraint.type),
);
const unexpectedConstraintTypes = structure.constraints.filter(
  (constraint) => !["p", "u", "c", "x", "f"].includes(constraint.type),
);
if (unexpectedConstraintTypes.length) {
  throw new Error(
    `Unsupported snapshot constraint types: ${unexpectedConstraintTypes.map((item) => item.type).join(", ")}.`,
  );
}
const existingForeignKeys = structure.constraints.filter(
  (constraint) => constraint.type === "f",
);

const syntheticFixtureSql = `
-- Synthetic fixtures only: negative sentinel IDs and rehearsal-only codes.
-- These are not historical production records and are rolled back at the end.
INSERT INTO ${quoteIdent(rehearsalSchema)}.schools
  (id, code, name, city, state)
VALUES
  (-61001, 'REHEARSAL_ONLY_61001', 'Rehearsal current school', 'Fixture City', 'Fixture State'),
  (-61002, 'REHEARSAL_ONLY_61002', 'Rehearsal prior school', 'Fixture City', 'Fixture State');

INSERT INTO ${quoteIdent(rehearsalSchema)}.app_users
  (id, clerk_user_id, email, first_name, last_name)
VALUES
  (-62001, 'rehearsal-user-62001', 'rehearsal-62001@example.invalid', 'Fixture', 'One'),
  (-62002, 'rehearsal-user-62002', 'rehearsal-62002@example.invalid', 'Fixture', 'Two');

INSERT INTO ${quoteIdent(rehearsalSchema)}.school_classes
  (id, school_id, name, section)
VALUES
  (-67020, -61001, 'Rehearsal exact class', 'A'),
  (-67021, -61002, 'Rehearsal prior-school class', 'A');

-- Candidate-matching guardians exercise normalized names, digits-only phone
-- equality, and same-school isolation. The ambiguous and cross-school students
-- must not get relationships from the synthetic unique-candidate backfill.
INSERT INTO ${quoteIdent(rehearsalSchema)}.parents
  (id, school_id, name, email, phone)
VALUES
  (-67001, -61001, 'Unique Guardian', 'guardian-67001@example.invalid', '+1 (555) 000-0100'),
  (-67002, -61001, 'Ambiguous Guardian', 'guardian-67002@example.invalid', '+1 555 000 0200'),
  (-67003, -61001, '  AMBIGUOUS GUARDIAN ', 'guardian-67003@example.invalid', '1-555-000-0200'),
  (-67004, -61002, 'Cross School Guardian', 'guardian-67004@example.invalid', '+1 (555) 000-0300');
INSERT INTO ${quoteIdent(rehearsalSchema)}.students
  (id, school_id, admission_no, first_name, last_name, gender, class_name, section,
   parent_name, parent_phone)
VALUES
  (-67101, -61001, 'REHEARSAL_STUDENT_67101', 'Unique', 'Guardian Match', 'OTHER',
   'Rehearsal exact class', 'A', '  unique guardian ', '15550000100'),
  (-67102, -61001, 'REHEARSAL_STUDENT_67102', 'Ambiguous', 'Guardian Match', 'OTHER',
   'No historical class', 'Z', 'Ambiguous Guardian', '15550000200'),
  (-67103, -61001, 'REHEARSAL_STUDENT_67103', 'Cross', 'School Mismatch', 'OTHER',
   'No historical class', 'Z', 'Cross School Guardian', '15550000300'),
  (-67104, -61001, 'REHEARSAL_STUDENT_67104', 'Unmatched', 'Class Student', 'OTHER',
   'Unmatched historical class', 'Z', NULL, NULL);

-- A real source row in the rehearsal schema proves the old school is retained
-- by the historical-pair backfill even though the device now belongs elsewhere.
INSERT INTO ${quoteIdent(rehearsalSchema)}.platform_devices
  (id, serial_number, name, device_type, school_id, school_class_id)
VALUES
  (-63001, 'REHEARSAL_DEVICE_63001', 'Synthetic reassigned device', 'NFC', -61001, -67020);

INSERT INTO ${quoteIdent(rehearsalSchema)}.device_assignment_history
  (id, school_id, device_id, previous_school_id, previous_location, location,
   action, reason, actor_user_id, new_school_id)
VALUES
  (-64001, -61001, -63001, -61002, 'Prior fixture room', 'Current fixture room',
   'REASSIGNED', 'Synthetic historical binding rehearsal', -62001, -61001);

DO $device_domain_fixture$
DECLARE
  device_status text;
  device_number integer := 0;
  rejected boolean;
BEGIN
  -- The initial -63001 row already proves same-school class acceptance.
  FOREACH device_status IN ARRAY ARRAY[
    'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED', 'UNASSIGNED'
  ] LOOP
    device_number := device_number + 1;
    INSERT INTO ${quoteIdent(rehearsalSchema)}.platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id, status)
    VALUES
      (-63010 - device_number,
       'REHEARSAL_STATUS_' || device_number,
       'Synthetic status fixture',
       'NFC',
       -61001,
       -67020,
       device_status);
  END LOOP;

  rejected := false;
  BEGIN
    INSERT INTO ${quoteIdent(rehearsalSchema)}.platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id, status)
    VALUES
      (-63020, 'REHEARSAL_STATUS_UNSUPPORTED', 'Synthetic unsupported status',
       'NFC', -61001, -67020, 'REHEARSAL_UNSUPPORTED');
    RAISE EXCEPTION 'unsupported device status unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'unsupported device status unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unsupported device status was not rejected';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO ${quoteIdent(rehearsalSchema)}.platform_devices
      (id, serial_number, name, device_type, school_id, school_class_id)
    VALUES
      (-63021, 'REHEARSAL_CROSS_SCHOOL_CLASS', 'Synthetic cross-school class',
       'NFC', -61001, -67021);
    RAISE EXCEPTION 'cross-school device/class binding unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'cross-school device/class binding unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'cross-school device/class binding was not rejected';
  END IF;
END
$device_domain_fixture$;

-- Same source union as the historical-binding migration, scoped entirely to
-- rehearsal tables. Safe to repeat because of the pair primary key.
INSERT INTO ${quoteIdent(rehearsalSchema)}.device_school_bindings (device_id, school_id)
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.attendance_events
WHERE device_id IS NOT NULL
UNION
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.device_credentials
UNION
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
UNION
SELECT device_id, previous_school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
WHERE previous_school_id IS NOT NULL
UNION
SELECT device_id, new_school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
WHERE new_school_id IS NOT NULL
UNION
SELECT id, school_id
FROM ${quoteIdent(rehearsalSchema)}.platform_devices
WHERE school_id IS NOT NULL
ON CONFLICT (device_id, school_id) DO NOTHING;

-- Repeat the complete source union. It must be idempotent while retaining both
-- distinct school pairs (current and prior) represented by real fixture history.
INSERT INTO ${quoteIdent(rehearsalSchema)}.device_school_bindings (device_id, school_id)
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.attendance_events
WHERE device_id IS NOT NULL
UNION
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.device_credentials
UNION
SELECT device_id, school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
UNION
SELECT device_id, previous_school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
WHERE previous_school_id IS NOT NULL
UNION
SELECT device_id, new_school_id
FROM ${quoteIdent(rehearsalSchema)}.device_assignment_history
WHERE new_school_id IS NOT NULL
UNION
SELECT id, school_id
FROM ${quoteIdent(rehearsalSchema)}.platform_devices
WHERE school_id IS NOT NULL
ON CONFLICT (device_id, school_id) DO NOTHING;

DO $binding_fixture$
DECLARE
  historical_pair_count integer;
BEGIN
  SELECT count(*) INTO historical_pair_count
  FROM ${quoteIdent(rehearsalSchema)}.device_school_bindings
  WHERE device_id = -63001 AND school_id IN (-61001, -61002);
  IF historical_pair_count <> 2 THEN
    RAISE EXCEPTION 'expected two distinct synthetic device/school history pairs; found %', historical_pair_count;
  END IF;
END
$binding_fixture$;

-- Guardian reconciliation rehearsal: only a uniquely matched candidate and
-- only a missing link are inserted. Name matching is trimmed/case-folded,
-- phones use digits-only normalization, and school_id is part of the match.
DO $guardian_precondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships
    WHERE student_id IN (-67101, -67102, -67103)
  ) THEN
    RAISE EXCEPTION 'guardian fixtures unexpectedly began with existing links';
  END IF;
END
$guardian_precondition$;

WITH candidates AS (
  SELECT p.id AS parent_id, st.id AS student_id,
         count(*) OVER (PARTITION BY st.id) AS candidate_count
  FROM ${quoteIdent(rehearsalSchema)}.students st
  JOIN ${quoteIdent(rehearsalSchema)}.parents p
    ON p.school_id = st.school_id
   AND lower(btrim(p.name)) = lower(btrim(st.parent_name))
   AND regexp_replace(p.phone, '\\D', '', 'g')
       = regexp_replace(st.parent_phone, '\\D', '', 'g')
  WHERE st.parent_name IS NOT NULL AND st.parent_phone IS NOT NULL
)
INSERT INTO ${quoteIdent(rehearsalSchema)}.parent_student_relationships
  (parent_id, student_id, relationship_type, is_primary_guardian,
   is_emergency_contact, contact_priority, status)
SELECT c.parent_id, c.student_id, 'Guardian', true, true, 1, 'ACTIVE'
FROM candidates c
WHERE c.candidate_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships existing
    WHERE existing.parent_id = c.parent_id AND existing.student_id = c.student_id
  )
ON CONFLICT (parent_id, student_id) DO NOTHING;

WITH candidates AS (
  SELECT p.id AS parent_id, st.id AS student_id,
         count(*) OVER (PARTITION BY st.id) AS candidate_count
  FROM ${quoteIdent(rehearsalSchema)}.students st
  JOIN ${quoteIdent(rehearsalSchema)}.parents p
    ON p.school_id = st.school_id
   AND lower(btrim(p.name)) = lower(btrim(st.parent_name))
   AND regexp_replace(p.phone, '\\D', '', 'g')
       = regexp_replace(st.parent_phone, '\\D', '', 'g')
  WHERE st.parent_name IS NOT NULL AND st.parent_phone IS NOT NULL
)
INSERT INTO ${quoteIdent(rehearsalSchema)}.parent_student_relationships
  (parent_id, student_id, relationship_type, is_primary_guardian,
   is_emergency_contact, contact_priority, status)
SELECT c.parent_id, c.student_id, 'Guardian', true, true, 1, 'ACTIVE'
FROM candidates c
WHERE c.candidate_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships existing
    WHERE existing.parent_id = c.parent_id AND existing.student_id = c.student_id
  )
ON CONFLICT (parent_id, student_id) DO NOTHING;

DO $guardian_assertions$
DECLARE
  unique_links integer;
  ambiguous_links integer;
  school_mismatch_links integer;
BEGIN
  SELECT count(*) INTO unique_links
  FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships
  WHERE student_id = -67101 AND parent_id = -67001;
  SELECT count(*) INTO ambiguous_links
  FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships
  WHERE student_id = -67102;
  SELECT count(*) INTO school_mismatch_links
  FROM ${quoteIdent(rehearsalSchema)}.parent_student_relationships
  WHERE student_id = -67103;
  IF unique_links <> 1 OR ambiguous_links <> 0 OR school_mismatch_links <> 0 THEN
    RAISE EXCEPTION 'guardian candidate rehearsal mismatch: unique %, ambiguous %, cross-school %',
      unique_links, ambiguous_links, school_mismatch_links;
  END IF;
END
$guardian_assertions$;

-- LEGACY session seeding and exact same-school class reconciliation, each run
-- twice. There is deliberately no fabricated prior-class assignment.
INSERT INTO ${quoteIdent(rehearsalSchema)}.academic_sessions
  (school_id, name, start_date, end_date, status, is_current)
SELECT id, 'LEGACY', CURRENT_DATE, CURRENT_DATE, 'COMPLETED', false
FROM ${quoteIdent(rehearsalSchema)}.schools
WHERE id IN (-61001, -61002)
ON CONFLICT (school_id, name) DO NOTHING;
INSERT INTO ${quoteIdent(rehearsalSchema)}.academic_sessions
  (school_id, name, start_date, end_date, status, is_current)
SELECT id, 'LEGACY', CURRENT_DATE, CURRENT_DATE, 'COMPLETED', false
FROM ${quoteIdent(rehearsalSchema)}.schools
WHERE id IN (-61001, -61002)
ON CONFLICT (school_id, name) DO NOTHING;

INSERT INTO ${quoteIdent(rehearsalSchema)}.student_class_assignments
  (school_id, student_id, academic_session_id, school_class_id, section,
   status, is_current, start_date)
SELECT st.school_id, st.id, s.id, sc.id, st.section,
       CASE WHEN upper(st.status) = 'ACTIVE' THEN 'ACTIVE' ELSE upper(st.status) END,
       upper(st.status) = 'ACTIVE', st.joined_at::date
FROM ${quoteIdent(rehearsalSchema)}.students st
JOIN ${quoteIdent(rehearsalSchema)}.school_classes sc
  ON sc.school_id = st.school_id
 AND sc.name = st.class_name
 AND sc.section = st.section
JOIN ${quoteIdent(rehearsalSchema)}.academic_sessions s
  ON s.school_id = st.school_id AND s.name = 'LEGACY'
WHERE st.id IN (-67101, -67104)
  AND NOT EXISTS (
    SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.student_class_assignments a
    WHERE a.student_id = st.id AND a.academic_session_id = s.id
  );

INSERT INTO ${quoteIdent(rehearsalSchema)}.student_class_assignments
  (school_id, student_id, academic_session_id, school_class_id, section,
   status, is_current, start_date)
SELECT st.school_id, st.id, s.id, sc.id, st.section,
       CASE WHEN upper(st.status) = 'ACTIVE' THEN 'ACTIVE' ELSE upper(st.status) END,
       upper(st.status) = 'ACTIVE', st.joined_at::date
FROM ${quoteIdent(rehearsalSchema)}.students st
JOIN ${quoteIdent(rehearsalSchema)}.school_classes sc
  ON sc.school_id = st.school_id
 AND sc.name = st.class_name
 AND sc.section = st.section
JOIN ${quoteIdent(rehearsalSchema)}.academic_sessions s
  ON s.school_id = st.school_id AND s.name = 'LEGACY'
WHERE st.id IN (-67101, -67104)
  AND NOT EXISTS (
    SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.student_class_assignments a
    WHERE a.student_id = st.id AND a.academic_session_id = s.id
  );

DO $legacy_class_assertions$
DECLARE
  legacy_count integer;
  exact_count integer;
  unmatched_count integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM ${quoteIdent(rehearsalSchema)}.academic_sessions
  WHERE name = 'LEGACY' AND school_id IN (-61001, -61002);
  SELECT count(*) INTO exact_count
  FROM ${quoteIdent(rehearsalSchema)}.student_class_assignments
  WHERE student_id = -67101
    AND academic_session_id = (
      SELECT id FROM ${quoteIdent(rehearsalSchema)}.academic_sessions
      WHERE school_id = -61001 AND name = 'LEGACY'
    )
    AND school_class_id = -67020
    AND section = 'A';
  SELECT count(*) INTO unmatched_count
  FROM ${quoteIdent(rehearsalSchema)}.student_class_assignments
  WHERE student_id = -67104;
  IF legacy_count <> 2 OR exact_count <> 1 OR unmatched_count <> 0 THEN
    RAISE EXCEPTION 'LEGACY/class fixture mismatch: sessions %, exact assignments %, unmatched assignments %',
      legacy_count, exact_count, unmatched_count;
  END IF;
END
$legacy_class_assertions$;

-- Reviewed 0003 default commission-rule seed, run twice with the migration's
-- guard. Exact reviewed allocation amounts and one ACTIVE NULL-term rule required.
INSERT INTO ${quoteIdent(rehearsalSchema)}.commission_rules
  (name, status, term, currency, calculation_basis, effective_at,
   partner_rate, allocation_total, partner_amount, school_amount, edupulse_amount)
SELECT 'Default partner referral', 'ACTIVE', NULL, 'NGN',
       'PER_ELIGIBLE_STUDENT_PER_TERM', NOW(), 100, 5000, 100, 2000, 2900
WHERE NOT EXISTS (
  SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
);
INSERT INTO ${quoteIdent(rehearsalSchema)}.commission_rules
  (name, status, term, currency, calculation_basis, effective_at,
   partner_rate, allocation_total, partner_amount, school_amount, edupulse_amount)
SELECT 'Default partner referral', 'ACTIVE', NULL, 'NGN',
       'PER_ELIGIBLE_STUDENT_PER_TERM', NOW(), 100, 5000, 100, 2000, 2900
WHERE NOT EXISTS (
  SELECT 1 FROM ${quoteIdent(rehearsalSchema)}.commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
);
DO $commission_seed_assertion$
DECLARE
  seed_count integer;
BEGIN
  SELECT count(*) INTO seed_count
  FROM ${quoteIdent(rehearsalSchema)}.commission_rules
  WHERE status = 'ACTIVE' AND term IS NULL
    AND name = 'Default partner referral'
    AND currency = 'NGN'
    AND calculation_basis = 'PER_ELIGIBLE_STUDENT_PER_TERM'
    AND partner_rate = 100
    AND allocation_total = 5000
    AND partner_amount = 100
    AND school_amount = 2000
    AND edupulse_amount = 2900;
  IF seed_count <> 1 THEN
    RAISE EXCEPTION 'expected one exact reviewed ACTIVE NULL-term commission seed; found %', seed_count;
  END IF;
END
$commission_seed_assertion$;

-- The payment fixture satisfies the new tenant FKs and VERIFIED evidence checks.
INSERT INTO ${quoteIdent(rehearsalSchema)}.academic_sessions
  (id, school_id, name, start_date, end_date)
VALUES (-65001, -61001, 'REHEARSAL SESSION', DATE '2026-01-01', DATE '2026-12-31');
INSERT INTO ${quoteIdent(rehearsalSchema)}.academic_terms
  (id, school_id, academic_session_id, name, start_date, end_date)
VALUES (-65002, -61001, -65001, 'REHEARSAL TERM', DATE '2026-01-01', DATE '2026-12-31');
INSERT INTO ${quoteIdent(rehearsalSchema)}.students
  (id, school_id, admission_no, first_name, last_name, gender, class_name, section)
VALUES (-65003, -61001, 'REHEARSAL_STUDENT_65003', 'Fixture', 'Student', 'OTHER', 'Fixture Class', 'A');
INSERT INTO ${quoteIdent(rehearsalSchema)}.fee_invoices
  (id, school_id, student_id, academic_session_id, academic_term_id,
   invoice_number, student_name_snapshot, admission_no_snapshot,
   class_name_snapshot, section_snapshot, issue_date, due_date,
   subtotal_minor, discount_minor, waiver_minor, total_minor,
   paid_minor, outstanding_minor, created_by)
VALUES
  (-65004, -61001, -65003, -65001, -65002, 'REHEARSAL_INVOICE_65004',
   'Fixture Student', 'REHEARSAL_STUDENT_65003', 'Fixture Class', 'A',
   DATE '2026-01-01', DATE '2026-12-31', 100, 0, 0, 100, 0, 100, -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.fee_payments
  (id, school_id, invoice_id, student_id, reference, idempotency_key,
   amount_minor, method, transfer_bank, transfer_reference, transfer_date,
   submitted_by)
VALUES
  (-65005, -61001, -65004, -65003, 'REHEARSAL_PAYMENT_65005',
   'REHEARSAL_IDEMPOTENCY_65005', 100, 'BANK_TRANSFER',
   'Fixture Bank', 'Fixture Transfer 65005', DATE '2026-01-02', -62001);
UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
SET status = 'VERIFIED',
    verified_by = -62002,
    verified_at = TIMESTAMPTZ '2026-01-03 12:00:00+00',
    verification_evidence_ref = 'fixture-evidence-65005',
    reviewer_notes = 'synthetic immutable fixture',
    verification_metadata = '{"source":"synthetic rehearsal"}'::jsonb
WHERE id = -65005;

DO $fee_guard_fixture$
DECLARE
  field_name text;
  rejected boolean;
BEGIN
  FOREACH field_name IN ARRAY ARRAY[
    'verification_evidence_ref',
    'reviewer_notes',
    'verification_metadata',
    'verified_by',
    'verified_at'
  ] LOOP
    rejected := false;
    BEGIN
      CASE field_name
        WHEN 'verification_evidence_ref' THEN
          UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
          SET verification_evidence_ref = 'tampered-evidence'
          WHERE id = -65005;
        WHEN 'reviewer_notes' THEN
          UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
          SET reviewer_notes = 'tampered-note'
          WHERE id = -65005;
        WHEN 'verification_metadata' THEN
          UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
          SET verification_metadata = '{"tampered":true}'::jsonb
          WHERE id = -65005;
        WHEN 'verified_by' THEN
          UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
          SET verified_by = -62001
          WHERE id = -65005;
        WHEN 'verified_at' THEN
          UPDATE ${quoteIdent(rehearsalSchema)}.fee_payments
          SET verified_at = TIMESTAMPTZ '2026-01-04 12:00:00+00'
          WHERE id = -65005;
      END CASE;
      RAISE EXCEPTION 'verification metadata mutation unexpectedly succeeded: %', field_name;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'verified payment metadata is immutable' THEN
        rejected := true;
      ELSIF SQLERRM LIKE 'verification metadata mutation unexpectedly succeeded:%' THEN
        RAISE;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'verification metadata guard did not reject field %', field_name;
    END IF;
  END LOOP;
END
$fee_guard_fixture$;

-- Parent rows exist only so all three operation-history tables can be tested
-- through their real FK and append-only trigger paths.
INSERT INTO ${quoteIdent(rehearsalSchema)}.school_operation_categories
  (id, school_id, category_type, name, created_by_user_id)
VALUES
  (-66001, -61001, 'ASSET', 'Fixture asset category', -62001),
  (-66002, -61001, 'MAINTENANCE', 'Fixture maintenance category', -62001),
  (-66003, -61001, 'TASK', 'Fixture task category', -62001),
  (-66010, -61002, 'TASK', 'Prior-school task category', -62001);

DO $category_fk_fixture$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO ${quoteIdent(rehearsalSchema)}.operational_tasks
      (id, school_id, category_id, category_type, title, created_by_user_id)
    VALUES
      (-66101, -61001, -66002, 'TASK', 'Wrong category type fixture', -62001);
    RAISE EXCEPTION 'wrong category type unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'wrong category type unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'wrong category type was not rejected by its composite FK';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO ${quoteIdent(rehearsalSchema)}.operational_tasks
      (id, school_id, category_id, category_type, title, created_by_user_id)
    VALUES
      (-66102, -61001, -66010, 'TASK', 'Wrong category tenant fixture', -62001);
    RAISE EXCEPTION 'wrong category tenant unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  WHEN raise_exception THEN
    IF SQLERRM = 'wrong category tenant unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'wrong category tenant was not rejected by its composite FK';
  END IF;
END
$category_fk_fixture$;

INSERT INTO ${quoteIdent(rehearsalSchema)}.school_assets
  (id, school_id, category_id, category_type, asset_code, name, created_by_user_id)
VALUES (-66004, -61001, -66001, 'ASSET', 'REHEARSAL_ASSET_66004', 'Fixture asset', -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.maintenance_requests
  (id, school_id, category_id, category_type, title, description, reported_by_user_id)
VALUES
  (-66005, -61001, -66002, 'MAINTENANCE', 'Fixture request', 'Synthetic rehearsal request', -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.operational_tasks
  (id, school_id, category_id, category_type, title, created_by_user_id)
VALUES (-66006, -61001, -66003, 'TASK', 'Fixture task', -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.school_asset_history
  (id, school_id, asset_id, event_type, actor_user_id)
VALUES (-66007, -61001, -66004, 'CREATED', -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.maintenance_request_status_history
  (id, school_id, maintenance_request_id, to_status, actor_user_id)
VALUES (-66008, -61001, -66005, 'OPEN', -62001);
INSERT INTO ${quoteIdent(rehearsalSchema)}.operational_task_status_history
  (id, school_id, task_id, to_status, actor_user_id)
VALUES (-66009, -61001, -66006, 'OPEN', -62001);

DO $append_only_fixture$
DECLARE
  table_name text;
  operation text;
  rejected boolean;
  target_id integer;
  expected_message text;
BEGIN
  FOREACH operation IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
    rejected := false;
    BEGIN
      IF operation = 'UPDATE' THEN
        UPDATE ${quoteIdent(rehearsalSchema)}.device_school_bindings
        SET created_at = created_at
        WHERE device_id = -63001 AND school_id = -61002;
      ELSE
        DELETE FROM ${quoteIdent(rehearsalSchema)}.device_school_bindings
        WHERE device_id = -63001 AND school_id = -61002;
      END IF;
      RAISE EXCEPTION 'device binding % unexpectedly succeeded', operation;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'device_school_bindings is append-only' THEN
        rejected := true;
      ELSIF SQLERRM LIKE 'device binding % unexpectedly succeeded' THEN
        RAISE;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'device binding % guard did not reject mutation', operation;
    END IF;
  END LOOP;

  rejected := false;
  BEGIN
    -- CASCADE gets past PostgreSQL's dependent-FK precheck so this tests the
    -- actual BEFORE TRUNCATE guard; every dependent table is rehearsal-only.
    EXECUTE 'TRUNCATE TABLE ${quoteIdent(rehearsalSchema)}.device_school_bindings CASCADE';
    RAISE EXCEPTION 'device binding TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'device_school_bindings is append-only' THEN
      rejected := true;
    ELSIF SQLERRM = 'device binding TRUNCATE unexpectedly succeeded' THEN
      RAISE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'device binding TRUNCATE guard did not reject mutation';
  END IF;

  FOR table_name, target_id IN
    SELECT * FROM (VALUES
      ('school_asset_history', -66007),
      ('maintenance_request_status_history', -66008),
      ('operational_task_status_history', -66009)
    ) AS history_targets(table_name, target_id)
  LOOP
    FOREACH operation IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
      rejected := false;
      expected_message := 'Operations history is append-only';
      BEGIN
        IF operation = 'UPDATE' THEN
          EXECUTE format(
            'UPDATE ${quoteIdent(rehearsalSchema)}.%I SET id = id WHERE id = $1',
            table_name
          ) USING target_id;
        ELSE
          EXECUTE format(
            'DELETE FROM ${quoteIdent(rehearsalSchema)}.%I WHERE id = $1',
            table_name
          ) USING target_id;
        END IF;
        RAISE EXCEPTION 'operations history % unexpectedly succeeded on %', operation, table_name;
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM = expected_message THEN
          rejected := true;
        ELSE
          RAISE;
        END IF;
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'operations history % unexpectedly succeeded on %' THEN
          RAISE;
        ELSE
          RAISE;
        END IF;
      END;
      IF NOT rejected THEN
        RAISE EXCEPTION 'operations history % guard did not reject %', operation, table_name;
      END IF;
    END LOOP;
  END LOOP;
END
$append_only_fixture$;
`;

const assertionSql = `
DO $reconciliation_assertions$
DECLARE
  relation_count integer;
  foreign_key_count integer;
  matched_preview_foreign_keys integer;
  tenant_key_count integer;
  unique_key_count integer;
  status_values text[];
  key_record record;
BEGIN
  IF current_schema() <> '${rehearsalSchema}' THEN
    RAISE EXCEPTION 'unexpected rehearsal search_path schema: %', current_schema();
  END IF;

  SELECT count(*) INTO relation_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '${rehearsalSchema}' AND c.relkind = 'r';
  IF relation_count <> 91 THEN
    RAISE EXCEPTION 'expected 91 rehearsal tables; found %', relation_count;
  END IF;

  SELECT count(*) INTO foreign_key_count
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = '${rehearsalSchema}' AND c.contype = 'f';
  IF foreign_key_count <> 304 THEN
    RAISE EXCEPTION 'expected 68 snapshot plus 236 preview FKs (304 total); found %', foreign_key_count;
  END IF;

  SELECT count(*) INTO matched_preview_foreign_keys
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = '${rehearsalSchema}'
    AND c.contype = 'f'
    AND c.conname = ANY(ARRAY[${previewForeignKeyNames
      .map((name) => `'${name.replaceAll("'", "''")}'`)
      .join(", ")}]::text[]);
  IF matched_preview_foreign_keys <> 236 THEN
    RAISE EXCEPTION 'expected all 236 preview FK names to exist; found %', matched_preview_foreign_keys;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${rehearsalSchema}'
      AND r.relname = 'school_operation_categories'
      AND c.contype IN ('p', 'u')
      AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (id, school_id, category_type)%'
  ) THEN
    RAISE EXCEPTION 'school operation category (id, school_id, category_type) key is not eligible';
  END IF;

  SELECT array_agg(captures[1] ORDER BY captures[1]) INTO status_values
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  CROSS JOIN LATERAL regexp_matches(
    pg_get_constraintdef(c.oid),
    $$'([^']+)'$$,
    'g'
  ) AS captures
  WHERE n.nspname = '${rehearsalSchema}'
    AND r.relname = 'platform_devices'
    AND c.conname = 'platform_devices_status_supported_check';
  IF status_values IS DISTINCT FROM ARRAY[
    'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED', 'UNASSIGNED'
  ]::text[] THEN
    RAISE EXCEPTION 'expected exact five-value platform device status check; got %', status_values;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
    WHERE n.nspname = '${rehearsalSchema}'
      AND r.relname = 'platform_devices'
      AND c.conname = 'platform_devices_class_school_fk'
      AND c.contype = 'f'
      AND c.convalidated
      AND target_ns.nspname = '${rehearsalSchema}'
      AND target.relname = 'school_classes'
  ) THEN
    RAISE EXCEPTION 'class/school platform-device FK is absent or not validated';
  END IF;

  SELECT count(*) INTO tenant_key_count
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = '${rehearsalSchema}'
    AND c.contype = 'u'
    AND c.conname = ANY(ARRAY[${existingTenantKeyNames
      .map((name) => `'${name}'`)
      .join(", ")}]::text[]);
  IF tenant_key_count <> 7 THEN
    RAISE EXCEPTION 'expected seven existing tenant unique keys without recreation; found %', tenant_key_count;
  END IF;

  FOR key_record IN
    SELECT * FROM (VALUES
      ('academic_sessions', 'academic_sessions_id_school_tenant_key'),
      ('academic_terms', 'academic_terms_id_school_tenant_key'),
      ('employees', 'employees_id_school_tenant_key'),
      ('nfc_cards', 'nfc_cards_id_school_tenant_key'),
      ('school_classes', 'school_classes_id_school_tenant_key'),
      ('students', 'students_id_school_tenant_key'),
      ('subjects', 'subjects_id_school_tenant_key')
    ) AS existing_tenant_keys(table_name, constraint_name)
  LOOP
    SELECT count(*) INTO unique_key_count
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = '${rehearsalSchema}'
      AND r.relname = key_record.table_name
      AND c.conname = key_record.constraint_name
      AND c.contype = 'u'
      AND c.convalidated;
    IF unique_key_count <> 1 THEN
      RAISE EXCEPTION 'existing key % was not preserved exactly once', key_record.constraint_name;
    END IF;
  END LOOP;
END
$reconciliation_assertions$;
`;

const lines = [
  "-- GENERATED OFFLINE from the checked-in preview and production STRUCTURE-ONLY snapshot.",
  "-- This rehearsal contains no production rows. Synthetic fixture rows use negative IDs and are rolled back.",
  "-- Guardian/class/commission/device repeatability checks below are synthetic fixtures only, not historical-data validation.",
  "-- The transaction is intentionally rollback-only; never change the final ROLLBACK to COMMIT.",
  "-- No migration journal, ledger, or live/public object is modified.",
  "",
  "BEGIN;",
  "SET LOCAL lock_timeout = '5s';",
  `CREATE SCHEMA ${quoteIdent(rehearsalSchema)};`,
  `SET LOCAL search_path = ${quoteIdent(rehearsalSchema)}, public;`,
  "",
  "-- Snapshot phase 1/4: all 29 production-structure tables, with no production data.",
  ...structure.tables.map((table) => ensureSemicolon(table.sql)),
  "",
  "-- Snapshot phase 2/4: non-FK primary, unique, check, and exclusion constraints.",
  ...nonForeignKeyConstraints.map((constraint) =>
    ensureSemicolon(rewritePublicQualifier(constraint.sql)),
  ),
  "",
  `-- Snapshot phase 3/4: all ${nonConstraintIndexes.length} standalone indexes from the structural snapshot, preserved exactly.`,
  ...nonConstraintIndexes.map((index) =>
    ensureSemicolon(rewritePublicQualifier(index.sql)),
  ),
  "",
  "-- Snapshot phase 4/4: existing production foreign keys.",
  ...existingForeignKeys.map((constraint) =>
    ensureSemicolon(rewritePublicQualifier(constraint.sql)),
  ),
  "",
  "-- Development-to-production preview: all 410 statements in original order.",
  ...previewStatements.flatMap((statement) => [statement, ""]),
  "-- Focused post-preview assertions: structure only; no historical production data is present.",
  assertionSql.trim(),
  "",
  "-- Install only the three existing append-only/immutability function bodies and six triggers.",
  `CREATE OR REPLACE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_device_school_binding_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = ${quoteIdent(rehearsalSchema)}, public
AS $$
BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION ${quoteIdent(rehearsalSchema)}.protect_fee_payment_verification_metadata()
RETURNS trigger LANGUAGE plpgsql
SET search_path = ${quoteIdent(rehearsalSchema)}, public
AS $$
BEGIN
  IF OLD.verification_metadata IS NOT NULL AND (
    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref
    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes
    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata
    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
  ) THEN
    RAISE EXCEPTION 'verified payment metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_operations_history_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = ${quoteIdent(rehearsalSchema)}, public
AS $$
BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER device_school_bindings_append_only
  BEFORE UPDATE OR DELETE ON ${quoteIdent(rehearsalSchema)}.device_school_bindings
  FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_device_school_binding_mutation();
CREATE TRIGGER device_school_bindings_no_truncate
  BEFORE TRUNCATE ON ${quoteIdent(rehearsalSchema)}.device_school_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_device_school_binding_mutation();
CREATE TRIGGER fee_payments_verification_metadata_immutable
  BEFORE UPDATE ON ${quoteIdent(rehearsalSchema)}.fee_payments
  FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.protect_fee_payment_verification_metadata();
CREATE TRIGGER school_asset_history_append_only
  BEFORE UPDATE OR DELETE ON ${quoteIdent(rehearsalSchema)}.school_asset_history
  FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_operations_history_mutation();
CREATE TRIGGER maintenance_request_status_history_append_only
  BEFORE UPDATE OR DELETE ON ${quoteIdent(rehearsalSchema)}.maintenance_request_status_history
  FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_operations_history_mutation();
CREATE TRIGGER operational_task_status_history_append_only
  BEFORE UPDATE OR DELETE ON ${quoteIdent(rehearsalSchema)}.operational_task_status_history
  FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(rehearsalSchema)}.prevent_operations_history_mutation();
`,
  syntheticFixtureSql.trim(),
  "",
  "ROLLBACK;",
  "",
];

const sql = lines.join("\n");
if (!sql.endsWith("ROLLBACK;\n")) {
  throw new Error("Generated rehearsal SQL is missing its terminal ROLLBACK.");
}
if (/^\s*COMMIT\s*;/im.test(sql)) {
  throw new Error("Generated rehearsal SQL must never COMMIT.");
}
fs.writeFileSync(outputPath, sql, "utf8");
console.log(
  `Wrote ${path.relative(root, outputPath)} from 29 snapshot tables, ${existingForeignKeys.length} existing FKs, and 410 ordered preview statements.`,
);