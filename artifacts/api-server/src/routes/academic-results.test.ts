import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  transactions: [] as string[],
  auditCount: 0,
  resultExists: false,
  published: false,
  reportCard: {
    id: 80, schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
    studentClassAssignmentId: 12, classId: 5, className: "JSS2", section: "Blue",
    status: "DRAFT", publishedBy: null, publishedAt: null,
  } as Record<string, any>,
  snapshotLine: {
    id: 95, subjectId: 7, subjectName: "Mathematics", assessmentName: "Term Test",
    score: "18", maxScore: "20", grade: "A", gradePoint: "4", remark: "Excellent",
  },
}));
const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const respond = async (sql: string, values: any[] = []) => {
    state.queries.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      state.transactions.push(sql);
      return result();
    }
    if (sql.includes("FROM academic_assessments a")) {
      return result([{ id: 21, school_id: 1, academic_session_id: 3, academic_term_id: 4,
        school_class_id: 5, section: "Blue", subject_id: 7, teacher_employee_id: 8, max_score: "20", status: "OPEN" }]);
    }
    if (sql.includes("FROM student_class_assignments sca") && sql.includes("JOIN students")) {
      return result([{ id: 12, section: "Blue" }]);
    }
    if (sql.includes("FROM employees e")) return result([{ id: 8 }]);
    if (sql.includes("FROM employees WHERE")) return result([{ id: 8 }]);
    if (sql.includes("FROM academic_results WHERE school_id=$1 AND assessment_id=$2")) {
      return result(state.resultExists ? [{ id: 55 }] : []);
    }
    if (sql.includes("FROM academic_grading_rules")) {
      return result([{ min_score: "80", max_score: "100", grade: "A", grade_point: "4", remark: "Excellent" }]);
    }
    if (sql.includes("INSERT INTO academic_results")) {
      state.resultExists = true;
      return result([{ id: 55, schoolId: 1, assessmentId: 21, studentId: 13, score: "18", maxScore: "20", grade: "A", status: "DRAFT" }]);
    }
    if (sql.includes("SELECT id FROM academic_assessments")) {
      return result([{ id: 21 }]);
    }
    if (sql.includes("FROM academic_report_cards WHERE id=$1 AND school_id=$2 FOR UPDATE")) {
      return result([{ id: 80, student_id: 13, academic_session_id: 3, academic_term_id: 4, student_class_assignment_id: 12, status: "DRAFT" }]);
    }
    if (sql.includes("UPDATE academic_report_cards SET status='PUBLISHED'")) {
      state.reportCard = { ...state.reportCard, status: "PUBLISHED", publishedBy: 10, publishedAt: "2025-02-03T09:00:00.000Z" };
      return result([{ ...state.reportCard }]);
    }
    if (sql.includes("UPDATE academic_results SET status='PUBLISHED'")) {
      state.published = true;
      return result([{ id: 55, schoolId: 1, assessmentId: 21, studentId: 13, status: "PUBLISHED" }]);
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      state.auditCount += 1;
      return result();
    }
    if (sql.includes("FROM student_class_assignments sca JOIN school_classes")) {
      return result([{ id: 12, school_class_id: 5, section: "Blue", class_name: "JSS2" }]);
    }
    if (sql.includes("INSERT INTO academic_report_cards")) {
      return result([{ ...state.reportCard }]);
    }
    if (sql.includes("INSERT INTO academic_report_card_lines")) return result();
    if (sql.includes("FROM academic_report_card_lines")) return result([{ ...state.snapshotLine }]);
    if (sql.includes("count(*)::int AS count FROM academic_results")) return result([{ count: 0 }]);
    throw new Error(`Unhandled test SQL: ${sql}`);
  };
  const client = {
    query: vi.fn(respond),
    release: vi.fn(),
  };
  return {
    client,
    query: vi.fn(respond),
    connect: vi.fn(async () => client),
  };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? "SCHOOL_ADMIN") as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1);
      (req as any).edupulseUser = {
        user: { id: 10, clerkUserId: "clerk_test", email: "admin@example.test", firstName: "Test", lastName: "Admin", phone: null, status: "ACTIVE" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import academicResultsRouter, { gradeFor } from "./academic-results";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(academicResultsRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ error: error.message, code: error.eventType });
    return;
  }
  res.status(500).json({ error: String(error) });
});
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
beforeEach(() => {
  state.queries = [];
  state.transactions = [];
  state.auditCount = 0;
  state.resultExists = false;
  state.published = false;
  state.reportCard = {
    id: 80, schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
    studentClassAssignmentId: 12, classId: 5, className: "JSS2", section: "Blue",
    status: "DRAFT", publishedBy: null, publishedAt: null,
  };
  poolMock.client.query.mockClear();
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});
async function post(path: string, body: Record<string, unknown>, role = "SCHOOL_ADMIN", school = 1) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-role": role, "x-test-school": String(school) },
    body: JSON.stringify(body),
  });
}

describe("academic result and report-card operations", () => {
  it("calculates deterministic grades from normalized score percentages", () => {
    const rules = [
      { min_score: "80", max_score: "100", grade: "A", grade_point: "4", remark: "Excellent" },
      { min_score: "0", max_score: "79.99", grade: "F", grade_point: "0", remark: "Needs work" },
    ];
    expect(gradeFor(16, 20, rules)).toEqual({ grade: "A", gradePoint: "4", remark: "Excellent" });
    expect(gradeFor(15, 20, rules)).toEqual({ grade: "F", gradePoint: "0", remark: "Needs work" });
  });

  it("rejects scores above the assessment maximum before writing", async () => {
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 21 });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("cannot exceed");
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO academic_results"))).toBe(false);
  });

  it("rejects duplicate student-assessment results without a second insert", async () => {
    state.resultExists = true;
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 18 });
    expect(response.status).toBe(409);
    expect(state.queries.filter(({ sql }) => sql.includes("INSERT INTO academic_results"))).toHaveLength(0);
    expect(state.transactions).toContain("ROLLBACK");
  });

  it("hides cross-school resources as not found", async () => {
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 18 }, "SCHOOL_ADMIN", 2);
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("publishes results atomically and writes an audit record", async () => {
    const response = await post("/academic/assessments/21/publish-results", { schoolId: 1 });
    expect(response.status).toBe(200);
    expect(state.published).toBe(true);
    expect(state.transactions).toEqual(["BEGIN", "COMMIT"]);
    expect(state.auditCount).toBe(1);
    expect((await response.json() as { publishedCount: number }).publishedCount).toBe(1);
  });

  it("builds report-card lines only from published results and snapshots context", async () => {
    const response = await post("/academic/report-cards", {
      schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
      teacherRemark: "Steady progress", schoolRemark: "Promoted",
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      className: "JSS2", section: "Blue", status: "DRAFT", publishedBy: null, publishedAt: null, resultState: "COMPLETE",
      lines: [{ subjectName: "Mathematics", assessmentName: "Term Test", score: "18" }],
    });
    const draftInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO academic_report_cards"));
    expect(draftInsert?.sql).toContain("'DRAFT',$9,$10,NULL,NULL");
    const snapshotQuery = state.queries.find(({ sql }) => sql.includes("INSERT INTO academic_report_card_lines"));
    expect(snapshotQuery?.sql).toContain("r.status='PUBLISHED'");
    expect(snapshotQuery?.sql).toContain("r.student_class_assignment_id=$6");
    expect(state.auditCount).toBe(1);
  });

  it("sets report-card publisher and timestamp only when publishing", async () => {
    const response = await post("/academic/report-cards/80/publish", { schoolId: 1 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "PUBLISHED", publishedBy: 10, publishedAt: "2025-02-03T09:00:00.000Z",
    });
    expect(state.transactions).toEqual(["BEGIN", "COMMIT"]);
    expect(state.auditCount).toBe(1);
  });
});