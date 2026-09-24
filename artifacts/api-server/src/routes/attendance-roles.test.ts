import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [
    { id: 101, school_id: 1, schoolId: 1, student_id: 11, studentId: 11, employee_id: null, employeeId: null, device_id: 51, deviceId: 51, school_class_id: 21, event_type: "SCHOOL_ENTRY", eventType: "SCHOOL_ENTRY", identification_method: "NFC", identificationMethod: "NFC", attendance_status: "PRESENT", status: "PRESENT", result: "ACCEPTED", event_date: "2025-02-03", occurred_at: "2025-02-03T08:00:00.000Z", occurredAt: "2025-02-03T08:00:00.000Z", created_at: "2025-02-03T08:00:00.000Z", createdAt: "2025-02-03T08:00:00.000Z" },
    { id: 202, school_id: 2, schoolId: 2, student_id: 22, studentId: 22, employee_id: null, employeeId: null, device_id: 52, deviceId: 52, school_class_id: 22, event_type: "SCHOOL_ENTRY", eventType: "SCHOOL_ENTRY", identification_method: "NFC", identificationMethod: "NFC", attendance_status: "LATE", status: "LATE", result: "ACCEPTED", event_date: "2025-02-03", occurred_at: "2025-02-03T08:15:00.000Z", occurredAt: "2025-02-03T08:15:00.000Z", created_at: "2025-02-03T08:15:00.000Z", createdAt: "2025-02-03T08:15:00.000Z" },
  ] as Array<Record<string, any>>,
  corrections: [] as unknown[][],
  policies: [{ schoolId: 1, studentId: 11, policy: "NFC_ONLY" }],
  enrollments: [] as Array<Record<string, any>>,
  nextEventId: 301,
}));

const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (sql.includes("FROM students WHERE id=$1 AND school_id=$2")) {
      return result(([{ id: 11, school_id: 1 }, { id: 22, school_id: 2 }]).filter(x => x.id === Number(values[0]) && x.school_id === Number(values[1])));
    }
    if (sql.includes("FROM teacher_class_assignments")) {
      const match = sql.includes("a.student_id=$3") ? Number(values[2]) === 11 : Number(values[2]) === 21;
      return result(Number(values[0]) === 30 && Number(values[1]) === 1 && match ? [{ "?column?": 1 }] : []);
    }
    if (sql.includes("FROM employees WHERE id=$1 AND school_id=$2")) return result(values[0] === 31 && values[1] === 1 ? [{ id: 31 }] : []);
    if (sql.includes("FROM attendance_events WHERE school_id=$1 AND student_id=$2")) {
      return result(state.events.filter(e => e.school_id === Number(values[0]) && e.student_id === Number(values[1])));
    }
    if (sql.includes("FROM attendance_events WHERE school_id=$1 AND school_class_id=$2")) {
      return result(state.events.filter(e => e.school_id === Number(values[0]) && e.school_class_id === Number(values[1]) && e.event_date === values[2]));
    }
    if (sql.includes("FROM attendance_events WHERE")) {
      return result(state.events.filter(e => e.school_id === Number(values[0])));
    }
    if (sql.includes("FROM attendance_discrepancies d")) return result([{ id: 401, schoolId: 1, studentId: 11, kind: "EXIT_WITHOUT_ENTRY", status: "OPEN" }]);
    if (sql.includes("SELECT entries")) return result([{ entries: 1, exits: 0, present: 1, absent: 0, late: 0, discrepancies: 0 }]);
    if (sql.includes("FROM nfc_cards WHERE id=$1")) return result(Number(values[0]) === 71 ? [{ school_id: 1 }] : Number(values[0]) === 72 ? [{ school_id: 2 }] : []);
    if (sql.includes("FROM nfc_card_history")) return result([{ id: 1, cardId: Number(values[0]), action: "ISSUED", note: "Original card" }]);
    if (sql.includes("FROM student_identification_policies")) {
      const p = state.policies.find(x => x.schoolId === Number(values[0]) && x.studentId === Number(values[1]));
      return result(p ? [{ policy: p.policy }] : []);
    }
    if (sql.includes("FROM biometric_enrollments")) {
      return result(state.enrollments.filter(x => x.schoolId === Number(values[1]) && x.studentId === Number(values[0])));
    }
    if (sql.includes("INSERT INTO student_identification_policies")) {
      const p = { schoolId: Number(values[0]), studentId: Number(values[1]), policy: String(values[2]) };
      state.policies = state.policies.filter(x => x.studentId !== p.studentId || x.schoolId !== p.schoolId);
      state.policies.push(p);
      return result([{ ...p, status: "ACTIVE", id: 501 }]);
    }
    if (sql.includes("INSERT INTO biometric_enrollments")) {
      const enrollment = { id: 601, provider: values[2], deviceReference: values[3], status: "ACTIVE", enrolledAt: "2025-02-03T09:00:00Z" };
      state.enrollments.push({ ...enrollment, schoolId: Number(values[0]), studentId: Number(values[1]) });
      return result([enrollment]);
    }
    if (sql.startsWith("WITH missing AS")) return result();
    throw new Error(`Unhandled pool query: ${sql}`);
  });
  const client = {
    query: vi.fn(async (sql: string, values: any[] = []) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("SELECT id,school_id,attendance_status FROM attendance_events")) {
        const id = Number(values[0]);
        const event = state.events.find(e => e.id === id);
        return result(event ? [{ id: event.id, school_id: event.school_id, attendance_status: event.attendance_status }] : []);
      }
      if (sql.includes("INSERT INTO attendance_events")) {
        const event = { id: state.nextEventId++, school_id: Number(values[0]), schoolId: Number(values[0]), student_id: Number(values[1]), studentId: Number(values[1]), employee_id: values[2], employeeId: values[2], school_class_id: null, event_type: values[3], eventType: values[3], identification_method: "MANUAL", identificationMethod: "MANUAL", attendance_status: values[4], status: values[4], result: "ACCEPTED", occurred_at: values[6], occurredAt: values[6], created_at: values[6], createdAt: values[6] };
        state.events.push(event);
        return result([event]);
      }
      if (sql.includes("UPDATE attendance_events SET attendance_status")) {
        const event = state.events.find(e => e.id === Number(values[1]));
        if (event) { event.attendance_status = values[0]; event.status = values[0]; }
        return result(event ? [event] : []);
      }
      if (sql.includes("INSERT INTO attendance_corrections")) { state.corrections.push(values); return result(); }
      if (sql.includes("INSERT INTO audit_logs")) return result();
      throw new Error(`Unhandled client query: ${sql}`);
    }),
    release: vi.fn(),
  };
  return { query, connect: vi.fn(async () => client), client };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? "SCHOOL_ADMIN") as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : 1;
      (req as any).edupulseUser = {
        user: { id: role === "TEACHER" ? 30 : 10, clerkUserId: `test-${role}`, email: `${role.toLowerCase()}@example.test`, firstName: role, lastName: "Tester", phone: null, status: "ACTIVE" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import attendanceRouter from "./attendance";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(attendanceRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
  return res.status(500).json({ error: String(error) });
});

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  state.corrections.length = 0;
  state.events = state.events.filter(e => e.id === 101 || e.id === 202);
  state.policies = [{ schoolId: 1, studentId: 11, policy: "NFC_ONLY" }];
  state.enrollments.length = 0;
  state.nextEventId = 301;
});

async function call(path: string, role: string, method = "GET", body?: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-role": role },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Phase 5 attendance route role matrix", () => {
  it("limits events, today, and discrepancies to authorized school roles", async () => {
    for (const role of ["SCHOOL_ADMIN", "STAFF"]) {
      expect((await call("/school/attendance/events?schoolId=1", role)).status).toBe(200);
      expect((await call("/school/attendance/today?schoolId=1&date=2025-02-03", role)).status).toBe(200);
      expect((await call("/school/attendance/discrepancies?schoolId=1&from=2025-02-03", role)).status).toBe(200);
      expect((await call("/school/attendance/events?schoolId=2", role)).status).toBe(404);
    }
    expect((await call("/school/attendance/events?schoolId=1", "PLATFORM_OWNER")).status).toBe(200);
    expect((await call("/school/attendance/events?schoolId=2", "PLATFORM_OWNER")).status).toBe(200);
    for (const role of ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "PARTNER"]) {
      expect([403, 404]).toContain((await call("/school/attendance/events?schoolId=1", role)).status);
      expect([403, 404]).toContain((await call("/school/attendance/today?schoolId=1&date=2025-02-03", role)).status);
      expect([403, 404]).toContain((await call("/school/attendance/discrepancies?schoolId=1&from=2025-02-03", role)).status);
    }
    expect((await call("/school/attendance/today?schoolId=2&date=2025-02-03", "SCHOOL_ADMIN")).status).toBe(404);
  });

  it("constrains class and student reports to assigned teachers and the same school", async () => {
    expect((await call("/school/attendance/students/11?schoolId=1", "TEACHER")).status).toBe(200);
    expect((await call("/school/attendance/classes/21?schoolId=1&date=2025-02-03", "TEACHER")).status).toBe(200);
    expect((await call("/school/attendance/students/22?schoolId=1", "TEACHER")).status).toBe(404);
    expect((await call("/school/attendance/classes/22?schoolId=1&date=2025-02-03", "TEACHER")).status).toBe(404);
    expect((await call("/school/attendance/students/22?schoolId=2", "SCHOOL_ADMIN")).status).toBe(404);
    for (const role of ["SCHOOL_ADMIN", "STAFF", "PLATFORM_OWNER"]) {
      expect((await call("/school/attendance/students/11?schoolId=1", role)).status).toBe(200);
      expect((await call("/school/attendance/classes/21?schoolId=1&date=2025-02-03", role)).status).toBe(200);
    }
    for (const role of ["ACCOUNTANT", "PARENT", "STUDENT", "PARTNER"]) {
      expect([403, 404]).toContain((await call("/school/attendance/students/11?schoolId=1", role)).status);
    }
  });

  it("allows manual attendance only to school admins and staff", async () => {
    const body = { schoolId: 1, studentId: 11, eventType: "SCHOOL_ENTRY", occurredAt: "2025-02-03T08:30:00Z", status: "LATE", reason: "Late arrival" };
    expect((await call("/school/attendance/manual", "SCHOOL_ADMIN", "POST", body)).status).toBe(201);
    expect((await call("/school/attendance/manual", "STAFF", "POST", body)).status).toBe(201);
    expect((await call("/school/attendance/manual", "PLATFORM_OWNER", "POST", body)).status).toBe(201);
    expect((await call("/school/attendance/manual", "SCHOOL_ADMIN", "POST", { ...body, schoolId: 2 })).status).toBe(404);
    for (const role of ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "PARTNER"]) {
      expect([403, 404]).toContain((await call("/school/attendance/manual", role, "POST", body)).status);
    }
  });

  it("restricts event corrections to same-school school administrators", async () => {
    const corrected = await call("/school/attendance/101/correct", "SCHOOL_ADMIN", "POST", { status: "LATE", reason: "Verified late" });
    const correctedBody = await corrected.text();
    expect(corrected.status, correctedBody).toBe(200);
    expect((await call("/school/attendance/101/correct", "STAFF", "POST", { status: "PRESENT", reason: "Verified entry" })).status).toBe(404);
    expect((await call("/school/attendance/202/correct", "SCHOOL_ADMIN", "POST", { status: "PRESENT", reason: "Wrong school" })).status).toBe(404);
    expect((await call("/school/attendance/202/correct", "PLATFORM_OWNER", "POST", { status: "PRESENT", reason: "Owner correction" })).status).toBe(200);
    for (const role of ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "STAFF", "PARTNER"]) {
      expect([403, 404]).toContain((await call("/school/attendance/101/correct", role, "POST", { status: "PRESENT", reason: "Denied correction" })).status);
    }
  });

  it("protects identification policy, biometric enrollment, and NFC history by role and tenant", async () => {
    expect((await call("/school/students/11/identification-policy", "SCHOOL_ADMIN", "PUT", { schoolId: 1, policy: "BIOMETRIC_ONLY" })).status).toBe(200);
    expect((await call("/school/students/11/identification-policy", "STAFF", "PUT", { schoolId: 1, policy: "MANUAL_FALLBACK" })).status).toBe(200);
    expect((await call("/students/11/identification-methods?schoolId=1", "STAFF", "POST", { policy: "NFC_AND_BIOMETRIC" })).status).toBe(200);
    expect((await call("/students/11/identification-methods?schoolId=1", "SCHOOL_ADMIN")).status).toBe(200);
    expect((await call("/students/11/biometric-enrollments?schoolId=1", "SCHOOL_ADMIN", "POST", { provider: "vendor", enrollmentReference: "enroll-11" })).status).toBe(201);
    expect((await call("/students/11/biometric-enrollments?schoolId=1", "STAFF", "POST", { provider: "vendor", enrollmentReference: "enroll-11" })).status).toBe(404);
    expect((await call("/cards/71/history", "STAFF")).status).toBe(200);
    expect((await call("/cards/72/history", "SCHOOL_ADMIN")).status).toBe(404);
    for (const role of ["TEACHER", "ACCOUNTANT", "PARENT", "STUDENT", "PARTNER"]) {
      expect([403, 404]).toContain((await call("/students/11/identification-methods?schoolId=1", role)).status);
      expect([403, 404]).toContain((await call("/cards/71/history", role)).status);
    }
    expect((await call("/students/11/identification-methods?schoolId=2", "SCHOOL_ADMIN")).status).toBe(404);
  });
});