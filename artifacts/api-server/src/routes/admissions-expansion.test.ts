import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admissionsObjectPathMatchesApplication } from "../services/admissions-storage";
import {
  admissionApplicationInputSchema,
  canTransitionAdmissionStatus,
  sha256,
} from "../services/admissions";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  roles: [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }],
  applications: [] as Array<Record<string, any>>,
  conversionApplication: null as Record<string, any> | null,
  conversionStudentInserts: 0,
  parentRelationships: 0,
  parentEvents: [] as Array<{ input: Record<string, any>; callCount: number }>,
  privateApplication: null as Record<string, any> | null,
  privateDocuments: [] as Array<Record<string, any>>,
  nextDocumentId: 1,
  nextId: 1,
  rateCount: 1,
  publicPortalOpen: true,
  currentSchoolLogoObjectPath: null as string | null,
  legacySchoolLogoPath: null as string | null,
  portalLogoObjectPath: null as string | null,
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO admission_request_rate_limits")) {
      return { rows: [{ request_count: state.rateCount, retryAfterSeconds: 600 }] };
    }
    if (sql.includes("WHERE ps.portal_key=$1")) {
      if (sql.includes("ps.is_open=true")) {
        return { rows: state.publicPortalOpen ? [{ school_id: 1 }] : [] };
      }
      return { rows: [{
        school_id: 1,
        portal_key: "greenfield-1",
        is_open: state.publicPortalOpen,
        deadline: null,
        fee_info: null,
        requirements: [],
        required_documents: [],
        instructions: null,
        entrance_examination: null,
        interview_information: null,
        public_description: "Public description only",
        public_address: null,
        public_phone: null,
        public_email: null,
        logo_object_path: state.portalLogoObjectPath,
        name: "Greenfield School",
        session_name: "2026/27",
        term_name: "First Term",
      }] };
    }
    if (sql.includes("FROM admission_portal_settings") && sql.includes("WHERE portal_key=$1")) {
      return { rows: state.publicPortalOpen ? [{ school_id: 1 }] : [] };
    }
    if (sql.includes("SELECT portal_key FROM admission_portal_settings WHERE school_id=$1")) {
      return { rows: [{ portal_key: "greenfield-1" }] };
    }
    if (sql.includes("FROM admission_portal_classes pc")) {
      return { rows: [{ id: 1, name: "Grade One", section: "A" }] };
    }
    if (sql.includes("SELECT * FROM admission_portal_settings WHERE school_id=$1")) {
      return { rows: [{
        school_id: 1,
        portal_key: "greenfield-1",
        is_open: state.publicPortalOpen,
        academic_session_id: null,
        academic_term_id: null,
        deadline: null,
        fee_info: null,
        requirements: [],
        required_documents: [],
        instructions: null,
        entrance_examination: null,
        interview_information: null,
        public_description: null,
        public_address: null,
        public_phone: null,
        public_email: null,
        logo_object_path: state.portalLogoObjectPath,
      }] };
    }
    if (sql.includes("SELECT class_id FROM admission_portal_classes WHERE school_id=$1 ORDER BY class_id")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT s.logo AS legacy_logo_path,l.object_path AS current_logo_path")) {
      return { rows: [{
        legacy_logo_path: state.legacySchoolLogoPath,
        current_logo_path: state.currentSchoolLogoObjectPath,
      }] };
    }
    if (sql.includes("SELECT count(*)::int AS count FROM school_classes")) {
      return { rows: [{ count: (values[1] as number[]).length }] };
    }
    if (sql.includes("UPDATE admission_portal_settings SET")) {
      state.publicPortalOpen = Boolean(values[1]);
      state.portalLogoObjectPath = values[15] == null ? null : String(values[15]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM admission_portal_classes WHERE school_id=$1")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM admission_applications WHERE school_id=$1 AND idempotency_key=$2")) {
      const row = state.applications.find((application) =>
        application.schoolId === Number(values[0]) && application.idempotencyKey === values[1]);
      return { rows: row ? [{ id: row.id, payload_hash: row.payloadHash }] : [] };
    }
    if (sql.includes("FROM admission_portal_settings WHERE school_id=$1 FOR UPDATE")) {
      return { rows: [{
        is_open: state.publicPortalOpen,
        academic_session_id: 1,
        academic_term_id: null,
        deadline: null,
        portal_key: "greenfield-1",
      }] };
    }
    if (sql.includes("FROM school_classes WHERE id=$1 AND school_id=$2")) return { rows: [{ id: 1 }] };
    if (sql.includes("FROM academic_sessions WHERE id=$1 AND school_id=$2")) return { rows: [{ id: 1 }] };
    if (sql.includes("FROM admission_portal_classes WHERE school_id=$1 AND class_id=$2")) return { rows: [{ "?column?": 1 }] };
    if (sql.includes("UPDATE admission_application_counters")) return { rows: [{ current_value: state.applications.length + 1 }] };
    if (sql.includes("SELECT registration_number,code FROM schools")) return { rows: [{ registration_number: "YEM-SCH-GREEN", code: "GREEN" }] };
    if (sql.includes("INSERT INTO admission_applications(")) {
      const row = {
        id: state.nextId++,
        schoolId: Number(values[0]),
        applicationNumber: values[1],
        status: values[2],
        source: values[3],
        receiptSecretHash: values[24],
        idempotencyKey: values[25],
        payloadHash: values[26],
        guardianPhone: values[17],
      };
      state.applications.push(row);
      if (values[3] === "STAFF") {
        state.privateApplication = {
          id: row.id,
          school_id: values[0],
          application_number: values[1],
          status: values[2],
          applicant_first_name: values[4],
          applicant_middle_name: values[5],
          applicant_last_name: values[6],
          date_of_birth: values[7],
          gender: values[8],
          photo_object_path: values[9],
          previous_school: values[10],
          previous_class: values[11],
          intended_class_id: values[12],
          academic_session_id: values[13],
          academic_term_id: values[14],
          applicant_address: values[15],
          guardian_name: values[16],
          guardian_phone: values[17],
          guardian_email: values[18],
          guardian_relationship: values[19],
          guardian_address: values[20],
          emergency_contact_name: values[21],
          emergency_contact_phone: values[22],
          emergency_contact_relationship: values[23],
          receipt_secret_hash: values[24],
          assessment: null,
          interview: null,
          internal_notes: null,
          public_message: null,
          converted_student_id: null,
          converted_parent_id: null,
          version: 1,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
        };
      }
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [], rowCount: 1 };
    if (sql.includes("WHERE application_number=$1 AND guardian_phone=$2")) {
      const row = state.applications.find((application) =>
        application.applicationNumber === values[0] && application.guardianPhone === values[1]);
      return {
        rows: row ? [{
          application_number: row.applicationNumber,
          status: row.status,
          public_message: null,
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
          receipt_secret_hash: row.receiptSecretHash,
        }] : [],
      };
    }
    if (sql.includes("SELECT id FROM schools WHERE id=$1 FOR UPDATE")) return { rows: [{ id: 1 }] };
    if (sql.includes("SELECT * FROM admission_applications WHERE id=$1 AND school_id=$2 FOR UPDATE")) {
      if (state.conversionApplication &&
          Number(state.conversionApplication.id) === Number(values[0]) &&
          Number(state.conversionApplication.school_id) === Number(values[1])) {
        return { rows: [{ ...state.conversionApplication }] };
      }
      return state.privateApplication &&
        Number(state.privateApplication.id) === Number(values[0]) &&
        Number(state.privateApplication.school_id) === Number(values[1])
        ? { rows: [{ ...state.privateApplication }] }
        : { rows: [] };
    }
    if (sql.includes("SELECT id,admission_no FROM students WHERE id=$1 AND school_id=$2")) {
      return { rows: [{ id: 81, admission_no: "ADM-1-000081" }] };
    }
    if (sql.includes("SELECT name,section FROM school_classes")) return { rows: [{ name: "Grade One", section: "A" }] };
    if (sql.includes("SELECT id FROM students WHERE school_id=$1")) return { rows: [] };
    if (sql.includes("SELECT COALESCE(MAX((substring(admission_no FROM $2))::bigint)")) return { rows: [{ sequence: 80 }] };
    if (sql.includes("INSERT INTO students(")) {
      state.conversionStudentInserts += 1;
      return { rows: [{ id: 81 }] };
    }
    if (sql.includes("SELECT id,user_id,status FROM parents WHERE id=$1 AND school_id=$2")) {
      return { rows: [{ id: 99, user_id: 44, status: "ACTIVE" }] };
    }
    if (sql.includes("INSERT INTO parent_student_relationships")) {
      state.parentRelationships += 1;
      return { rows: [] };
    }
    if (sql.includes("UPDATE admission_applications SET status='Enrolled'")) {
      state.conversionApplication = {
        ...state.conversionApplication,
        status: "Enrolled",
        converted_student_id: 81,
        converted_parent_id: 99,
        version: Number(state.conversionApplication?.version ?? 0) + 1,
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE admission_applications SET") && sql.includes("applicant_first_name=$4")) {
      if (!state.privateApplication ||
          Number(state.privateApplication.id) !== Number(values[0]) ||
          Number(state.privateApplication.school_id) !== Number(values[1]) ||
          Number(state.privateApplication.version) !== Number(values[2]) ||
          !["Draft", "Submitted"].includes(state.privateApplication.status)) {
        return { rows: [], rowCount: 0 };
      }
      Object.assign(state.privateApplication, {
        applicant_first_name: values[3],
        applicant_middle_name: values[4],
        applicant_last_name: values[5],
        date_of_birth: values[6],
        gender: values[7],
        previous_school: values[8],
        previous_class: values[9],
        intended_class_id: values[10],
        academic_session_id: values[11],
        academic_term_id: values[12],
        applicant_address: values[13],
        guardian_name: values[14],
        guardian_phone: values[15],
        guardian_email: values[16],
        guardian_relationship: values[17],
        guardian_address: values[18],
        emergency_contact_name: values[19],
        emergency_contact_phone: values[20],
        emergency_contact_relationship: values[21],
        version: Number(values[2]) + 1,
        updated_at: new Date("2026-01-02T00:00:00.000Z"),
      });
      return { rows: [{ id: state.privateApplication.id }], rowCount: 1 };
    }
    if (sql.includes("SELECT school_id,receipt_secret_hash FROM admission_applications WHERE id=$1")) {
      return {
        rows: state.privateApplication
          ? [{ school_id: state.privateApplication.school_id, receipt_secret_hash: state.privateApplication.receipt_secret_hash }]
          : [],
      };
    }
    if (sql.includes("FROM admission_applications WHERE id=$1 AND school_id=$2") && !sql.includes("FOR UPDATE")) {
      return state.privateApplication &&
        Number(state.privateApplication.id) === Number(values[0]) &&
        Number(state.privateApplication.school_id) === Number(values[1])
        ? { rows: [{ ...state.privateApplication }] }
        : { rows: [] };
    }
    if (sql.includes("FROM admission_application_documents WHERE application_id=$1 AND school_id=$2 ORDER BY id")) {
      return {
        rows: state.privateDocuments.filter((document) =>
          Number(document.application_id) === Number(values[0]) &&
          Number(document.school_id) === Number(values[1])),
      };
    }
    if (sql.includes("INSERT INTO admission_application_documents(")) {
      const document = {
        id: state.nextDocumentId++,
        school_id: values[0],
        application_id: values[1],
        document_type: values[2],
        file_name: values[3],
        content_type: values[4],
        byte_size: values[5],
        object_path: values[6],
      };
      const existing = state.privateDocuments.find((item) => item.object_path === document.object_path);
      if (sql.includes("ON CONFLICT(object_path) DO NOTHING") && existing) return { rows: [] };
      state.privateDocuments.push(document);
      return { rows: [document] };
    }
    if (sql.includes("SELECT id,application_id,school_id,document_type,file_name,content_type,byte_size,object_path")) {
      const document = state.privateDocuments.find((item) => item.object_path === values[0]);
      return { rows: document ? [{ ...document }] : [] };
    }
    if (sql.includes("SELECT object_path FROM admission_application_documents")) {
      const document = state.privateDocuments.find((item) =>
        Number(item.id) === Number(values[0]) &&
        Number(item.application_id) === Number(values[1]) &&
        Number(item.school_id) === Number(values[2]));
      return { rows: document ? [{ object_path: document.object_path }] : [] };
    }
    if (sql.includes("FROM admission_applications WHERE id=$1 AND school_id=$2")) return { rows: [] };
    throw new Error(`Unhandled admissions test SQL: ${sql}`);
  });
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../services/communication-service", () => ({
  emitDomainParentEvent: vi.fn(async (_client: unknown, input: Record<string, any>) => {
    state.parentEvents.push({ input, callCount: state.calls.length });
    return [];
  }),
}));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  }
  const context = () => ({
    user: { id: 9, clerkUserId: "clerk-9", email: "admin@example.test", firstName: "School", lastName: "Admin" },
    roles: state.roles,
  });
  return {
    AuthError,
    getUserContext: (req: express.Request) => {
      const current = (req as any).edupulseUser;
      if (!current) throw new AuthError(401, "Authentication required");
      return current;
    },
    assertSchoolOperationalAccess: (_req: express.Request, schoolId: number, roles: string[]) => {
      if (state.roles.some((role) => role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE")) {
        throw new AuthError(404, "Resource not found");
      }
      if (!state.roles.some((role) => role.schoolId === schoolId && role.status === "ACTIVE" && roles.includes(role.role))) {
        throw new AuthError(404, "Resource not found");
      }
      return context();
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).edupulseUser = context();
      next();
    },
  };
});
vi.mock("../services/admissions-storage", () => ({
  admissionDocumentDownloadUrl: vi.fn(async () => "https://private.example.test/download"),
  admissionDocumentUploadUrl: vi.fn(async () => "https://private.example.test/upload"),
  admissionsObjectPathMatchesApplication: (objectPath: string, schoolId: number, applicationId: number) =>
    objectPath.startsWith(`/objects/admissions/${schoolId}/${applicationId}/`),
  assertStagedAdmissionObject: vi.fn(async () => undefined),
  newAdmissionDocumentPath: (schoolId: number, applicationId: number) =>
    `/objects/admissions/${schoolId}/${applicationId}/11111111-1111-4111-8111-111111111111`,
  newAdmissionIntakeDocumentPath: (portalKey: string) =>
    `/objects/admissions/intake/${portalKey}/33333333-3333-4333-8333-333333333333`,
  publicAdmissionLogoUrl: vi.fn(async () => null),
}));
vi.mock("../lib/schoolLogoStorage", () => ({
  isManagedSchoolLogoObjectPath: (schoolId: number, value: unknown) =>
    typeof value === "string" &&
    new RegExp(`^/objects/school-logos/${schoolId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(value),
  readValidatedSchoolLogo: vi.fn(async () => ({
    bytes: Buffer.from("validated-school-logo"),
    contentType: "image/png",
  })),
}));

import admissionsExpansionRouter from "./admissions-expansion";
import { emitDomainParentEvent } from "../services/communication-service";

const app = express();
app.use(express.json());
app.use(admissionsExpansionRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
).finally(() => vi.unstubAllEnvs()));
beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
  vi.mocked(emitDomainParentEvent).mockClear();
  state.calls.length = 0;
  state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.applications.length = 0;
  state.conversionApplication = null;
  state.conversionStudentInserts = 0;
  state.parentRelationships = 0;
  state.parentEvents.length = 0;
  state.privateApplication = null;
  state.privateDocuments.length = 0;
  state.nextDocumentId = 1;
  state.publicPortalOpen = true;
  state.nextId = 1;
  state.rateCount = 1;
  state.currentSchoolLogoObjectPath = null;
  state.legacySchoolLogoPath = null;
  state.portalLogoObjectPath = null;
});

const publicApplication = () => ({
  applicant: {
    firstName: "Child",
    lastName: "Applicant",
    dateOfBirth: "2018-02-03",
    gender: "PreferNotToSay",
    intendedClassId: 1,
    academicSessionId: 1,
  },
  guardian: {
    fullName: "Guardian Name",
    phone: "+2348012345678",
  },
});

async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("admissions expansion security and retry protections", () => {
  it("returns an anonymous portal projection containing only explicitly public fields", async () => {
    const response = await get("/admissions/portals/greenfield-1");
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.school).toEqual({
      name: "Greenfield School",
      description: "Public description only",
      address: null,
      publicPhone: null,
      publicEmail: null,
      logoUrl: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/student|parent|staff|finance|internalNotes|registration_number/i);
    expect(body.availableClasses).toEqual([{ id: 1, name: "Grade One", section: "A" }]);
  });

  it("returns only a school-scoped stored logo path to settings and exposes its image publicly only after explicit opt-in", async () => {
    const logoPath = "/objects/school-logos/1/11111111-1111-4111-8111-111111111111";
    state.currentSchoolLogoObjectPath = logoPath;
    const settings = await get("/admissions/portal-settings?schoolId=1");
    expect(settings.status).toBe(200);
    const settingsBody = await settings.json() as any;
    expect(settingsBody).toMatchObject({
      logoObjectPath: null,
      availableSchoolLogoObjectPath: logoPath,
    });
    expect(JSON.stringify(settingsBody)).not.toMatch(/signed_url|googleapis\.com|X-Goog-Signature/i);

    const updated = await fetch(`${baseUrl}/admissions/portal-settings?schoolId=1`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        open: false,
        availableClassIds: [],
        requirements: [],
        requiredDocuments: [],
        logoObjectPath: logoPath,
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ logoObjectPath: logoPath });

    const publicPortal = await get("/admissions/portals/greenfield-1");
    expect(publicPortal.status).toBe(200);
    expect((await publicPortal.json() as any).school.logoUrl).toMatch(/^data:image\/png;base64,/);

    state.currentSchoolLogoObjectPath = null;
    state.legacySchoolLogoPath = "https://external.example.test/logo.png";
    state.portalLogoObjectPath = null;
    const unsafeCandidate = await get("/admissions/portal-settings?schoolId=1");
    expect((await unsafeCandidate.json() as any).availableSchoolLogoObjectPath).toBeNull();
  });

  it("accepts a phone-only public submission once and refuses a replay without exposing a reusable secret", async () => {
    const headers = { "Idempotency-Key": "public-admission-request-0001" };
    const first = await post("/admissions/portals/greenfield-1/applications", publicApplication(), headers);
    expect(first.status).toBe(201);
    const receipt = await first.json() as any;
    expect(receipt.receiptSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(receipt.confirmation).toEqual({
      deliveryStatus: "NOT_SENT",
      message: "Application submitted. No SMS or email has been sent.",
    });
    expect(first.url).not.toContain(receipt.receiptSecret);
    expect(state.applications).toHaveLength(1);

    const retry = await post("/admissions/portals/greenfield-1/applications", publicApplication(), headers);
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: "IDEMPOTENT_REPLAY" });
    expect(state.applications).toHaveLength(1);

    const track = await post("/admissions/applications/track", {
      applicationNumber: receipt.applicationNumber,
      phone: "+2348012345678",
      receiptSecret: receipt.receiptSecret,
    });
    expect(track.status).toBe(200);
    expect(await track.json()).toMatchObject({
      applicationNumber: receipt.applicationNumber,
      status: "Submitted",
      publicMessage: null,
    });
  });

  it("allows an authorized staff member to stage documents and create a draft while the public portal is closed", async () => {
    state.publicPortalOpen = false;
    const stagedResponse = await post("/admissions/documents/upload?schoolId=1", {
      documentType: "Transcript",
      fileName: "transcript.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });
    expect(stagedResponse.status).toBe(200);
    const staged = await stagedResponse.json() as any;
    expect(staged.objectPath).toMatch(/^\/objects\/admissions\/intake\/greenfield-1\//);
    expect(state.calls.some(({ values }) => values.includes("ADMISSION_STAFF_DOCUMENT_UPLOAD_STAGED"))).toBe(true);

    const publicUpload = await post("/admissions/portals/greenfield-1/documents/upload", {
      documentType: "Transcript",
      fileName: "transcript.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });
    expect(publicUpload.status).toBe(404);

    const applicationInput = {
      ...publicApplication(),
      documents: [{
        documentType: "Transcript",
        fileName: "transcript.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        objectPath: staged.objectPath,
      }],
    };
    const created = await post("/admissions/applications?schoolId=1", {
      ...applicationInput,
      schoolId: 1,
      saveAsDraft: true,
    }, { "Idempotency-Key": "staff-preupload-request-0001" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      status: "Draft",
      documents: [{ documentType: "Transcript", objectPath: staged.objectPath }],
    });
  });

  it("edits only Draft or Submitted profiles with version CAS and preserves status and conversion links", async () => {
    state.privateApplication = {
      id: 7,
      school_id: 1,
      application_number: "ADM-GREEN-1-2026-00001",
      status: "Submitted",
      applicant_first_name: "Child",
      applicant_middle_name: null,
      applicant_last_name: "Applicant",
      date_of_birth: "2018-02-03",
      gender: "PreferNotToSay",
      photo_object_path: "/objects/admissions/1/7/photo-11111111-1111-4111-8111-111111111111",
      previous_school: null,
      previous_class: null,
      intended_class_id: 1,
      academic_session_id: 1,
      academic_term_id: null,
      applicant_address: null,
      guardian_name: "Guardian",
      guardian_phone: "+2348012345678",
      guardian_email: null,
      guardian_relationship: null,
      guardian_address: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
      receipt_secret_hash: null,
      assessment: null,
      interview: null,
      internal_notes: null,
      public_message: null,
      converted_student_id: 81,
      converted_parent_id: 99,
      version: 1,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };
    const patch = {
      expectedVersion: 1,
      applicant: { intendedClassId: 2, academicSessionId: 2, academicTermId: null, address: "Updated address" },
      guardian: { phone: "+2348098765432", relationship: "Parent" },
    };
    const response = await fetch(`${baseUrl}/admissions/applications/7?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "Submitted",
      version: 2,
      applicant: { intendedClassId: 2, academicSessionId: 2, academicTermId: null, address: "Updated address" },
      guardian: { phone: "+2348098765432", relationship: "Parent" },
      studentId: 81,
    });
    expect(state.privateApplication).toMatchObject({
      status: "Submitted",
      photo_object_path: "/objects/admissions/1/7/photo-11111111-1111-4111-8111-111111111111",
      converted_student_id: 81,
      converted_parent_id: 99,
      version: 2,
    });
    expect(state.calls.some(({ values }) => values.includes("ADMISSION_APPLICATION_PROFILE_UPDATED"))).toBe(true);

    const stale = await fetch(`${baseUrl}/admissions/applications/7?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, guardian: { fullName: "Stale name" } }),
    });
    expect(stale.status).toBe(409);
    expect(state.privateApplication.guardian_name).toBe("Guardian");
    for (const status of ["Accepted", "Enrolled"]) {
      state.privateApplication.status = status;
      const locked = await fetch(`${baseUrl}/admissions/applications/7?schoolId=1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 2, guardian: { fullName: "Disallowed name" } }),
      });
      expect(locked.status).toBe(409);
    }
  });

  it("rejects a reused idempotency key when the payload hash differs", async () => {
    const headers = { "Idempotency-Key": "public-admission-request-0002" };
    const first = await post("/admissions/portals/greenfield-1/applications", publicApplication(), headers);
    expect(first.status).toBe(201);
    const changed = publicApplication();
    changed.applicant.firstName = "Different";
    const conflict = await post("/admissions/portals/greenfield-1/applications", changed, headers);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(state.applications).toHaveLength(1);
  });

  it.each([
    ["Owner only", [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }]],
    ["dual-role Owner", [
      { role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
      { role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" },
    ]],
    ["Teacher", [{ role: "TEACHER", schoolId: 1, status: "ACTIVE" }]],
  ])("denies %s private admissions access", async (_label, roles) => {
    state.roles = roles as typeof state.roles;
    const response = await get("/admissions/portal-settings?schoolId=1");
    expect(response.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("does not return an application when the requested school scope does not match", async () => {
    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" }];
    const response = await get("/admissions/applications/7?schoolId=2");
    expect(response.status).toBe(404);
    expect(state.calls.some(({ sql }) =>
      sql.includes("FROM admission_applications WHERE id=$1 AND school_id=$2"))).toBe(true);
  });

  it("keeps staged document upload and confirmation private, application-scoped and retry-safe", async () => {
    state.privateApplication = {
      id: 7,
      school_id: 1,
      application_number: "ADM-GREEN-1-2026-00001",
      status: "Submitted",
      applicant_first_name: "Child",
      applicant_middle_name: null,
      applicant_last_name: "Applicant",
      date_of_birth: "2018-02-03",
      gender: "PreferNotToSay",
      photo_object_path: null,
      previous_school: null,
      previous_class: null,
      intended_class_id: 1,
      academic_session_id: 1,
      academic_term_id: null,
      applicant_address: null,
      guardian_name: "Guardian",
      guardian_phone: "+2348012345678",
      guardian_email: null,
      guardian_relationship: null,
      guardian_address: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
      receipt_secret_hash: null,
      assessment: null,
      interview: null,
      internal_notes: null,
      public_message: null,
      converted_student_id: null,
      version: 1,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    };
    const upload = await post("/admissions/applications/7/documents/upload?schoolId=1", {
      documentType: "Transcript",
      fileName: "transcript.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });
    expect(upload.status).toBe(200);
    const staged = await upload.json() as any;
    expect(staged.objectPath).toMatch(/^\/objects\/admissions\/1\/7\//);

    const document = {
      documentType: "Transcript",
      fileName: "transcript.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
      objectPath: staged.objectPath,
    };
    const first = await post("/admissions/applications/7/documents/confirm?schoolId=1", document);
    expect(first.status).toBe(201);
    const firstDocument = await first.json() as any;
    const repeated = await post("/admissions/applications/7/documents/confirm?schoolId=1", document);
    expect(repeated.status).toBe(201);
    expect(await repeated.json()).toMatchObject({ id: firstDocument.id, objectPath: staged.objectPath });
    expect(state.privateDocuments).toHaveLength(1);

    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" }];
    const crossSchool = await post("/admissions/applications/7/documents/upload?schoolId=2", {
      documentType: "Transcript",
      fileName: "transcript.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    });
    expect(crossSchool.status).toBe(404);
  });

  it("authorizes anonymous private-document download by receipt secret without placing it in the URL", async () => {
    const receiptSecret = "the-secure-receipt-token-used-for-private-download-0001";
    state.privateApplication = { id: 7, school_id: 1, receipt_secret_hash: sha256(receiptSecret) };
    state.privateDocuments = [{
      id: 5,
      school_id: 1,
      application_id: 7,
      document_type: "Transcript",
      file_name: "transcript.pdf",
      content_type: "application/pdf",
      byte_size: 1024,
      object_path: "/objects/admissions/intake/greenfield-1/22222222-2222-4222-8222-222222222222",
    }];
    const response = await post("/admissions/applications/7/documents/5/download", { receiptSecret });
    expect(response.status).toBe(200);
    expect(response.url).not.toContain(receiptSecret);
    expect(await response.json()).toMatchObject({
      downloadUrl: "https://private.example.test/download",
    });

    const denied = await post("/admissions/applications/7/documents/5/download", {
      receiptSecret: "wrong-secret-for-a-different-applicant-000000",
    });
    expect(denied.status).toBe(404);
  });

  it("converts an accepted application exactly once and reuses the explicitly selected active parent", async () => {
    state.conversionApplication = {
      id: 7,
      school_id: 1,
      status: "Accepted",
      version: 3,
      converted_student_id: null,
      converted_parent_id: null,
      application_number: "ADM-GREEN-1-2026-00001",
      intended_class_id: 1,
      applicant_first_name: "Child",
      applicant_last_name: "Applicant",
      gender: "PreferNotToSay",
      date_of_birth: "2018-02-03",
      photo_object_path: null,
      previous_school: null,
      applicant_address: null,
      guardian_address: null,
      guardian_name: "Guardian Name",
      guardian_phone: "+2348012345678",
      guardian_email: "guardian@example.test",
      emergency_contact_phone: null,
    };
    const headers = {
      "Idempotency-Key": "conversion-admission-request-0001",
    };
    const first = await fetch(`${baseUrl}/admissions/applications/7/convert?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ expectedVersion: 3, existingParentId: 99 }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      applicationId: 7,
      studentId: 81,
      parentId: 99,
      idempotent: false,
    });

    const retry = await fetch(`${baseUrl}/admissions/applications/7/convert?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ expectedVersion: 3, existingParentId: 99 }),
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ studentId: 81, parentId: 99, idempotent: true });
    expect(state.conversionStudentInserts).toBe(1);
    expect(state.parentRelationships).toBe(1);
    expect(vi.mocked(emitDomainParentEvent)).toHaveBeenCalledTimes(1);
    expect(state.parentEvents).toHaveLength(1);
    expect(state.parentEvents[0].input).toMatchObject({
      schoolId: 1,
      studentId: 81,
      eventType: "ADMISSION_CONVERTED",
      eventId: 7,
      category: "SYSTEM",
      subject: "Admission completed",
      body: "Your child has been enrolled. Sign in to view their school information.",
      privacy: "PARENT_SAFE",
      link: "/parent/dashboard",
      channels: ["IN_APP"],
    });
    const parentEventCopy = JSON.stringify(state.parentEvents[0].input);
    expect(parentEventCopy).not.toContain("guardian@example.test");
    expect(parentEventCopy).not.toContain("+2348012345678");
    expect(parentEventCopy).not.toContain("ADM-GREEN-1-2026-00001");
    const relationshipInsertIndex = state.calls.findIndex(({ sql }) =>
      sql.includes("INSERT INTO parent_student_relationships"));
    expect(relationshipInsertIndex).toBeGreaterThanOrEqual(0);
    expect(state.parentEvents[0].callCount).toBeGreaterThan(relationshipInsertIndex);
    const commitIndex = state.calls.findIndex(({ sql }) => sql === "COMMIT");
    expect(commitIndex).toBeGreaterThan(state.parentEvents[0].callCount);
    expect(state.calls.some(({ sql }) => sql.includes("createSchoolInvitation"))).toBe(false);
  });

  it("does not emit admission parent notifications for an unconverted application even when contact details exist", async () => {
    state.conversionApplication = {
      id: 7,
      school_id: 1,
      status: "Submitted",
      guardian_email: "unverified@example.test",
      guardian_phone: "+2348099999999",
      converted_student_id: null,
      converted_parent_id: null,
    };
    const response = await fetch(`${baseUrl}/admissions/applications/7/convert?schoolId=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "conversion-admission-request-0002",
      },
      body: JSON.stringify({ expectedVersion: 1, createParentRecord: true }),
    });

    expect(response.status).toBe(409);
    expect(vi.mocked(emitDomainParentEvent)).not.toHaveBeenCalled();
    expect(state.parentEvents).toHaveLength(0);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO parent_student_relationships"))).toBe(false);
  });

  it("applies legal transitions, protects terminal decisions, and checks receipt hashes", async () => {
    expect(canTransitionAdmissionStatus("Submitted", "UnderReview")).toBe(true);
    expect(canTransitionAdmissionStatus("UnderReview", "Accepted")).toBe(true);
    expect(canTransitionAdmissionStatus("Rejected", "Accepted")).toBe(false);
    expect(canTransitionAdmissionStatus("Enrolled", "Waitlisted")).toBe(false);
    expect(sha256("one-time-secret")).not.toBe("one-time-secret");
  });

  it("validates structured applicant, guardian, emergency-contact and private-document fields", () => {
    const application = publicApplication();
    const complete = {
      ...application,
      applicant: {
        ...application.applicant,
        middleName: "Middle",
        previousSchool: "Previous School",
        previousClass: "Kindergarten",
        academicTermId: 2,
        address: "Applicant address",
        photoObjectPath: "/objects/admissions/intake/greenfield-1/11111111-1111-4111-8111-111111111111",
      },
      guardian: { ...application.guardian, relationship: "Parent", address: "Guardian address" },
      emergencyContact: { fullName: "Emergency Contact", phone: "+2348011111111", relationship: "Aunt" },
      documents: [{
        documentType: "Birth certificate",
        fileName: "birth-certificate.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        objectPath: "/objects/admissions/intake/greenfield-1/22222222-2222-4222-8222-222222222222",
      }],
    };
    expect(admissionApplicationInputSchema.safeParse(complete).success).toBe(true);
    expect(admissionApplicationInputSchema.safeParse({
      ...application,
      guardian: { fullName: "Guardian", phone: "08012345678" },
      fileBytes: "base64-not-accepted",
    }).success).toBe(false);
  });

  it("only permits private document object paths scoped to their application", () => {
    expect(admissionsObjectPathMatchesApplication(
      "/objects/admissions/1/77/11111111-1111-4111-8111-111111111111", 1, 77,
    )).toBe(true);
    expect(admissionsObjectPathMatchesApplication(
      "/objects/admissions/2/77/11111111-1111-4111-8111-111111111111", 1, 77,
    )).toBe(false);
  });
});