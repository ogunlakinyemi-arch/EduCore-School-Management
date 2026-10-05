import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: [] as Array<{ role: string; schoolId: number | null; status: string }>,
  userId: 41,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  query: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      return state.query(sql, values);
    },
    connect: state.connect,
  },
}));
vi.mock("@google-cloud/storage", () => ({ Storage: class { bucket() { return { file() { return { save: vi.fn(), download: vi.fn() }; } }; } } }));
vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: vi.fn(async () => 1),
}));
vi.mock("../middlewares/auth", () => {
  class MockAuthError extends Error {
    constructor(public readonly statusCode: number, message: string, public readonly eventType = "ACCESS_DENIED") { super(message); }
  }
  return {
    AuthError: MockAuthError,
    getUserContext: () => ({
      user: { id: state.userId, clerkUserId: "test-clerk", email: "teacher@example.test", firstName: "A", lastName: "Teacher" },
      roles: state.roles,
    }),
    requireAuthentication: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    assertSchoolAccess: (_req: unknown, schoolId: number, roles: string[]) => {
      if (roles.includes("PLATFORM_OWNER") && state.roles.some(r=>r.role==="PLATFORM_OWNER"&&r.schoolId===null&&r.status==="ACTIVE")) return;
      if (!state.roles.some(r=>r.status==="ACTIVE"&&r.schoolId===schoolId&&roles.includes(r.role)))
        throw new MockAuthError(404,"Resource not found");
    },
    assertSchoolOperationalAccess: (_req: unknown, schoolId: number, roles: string[]) => {
      if (state.roles.some(role => role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE")) {
        throw new MockAuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
      if (!state.roles.some(role => role.status === "ACTIVE" && role.schoolId === schoolId && roles.includes(role.role))) {
        throw new MockAuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
    },
    handleAuthError: (error: unknown, _req: unknown, res: express.Response, next: express.NextFunction) => {
      const authError = error as { statusCode?: number; message?: string };
      if (authError.statusCode) {
        res.status(authError.statusCode).json({ error: authError.message });
        return;
      }
      next(error);
    },
  };
});

import curriculumLearningRouter from "./curriculum-learning";

const app = express();
app.use(express.json());
app.use("/api", curriculumLearningRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Curriculum test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

beforeEach(() => {
  state.roles = [{ role: "TEACHER", schoolId: 4, status: "ACTIVE" }];
  state.userId = 41;
  state.queries.length = 0;
  state.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (!sql.includes("WITH expected AS") && sql.includes("FROM employees e") && sql.includes("teacher_class_assignments")) return { rows: [{ id: 9 }] };
    if (sql.includes("FROM school_classes c")) return { rows: [{ id: 10, class_name: "JSS2", subject_code: "MTH", subject_name: "Mathematics" }] };
    if (sql.includes("INSERT INTO lesson_notes")) return { rows: [{
      id: 51, schoolId: 4, sessionId: 1, termId: 2, classId: 10, subjectId: 11,
      teacherId: 9, section: "Blue", week: 3, date: "2026-03-03", content: {}, status: "DRAFT", revision: 0,
    }] };
    if (sql.includes("WITH expected AS")) return { rows: [{
      teacherId: 9, teacherName: "A Teacher", classId: 10, subjectId: 11, sessionId: 1, termId: 2,
      week: 3, noteId: null, status: "MISSING",
    }] };
    return { rows: [] };
  });
  state.clientQuery.mockReset().mockImplementation(async () => ({ rows: [] }));
  state.connect.mockReset().mockResolvedValue({
    query: (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      return state.clientQuery(sql, values);
    },
    release: vi.fn(),
  });
});

describe("curriculum and lesson note routes", () => {
  it("restricts global library management to active platform owners", async () => {
    const response = await fetch(`${baseUrl}/api/curriculum/versions`);
    expect(response.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it("denies school operational writes to a dual-role global owner", async () => {
    state.roles = [
      { role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
      { role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" },
    ];
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: 2, classId: 10, subjectId: 11, sessionId: 1, termId: 2 }),
    });
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("hides another teacher's lesson note by ID", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM lesson_notes n") && sql.includes("FOR UPDATE") === false) {
        return { rows: [{
          id: 70, schoolId: 4, status: "DRAFT", teacherUserId: 999, content: {}, revision: 0,
        }] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes/70`);
    expect(response.status).toBe(404);
  });

  it("keeps published curriculum immutable even for an owner edit attempt", async () => {
    state.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM curriculum_versions")) return { rows: [{ id: 6, status: "PUBLISHED" }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/curriculum/versions/6`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Official syllabus", educationLevel: "JSS", classLevels: ["JSS2"], subjectCodes: ["MTH"],
        sourceKind: "OFFICIAL", sourceOrganization: "NERDC", sourceReference: "official reference",
      }),
    });
    expect(response.status).toBe(409);
    expect(state.queries.some(call => call.sql === "ROLLBACK")).toBe(true);
    expect(state.queries.some(call => call.sql.includes("UPDATE curriculum_versions"))).toBe(false);
  });

  it("creates teacher drafts without marking curriculum progress complete", async () => {
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: 1, termId: 2, classId: 10, subjectId: 11, section: "Blue", week: 3,
        date: "2026-03-03", content: { topic: "Fractions" },
      }),
    });
    expect(response.status).toBe(201);
    expect(state.queries.some(call => call.sql.includes("INSERT INTO curriculum_progress"))).toBe(false);
  });

  it("reports a duplicate weekly note as a conflict without changing the existing note",async()=>{
    state.query.mockImplementation(async(sql:string)=>{
      if(sql.includes("INSERT INTO lesson_notes"))throw Object.assign(Error("duplicate"),{code:"23505",constraint:"lesson_notes_week_assignment_unique"});
      if(sql.includes("FROM employees e"))return{rows:[{id:9}]};
      if(sql.includes("FROM school_classes c"))return{rows:[{id:10}]};
      return{rows:[]};
    });
    const response=await fetch(`${baseUrl}/api/schools/4/lesson-notes`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId:1,termId:2,classId:10,subjectId:11,section:"Blue",week:3,date:"2026-03-03",content:{}})});
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("choose a different week");
    expect(state.queries.some(q=>q.sql.includes("UPDATE lesson_notes"))).toBe(false);
  });

  it("derives missing weekly lesson notes from expected assignments", async () => {
    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" }];
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes/monitoring?sessionId=1&termId=2&week=3`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ status: "MISSING", teacherId: 9 }]);
  });

  it("routes the static monitoring endpoint before the note-id endpoint", async () => {
    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" }];
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes/monitoring?sessionId=1&termId=2&week=3`);
    expect(response.status).toBe(200);
    expect(state.queries.some(call => call.sql.includes("WITH expected AS"))).toBe(true);
    expect(state.queries.some(call => call.sql.includes("WHERE n.id=$1 AND n.school_id=$2"))).toBe(false);
  });

  it("suggests versions with exact normalized class labels and subject code or name aliases", async () => {
    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" }];
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM school_classes c CROSS JOIN subjects s")) {
        return { rows: [{ className: "JSS 2", subjectCode: "M.A.T", subjectName: "Mathematics" }] };
      }
      if (sql.includes("FROM curriculum_versions") && sql.includes("jsonb_array_length")) {
        return { rows: [{ id: 8, title: "Published MTH", sourceKind: "OFFICIAL" }] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum/catalog?classId=10&subjectId=11`);
    expect(response.status).toBe(200);
    const versionQuery = state.queries.find(call => call.sql.includes("FROM curriculum_versions") && call.sql.includes("jsonb_array_length"));
    expect(versionQuery?.sql).toContain("regexp_replace(lower(level),'[^a-z0-9]','','g')=ANY($1::text[])");
    expect(versionQuery?.sql).toContain("regexp_replace(lower(code),'[^a-z0-9]','','g')=ANY($2::text[])");
    expect(versionQuery?.values).toEqual([["jss2"], ["mat", "mathematics"]]);
    expect(await response.json()).toMatchObject([{ id: 8, title: "Published MTH" }]);
  });

  it("allows confirming a version through exact normalized class and subject aliases", async () => {
    state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" }];
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM school_classes c") && sql.includes("JOIN subjects sub")) {
        return { rows: [{ id: 10, class_name: "JSS 2", subject_code: "MAT", subject_name: "Mathematics" }] };
      }
      if (sql.includes("SELECT id,status,class_levels,subject_codes")) {
        return { rows: [{ id: 8, status: "PUBLISHED", class_levels: ["JSS2"], subject_codes: ["Mathematics"] }] };
      }
      return { rows: [] };
    });
    state.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO school_curriculum_assignments")) {
        return { rows: [{ id: 30, schoolId: 4, versionId: 8, classId: 10, subjectId: 11, sessionId: 1, termId: 2 }] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: 8, classId: 10, subjectId: 11, sessionId: 1, termId: 2 }),
    });
    expect(response.status).toBe(201);
    expect(state.queries.some(call => call.sql.includes("INSERT INTO school_curriculum_assignments"))).toBe(true);
  });

  it("does not let a class-wide-looking teacher assignment authorize a different subject", async () => {
    state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("JOIN teacher_class_assignments") && values[5] === 12) return { rows: [] };
      if (sql.includes("JOIN teacher_class_assignments") && values[5] === 11) return { rows: [{ id: 9 }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: 1, termId: 2, classId: 10, subjectId: 12, section: "Blue", week: 3,
        date: "2026-03-03", content: { topic: "Fractions" },
      }),
    });
    expect(response.status).toBe(403);
    expect(state.queries.some(call => call.sql.includes("INSERT INTO lesson_notes"))).toBe(false);
  });

  it("denies a parent even when the requested note ID would otherwise match", async () => {
    state.roles = [{ role: "PARENT", schoolId: 4, status: "ACTIVE" }];
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes/51`);
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("denies inactive teacher membership before reading PDF metadata", async () => {
    state.roles=[{role:"TEACHER",schoolId:4,status:"INACTIVE"}];
    const response=await fetch(`${baseUrl}/api/schools/4/lesson-notes/51`);
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("cannot use a global version ID to bypass the school's confirmed mapping",async()=>{
    const response=await fetch(`${baseUrl}/api/schools/4/lesson-notes`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId:1,termId:2,classId:10,subjectId:11,section:"Blue",week:3,
        date:"2026-03-03",curriculumVersionId:8,topicId:61,content:{topic:"Forged unconfirmed version"}}),
    });
    expect(response.status).toBe(404);
    expect(state.queries.some(q=>q.sql.includes("INSERT INTO lesson_notes"))).toBe(false);
  });

  it("returns persisted coverage separately from topics and retains the mapping version", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT m.*,c.section")) {
        return { rows: [{
          id: 30, school_id: 4, curriculum_version_id: 7, school_class_id: 10, subject_id: 11,
          academic_session_id: 1, academic_term_id: 2, status: "ACTIVE", section: "Blue",
        }] };
      }
      if (sql.includes("FROM employees e") && sql.includes("teacher_class_assignments")) return { rows: [{ id: 9 }] };
      if (sql.includes("FROM curriculum_topics t")) return { rows: [{ id: 61, title: "Fractions", subjectCode: "MTH" }] };
      if (sql.includes("FROM curriculum_progress WHERE")) return { rows: [{
        id: 4, mappingId: 30, topicId: 61, progressStatus: "COMPLETED", comment: "Taught",
      }] };
      if (sql.includes("FROM curriculum_versions WHERE id=$1")) return { rows: [{
        id: 7, title: "Old pinned version", sourceKind: "OFFICIAL", sourceImportId: 3, status: "ARCHIVED",
      }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum/30/topics`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      topics: [{ id: 61 }],
      progress: [{ mappingId: 30, topicId: 61, progressStatus: "COMPLETED" }],
      curriculumVersion: { id: 7, title: "Old pinned version", sourceImportId: 3 },
    });
    const topicQuery = state.queries.find(call => call.sql.includes("FROM curriculum_topics t"));
    expect(topicQuery?.sql).toContain("regexp_replace(lower(t.class_level)");
    expect(topicQuery?.sql).toContain("regexp_replace(lower(s.name)");
    expect(topicQuery?.values.slice(3)).toEqual([10, 11]);
  });

  it("uses normalized class labels and code/name aliases when recording progress", async () => {
    state.roles = [{ role: "TEACHER", schoolId: 4, status: "ACTIVE" }];
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT m.*,c.section")) return { rows: [{
        id: 30, status: "ACTIVE", school_id: 4, school_class_id: 10, subject_id: 11,
        academic_session_id: 1, academic_term_id: 2, curriculum_version_id: 7, section: "Blue",
      }] };
      if (sql.includes("FROM employees e") && sql.includes("teacher_class_assignments")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT t.id FROM curriculum_topics t")) return { rows: [{ id: 61 }] };
      if (sql.includes("INSERT INTO curriculum_progress")) return { rows: [{ id: 4, mappingId: 30, topicId: 61 }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum/30/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: 61, progressStatus: "IN_PROGRESS" }),
    });
    expect(response.status).toBe(201);
    const topicQuery = state.queries.find(call => call.sql.includes("SELECT t.id FROM curriculum_topics t"));
    expect(topicQuery?.sql).toContain("regexp_replace(lower(t.class_level)");
    expect(topicQuery?.sql).toContain("regexp_replace(lower(s.name)");
    expect(topicQuery?.values).toEqual([61, 7, 30, 4, 10, 11]);
  });

  it("uses normalized class labels and exact subject aliases to validate lesson-note topics", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees e") && sql.includes("teacher_class_assignments")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT c.id,c.name AS class_name")) {
        return { rows: [{ id: 10, class_name: "JSS 2", subject_code: "MAT", subject_name: "Mathematics" }] };
      }
      if (sql.includes("SELECT id,status FROM curriculum_versions")) return { rows: [{ id: 8, status: "PUBLISHED" }] };
      if (sql.includes("SELECT id,curriculum_version_id FROM school_curriculum_assignments")) return { rows: [{id:30,curriculum_version_id:8}] };
      if (sql.includes("SELECT id,parent_topic_id FROM curriculum_topics t")) return { rows: [{ id: 61, parent_topic_id: null }] };
      if (sql.includes("INSERT INTO lesson_notes")) return { rows: [{
        id: 51, schoolId: 4, sessionId: 1, termId: 2, classId: 10, subjectId: 11,
        teacherId: 9, section: "Blue", week: 3, date: "2026-03-03", content: {}, status: "DRAFT", revision: 0,
      }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: 1, termId: 2, classId: 10, subjectId: 11, section: "Blue", week: 3,
        date: "2026-03-03", curriculumMappingId:30, curriculumVersionId: 8, topicId: 61, content: { topic: "Fractions" },
      }),
    });
    expect(response.status).toBe(201);
    const assignmentQuery = state.queries.find(call => call.sql.includes("FROM employees e") && call.sql.includes("ta.employee_id"));
    expect(assignmentQuery?.values).toEqual([4, 41, 1, 2, 10, 11, "Blue"]);
    const topicQuery = state.queries.find(call => call.sql.includes("SELECT id,parent_topic_id FROM curriculum_topics t"));
    expect(topicQuery?.sql).toContain("regexp_replace(lower(t.class_level)");
    expect(topicQuery?.sql).toContain("regexp_replace(lower(code)");
    expect(topicQuery?.sql).toContain("regexp_replace(lower(name)");
    expect(topicQuery?.values).toContain(11);
  });

  it("returns historical note provenance from its pinned version, not a later mapping version", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM lesson_notes n")) return { rows: [{
        id: 51, schoolId: 4, curriculumMappingId: 30, curriculumVersionId: 7, status: "APPROVED",
        teacherUserId: 41, revision: 2, content: {},
      }] };
      if (sql.includes("FROM curriculum_versions WHERE id=$1")) return { rows: [{
        id: 7, title: "Pinned old version", sourceKind: "OFFICIAL", sourceImportId: 3, status: "ARCHIVED",
      }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/lesson-notes/51`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      curriculumVersionId: 7,
      curriculumVersion: { id: 7, title: "Pinned old version", sourceImportId: 3 },
    });
    expect(state.queries.some(call => call.sql.includes("FROM curriculum_versions WHERE id=$1") && call.values[0] === 7)).toBe(true);
  });

  it("requires an affirmative reviewer confirmation before an import can create a version", async () => {
    state.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    const response = await fetch(`${baseUrl}/api/curriculum/imports/3/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: {
          title: "Reviewed syllabus", educationLevel: "JSS", classLevels: [], subjectCodes: [],
          sourceOrganization: "Ministry", sourceReference: "Reviewed source",
        },
        mapping: {},
      }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(call => call.sql.includes("FROM curriculum_imports"))).toBe(false);
  });

  it("rejects provenance flags hidden inside reviewer-corrected import rows", async () => {
    state.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM curriculum_imports WHERE id=$1")) return { rows: [{
        id: 3, uploaded_by: 41, preview_rows: [{ Title: "Extracted title" }], headers: ["Title"],
      }] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/curriculum/imports/3/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: {
          title: "Reviewed syllabus", educationLevel: "JSS", classLevels: [], subjectCodes: [],
          sourceOrganization: "Ministry", sourceReference: "Reviewed source", sourceKind: "AI_ASSISTANCE",
        },
        mapping: {},
        reviewerConfirmed: true,
        correctedRows: [{ classLevel: "JSS2", subjectCode: "MTH", title: "Fractions", sourceKind: "OFFICIAL" }],
      }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(call => call.sql.includes("INSERT INTO curriculum_versions"))).toBe(false);
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("scopes curriculum parent-topic lookup to the same version, class level, and subject code", async () => {
    state.roles = [{ role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT * FROM curriculum_versions")) return { rows: [{ id: 6, status: "DRAFT", class_levels: ["JSS2"] }] };
      if (sql.includes("WITH RECURSIVE ancestors")) return { rows: [] };
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/curriculum/versions/6/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classLevel: "JSS2", subjectCode: "MTH", parentTopicId: 19, title: "Improper child",
      }),
    });
    expect(response.status).toBe(400);
    const parentCheck = state.queries.find(call => call.sql.includes("WITH RECURSIVE ancestors"));
    expect(parentCheck?.sql).toContain("curriculum_version_id=$2");
    expect(parentCheck?.sql).toContain("regexp_replace(lower(class_level)");
    expect(parentCheck?.sql).toContain("regexp_replace(lower(subject_code)");
    expect(state.queries.some(call => call.sql.includes("INSERT INTO curriculum_topics"))).toBe(false);
  });

  it("returns a subject authorized by an active class-only teacher assignment", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM employees e") && sql.includes("ta.employee_id")) {
        return { rows: [{
          classId: 10, className: "JSS2", section: null, subjectId: 11, subjectName: "Mathematics",
          subjectCode: "MTH", sessionId: 1, termId: 2,
        }] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum/teaching-context?sessionId=1&termId=2`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{
      classId: 10, className: "JSS2", section: null, subjectId: 11, subjectName: "Mathematics",
      subjectCode: "MTH", sessionId: 1, termId: 2,
    }]);
    const query = state.queries.find(call => call.sql.includes("FROM employees e") && call.sql.includes("ta.employee_id"));
    expect(query?.values).toEqual([4, 41, 1, 2]);
    expect(query?.sql).toContain("ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=(s.id)");
    expect(query?.sql).toContain("cs.employee_id IS NULL OR cs.employee_id=(e.id)");
  });

  it("does not expose an unrelated subject to a teacher with a different subject-specific assignment", async () => {
    state.query.mockResolvedValue({ rows: [] });
    const response = await fetch(`${baseUrl}/api/schools/4/curriculum/teaching-context?sessionId=1&termId=2`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    const query = state.queries.find(call => call.sql.includes("FROM employees e") && call.sql.includes("ta.employee_id"));
    expect(query?.sql).toContain("ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=(s.id)");
    expect(query?.sql).toContain("e.school_id=$1 AND e.user_id=$2");
    expect(query?.sql).toContain("ta.academic_session_id=($3)");
    expect(query?.sql).toContain("cs.academic_term_id=($4)");
  });

  it("does not allow teaching-context access across schools", async () => {
    const response = await fetch(`${baseUrl}/api/schools/5/curriculum/teaching-context?sessionId=1&termId=2`);
    expect(response.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });
});