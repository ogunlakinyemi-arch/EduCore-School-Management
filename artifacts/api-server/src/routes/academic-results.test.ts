import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  transactions: [] as string[],
  auditCount: 0,
  resultExists: false,
  published: false,
  resultStatus: "DRAFT",
  reviewStatus: "NOT_REVIEWED",
  parentChildAuthorized: true,
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
    if(sql.includes('school_class_id AS "classId",COALESCE(')) return result([]);
    if(sql.includes("FROM academic_result_batches")) return result([]);
    if(sql.includes("WITH days AS")) return result([{present:0,late:0,absent:0,total:0}]);
    if(sql.includes("FROM academic_terms t JOIN academic_sessions s")) return result([{id:4}]);
    if(sql.includes("WITH chosen AS")) return result([{id:13,firstName:"QA",lastName:"Student",admissionNo:"QA-13",classId:5,className:"JSS2",section:"Blue",studentClassAssignmentId:12}]);
    if(sql.includes("SELECT DISTINCT ON (cs.subject_id)")) return result([{subjectId:7,subjectName:"Mathematics",teacherName:"QA Teacher"}]);
    if(sql.includes("concat_ws")&&sql.includes("FROM academic_results r")) return result([{id:55,subjectId:7,score:18,maxScore:20,grade:"A",status:state.resultStatus,reviewStatus:state.reviewStatus,teacherName:"QA Teacher"}]);
    if(sql.includes("pg_advisory_xact_lock")) return result();
    if(sql.includes("FROM academic_report_cards")&&sql.includes("academic_session_id=$3")) return result([]);
    if(sql.includes("FROM audit_logs")&&sql.includes("Approved academic report card")) return result([{id:1}]);
    if(sql.includes("AND grade IS NOT NULL AND grade_point IS NOT NULL AND remark IS NOT NULL")) return result([{count:1}]);
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
    if (sql.includes("FROM parents WHERE user_id=$1 AND school_id=$2")) return result([{ id: 5 }]);
    if (sql.includes("FROM students WHERE user_id=$1 AND school_id=$2")) return result([{ id: 13 }]);
    if (sql.includes("FROM parents p JOIN parent_student_relationships")) {
      return result(state.parentChildAuthorized ? [{ id: 1 }] : []);
    }
    if (sql.includes("count(*)::int AS count FROM academic_results")) return result([{ count: 0 }]);
    if (sql.includes("FROM academic_results r")) {
      return result([{ id: 55, schoolId: 1, studentId: 13, status: "PUBLISHED" }]);
    }
    if (sql.includes("FROM academic_results WHERE id=$1 AND school_id=$2 FOR UPDATE")) {
      return result([{ id: 55, teacher_employee_id: 8, status: state.resultStatus, review_status: state.reviewStatus }]);
    }
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
    if (sql.includes("UPDATE academic_results SET status='SUBMITTED'")) {
      state.resultStatus = "SUBMITTED";
      state.reviewStatus = "NOT_REVIEWED";
      return result([{ id: 55, schoolId: 1, status: "SUBMITTED" }]);
    }
    if (sql.includes("UPDATE academic_results") && sql.includes("review_status=CASE")) {
      const decision = String(values[0]);
      state.resultStatus = decision === "RETURN" ? "DRAFT" : "SUBMITTED";
      state.reviewStatus = decision === "RETURN" ? "RETURNED" : "APPROVED";
      return result([{ id: 55, schoolId: 1, status: state.resultStatus }]);
    }
    if (sql.includes("UPDATE academic_results SET status='PUBLISHED'")) {
      if (state.resultStatus === "SUBMITTED" && state.reviewStatus === "APPROVED" && sql.includes("review_status='APPROVED'")) {
        state.published = true;
        state.resultStatus = "PUBLISHED";
        return result([{ id: 55, schoolId: 1, assessmentId: 21, studentId: 13, status: "PUBLISHED" }]);
      }
      return result([]);
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
  state.resultStatus = "DRAFT";
  state.reviewStatus = "NOT_REVIEWED";
  state.parentChildAuthorized = true;
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
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 21 }, "TEACHER");
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("cannot exceed");
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO academic_results"))).toBe(false);
  });

  it("rejects duplicate student-assessment results without a second insert", async () => {
    state.resultExists = true;
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 18 }, "TEACHER");
    expect(response.status).toBe(409);
    expect(state.queries.filter(({ sql }) => sql.includes("INSERT INTO academic_results"))).toHaveLength(0);
    expect(state.transactions).toContain("ROLLBACK");
  });

  it("hides cross-school resources as not found", async () => {
    const response = await post("/academic/results", { schoolId: 1, assessmentId: 21, studentId: 13, score: 18 }, "TEACHER", 2);
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("limits family result-list reads to their own linked children and published rows", async () => {
    const response = await fetch(`${baseUrl}/academic/results?schoolId=1&studentId=13`, {
      headers: { "x-test-role": "PARENT", "x-test-school": "1" },
    });
    expect(response.status).toBe(200);
    expect(state.queries.find(({ sql }) => sql.includes("FROM academic_results r") && sql.includes("SELECT r.id"))?.sql)
      .toContain("r.status='PUBLISHED'");

    state.queries = [];
    state.parentChildAuthorized = false;
    const forbidden = await fetch(`${baseUrl}/academic/results?schoolId=1&studentId=14`, {
      headers: { "x-test-role": "PARENT", "x-test-school": "1" },
    });
    expect(forbidden.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("FROM academic_results r"))).toBe(false);
  });

  it("exposes student identity to School Admin review only and scopes the join to the school", async () => {
    const queue = await fetch(`${baseUrl}/academic/results/review?schoolId=1&assessmentId=21`, {
      headers: { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "1" },
    });
    expect(queue.status).toBe(200);
    const reviewQuery = state.queries.find(({ sql }) => sql.includes("r.review_status AS \"reviewStatus\""));
    expect(reviewQuery?.sql).toContain("LEFT JOIN students st ON st.id=r.student_id AND st.school_id=r.school_id");
    expect(reviewQuery?.sql).toContain("st.admission_no AS \"admissionNo\"");

    state.queries = [];
    const teacherQueue = await fetch(`${baseUrl}/academic/results/review?schoolId=1&assessmentId=21`, {
      headers: { "x-test-role": "TEACHER", "x-test-school": "1" },
    });
    expect(teacherQueue.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it("denies platform-owner result entry and grading-rule writes before database access", async () => {
    const result = await post("/academic/results", {
      schoolId: 1, assessmentId: 21, studentId: 13, score: 18,
    }, "PLATFORM_OWNER");
    const publish = await post("/academic/assessments/21/publish-results", { schoolId: 1 }, "PLATFORM_OWNER");
    const rules = await fetch(`${baseUrl}/academic/grading-rules?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": "PLATFORM_OWNER", "x-test-school": "1" },
      body: JSON.stringify({ minScore: 0, maxScore: 100, grade: "A", remark: "Excellent" }),
    });

    expect([result.status, publish.status, rules.status]).toEqual([403, 403, 403]);
    expect(state.queries).toHaveLength(0);
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it("blocks direct assessment publication even after subject approval", async () => {
    state.resultStatus = "SUBMITTED";
    state.reviewStatus = "APPROVED";
    const response = await post("/academic/assessments/21/publish-results", { schoolId: 1 });
    expect(response.status).toBe(409);
    expect(state.published).toBe(false);
    expect(state.transactions).toEqual([]);
    expect(state.queries).toEqual([]);
  });

  it("requires teacher submission and School Admin approval before a result is publishable", async () => {
    const earlyPublish = await post("/academic/assessments/21/publish-results", { schoolId: 1 });
    expect(earlyPublish.status).toBe(409);
    expect(state.published).toBe(false);

    const submitted = await post("/academic/results/55/submit", { schoolId: 1 }, "TEACHER");
    expect(submitted.status).toBe(200);
    expect(state.resultStatus).toBe("SUBMITTED");

    const approved = await post("/academic/results/55/review", {
      schoolId: 1, decision: "APPROVE", comment: "Verified against the mark sheet",
    });
    expect(approved.status).toBe(200);
    expect(state.reviewStatus).toBe("APPROVED");

    const published = await post("/academic/assessments/21/publish-results", { schoolId: 1 });
    expect(published.status).toBe(409);
    expect(state.published).toBe(false);
    expect(state.transactions).toContain("COMMIT");
  });

  it("requires admin comments when returning submitted work and records the returned state", async () => {
    state.resultStatus = "SUBMITTED";
    const missingComment = await post("/academic/results/55/review", { schoolId: 1, decision: "RETURN" });
    expect(missingComment.status).toBe(400);
    expect(state.resultStatus).toBe("SUBMITTED");

    const response = await post("/academic/results/55/review", {
      schoolId: 1, decision: "RETURN", comment: "Please verify the total.",
    });
    expect(response.status).toBe(200);
    expect(state.resultStatus).toBe("DRAFT");
    expect(state.reviewStatus).toBe("RETURNED");
    expect((await response.json() as { reviewComment: string }).reviewComment).toBe("Please verify the total.");
  });

  it("compiles calculated results as draft snapshots without publishing", async () => {
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
    expect(snapshotQuery?.sql).toContain("r.status<>'ARCHIVED'");
    expect(snapshotQuery?.sql).toContain("r.student_class_assignment_id=$6");
    expect(state.auditCount).toBe(1);
  });

  it("sets report-card publisher and timestamp only when publishing", async () => {
    state.resultStatus="SUBMITTED";
    state.reviewStatus="APPROVED";
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