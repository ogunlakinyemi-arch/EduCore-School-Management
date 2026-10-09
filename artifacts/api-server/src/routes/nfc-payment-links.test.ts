import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), authorize: vi.fn(),
  scope: { schoolId: 44, studentId: 7, subscriptionId: 9, termId: 3, sessionId: 2, amount: 5000,
    subscriptionStatus: "pending", verificationStatus: "pending", legacyInvoiceId: null },
}));
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => state.query(...args),
    connect: async () => ({ query: (...args: any[]) => state.query(...args), release: state.release }) },
}));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error { constructor(public status: number, message: string) { super(message); } }
  return {
    AuthError, getUserContext: () => ({ user: { id: 10 } }),
    assertSchoolOperationalAccess: (...args: any[]) => state.authorize(...args),
    requireAuthentication: () => (req: any, res: any, next: any) =>
      req.headers["x-test-signed-in"] ? next() : res.status(401).json({ error: "Authentication required" }),
  };
});
vi.mock("../lib/fee-providers/factory", () => ({ configuredTestAdapter: vi.fn() }));
vi.mock("../lib/student-subscription-return-url", () => ({
  configuredStudentSubscriptionCheckoutBaseUrl: () => "https://development.example.test",
}));
vi.mock("../services/nfc-payment-links", async () => {
  const real = await vi.importActual<any>("../services/nfc-payment-links");
  return { ...real, expectedNfcAllocations: vi.fn(async () => [{ recipientType: "SCHOOL", amountMinor: 200000 }, { recipientType: "PLATFORM", amountMinor: 300000 }]) };
});
import router from "./nfc-payment-links";

describe("NFC link routed input and operational authorization", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
    vi.stubEnv("SESSION_SECRET", "private-development-test-signing-only");
    state.query.mockReset(); state.release.mockReset(); state.authorize.mockReset();
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM student_subscription_terms b")) return { rows: [state.scope] };
      return { rows: [] };
    });
    const app = express().use(express.json()).use("/api", router);
    app.use((error: any, _req: any, res: any, _next: any) => {
      res.status(error.status ?? 500).json({ error: error.message });
    });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
    });
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs();
  });
  const post = (path: string, body: any, signedIn = false) => fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(signedIn ? { "x-test-signed-in": "1" } : {}) }, body: JSON.stringify(body),
  });
  it("requires authentication before starting staff generation", async () => {
    expect((await post("/subscriptions/9/payment-link", { termId: 3, mode: "DEVELOPMENT_SIMULATION" })).status).toBe(401);
    expect(state.query).not.toHaveBeenCalled();
  });
  it.each([
    { termId: 3, mode: "DEVELOPMENT_SIMULATION", amount: 1 },
    { termId: 3, mode: "LIVE" },
    { termId: "3", mode: "DEVELOPMENT_SIMULATION" },
    { termId: 0, mode: "DEVELOPMENT_SIMULATION" },
  ])("rejects invalid generation body without database writes: %j", async body => {
    expect((await post("/subscriptions/9/payment-link", body, true)).status).toBe(400);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("uses only the existing SCHOOL_ADMIN/ACCOUNTANT operational authorizer", async () => {
    state.authorize.mockImplementation(() => { throw Object.assign(new Error("Resource not found"), { status: 404 }); });
    expect((await post("/subscriptions/9/payment-link", { termId: 3, mode: "DEVELOPMENT_SIMULATION" }, true)).status).toBe(404);
    expect(state.authorize).toHaveBeenCalledWith(expect.anything(), 44, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
    expect(state.release).toHaveBeenCalledOnce();
  });
  it("masks a nonexistent selected-term binding", async () => {
    state.query.mockResolvedValue({ rows: [] });
    expect((await post("/subscriptions/9/payment-link", { termId: 999, mode: "DEVELOPMENT_SIMULATION" }, true)).status).toBe(404);
    expect(state.authorize).not.toHaveBeenCalled();
  });
  it("rejects a signed-in request on a published deployment", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect((await post("/subscriptions/9/payment-link", { termId: 3, mode: "DEVELOPMENT_SIMULATION" }, true)).status).toBe(503);
    expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["view", "simulate"])("rejects malformed public %s tokens without logging/exposing them", async action => {
    const response = await post(`/public/nfc-payment-links/${action}`, { token: "invalid", ...(action === "simulate" ? { outcome: "SUCCESS" } : {}) });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Invalid payment-link request" });
    expect(state.query).not.toHaveBeenCalled();
  });
  it("allows an anonymous lookup but masks a valid-format unknown token", async () => {
    state.query.mockResolvedValue({ rows: [] });
    const response = await post("/public/nfc-payment-links/view", { token: "x".repeat(43) });
    expect(response.status).toBe(404);
    expect(state.query.mock.calls[0][1][0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not accept amount/status parameters on a public simulation", async () => {
    expect((await post("/public/nfc-payment-links/simulate", { token: "x".repeat(43), outcome: "SUCCESS", amountMinor: 1, status: "PAID" })).status).toBe(400);
    expect(state.query).not.toHaveBeenCalled();
  });
});
