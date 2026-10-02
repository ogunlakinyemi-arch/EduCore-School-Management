import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  clientCalls: [] as Array<{ sql: string; values: unknown[] }>,
  roles: [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }],
  potentialDuplicate: false,
  failAdmissionNo: "",
  parentStudentExists: false,
  generatedAdmissions: [] as string[],
}));

const clientMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.clientCalls.push({ sql, values });
    if (sql.includes("COALESCE(MAX((substring(admission_no FROM $2))::bigint)")) {
      const sequence = Math.max(0, ...state.generatedAdmissions
        .map(value => Number(value.match(/^ADM-1-(\d+)$/)?.[1] ?? 0)));
      return { rows: [{ sequence }] };
    }
    if (sql.includes("INSERT INTO students")) {
      if (values[1] === state.failAdmissionNo) throw new Error("synthetic row insert failure");
      state.generatedAdmissions.push(String(values[1]));
      return { rows: [{ id: 901 }] };
    }
    if (sql.includes("INSERT INTO parents")) return { rows: [{ id: 902 }] };
    if (sql.includes("SELECT id FROM students")) {
      return { rows: state.parentStudentExists ? [{ id: 901 }] : [] };
    }
    return { rows: [] };
  }),
  release: vi.fn(),
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM school_classes")) return { rows: [{ id: 10, name: "Primary 5", section: "Emerald" }] };
    if (sql.includes("SELECT admission_no AS \"admissionNo\"") && sql.includes("FROM students")) {
      return {
        rows: state.potentialDuplicate
          ? [{ admissionNo: "A-OLD", firstName: "Ada", lastName: "Okafor", dateOfBirth: "2015-01-01" }]
          : [],
      };
    }
    if (sql.includes("SELECT admission_no FROM students")) {
      return { rows: state.parentStudentExists ? [{ admission_no: "A-100" }] : [] };
    }
    return { rows: [] };
  }),
  connect: vi.fn((callback: (error: Error | undefined, client: typeof clientMock) => void) => {
    callback(undefined, clientMock);
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string, public readonly eventType = "ACCESS_DENIED") {
      super(message);
    }
  }
  return {
    AuthError,
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      const context = (req as any).edupulseUser;
      if (!context.roles.some((item: any) =>
        item.status === "ACTIVE" && item.schoolId === schoolId && roles.includes(item.role))) {
        throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
    },
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.eventType }),
    requireAuthentication: () => (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const schoolId = role === "PLATFORM_OWNER" ? null : 1;
      (req as any).edupulseUser = {
        user: {
          id: 42,
          clerkUserId: "clerk-test-42",
          email: "admin@example.test",
          firstName: "Test",
          lastName: "Admin",
          status: "ACTIVE",
        },
        roles: role === "SCHOOL_ADMIN" ? state.roles : [{ role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import peopleImportsRouter from "./people-imports";

const app = express();
app.use(express.json());
app.use(peopleImportsRouter);
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
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.calls.length = 0;
  state.clientCalls.length = 0;
  state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.potentialDuplicate = false;
  state.failAdmissionNo = "";
  state.parentStudentExists = false;
  state.generatedAdmissions = [];
  poolMock.query.mockClear();
  clientMock.query.mockClear();
  clientMock.release.mockClear();
  poolMock.connect.mockClear();
});

async function call(path: string, init: RequestInit = {}, role = "SCHOOL_ADMIN") {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-test-role": role },
  });
}

function studentUpload(mapping: Record<string, string> = {
  admissionNo: "Admission No",
  firstName: "First Name",
  lastName: "Last Name",
  gender: "Gender",
  className: "Class",
  section: "Section",
  dateOfBirth: "Date of Birth",
}) {
  const form = new FormData();
  form.set("kind", "students");
  form.set("mapping", JSON.stringify(mapping));
  form.set("classMapping", JSON.stringify({ "Primary 5 / Emerald": 10 }));
  form.set("file", new Blob([
    "Admission No,First Name,Last Name,Gender,Class,Section,Date of Birth\r\nA-100,Ada,Okafor,female,Primary 5,Emerald,2015-01-01\r\n",
  ], { type: "text/csv" }), "students.csv");
  return form;
}

describe("school-admin people import routes", () => {
  it("denies teachers and platform owners even when they choose an existing school ID", async () => {
    const teacher = await call("/people/imports/classes?schoolId=1", {}, "TEACHER");
    expect(teacher.status).toBe(403);
    const owner = await call("/people/imports/classes?schoolId=1", {}, "PLATFORM_OWNER");
    expect(owner.status).toBe(403);
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it("denies platform-owner requests to preview and confirm school people imports before database access", async () => {
    const preview = await call("/people/imports/preview?schoolId=1", {
      method: "POST",
      body: studentUpload(),
    }, "PLATFORM_OWNER");
    const confirm = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: "a".repeat(43), selectedRows: [0] }),
    }, "PLATFORM_OWNER");

    expect([preview.status, confirm.status]).toEqual([403, 403]);
    expect(poolMock.query).not.toHaveBeenCalled();
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it("rejects a school ID that is not an active School Administrator membership", async () => {
    const response = await call("/people/imports/classes?schoolId=2");
    expect(response.status).toBe(404);
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it("previews records without writing them and validates against the authenticated school", async () => {
    const response = await call("/people/imports/preview?schoolId=1", {
      method: "POST",
      body: studentUpload(),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.detected).toBe(1);
    expect(body.counts.ready).toBe(1);
    expect(body.rows[0].values.className).toBe("Primary 5");
    expect(body.rows[0].values.section).toBe("Emerald");
    expect(state.calls.every(({ sql }) => !/INSERT\s+INTO\s+(students|parents|employees)/i.test(sql))).toBe(true);
    expect(state.calls.every(({ values }) => !values.includes(2))).toBe(true);
  });

  it("does not accept uploaded school or role values as mapping targets", async () => {
    const response = await call("/people/imports/preview?schoolId=1", {
      method: "POST",
      body: studentUpload({
        admissionNo: "Admission No",
        firstName: "First Name",
        lastName: "Last Name",
        gender: "Gender",
        className: "Class",
        section: "Section",
        schoolId: "Admission No",
      }),
    });
    expect(response.status).toBe(400);
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it("requires a one-time preview from the same admin and records a row-scoped import audit", async () => {
    const previewResponse = await call("/people/imports/preview?schoolId=1", {
      method: "POST",
      body: studentUpload(),
    });
    const preview = await previewResponse.json() as any;
    const confirmation = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewId: preview.previewId,
        selectedRows: [0],
        includePotentialDuplicates: false,
      }),
    });
    expect(confirmation.status).toBe(200);
    expect(await confirmation.json()).toMatchObject({ detected: 1, imported: 1, skipped: 0, failed: 0 });
    expect(state.clientCalls[0].sql).toBe("BEGIN");
    expect(state.clientCalls.some(({ sql }) => sql.includes("SAVEPOINT import_row_0"))).toBe(true);
    expect(state.clientCalls.some(({ sql }) => sql.includes("INSERT INTO students"))).toBe(true);
    expect(state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO students"))?.values[1]).toBe("A-100");
    const audit = state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(audit).toBeDefined();
    expect(audit?.values[4]).toContain("1 imported, 0 skipped, 0 failed");
      expect(JSON.parse(String(audit?.values[6]))).toMatchObject({
      fileName: "students.csv",
      importType: "students",
      recordsDetected: 1,
      recordsImported: 1,
      recordsSkipped: 0,
      recordsFailed: 0,
    });
    const reused = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0] }),
    });
    expect(reused.status).toBe(404);
  });

  it("previews generated-versus-preserved admission numbers and generates missing numbers in the import transaction", async () => {
    const form = studentUpload({
      firstName: "First Name",
      lastName: "Last Name",
      gender: "Gender",
      className: "Class",
      section: "Section",
    });
    form.set("file", new Blob([
      "Admission No,First Name,Last Name,Gender,Class,Section\r\n,Ada,Okafor,female,Primary 5,Emerald\r\n",
    ], { type: "text/csv" }), "students.csv");
    const previewResponse = await call("/people/imports/preview?schoolId=1", { method: "POST", body: form });
    const preview = await previewResponse.json() as any;
    expect(preview.rows[0].values).toMatchObject({ admissionNo: null, admissionNoSource: "GENERATED" });
    const confirmation = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0] }),
    });
    expect(confirmation.status).toBe(200);
    expect(state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO students"))?.values[1]).toBe("ADM-1-000001");
  });

  it("persists the student status that was reviewed instead of activating every imported student", async () => {
    const form = studentUpload({
      admissionNo: "Admission No",
      firstName: "First Name",
      lastName: "Last Name",
      gender: "Gender",
      className: "Class",
      section: "Section",
      dateOfBirth: "Date of Birth",
      status: "Status",
    });
    form.set("file", new Blob([
      "Admission No,First Name,Last Name,Gender,Class,Section,Date of Birth,Status\r\n" +
      "A-101,Ada,Okafor,female,Primary 5,Emerald,2015-01-01,INACTIVE\r\n",
    ], { type: "text/csv" }), "students.csv");
    const previewResponse = await call("/people/imports/preview?schoolId=1", { method: "POST", body: form });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as any;
    expect(preview.rows[0].values.status).toBe("INACTIVE");
    const confirmation = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0] }),
    });
    expect(confirmation.status).toBe(200);
    const inserted = state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO students"));
    expect(inserted?.values).toContain("INACTIVE");
  });

  it("requires a separate explicit choice before importing a potential duplicate", async () => {
    state.potentialDuplicate = true;
    const previewResponse = await call("/people/imports/preview?schoolId=1", {
      method: "POST",
      body: studentUpload(),
    });
    const preview = await previewResponse.json() as any;
    const denied = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0] }),
    });
    expect(denied.status).toBe(400);
    const accepted = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0], includePotentialDuplicates: true }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ imported: 1 });
  });

  it("isolates row-level database errors and records partial results without rolling back good rows", async () => {
    state.failAdmissionNo = "A-FAIL";
    const form = new FormData();
    form.set("kind", "students");
    form.set("mapping", JSON.stringify({
      admissionNo: "Admission No",
      firstName: "First Name",
      lastName: "Last Name",
      gender: "Gender",
      className: "Class",
      section: "Section",
    }));
    form.set("classMapping", JSON.stringify({ "Primary 5 / Emerald": 10 }));
    form.set("file", new Blob([
      "Admission No,First Name,Last Name,Gender,Class,Section\r\nA-GOOD,Ada,Okafor,female,Primary 5,Emerald\r\nA-FAIL,Tolu,Ayo,female,Primary 5,Emerald\r\n",
    ], { type: "text/csv" }), "mixed.csv");
    const previewResponse = await call("/people/imports/preview?schoolId=1", { method: "POST", body: form });
    const preview = await previewResponse.json() as any;
    const response = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0, 1] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ detected: 2, imported: 1, skipped: 0, failed: 1 });
    expect(state.clientCalls.some(({ sql }) => sql.includes("ROLLBACK TO SAVEPOINT import_row_1"))).toBe(true);
    expect(state.clientCalls.some(({ sql }) => sql === "COMMIT")).toBe(true);
    const audit = state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(audit?.values[4]).toContain("1 imported, 0 skipped, 1 failed");
  });

  it("validates parent-to-student links inside the selected school and creates the relationship on confirmation", async () => {
    state.parentStudentExists = true;
    const form = new FormData();
    form.set("kind", "parents");
    form.set("mapping", JSON.stringify({
      name: "Parent Name",
      email: "Email",
      phone: "Phone",
      admissionNo: "Student Admission",
      relationshipType: "Relationship",
    }));
    form.set("file", new Blob([
      "Parent Name,Email,Phone,Student Admission,Relationship\r\nGrace Okafor,grace@example.test,08012345678,A-100,Mother\r\n",
    ], { type: "text/csv" }), "parents.csv");
    const previewResponse = await call("/people/imports/preview?schoolId=1", { method: "POST", body: form });
    const preview = await previewResponse.json() as any;
    expect(preview.rows[0].status).toBe("READY");
    const response = await call("/people/imports/confirm?schoolId=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: preview.previewId, selectedRows: [0] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1 });
    expect(state.clientCalls.some(({ sql }) => sql.includes("INSERT INTO parents"))).toBe(true);
    const relationship = state.clientCalls.find(({ sql }) => sql.includes("INSERT INTO parent_student_relationships"));
    expect(relationship?.values).toEqual([902, 901, "Mother"]);

    state.parentStudentExists = false;
    const invalidForm = new FormData();
    invalidForm.set("kind", "parents");
    invalidForm.set("mapping", JSON.stringify({
      name: "Parent Name", email: "Email", phone: "Phone", admissionNo: "Student Admission",
    }));
    invalidForm.set("file", new Blob([
      "Parent Name,Email,Phone,Student Admission\r\nOther Parent,other@example.test,08012345678,A-404\r\n",
    ], { type: "text/csv" }), "invalid-parent.csv");
    const invalidPreview = await call("/people/imports/preview?schoolId=1", { method: "POST", body: invalidForm });
    expect((await invalidPreview.json() as any).rows[0].errors[0].message).toContain("No student");
  });
});