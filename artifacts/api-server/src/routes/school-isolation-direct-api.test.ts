import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real routes and authorization middleware; only external identity, persistence,
// and subscription infrastructure are mocked. No app startup/worker is imported.
const state = vi.hoisted(() => ({
  signedIn: true, role: "SCHOOL_ADMIN", schoolId: 101,
  status: "ACTIVE", userStatus: "ACTIVE", dualOwner: false,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.signedIn ? "mock-clerk-user" : null }),
  clerkClient: { users: { getUser: vi.fn(() => { throw Error("Unexpected identity request"); }) } },
}));
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM app_users")) return { rows: [{
        id: 7, clerkUserId: "mock-clerk-user", email: "scope@example.test",
        firstName: "Scope", lastName: "Test", phone: null, status: state.userStatus,
      }] };
      if (sql.includes("FROM school_memberships")) {
        const roles = [{ id: 1, role: state.role,
          schoolId: ["PLATFORM_OWNER", "PARTNER", "COMPANY_ACCOUNTANT"].includes(state.role) ? null : state.schoolId,
          status: state.status }];
        if (state.dualOwner) roles.push({ id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" });
        return { rows: roles.filter(r => r.status === "ACTIVE") };
      }
      if (sql.includes("FROM academic_sessions")) return { rows: [{
        id: Number(values[0]) * 10, schoolId: Number(values[0]), name: `School ${values[0]} session`,
      }] };
      return { rows: [] }; // Includes denial audit writes, all in-memory.
    }),
    connect: vi.fn(() => { throw Error("No database writes may be reached in this matrix"); }),
  },
}));
vi.mock("../services/subscription-request-access", () => ({ enforceRequestSubscription: vi.fn() }));
import academic from "./academic";
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api", academic);
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No local test port");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
beforeEach(() => {
  Object.assign(state, { signedIn: true, role: "SCHOOL_ADMIN", schoolId: 101,
    status: "ACTIVE", userStatus: "ACTIVE", dualOwner: false, queries: [] });
});
const roles = ["PLATFORM_OWNER", "SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF",
  "DRIVER", "PARENT", "STUDENT", "PARTNER", "DEVICE_ACTIVATION_OFFICER", "COMPANY_ACCOUNTANT"];
describe("Direct API school isolation with real authorization middleware", () => {
  for (const ownSchool of [101, 202]) for (const role of roles) {
    it(`${role} in school ${ownSchool}: applies same-school role permissions and masks the other school`, async () => {
      state.role = role; state.schoolId = ownSchool;
      for (const target of [101, 202]) {
        state.queries = [];
        const response = await fetch(`${base}/academic-sessions?schoolId=${target}`);
        const allowed = role === "PLATFORM_OWNER" ||
          target === ownSchool && ["SCHOOL_ADMIN", "TEACHER"].includes(role);
        expect(response.status).toBe(allowed ? 200 : 404);
        const reads = state.queries.filter(q => q.sql.includes("FROM academic_sessions"));
        if (allowed) {
          expect(await response.json()).toEqual([{ id: target * 10, schoolId: target, name: `School ${target} session` }]);
          expect(reads[0].values[0]).toBe(target);
        } else {
          expect(await response.json()).toMatchObject({ error: "Resource not found" });
          expect(reads).toHaveLength(0);
        }
      }
    });
  }
  it.each(roles.filter(role => role !== "SCHOOL_ADMIN"))("%s cannot create an academic session", async role => {
    state.role = role;
    const response = await fetch(`${base}/academic-sessions?schoolId=101`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test year", startDate: "2026-09-01", endDate: "2027-07-31" }),
    });
    expect(response.status).toBe(404);
    expect(state.queries.some(q => q.sql.includes("INSERT INTO academic_sessions"))).toBe(false);
  });
  it("a dual-role Owner remains unable to perform school operations", async () => {
    state.dualOwner = true;
    const response = await fetch(`${base}/academic-sessions?schoolId=101`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test year", startDate: "2026-09-01", endDate: "2027-07-31" }),
    });
    expect(response.status).toBe(404);
  });
  it.each(["inactive membership", "inactive user", "anonymous"])("denies %s before reading academic data", async kind => {
    if (kind === "inactive membership") state.status = "INACTIVE";
    if (kind === "inactive user") state.userStatus = "INACTIVE";
    if (kind === "anonymous") state.signedIn = false;
    const response = await fetch(`${base}/academic-sessions?schoolId=101`);
    expect(response.status).toBe(kind === "anonymous" ? 401 : kind === "inactive user" ? 403 : 404);
    expect(state.queries.some(q => q.sql.includes("FROM academic_sessions"))).toBe(false);
  });
});
