import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  timeline: [] as string[],
  assignment: {
    id: 701,
    school_id: 1,
    academic_session_id: 2,
    academic_term_id: 3,
    school_class_id: 4,
    section: "Blue",
    subject_id: 5,
    teacher_employee_id: 6,
    created_by: 10,
    title: "Fractions",
    description: "Complete questions 1–5",
    issue_date: "2026-03-01",
    due_date: "2026-03-08",
    max_score: 20,
    status: "DRAFT",
  } as Record<string, any>,
  reportCard: {
    id: 80, schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
    studentClassAssignmentId: 12, classId: 5, className: "JSS2", section: "Blue",
    status: "DRAFT", publishedBy: null, publishedAt: null,
  } as Record<string, any>,
}));

const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const respond = async (sql: string, values: any[] = []) => {
    state.queries.push({ sql, values });
    state.timeline.push(
      sql === "BEGIN" ? "BEGIN" :
      sql === "COMMIT" ? "COMMIT" :
      sql === "ROLLBACK" ? "ROLLBACK" :
      sql.includes("UPDATE academic_assignments") ? "UPDATE_ASSIGNMENT" :
      sql.includes("INSERT INTO academic_assignments") ? "INSERT_ASSIGNMENT" : "QUERY",
    );
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
    if (sql.includes("INSERT INTO audit_logs")) return result();
    if (sql.includes("SELECT roster.recipient_user_id AS \"userId\"")) {
      return result([
        { userId: 31, studentId: 11, link: "/my-academics" },
        { userId: 44, studentId: 11, link: "/" },
        { userId: 44, studentId: 12, link: "/" },
      ]);
    }
    if (sql.includes("SELECT linked.user_id AS \"userId\"")) {
      return result([{ userId: 13, link: "/my-academics" }, { userId: 44, link: "/" }]);
    }
    if (sql.includes("FROM academic_assignments WHERE id=$1 AND school_id=$2 FOR UPDATE")) {
      return result([{ ...state.assignment }]);
    }
    if (sql.includes("UPDATE academic_assignments")) {
      state.assignment = { ...state.assignment, status: values[11] };
      return result([{
        id: 701, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
        subjectId: 5, teacherId: 6, createdBy: 10, title: state.assignment.title,
        description: state.assignment.description, issueDate: "2026-03-01", dueDate: "2026-03-08",
        maxScore: 20, status: values[11],
      }]);
    }
    if (sql.includes("INSERT INTO academic_assignments")) {
      return result([{
        id: 701, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
        subjectId: 5, teacherId: 6, createdBy: 10, title: values[8],
        description: values[9], issueDate: values[10], dueDate: values[11],
        maxScore: values[12], status: values[13],
      }]);
    }
    if (sql.includes("FROM academic_assessments a")) {
      return result([{
        id: 21, school_id: 1, academic_session_id: 3, academic_term_id: 4,
        school_class_id: 5, section: "Blue", subject_id: 7, teacher_employee_id: 8,
        max_score: "20", assessment_date: "2025-02-03", status: "OPEN",
      }]);
    }
    if (sql.includes("SELECT id FROM academic_assessments")) return result([{ id: 21 }]);
    if (sql.includes("FROM student_class_assignments sca JOIN school_classes")) {
      return result([{ id: 12, school_class_id: 5, section: "Blue", class_name: "JSS2" }]);
    }
    if (sql.includes("FROM student_class_assignments sca") && sql.includes("JOIN students")) {
      return result([{ id: 12, section: "Blue" }]);
    }
    if (sql.includes("FROM school_classes c")) return result([{ id: 4 }]);
    if (sql.includes("FROM employees e") && sql.includes("e.user_id=$2")) return result([{ id: 6 }]);
    if (sql.includes("FROM employees e")) return result([{ id: 8 }]);
    if (sql.includes("FROM academic_results WHERE school_id=$1 AND assessment_id=$2")) return result([]);
    if (sql.includes("FROM academic_grading_rules")) {
      return result([{ min_score: "80", max_score: "100", grade: "A", grade_point: "4", remark: "Excellent" }]);
    }
    if (sql.includes("INSERT INTO academic_results")) {
      return result([{ id: 55, schoolId: 1, assessmentId: 21, studentId: 13, score: "18", maxScore: "20", grade: "A", status: "DRAFT" }]);
    }
    if (sql.includes("UPDATE academic_results SET status='PUBLISHED'")) {
      return result([{ id: 55, schoolId: 1, assessmentId: 21, studentId: 13, classId: 5, status: "PUBLISHED" }]);
    }
    if (sql.includes("FROM academic_report_cards WHERE id=$1 AND school_id=$2 FOR UPDATE")) {
      return result([{
        id: 80, student_id: 13, academic_session_id: 3, academic_term_id: 4,
        student_class_assignment_id: 12, status: "DRAFT",
      }]);
    }
    if (sql.includes("INSERT INTO academic_report_card_lines")) return result();
    if (sql.includes("UPDATE academic_report_cards SET status='PUBLISHED'")) {
      state.reportCard = { ...state.reportCard, status: "PUBLISHED", publishedBy: 10, publishedAt: "2025-02-03T09:00:00.000Z" };
      return result([{ ...state.reportCard }]);
    }
    if (sql.includes("INSERT INTO academic_report_cards")) return result([{ ...state.reportCard }]);
    if (sql.includes("FROM academic_report_card_lines")) {
      return result([{
        id: 95, subjectId: 7, subjectName: "Mathematics", assessmentName: "Term Test",
        score: "18", maxScore: "20", grade: "A", gradePoint: "4", remark: "Excellent",
      }]);
    }
    if (sql.includes("count(*)::int AS count FROM academic_results")) return result([{ count: 0 }]);
    if (sql.includes("FROM academic_results r")) return result([{ count: 0 }]);
    throw new Error(`Unhandled SQL in academic-communication test: ${sql}`);
  };
  const client = { query: vi.fn(respond), release: vi.fn() };
  return {
    client,
    query: vi.fn(respond),
    connect: vi.fn(async () => client),
  };
});

const communicationMock = vi.hoisted(() => ({
  queue: vi.fn(async (_client: unknown, _input: unknown) => {
    state.timeline.push("QUEUE_NOTIFICATION");
    return 901;
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: communicationMock.queue,
}));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string, public readonly eventType?: string) {
      super(message);
    }
  }
  const getContext = (req: express.Request) => (req as any).edupulseUser;
  const requireAuthentication = () => (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
    (req as any).edupulseUser = {
      user: {
        id: 10, clerkUserId: "clerk-test", email: "admin@example.test",
        firstName: "Test", lastName: "Admin", phone: null, status: "ACTIVE",
      },
      roles: [{ id: 1, role, schoolId: 1, status: "ACTIVE" }],
    };
    next();
  };
  const assertSchoolOperationalAccess = (req: express.Request, schoolId: number, roles: string[]) => {
    const context = getContext(req);
    if (!context.roles.some((membership: any) =>
      membership.status === "ACTIVE" && membership.schoolId === schoolId && roles.includes(membership.role),
    )) throw new AuthError(404, "Resource not found");
    return context;
  };
  return {
    AuthError,
    assertSchoolOperationalAccess,
    getUserContext: getContext,
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication,
  };
});

import academicWorkRouter from "./academic-work";
import academicResultsRouter from "./academic-results";

const app = express();
app.use(express.json());
app.use(academicWorkRouter);
app.use(academicResultsRouter);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
  res.status(error.statusCode ?? 500).json({ error: error.message }),
);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));
beforeEach(() => {
  state.queries = [];
  state.timeline = [];
  state.assignment = {
    id: 701, school_id: 1, academic_session_id: 2, academic_term_id: 3,
    school_class_id: 4, section: "Blue", subject_id: 5, teacher_employee_id: 6,
    created_by: 10, title: "Fractions", description: "Complete questions 1–5",
    issue_date: "2026-03-01", due_date: "2026-03-08", max_score: 20, status: "DRAFT",
  };
  state.reportCard = {
    id: 80, schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
    studentClassAssignmentId: 12, classId: 5, className: "JSS2", section: "Blue",
    status: "DRAFT", publishedBy: null, publishedAt: null,
  };
  poolMock.client.query.mockClear();
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
  communicationMock.queue.mockClear();
});

async function post(path: string, body: Record<string, unknown>, method = "POST") {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-role": "SCHOOL_ADMIN" },
    body: JSON.stringify(body),
  });
}

describe("academic publication notifications", () => {
  it("notifies roster students and linked parents only after assignment publication", async () => {
    const response = await post("/academic/assignments/701?schoolId=1", { status: "PUBLISHED" }, "PATCH");

    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("PUBLISHED");
    expect(communicationMock.queue).toHaveBeenCalledTimes(3);
    const calls = communicationMock.queue.mock.calls as unknown as Array<[any, any]>;
    expect(calls.map(([, input]) => [input.recipientUserId, input.subjectStudentId])).toEqual([
      [31, 11], [44, 11], [44, 12],
    ]);
    expect(calls[0][1]).toMatchObject({
      schoolId: 1, subjectStudentId: 11, subjectClassId: 4,
      category: "ASSIGNMENT", eventKey: "assignment-published:701:11",
      subject: "New assignment available", link: "/my-academics", channels: ["IN_APP"],
    });
    expect(calls[1][1]).toMatchObject({ subjectStudentId: 11, subjectClassId: 4 });
    expect(calls[1][1].link).toBe("/");
    expect(calls[2][1]).toMatchObject({
      subjectStudentId: 12, subjectClassId: 4, eventKey: "assignment-published:701:12", link: "/",
    });
    const roster = state.queries.find(({ sql }) => sql.includes("SELECT roster.recipient_user_id"));
    expect(roster?.values).toEqual([1, 4, 2, 3, "Blue"]);
    expect(roster?.sql).toContain("JOIN parent_student_relationships");
    expect(roster?.sql).toContain("p.school_id=sca.school_id");
    expect(roster?.sql).toContain("GROUP BY roster.recipient_user_id, roster.subject_student_id");
    expect(state.timeline.indexOf("UPDATE_ASSIGNMENT")).toBeLessThan(state.timeline.indexOf("QUEUE_NOTIFICATION"));
    expect(state.timeline.lastIndexOf("QUEUE_NOTIFICATION")).toBeLessThan(state.timeline.indexOf("COMMIT"));
  });

  it("notifies when an assignment is created directly as published, but not for draft creation or edits", async () => {
    const assignmentBody = {
      sessionId: 2, termId: 3, classId: 4, section: "Blue", subjectId: 5,
      title: "Fractions", issueDate: "2026-03-01", dueDate: "2026-03-08", maxScore: 20,
    };
    const draft = await post("/academic/assignments?schoolId=1", assignmentBody);
    expect(draft.status).toBe(201);
    expect(communicationMock.queue).not.toHaveBeenCalled();

    state.queries = [];
    state.timeline = [];
    communicationMock.queue.mockClear();
    const published = await post("/academic/assignments?schoolId=1", {
      ...assignmentBody, status: "PUBLISHED",
    });
    expect(published.status, await published.clone().text()).toBe(201);
    expect((await published.json() as { status: string }).status).toBe("PUBLISHED");
    expect(communicationMock.queue).toHaveBeenCalledTimes(3);
    const queueCall = (communicationMock.queue.mock.calls as unknown as Array<[any, any]>)[0][1];
    expect(queueCall.eventKey).toBe("assignment-published:701:11");
    expect(queueCall).toMatchObject({ subjectStudentId: 11, subjectClassId: 4 });
    expect(state.timeline.indexOf("INSERT_ASSIGNMENT")).toBeLessThan(state.timeline.indexOf("QUEUE_NOTIFICATION"));
    expect(state.timeline.lastIndexOf("QUEUE_NOTIFICATION")).toBeLessThan(state.timeline.indexOf("COMMIT"));

    state.queries = [];
    state.timeline = [];
    communicationMock.queue.mockClear();
    const edited = await post("/academic/assignments/701?schoolId=1", {
      description: "Revised instructions",
    }, "PATCH");
    expect(edited.status).toBe(200);
    expect(communicationMock.queue).not.toHaveBeenCalled();
  });

  it("queues result-publication notices for the student and active linked parents", async () => {
    const response = await post("/academic/assessments/21/publish-results", { schoolId: 1 });

    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as { publishedCount: number }).publishedCount).toBe(1);
    expect(communicationMock.queue).toHaveBeenCalledTimes(2);
    const calls = communicationMock.queue.mock.calls as unknown as Array<[any, any]>;
    expect(calls.map(([, input]) => input.recipientUserId)).toEqual([13, 44]);
    expect(calls[0][1]).toMatchObject({
      schoolId: 1, subjectStudentId: 13, subjectClassId: 5,
      category: "ACADEMIC", eventKey: "assessment-results-published:21:13",
      subject: "Academic results available", link: "/my-academics", channels: ["IN_APP"],
    });
    expect(calls[1][1].link).toBe("/");
    const recipientQuery = state.queries.find(({ sql }) => sql.includes("SELECT linked.user_id AS"));
    expect(recipientQuery?.values).toEqual([13, 1]);
    expect(recipientQuery?.sql).toContain("JOIN parent_student_relationships");
    expect(recipientQuery?.sql).toContain("st.school_id=p.school_id");
    expect(state.timeline[0]).toBe("BEGIN");
    expect(state.timeline.indexOf("COMMIT")).toBeLessThan(state.timeline.indexOf("QUEUE_NOTIFICATION"));
  });

  it("queues report-card availability notices after publication commits", async () => {
    const response = await post("/academic/report-cards/80/publish", { schoolId: 1 });

    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("PUBLISHED");
    expect(communicationMock.queue).toHaveBeenCalledTimes(2);
    const calls = communicationMock.queue.mock.calls as unknown as Array<[any, any]>;
    expect(calls.map(([, input]) => input.recipientUserId)).toEqual([13, 44]);
    expect(calls[0][1]).toMatchObject({
      schoolId: 1, subjectStudentId: 13, subjectClassId: 5,
      category: "ACADEMIC", eventKey: "report-card-published:80",
      subject: "Report card available", link: "/my-academics", channels: ["IN_APP"],
    });
    expect(state.timeline.indexOf("COMMIT")).toBeLessThan(state.timeline.indexOf("QUEUE_NOTIFICATION"));
  });

  it("does not notify when a result is created as a draft", async () => {
    const response = await post("/academic/results", {
      schoolId: 1, assessmentId: 21, studentId: 13, score: 18,
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect((await response.json() as { status: string }).status).toBe("DRAFT");
    expect(communicationMock.queue).not.toHaveBeenCalled();
  });

  it("does not notify when a report card is created as a draft", async () => {
    const response = await post("/academic/report-cards", {
      schoolId: 1, studentId: 13, sessionId: 3, termId: 4,
      teacherRemark: "Steady progress", schoolRemark: "Promoted",
    });

    expect(response.status).toBe(201);
    expect((await response.json() as { status: string }).status).toBe("DRAFT");
    expect(communicationMock.queue).not.toHaveBeenCalled();
  });
});