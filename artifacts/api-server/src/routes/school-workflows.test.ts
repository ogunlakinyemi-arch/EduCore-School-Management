import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  transactionQueries: [] as Array<{ sql: string; values: unknown[] }>,
  roleHeader: "SCHOOL_ADMIN",
  brandingLogo: "/objects/school-logos/1/11111111-1111-4111-8111-111111111111",
  legacyLogo: "https://old-school.example/logo.png",
  calendarRows: [] as Array<Record<string, unknown>>,
  eventRows: [] as Array<Record<string, unknown>>,
  assignmentRows: [] as Array<Record<string, unknown>>,
  priorAssignments: [] as Array<Record<string, unknown>>,
  dutyRows: [] as Array<Record<string, unknown>>,
  generatedSourceKeys: [] as string[],
  generatedInsertSQL: [] as string[],
  overlapConflict: false,
  insertedDutyCount: 0,
  insertedAssignmentCount: 0,
  generatedId: 70,
}));

const dbMock = vi.hoisted(() => {
  const transactionQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.transactionQueries.push({ sql, values });
    if (sql.includes("FROM teacher_subject_assignments") && sql.includes("FOR UPDATE")) {
      return { rows: state.priorAssignments };
    }
    if (sql.includes("academic_sessions") && sql.includes("FROM academic_sessions") && sql.includes("FOR UPDATE")) {
      return {
        rows: [{ id: 4, name: "2025/2026", startDate: "2025-01-01", endDate: "2025-12-31" }],
      };
    }
    if (sql.includes("FROM academic_terms") && sql.includes("FOR UPDATE")) {
      return {
        rows: [{ id: 11, sessionId: 4, name: "First Term", startDate: "2025-01-10", endDate: "2025-04-10" }],
      };
    }
    if (sql.includes("SELECT t.id, t.academic_session_id")) {
      return { rows: [{ id: Number(values[0]), sessionId: 4 }] };
    }
    if (sql.includes("UPPER(e.employee_type)='TEACHER'") ||
      sql.includes("UPPER(employee_type)='TEACHER'")) {
      return { rows: [{ id: Number(values[0]) }] };
    }
    if (sql.includes("start_date <= $4::date AND end_date >= $3::date")) {
      return { rows: state.overlapConflict ? [{ id: 91 }] : [] };
    }
    if (sql.includes("INSERT INTO teacher_class_assignments")) {
      state.insertedAssignmentCount += 1;
      return { rows: [{ id: 51 }] };
    }
    if (sql.includes("INSERT INTO teacher_subject_assignments")) {
      state.insertedAssignmentCount += 1;
      return { rows: [{ id: 52 }] };
    }
    if (sql.includes("INSERT INTO teacher_duty_roster")) {
      state.insertedDutyCount += 1;
      return { rows: [{ id: 61 }] };
    }
    if (sql.includes("INSERT INTO school_calendar_events")) {
      if (sql.includes("'GENERATED'")) {
        state.generatedSourceKeys.push(String(values[3]));
        state.generatedInsertSQL.push(sql);
      }
      return { rows: [{ id: state.generatedId++ }] };
    }
    return { rows: [] };
  });
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("FROM schools s")) {
      return {
        rows: [{
          schoolId: 1,
          name: "Yemait Academy",
          registrationNumber: null,
          address: "1 Main Road",
          city: "Lagos",
          state: "Lagos",
          lga: null,
          phone: null,
          email: null,
          website: null,
          schoolType: null,
          logo: state.legacyLogo,
          managedLogoObjectPath: state.brandingLogo,
        }],
      };
    }
    if (sql.includes("SELECT id FROM schools")) return { rows: [{ id: 1 }] };
    if (sql.includes("WITH calendar AS")) return { rows: state.calendarRows };
    if (sql.includes("FROM school_calendar_events ce")) {
      return { rows: state.eventRows.length ? state.eventRows : [{
        id: Number(values[0]),
        schoolId: 1,
        sessionId: null,
        sessionName: null,
        termId: null,
        termName: null,
        title: "Sports Day",
        category: "SCHOOL_EVENT",
        startDate: "2025-02-01",
        endDate: null,
        academic: false,
        audience: ["TEACHER"],
        status: "ACTIVE",
        source: "SCHOOL_EVENT",
        notes: null,
      }] };
    }
    if (sql.includes('AS "assignmentKind"')) return { rows: state.assignmentRows };
    if (sql.includes('AS "dutyRole"') && sql.includes("FROM teacher_duty_roster d")) {
      return { rows: state.dutyRows };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => {
    return { query: transactionQuery, release: vi.fn() };
  });
  return { query, connect, transactionQuery };
});

vi.mock("@workspace/db", () => ({ pool: dbMock }));

vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(
      public readonly statusCode: number,
      message: string,
      public readonly eventType = "ACCESS_DENIED",
    ) {
      super(message);
    }
  }
  const contextFor = (req: express.Request) => (req as any).schoolWorkflowContext;
  const ownerIsActive = (context: any) => context.roles.some((role: any) =>
    role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE",
  );
  return {
    AuthError,
    getUserContext: contextFor,
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      const context = contextFor(req);
      if (ownerIsActive(context) || !context.roles.some((role: any) =>
        role.status === "ACTIVE" && role.schoolId === schoolId && roles.includes(role.role),
      )) {
        throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      return context;
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({
        error: error.message,
        code: error.eventType ?? "INTERNAL_ERROR",
      }),
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const rawRole = req.header("x-test-role") ?? state.roleHeader;
      const roles = rawRole.split(",").map((role) => role.trim()).filter(Boolean).map((role) => ({
        role,
        schoolId: role === "PLATFORM_OWNER" ? null : 1,
        status: "ACTIVE",
      }));
      (req as any).schoolWorkflowContext = {
        user: {
          id: 42,
          clerkUserId: "clerk-school-workflow-test",
          email: "admin@example.test",
          firstName: "Test",
          lastName: "Admin",
        },
        roles,
      };
      next();
    },
  };
});

import schoolWorkflowsRouter from "./school-workflows";

const app = express();
app.use(express.json());
app.use(schoolWorkflowsRouter);
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
));

beforeEach(() => {
  state.queries = [];
  state.transactionQueries = [];
  state.roleHeader = "SCHOOL_ADMIN";
  state.brandingLogo = "/objects/school-logos/1/11111111-1111-4111-8111-111111111111";
  state.legacyLogo = "https://old-school.example/logo.png";
  state.calendarRows = [];
  state.eventRows = [];
  state.assignmentRows = [];
  state.priorAssignments = [];
  state.dutyRows = [];
  state.generatedSourceKeys = [];
  state.generatedInsertSQL = [];
  state.overlapConflict = false;
  state.insertedDutyCount = 0;
  state.insertedAssignmentCount = 0;
  state.generatedId = 70;
  dbMock.query.mockClear();
  dbMock.connect.mockClear();
  dbMock.transactionQuery.mockClear();
});

async function request(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

describe("school workflow APIs", () => {
  it("returns a same-school private logo route, never its private object path", async () => {
    const response = await request("/schools/1/branding");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.logoUrl).toBe("/api/schools/1/branding/logo");
    expect(JSON.stringify(body)).not.toContain("/objects/school-logos/");
  });

  it("keeps school reads and writes inside their role and tenant boundary", async () => {
    const crossSchoolRead = await request("/schools/2/branding", {
      headers: { "x-test-role": "TEACHER" },
    });
    expect(crossSchoolRead.status).toBe(404);
    const ownerWrite = await request("/schools/1/branding", {
      method: "PUT",
      headers: { "x-test-role": "PLATFORM_OWNER,SCHOOL_ADMIN" },
      body: JSON.stringify({ name: "Not allowed" }),
    });
    expect(ownerWrite.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE schools"))).toBe(false);
    const unsupportedLogo = await request("/schools/1/branding/logo-upload-url", {
      method: "POST",
      body: JSON.stringify({ contentType: "image/svg+xml", size: 64 }),
    });
    expect(unsupportedLogo.status).toBe(400);
  });

  it("rejects impossible academic dates and filters calendar events by active role audience", async () => {
    const invalidDate = await request("/schools/1/academic-calendar?startsOnOrAfter=2025-02-30");
    expect(invalidDate.status).toBe(400);
    const response = await request("/schools/1/academic-calendar?termId=11", {
      headers: { "x-test-role": "PARENT" },
    });
    expect(response.status).toBe(200);
    const calendarQuery = state.queries.find(({ sql }) => sql.includes("WITH calendar AS"));
    expect(calendarQuery?.sql).toContain("audience && $7::text[]");
    expect(calendarQuery?.values).toEqual([1, null, 11, null, null, false, ["PARENT"]]);
  });

  it("projects existing session and term dates without waiting for manual calendar generation", async () => {
    const response = await request("/schools/1/academic-calendar?sessionId=4");
    expect(response.status).toBe(200);
    const query = state.queries.find(({ sql }) => sql.includes("WITH calendar AS"));
    expect(query?.sql).toContain("'SESSION_START:' || ac.id::text");
    expect(query?.sql).toContain("'TERM_START:' || t.id::text");
    expect(query?.sql).toContain("'TERM_END:' || t.id::text");
    expect(query?.sql).toContain("FROM academic_terms t JOIN academic_sessions ac");
  });

  it("creates school calendar events with term ownership and stable generated idempotency keys", async () => {
    const created = await request("/schools/1/academic-calendar", {
      method: "POST",
      body: JSON.stringify({
        termId: 11,
        title: "Science fair",
        category: "SCHOOL_EVENT",
        startDate: "2025-02-10",
        endDate: "2025-02-10",
        academic: true,
        audience: ["STUDENT", "PARENT"],
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json() as Record<string, unknown>).title).toBe("Sports Day");
    expect(state.transactionQueries.some(({ sql }) => sql.includes("INSERT INTO school_calendar_events"))).toBe(true);

    const configuration = JSON.stringify({
      sessionId: 4,
      terms: [{
        termId: 11,
        resumptionDate: "2025-01-10",
        midTermBreaks: [{
          title: "Mid-term break",
          startDate: "2025-02-20",
          endDate: "2025-02-22",
          audience: ["STUDENT"],
        }],
      }],
    });
    const generatedFirst = await request("/schools/1/academic-calendar/generate", {
      method: "POST",
      body: configuration,
    });
    expect(generatedFirst.status).toBe(200);
    const firstKeys = [...state.generatedSourceKeys];
    expect(firstKeys).toEqual([
      "calendar:v1:session:4:term:11:RESUMPTION:0",
      "calendar:v1:session:4:term:11:MID_TERM_BREAK:0",
    ]);
    expect(state.generatedInsertSQL.every((sql) => sql.includes("ON CONFLICT (school_id,source_key)"))).toBe(true);
    state.generatedSourceKeys = [];
    const generatedSecond = await request("/schools/1/academic-calendar/generate", {
      method: "POST",
      body: configuration,
    });
    expect(generatedSecond.status).toBe(200);
    expect(state.generatedSourceKeys).toEqual(firstKeys);
  });

  it("replaces a school-wide subject assignment without losing the former teacher record", async () => {
    state.assignmentRows = [{
      id: 52,
      assignmentKind: "SUBJECT",
      schoolId: 1,
      employeeId: 30,
      employeeName: "New Teacher",
      employeeNo: "T-30",
      employeeType: "TEACHER",
      sessionId: 4,
      sessionName: "2025/2026",
      classId: null,
      className: null,
      subjectId: 8,
      subjectName: "Science",
      section: null,
      assignmentType: "SUBJECT_TEACHER",
      startDate: "2025-01-15",
      endDate: null,
      status: "ACTIVE",
    }];
    const response = await request("/schools/1/teacher-assignments", {
      method: "POST",
      body: JSON.stringify({
        employeeId: 30,
        sessionId: 4,
        subjectId: 8,
        assignmentType: "SUBJECT_TEACHER",
        startDate: "2025-01-15",
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as Record<string, unknown>).assignmentKind).toBe("SUBJECT");
    expect(state.transactionQueries.some(({ sql }) =>
      sql.includes("UPDATE teacher_subject_assignments") &&
      sql.includes("status='INACTIVE'"),
    )).toBe(true);
    expect(state.insertedAssignmentCount).toBe(1);
  });

  it("replaces an assigned teacher through one atomic PATCH without a deactivate-then-create request gap", async () => {
    state.priorAssignments = [{
      sessionId: 4,
      slotId: 8,
      employeeId: 29,
      startDate: "2025-01-15",
      endDate: null,
      status: "ACTIVE",
    }];
    state.assignmentRows = [{
      id: 52,
      assignmentKind: "SUBJECT",
      schoolId: 1,
      employeeId: 30,
      employeeName: "Replacement Teacher",
      employeeNo: "T-30",
      employeeType: "TEACHER",
      sessionId: 4,
      sessionName: "2025/2026",
      classId: null,
      className: null,
      subjectId: 8,
      subjectName: "Science",
      section: null,
      assignmentType: "SUBJECT_TEACHER",
      startDate: "2025-02-01",
      endDate: null,
      status: "ACTIVE",
    }];
    const response = await request("/schools/1/teacher-assignments/SUBJECT/51", {
      method: "PATCH",
      body: JSON.stringify({ employeeId: 30, startDate: "2025-02-01" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json() as Record<string, unknown>)).toMatchObject({
      id: 52,
      employeeId: 30,
      status: "ACTIVE",
    });
    const oldRecordUpdate = state.transactionQueries.findIndex(({ sql }) =>
      sql.includes("UPDATE teacher_subject_assignments") && sql.includes("status='INACTIVE'"),
    );
    const replacementInsert = state.transactionQueries.findIndex(({ sql }) =>
      sql.includes("INSERT INTO teacher_subject_assignments"),
    );
    const commit = state.transactionQueries.findIndex(({ sql }) => sql === "COMMIT");
    expect(oldRecordUpdate).toBeGreaterThan(-1);
    expect(replacementInsert).toBeGreaterThan(oldRecordUpdate);
    expect(commit).toBeGreaterThan(replacementInsert);
    expect(state.transactionQueries.some(({ sql }) =>
      sql.includes("pg_advisory_xact_lock"),
    )).toBe(true);
  });

  it("rejects an overlapping weekly duty and creates a non-overlapping roster entry", async () => {
    state.overlapConflict = true;
    const overlap = await request("/schools/1/duty-roster", {
      method: "POST",
      body: JSON.stringify({
        employeeId: 30,
        dutyRole: "Gate",
        startDate: "2025-03-03",
        endDate: "2025-03-07",
      }),
    });
    expect(overlap.status).toBe(409);
    expect(state.insertedDutyCount).toBe(0);

    state.overlapConflict = false;
    state.dutyRows = [{
      id: 61,
      schoolId: 1,
      employeeId: 30,
      employeeName: "Active Teacher",
      employeeNo: "T-30",
      dutyRole: "Gate",
      startDate: "2025-03-03",
      endDate: "2025-03-07",
      status: "ACTIVE",
      notes: null,
    }];
    const created = await request("/schools/1/duty-roster", {
      method: "POST",
      body: JSON.stringify({
        employeeId: 30,
        dutyRole: "Gate",
        startDate: "2025-03-03",
        endDate: "2025-03-07",
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json() as Record<string, unknown>).employeeId).toBe(30);
    expect(state.insertedDutyCount).toBe(1);
    expect(state.transactionQueries.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("never accepts a logo object path issued for another school", async () => {
    const response = await request("/schools/1/branding/logo", {
      method: "PUT",
      body: JSON.stringify({
        objectPath: "/objects/school-logos/2/11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(response.status).toBe(400);
    expect(state.transactionQueries.some(({ sql }) => sql.includes("school_branding_logos"))).toBe(false);
  });
});