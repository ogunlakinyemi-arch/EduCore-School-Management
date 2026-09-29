import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
  insertedStudentIds: [] as number[],
  invoiceSnapshots: [] as Array<{ studentId: number; className: string; section: string }>,
  invoices: new Map<number, number>(),
  auditCount: 0,
}));

const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const cohort = [
    {
      id: 31, first_name: "Moved", last_name: "Student", admission_no: "A31",
      class_name: "Year 6", section: "B",
      classAssignments: [{
        sessionId: 2, termId: 3, classId: 4, className: "Year 4", section: "A",
        status: "INACTIVE", startDate: "2026-09-01", endDate: "2026-12-01",
      }],
    },
    {
      id: 32, first_name: "Wrong", last_name: "Term", admission_no: "B32",
      class_name: "Year 4", section: "A",
      classAssignments: [{
        sessionId: 2, termId: 5, classId: 4, className: "Year 4", section: "A",
        status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-12-01",
      }],
    },
    {
      id: 33, first_name: "Wrong", last_name: "Class", admission_no: "C33",
      class_name: "Year 4", section: "A",
      classAssignments: [{
        sessionId: 2, termId: 3, classId: 5, className: "Year 5", section: "A",
        status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-12-01",
      }],
    },
    {
      id: 34, first_name: "Wrong", last_name: "Section", admission_no: "D34",
      class_name: "Year 4", section: "A",
      classAssignments: [{
        sessionId: 2, termId: 3, classId: 4, className: "Year 4", section: "B",
        status: "ACTIVE", startDate: "2026-09-01", endDate: "2026-12-01",
      }],
    },
    {
      id: 35, first_name: "Invalid", last_name: "Status", admission_no: "E35",
      class_name: "Year 4", section: "A",
      classAssignments: [{
        sessionId: 2, termId: 3, classId: 4, className: "Year 4", section: "A",
        status: "SUSPENDED", startDate: "2026-09-01", endDate: "2026-12-01",
      }],
    },
    {
      id: 36, first_name: "Existing", last_name: "Invoice", admission_no: "F36",
      class_name: "Year 4", section: "A", classAssignments: [],
    },
  ];
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SAVEPOINT") || sql.startsWith("RELEASE SAVEPOINT")) return result();
    if (sql.includes("FROM fee_structures fs")) {
      return result([{
        id: 7, school_id: 1, academic_session_id: 2, academic_term_id: 3,
        school_class_id: 4, section: "A", term_start_date: "2026-09-01", term_end_date: "2026-12-01",
      }]);
    }
    if (sql.includes("FROM students st") && sql.includes("student_class_assignments")) return result(cohort);
    if (sql.includes("FROM fee_structure_lines")) {
      return result([{
        category_id: 5, category_name_snapshot: "Tuition",
        description_snapshot: "Term tuition", amount_minor: 2500,
      }]);
    }
    if (sql.includes("SELECT id FROM fee_invoices WHERE school_id=$1")) {
      const invoiceId = state.invoices.get(Number(values[1]));
      return result(invoiceId === undefined ? [] : [{ id: invoiceId }]);
    }
    if (sql.includes("INSERT INTO fee_invoices")) {
      const studentId = Number(values[1]);
      const id = 90 + state.insertedStudentIds.length;
      state.insertedStudentIds.push(studentId);
      state.invoices.set(studentId, id);
      state.invoiceSnapshots.push({ studentId, className: String(values[8]), section: String(values[9]) });
      return result([{ id }]);
    }
    if (sql.includes("INSERT INTO fee_invoice_lines")) return result();
    if (sql.includes("INSERT INTO audit_logs")) {
      state.auditCount += 1;
      return result();
    }
    throw new Error(`Unhandled bulk assignment test query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});

vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const schoolId = Number(req.header("x-test-school") ?? 1);
      (req as any).edupulseUser = {
        user: { id: 20, clerkUserId: "bulk-user", email: "bulk@example.test", firstName: "Bulk", lastName: "Admin" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";
const app = express();
app.use(express.json());
app.use(financeRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.calls.length = 0;
  state.insertedStudentIds.length = 0;
  state.invoiceSnapshots.length = 0;
  state.invoices = new Map([[36, 80]]);
  state.auditCount = 0;
  dbMock.query.mockClear();
});

const assign = (
  headers: Record<string, string> = {},
  dates: { issueDate?: string; dueDate?: string } = {},
) => fetch(`${baseUrl}/school/finance/bulk-assignments?schoolId=1`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ structureId: 7, issueDate: "2026-09-01", dueDate: "2026-09-30", ...dates }),
});

describe("bulk fee assignments", () => {
  it("rejects an unauthorized school role before database mutation", async () => {
    const response = await assign({ "x-test-role": "ACCOUNTANT", "x-test-school": "2" });
    expect(response.status).toBe(404);
    expect(state.calls.filter(({ sql }) => !["BEGIN", "ROLLBACK"].includes(sql))).toHaveLength(0);
  });

  it("uses historical session-term-class assignments and reports invalid or mismatched cohort students", async () => {
    const response = await assign();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      createdCount: 1,
      skippedCount: 5,
      results: [
        { studentId: 31, invoiceId: 90, status: "CREATED", reason: null },
        { studentId: 32, invoiceId: null, status: "SKIPPED", reason: "NO_MATCHING_TERM" },
        { studentId: 33, invoiceId: null, status: "SKIPPED", reason: "WRONG_CLASS" },
        { studentId: 34, invoiceId: null, status: "SKIPPED", reason: "WRONG_SECTION" },
        { studentId: 35, invoiceId: null, status: "SKIPPED", reason: "INVALID_ASSIGNMENT_STATUS" },
        { studentId: 36, invoiceId: 80, status: "SKIPPED", reason: "EXISTING_INVOICE" },
      ],
    });
    const eligibilityQuery = state.calls.find(({ sql }) =>
      sql.includes("FROM students st") && sql.includes("student_class_assignments"));
    expect(eligibilityQuery?.sql).toContain("a.school_id=st.school_id");
    expect(eligibilityQuery?.sql).toContain("LOWER(st.status)='active'");
    expect(eligibilityQuery?.sql).toContain("UPPER(st.admission_status)='ADMITTED'");
    expect(eligibilityQuery?.values).toEqual([1]);
    expect(state.insertedStudentIds).toEqual([31]);
    expect(state.invoiceSnapshots).toEqual([{ studentId: 31, className: "Year 4", section: "A" }]);
    expect(state.auditCount).toBe(2);
  });

  it("does not create a second invoice on retry and reports the existing invoice", async () => {
    const first = await assign();
    expect(first.status).toBe(200);
    const retry = await assign();
    expect(retry.status).toBe(200);
    const body = await retry.json() as { results: Array<Record<string, any>> };
    expect(body.results[0]).toMatchObject({
      studentId: 31, invoiceId: 90, status: "SKIPPED", reason: "EXISTING_INVOICE",
    });
    expect(state.insertedStudentIds).toEqual([31]);
  });

  it("rejects issue or due dates outside the selected term", async () => {
    const response = await assign({}, { dueDate: "2027-01-15" });
    expect(response.status).toBe(400);
    expect(state.insertedStudentIds).toHaveLength(0);
    expect(state.auditCount).toBe(0);
  });
});