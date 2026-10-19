import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  roles: [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 1 as number | null, status: "ACTIVE" }],
  authenticated: true,
}));
vi.mock("@workspace/db", () => ({ pool: { query: state.query } }));
vi.mock("../middlewares/auth", async importOriginal => ({
  ...await importOriginal<typeof import("../middlewares/auth")>(),
  requireAuthentication: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!state.authenticated) { res.status(401).json({ error: "Authentication required" }); return; }
    (req as any).edupulseUser = {
      user: { id: 1, clerkUserId: "fixture-user", status: "ACTIVE" }, roles: state.roles,
    };
    next();
  },
}));
import router from "./promotion-expansion";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(router);
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err instanceof AuthError ? err.statusCode : 500).json({ error: String(err) });
});
let server: ReturnType<typeof app.listen>;
let url: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  url = `http://127.0.0.1:${address.port}/school/academics/promotions/readiness`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
beforeEach(() => {
  state.authenticated = true;
  state.roles = [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM academic_sessions")) return { rows: [{ id: 10 }] };
    if (sql.includes("FROM academic_terms")) return { rows: [{ id: 102 }] };
    return { rows: [{ cohortCount: 3, placementConflictCount: 0, studentsWithPublishedResults: 2, publishedResultCount: 5 }] };
  });
});

describe("read-only promotion readiness", () => {
  it("returns evidence without inferring a pass or enabling execution", async () => {
    const res = await fetch(`${url}?schoolId=1&sourceSessionId=10`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({
      executionEnabled: false, policyStatus: "REQUIRES_APPROVED_POLICY",
      thirdTermId: 102, missingPublishedResults: 1, cohortCount: 3,
    });
    expect(state.query.mock.calls.every(([sql]) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
    expect(state.query.mock.calls[0]![1]).toEqual([10, 1]);
    expect(state.query.mock.calls[2]![1]).toEqual([1, 10, 102]);
  });
  it("does not authorize execution even when every student has evidence", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 102 }] })
      .mockResolvedValueOnce({ rows: [{ cohortCount: 3, placementConflictCount: 0, studentsWithPublishedResults: 3, publishedResultCount: 12 }] });
    const body = await (await fetch(`${url}?schoolId=1&sourceSessionId=10`)).json();
    expect(body).toMatchObject({ executionEnabled: false, missingPublishedResults: 0, blockers: [expect.stringContaining("school-approved")] });
  });
  it("does not substitute another term when Third is absent", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ id: 10 }] }).mockResolvedValueOnce({ rows: [] });
    const body = await (await fetch(`${url}?schoolId=1&sourceSessionId=10`)).json();
    expect(body).toMatchObject({ thirdTermId: null, blockers: expect.arrayContaining([expect.stringContaining("Exactly one Third")]) });
    expect(state.query.mock.calls[2]![1]).toEqual([1, 10, null]);
  });
  it.each(["TEACHER", "STAFF", "PARENT", "STUDENT", "PARTNER", "PLATFORM_OWNER"])("denies %s before reading academic data", async role => {
    state.roles = [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" ? null : 1, status: "ACTIVE" }];
    expect([403, 404]).toContain((await fetch(`${url}?schoolId=1&sourceSessionId=10`)).status);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("preserves denial for a dual-role Owner and another-school Admin", async () => {
    state.roles.push({ id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" });
    expect([403, 404]).toContain((await fetch(`${url}?schoolId=1&sourceSessionId=10`)).status);
    state.roles = [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" }];
    expect([403, 404]).toContain((await fetch(`${url}?schoolId=1&sourceSessionId=10`)).status);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("masks a session outside the selected school", async () => {
    state.query.mockResolvedValueOnce({ rows: [] });
    expect((await fetch(`${url}?schoolId=1&sourceSessionId=20`)).status).toBe(404);
    expect(state.query).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid input and unauthenticated requests", async () => {
    expect((await fetch(`${url}?schoolId=1&sourceSessionId=-1`)).status).toBe(400);
    state.authenticated = false;
    expect((await fetch(`${url}?schoolId=1&sourceSessionId=10`)).status).toBe(401);
    expect(state.query).not.toHaveBeenCalled();
  });
});
