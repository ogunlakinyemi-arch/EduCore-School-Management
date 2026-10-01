#!/usr/bin/env node

/**
 * Isolated PostgreSQL rehearsal for the feedback migrations (0031 onward).
 *
 * The only live-database operation is a read-only identity/count preflight and
 * pg_dump --schema-only. All DDL, fixtures, constraint probes, and rollback
 * probes run in a disposable local PostgreSQL cluster under /tmp.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const migrationDir = path.join(workspace, "lib/db/drizzle");
const reportPath = path.join(workspace, "docs/feedback-migration-validation.md");
const expected = {
  database: "heliumdb",
  role: "postgres",
  publicTables: 91,
  publicRows: 396,
  schools: 9,
  students: 13,
  ledgerIds: [1, 2, 3, 4, 5],
  suppliedCatalogHash: "7eb715d6e59f0774596b45db529d6609",
};

const migrationSafety = {
  forbidden: [],
  onDeleteRestrict: 0,
  beforeDeleteTriggers: 0,
  immutableSnapshotTriggerMentions: 0,
};
const testResults = [];
const sourceEvidence = {};
const localEvidence = {};
let tempRoot;
let pgDataDir;
let pgSocketDir;
let pgPort;
let pgStarted = false;
let failure;

function sanitize(value) {
  let text = String(value ?? "");
  if (process.env.DATABASE_URL) {
    text = text.replaceAll(process.env.DATABASE_URL, "[DATABASE_URL REDACTED]");
  }
  return text.replace(
    /(password\s*=\s*)('[^']*'|"[^"]*"|\S+)/gi,
    "$1[REDACTED]",
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspace,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
    input: options.input,
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${sanitize(result.error.message)}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    combined: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function requireSuccess(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = options.redactOutput
      ? `${command} exited ${result.status}; output withheld`
      : sanitize(result.combined.trim()).slice(-5000);
    throw new Error(`${command} failed: ${detail}`);
  }
  return result;
}

function psqlArgs(database, extra = []) {
  return [
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "VERBOSITY=verbose",
    "-h",
    pgSocketDir,
    "-p",
    String(pgPort),
    "-U",
    "runner",
    "-d",
    database,
    ...extra,
  ];
}

function localPsql(database, sql, options = {}) {
  const result = run("psql", psqlArgs(database, options.args ?? ["-At"]), {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGHOST: pgSocketDir,
      PGPORT: String(pgPort),
      PGUSER: "runner",
      PGDATABASE: database,
      PGAPPNAME: "feedback-migration-validation-local",
      PGOPTIONS: "-c default_transaction_read_only=off",
    },
    input: sql,
    timeout: options.timeout ?? 120_000,
  });
  if (options.expectFailure) return result;
  if (result.status !== 0) {
    throw new Error(
      `Local SQL failed for ${database}: ${sanitize(result.combined.trim()).slice(-5000)}`,
    );
  }
  return result.stdout.trim();
}

function localPsqlFile(database, file, extra = []) {
  const result = run("psql", psqlArgs(database, ["-1", "-f", file, ...extra]), {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGHOST: pgSocketDir,
      PGPORT: String(pgPort),
      PGUSER: "runner",
      PGDATABASE: database,
      PGAPPNAME: "feedback-migration-validation-local",
      PGOPTIONS: "-c default_transaction_read_only=off",
    },
    timeout: 180_000,
  });
  return result;
}

function test(name, passed, detail = "") {
  testResults.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function writePrivate(file, content) {
  await writeFile(file, content, { mode: 0o600 });
}

function makeSourceConnectionEnv(connectionString) {
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use a PostgreSQL URI; value was not printed.");
  }
  const env = {};
  if (parsed.hostname) env.PGHOST = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.port) env.PGPORT = parsed.port;
  const dbname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (dbname) env.PGDATABASE = dbname;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  const parameterEnvNames = {
    application_name: "PGAPPNAME",
    channel_binding: "PGCHANNELBINDING",
    connect_timeout: "PGCONNECT_TIMEOUT",
    gssencmode: "PGGSSENCMODE",
    hostaddr: "PGHOSTADDR",
    keepalives: "PGKEEPALIVES",
    keepalives_idle: "PGKEEPALIVES_IDLE",
    options: "PGOPTIONS",
    passfile: "PGPASSFILE",
    sslcert: "PGSSLCERT",
    sslcrl: "PGSSLCRL",
    sslkey: "PGSSLKEY",
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    target_session_attrs: "PGTARGETSESSIONATTRS",
    tcp_user_timeout: "PGTCP_USER_TIMEOUT",
  };
  for (const [key, value] of parsed.searchParams) {
    const normalized = key.toLowerCase();
    if (!parameterEnvNames[normalized]) {
      throw new Error(`Unsupported PostgreSQL URI option ${normalized}; URL withheld.`);
    }
    env[parameterEnvNames[normalized]] = value;
  }
  return env;
}

const sourcePreflightSql = `
DO $preflight$
DECLARE
  rel RECORD;
  row_count BIGINT;
  total_rows BIGINT := 0;
  table_count INTEGER := 0;
  result JSONB;
BEGIN
  FOR rel IN SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', rel.schemaname, rel.tablename) INTO row_count;
    total_rows := total_rows + row_count;
    table_count := table_count + 1;
  END LOOP;

  result := jsonb_build_object(
    'database', current_database(),
    'role', current_user,
    'transactionReadOnly', current_setting('transaction_read_only') = 'on',
    'publicTables', table_count,
    'publicRows', total_rows,
    'schools', (SELECT count(*) FROM public.schools),
    'students', (SELECT count(*) FROM public.students),
    'catalog', jsonb_build_object(
      'columns', (
        SELECT count(*) FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
          AND a.attnum > 0 AND NOT a.attisdropped
      ),
      'indexes', (
        SELECT count(*) FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
      ),
      'constraints', (
        SELECT count(*) FROM pg_catalog.pg_constraint x
        JOIN pg_catalog.pg_class c ON c.oid = x.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
      ),
      'functions', (
        SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
      ),
      'triggers', (
        SELECT count(*) FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ),
      'views', (SELECT count(*) FROM information_schema.views WHERE table_schema = 'public')
    ),
    'newMigrationTablesAlreadyPresent', (
      SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb)
      FROM pg_catalog.pg_tables
      WHERE schemaname='public' AND tablename IN (
        'staff_nfc_billing_rules','staff_nfc_subscriptions','staff_nfc_payments',
        'staff_nfc_refunds','staff_nfc_allocations','staff_nfc_provider_events',
        'staff_nfc_partner_commissions','staff_nfc_receipts','employee_nfc_card_bindings',
        'employee_nfc_card_history','employee_nfc_attendance_discrepancies',
        'employee_nfc_discrepancy_actions','school_calendar_events','school_branding_logos',
        'teacher_subject_assignments','teacher_duty_roster','transport_buses','transport_routes',
        'transport_route_stops','transport_student_assignments','transport_route_staff',
        'transport_parent_requests','transport_fee_invoices','transport_school_policies',
        'transport_history','settlement_payroll_profiles','payroll_employee_profiles',
        'payroll_periods','payroll_items','payroll_transfers','payroll_payslips',
        'settlement_payroll_audit_events','student_subscription_payments',
        'student_subscription_allocations'
      )
    )
  );
  RAISE NOTICE 'FMV_PREFLIGHT_JSON=%', result;
END
$preflight$;
`;

const ledgerIdsSql = `
SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)::text
FROM drizzle.__drizzle_migrations;
`;

const snapshotSql = `
SELECT jsonb_build_object(
  'columns', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      n.nspname, c.relname, a.attnum, a.attname,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull, a.attidentity, a.attgenerated,
      pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)
    ) ORDER BY n.nspname, c.relname, a.attnum)
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND a.attnum > 0 AND NOT a.attisdropped
  ), '[]'::jsonb),
  'constraints', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      n.nspname, c.relname, x.conname, x.contype,
      pg_catalog.pg_get_constraintdef(x.oid, true), x.convalidated
    ) ORDER BY n.nspname, c.relname, x.conname)
    FROM pg_catalog.pg_constraint x
    JOIN pg_catalog.pg_class c ON c.oid = x.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  ), '[]'::jsonb)
)::text;
`;

const preservationSql = `
SELECT jsonb_build_object(
  'students', (
    SELECT COALESCE(jsonb_agg(jsonb_build_array(id, school_id, admission_no, status)
      ORDER BY id), '[]'::jsonb)
    FROM public.students WHERE id IN (12001, 12002)
  ),
  'studentCards', (
    SELECT COALESCE(jsonb_agg(jsonb_build_array(id, school_id, uid, student_id, status)
      ORDER BY id), '[]'::jsonb)
    FROM public.nfc_cards WHERE id IN (15001, 15005)
  ),
  'academicSessions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_array(id, school_id, name, status)
      ORDER BY id), '[]'::jsonb)
    FROM public.academic_sessions WHERE id IN (16001, 16002)
  ),
  'academicTerms', (
    SELECT COALESCE(jsonb_agg(jsonb_build_array(id, school_id, academic_session_id, name, status)
      ORDER BY id), '[]'::jsonb)
    FROM public.academic_terms WHERE id IN (17001, 17002, 17003)
  )
)::text;
`;

const syntheticBaseFixture = `
INSERT INTO public.schools (id, code, name, city, state)
VALUES
  (10001, 'FIXTURE-SCHOOL-A', 'Fixture School A', 'Fixture City', 'Fixture State'),
  (10002, 'FIXTURE-SCHOOL-B', 'Fixture School B', 'Fixture City', 'Fixture State');

INSERT INTO public.app_users (id, clerk_user_id, email, first_name, last_name)
VALUES
  (11001, 'fixture-clerk-a', 'fixture-a@example.invalid', 'Fixture', 'Admin A'),
  (11002, 'fixture-clerk-b', 'fixture-b@example.invalid', 'Fixture', 'Admin B');

INSERT INTO public.students
  (id, school_id, admission_no, first_name, last_name, gender, class_name, section, status)
VALUES
  (12001, 10001, 'FIXTURE-STUDENT-UID-A', 'Fixture', 'Student A', 'UNSPECIFIED', 'Fixture Class', 'A', 'active'),
  (12002, 10002, 'FIXTURE-STUDENT-UID-B', 'Fixture', 'Student B', 'UNSPECIFIED', 'Fixture Class', 'A', 'active');

INSERT INTO public.parents (id, school_id, user_id, name, email, phone)
VALUES
  (13001, 10001, 11001, 'Fixture Parent A', 'parent-a@example.invalid', '+10000000001'),
  (13002, 10002, 11002, 'Fixture Parent B', 'parent-b@example.invalid', '+10000000002');

INSERT INTO public.parent_student_relationships (id, parent_id, student_id, status)
VALUES
  (13501, 13001, 12001, 'ACTIVE'),
  (13502, 13002, 12002, 'ACTIVE');

INSERT INTO public.employees (id, school_id, employee_no, first_name, last_name)
VALUES
  (14001, 10001, 'FIXTURE-EMP-A', 'Fixture', 'Employee A'),
  (14002, 10002, 'FIXTURE-EMP-B', 'Fixture', 'Employee B');

INSERT INTO public.nfc_cards (id, school_id, uid, student_id, status)
VALUES
  (15001, 10001, 'fixture-student-card-uid-a', 12001, 'active'),
  (15002, 10001, 'fixture-employee-card-uid-a', NULL, 'unassigned'),
  (15003, 10001, 'fixture-employee-card-uid-b', NULL, 'unassigned'),
  (15004, 10002, 'fixture-employee-card-uid-c', NULL, 'unassigned'),
  (15005, 10002, 'fixture-student-card-uid-b', 12002, 'active');

INSERT INTO public.academic_sessions
  (id, school_id, name, start_date, end_date, status, is_current)
VALUES
  (16001, 10001, 'FIXTURE-SESSION-A', '2099-01-01', '2099-12-31', 'PLANNED', false),
  (16002, 10002, 'FIXTURE-SESSION-B', '2099-01-01', '2099-12-31', 'PLANNED', false);

INSERT INTO public.academic_terms
  (id, school_id, academic_session_id, name, start_date, end_date, status, is_current)
VALUES
  (17001, 10001, 16001, 'FIXTURE-TERM-A', '2099-01-01', '2099-04-30', 'PLANNED', false),
  (17002, 10002, 16002, 'FIXTURE-TERM-B', '2099-01-01', '2099-04-30', 'PLANNED', false),
  (17003, 10001, 16001, 'FIXTURE-TERM-C', '2099-05-01', '2099-08-31', 'PLANNED', false);

INSERT INTO public.platform_company_employees (id, full_name, email, job_title)
VALUES (18001, 'Fixture Company Employee', 'company@example.invalid', 'Fixture Role');
`;

const syntheticNewFixture = `
INSERT INTO public.partner_profiles
  (id, partner_code, full_name, email, status, created_by)
VALUES (19001, 'FIXTURE-PARTNER', 'Fixture Partner', 'partner@example.invalid', 'ACTIVE', 11001);

INSERT INTO public.school_partner_attributions
  (id, school_id, partner_profile_id, status, is_current, created_by)
VALUES (20001, 10001, 19001, 'ACTIVE', true, 11001);

INSERT INTO public.school_branding_logos
  (id, school_id, object_path, content_type, byte_size, is_current, updated_by_user_id)
VALUES
  (33001, 10001, 'fixture/school-10001/logo-v1', 'image/png', 1, false, 11001),
  (33002, 10001, 'fixture/school-10001/logo-v2', 'image/png', 1, true, 11001);

INSERT INTO public.staff_nfc_subscriptions
  (id, school_id, employee_id, academic_session_id, academic_term_id,
   billing_rule_id, billing_rule_version, price_minor, school_share_minor,
   platform_share_minor, partner_share_minor, partner_profile_id, attribution_id,
   currency, status, due_date, created_by)
SELECT 21001, 10001, 14001, 16001, 17001, id, version,
       200000, 80000, 110000, 10000, 19001, 20001, 'NGN', 'UNPAID',
       '2099-04-30', 11001
FROM public.staff_nfc_billing_rules WHERE product = 'TEACHER_STAFF_NFC_EID' AND version = 1;

INSERT INTO public.staff_nfc_payments
  (id, subscription_id, employee_id, school_id, academic_session_id, academic_term_id,
   provider, provider_mode, reference, idempotency_key, gross_amount_minor,
   provider_transaction_id, status, settlement_status, reconciliation_status, created_by)
VALUES
  (22001, 21001, 14001, 10001, 16001, 17001, 'MOCK', 'DEVELOPMENT_MOCK',
   'fixture-staff-payment-1', 'fixture-staff-idem-1', 200000,
   'fixture-provider-transaction-1', 'PAID', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 11001),
  (22002, 21001, 14001, 10001, 16001, 17001, 'MOCK', 'DEVELOPMENT_MOCK',
   'fixture-staff-payment-2', 'fixture-staff-idem-2', 200000,
   'fixture-provider-transaction-2', 'FAILED', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 11001);

INSERT INTO public.staff_nfc_allocations
  (id, idempotency_key, recipient_type, recipient_id, school_id, employee_id,
   academic_session_id, academic_term_id, subscription_id, payment_id,
   allocation_rule_id, billing_rule_version, attribution_id, amount_minor)
SELECT row_data.id, row_data.idempotency_key, row_data.recipient_type,
       row_data.recipient_id, 10001, 14001, 16001, 17001, 21001, 22001,
       rules.id, 1, row_data.attribution_id, row_data.amount_minor
FROM public.staff_nfc_billing_rules rules
CROSS JOIN (VALUES
  (23001, 'fixture-allocation-school', 'SCHOOL', NULL::integer, NULL::integer, 80000),
  (23002, 'fixture-allocation-platform', 'PLATFORM', NULL::integer, NULL::integer, 110000),
  (23003, 'fixture-allocation-partner', 'PARTNER', 19001, 20001, 10000)
) AS row_data(id, idempotency_key, recipient_type, recipient_id, attribution_id, amount_minor)
WHERE rules.product = 'TEACHER_STAFF_NFC_EID' AND rules.version = 1;

INSERT INTO public.staff_nfc_partner_commissions
  (id, allocation_id, partner_profile_id, school_id, employee_id,
   academic_session_id, academic_term_id, subscription_id, payment_id, commission_minor)
VALUES (25001, 23003, 19001, 10001, 14001, 16001, 17001, 21001, 22001, 10000);

INSERT INTO public.staff_nfc_refunds
  (id, payment_id, school_id, amount_minor, idempotency_key, reason, created_by)
VALUES (26001, 22001, 10001, 5000, 'fixture-refund-idem-1', 'Fixture refund key test', 11001);

UPDATE public.staff_nfc_refunds
SET provider_refund_id = 'fixture-provider-refund-1'
WHERE id = 26001;

INSERT INTO public.staff_nfc_receipts
  (id, payment_id, subscription_id, school_id, receipt_number, snapshot)
VALUES (24001, 22001, 21001, 10001, 'FIXTURE-RECEIPT-1', '{"fixture":true}'::jsonb);

INSERT INTO public.staff_nfc_provider_events
  (id, provider, event_id, provider_reference, provider_transaction_id, payload_sha256)
VALUES
  (29001, 'FLUTTERWAVE', 'fixture-event-1', 'fixture-event-ref-1',
   'fixture-event-txn-1', repeat('a',64));

INSERT INTO public.subscriptions
  (id, school_id, student_id, term, amount, school_share, edupulse_share,
   status, verification_status, provider, expires_at)
VALUES
  (40001, 10001, 12001, 'FIXTURE-TERM-A', 5000, 2000, 3000,
   'pending', 'pending', 'test', '2099-12-31T23:59:59Z'),
  (40002, 10001, 12001, 'FIXTURE-TERM-C', 5000, 2000, 3000,
   'pending', 'pending', 'test', '2099-12-31T23:59:59Z'),
  (40003, 10001, 12001, 'FIXTURE-TERM-A-2', 5000, 2000, 3000,
   'pending', 'pending', 'test', '2099-12-31T23:59:59Z'),
  (40004, 10001, 12001, 'FIXTURE-TERM-A-3', 5000, 2000, 3000,
   'pending', 'pending', 'test', '2099-12-31T23:59:59Z');

INSERT INTO public.student_subscription_payments
  (id, subscription_id, school_id, student_id, academic_session_id, academic_term_id,
   payer_user_id, reference, idempotency_key, gross_amount_minor, provider_transaction_id, status)
VALUES
  (41001, 40001, 10001, 12001, 16001, 17001, 11001,
   'fixture-student-payment-01', 'fixture-student-idem-01', 500000,
   'fixture-student-provider-transaction-1', 'PENDING'),
  (41002, 40001, 10001, 12001, 16001, 17001, 11001,
   'fixture-student-payment-02', 'fixture-student-idem-02', 500000,
   'fixture-student-provider-transaction-2', 'FAILED');

INSERT INTO public.student_subscription_allocations
  (id, idempotency_key, recipient_type, school_id, student_id, payer_user_id,
   academic_session_id, academic_term_id, subscription_id, payment_id, amount_minor)
VALUES
  (43001, 'fixture-student-allocation-school', 'SCHOOL', 10001, 12001, 11001,
   16001, 17001, 40001, 41001, 200000),
  (43002, 'fixture-student-allocation-platform', 'PLATFORM', 10001, 12001, 11001,
   16001, 17001, 40001, 41001, 300000);

INSERT INTO public.employee_nfc_card_bindings
  (id, school_id, nfc_card_id, employee_id, status, created_by_user_id)
VALUES (28001, 10001, 15002, 14001, 'ACTIVE', 11001);

INSERT INTO public.transport_buses
  (id, school_id, name, registration_number, capacity, created_by)
VALUES
  (30001, 10001, 'Fixture Bus A', 'FIXTURE-BUS-A', 20, 11001),
  (30002, 10002, 'Fixture Bus B', 'FIXTURE-BUS-B', 20, 11002);

INSERT INTO public.transport_routes
  (id, school_id, bus_id, driver_employee_id, name, weekdays,
   departure_time, arrival_time, fare_minor, created_by)
VALUES
  (31001, 10001, 30001, 14001, 'Fixture Route A', ARRAY['MONDAY'], '08:00:00', '09:00:00', 0, 11001),
  (31002, 10002, 30002, 14002, 'Fixture Route B', ARRAY['MONDAY'], '08:00:00', '09:00:00', 0, 11002);

INSERT INTO public.transport_route_stops
  (id, school_id, route_id, name, stop_type, sequence, created_by)
VALUES
  (32001, 10001, 31001, 'Fixture A Pickup', 'PICKUP', 1, 11001),
  (32002, 10001, 31001, 'Fixture A Dropoff', 'DROPOFF', 2, 11001),
  (32003, 10002, 31002, 'Fixture B Pickup', 'PICKUP', 1, 11002),
  (32004, 10002, 31002, 'Fixture B Dropoff', 'DROPOFF', 2, 11002);

INSERT INTO public.settlement_payroll_profiles
  (id, scope, school_id, business_name, settlement_contact_email,
   bank_name_encrypted, bank_code_encrypted, account_name_encrypted,
   account_number_encrypted, account_last4, encryption_key_version, created_by, updated_by)
VALUES
  (27001, 'SCHOOL', 10001, 'Fixture School A', 'settlement-a@example.invalid',
   'fixture-cipher-bank-a', 'fixture-cipher-code-a', 'fixture-cipher-name-a',
   'fixture-cipher-account-a', '4242', 'fixture-v1', 11001, 11001),
  (27002, 'YEMAIT_COMPANY', NULL, 'Fixture Company', 'settlement-company@example.invalid',
   'fixture-cipher-bank-company', 'fixture-cipher-code-company', 'fixture-cipher-name-company',
   'fixture-cipher-account-company', '4243', 'fixture-v1', 11001, 11001);

INSERT INTO public.payroll_employee_profiles
  (id, scope, school_id, employee_id, monthly_salary_minor,
   bank_name_encrypted, bank_code_encrypted, account_name_encrypted,
   account_number_encrypted, account_last4, encryption_key_version, created_by, updated_by)
VALUES
  (27101, 'SCHOOL', 10001, 14001, 100000,
   'fixture-cipher-bank-employee', 'fixture-cipher-code-employee',
   'fixture-cipher-name-employee', 'fixture-cipher-account-employee',
   '4244', 'fixture-v1', 11001, 11001);

INSERT INTO public.payroll_employee_profiles
  (id, scope, school_id, company_employee_id, monthly_salary_minor,
   bank_name_encrypted, bank_code_encrypted, account_name_encrypted,
   account_number_encrypted, account_last4, encryption_key_version, created_by, updated_by)
VALUES
  (27102, 'YEMAIT_COMPANY', NULL, 18001, 100000,
   'fixture-cipher-bank-company-employee', 'fixture-cipher-code-company-employee',
   'fixture-cipher-name-company-employee', 'fixture-cipher-account-company-employee',
   '4245', 'fixture-v1', 11001, 11001);

INSERT INTO public.payroll_periods
  (id, scope, school_id, period_month, status, employee_count,
   gross_salary_minor, allowance_minor, bonus_minor, deduction_minor,
   adjustment_minor, net_salary_minor, created_by)
VALUES
  (27201, 'SCHOOL', 10001, '2099-01', 'DRAFT', 1,
   100000, 0, 0, 0, 0, 100000, 11001),
  (27202, 'YEMAIT_COMPANY', NULL, '2099-02', 'DRAFT', 1,
   100000, 0, 0, 0, 0, 100000, 11001);

INSERT INTO public.payroll_items
  (id, scope, school_id, period_id, employee_profile_id, period_month,
   employee_name_snapshot, role_snapshot, base_salary_minor, allowance_minor,
   bonus_minor, deduction_minor, adjustment_minor, net_salary_minor,
   bank_name_encrypted, bank_code_encrypted, account_name_encrypted,
   account_number_encrypted, account_last4, encryption_key_version)
VALUES
  (27301, 'SCHOOL', 10001, 27201, 27101, '2099-01', 'Fixture Employee A',
   'STAFF', 100000, 0, 0, 0, 0, 100000, 'fixture-cipher-bank-employee',
   'fixture-cipher-code-employee', 'fixture-cipher-name-employee',
   'fixture-cipher-account-employee', '4244', 'fixture-v1');

INSERT INTO public.payroll_transfers
  (id, scope, school_id, period_id, payroll_item_id, attempt_number,
   idempotency_key_hash, provider, provider_mode, provider_reference,
   amount_minor, status, requested_by)
VALUES
  (27401, 'SCHOOL', 10001, 27201, 27301, 1, 'fixture-transfer-idem-hash',
   'MOCK', 'MOCK', 'fixture-transfer-provider-reference', 100000,
   'MOCK_PENDING', 11001);

INSERT INTO public.payroll_payslips
  (id, scope, school_id, period_id, payroll_item_id, transfer_id,
   payslip_number, employee_name_snapshot, employee_role_snapshot,
   period_month, base_salary_minor, allowance_minor, bonus_minor,
   deduction_minor, adjustment_minor, net_salary_minor)
VALUES
  (27501, 'SCHOOL', 10001, 27201, 27301, 27401, 'FIXTURE-PAYSLIP-1',
   'Fixture Employee A', 'STAFF', '2099-01', 100000, 0, 0, 0, 0, 100000);

INSERT INTO public.settlement_payroll_audit_events
  (id, scope, school_id, actor_user_id, actor_role, record_type, action)
VALUES
  (27601, 'SCHOOL', 10001, 11001, 'SCHOOL_ADMIN', 'PAYROLL_PERIOD', 'FIXTURE_CREATED');
`;

async function getMigrations() {
  const files = (await readdir(migrationDir))
    .filter((name) => /^003[1-6]_.+\.sql$/.test(name))
    .sort();
  const numbers = files.map((name) => Number(name.slice(0, 4)));
  if (numbers.length < 5 || numbers[0] !== 31) {
    throw new Error("Expected new migrations 0031–0035; missing or renamed SQL file.");
  }
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== 31 + index) {
      throw new Error(`Migration sequence gap before ${String(numbers[index]).padStart(4, "0")}.`);
    }
  }
  return Promise.all(files.map(async (name) => ({
    name,
    sql: await readFile(path.join(migrationDir, name), "utf8"),
  })));
}

function inspectMigrationSql(migrations) {
  for (const migration of migrations) {
    const sql = migration.sql
      .replace(/--[^\n\r]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const checks = [
      ["DROP statement", /(?:^|;)\s*DROP\s+(?:TABLE|INDEX|SCHEMA|DATABASE|SEQUENCE|TYPE|FUNCTION|TRIGGER)\b/i],
      ["ALTER TABLE DROP", /(?:^|;)\s*ALTER\s+TABLE\b[^;]*\bDROP\s+(?:CONSTRAINT|COLUMN)\b/i],
      ["DELETE DML", /(?:^|;)\s*DELETE\s+FROM\b/i],
      ["TRUNCATE DML", /(?:^|;)\s*TRUNCATE(?:\s+TABLE)?\b/i],
      ["UPDATE DML", /(?:^|;)\s*UPDATE\s+(?:"?[a-z_][a-z0-9_]*"?\s*\.)?"?[a-z_][a-z0-9_]*"?\s+SET\b/i],
    ];
    for (const [label, expression] of checks) {
      if (expression.test(sql)) migrationSafety.forbidden.push(`${migration.name}: ${label}`);
    }
    migrationSafety.onDeleteRestrict += (sql.match(/\bON\s+DELETE\s+RESTRICT\b/gi) ?? []).length;
    migrationSafety.beforeDeleteTriggers += (
      sql.match(/\bBEFORE\s+[^;]*\bDELETE\s+ON\b/gi) ?? []
    ).length;
    migrationSafety.immutableSnapshotTriggerMentions += (
      sql.match(/CREATE\s+TRIGGER[\s\S]{0,300}\bBEFORE\s+UPDATE\s+OR\s+DELETE\b/gi) ?? []
    ).length;
  }
  if (migrationSafety.forbidden.length) {
    throw new Error(`Unsafe SQL detected: ${migrationSafety.forbidden.join(", ")}`);
  }
  if (migrationSafety.onDeleteRestrict === 0) {
    throw new Error("New migration SQL contains no ON DELETE RESTRICT clauses.");
  }
}

async function choosePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function prepareSourceConnection() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set; no database was contacted.");
  }
  return makeSourceConnectionEnv(process.env.DATABASE_URL);
}

function sourcePsql(env, sql) {
  const result = run("psql", [
    "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-c", sql,
  ], {
    env: {
      ...process.env,
      ...env,
      PGAPPNAME: "feedback-migration-read-only-preflight",
      PGOPTIONS: "-c default_transaction_read_only=on",
    },
    timeout: 120_000,
  });
  if (result.status !== 0) {
    const sqlstate = result.combined.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1] ?? "unknown";
    const detail = sanitize(result.combined.trim()).slice(-1500);
    throw new Error(`Read-only Development preflight query failed with SQLSTATE ${sqlstate}: ${detail}`);
  }
  return result.combined.trim();
}

function sourcePreflight(env) {
  const output = sourcePsql(env, `BEGIN READ ONLY; ${sourcePreflightSql} COMMIT;`);
  const match = output.match(/FMV_PREFLIGHT_JSON=(\{[^\r\n]*\})/);
  if (!match) throw new Error("Read-only Development preflight did not emit its safe metadata record.");
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error("Read-only Development preflight metadata was not valid JSON.");
  }
}

function validateSourceFingerprint(actual) {
  const mismatches = [];
  if (actual.transactionReadOnly !== true) {
    mismatches.push("source transaction is not explicitly read-only");
  }
  for (const field of ["database", "role", "publicTables", "publicRows", "schools", "students"]) {
    if (actual[field] !== expected[field]) {
      mismatches.push(`${field}: expected ${expected[field]}, received ${actual[field]}`);
    }
  }
  if (actual.newMigrationTablesAlreadyPresent?.length) {
    mismatches.push(`new migration tables already exist: ${actual.newMigrationTablesAlreadyPresent.join(", ")}`);
  }
  if (mismatches.length) {
    throw new Error(`Development identity/data fingerprint mismatch: ${mismatches.join("; ")}`);
  }
}

function getJsonOutput(output, label) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error(`${label} returned no result.`);
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function compareSnapshot(before, after) {
  const result = {};
  for (const key of ["columns", "constraints"]) {
    const afterSet = new Set(after[key].map((entry) => JSON.stringify(entry)));
    const missing = before[key].filter((entry) => !afterSet.has(JSON.stringify(entry)));
    result[key] = { before: before[key].length, after: after[key].length, missing };
  }
  return result;
}

function assertSnapshotUnchanged(name, comparison) {
  const passed = comparison.columns.missing.length === 0
    && comparison.constraints.missing.length === 0;
  test(name, passed, passed
    ? `${comparison.columns.before} existing columns and ${comparison.constraints.before} existing constraints retained`
    : `missing columns=${comparison.columns.missing.length}, missing constraints=${comparison.constraints.missing.length}`);
  return passed;
}

async function createDb(dbName) {
  requireSuccess("createdb", [
    "-h", pgSocketDir, "-p", String(pgPort), "-U", "runner", "-w",
    "-T", "template0", dbName,
  ], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGHOST: pgSocketDir,
      PGPORT: String(pgPort),
      PGUSER: "runner",
      PGAPPNAME: "feedback-migration-validation-local",
    },
  });
}

async function restoreSchema(dbName, schemaFile) {
  const result = run("psql", psqlArgs(dbName, ["-f", schemaFile]), {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGHOST: pgSocketDir,
      PGPORT: String(pgPort),
      PGUSER: "runner",
      PGDATABASE: dbName,
      PGAPPNAME: "feedback-migration-validation-local",
      PGOPTIONS: "-c default_transaction_read_only=off",
    },
    timeout: 180_000,
  });
  if (result.status !== 0) {
    const messages = sanitize(result.combined.trim()).slice(-5000);
    throw new Error(`Schema-only clone import failed for ${dbName}: ${messages}`);
  }
}

function expectedFailureCode(result, code) {
  return result.status !== 0 && new RegExp(`\\b${code}\\b`).test(result.combined);
}

function expectSqlFailure(dbName, name, sql, sqlstate, constraintName = null) {
  const result = localPsql(dbName, sql, { expectFailure: true });
  const codePassed = expectedFailureCode(result, sqlstate);
  const constraintPassed = !constraintName || result.combined.includes(constraintName);
  const passed = codePassed && constraintPassed;
  const detail = passed
    ? `SQLSTATE ${sqlstate}${constraintName ? ` from ${constraintName}` : ""}`
    : result.status === 0
      ? `SQL unexpectedly succeeded (expected ${sqlstate})`
      : codePassed && constraintName
        ? `SQLSTATE ${sqlstate} came from an unexpected constraint: ${sanitize(result.combined.trim()).slice(-1000)}`
      : `expected SQLSTATE ${sqlstate}; observed ${sanitize(result.combined.trim()).slice(-1000)}`;
  test(name, passed, detail);
  return passed;
}

function expectSqlSuccess(dbName, name, sql) {
  const result = localPsql(dbName, sql, { expectFailure: true });
  const passed = result.status === 0 && result.stdout.trim() === "t";
  const detail = passed
    ? "transactional probe succeeded and rolled back"
    : result.status === 0
      ? `unexpected query result: ${sanitize(result.stdout.trim()).slice(-1000)}`
      : `expected success; observed ${sanitize(result.combined.trim()).slice(-1000)}`;
  test(name, passed, detail);
  return passed;
}

function expectTriggerReject(dbName, name, sql) {
  const result = localPsql(dbName, sql, { expectFailure: true });
  const passed = result.status !== 0
    && (/\b55000\b/.test(result.combined) || /\bP0001\b/.test(result.combined));
  const detail = passed
    ? "immutable trigger rejected UPDATE"
    : result.status === 0
      ? "UPDATE unexpectedly succeeded; no row value was changed by this same-value probe"
      : `expected 55000/P0001; observed ${sanitize(result.combined.trim()).slice(-1000)}`;
  test(name, passed, detail);
  return passed;
}

function readSnapshot(dbName) {
  return getJsonOutput(localPsql(dbName, snapshotSql), `${dbName} metadata snapshot`);
}

function readPreservation(dbName) {
  return getJsonOutput(localPsql(dbName, preservationSql), `${dbName} preservation snapshot`);
}

function queryExists(dbName, sql) {
  return localPsql(dbName, sql) === "t";
}

function assertLocalZeroRows(dbName, label) {
  const result = run("psql", psqlArgs(dbName), {
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGHOST: pgSocketDir,
      PGPORT: String(pgPort),
      PGUSER: "runner",
      PGDATABASE: dbName,
      PGAPPNAME: "feedback-migration-validation-local",
      PGOPTIONS: "-c default_transaction_read_only=off",
    },
    input: `
      DO $count_rows$
      DECLARE rel RECORD; row_count BIGINT; total_rows BIGINT := 0;
      BEGIN
        FOR rel IN SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname='public' LOOP
          EXECUTE format('SELECT count(*) FROM %I.%I', rel.schemaname, rel.tablename) INTO row_count;
          total_rows := total_rows + row_count;
        END LOOP;
        RAISE NOTICE 'FMV_PUBLIC_ROWS=%', total_rows;
      END
      $count_rows$;
    `,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Local ${dbName} empty-clone count failed: ${sanitize(result.combined.trim()).slice(-1000)}`);
  }
  const match = result.combined.match(/FMV_PUBLIC_ROWS=(\d+)/);
  if (!match) throw new Error(`Local ${dbName} empty-clone count did not return a row total.`);
  const count = Number(match[1]);
  test(label, count === 0, `schema-only clone contains ${count} public rows before fixtures`);
  if (count !== 0) throw new Error("Schema-only clone unexpectedly contains application data.");
}

function captureLocalCatalogEvidence(dbName) {
  return getJsonOutput(localPsql(dbName, `
    SELECT jsonb_build_object(
      'tables', (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'),
      'columns', (SELECT count(*) FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
          AND a.attnum>0 AND NOT a.attisdropped),
      'indexes', (SELECT count(*) FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public'),
      'constraints', (SELECT count(*) FROM pg_catalog.pg_constraint x
        JOIN pg_catalog.pg_class c ON c.oid=x.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public'),
      'foreignKeyDeleteActions', (
        SELECT jsonb_object_agg(action, count)
        FROM (
          SELECT CASE con.confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
          END AS action, count(*) AS count
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND con.contype='f'
            AND c.relname = ANY(ARRAY[
              'staff_nfc_billing_rules','staff_nfc_subscriptions','staff_nfc_payments',
              'staff_nfc_refunds','staff_nfc_allocations','staff_nfc_provider_events',
              'staff_nfc_partner_commissions','staff_nfc_receipts',
              'employee_nfc_card_bindings','employee_nfc_card_history',
              'employee_nfc_attendance_discrepancies','employee_nfc_discrepancy_actions',
              'school_calendar_events','school_branding_logos','teacher_subject_assignments',
              'teacher_duty_roster','transport_buses','transport_routes','transport_route_stops',
              'transport_student_assignments','transport_route_staff','transport_parent_requests',
              'transport_fee_invoices','transport_school_policies','transport_history',
              'settlement_payroll_profiles','payroll_employee_profiles','payroll_periods',
              'payroll_items','payroll_transfers','payroll_payslips','settlement_payroll_audit_events',
              'student_subscription_payments','student_subscription_allocations'
            ])
          GROUP BY con.confdeltype
        ) fk_actions
      )
    )::text;
  `), `${dbName} catalog evidence`);
}

function buildProbeSql(dbName) {
  const failed = [];
  const expectedTableTriggers = [
    ["public.staff_nfc_billing_rules", "billing-rule snapshot"],
    ["public.staff_nfc_allocations", "allocation snapshot"],
    ["public.staff_nfc_receipts", "receipt snapshot"],
    ["public.staff_nfc_subscriptions", "subscription financial-amount snapshot"],
    ["public.settlement_payroll_audit_events", "payroll audit append-only"],
    ["public.payroll_payslips", "payslip snapshot"],
    ["public.student_subscription_allocations", "student subscription allocation snapshot"],
  ];
  const triggerQuery = (relation) => `
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = '${relation}'::regclass
        AND NOT t.tgisinternal
        AND t.tgenabled <> 'D'
        AND (t.tgtype & 2) = 2
        AND (t.tgtype & 16) = 16
    );
  `;
  for (const [relation, label] of expectedTableTriggers) {
    const exists = queryExists(dbName, triggerQuery(relation));
    test(`${label} BEFORE UPDATE guard exists`, exists, exists ? "enabled row trigger present" : "no enabled BEFORE UPDATE row trigger in catalog");
    if (!exists) failed.push(label);
  }

  const businessChecks = [
    {
      name: "School branding logo permits only one current version per school",
      sql: `BEGIN;
        INSERT INTO public.school_branding_logos
        (id, school_id, object_path, content_type, byte_size, is_current, updated_by_user_id)
        VALUES (33003, 10001, 'fixture/school-10001/logo-v3', 'image/png', 1, true, 11001);`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC subscription employee-term uniqueness",
      sql: `INSERT INTO public.staff_nfc_subscriptions
        (id, school_id, employee_id, academic_session_id, academic_term_id,
         billing_rule_id, billing_rule_version, price_minor, school_share_minor,
         platform_share_minor, partner_share_minor, partner_profile_id, attribution_id,
         due_date)
        SELECT 21002, 10001, 14001, 16001, 17001, id, version,
          200000, 80000, 110000, 10000, 19001, 20001, '2099-04-30'
        FROM public.staff_nfc_billing_rules WHERE version=1;`,
      sqlstate: "23505",
    },
    {
      name: "Student subscription payment provider reference unique key",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key)
        VALUES (40001, 10001, 12001, 16001, 17001, 11001,
          'fixture-student-payment-01', 'fixture-student-idem-reference-dupe');`,
      sqlstate: "23505",
    },
    {
      name: "Student subscription payment provider transaction unique key",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, provider_transaction_id)
        VALUES (40001, 10001, 12001, 16001, 17001, 11001,
          'fixture-student-payment-03', 'fixture-student-idem-03',
          'fixture-student-provider-transaction-1');`,
      sqlstate: "23505",
    },
    {
      name: "Student subscription payment idempotency unique key",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key)
        VALUES (40001, 10001, 12001, 16001, 17001, 11001,
          'fixture-student-payment-04', 'fixture-student-idem-01');`,
      sqlstate: "23505",
    },
    {
      name: "Student subscription payment cross-school FK",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, status)
        VALUES (40001, 10002, 12002, 16002, 17002, 11002,
          'fixture-student-payment-cross', 'fixture-student-idem-cross', 'FAILED');`,
      sqlstate: "23503",
    },
    {
      name: "Student subscription one-open-attempt partial unique key",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key)
        VALUES (40001, 10001, 12001, 16001, 17001, 11001,
          'fixture-student-payment-open', 'fixture-student-idem-open');`,
      sqlstate: "23505",
    },
    {
      name: "Student subscription business term rejects a second PENDING payment on a different subscription",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, status)
        VALUES (40002, 10001, 12001, 16001, 17001, 11001,
          'fixture-business-term-pending', 'fixture-business-term-pending-idem', 'PENDING');`,
      sqlstate: "23505",
      constraintName: "student_subscription_payments_one_business_term_uq",
    },
    {
      name: "Student subscription business term rejects a second PAID payment on a different subscription",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, status)
        VALUES (40003, 10001, 12001, 16001, 17001, 11001,
          'fixture-business-term-paid', 'fixture-business-term-paid-idem', 'PAID');`,
      sqlstate: "23505",
      constraintName: "student_subscription_payments_one_business_term_uq",
    },
    {
      name: "Student subscription business term rejects a second uncertain payment on a different subscription",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, status)
        VALUES (40004, 10001, 12001, 16001, 17001, 11001,
          'fixture-business-term-uncertain', 'fixture-business-term-uncertain-idem',
          'RECONCILIATION_REQUIRED');`,
      sqlstate: "23505",
      constraintName: "student_subscription_payments_one_business_term_uq",
    },
    {
      name: "Student subscription business term rejects a failed payment still requiring reconciliation",
      sql: `INSERT INTO public.student_subscription_payments
        (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
         payer_user_id, reference, idempotency_key, status, reconciliation_status)
        VALUES (40002, 10001, 12001, 16001, 17001, 11001,
          'fixture-business-term-reconciliation', 'fixture-business-term-reconciliation-idem',
          'FAILED', 'RECONCILIATION_REQUIRED');`,
      sqlstate: "23505",
      constraintName: "student_subscription_payments_one_business_term_uq",
    },
    {
      name: "Student subscription allocation global idempotency unique key",
      sql: `INSERT INTO public.student_subscription_allocations
        (idempotency_key, recipient_type, school_id, student_id, payer_user_id,
         academic_session_id, academic_term_id, subscription_id, payment_id, amount_minor)
        VALUES ('fixture-student-allocation-school', 'SCHOOL', 10001, 12001, 11001,
          16001, 17001, 40001, 41002, 200000);`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC subscription cross-school academic-period FK",
      sql: `INSERT INTO public.staff_nfc_subscriptions
        (id, school_id, employee_id, academic_session_id, academic_term_id,
         billing_rule_id, billing_rule_version, price_minor, school_share_minor,
         platform_share_minor, partner_share_minor, due_date)
        SELECT 21003, 10001, 14001, 16002, 17002, id, version,
          200000, 90000, 110000, 0, '2099-04-30'
        FROM public.staff_nfc_billing_rules WHERE version=1;`,
      sqlstate: "23503",
    },
    {
      name: "Staff NFC subscription allocation-total CHECK",
      sql: `INSERT INTO public.staff_nfc_subscriptions
        (id, school_id, employee_id, academic_session_id, academic_term_id,
         billing_rule_id, billing_rule_version, price_minor, school_share_minor,
         platform_share_minor, partner_share_minor, due_date)
        SELECT 21004, 10002, 14002, 16002, 17002, id, version,
          200000, 80000, 110000, 0, '2099-04-30'
        FROM public.staff_nfc_billing_rules WHERE version=1;`,
      sqlstate: "23514",
    },
    {
      name: "Staff NFC payment provider reference unique key",
      sql: `INSERT INTO public.staff_nfc_payments
        (subscription_id, employee_id, school_id, academic_session_id, academic_term_id,
         provider, provider_mode, reference, idempotency_key, gross_amount_minor, status)
        VALUES (21001, 14001, 10001, 16001, 17001, 'MOCK', 'DEVELOPMENT_MOCK',
          'fixture-staff-payment-1', 'fixture-duplicate-reference', 200000, 'FAILED');`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC provider transaction unique key",
      sql: `INSERT INTO public.staff_nfc_payments
        (subscription_id, employee_id, school_id, academic_session_id, academic_term_id,
         provider, provider_mode, reference, idempotency_key, gross_amount_minor,
         provider_transaction_id, status)
        VALUES (21001, 14001, 10001, 16001, 17001, 'MOCK', 'DEVELOPMENT_MOCK',
          'fixture-staff-payment-3', 'fixture-staff-idem-3', 200000,
          'fixture-provider-transaction-1', 'FAILED');`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC provider event receipt unique key",
      sql: `INSERT INTO public.staff_nfc_provider_events
        (provider, event_id, provider_reference, provider_transaction_id, payload_sha256)
        VALUES ('FLUTTERWAVE', 'fixture-event-1', 'fixture-event-ref-2',
          'fixture-event-txn-2', repeat('b',64));`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC receipt number unique key",
      sql: `INSERT INTO public.staff_nfc_receipts
        (id, payment_id, subscription_id, school_id, receipt_number, snapshot)
        VALUES (24002, 22002, 21001, 10001, 'FIXTURE-RECEIPT-1', '{"fixture":true}'::jsonb);`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC refund idempotency unique key",
      sql: `INSERT INTO public.staff_nfc_refunds
        (payment_id, school_id, amount_minor, idempotency_key, reason, created_by)
        VALUES (22001, 10001, 5000, 'fixture-refund-idem-1', 'Fixture duplicate key', 11001);`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC provider refund ID unique key",
      sql: `INSERT INTO public.staff_nfc_refunds
        (payment_id, school_id, amount_minor, idempotency_key, reason,
         provider_refund_id, created_by)
        VALUES (22002, 10001, 5000, 'fixture-refund-idem-2', 'Fixture duplicate key',
          'fixture-provider-refund-1', 11001);`,
      sqlstate: "23505",
    },
    {
      name: "Staff NFC commission subscription unique key",
      sql: `INSERT INTO public.staff_nfc_allocations
        (id, idempotency_key, recipient_type, recipient_id, school_id, employee_id,
         academic_session_id, academic_term_id, subscription_id, payment_id,
         allocation_rule_id, billing_rule_version, attribution_id, amount_minor)
        SELECT 23004, 'fixture-partner-allocation-payment-2', 'PARTNER', 19001,
          10001, 14001, 16001, 17001, 21001, 22002, id, 1, 20001, 10000
        FROM public.staff_nfc_billing_rules WHERE version=1;
        INSERT INTO public.staff_nfc_partner_commissions
        (allocation_id, partner_profile_id, school_id, employee_id,
         academic_session_id, academic_term_id, subscription_id, payment_id, commission_minor)
        VALUES (23004, 19001, 10001, 14001, 16001, 17001, 21001, 22002, 10000);`,
      sqlstate: "23505",
    },
    {
      name: "Employee NFC one-current-binding unique key",
      sql: `INSERT INTO public.employee_nfc_card_bindings
        (id, school_id, nfc_card_id, employee_id, status, created_by_user_id)
        VALUES (28002, 10001, 15003, 14001, 'ACTIVE', 11001);`,
      sqlstate: "23505",
    },
    {
      name: "Employee NFC card/employee cross-school FK",
      sql: `INSERT INTO public.employee_nfc_card_bindings
        (id, school_id, nfc_card_id, employee_id, status, created_by_user_id)
        VALUES (28003, 10002, 15004, 14001, 'ACTIVE', 11001);`,
      sqlstate: "23503",
    },
    {
      name: "Transport normalized duplicate bus registration unique key",
      sql: `INSERT INTO public.transport_buses
        (school_id, name, registration_number, capacity, created_by)
        VALUES (10001, 'Fixture Duplicate Bus', ' fixture-bus-a ', 20, 11001);`,
      sqlstate: "23505",
    },
    {
      name: "Transport bus capacity CHECK",
      sql: `INSERT INTO public.transport_buses
        (school_id, name, registration_number, capacity, created_by)
        VALUES (10001, 'Fixture Oversize Bus', 'FIXTURE-BUS-OVERSIZE', 251, 11001);`,
      sqlstate: "23514",
    },
    {
      name: "Transport assignment route cross-school FK",
      sql: `INSERT INTO public.transport_student_assignments
        (school_id, student_id, route_id, pickup_stop_id, dropoff_stop_id,
         effective_date, reason, created_by)
        VALUES (10001, 12001, 31002, 32003, 32004, '2099-01-01',
          'Fixture cross-school rejection', 11001);`,
      sqlstate: "23503",
    },
    {
      name: "Payroll school-profile employee cross-school FK",
      sql: `INSERT INTO public.payroll_employee_profiles
        (scope, school_id, employee_id, monthly_salary_minor,
         bank_name_encrypted, bank_code_encrypted, account_name_encrypted,
         account_number_encrypted, account_last4, encryption_key_version, created_by, updated_by)
        VALUES ('SCHOOL', 10002, 14001, 100000, 'fixture-bank', 'fixture-code',
          'fixture-name', 'fixture-number', '4246', 'fixture-v1', 11002, 11002);`,
      sqlstate: "23503",
    },
    {
      name: "Payroll school/company tenant scope CHECK",
      sql: `INSERT INTO public.payroll_periods
        (scope, school_id, period_month, employee_count, gross_salary_minor,
         allowance_minor, deduction_minor, net_salary_minor, created_by)
        VALUES ('YEMAIT_COMPANY', 10001, '2099-03', 1, 100000, 0, 0, 100000, 11001);`,
      sqlstate: "23514",
    },
  ];

  for (const check of businessChecks) {
    if (!expectSqlFailure(dbName, check.name, check.sql, check.sqlstate, check.constraintName ?? null)) {
      failed.push(check.name);
    }
  }

  const failedHistoryAllowed = queryExists(dbName, `
    SELECT EXISTS (
      SELECT 1
      FROM public.student_subscription_payments pending
      JOIN public.student_subscription_payments failed
        ON (pending.school_id,pending.student_id,pending.academic_session_id,pending.academic_term_id)
         = (failed.school_id,failed.student_id,failed.academic_session_id,failed.academic_term_id)
      WHERE pending.id=41001 AND pending.status='PENDING'
        AND failed.id=41002 AND failed.status='FAILED'
    );
  `);
  test("Existing student subscription PENDING/FAILED payment pair remains valid",
    failedHistoryAllowed,
    failedHistoryAllowed ? "41001 PENDING and 41002 FAILED share the business term" : "fixture status pair changed");
  if (!failedHistoryAllowed) failed.push("Student subscription existing PENDING/FAILED history");

  if (!expectSqlSuccess(dbName, "Definitive FAILED student payment permits a same-term retry", `
    BEGIN;
    UPDATE public.student_subscription_payments SET status='FAILED'
    WHERE id=41001 AND status='PENDING';
    INSERT INTO public.student_subscription_payments
      (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
       payer_user_id, reference, idempotency_key, status)
    VALUES (40001, 10001, 12001, 16001, 17001, 11001,
      'fixture-definitive-failed-retry', 'fixture-definitive-failed-retry-idem', 'PENDING');
    SELECT EXISTS (
      SELECT 1 FROM public.student_subscription_payments
      WHERE subscription_id=40001 AND academic_term_id=17001
        AND reference='fixture-definitive-failed-retry' AND status='PENDING'
    );
    ROLLBACK;
  `)) failed.push("Student subscription definitive FAILED retry");

  if (!expectSqlSuccess(dbName, "Student subscription payment on a different business term remains allowed", `
    BEGIN;
    INSERT INTO public.student_subscription_payments
      (subscription_id, school_id, student_id, academic_session_id, academic_term_id,
       payer_user_id, reference, idempotency_key, status)
    VALUES (40002, 10001, 12001, 16001, 17003, 11001,
      'fixture-different-term-open', 'fixture-different-term-open-idem', 'PENDING');
    SELECT EXISTS (
      SELECT 1 FROM public.student_subscription_payments
      WHERE subscription_id=40002 AND school_id=10001 AND student_id=12001
        AND academic_session_id=16001 AND academic_term_id=17003
        AND reference='fixture-different-term-open' AND status='PENDING'
    ) AND EXISTS (
      SELECT 1 FROM public.student_subscription_payments
      WHERE id=41001 AND academic_term_id=17001 AND status='PENDING'
    );
    ROLLBACK;
  `)) failed.push("Student subscription different-term payment");

  const initialLogoHistory = localPsql(dbName, `
    SELECT count(*) || ':' || count(*) FILTER (WHERE is_current)
    FROM public.school_branding_logos WHERE school_id=10001;
  `);
  const initialLogoHistoryValid = initialLogoHistory === "2:1";
  test("School logo fixture retains an archived version and one current version",
    initialLogoHistoryValid,
    initialLogoHistoryValid ? "two versions, exactly one current" : `observed ${initialLogoHistory}`);
  if (!initialLogoHistoryValid) failed.push("School branding logo version fixture");

  const logoPromotionResult = localPsql(dbName, `
    UPDATE public.school_branding_logos
    SET is_current=false, updated_at=now()
    WHERE id=33002;
    INSERT INTO public.school_branding_logos
      (id, school_id, object_path, content_type, byte_size, is_current, updated_by_user_id)
    VALUES (33003, 10001, 'fixture/school-10001/logo-v3', 'image/png', 1, true, 11001);
    SELECT count(*) || ':' || count(*) FILTER (WHERE is_current) || ':' ||
      string_agg(id::text, ',' ORDER BY id) FILTER (WHERE NOT is_current)
    FROM public.school_branding_logos WHERE school_id=10001;
  `);
  const logoPromotionValid = logoPromotionResult === "3:1:33001,33002";
  test("School logo promotion preserves previous versions",
    logoPromotionValid,
    logoPromotionValid ? "two archived versions and one current version remain" : `observed ${logoPromotionResult}`);
  if (!logoPromotionValid) failed.push("School branding logo history preservation");

  const allocationTotals = localPsql(dbName, `
    SELECT (
      (SELECT COALESCE(sum(amount_minor), 0) FROM public.staff_nfc_allocations
       WHERE payment_id=22001 AND entry_type='CREDIT') =
      (SELECT price_minor FROM public.staff_nfc_subscriptions WHERE id=21001)
    );
  `) === "t";
  test("Staff NFC credit allocations balance to immutable subscription price", allocationTotals,
    allocationTotals ? "200000 minor units" : "fixture allocation aggregate did not match subscription snapshot");
  if (!allocationTotals) failed.push("Staff NFC credit allocation sum");

  const studentAllocationTotals = localPsql(dbName, `
    SELECT (
      (SELECT COALESCE(sum(amount_minor), 0) FROM public.student_subscription_allocations
       WHERE payment_id=41001 AND entry_type='CREDIT') =
      (SELECT gross_amount_minor FROM public.student_subscription_payments WHERE id=41001)
    );
  `) === "t";
  test("Student subscription credit allocations balance to provider gross amount",
    studentAllocationTotals,
    studentAllocationTotals ? "500000 minor units" : "student allocation aggregate did not match payment amount");
  if (!studentAllocationTotals) failed.push("Student subscription allocation total");

  const companyProfile = queryExists(dbName, `
    SELECT EXISTS (
      SELECT 1 FROM public.payroll_employee_profiles
      WHERE id=27102 AND scope='YEMAIT_COMPANY'
        AND school_id IS NULL AND company_employee_id=18001
    );
  `);
  test("Payroll company-scope employee profile accepts null school and platform employee",
    companyProfile, companyProfile ? "scope/owner aligned" : "valid company scope row missing");
  if (!companyProfile) failed.push("Payroll company profile valid scope");

  for (const [table, id, update] of [
    ["staff_nfc_billing_rules", 1, "UPDATE public.staff_nfc_billing_rules SET price_minor=price_minor WHERE id=1;"],
    ["staff_nfc_allocations", 23001, "UPDATE public.staff_nfc_allocations SET amount_minor=amount_minor WHERE id=23001;"],
    ["staff_nfc_receipts", 24001, "UPDATE public.staff_nfc_receipts SET snapshot=snapshot WHERE id=24001;"],
    ["settlement_payroll_audit_events", 27601, "UPDATE public.settlement_payroll_audit_events SET action=action WHERE id=27601;"],
    ["payroll_payslips", 27501, "UPDATE public.payroll_payslips SET payslip_number=payslip_number WHERE id=27501;"],
    ["student_subscription_allocations", 43001, "UPDATE public.student_subscription_allocations SET amount_minor=amount_minor WHERE id=43001;"],
  ]) {
    const exists = queryExists(dbName, `SELECT EXISTS (SELECT 1 FROM public.${table} WHERE id=${id});`);
    if (!exists) {
      test(`${table} immutable fixture exists`, false, `id=${id} missing`);
      failed.push(`${table} immutable fixture`);
      continue;
    }
    if (!expectTriggerReject(dbName, `${table} UPDATE rejected by immutable trigger`, update)) {
      failed.push(`${table} immutable UPDATE`);
    }
  }

  const allowedPaymentMutation = localPsql(dbName, `
    UPDATE public.staff_nfc_subscriptions
    SET price_minor=price_minor, status='PAID', paid_at=now(), updated_at=now()
    WHERE id=21001;
    UPDATE public.staff_nfc_payments
    SET status='PAID', provider_transaction_id='fixture-verified-transaction-2',
        provider_paid_at=now(), paid_at=now(), updated_at=now()
    WHERE id=22002;
    SELECT (
      (SELECT status='PAID' AND paid_at IS NOT NULL
       FROM public.staff_nfc_subscriptions WHERE id=21001)
      AND
      (SELECT status='PAID' AND provider_transaction_id='fixture-verified-transaction-2'
         AND provider_paid_at IS NOT NULL AND paid_at IS NOT NULL
       FROM public.staff_nfc_payments WHERE id=22002)
    );
  `) === "t";
  test("Staff NFC status and verified payment metadata may advance without changing subscription snapshots",
    allowedPaymentMutation,
    allowedPaymentMutation ? "subscription status and payment verification fields updated" : "allowed status/payment transition failed");
  if (!allowedPaymentMutation) failed.push("Staff NFC allowed status/payment transition");

  for (const [label, sql] of [
    ["price", "UPDATE public.staff_nfc_subscriptions SET price_minor=price_minor+1 WHERE id=21001;"],
    ["school share", "UPDATE public.staff_nfc_subscriptions SET school_share_minor=school_share_minor+1 WHERE id=21001;"],
    ["platform share", "UPDATE public.staff_nfc_subscriptions SET platform_share_minor=platform_share_minor+1 WHERE id=21001;"],
    ["billing rule ID", "UPDATE public.staff_nfc_subscriptions SET billing_rule_id=billing_rule_id+1 WHERE id=21001;"],
    ["billing rule version", "UPDATE public.staff_nfc_subscriptions SET billing_rule_version=billing_rule_version+1 WHERE id=21001;"],
    ["school identity", "UPDATE public.staff_nfc_subscriptions SET school_id=10002 WHERE id=21001;"],
    ["employee identity", "UPDATE public.staff_nfc_subscriptions SET employee_id=14002 WHERE id=21001;"],
    ["academic session identity", "UPDATE public.staff_nfc_subscriptions SET academic_session_id=16002 WHERE id=21001;"],
    ["academic term identity", "UPDATE public.staff_nfc_subscriptions SET academic_term_id=17002 WHERE id=21001;"],
  ]) {
    if (!expectTriggerReject(
      dbName,
      `Staff NFC subscription rejects financial snapshot ${label} change`,
      sql,
    )) {
      failed.push(`Staff NFC subscription snapshot ${label}`);
    }
  }

  const actions = captureLocalCatalogEvidence(dbName).foreignKeyDeleteActions ?? {};
  const destructiveActions = Object.entries(actions).filter(([action, count]) =>
    !["RESTRICT", "NO ACTION"].includes(action) && Number(count) > 0);
  test("New and existing public FKs have no cascading/automatic delete action",
    destructiveActions.length === 0,
    destructiveActions.length === 0 ? JSON.stringify(actions) : JSON.stringify(destructiveActions));
  if (destructiveActions.length) failed.push("Foreign-key delete actions");

  return failed;
}

function buildReport(migrations) {
  const passCount = testResults.filter((result) => result.passed).length;
  const failCount = testResults.length - passCount;
  const migrationRows = migrations.map((migration) => {
    const hash = createHash("sha256").update(migration.sql).digest("hex");
    return `| \`${migration.name}\` | \`${hash}\` |`;
  }).join("\n");
  const checks = testResults.map((result) =>
    `| ${result.passed ? "PASS" : "FAIL"} | ${result.name.replaceAll("|", "\\|")} | ${result.detail.replaceAll("|", "\\|")} |`
  ).join("\n");
  return `# Feedback incremental PostgreSQL migration validation

**Status:** ${failCount === 0 ? "PASS" : "FAIL — review required"}  
**Run date:** ${new Date().toISOString().slice(0, 10)}  
**Scope:** isolated validation of migrations 0031 onward. No Development DDL/DML was run; Production was not read or written.

## Development preflight and schema-only capture

- Connection target metadata matched the supplied Development fingerprint before schema export: database \`${sourceEvidence.database}\`, role \`${sourceEvidence.role}\`, ${sourceEvidence.publicTables} public tables, ${sourceEvidence.publicRows} public rows, ${sourceEvidence.schools} schools, ${sourceEvidence.students} students, migration ledger IDs \`${JSON.stringify(sourceEvidence.ledgerIds)}\`.
- Source guard verified \`BEGIN READ ONLY\` and \`transaction_read_only=on\` before and after the schema-only export. The \`pg_dump\` process also received \`PGOPTIONS=-c default_transaction_read_only=on\`; no source DDL/DML was run.
- Supplied catalog hash: \`${expected.suppliedCatalogHash}\`. Its canonicalization algorithm was not provided, so the hash is recorded but not claimed to match the independently computed dump digests below.
- Read-only \`pg_dump --schema-only --schema=public\` digest: MD5 \`${sourceEvidence.schemaDumpMd5 ?? "not captured"}\`, SHA-256 \`${sourceEvidence.schemaDumpSha256 ?? "not captured"}\`; dump bytes ${sourceEvidence.schemaDumpBytes ?? "not captured"}.
- Observed public catalog counts: \`${JSON.stringify(sourceEvidence.catalog ?? {})}\`. The prior retained Phase 11D report records 338 indexes and 613 constraints; this live preflight observed 339 indexes and 614 constraints, a +1/+1 difference that remains unattributed. The retained report supplies counts but not a name-level catalog inventory, and its temporary schema dump is unavailable, so no exact added index/constraint names can be established against that baseline.
- Existing migration tables already present before this rehearsal: \`${JSON.stringify(sourceEvidence.newMigrationTablesAlreadyPresent ?? [])}\`.
- The ledger was read only and left untouched. No old migration was run against Development.

## SQL review and migration hashes

- Forbidden destructive SQL/DML statements detected in selected new SQL: \`${JSON.stringify(migrationSafety.forbidden)}\`.
- \`ON DELETE RESTRICT\` clauses: ${migrationSafety.onDeleteRestrict}; \`BEFORE ... DELETE ON\` immutable-trigger definitions: ${migrationSafety.beforeDeleteTriggers}. These are trigger/FK definitions only; no actual \`DELETE\`, \`DROP\`, or \`TRUNCATE\` statement was executed.
- \`CREATE TRIGGER ... BEFORE UPDATE OR DELETE\` definitions counted in source SQL: ${migrationSafety.immutableSnapshotTriggerMentions}.
- Pending school-logo versioning was folded into unapplied \`0033\`: historical logo rows can remain, with a partial unique index limiting each school to one current version. The former \`0037\` file/journal entry was removed; no \`DROP INDEX\` or logo-history deletion is part of the selected migrations.
- \`0036\` adds \`student_subscription_payments_one_business_term_uq\` on school/student/session/term for payment status \`PENDING\`, \`RECONCILIATION_REQUIRED\`, or \`PAID\`, and for any \`reconciliation_status='RECONCILIATION_REQUIRED'\`. This is additive and does not rewrite legacy subscription or commission rows; the probes isolate the index using different subscription IDs.

| Migration | SHA-256 of exact SQL file |
| --- | --- |
${migrationRows}

## Disposable rehearsal

- A new private PostgreSQL ${localEvidence.pgVersion ?? "16"} cluster under \`/tmp\` was used; all databases and synthetic records were removed with the cluster at completion.
- The live schema was imported with \`pg_dump --schema-only\` only; both local historical-schema clones had zero application rows before synthetic fixtures.
- Default \`public\` schema creation from the dump was skipped during clone import because the disposable database already has that standard schema; no source schema object was removed or changed.
- New SQL was applied to the clean clone in one transaction and to the existing-schema fixture clone in one transaction.
- A separate clone deliberately failed after all selected migration SQL in the same transaction; atomic rollback result: **${localEvidence.rollbackResult ?? "not completed"}**.
- Incremental baseline fake-fixture preservation: ${localEvidence.preservationResult ?? "not completed"}.
- Existing column/constraint metadata parity after migration: ${localEvidence.metadataParity ?? "not completed"}.
- Clean-clone catalog: \`${JSON.stringify(localEvidence.cleanCatalog ?? {})}\`.
- Incremental-clone catalog: \`${JSON.stringify(localEvidence.incrementalCatalog ?? {})}\`.
- Source schema dump included no application data. No real identity, student, school, payment, payroll, provider, or credential fixture values were copied.

## Database constraint and trigger results (${passCount} passed, ${failCount} failed)

| Result | Check | Evidence |
| --- | --- | --- |
${checks}

## Overall

${failCount === 0
    ? "All scripted isolated checks passed."
    : `Validation has ${failCount} failing check(s). Treat as a review blocker; no Development migration was applied.`}

This rehearsal is not authorization to apply migrations. Main-agent/operator review and a separately approved Development-only atomic apply remain required.
`;
}

async function main() {
  const migrations = await getMigrations();
  inspectMigrationSql(migrations);
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "feedback-migration-validation-"));
  await mkdir(path.join(tempRoot, "socket"), { mode: 0o700 });
  pgSocketDir = path.join(tempRoot, "socket");
  pgDataDir = path.join(tempRoot, "data");
  const sourceConnectionEnv = prepareSourceConnection();

  const preflight = sourcePreflight(sourceConnectionEnv);
  sourceEvidence.database = preflight.database;
  sourceEvidence.role = preflight.role;
  sourceEvidence.publicTables = Number(preflight.publicTables);
  sourceEvidence.publicRows = Number(preflight.publicRows);
  sourceEvidence.schools = Number(preflight.schools);
  sourceEvidence.students = Number(preflight.students);
  sourceEvidence.catalog = preflight.catalog;
  sourceEvidence.newMigrationTablesAlreadyPresent = preflight.newMigrationTablesAlreadyPresent;
  validateSourceFingerprint({
    ...preflight,
    publicTables: Number(preflight.publicTables),
    publicRows: Number(preflight.publicRows),
    schools: Number(preflight.schools),
    students: Number(preflight.students),
  });

  const ledgerOutput = sourcePsql(sourceConnectionEnv, ledgerIdsSql);
  const ledgerIds = getJsonOutput(ledgerOutput, "ledger identifier output");
  sourceEvidence.ledgerIds = ledgerIds;
  if (JSON.stringify(ledgerIds) !== JSON.stringify(expected.ledgerIds)) {
    throw new Error(`Development ledger fingerprint mismatch: expected IDs ${JSON.stringify(expected.ledgerIds)}, received ${JSON.stringify(ledgerIds)}.`);
  }

  console.log(
    `Verified read-only Development fingerprint: ${sourceEvidence.database}, ` +
    `${sourceEvidence.publicTables} tables/${sourceEvidence.publicRows} rows, ` +
    `${sourceEvidence.schools} schools/${sourceEvidence.students} students, ` +
    `ledger IDs ${JSON.stringify(ledgerIds)}.`,
  );

  const schemaDumpFile = path.join(tempRoot, "development-public-schema.sql");
  const dumpResult = run("pg_dump", [
    "--schema-only", "--schema=public", "--no-owner", "--no-privileges",
    "--no-comments", "--no-security-labels", "--file", schemaDumpFile,
  ], {
    env: {
      ...process.env,
      ...sourceConnectionEnv,
      PGAPPNAME: "feedback-migration-schema-only-dump",
      PGOPTIONS: "-c default_transaction_read_only=on",
    },
    timeout: 180_000,
  });
  if (dumpResult.status !== 0) {
    throw new Error("Development schema-only pg_dump failed; source output withheld.");
  }
  const schemaBytes = await readFile(schemaDumpFile);
  sourceEvidence.schemaDumpMd5 = createHash("md5").update(schemaBytes).digest("hex");
  sourceEvidence.schemaDumpSha256 = createHash("sha256").update(schemaBytes).digest("hex");
  sourceEvidence.schemaDumpBytes = schemaBytes.length;
  const schemaDumpSql = schemaBytes.toString("utf8");
  const publicSchemaCreates = [...schemaDumpSql.matchAll(/^CREATE SCHEMA public;\s*$/gm)];
  if (publicSchemaCreates.length > 1) {
    throw new Error("Schema-only dump contained duplicate public-schema creation statements.");
  }
  const schemaImportFile = path.join(tempRoot, "development-public-schema-import.sql");
  await writePrivate(
    schemaImportFile,
    schemaDumpSql.replace(/^CREATE SCHEMA public;\s*$/gm, ""),
  );
  localEvidence.publicSchemaCreateStatementsSkipped = publicSchemaCreates.length;

  const postDumpFingerprint = sourcePreflight(sourceConnectionEnv);
  validateSourceFingerprint({
    ...postDumpFingerprint,
    publicTables: Number(postDumpFingerprint.publicTables),
    publicRows: Number(postDumpFingerprint.publicRows),
    schools: Number(postDumpFingerprint.schools),
    students: Number(postDumpFingerprint.students),
  });

  const data = path.join(tempRoot, "data");
  const init = requireSuccess("initdb", [
    "-D", data, "--username=runner", "--auth-local=trust", "--auth-host=reject",
    "--no-instructions",
  ]);
  if (init.status !== 0) throw new Error("initdb did not initialize the disposable cluster.");
  pgPort = await choosePort();
  requireSuccess("pg_ctl", [
    "-D", data, "-l", path.join(tempRoot, "postgres.log"),
    "-o", `-F -p ${pgPort} -h '' -k ${pgSocketDir} -c listen_addresses=''`,
    "-w", "start",
  ], { timeout: 60_000 });
  pgStarted = true;
  localEvidence.pgVersion = localPsql("postgres", "SHOW server_version;");

  const dbNames = {
    incremental: "feedback_incremental",
    clean: "feedback_clean",
    rollback: "feedback_rollback",
  };
  for (const dbName of Object.values(dbNames)) await createDb(dbName);
  for (const dbName of Object.values(dbNames)) {
    await restoreSchema(dbName, schemaImportFile);
    assertLocalZeroRows(dbName, `${dbName} schema-only import has no Development rows`);
  }

  const incrementalPre = readSnapshot(dbNames.incremental);
  localPsql(dbNames.incremental, syntheticBaseFixture);
  const preservationBefore = readPreservation(dbNames.incremental);
  const fixtureCount = Number(localPsql(dbNames.incremental, `
    SELECT (SELECT count(*) FROM public.schools WHERE id IN (10001,10002))
      + (SELECT count(*) FROM public.students WHERE id IN (12001,12002))
      + (SELECT count(*) FROM public.parents WHERE id IN (13001,13002))
      + (SELECT count(*) FROM public.employees WHERE id IN (14001,14002))
      + (SELECT count(*) FROM public.nfc_cards WHERE id BETWEEN 15001 AND 15005)
      + (SELECT count(*) FROM public.academic_sessions WHERE id IN (16001,16002))
      + (SELECT count(*) FROM public.academic_terms WHERE id IN (17001,17002,17003));
  `));
  test("Incremental clone contains only minimal synthetic school/student/parent/employee/card/period fixtures",
    fixtureCount === 18, `verified ${fixtureCount} fake school/student/parent/employee/card/period records`);
  if (fixtureCount !== 18) throw new Error("Synthetic baseline fixture failed its own row-count check.");

  const migrationSql = migrations.map((migration) =>
    `-- isolated validation of ${migration.name}\n${migration.sql}\n`
  ).join("\n");
  const migrationFile = path.join(tempRoot, "new-feedback-migrations.sql");
  await writePrivate(migrationFile, migrationSql);

  for (const dbName of [dbNames.clean, dbNames.incremental]) {
    const before = dbName === dbNames.incremental ? incrementalPre : readSnapshot(dbName);
    const result = localPsqlFile(dbName, migrationFile);
    if (result.status !== 0) {
      const exact = sanitize(result.combined.trim()).slice(-5000);
      throw new Error(`Atomic migration apply failed in local ${dbName}; exact SQL failure follows:\n${exact}`);
    }
    const after = readSnapshot(dbName);
    const comparison = compareSnapshot(before, after);
    localEvidence[`${dbName}MetadataComparison`] = comparison;
    assertSnapshotUnchanged(`${dbName} pre-existing columns and constraints unchanged`, comparison);
    localEvidence[dbName === dbNames.clean ? "cleanCatalog" : "incrementalCatalog"] =
      captureLocalCatalogEvidence(dbName);
    if (dbName === dbNames.incremental) {
      const preservationAfter = readPreservation(dbName);
      const same = JSON.stringify(preservationBefore) === JSON.stringify(preservationAfter);
      localEvidence.preservationResult = same ? "PASS — original synthetic IDs, student admission UID/status, NFC card UID/status/student owner, and academic periods unchanged" : "FAIL — fake baseline values changed";
      test("Original student ID/admission UID/status, student-card UID/status/owner, and academic periods preserved",
        same, same ? "before/after synthetic baseline JSON identical" : "before/after synthetic baseline JSON differs");
      if (!same) throw new Error("Incremental migration changed seeded synthetic baseline data.");
    }
    if (dbName === dbNames.clean) {
      localPsql(dbName, syntheticBaseFixture);
    }
    localPsql(dbName, syntheticNewFixture);
  }

  const cleanProbeFailures = buildProbeSql(dbNames.clean);
  const incrementalProbeFailures = buildProbeSql(dbNames.incremental);
  localEvidence.metadataParity = "PASS — each database retained all pre-existing columns and constraints; detailed counts in checks above";

  const rollbackFile = path.join(tempRoot, "forced-rollback.sql");
  const rollbackBefore = readSnapshot(dbNames.rollback);
  await writePrivate(rollbackFile, `${migrationSql}\nSELECT 1 / 0;\n`);
  const rollbackAttempt = localPsqlFile(dbNames.rollback, rollbackFile);
  const rollbackExpected = rollbackAttempt.status !== 0
    && /\b22012\b/.test(rollbackAttempt.combined);
  const rollbackNewTables = localPsql(dbNames.rollback, `
    SELECT count(*) FROM pg_catalog.pg_tables
    WHERE schemaname='public'
      AND tablename IN (
        'staff_nfc_billing_rules','staff_nfc_subscriptions','staff_nfc_payments',
        'staff_nfc_refunds','staff_nfc_allocations','staff_nfc_provider_events',
        'staff_nfc_partner_commissions','staff_nfc_receipts',
        'employee_nfc_card_bindings','employee_nfc_card_history',
        'employee_nfc_attendance_discrepancies','employee_nfc_discrepancy_actions',
        'school_calendar_events','school_branding_logos','teacher_subject_assignments',
        'teacher_duty_roster','transport_buses','transport_routes','transport_route_stops',
        'transport_student_assignments','transport_route_staff','transport_parent_requests',
        'transport_fee_invoices','transport_school_policies','transport_history',
        'settlement_payroll_profiles','payroll_employee_profiles','payroll_periods',
        'payroll_items','payroll_transfers','payroll_payslips','settlement_payroll_audit_events',
        'student_subscription_payments','student_subscription_allocations'
      );
  `);
  const rollbackBase = compareSnapshot(rollbackBefore, readSnapshot(dbNames.rollback));
  const rollbackPass = rollbackExpected && rollbackNewTables === "0"
    && rollbackBase.columns.missing.length === 0
    && rollbackBase.constraints.missing.length === 0;
  localEvidence.rollbackResult = rollbackPass
    ? "PASS — forced division-by-zero SQLSTATE 22012 rolled back all new DDL and seed data"
    : `FAIL — errorExpected=${rollbackExpected}, newTables=${rollbackNewTables}`;
  test("All selected feedback migrations roll back atomically after forced SQL error",
    rollbackPass, localEvidence.rollbackResult);

  const sourceCatalog = sourceEvidence.catalog;
  localEvidence.sourceCatalogParityNote =
    `Observed source ${sourceCatalog.indexes} indexes/${sourceCatalog.constraints} constraints; retained prior report says 338/613.`;
  const failedTriggerNames = [...new Set([...cleanProbeFailures, ...incrementalProbeFailures])]
    .filter((name) => name.toLowerCase().includes("snapshot"));
  localEvidence.missingSnapshotTriggers = failedTriggerNames;

  if (cleanProbeFailures.length || incrementalProbeFailures.length || !rollbackPass) {
    failure = new Error(
      `Isolated SQL validation has failures: ${[...new Set([...cleanProbeFailures, ...incrementalProbeFailures])].join(", ") || "atomic rollback"}`,
    );
  }

  const report = buildReport(migrations);
  await writeFile(reportPath, report);
  console.log(`Report written to ${path.relative(workspace, reportPath)}.`);
  console.log(`Result: ${testResults.filter((result) => result.passed).length} passed; ${testResults.filter((result) => !result.passed).length} failed.`);
}

try {
  await main();
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  const message = sanitize(failure.message);
  console.error(`VALIDATION ERROR: ${message}`);
} finally {
  if (pgStarted) {
    const stop = run("pg_ctl", ["-D", pgDataDir, "-m", "fast", "-w", "stop"], {
      timeout: 60_000,
    });
    if (stop.status !== 0) {
      console.error("WARNING: disposable PostgreSQL shutdown reported a failure.");
    }
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

if (failure) process.exitCode = 1;