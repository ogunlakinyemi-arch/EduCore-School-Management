import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "ARCHIVED",
  teacherAssigned: true,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
}));
const fixture = () => ({
  id: 701, school_id: 1, academic_session_id: 2, academic_term_id: 3,
  school_class_id: 4, section: "Blue", subject_id: 5, teacher_employee_id: 6,
  title: "Retained assignment", description: "Original instructions",
  issue_date: "2026-03-01", due_date: "2026-03-08", max_score: 20, status: state.status,
});
const query = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({
  pool: { query, connect: async () => ({ query, release }) },
}));
vi.mock("../middlewares/auth", async importOriginal => ({
  ...await importOriginal<typeof import("../middlewares/auth")>(),
  requireAuthentication: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-role") ?? "SCHOOL_ADMIN";
    if (role === "ANONYMOUS") { res.status(401).json({ error: "Authentication required" }); return; }
    const roles = role === "DUAL_OWNER"
      ? [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }, { role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }]
      : [{ role, schoolId: role === "PLATFORM_OWNER" ? null : 1, status: "ACTIVE" }];
    (req as any).edupulseUser = {
      user: { id: 20, clerkUserId: "assignment-fixture", email: "fixture@example.test", status: "ACTIVE" }, roles,
    };
    next();
  },
}));
import router from "./academic-work";

const app = express();
app.use(express.json());
app.use(router);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});
let server: ReturnType<typeof app.listen>;
let base: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
beforeEach(() => {
  state.status = "ARCHIVED";
  state.teacherAssigned = true;
  state.calls = [];
  release.mockClear();
  query.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("SELECT * FROM academic_assignments")) {
      return { rows: values[0] === 701 && values[1] === 1 ? [fixture()] : [] };
    }
    if (sql.includes("FROM school_classes c")) return { rows: [{ id: 4 }] };
    if (sql.includes("FROM employees e")) return { rows: state.teacherAssigned ? [{ id: 6 }] : [] };
    if (sql.includes("UPDATE academic_assignments")) {
      return { rows: [{ ...fixture(), title: values[6], status: values[11] }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});
const patch = (body: unknown, role = "SCHOOL_ADMIN", schoolId = 1, assignmentId = 701) =>
  fetch(`${base}/academic/assignments/${assignmentId}?schoolId=${schoolId}`, {
    method: "PATCH", headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body),
  });
// Denied requests legitimately append security audits. They must never change
// domain records; SELECT ... FOR UPDATE is a lock, not a mutation.
const mutated = () => state.calls.some(({ sql }) =>
  /^\s*(UPDATE|INSERT|DELETE)\b/.test(sql) && !sql.includes("INSERT INTO audit_logs"));

describe("archived assignment retention", () => {
  it.each([
    { title: "Overwritten history" },
    { description: "Replacement instructions" },
    { maxScore: 100 },
    { sessionId: 12, termId: 13, classId: 14, subjectId: 15, section: "Red" },
    { issueDate: "2026-01-01", dueDate: "2026-01-08" },
    { teacherId: 16 },
    { status: "DRAFT" },
    { status: "ARCHIVED" },
  ])("rejects archived changes without any mutation: %j", async body => {
    const response = await patch(body);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Archived assignments") });
    expect(mutated()).toBe(false);
    expect(state.calls.map(c => c.sql)).toContain("ROLLBACK");
    expect(state.calls[1]).toMatchObject({ values: [701, 1], sql: expect.stringContaining("FOR UPDATE") });
    expect(release).toHaveBeenCalledOnce();
  });
  it("also protects retained history from its assigned teacher", async () => {
    expect((await patch({ title: "Teacher rewrite" }, "TEACHER")).status).toBe(409);
    expect(mutated()).toBe(false);
  });
  it("preserves teacher authorization before disclosing archival state", async () => {
    state.teacherAssigned = false;
    expect((await patch({ title: "Unassigned teacher rewrite" }, "TEACHER")).status).toBe(403);
    expect(mutated()).toBe(false);
  });
  it("keeps another-school records masked", async () => {
    expect((await patch({ title: "Wrong tenant" }, "SCHOOL_ADMIN", 2)).status).toBe(404);
    expect(state.calls.filter(c => !c.sql.includes("INSERT INTO audit_logs"))).toEqual([]);
    expect((await patch({ title: "Wrong record" }, "SCHOOL_ADMIN", 1, 702)).status).toBe(404);
    expect(mutated()).toBe(false);
  });
  it.each(["PLATFORM_OWNER", "DUAL_OWNER", "PARENT", "STUDENT", "STAFF", "ANONYMOUS"])("denies %s before mutation", async role => {
    expect([401, 403, 404]).toContain((await patch({ title: "Denied" }, role)).status);
    expect(state.calls.filter(c => !c.sql.includes("INSERT INTO audit_logs"))).toEqual([]);
  });
  it("still edits a draft with tenant-scoped UPDATE and transactional audit", async () => {
    state.status = "DRAFT";
    expect((await patch({ title: "Revised draft" })).status).toBe(200);
    const update = state.calls.find(c => c.sql.includes("UPDATE academic_assignments"))!;
    expect(update.sql).toContain("WHERE id=$13 AND school_id=$14");
    expect(update.values.slice(-2)).toEqual([701, 1]);
    expect(state.calls.some(c => c.sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("still archives a published assignment without deleting its contents", async () => {
    state.status = "PUBLISHED";
    expect((await patch({ status: "ARCHIVED" })).status).toBe(200);
    const values = state.calls.find(c => c.sql.includes("UPDATE academic_assignments"))!.values;
    expect(values.slice(6, 12)).toEqual([
      "Retained assignment", "Original instructions", "2026-03-01", "2026-03-08", 20, "ARCHIVED",
    ]);
    expect(state.calls.some(c => /\bDELETE\b/.test(c.sql))).toBe(false);
  });
});
