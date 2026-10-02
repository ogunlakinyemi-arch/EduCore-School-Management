#!/usr/bin/env node
/**
 * One-shot, Development-only live browser fixtures for EduCore expansion.
 * This script is deliberately separate from application startup and schema
 * migration code. It supports only plan, provision, and owned-fixture cleanup.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "lib/db/package.json"));
const { Client } = require("pg");
const MANIFEST_PATH = "/tmp/educore-expansion-browser-fixtures.json";
const BASELINE_PATH = "/tmp/educore-expansion-baseline.json";
const MIGRATION_PROOF_PATH = "/tmp/educore-expansion-migration-proof.json";
const EXPECTED_MIGRATIONS = [
  "0042_admissions_expansion",
  "0043_student_care_expansion",
  "0044_promotion_expansion",
  "0045_school_security_core",
  "0046_school_security_operations",
  "0047_parent_communication_extensions",
];
const BASELINE_SCHOOL_COUNT = 9;
const RETENTION_TABLES = [
  "student_care_record_history",
  "promotion_history",
  "audit_logs",
  "security_events",
  "school_security_operation_history",
];
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const md5 = (value) => createHash("md5").update(value).digest("hex");

function fail(message) {
  throw new Error(message);
}

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) fail("Unsafe database identifier; stopped.");
  return `"${value}"`;
}

function requireConfirm(mode) {
  const expected = mode === "provision"
    ? "provision-development-browser-fixtures"
    : "cleanup-development-browser-fixtures";
  if (process.env.EDUCORE_EXPANSION_CONFIRM !== expected) {
    fail(`Set EDUCORE_EXPANSION_CONFIRM=${expected} for this explicit action.`);
  }
}

function assertDevelopmentShell() {
  if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT) {
    fail("Fixtures require the explicit Development workspace domain and refuse deployment contexts.");
  }
  if (!process.env.DATABASE_URL) fail("Development database connection is unavailable.");
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    fail("Fixtures require a Clerk Development secret key; no identity changes were made.");
  }
}

async function readEvidence() {
  const [baselineText, proofText] = await Promise.all([
    readFile(BASELINE_PATH, "utf8"),
    readFile(MIGRATION_PROOF_PATH, "utf8"),
  ]);
  const baseline = JSON.parse(baselineText);
  const proof = JSON.parse(proofText);
  if (Object.keys(baseline.records ?? {}).length !== 132) {
    fail("Expected the complete 132-table Development preservation baseline.");
  }
  if (JSON.stringify(proof.migrations) !== JSON.stringify(EXPECTED_MIGRATIONS) ||
      proof.preservedTables !== 132 ||
      proof.portals?.portals !== BASELINE_SCHOOL_COUNT ||
      proof.portals?.open !== 0) {
    fail("Expansion migration proof does not match the expected Development state.");
  }
  for (const table of Object.keys(baseline.records)) {
    if (!SAFE_IDENTIFIER.test(table)) fail("Baseline contains an unsafe table identifier.");
  }
  return {
    baseline,
    proof,
    baselineText,
    proofText,
    baselineHash: hash(baselineText),
    proofHash: hash(proofText),
  };
}

async function migrationFileEvidence() {
  const files = [];
  for (const name of EXPECTED_MIGRATIONS) {
    const filePath = path.join(ROOT, "lib/db/drizzle", `${name}.sql`);
    const sql = await readFile(filePath);
    files.push({ name, filePath, digest: hash(sql) });
  }
  return files;
}

async function readIdentity(client) {
  const result = await client.query(`
    SELECT current_database() AS db,
      pg_postmaster_start_time()::text AS started,
      md5(string_agg(id::text, ',' ORDER BY id)) AS school_ids_hash,
      count(*)::int AS schools
    FROM public.schools
  `);
  return result.rows[0];
}

function identityMatches(actual, expected) {
  return actual.db === expected.db &&
    actual.started === expected.started &&
    actual.school_ids_hash === expected.school_ids_hash &&
    Number(actual.schools) === Number(expected.schools);
}

async function assertOriginalFingerprints(client, baseline) {
  let mismatches = 0;
  for (const [table, expected] of Object.entries(baseline.records)) {
    const originalJson = table === "communication_notifications"
      ? "to_jsonb(t)-'archived_at'"
      : table === "communication_campaigns"
        ? "to_jsonb(t)-ARRAY['is_emergency','expires_at']::text[]"
        : "to_jsonb(t)";
    const result = await client.query(`
      SELECT count(*)::int AS row_count,
        md5(coalesce(string_agg((${originalJson})::text, '|' ORDER BY (${originalJson})::text), '')) AS digest
      FROM public.${quoteIdentifier(table)} t
    `);
    const actual = result.rows[0];
    if (Number(actual.row_count) !== Number(expected.count) || actual.digest !== expected.digest) {
      mismatches += 1;
    }
  }
  if (mismatches) fail(`Original Development table fingerprints changed (${mismatches}); stopped safely.`);
}

async function assertMigrationEvidence(client, evidence, migrationFiles) {
  const initial = await readIdentity(client);
  if (!identityMatches(initial, evidence.baseline.identity) ||
      !identityMatches(initial, evidence.proof.identity)) {
    fail("Native Development database identity differs from the captured baseline/proof.");
  }
  await assertOriginalFingerprints(client, evidence.baseline);

  const firstLedger = (await client.query(`
    SELECT count(*)::int AS row_count,
      md5(coalesce(string_agg(to_jsonb(q)::text, '|' ORDER BY q.id), '')) AS digest
    FROM (SELECT * FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 11) q
  `)).rows[0];
  const ledgerCount = Number((await client.query(
    "SELECT count(*)::int AS row_count FROM drizzle.__drizzle_migrations",
  )).rows[0].row_count);
  if (Number(firstLedger.row_count) !== Number(evidence.proof.ledgerBefore.count) ||
      firstLedger.digest !== evidence.proof.ledgerBefore.digest ||
      ledgerCount !== evidence.proof.ledgerBefore.count + EXPECTED_MIGRATIONS.length) {
    fail("Development migration ledger no longer matches the preserved migration proof.");
  }
  const recent = (await client.query(
    "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT $1",
    [EXPECTED_MIGRATIONS.length],
  )).rows.map((row) => row.hash).reverse();
  if (JSON.stringify(recent) !== JSON.stringify(migrationFiles.map((entry) => entry.digest))) {
    fail("Expansion migration ledger hashes do not match their current SQL files.");
  }
  const expansionTables = [
    "admission_portal_settings", "admission_portal_classes",
    "admission_application_counters", "admission_applications",
    "student_medical_profiles", "student_medical_visits",
    "student_welfare_records", "student_behaviour_configurations",
    "student_behaviour_records", "student_care_grants",
    "student_care_record_history", "student_care_idempotency",
    "promotion_batches", "promotion_batch_students", "promotion_history",
  ];
  const missing = (await client.query(
    `SELECT count(*)::int AS count
       FROM unnest($1::text[]) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NULL`,
    [expansionTables],
  )).rows[0].count;
  if (Number(missing) !== 0) fail("Required expansion schema relations are missing.");
  const portalState = (await client.query(`
    SELECT count(*)::int AS portals,
      count(*) FILTER (WHERE is_open)::int AS open
    FROM public.admission_portal_settings
  `)).rows[0];
  if (Number(portalState.portals) !== evidence.proof.portals.portals ||
      Number(portalState.open) !== evidence.proof.portals.open) {
    fail("Original Development portal state differs from the migration proof.");
  }
}

async function orderedSchoolTables(client) {
  const names = (await client.query(`
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid=c.oid AND a.attname='school_id'
            AND a.attnum>0 AND NOT a.attisdropped
       )
     ORDER BY c.relname
  `)).rows.map((row) => row.name);
  const fks = (await client.query(`
    SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace cn ON cn.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace pn ON pn.oid=parent.relnamespace
     WHERE fk.contype='f' AND cn.nspname='public' AND pn.nspname='public'
  `)).rows;
  const nodes = new Set(names);
  const outgoing = new Map(names.map((name) => [name, new Set()]));
  const indegree = new Map(names.map((name) => [name, 0]));
  for (const fk of fks) {
    if (nodes.has(fk.child) && nodes.has(fk.parent) && fk.child !== fk.parent &&
        !outgoing.get(fk.child).has(fk.parent)) {
      outgoing.get(fk.child).add(fk.parent);
      indegree.set(fk.parent, indegree.get(fk.parent) + 1);
    }
  }
  const ready = names.filter((name) => indegree.get(name) === 0);
  const order = [];
  while (ready.length) {
    const name = ready.pop();
    order.push(name);
    for (const parent of outgoing.get(name)) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) ready.push(parent);
    }
  }
  if (order.length !== names.length) fail("School-scoped cleanup dependency graph has a cycle; no writes performed.");
  return { names, order, fks };
}

async function cleanupPlan(client) {
  const scoped = await orderedSchoolTables(client);
  const unscopedRoots = [
    "app_users", "schools", "school_classes", "academic_sessions", "academic_terms",
    "students", "parents", "employees", "partner_profiles",
  ];
  const unscopedTables = (await client.query(`
    SELECT DISTINCT child.relname AS name
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
     WHERE fk.contype='f' AND child_ns.nspname='public'
       AND parent_ns.nspname='public'
       AND parent.relname=ANY($1::text[])
       AND child.relname<>ALL($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid=child.oid AND a.attname='school_id'
            AND a.attnum>0 AND NOT a.attisdropped
       )
     ORDER BY child.relname
  `, [unscopedRoots])).rows.map((row) => row.name);
  const unscopedSet = new Set(unscopedTables);
  const unscopedOutgoing = new Map(unscopedTables.map((name) => [name, new Set()]));
  const unscopedIndegree = new Map(unscopedTables.map((name) => [name, 0]));
  for (const fk of scoped.fks) {
    if (unscopedSet.has(fk.child) && unscopedSet.has(fk.parent) &&
        fk.child !== fk.parent && !unscopedOutgoing.get(fk.child).has(fk.parent)) {
      unscopedOutgoing.get(fk.child).add(fk.parent);
      unscopedIndegree.set(fk.parent, unscopedIndegree.get(fk.parent) + 1);
    }
  }
  const unscopedReady = unscopedTables.filter((name) => unscopedIndegree.get(name) === 0);
  const unscopedOrder = [];
  while (unscopedReady.length) {
    const name = unscopedReady.pop();
    unscopedOrder.push(name);
    for (const parent of unscopedOutgoing.get(name)) {
      unscopedIndegree.set(parent, unscopedIndegree.get(parent) - 1);
      if (unscopedIndegree.get(parent) === 0) unscopedReady.push(parent);
    }
  }
  if (unscopedOrder.length !== unscopedTables.length) {
    fail("Unscoped fixture-owned cleanup dependency graph has a cycle; no writes performed.");
  }
  const retentionTriggers = (await client.query(`
    SELECT c.relname AS table_name, tr.tgname AS trigger_name,
      tr.tgenabled AS enabled, pg_get_triggerdef(tr.oid, true) AS definition
      FROM pg_trigger tr
      JOIN pg_class c ON c.oid=tr.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND NOT tr.tgisinternal
       AND c.relname = ANY($1::text[])
     ORDER BY c.relname, tr.tgname
  `, [RETENTION_TABLES])).rows;
  for (const trigger of retentionTriggers) {
    if (trigger.table_name !== "promotion_history" ||
        trigger.trigger_name !== "promotion_history_immutable" ||
        trigger.enabled !== "O" ||
        !/BEFORE DELETE OR UPDATE ON promotion_history/i.test(trigger.definition) ||
        !/prevent_promotion_history_mutation/i.test(trigger.definition)) {
      fail("An unrecognized or altered retention trigger is present; cleanup was not planned.");
    }
  }
  if (!retentionTriggers.some((trigger) =>
    trigger.table_name === "promotion_history" &&
    trigger.trigger_name === "promotion_history_immutable" &&
    trigger.enabled === "O")) {
    fail("Expected the enabled promotion-history immutability guard before provisioning.");
  }
  const requiredRetentionTables = await client.query(
    `SELECT count(*)::int AS count
       FROM unnest($1::text[]) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NULL`,
    [RETENTION_TABLES],
  );
  if (Number(requiredRetentionTables.rows[0].count) !== 0) {
    fail("A planned retained-history table is missing.");
  }
  const summary = {
    scopedTableCount: scoped.names.length,
    scopedOrder: scoped.order,
    unscopedOwnedChildOrder: unscopedOrder,
    foreignKeyPlan: scoped.fks.map((fk) => `${fk.child}->${fk.parent}`).sort(),
    retentionTables: RETENTION_TABLES,
    temporaryTriggerChanges: retentionTriggers.map((trigger) => ({
      table: trigger.table_name,
      trigger: trigger.trigger_name,
      originalEnabledState: trigger.enabled,
      definition: trigger.definition,
    })),
  };
  return {
    ...scoped,
    unscopedOrder,
    retentionTriggers,
    summary,
    digest: hash(JSON.stringify(summary)),
  };
}

async function atomicWriteManifest(manifest) {
  const temp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temp, MANIFEST_PATH);
}

async function newManifest(evidence) {
  const nonce = randomBytes(8).toString("hex");
  const label = `EDUCORE-EXPANSION-TEST-${nonce.toUpperCase()}`;
  const slug = `educore-expansion-${nonce}`;
  const identities = [
    { role: "parent1", firstName: "Expansion", lastName: "Parent One" },
    { role: "student1", firstName: "Expansion", lastName: "Student One" },
    { role: "parent2", firstName: "Expansion", lastName: "Parent Two" },
    { role: "teacher", firstName: "Expansion", lastName: "Teacher" },
    { role: "schoolAdmin", firstName: "Expansion", lastName: "School Admin" },
    { role: "accountant", firstName: "Expansion", lastName: "Accountant" },
    { role: "partner", firstName: "Expansion", lastName: "Partner" },
  ].map((entry) => ({
    ...entry,
    // Clerk rejects the .invalid TLD even for verified Development users.
    // example.com is IANA-reserved; backend-created emails are verified
    // without sending an invitation or verification email.
    email: `${entry.role.toLowerCase()}-${nonce}@example.com`,
    clerkUserId: null,
    appUserId: null,
  }));
  return {
    label,
    nonce,
    createdAt: new Date().toISOString(),
    state: "PREPARING",
    developmentIdentity: evidence.baseline.identity,
    baselineSha256: evidence.baselineHash,
    migrationProofSha256: evidence.proofHash,
    clerkManagementStatus: "managed",
    fixtureIdentities: identities,
    ids: {
      schoolId: null,
      classAId: null,
      classBId: null,
      sourceSessionId: null,
      targetSessionId: null,
      sourceTermId: null,
      targetTermId: null,
      student1Id: null,
      student2Id: null,
      parent1Id: null,
      parent2Id: null,
      employeeId: null,
      partnerProfileId: null,
      parent1StudentLinkId: null,
      parent2StudentLinkId: null,
    },
    cleanupPlanDigest: null,
    cleanupPlanCounts: null,
  };
}

async function verifyNoExistingIdentity(client, manifest) {
  const emails = manifest.fixtureIdentities.map((identity) => identity.email);
  const duplicate = await client.query(
    `SELECT count(*)::int AS count FROM public.app_users WHERE lower(email)=ANY($1::text[])`,
    [emails],
  );
  if (Number(duplicate.rows[0].count) !== 0) {
    fail("A fixture email already belongs to an application user; no identity was reused.");
  }
  const labels = await client.query(
    "SELECT count(*)::int AS count FROM public.schools WHERE code=$1 OR name=$1",
    [manifest.label],
  );
  if (Number(labels.rows[0].count) !== 0) fail("The unique fixture label is already in use.");
}

async function loadClerkClient() {
  const apiRequire = createRequire(path.join(ROOT, "artifacts/api-server/package.json"));
  const clerkModuleUrl = pathToFileURL(apiRequire.resolve("@clerk/express")).href;
  const clerkModule = await import(clerkModuleUrl);
  if (!clerkModule.clerkClient?.users?.createUser || !clerkModule.clerkClient?.users?.deleteUser) {
    fail("Existing Clerk SDK client does not expose the required user-management methods.");
  }
  return clerkModule.clerkClient;
}

async function createClerkUsers(manifest, clerkClient, createdClerkIds) {
  for (const identity of manifest.fixtureIdentities) {
    const created = await clerkClient.users.createUser({
      emailAddress: [identity.email],
      emailAddressIdentificationStatus: ["verified"],
      firstName: identity.firstName,
      lastName: identity.lastName,
      skipPasswordRequirement: true,
      privateMetadata: { edupulseFixture: manifest.label, edupulseFixtureRole: identity.role },
    });
    if (!created.id) fail("Clerk did not return an owned Development identity ID.");
    identity.clerkUserId = created.id;
    createdClerkIds.push(created.id);
    await atomicWriteManifest(manifest);
    const email = created.emailAddresses?.find((entry) =>
      entry.emailAddress.toLowerCase() === identity.email.toLowerCase());
    if (email?.verification?.status !== "verified") {
      fail("Clerk did not return the expected verified Development test identity.");
    }
  }
}

async function insertAppUser(client, identity) {
  const result = await client.query(`
    INSERT INTO public.app_users
      (clerk_user_id,email,first_name,last_name,phone,status)
    VALUES ($1,$2,$3,$4,$5,'ACTIVE')
    RETURNING id
  `, [
    identity.clerkUserId,
    identity.email,
    identity.firstName,
    identity.lastName,
    "+15550123456",
  ]);
  identity.appUserId = Number(result.rows[0].id);
  return identity.appUserId;
}

function userByRole(manifest, role) {
  const found = manifest.fixtureIdentities.find((identity) => identity.role === role);
  if (!found?.clerkUserId) fail("An owned Development Clerk identity is missing.");
  return found;
}

async function createSchoolRows(client, manifest) {
  const school = (await client.query(`
    INSERT INTO public.schools
      (code,name,city,state,status,email,address,school_type)
    VALUES ($1,$1,'EDUCORE TEST','EDUCORE TEST','active',$2,'EDUCORE EXPANSION TEST','PRIVATE')
    RETURNING id
  `, [manifest.label, `${manifest.nonce}@example.com`])).rows[0];
  const schoolId = Number(school.id);
  manifest.ids.schoolId = schoolId;

  const classA = (await client.query(`
    INSERT INTO public.school_classes (school_id,name,section,capacity)
    VALUES ($1,'Class A','A',30) RETURNING id
  `, [schoolId])).rows[0];
  const classB = (await client.query(`
    INSERT INTO public.school_classes (school_id,name,section,capacity)
    VALUES ($1,'Class B','B',30) RETURNING id
  `, [schoolId])).rows[0];
  manifest.ids.classAId = Number(classA.id);
  manifest.ids.classBId = Number(classB.id);

  const sourceSession = (await client.query(`
    INSERT INTO public.academic_sessions
      (school_id,name,start_date,end_date,status,is_current)
    VALUES ($1,$2,'2026-01-01','2026-12-31','ACTIVE',true) RETURNING id
  `, [schoolId, `${manifest.label} SOURCE SESSION`])).rows[0];
  const targetSession = (await client.query(`
    INSERT INTO public.academic_sessions
      (school_id,name,start_date,end_date,status,is_current)
    VALUES ($1,$2,'2027-01-01','2027-12-31','PLANNED',false) RETURNING id
  `, [schoolId, `${manifest.label} TARGET SESSION`])).rows[0];
  manifest.ids.sourceSessionId = Number(sourceSession.id);
  manifest.ids.targetSessionId = Number(targetSession.id);

  const sourceTerm = (await client.query(`
    INSERT INTO public.academic_terms
      (school_id,academic_session_id,name,start_date,end_date,status,is_current)
    VALUES ($1,$2,'Term 1','2026-09-01','2026-12-31','ACTIVE',true) RETURNING id
  `, [schoolId, manifest.ids.sourceSessionId])).rows[0];
  const targetTerm = (await client.query(`
    INSERT INTO public.academic_terms
      (school_id,academic_session_id,name,start_date,end_date,status,is_current)
    VALUES ($1,$2,'Term 1','2027-01-01','2027-04-30','PLANNED',false) RETURNING id
  `, [schoolId, manifest.ids.targetSessionId])).rows[0];
  manifest.ids.sourceTermId = Number(sourceTerm.id);
  manifest.ids.targetTermId = Number(targetTerm.id);

  const users = {};
  for (const role of [
    "parent1", "student1", "parent2", "teacher", "schoolAdmin", "accountant", "partner",
  ]) {
    users[role] = await insertAppUser(client, userByRole(manifest, role));
  }
  const membershipRoles = [
    ["parent1", "PARENT"],
    ["student1", "STUDENT"],
    ["parent2", "PARENT"],
    ["teacher", "TEACHER"],
    ["schoolAdmin", "SCHOOL_ADMIN"],
    ["accountant", "ACCOUNTANT"],
  ];
  for (const [role, membershipRole] of membershipRoles) {
    await client.query(`
      INSERT INTO public.school_memberships (user_id,school_id,role,status)
      VALUES ($1,$2,$3,'ACTIVE')
    `, [users[role], schoolId, membershipRole]);
  }

  const parent1 = (await client.query(`
    INSERT INTO public.parents (school_id,user_id,name,email,phone,status)
    VALUES ($1,$2,'Expansion Parent One',$3,'+15550123456','ACTIVE') RETURNING id
  `, [schoolId, users.parent1, userByRole(manifest, "parent1").email])).rows[0];
  const parent2 = (await client.query(`
    INSERT INTO public.parents (school_id,user_id,name,email,phone,status)
    VALUES ($1,$2,'Expansion Parent Two',$3,'+15550123457','ACTIVE') RETURNING id
  `, [schoolId, users.parent2, userByRole(manifest, "parent2").email])).rows[0];
  manifest.ids.parent1Id = Number(parent1.id);
  manifest.ids.parent2Id = Number(parent2.id);

  const student1 = (await client.query(`
    INSERT INTO public.students
      (school_id,user_id,admission_no,email,first_name,last_name,gender,class_name,section,
       parent_name,parent_phone,status,admission_status,address)
    VALUES ($1,$2,$3,$4,'Expansion','Student One','Female','Class A','A',
       'Expansion Parent One','+15550123456','active','ADMITTED','EDUCORE TEST')
    RETURNING id
  `, [
    schoolId, users.student1, `${manifest.label}-STUDENT-1`,
    userByRole(manifest, "student1").email,
  ])).rows[0];
  const student2 = (await client.query(`
    INSERT INTO public.students
      (school_id,admission_no,first_name,last_name,gender,class_name,section,
       parent_name,parent_phone,status,admission_status,address)
    VALUES ($1,$2,'Expansion','Student Two','Male','Class A','A',
       'Expansion Parent Two','+15550123457','active','ADMITTED','EDUCORE TEST')
    RETURNING id
  `, [schoolId, `${manifest.label}-STUDENT-2`])).rows[0];
  manifest.ids.student1Id = Number(student1.id);
  manifest.ids.student2Id = Number(student2.id);

  const link1 = (await client.query(`
    INSERT INTO public.parent_student_relationships
      (parent_id,student_id,relationship_type,is_primary_guardian,status)
    VALUES ($1,$2,'Guardian',true,'ACTIVE') RETURNING id
  `, [manifest.ids.parent1Id, manifest.ids.student1Id])).rows[0];
  const link2 = (await client.query(`
    INSERT INTO public.parent_student_relationships
      (parent_id,student_id,relationship_type,is_primary_guardian,status)
    VALUES ($1,$2,'Guardian',true,'ACTIVE') RETURNING id
  `, [manifest.ids.parent2Id, manifest.ids.student2Id])).rows[0];
  manifest.ids.parent1StudentLinkId = Number(link1.id);
  manifest.ids.parent2StudentLinkId = Number(link2.id);

  for (const studentId of [manifest.ids.student1Id, manifest.ids.student2Id]) {
    await client.query(`
      INSERT INTO public.student_class_assignments
        (school_id,student_id,academic_session_id,academic_term_id,school_class_id,
         section,status,is_current,start_date)
      VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',true,'2026-01-01')
    `, [
      schoolId, studentId, manifest.ids.sourceSessionId, manifest.ids.sourceTermId,
      manifest.ids.classAId, "A",
    ]);
  }

  const teacher = (await client.query(`
    INSERT INTO public.employees
      (school_id,user_id,employee_no,first_name,last_name,phone,email,employee_type,
       employment_status,date_employed,department)
    VALUES ($1,$2,$3,'Expansion','Teacher','+15550123458',$4,'TEACHER',
       'ACTIVE','2026-01-01','EDUCORE TEST')
    RETURNING id
  `, [
    schoolId, users.teacher, `${manifest.label}-TEACHER`,
    userByRole(manifest, "teacher").email,
  ])).rows[0];
  manifest.ids.employeeId = Number(teacher.id);
  await client.query(`
    INSERT INTO public.teacher_class_assignments
      (school_id,employee_id,academic_session_id,school_class_id,section,
       assignment_type,status,start_date)
    VALUES ($1,$2,$3,$4,'A','CLASS_TEACHER','ACTIVE','2026-01-01')
  `, [schoolId, manifest.ids.employeeId, manifest.ids.sourceSessionId, manifest.ids.classAId]);

  const partner = (await client.query(`
    INSERT INTO public.partner_profiles
      (user_id,partner_code,type,full_name,business_name,email,phone,state,lga,
       status,registered_at,activated_at)
    VALUES ($1,$2,'RESELLER','Expansion Partner',$2,$3,'+15550123459',
       'EDUCORE TEST','EDUCORE TEST','ACTIVE',now(),now())
    RETURNING id
  `, [users.partner, `${manifest.label}-PARTNER`, userByRole(manifest, "partner").email])).rows[0];
  manifest.ids.partnerProfileId = Number(partner.id);
  await client.query(`
    INSERT INTO public.partner_profile_users (partner_profile_id,user_id,role,status)
    VALUES ($1,$2,'PARTNER','ACTIVE')
  `, [manifest.ids.partnerProfileId, users.partner]);
  await client.query(`
    INSERT INTO public.school_partner_attributions
      (school_id,partner_profile_id,source,status,is_current,created_by)
    VALUES ($1,$2,'REFERRAL_LINK','ACTIVE',true,$3)
  `, [schoolId, manifest.ids.partnerProfileId, users.schoolAdmin]);

  const portalUpdate = await client.query(`
    UPDATE public.admission_portal_settings
       SET portal_key=$2, is_open=true, academic_session_id=$3, academic_term_id=$4,
           requirements=$5::jsonb, required_documents=$6::jsonb,
           instructions='EDUCORE expansion browser fixture; no external messages or payments.',
           public_description='EDUCORE-EXPANSION-TEST public application fixture.',
           public_address='EDUCORE TEST',
           public_email=$7,
           fee_info='No payment is collected through this test portal.',
           updated_by_user_id=$8, updated_at=now()
     WHERE school_id=$1
  `, [
    schoolId,
    `${manifest.nonce}-admissions`,
    manifest.ids.sourceSessionId,
    manifest.ids.sourceTermId,
    JSON.stringify(["EDUCORE expansion test application"]),
    JSON.stringify(["No documents required for this browser fixture"]),
    userByRole(manifest, "parent1").email,
    users.schoolAdmin,
  ]);
  if (portalUpdate.rowCount !== 1) fail("The owned school's default admission portal was not initialized.");
  const counter = await client.query(`
    SELECT count(*)::int AS count FROM public.admission_application_counters
     WHERE school_id=$1 AND current_value=0
  `, [schoolId]);
  if (Number(counter.rows[0].count) !== 1) {
    fail("The owned school's default admission application counter was not initialized.");
  }
  await client.query(`
    INSERT INTO public.admission_portal_classes (school_id,class_id)
    VALUES ($1,$2)
  `, [schoolId, manifest.ids.classAId]);

  const ownerMemberships = await client.query(`
    SELECT count(*)::int AS count FROM public.school_memberships
     WHERE user_id = ANY($1::int[]) AND role='PLATFORM_OWNER'
  `, [Object.values(users)]);
  if (Number(ownerMemberships.rows[0].count) !== 0) {
    fail("A school fixture account unexpectedly has a Platform Owner role.");
  }
  await atomicWriteManifest(manifest);
}

async function provision(evidence, migrationFiles, plan) {
  requireConfirm("provision");
  assertDevelopmentShell();
  try {
    await readFile(MANIFEST_PATH, "utf8");
    fail("A fixture manifest already exists; nonce reuse is prohibited.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const manifest = await newManifest(evidence);
  manifest.cleanupPlanDigest = plan.digest;
  manifest.cleanupPlanCounts = {
    scopedTables: plan.names.length,
    retentionLocks: RETENTION_TABLES.length,
    temporaryTriggerChanges: plan.retentionTriggers.length,
  };
  await atomicWriteManifest(manifest);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const clerkClient = await loadClerkClient();
  const createdClerkIds = [];
  let transaction = false;
  let databaseCommitAttempted = false;
  try {
    await createClerkUsers(manifest, clerkClient, createdClerkIds);
    await client.connect();
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('educore:expansion-browser-fixtures'))");
    await assertMigrationEvidence(client, evidence, migrationFiles);
    await verifyNoExistingIdentity(client, manifest);
    const livePlan = await cleanupPlan(client);
    if (livePlan.digest !== manifest.cleanupPlanDigest) {
      fail("Cleanup plan changed after preflight; no browser-fixture rows were committed.");
    }
    await createSchoolRows(client, manifest);
    databaseCommitAttempted = true;
    await client.query("COMMIT");
    transaction = false;
    manifest.state = "READY_FOR_LIVE_DEVELOPMENT_BROWSER";
    manifest.provisionedAt = new Date().toISOString();
    await atomicWriteManifest(manifest);
    console.log(JSON.stringify({
      status: manifest.state,
      manifestPath: MANIFEST_PATH,
      ownedUsers: manifest.fixtureIdentities.length,
      ownedSchool: 1,
      classes: 2,
      sourceAndTargetSessions: 2,
      terms: 2,
      students: 2,
      parents: 2,
      teacherAssignments: 1,
      partnerProfiles: 1,
      admissionPortalOpen: true,
      emailOrSmsInvitationsSent: 0,
      paymentsOrDevicesCreated: 0,
    }));
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    // Do not delete provider identities when a COMMIT response may be ambiguous.
    if (!databaseCommitAttempted) {
      for (const id of createdClerkIds) {
        await clerkClient.users.deleteUser(id).catch(() => undefined);
      }
    }
    manifest.state = databaseCommitAttempted ? "PROVISION_COMMIT_UNCERTAIN" : "PROVISION_FAILED";
    manifest.safeFailure = {
      phase: transaction ? "database" : "identity",
      status: typeof error?.status === "number" ? error.status : null,
      providerCodes: Array.isArray(error?.errors) ? error.errors.map((entry) => entry.code) : [],
      databaseCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null,
    };
    await atomicWriteManifest(manifest).catch(() => undefined);
    fail("Fixture provisioning stopped safely. No raw provider, email, ID, or database details were printed.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function getUnscopedOwnedChildren(client, manifest) {
  const roots = {
    app_users: manifest.fixtureIdentities.map((identity) => identity.appUserId).filter(Number.isInteger),
    schools: [manifest.ids.schoolId].filter(Number.isInteger),
    school_classes: [manifest.ids.classAId, manifest.ids.classBId].filter(Number.isInteger),
    academic_sessions: [manifest.ids.sourceSessionId, manifest.ids.targetSessionId].filter(Number.isInteger),
    academic_terms: [manifest.ids.sourceTermId, manifest.ids.targetTermId].filter(Number.isInteger),
    students: [manifest.ids.student1Id, manifest.ids.student2Id].filter(Number.isInteger),
    parents: [manifest.ids.parent1Id, manifest.ids.parent2Id].filter(Number.isInteger),
    employees: [manifest.ids.employeeId].filter(Number.isInteger),
    partner_profiles: [manifest.ids.partnerProfileId].filter(Number.isInteger),
  };
  const rootNames = Object.keys(roots).filter((name) => roots[name].length > 0);
  const constraints = (await client.query(`
    SELECT child.relname AS child_table, parent.relname AS parent_table,
      child_att.attname AS child_column, parent_att.attname AS parent_column,
      child_pk.has_school_id
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY child_key(attnum,ordinality) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY parent_key(attnum,ordinality)
      ON parent_key.ordinality=child_key.ordinality
    JOIN pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=child_key.attnum
    JOIN pg_attribute parent_att ON parent_att.attrelid=parent.oid AND parent_att.attnum=parent_key.attnum
    JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=child.oid AND a.attname='school_id'
          AND a.attnum>0 AND NOT a.attisdropped
      ) AS has_school_id
    ) child_pk ON true
    WHERE fk.contype='f' AND child_ns.nspname='public' AND parent_ns.nspname='public'
      AND parent.relname = ANY($1::text[])
    ORDER BY child.relname, parent.relname, child_key.ordinality
  `, [rootNames])).rows;
  const groups = new Map();
  for (const fk of constraints) {
    if (fk.has_school_id || rootNames.includes(fk.child_table)) continue;
    const key = `${fk.child_table}:${fk.parent_table}`;
    if (!groups.has(key)) groups.set(key, { child: fk.child_table, parent: fk.parent_table, pairs: [] });
    groups.get(key).pairs.push([fk.child_column, fk.parent_column]);
  }
  const tables = new Set([...groups.values()].map((entry) => entry.child));
  const graph = new Map([...tables].map((name) => [name, new Set()]));
  const indegree = new Map([...tables].map((name) => [name, 0]));
  const allEdges = (await client.query(`
    SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace cn ON cn.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace pn ON pn.oid=parent.relnamespace
     WHERE fk.contype='f' AND cn.nspname='public' AND pn.nspname='public'
  `)).rows;
  for (const edge of allEdges) {
    if (tables.has(edge.child) && tables.has(edge.parent) && edge.child !== edge.parent &&
        !graph.get(edge.child).has(edge.parent)) {
      graph.get(edge.child).add(edge.parent);
      indegree.set(edge.parent, indegree.get(edge.parent) + 1);
    }
  }
  const ready = [...tables].filter((name) => indegree.get(name) === 0);
  const order = [];
  while (ready.length) {
    const name = ready.pop();
    order.push(name);
    for (const parent of graph.get(name)) {
      indegree.set(parent, indegree.get(parent) - 1);
      if (indegree.get(parent) === 0) ready.push(parent);
    }
  }
  if (order.length !== tables.size) fail("Owned unscoped cleanup dependencies are cyclic; cleanup refused.");
  return { roots, groups, order };
}

async function cleanupUnscopedOwnedChildren(client, manifest) {
  const children = await getUnscopedOwnedChildren(client, manifest);
  for (const table of children.order) {
    for (const [key, group] of children.groups) {
      if (group.child !== table) continue;
      const ids = children.roots[group.parent] ?? [];
      if (!ids.length) continue;
      const joins = group.pairs.map(([child, parent]) =>
        `c.${quoteIdentifier(child)}=p.${quoteIdentifier(parent)}`,
      ).join(" AND ");
      await client.query(`
        DELETE FROM public.${quoteIdentifier(group.child)} c
        USING public.${quoteIdentifier(group.parent)} p
        WHERE ${joins} AND p.id=ANY($1::int[])
      `, [ids]);
    }
  }
  return Object.fromEntries(Object.entries(children.roots).map(([table, ids]) => [table, ids.length]));
}

async function assertOwnedSchool(client, manifest, baseline) {
  const school = await client.query(`
    SELECT id,code,name FROM public.schools
     WHERE id=$1 AND code=$2 AND name=$2
     FOR UPDATE
  `, [manifest.ids.schoolId, manifest.label]);
  if (school.rows.length !== 1) fail("The manifest does not identify exactly its original labeled test school.");
  const remainingSchools = await client.query(`
    SELECT count(*)::int AS count,md5(string_agg(id::text,',' ORDER BY id)) AS school_ids_hash
      FROM public.schools WHERE id<>$1
  `, [manifest.ids.schoolId]);
  const original = remainingSchools.rows[0];
  if (Number(original.count) !== BASELINE_SCHOOL_COUNT ||
      original.school_ids_hash !== baseline.identity.school_ids_hash) {
    fail("Original school identities/count changed; exact-owned cleanup refused.");
  }
}

async function cleanupOwnedFixture(evidence, migrationFiles, plan) {
  requireConfirm("cleanup");
  assertDevelopmentShell();
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (manifest.state !== "READY_FOR_LIVE_DEVELOPMENT_BROWSER" &&
      manifest.state !== "DATABASE_CLEANED_CLERK_PENDING") {
    fail("Fixture manifest is not in a cleanable state; no identities were deleted.");
  }
  if (manifest.baselineSha256 !== evidence.baselineHash ||
      manifest.migrationProofSha256 !== evidence.proofHash ||
      manifest.cleanupPlanDigest !== plan.digest) {
    fail("Cleanup evidence/plan changed from the captured Development fixture; refused.");
  }
  if (!Number.isInteger(manifest.ids.schoolId) ||
      manifest.fixtureIdentities.length !== 7 ||
      manifest.fixtureIdentities.some((identity) =>
        !identity.clerkUserId || !identity.appUserId || typeof identity.email !== "string")) {
    fail("Exact ownership IDs are incomplete; cleanup refused.");
  }
  if (manifest.state !== "DATABASE_CLEANED_CLERK_PENDING") {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    let transaction = false;
    try {
      await client.connect();
      await client.query("BEGIN");
      transaction = true;
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='90s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('educore:expansion-browser-fixtures'))");
      const identity = await readIdentity(client);
      if (identity.db !== evidence.baseline.identity.db ||
          identity.started !== evidence.baseline.identity.started) {
        fail("Native Development server/database identity changed; cleanup refused.");
      }
      await assertOwnedSchool(client, manifest, evidence.baseline);
      const currentPlan = await cleanupPlan(client);
      if (currentPlan.digest !== manifest.cleanupPlanDigest) {
        fail("Live cleanup guard plan changed; cleanup refused.");
      }

    await client.query(`
      LOCK TABLE public.student_care_record_history,
        public.promotion_history, public.audit_logs
      IN ACCESS EXCLUSIVE MODE NOWAIT
    `);
    const trigger = currentPlan.retentionTriggers.find((entry) =>
      entry.table_name === "promotion_history" &&
      entry.trigger_name === "promotion_history_immutable",
    );
    if (trigger?.enabled !== "O") fail("Promotion history guard state changed; cleanup refused.");
    await client.query(`
      ALTER TABLE public.promotion_history
      DISABLE TRIGGER promotion_history_immutable
    `);
    await cleanupUnscopedOwnedChildren(client, manifest);
    for (const table of currentPlan.order) {
      await client.query(`DELETE FROM public.${quoteIdentifier(table)} WHERE school_id=$1`, [
        manifest.ids.schoolId,
      ]);
      if (table === "promotion_history") {
        await client.query(`
          ALTER TABLE public.promotion_history
          ENABLE TRIGGER promotion_history_immutable
        `);
      }
    }
    const stillScoped = [];
    for (const table of currentPlan.names) {
      const remaining = await client.query(
        `SELECT count(*)::int AS count FROM public.${quoteIdentifier(table)} WHERE school_id=$1`,
        [manifest.ids.schoolId],
      );
      if (Number(remaining.rows[0].count) !== 0) stillScoped.push(table);
    }
    if (stillScoped.length) fail("Owned school-scope rows remain after planned cleanup.");

    const expectedUsers = manifest.fixtureIdentities.map((identity) => ({
      id: identity.appUserId,
      clerkUserId: identity.clerkUserId,
      email: identity.email,
    }));
    const profileDeleted = await client.query(`
      DELETE FROM public.partner_profiles
       WHERE id=$1 AND user_id=$2 AND partner_code=$3
      RETURNING id
    `, [
      manifest.ids.partnerProfileId,
      userByRole(manifest, "partner").appUserId,
      `${manifest.label}-PARTNER`,
    ]);
    if (profileDeleted.rows.length !== 1) fail("The exact owned global partner profile was not identified.");
    for (const user of expectedUsers) {
      const deleted = await client.query(`
        DELETE FROM public.app_users
         WHERE id=$1 AND clerk_user_id=$2 AND lower(email)=lower($3)
        RETURNING id
      `, [user.id, user.clerkUserId, user.email]);
      if (deleted.rows.length !== 1) fail("An exact owned app-user row could not be verified for removal.");
    }

    const schoolDeleted = await client.query(`
      DELETE FROM public.schools WHERE id=$1 AND code=$2 AND name=$2 RETURNING id
    `, [manifest.ids.schoolId, manifest.label]);
    if (schoolDeleted.rows.length !== 1) fail("The exact owned school was not removed.");
    const restoredTrigger = (await client.query(`
      SELECT tgenabled FROM pg_trigger
       WHERE tgrelid='public.promotion_history'::regclass
         AND tgname='promotion_history_immutable' AND NOT tgisinternal
    `)).rows[0];
    if (restoredTrigger?.tgenabled !== "O") fail("Promotion-history guard was not restored.");

    await assertMigrationEvidence(client, evidence, migrationFiles);
    const after = await readIdentity(client);
    if (!identityMatches(after, evidence.baseline.identity)) {
      fail("Original Development school count/hash did not return to baseline.");
    }
      await client.query("COMMIT");
      transaction = false;
      manifest.state = "DATABASE_CLEANED_CLERK_PENDING";
      manifest.databaseCleanedAt = new Date().toISOString();
      await atomicWriteManifest(manifest);
    } catch {
      if (transaction) await client.query("ROLLBACK").catch(() => undefined);
      fail("Database cleanup rolled back safely. No raw IDs or connection/provider details were printed.");
    } finally {
      await client.end().catch(() => undefined);
    }
  } else {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      await assertMigrationEvidence(client, evidence, migrationFiles);
      const school = await client.query(
        "SELECT count(*)::int AS count FROM public.schools WHERE id=$1",
        [manifest.ids.schoolId],
      );
      if (Number(school.rows[0].count) !== 0) {
        fail("Database cleanup is incomplete; no Clerk identities were removed.");
      }
      await client.query("ROLLBACK");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      fail("Database cleanup evidence is incomplete; no Clerk identities were removed.");
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const clerkClient = await loadClerkClient();
  for (const identity of manifest.fixtureIdentities) {
    if (identity.clerkDeleted === true) continue;
    try {
      await clerkClient.users.getUser(identity.clerkUserId);
    } catch (error) {
      if (error?.status === 404 || error?.statusCode === 404) {
        identity.clerkDeleted = true;
        await atomicWriteManifest(manifest);
        continue;
      }
      fail("Clerk identity status could not be reconciled; retry cleanup without touching other users.");
    }
    try {
      await clerkClient.users.deleteUser(identity.clerkUserId);
      identity.clerkDeleted = true;
      await atomicWriteManifest(manifest);
    } catch {
      fail("Clerk cleanup is incomplete; retry the exact cleanup command.");
    }
  }
  manifest.state = "CLEANED";
  manifest.cleanedAt = new Date().toISOString();
  await atomicWriteManifest(manifest);
  console.log(JSON.stringify({
    status: manifest.state,
    manifestPath: MANIFEST_PATH,
    deletedOwnedClerkUsers: manifest.fixtureIdentities.length,
    deletedOwnedSchool: 1,
    originalSchoolCountAndHashRestored: true,
    originalTableFingerprintsRestored: true,
    retentionGuardsRestored: true,
  }));
}

async function main() {
  const mode = process.argv[2];
  if (!["plan", "provision", "cleanup"].includes(mode)) {
    fail("Choose exactly one mode: plan, provision, or cleanup.");
  }
  if (mode !== "plan") requireConfirm(mode);
  assertDevelopmentShell();
  const evidence = await readEvidence();
  const migrationFiles = await migrationFileEvidence();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const identity = await readIdentity(client);
    if (mode === "cleanup") {
      // Cleanup reads the current fixture school plus all other existing schools.
      if (identity.db !== evidence.baseline.identity.db ||
          identity.started !== evidence.baseline.identity.started) {
        fail("Native Development identity changed; cleanup refused.");
      }
    } else {
      await assertMigrationEvidence(client, evidence, migrationFiles);
    }
    const plan = await cleanupPlan(client);
    if (mode === "provision") {
      await verifyNoExistingIdentity(client, await newManifest(evidence));
    }
    if (mode === "plan") {
      console.log(JSON.stringify({
        status: "PREFLIGHT_ONLY",
        developmentDatabaseIdentityVerified: identity.db === evidence.baseline.identity.db &&
          identity.started === evidence.baseline.identity.started,
        preservedOriginalTablesVerified: Object.keys(evidence.baseline.records).length,
        migrationNamesVerified: EXPECTED_MIGRATIONS.length,
        schoolScopedTablesInCleanupPlan: plan.names.length,
        retentionTablesLockedExclusively: RETENTION_TABLES.length,
        retentionTriggersTemporarilyChanged: plan.retentionTriggers.length,
        manifestPath: MANIFEST_PATH,
        recordsCreated: 0,
      }));
    }
    await client.query("ROLLBACK");
    if (mode === "provision") await provision(evidence, migrationFiles, plan);
    if (mode === "cleanup") await cleanupOwnedFixture(evidence, migrationFiles, plan);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Fixture command failed safely.";
  console.error(message.replaceAll(process.env.DATABASE_URL ?? "\u0000", "[REDACTED]"));
  process.exitCode = 1;
});