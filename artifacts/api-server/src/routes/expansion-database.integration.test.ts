import express, { type NextFunction, type Request, type Response } from "express";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import type { Server } from "node:http";
import { z } from "zod/v4";

const testEnabled = process.env.EXPANSION_DATABASE_INTEGRATION === "1";
const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55433/educore_expansion_test";
const baselinePath = "/tmp/educore-expansion-baseline.json";
const extensionTables = [
  "admission_portal_settings",
  "admission_portal_classes",
  "admission_application_counters",
  "admission_applications",
  "admission_application_documents",
  "admission_request_rate_limits",
  "student_medical_profiles",
  "student_medical_visits",
  "student_welfare_records",
  "student_behaviour_configurations",
  "student_behaviour_records",
  "student_care_grants",
  "student_care_record_history",
  "student_care_idempotency",
] as const;

vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: Request, _res: Response, next: NextFunction) => {
      const userId = Number(req.header("x-test-user"));
      const schoolId = Number(req.header("x-test-school"));
      const roleHeader = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const roles = roleHeader.split(",").map((value, index) => {
        const [role, rawSchoolId] = value.split(":");
        return {
          id: index + 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : Number(rawSchoolId ?? schoolId),
          status: "ACTIVE",
        };
      });
      (req as Request & { edupulseUser?: unknown }).edupulseUser = {
        user: {
          id: userId,
          clerkUserId: `expansion-integration-${userId}`,
          email: `expansion-${userId}@example.invalid`,
          firstName: "Expansion",
          lastName: "Integration",
          phone: null,
          status: "ACTIVE",
        },
        roles,
      };
      next();
    },
  };
});

vi.mock("../services/admissions-storage", () => ({
  admissionDocumentDownloadUrl: vi.fn(async (path: string) => `https://private.invalid/${encodeURIComponent(path)}`),
  admissionDocumentUploadUrl: vi.fn(async (path: string) => `https://private.invalid/upload/${encodeURIComponent(path)}`),
  admissionsObjectPathMatchesApplication: (path: string, schoolId: number, applicationId: number) =>
    path.startsWith(`/objects/admissions/${schoolId}/${applicationId}/`),
  assertStagedAdmissionObject: vi.fn(async () => undefined),
  newAdmissionDocumentPath: (schoolId: number, applicationId: number) =>
    `/objects/admissions/${schoolId}/${applicationId}/11111111-1111-4111-8111-111111111111`,
  publicAdmissionLogoUrl: vi.fn(async () => null),
}));

import admissionsExpansionRouter from "./admissions-expansion";
import studentCareRouter from "./student-care";
import edupulseRouter from "./edupulse";

type Baseline = {
  identity: { db: string; schools: number; school_ids_hash: string };
  records: Record<string, { count: number; digest: string }>;
};
type Fixture = {
  schoolId: number;
  adminId: number;
  staffId: number;
  teacherId: number;
  accountantId: number;
  parentId: number;
  otherParentId: number;
  studentUserId: number;
  parentRecordId: number;
  secondParentRecordId: number;
  studentId: number;
  otherStudentId: number;
  classId: number;
  sessionId: number;
  termId: number;
  portalKey: string;
};

let server: Server;
let baseUrl = "";
let baseline: Baseline;
let cloneStartFingerprints: Record<string, { count: number; digest: string }>;
const fixtures: Fixture[] = [];
let reports: string[] = [];

const result = (rows: any[]) => rows[0];
const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
vi.setConfig({ testTimeout: 30_000 });

const publicReceiptSchema = z.object({
  applicationId: z.number().int().positive(),
  applicationNumber: z.string().min(1),
  receiptSecret: z.string().min(40),
  confirmation: z.object({ deliveryStatus: z.literal("NOT_SENT") }).passthrough(),
}).passthrough();
const idResponseSchema = z.object({ id: z.number().int().positive() }).passthrough();
const conversionResponseSchema = z.object({
  studentId: z.number().int().positive(),
  parentId: z.number().int().positive(),
  idempotent: z.boolean().optional(),
}).passthrough();
const rosterResponseSchema = z.array(z.object({
  id: z.number().int().positive(),
  medicalInformation: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
}).passthrough());
const versionResponseSchema = z.object({ version: z.number().int().nonnegative() }).passthrough();
const profileResponseSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  archivedAt: z.union([z.string(), z.date(), z.null()]),
}).passthrough();
const historyResponseSchema = z.array(z.object({ revision: z.number().int().positive() }).passthrough());
const careSummaryResponseSchema = z.object({
  studentId: z.number().int().positive().optional(),
  welfare: z.array(z.object({ category: z.string(), concern: z.string() }).passthrough()),
  behaviour: z.array(z.object({ category: z.string(), description: z.string(), status: z.string() }).passthrough()),
}).passthrough();

async function request(
  path: string,
  options: {
    method?: string;
    userId?: number;
    schoolId?: number;
    role?: string;
    body?: unknown;
    idempotencyKey?: string;
    version?: number;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-test-user": String(options.userId ?? 0),
      "x-test-school": String(options.schoolId ?? 0),
      "x-test-role": options.role ?? "SCHOOL_ADMIN",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options.version === undefined ? {} : { "If-Match-Version": String(options.version) }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function validatedBody<T>(response: { body: unknown }, schema: z.ZodType<T>): T {
  return schema.parse(response.body);
}

async function createFixture(): Promise<Fixture> {
  const suffix = uniqueSuffix();
  const userIds: number[] = [];
  for (const kind of ["admin", "staff", "teacher", "accountant", "parent", "second-parent", "student"]) {
    const user = await pool.query(
      `INSERT INTO app_users(clerk_user_id,email,first_name,last_name)
       VALUES($1,$2,$3,'Fixture') RETURNING id`,
      [`expansion-${kind}-${suffix}`, `expansion-${kind}-${suffix}@example.invalid`, `Expansion ${kind}`],
    );
    userIds.push(Number(result(user.rows).id));
  }
  const [adminId, staffId, teacherId, accountantId, parentId, otherParentId, studentUserId] = userIds;
  const schoolResult = await pool.query(
    `INSERT INTO schools(code,registration_number,name,city,state,status)
     VALUES($1,$2,'Expansion integration fixture','Test City','Test State','active') RETURNING id`,
    [`EXPD-${suffix}`, `EXPD-${suffix}`],
  );
  const schoolId = Number(result(schoolResult.rows).id);
  await pool.query(
    `INSERT INTO school_memberships(user_id,school_id,role,status)
     VALUES($1,$8,'SCHOOL_ADMIN','ACTIVE'),($2,$8,'STAFF','ACTIVE'),
           ($3,$8,'TEACHER','ACTIVE'),($4,$8,'ACCOUNTANT','ACTIVE'),
           ($5,$8,'PARENT','ACTIVE'),($6,$8,'PARENT','ACTIVE'),($7,$8,'STUDENT','ACTIVE')`,
    [adminId, staffId, teacherId, accountantId, parentId, otherParentId, studentUserId, schoolId],
  );
  const schoolClass = await pool.query(
    `INSERT INTO school_classes(school_id,name,section) VALUES($1,'Integration Grade','A') RETURNING id`,
    [schoolId],
  );
  const classId = Number(result(schoolClass.rows).id);
  const sessionRow = await pool.query(
    `INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current)
     VALUES($1,$2,DATE '2025-09-01',DATE '2026-07-31','ACTIVE',true) RETURNING id`,
    [schoolId, `2025-${suffix}`],
  );
  const sessionId = Number(result(sessionRow.rows).id);
  const termRow = await pool.query(
    `INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current)
     VALUES($1,$2,'First Term',DATE '2025-09-01',DATE '2025-12-31','ACTIVE',true) RETURNING id`,
    [schoolId, sessionId],
  );
  const termId = Number(result(termRow.rows).id);
  const studentRows = await pool.query(
    `INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,status,date_of_birth)
     VALUES($1,$2,'Care','Student','Other','Integration Grade','A','active',DATE '2018-02-03'),
           ($1,$3,'Other','Student','Other','Integration Grade','A','active',DATE '2017-06-10')
     RETURNING id`,
    [schoolId, `CARE-${suffix}`, `OTHER-${suffix}`],
  );
  const studentId = Number(studentRows.rows[0].id);
  const otherStudentId = Number(studentRows.rows[1].id);
  await pool.query(
    `UPDATE students SET user_id=$2,medical_info='Legacy private diagnosis',
       emergency_contact_name='Confidential Contact',emergency_contact_phone='+2348011111111'
      WHERE id=$1 AND school_id=$3`,
    [studentId, studentUserId, schoolId],
  );
  const parentRows = await pool.query(
    `INSERT INTO parents(school_id,user_id,name,email,phone,address,status)
     VALUES($1,$2,'Fixture Parent',$3,'+2348011111111','Fixture address','ACTIVE'),
           ($1,$4,'Other Parent',$5,'+2348022222222','Other address','ACTIVE')
     RETURNING id`,
    [schoolId, parentId, `parent-${suffix}@example.invalid`, otherParentId, `other-parent-${suffix}@example.invalid`],
  );
  const parentRecordId = Number(parentRows.rows[0].id);
  const secondParentRecordId = Number(parentRows.rows[1].id);
  await pool.query(
    `INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,is_primary_guardian,status)
     VALUES($1,$3,'Parent',true,'ACTIVE'),($2,$4,'Parent',true,'ACTIVE')`,
    [parentRecordId, secondParentRecordId, studentId, otherStudentId],
  );
  const configuredPortal = await pool.query(
    `UPDATE admission_portal_settings SET is_open=true,academic_session_id=$2,academic_term_id=$3
      WHERE school_id=$1 RETURNING portal_key`,
    [schoolId, sessionId, termId],
  );
  const fixture: Fixture = {
    schoolId, adminId, staffId, teacherId, accountantId, parentId, otherParentId, studentUserId,
    parentRecordId, secondParentRecordId,
    studentId, otherStudentId, classId, sessionId, termId, portalKey: result(configuredPortal.rows).portal_key,
  };
  fixtures.push(fixture);
  await pool.query(
    `INSERT INTO admission_portal_classes(school_id,class_id) VALUES($1,$2)`,
    [schoolId, classId],
  );
  return fixture;
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  // The tenant is exclusively created by this test suite. Delete only rows bearing
  // that tenant/user identity so test retries cannot remove clone baseline rows.
  await pool.query(
    `DELETE FROM audit_logs
      WHERE school_id=$1 OR actor_user_id=ANY($2::int[])`,
    [fixture.schoolId, [fixture.adminId, fixture.staffId, fixture.teacherId, fixture.accountantId, fixture.parentId, fixture.otherParentId, fixture.studentUserId]],
  );
  await pool.query(`DELETE FROM student_care_idempotency WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_care_record_history WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_medical_visits WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_medical_profiles WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_welfare_records WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_behaviour_records WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_behaviour_configurations WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM student_care_grants WHERE school_id=$1`, [fixture.schoolId]);
  const notificationIds = await pool.query(
    `SELECT id FROM communication_notifications WHERE school_id=$1`,
    [fixture.schoolId],
  );
  if (notificationIds.rows.length) {
    await pool.query(`DELETE FROM communication_deliveries WHERE notification_id=ANY($1::int[])`,
      [notificationIds.rows.map((row: any) => Number(row.id))]);
    await pool.query(`DELETE FROM communication_notifications WHERE school_id=$1`, [fixture.schoolId]);
  }
  await pool.query(`DELETE FROM admission_application_documents WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM admission_applications WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM admission_portal_classes WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM admission_application_counters WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM admission_portal_settings WHERE school_id=$1`, [fixture.schoolId]);
  const rateScopes = [
    `portal:${fixture.portalKey}`, `upload:${fixture.portalKey}`, `submit:${fixture.portalKey}`,
    "tracking", "document-download",
  ];
  const bucketHashes = rateScopes.flatMap((scope) => ["127.0.0.1", "::ffff:127.0.0.1"].map((ip) =>
    createHmac("sha256", "development-only-expansion-integration-secret")
      .update(`admissions:${scope}:${ip}`).digest("hex")));
  await pool.query(`DELETE FROM admission_request_rate_limits WHERE bucket_hash=ANY($1::text[])`, [bucketHashes]);
  await pool.query(`DELETE FROM parent_student_relationships WHERE parent_id=ANY($1::int[])`,
    [[fixture.parentRecordId, fixture.secondParentRecordId]]);
  await pool.query(`DELETE FROM parents WHERE id=ANY($1::int[])`,
    [[fixture.parentRecordId, fixture.secondParentRecordId]]);
  await pool.query(`DELETE FROM students WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(`DELETE FROM school_classes WHERE id=$1`, [fixture.classId]);
  await pool.query(`DELETE FROM academic_terms WHERE id=$1`, [fixture.termId]);
  await pool.query(`DELETE FROM academic_sessions WHERE id=$1`, [fixture.sessionId]);
  await pool.query(`DELETE FROM school_memberships WHERE school_id=$1`, [fixture.schoolId]);
  await pool.query(
    `DELETE FROM audit_logs WHERE school_id=$1 OR actor_user_id=ANY($2::int[])`,
    [fixture.schoolId, [fixture.adminId, fixture.staffId, fixture.teacherId, fixture.accountantId, fixture.parentId, fixture.otherParentId, fixture.studentUserId]],
  );
  await pool.query(`DELETE FROM schools WHERE id=$1`, [fixture.schoolId]);
    await pool.query(
    `DELETE FROM app_users WHERE id=ANY($1::int[])`,
    [[fixture.adminId, fixture.staffId, fixture.teacherId, fixture.accountantId, fixture.parentId, fixture.otherParentId, fixture.studentUserId]],
  );
}

async function publicApplication(fixture: Fixture, firstName = "Mara") {
  return {
    applicant: {
      firstName,
      lastName: "Applicant",
      dateOfBirth: "2018-02-03",
      gender: "PreferNotToSay",
      intendedClassId: fixture.classId,
      academicSessionId: fixture.sessionId,
      academicTermId: fixture.termId,
    },
    guardian: {
      fullName: "Applicant Guardian",
      phone: "+2348098765432",
      email: "guardian@example.invalid",
      relationship: "Parent",
    },
    emergencyContact: {
      fullName: "Emergency Guardian",
      phone: "+2348012345678",
      relationship: "Aunt",
    },
  };
}

async function legacyFingerprints() {
  const records: Record<string, { count: number; digest: string }> = {};
  for (const table of Object.keys(baseline.records).sort()) {
    const query = await pool.query(
      `SELECT count(*)::int AS count,
              md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) AS digest
         FROM public."${table}" t`,
    );
    records[table] = { count: Number(query.rows[0].count), digest: query.rows[0].digest };
  }
  return records;
}

describe.skipIf(!testEnabled)("admissions and student-care expansion on disposable PostgreSQL clone", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== expectedDatabaseUrl) {
      throw new Error("Refusing integration writes: DATABASE_URL must target the designated localhost:55433 disposable clone");
    }
    const identity = await pool.query(
      `SELECT current_database() AS database_name,inet_server_addr()::text AS address,
              inet_server_port() AS port,current_setting('data_directory') AS data_directory`,
    );
    if (identity.rows[0]?.database_name !== "educore_expansion_test" ||
        !String(identity.rows[0]?.address).startsWith("127.0.0.1/") ||
        Number(identity.rows[0]?.port) !== 55433 ||
        !String(identity.rows[0]?.data_directory).startsWith("/tmp/educore-expansion-postgres")) {
      throw new Error(`Refusing integration writes outside the designated local clone: ${JSON.stringify(identity.rows[0])}`);
    }
    baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    expect(baseline.identity.db).toBe("heliumdb");
    expect(Object.keys(baseline.records)).toHaveLength(132);
    cloneStartFingerprints = await legacyFingerprints();
    const existingExtensions = await pool.query(
      `SELECT to_regclass('public.admission_applications') AS admissions,
              to_regclass('public.student_medical_profiles') AS care`,
    );
    expect(existingExtensions.rows[0]).toMatchObject({ admissions: "admission_applications", care: "student_medical_profiles" });
    const app = express();
    app.use(express.json());
    app.use(admissionsExpansionRouter);
    app.use(studentCareRouter);
    app.use(edupulseRouter);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof AuthError) {
        res.status(error.statusCode).json({ error: error.message, code: error.eventType });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
    });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not start local integration test server"));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    vi.stubEnv("CLERK_SECRET_KEY", "development-only-expansion-integration-secret");
  });

  afterEach(async () => {
    while (fixtures.length) await cleanFixture(fixtures.pop()!);
    expect(await legacyFingerprints(), "all original public-table fingerprints after tenant cleanup")
      .toEqual(cloneStartFingerprints);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    if (reports.length) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("/tmp/expansion-database.integration.report.txt", `${reports.join("\n")}\n`, { encoding: "utf8" });
    }
  });

  it("replays all additive expansion tables and preserves the cloned 132-table baseline", async () => {
    const all = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
    );
    const publicTables = new Set(all.rows.map((row: any) => row.tablename));
    const baselineTables = Object.keys(baseline.records);
    expect(baselineTables.filter((table) => !publicTables.has(table))).toEqual([]);
    expect(extensionTables.filter((table) => !publicTables.has(table))).toEqual([]);
    expect(extensionTables.filter((table) => baseline.records[table])).toEqual([]);
    const triggers = await pool.query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`,
    );
    expect(triggers.rows.map((row: any) => row.tgname)).toContain("schools_admission_portal_defaults_after_insert");
    const ddlConstraints = await pool.query(
      `SELECT count(*)::int AS count FROM pg_constraint
        WHERE conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                            WHERE n.nspname='public' AND c.relname=ANY($1::text[]))`,
      [extensionTables],
    );
    expect(Number(ddlConstraints.rows[0].count)).toBeGreaterThan(30);
    const referenceMismatches = baselineTables.filter((table) =>
      cloneStartFingerprints[table].count !== baseline.records[table].count ||
      cloneStartFingerprints[table].digest !== baseline.records[table].digest,
    );
    const summary = `DDL/baseline: ${baselineTables.length}/132 legacy table names retained; ` +
      `${referenceMismatches.length}/132 local-clone fingerprints differ from heliumdb reference; ` +
      `${extensionTables.length} additive tables and ${ddlConstraints.rows[0].count} constraints present; ` +
      "local-clone startup fingerprints unchanged after test tenants";
    reports.push(summary);
    expect(summary).toContain("132/132 legacy table names retained");
    expect(summary).toContain("local-clone startup fingerprints unchanged");
  });

  it("creates, reviews, attaches documents, converts once, and safely reuses the explicitly chosen parent", async () => {
    const fixture = await createFixture();
    const key = `expansion-public-${uniqueSuffix()}`;
    const input = await publicApplication(fixture);
    const path = `/admissions/portals/${fixture.portalKey}/applications`;
    const [first, concurrentReplay] = await Promise.all([
      request(path, { method: "POST", body: input, idempotencyKey: key }),
      request(path, { method: "POST", body: input, idempotencyKey: key }),
    ]);
    expect([first.status, concurrentReplay.status].sort()).toEqual([201, 409]);
    const receipt = validatedBody(first.status === 201 ? first : concurrentReplay, publicReceiptSchema);
    expect(receipt.receiptSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(receipt.confirmation.deliveryStatus).toBe("NOT_SENT");
    const appId = receipt.applicationId;
    const appNumber = receipt.applicationNumber;
    const stored = await pool.query(
      `SELECT count(*) OVER()::int AS count,receipt_secret_hash FROM admission_applications
        WHERE id=$1 AND school_id=$2`,
      [appId, fixture.schoolId],
    );
    expect(stored.rows[0].count).toBe(1);
    expect(stored.rows[0].receipt_secret_hash).not.toBe(receipt.receiptSecret);

    const documentPath = `/objects/admissions/${fixture.schoolId}/${appId}/11111111-1111-4111-8111-111111111111`;
    const attached = await request(`/admissions/applications/${appId}/documents/confirm?schoolId=${fixture.schoolId}`, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { documentType: "Transcript", fileName: "transcript.pdf", contentType: "application/pdf", byteSize: 2048, objectPath: documentPath },
    });
    expect(attached.status).toBe(201);
    const replayAttachment = await request(`/admissions/applications/${appId}/documents/confirm?schoolId=${fixture.schoolId}`, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { documentType: "Transcript", fileName: "transcript.pdf", contentType: "application/pdf", byteSize: 2048, objectPath: documentPath },
    });
    expect(replayAttachment.status).toBe(201);
    const docCount = await pool.query(
      `SELECT count(*)::int AS count FROM admission_application_documents WHERE application_id=$1 AND school_id=$2`,
      [appId, fixture.schoolId],
    );
    expect(Number(docCount.rows[0].count)).toBe(1);
    const crossApplicationDownload = await request(
      `/admissions/applications/${appId + 90000}/documents/${validatedBody(attached, idResponseSchema).id}/download`,
      { method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId, body: {} },
    );
    expect(crossApplicationDownload.status).toBe(404);

    const review = await request(`/admissions/applications/${appId}/review?schoolId=${fixture.schoolId}`, {
      method: "PATCH", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 1, assessment: { result: "Eligible", score: 91 }, internalNotes: "INTERNAL ADMISSIONS REVIEW" },
    });
    expect(review.status).toBe(200);
    expect(validatedBody(review, z.object({ internalNotes: z.string() }).passthrough()).internalNotes)
      .toBe("INTERNAL ADMISSIONS REVIEW");
    const staleReview = await request(`/admissions/applications/${appId}/review?schoolId=${fixture.schoolId}`, {
      method: "PATCH", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 1, internalNotes: "stale write" },
    });
    expect(staleReview.status).toBe(409);

    const transition = async (status: string, expectedVersion: number) =>
      request(`/admissions/applications/${appId}/status?schoolId=${fixture.schoolId}`, {
        method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
        body: { status, expectedVersion, publicMessage: status === "Accepted" ? "Application approved" : undefined },
      });
    const underReview = await transition("UnderReview", 2);
    expect(underReview.status).toBe(200);
    const accepted = await transition("Accepted", 3);
    expect(accepted.status).toBe(200);
    const invalid = await transition("Submitted", 4);
    expect(invalid.status).toBe(409);

    const track = await request("/admissions/applications/track", { method: "POST", body: {
      applicationNumber: appNumber, phone: input.guardian.phone, receiptSecret: receipt.receiptSecret,
    } });
    expect(track.status).toBe(200);
    expect(track.body).toMatchObject({ status: "Accepted", publicMessage: "Application approved" });
    expect(JSON.stringify(track.body)).not.toMatch(/internal|assessment|score|transcript/i);

    const conversionPath = `/admissions/applications/${appId}/convert?schoolId=${fixture.schoolId}`;
    const convertInput = { expectedVersion: 4, existingParentId: fixture.parentRecordId };
    const conversions = await Promise.all([
      request(conversionPath, { method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId, body: convertInput, idempotencyKey: `convert-${uniqueSuffix()}-a` }),
      request(conversionPath, { method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId, body: convertInput, idempotencyKey: `convert-${uniqueSuffix()}-b` }),
    ]);
    expect(conversions.every((entry) => entry.status === 200)).toBe(true);
    const conversionResults = conversions.map((entry) => validatedBody(entry, conversionResponseSchema));
    expect(conversionResults.map((entry) => entry.studentId).filter((id, index, allIds) => allIds.indexOf(id) === index)).toHaveLength(1);
    expect(conversionResults.map((entry) => entry.parentId)).toEqual([fixture.parentRecordId, fixture.parentRecordId]);
    const converted = await pool.query(
      `SELECT converted_student_id AS student_id,converted_parent_id AS parent_id,status
         FROM admission_applications WHERE id=$1 AND school_id=$2`,
      [appId, fixture.schoolId],
    );
    expect(converted.rows[0]).toMatchObject({ parent_id: fixture.parentRecordId, status: "Enrolled" });
    const relationship = await pool.query(
      `SELECT count(*)::int AS count FROM parent_student_relationships
        WHERE parent_id=$1 AND student_id=$2 AND status='ACTIVE'`,
      [fixture.parentRecordId, converted.rows[0].student_id],
    );
    expect(Number(relationship.rows[0].count)).toBe(1);
    const staffKey = `expansion-staff-${uniqueSuffix()}`;
    const staffBody = { schoolId: fixture.schoolId, saveAsDraft: false, ...await publicApplication(fixture, "StaffKid") };
    const staffCreate = await request("/admissions/applications", {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: staffBody, idempotencyKey: staffKey,
    });
    expect(staffCreate.status).toBe(201);
    const staffReplay = await request("/admissions/applications", {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: staffBody, idempotencyKey: staffKey,
    });
    expect(staffReplay.status).toBe(201);
    const staffApplication = validatedBody(staffCreate, idResponseSchema);
    expect(validatedBody(staffReplay, idResponseSchema).id).toBe(staffApplication.id);
    const staffConflict = await request("/admissions/applications", {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { ...staffBody, applicant: { ...staffBody.applicant, firstName: "DifferentStaffKid" } },
      idempotencyKey: staffKey,
    });
    expect(staffConflict.status).toBe(409);
    const staffAppId = staffApplication.id;
    const staffUnderReview = await request(`/admissions/applications/${staffAppId}/status?schoolId=${fixture.schoolId}`, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { status: "UnderReview", expectedVersion: 1 },
    });
    expect(staffUnderReview.status).toBe(200);
    const staffAccepted = await request(`/admissions/applications/${staffAppId}/status?schoolId=${fixture.schoolId}`, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { status: "Accepted", expectedVersion: 2 },
    });
    expect(staffAccepted.status).toBe(200);
    const staffConversion = await request(`/admissions/applications/${staffAppId}/convert?schoolId=${fixture.schoolId}`, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 3, existingParentId: fixture.parentRecordId },
      idempotencyKey: `staff-convert-${uniqueSuffix()}`,
    });
    expect(staffConversion.status).toBe(200);
    const staffConversionReplay = await request(`/admissions/applications/${staffAppId}/convert?schoolId=${fixture.schoolId}`, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 3, existingParentId: fixture.parentRecordId },
      idempotencyKey: `staff-convert-${uniqueSuffix()}`,
    });
    expect(staffConversionReplay.status).toBe(200);
    const staffConversionResult = validatedBody(staffConversion, conversionResponseSchema);
    const staffConversionReplayResult = validatedBody(staffConversionReplay, conversionResponseSchema);
    expect(staffConversionReplayResult).toMatchObject({
      studentId: staffConversionResult.studentId, parentId: fixture.parentRecordId, idempotent: true,
    });
    const staffConvertedCount = await pool.query(
      `SELECT count(*)::int AS count FROM students WHERE school_id=$1 AND first_name='StaffKid'`,
      [fixture.schoolId],
    );
    expect(Number(staffConvertedCount.rows[0].count)).toBe(1);

    const ownershipDenied = await request(`/admissions/applications/${appId}?schoolId=${fixture.schoolId}`, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
    });
    expect(ownershipDenied.status).toBe(404);
    const mismatchedTenant = await request(`/admissions/applications/${appId}?schoolId=${fixture.schoolId + 10000}`, {
      userId: fixture.adminId, schoolId: fixture.schoolId + 10000,
    });
    expect(mismatchedTenant.status).toBe(404);
    reports.push(`Admissions: parallel public submit=${first.status}/${concurrentReplay.status}; one app, one document, public+staff conversion reused parent=${fixture.parentRecordId}`);
  }, 30_000);

  it("uses real care grants, revisions, idempotency, family links, private notes, and DB-only parent notification", async () => {
    const fixture = await createFixture();
    const legacyStudentRoster = `/students?schoolId=${fixture.schoolId}`;
    for (const [userId, role] of [
      [fixture.teacherId, "TEACHER"],
      [fixture.staffId, "STAFF"],
      [fixture.accountantId, "ACCOUNTANT"],
      [fixture.adminId, "PLATFORM_OWNER"],
    ] as const) {
      const roster = await request(legacyStudentRoster, {
        userId, schoolId: fixture.schoolId, role,
      });
      expect(roster.status).toBe(200);
      const student = validatedBody(roster, rosterResponseSchema).find((row) => row.id === fixture.studentId);
      expect(student).toMatchObject({
        medicalInformation: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      });
    }
    const grant = await request(`/schools/${fixture.schoolId}/care-access`, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { userId: fixture.staffId, active: true, permissions: ["MEDICAL_READ", "MEDICAL_WRITE", "WELFARE_READ", "WELFARE_WRITE", "SAFEGUARDING_READ", "SAFEGUARDING_WRITE", "BEHAVIOUR_READ", "BEHAVIOUR_WRITE", "BEHAVIOUR_REVIEW", "BEHAVIOUR_ACTION"] },
    });
    expect(grant.status).toBe(200);
    const schoolAdminRoster = await request(legacyStudentRoster, {
      userId: fixture.adminId, schoolId: fixture.schoolId, role: "SCHOOL_ADMIN",
    });
    expect(schoolAdminRoster.status).toBe(200);
    expect(validatedBody(schoolAdminRoster, rosterResponseSchema).find((row) => row.id === fixture.studentId)).toMatchObject({
      medicalInformation: "Legacy private diagnosis",
      emergencyContactName: "Confidential Contact",
      emergencyContactPhone: "+2348011111111",
    });
    const grantedLegacyRoster = await request(legacyStudentRoster, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
    });
    expect(grantedLegacyRoster.status).toBe(200);
    expect(validatedBody(grantedLegacyRoster, rosterResponseSchema).find((row) => row.id === fixture.studentId)).toMatchObject({
      medicalInformation: "Legacy private diagnosis",
      emergencyContactName: "Confidential Contact",
      emergencyContactPhone: "+2348011111111",
    });

    const configurationPath = `/schools/${fixture.schoolId}/behaviour/configuration`;
    const initialConfiguration = await request(configurationPath, {
      userId: fixture.adminId, schoolId: fixture.schoolId,
    });
    expect(initialConfiguration.status).toBe(200);
    expect(validatedBody(initialConfiguration, versionResponseSchema).version).toBe(0);
    const firstConfiguration = await request(configurationPath, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 0, categories: ["INCIDENT", "POSITIVE"], actions: ["Counselling", "Parent meeting"] },
    });
    expect(firstConfiguration.status).toBe(200);
    expect(validatedBody(firstConfiguration, versionResponseSchema).version).toBe(1);
    const staleConfiguration = await request(configurationPath, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 0, categories: ["INCIDENT"], actions: ["Counselling"] },
    });
    expect(staleConfiguration.status).toBe(409);
    const secondConfiguration = await request(configurationPath, {
      method: "PUT", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 1, categories: ["INCIDENT", "POSITIVE"], actions: ["Counselling", "Restorative conference"] },
    });
    expect(secondConfiguration.status).toBe(200);
    const configuredBehaviour = validatedBody(secondConfiguration, versionResponseSchema);
    expect(configuredBehaviour.version).toBe(2);

    const profileInput = {
      expectedVersion: 0, bloodGroup: "O+", genotype: "AA", allergies: ["pollen"],
      conditions: ["asthma"], supportNeeds: [], medications: ["inhaler"],
      emergencyMedicalNotes: "Confidential clinical note",
      providerContacts: [{ name: "Clinic", phone: "+2348012345678", role: "Physician" }],
      emergencyContacts: [],
    };
    const profilePath = `/schools/${fixture.schoolId}/students/${fixture.studentId}/medical-profile`;
    const profile = await request(profilePath, {
      method: "PUT", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: profileInput, idempotencyKey: "medical-profile-integration-key-001",
    });
    expect(profile.status).toBe(200);
    const profileReplay = await request(profilePath, {
      method: "PUT", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: profileInput, idempotencyKey: "medical-profile-integration-key-001",
    });
    expect(profileReplay.status).toBe(200);
    const profileResult = validatedBody(profile, profileResponseSchema);
    expect(validatedBody(profileReplay, profileResponseSchema).id).toBe(profileResult.id);
    const conflictReplay = await request(profilePath, {
      method: "PUT", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: { ...profileInput, genotype: "AS" }, idempotencyKey: "medical-profile-integration-key-001",
    });
    expect(conflictReplay.status).toBe(409);
    const profileHistory = await request(`${profilePath}/history`, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
    });
    expect(profileHistory.status).toBe(200);
    expect(validatedBody(profileHistory, historyResponseSchema).map((row) => row.revision)).toEqual([1]);
    const archivedProfile = await request(profilePath, {
      method: "DELETE", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF", version: 1,
    });
    expect(archivedProfile.status).toBe(200);
    const archivedProfileResult = validatedBody(archivedProfile, profileResponseSchema);
    expect(archivedProfileResult).toMatchObject({ id: profileResult.id, version: 2 });
    expect(archivedProfileResult.archivedAt).not.toBeNull();
    const restoredProfile = await request(profilePath, {
      method: "PUT", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: { ...profileInput, expectedVersion: 2 },
      idempotencyKey: "medical-profile-restore-integration-key-002",
    });
    expect(restoredProfile.status).toBe(200);
    const restoredProfileResult = validatedBody(restoredProfile, profileResponseSchema);
    expect(restoredProfileResult).toMatchObject({ id: profileResult.id, version: 3, archivedAt: null });
    const restoredProfileHistory = await request(`${profilePath}/history`, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
    });
    const restoredHistory = validatedBody(restoredProfileHistory, historyResponseSchema);
    expect(restoredHistory.map((row) => row.revision)).toEqual([3, 2, 1]);

    const ungranted = await request(profilePath, { userId: fixture.parentId, schoolId: fixture.schoolId, role: "PARENT" });
    expect(ungranted.status).toBe(404);
    const studentCrossSchool = await request(`/schools/${fixture.schoolId + 1}/students/${fixture.studentId}/medical-profile`, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: `STAFF:${fixture.schoolId}`,
    });
    expect(studentCrossSchool.status).toBe(404);
    const ownerBlocked = await request(profilePath, {
      userId: fixture.adminId, schoolId: fixture.schoolId, role: `PLATFORM_OWNER,SCHOOL_ADMIN:${fixture.schoolId}`,
    });
    expect(ownerBlocked.status).toBe(403);

    const welfarePath = `/schools/${fixture.schoolId}/students/${fixture.studentId}/welfare`;
    const welfare = await request(welfarePath, {
      method: "POST", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: { category: "FAMILY_SUPPORT", concern: "Parent-visible family support", internalNotes: "PRIVATE CASE DETAIL", parentVisible: true },
      idempotencyKey: "welfare-family-integration-001",
    });
    expect(welfare.status).toBe(201);
    const safeguarding = await request(welfarePath, {
      method: "POST", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: { category: "SAFEGUARDING", concern: "Restricted safeguarding concern", internalNotes: "SENSITIVE SAFEGUARDING DETAIL", parentVisible: true },
      idempotencyKey: "welfare-safeguarding-integration-001",
    });
    expect(safeguarding.status).toBe(400);
    const safeguardingPrivate = await request(welfarePath, {
      method: "POST", userId: fixture.staffId, schoolId: fixture.schoolId, role: "STAFF",
      body: { category: "SAFEGUARDING", concern: "Restricted safeguarding concern", internalNotes: "SENSITIVE SAFEGUARDING DETAIL" },
      idempotencyKey: "welfare-safeguarding-integration-002",
    });
    expect(safeguardingPrivate.status).toBe(201);

    const parentSummary = await request(`/parent/children/${fixture.studentId}/care-summary`, {
      userId: fixture.parentId, schoolId: fixture.schoolId, role: "PARENT",
    });
    expect(parentSummary.status).toBe(200);
    const parentSummaryResult = validatedBody(parentSummary, careSummaryResponseSchema);
    expect(parentSummaryResult.welfare).toHaveLength(1);
    expect(parentSummaryResult.welfare[0]).toMatchObject({ category: "FAMILY_SUPPORT", concern: "Parent-visible family support" });
    expect(JSON.stringify(parentSummary.body)).not.toMatch(/PRIVATE CASE DETAIL|SENSITIVE SAFEGUARDING DETAIL|internalNotes|SAFEGUARDING/i);
    const siblingBlocked = await request(`/parent/children/${fixture.otherStudentId}/care-summary`, {
      userId: fixture.parentId, schoolId: fixture.schoolId, role: "PARENT",
    });
    expect(siblingBlocked.status).toBe(404);
    const otherFamilyOwnChild = await request(`/parent/children/${fixture.otherStudentId}/care-summary`, {
      userId: fixture.otherParentId, schoolId: fixture.schoolId, role: "PARENT",
    });
    expect(otherFamilyOwnChild.status).toBe(200);
    expect(validatedBody(otherFamilyOwnChild, careSummaryResponseSchema).welfare).toEqual([]);

    const behaviourPath = `/schools/${fixture.schoolId}/students/${fixture.studentId}/behaviour`;
    const behaviour = await request(behaviourPath, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { category: "INCIDENT", severity: "MODERATE", description: "Incident summary", internalNotes: "PRIVATE BEHAVIOUR NOTE", parentVisible: true },
      idempotencyKey: "behaviour-create-integration-001",
    });
    expect(behaviour.status).toBe(201);
    const behaviourReplay = await request(behaviourPath, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { category: "INCIDENT", severity: "MODERATE", description: "Incident summary", internalNotes: "PRIVATE BEHAVIOUR NOTE", parentVisible: true },
      idempotencyKey: "behaviour-create-integration-001",
    });
    expect(behaviourReplay.status).toBe(201);
    const behaviourResult = validatedBody(behaviour, idResponseSchema);
    expect(validatedBody(behaviourReplay, idResponseSchema).id).toBe(behaviourResult.id);
    const behaviourConflict = await request(behaviourPath, {
      method: "POST", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { category: "INCIDENT", severity: "MODERATE", description: "Different payload" },
      idempotencyKey: "behaviour-create-integration-001",
    });
    expect(behaviourConflict.status).toBe(409);
    const behaviourPatchPath = `${behaviourPath}/${behaviourResult.id}`;
    const action = await request(behaviourPatchPath, {
      method: "PATCH", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 1, category: "INCIDENT", severity: "MODERATE", description: "Incident summary", status: "ACTION", action: "Counselling" },
    });
    expect(action.status).toBe(200);
    const staleAction = await request(behaviourPatchPath, {
      method: "PATCH", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 1, category: "INCIDENT", severity: "MODERATE", description: "Incident summary", status: "PARENT_NOTIFICATION", parentNotificationRequested: true },
    });
    expect(staleAction.status).toBe(409);
    const notification = await request(behaviourPatchPath, {
      method: "PATCH", userId: fixture.adminId, schoolId: fixture.schoolId,
      body: { expectedVersion: 2, category: "INCIDENT", severity: "MODERATE", description: "Incident summary", status: "PARENT_NOTIFICATION", parentNotificationRequested: true },
    });
    expect(notification.status).toBe(200);
    const notificationResult = validatedBody(
      notification,
      z.object({ parentNotificationStatus: z.string() }).passthrough(),
    );
    expect(notificationResult.parentNotificationStatus).toBe("QUEUED");
    const storedNotification = await pool.query(
      `SELECT n.body,d.status AS delivery_status,d.channel
         FROM communication_notifications n
         JOIN communication_deliveries d ON d.notification_id=n.id
        WHERE n.school_id=$1 AND n.subject_student_id=$2 AND n.event_key LIKE $3`,
      [fixture.schoolId, fixture.studentId, `student-care-behaviour:${fixture.schoolId}:${behaviourResult.id}:%`],
    );
    expect(storedNotification.rows).toHaveLength(1);
    expect(storedNotification.rows[0]).toMatchObject({
      body: "A new school behaviour update is available in EduCore. Sign in to view the parent-visible update.",
      delivery_status: "SENT",
      channel: "IN_APP",
    });
    expect(JSON.stringify(storedNotification.rows[0])).not.toMatch(/PRIVATE BEHAVIOUR NOTE|SENSITIVE|student name|diagnosis/i);
    const notificationsBeforeReplay = await pool.query(
      `SELECT count(*)::int AS count FROM communication_notifications
        WHERE school_id=$1 AND subject_student_id=$2 AND event_key LIKE $3`,
      [fixture.schoolId, fixture.studentId, `student-care-behaviour:${fixture.schoolId}:${behaviourResult.id}:%`],
    );
    expect(Number(notificationsBeforeReplay.rows[0].count)).toBe(1);
    const history = await request(`${behaviourPatchPath}/history`, {
      userId: fixture.adminId, schoolId: fixture.schoolId,
    });
    expect(history.status).toBe(200);
    expect(validatedBody(history, historyResponseSchema).map((row) => row.revision)).toEqual([1, 2, 3]);
    const parentBehaviourSummary = await request(`/parent/children/${fixture.studentId}/care-summary`, {
      userId: fixture.parentId, schoolId: fixture.schoolId, role: "PARENT",
    });
    expect(parentBehaviourSummary.status).toBe(200);
    expect(validatedBody(parentBehaviourSummary, careSummaryResponseSchema).behaviour).toMatchObject([
      { category: "INCIDENT", description: "Incident summary", status: "PARENT_NOTIFICATION" },
    ]);
    expect(JSON.stringify(parentBehaviourSummary.body)).not.toMatch(/PRIVATE BEHAVIOUR NOTE|internalNotes|SAFEGUARDING/i);
    const selfIdentity = await pool.query(
      `SELECT UPPER(u.status) AS user_status,UPPER(sm.status) AS membership_status,UPPER(sm.role) AS membership_role
         FROM students st JOIN app_users u ON u.id=st.user_id
         JOIN school_memberships sm ON sm.user_id=u.id AND sm.school_id=st.school_id
        WHERE st.id=$1 AND st.school_id=$2`,
      [fixture.studentId, fixture.schoolId],
    );
    expect(selfIdentity.rows[0]).toEqual({
      user_status: "ACTIVE", membership_status: "ACTIVE", membership_role: "STUDENT",
    });
    const selfSummary = await request("/student/care-summary", {
      userId: fixture.studentUserId, schoolId: fixture.schoolId, role: "STUDENT",
    });
    expect(selfSummary.status).toBe(200);
    expect(validatedBody(selfSummary, careSummaryResponseSchema)).toMatchObject({
      studentId: fixture.studentId,
      welfare: [{ category: "FAMILY_SUPPORT", concern: "Parent-visible family support" }],
      behaviour: [{ category: "INCIDENT", description: "Incident summary" }],
    });
    expect(JSON.stringify(selfSummary.body)).not.toMatch(/PRIVATE CASE DETAIL|PRIVATE BEHAVIOUR NOTE|SENSITIVE SAFEGUARDING DETAIL|internalNotes|SAFEGUARDING/i);
    const unmappedStudentSelf = await request("/student/care-summary", {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: "STUDENT",
    });
    expect(unmappedStudentSelf.status).toBe(404);
    reports.push(`Care: profile replay revisions=${restoredHistory.length}, restore v${restoredProfileResult.version}; behaviour config v${configuredBehaviour.version}; student self mapping active; parent summary masked; behavior notification=${notificationResult.parentNotificationStatus}, DB deliveries=${storedNotification.rows.length}`);
  }, 30_000);

  it("denies cross-school care reads and creates no owned fixture on rejected membership requests", async () => {
    const fixture = await createFixture();
    const foreignFixture = await createFixture();
    await pool.query(
      `INSERT INTO student_care_grants(school_id,user_id,permissions,active,granted_by_user_id)
       VALUES($1,$2,ARRAY['MEDICAL_READ']::text[],true,$3)`,
      [foreignFixture.schoolId, fixture.staffId, fixture.adminId],
    );
    const foreignGrant = await pool.query(
      `SELECT count(*)::int AS count FROM student_care_grants
        WHERE school_id=$1 AND user_id=$2 AND active=true AND 'MEDICAL_READ'=ANY(permissions)`,
      [foreignFixture.schoolId, fixture.staffId],
    );
    expect(Number(foreignGrant.rows[0].count)).toBe(1);
    const legacyCrossSchoolRoster = await request(`/students?schoolId=${foreignFixture.schoolId}`, {
      userId: fixture.staffId, schoolId: fixture.schoolId, role: `STAFF:${fixture.schoolId}`,
    });
    expect(legacyCrossSchoolRoster.status).toBe(404);
    const crossSchoolProfile = await request(
      `/schools/${foreignFixture.schoolId}/students/${foreignFixture.studentId}/medical-profile`,
      { userId: fixture.staffId, schoolId: fixture.schoolId, role: `STAFF:${fixture.schoolId}` },
    );
    expect([403, 404]).toContain(crossSchoolProfile.status);
    const denied = await request(`/schools/${fixture.schoolId}/students/${fixture.studentId}/medical-profile`, {
      userId: fixture.staffId, schoolId: fixture.schoolId + 91, role: `STAFF:${fixture.schoolId}`,
    });
    expect([403, 404]).toContain(denied.status);
    const careRows = await pool.query(
      `SELECT count(*)::int AS count FROM student_medical_profiles WHERE school_id=$1`,
      [fixture.schoolId],
    );
    expect(Number(careRows.rows[0].count)).toBe(0);
    reports.push(`Privacy scope: cross-school MEDICAL_READ grant still denied (${crossSchoolProfile.status}); ordinary roster fields masked until role-local grant`);
  }, 30_000);
});