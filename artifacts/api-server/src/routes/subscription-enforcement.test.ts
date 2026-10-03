import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  read: vi.fn(),
  reconcile: vi.fn(),
  summary: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: state.query } }));
vi.mock("../services/subscription-enforcement", () => ({
  readSchoolSubscription: vi.fn(),
  readSchoolEnforcementSummary: state.summary,
}));
vi.mock("../services/school-subscription-lock", () => ({
  readManualSchoolState: state.read,
  changeManualSchoolLock: state.reconcile,
}));
vi.mock("../middlewares/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: any, _res: any, next: any) => {
      req.edupulseUser = {
        user: { id: 1, clerkUserId: "mock-owner", email: "mock@example.com", status: "ACTIVE" },
        roles: [{ id: 1, role: state.role, schoolId: state.role === "PLATFORM_OWNER" ? null : 1, status: "ACTIVE" }],
      };
      next();
    },
  };
});
import router from "./subscription-enforcement";

describe("subscription enforcement Owner HTTP boundary (mocked identity)", () => {
  let server: Server, origin: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 400).json({ error: err.message }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = "PLATFORM_OWNER";
    state.query.mockImplementation(async (_sql, args) => ({ rows: [{ id: args?.[0] ?? 1 }] }));
    state.read.mockImplementation(async () => ({ manualVersion: 4, schoolLocked: false, schoolEnforcementStatus: "ACTIVE" }));
    state.summary.mockImplementation(async (_db, schoolId) => ({ schoolId, schoolEnforcementStatus: "ACTIVE", manualVersion: 4 }));
    state.reconcile.mockImplementation(async (schoolId, locked) => ({ schoolId, changed: true, state: locked ? "LOCKED" : "ACTIVE", manualVersion: 5 }));
  });
  const post = (body: unknown, action = "lock") => fetch(`${origin}/api/subscription-enforcement/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const selection = (ids: number[], confirmed = true) => ({ confirmed, schools: ids.map(schoolId => ({ schoolId, expectedVersion: 4 })) });
  it("locks one explicitly confirmed school with authenticated actor and independent manual control", async () => {
    expect((await post(selection([1]))).status).toBe(200);
    expect(state.reconcile).toHaveBeenCalledWith(1, true, expect.objectContaining({ id: 1 }), 4, undefined, undefined);
  });
  it("unlocks with the same authenticated permission, optional reason and explicit version", async () => {
    const response = await post({ ...selection([1]), reason: "Corrected coverage" }, "unlock");
    expect(response.status).toBe(200);
    expect(state.reconcile).toHaveBeenCalledWith(1, false, expect.objectContaining({ id: 1 }), 4, "Corrected coverage", undefined);
    expect((await response.json() as any[])[0].state).toBe("ACTIVE");
  });
  it("processes multiple schools and returns one result per selection", async () => {
    const response = await post(selection([1, 2]));
    expect(response.status).toBe(200);
    const results = await response.json() as Array<{ schoolId: number }>;
    expect(results.map(r => r.schoolId)).toEqual([1, 2]);
  });
  it.each(["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT", "PARTNER", "ACCOUNTANT", "INTERNAL_OFFICER", "COMPANY_ACCOUNTANT"])("rejects %s lock and unlock without reading or changing schools", async role => {
    state.role = role;
    for (const action of ["lock", "unlock"]) expect((await post(selection([1]), action)).status).toBe(403);
    expect(state.read).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and rejects duplicate selections", async () => {
    expect((await post(selection([1], false))).status).toBe(400);
    expect((await post(selection([1, 1]))).status).toBe(400);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("validates every manual version before changing any selected school", async () => {
    state.read.mockImplementation(async (_db, schoolId) => ({ manualVersion: schoolId === 2 ? 5 : 4 }));
    expect((await post(selection([1, 2]))).status).toBe(409);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("reports a per-school transaction failure without hiding successful results", async () => {
    state.reconcile.mockImplementation(async schoolId => {
      if (schoolId === 2) throw new Error("transaction unavailable");
      return { schoolId, changed: true, state: "LOCKED", manualVersion: 5 };
    });
    const response = await post(selection([1, 2]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { schoolId: 1, changed: true, state: "LOCKED", manualVersion: 5 },
      { schoolId: 2, changed: false, state: "FAILED", error: "The outcome could not be confirmed. Refresh school status before retrying." },
    ]);
  });
  it("allows bulk unlock and returns independent ACTIVE results", async () => {
    const response = await post(selection([1, 2]), "unlock");
    expect(response.status).toBe(200);
    expect((await response.json() as any[]).map(r => r.state)).toEqual(["ACTIVE", "ACTIVE"]);
  });
  it("rejects the old coupled term-based contract and excessive reasons", async () => {
    expect((await post({ confirmed: true, schools: [{ schoolId: 1, termId: 10 }] })).status).toBe(400);
    expect((await post({ ...selection([1]), reason: "x".repeat(501) })).status).toBe(400);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("requires confirmation for unlock too", async () => {
    expect((await post(selection([1], false), "unlock")).status).toBe(400);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("does not require calendar, grace, payment or a student restriction for explicit control", async () => {
    expect((await post(selection([1]))).status).toBe(200);
    expect(state.summary).not.toHaveBeenCalled();
  });
  it("does not allow School A's Admin to read School B overview or audits", async () => {
    state.role = "SCHOOL_ADMIN";
    for (const endpoint of ["", "/audit"]) {
      expect((await fetch(`${origin}/api/subscription-enforcement${endpoint}?schoolId=2`)).status).toBe(404);
    }
    expect(state.query).not.toHaveBeenCalled();
  });
  it("allows own-school readonly overview and immutable audit reads", async () => {
    state.role = "SCHOOL_ADMIN";
    expect((await fetch(`${origin}/api/subscription-enforcement?schoolId=1`)).status).toBe(200);
    expect((await fetch(`${origin}/api/subscription-enforcement/audit?schoolId=1`)).status).toBe(200);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
});