import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  read: vi.fn(),
  reconcile: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: state.query } }));
vi.mock("../services/subscription-enforcement", () => ({
  readSchoolSubscription: state.read,
  reconcileSchoolSubscription: state.reconcile,
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
    state.read.mockImplementation(async (_db, schoolId) => ({ schoolId, termId: 10, restrictedStudentIds: [3] }));
    state.reconcile.mockImplementation(async schoolId => ({ schoolId, changed: true, state: "LOCKED", summary: null }));
  });
  const post = (body: unknown) => fetch(`${origin}/api/subscription-enforcement/lock`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const selection = (ids: number[], confirmed = true) => ({ confirmed, schools: ids.map(schoolId => ({ schoolId, termId: 10 })) });
  it("processes one explicitly confirmed school with the authenticated actor and shared mechanism", async () => {
    expect((await post(selection([1]))).status).toBe(200);
    expect(state.reconcile).toHaveBeenCalledWith(1, "OWNER_MANUAL_LOCK", expect.objectContaining({ id: 1 }), 10);
  });
  it("processes multiple schools and returns one result per selection", async () => {
    const response = await post(selection([1, 2]));
    expect(response.status).toBe(200);
    const results = await response.json() as Array<{ schoolId: number }>;
    expect(results.map(r => r.schoolId)).toEqual([1, 2]);
  });
  it("rejects School Admin attempts without reading or changing schools", async () => {
    state.role = "SCHOOL_ADMIN";
    expect((await post(selection([1]))).status).toBe(403);
    expect(state.read).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and rejects duplicate selections", async () => {
    expect((await post(selection([1], false))).status).toBe(400);
    expect((await post(selection([1, 1]))).status).toBe(400);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("validates every term before changing any selected school", async () => {
    state.read.mockImplementation(async (_db, schoolId) => ({ termId: schoolId === 2 ? 11 : 10 }));
    expect((await post(selection([1, 2]))).status).toBe(409);
    expect(state.reconcile).not.toHaveBeenCalled();
  });
  it("reports a per-school transaction failure without hiding successful results", async () => {
    state.reconcile.mockImplementation(async schoolId => {
      if (schoolId === 2) throw new Error("transaction unavailable");
      return { schoolId, changed: true, state: "LOCKED", summary: null };
    });
    const response = await post(selection([1, 2]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { schoolId: 1, changed: true, state: "LOCKED", summary: null },
      { schoolId: 2, changed: false, state: "FAILED", summary: null },
    ]);
  });
});