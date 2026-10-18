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
vi.mock("../lib/fee-providers/factory", () => ({ configuredStudentNfcTestAdapter: vi.fn() }));
vi.mock("../lib/student-nfc-obligations", async original => ({
  ...await original<any>(), ensureStudentNfcSubscription: async () => ({ subscriptionId: 9 }),
}));
vi.mock("../lib/student-subscription-return-url", () => ({
  configuredStudentSubscriptionCheckoutBaseUrl: () => "https://development.example.test",
}));
vi.mock("../services/nfc-payment-links", async () => {
  const real = await vi.importActual<any>("../services/nfc-payment-links");
  return { ...real, expectedNfcAllocations: vi.fn(async () => [{ recipientType: "SCHOOL", amountMinor: 200000 }, { recipientType: "PLATFORM", amountMinor: 300000 }]) };
});
import router from "./nfc-payment-links";
import { configuredStudentNfcTestAdapter } from "../lib/fee-providers/factory";

describe("NFC link routed input and operational authorization", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
    vi.stubEnv("SESSION_SECRET", "private-development-test-signing-only");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "private-mock-webhook-hash");
    vi.mocked(configuredStudentNfcTestAdapter).mockReset();
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
  it.each(["view", "simulate", "checkout", "verify"])("rejects malformed public %s tokens without logging/exposing them", async action => {
    const response = await post(`/public/nfc-payment-links/${action}`, { token: "invalid",
      ...(action === "simulate" ? { outcome: "SUCCESS" } : {}),
      ...(action === "checkout" ? { email: "guest@example.test" } : {}) });
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
  it.each(["checkout", "verify"])("rejects forged payment fields on public %s", async action => {
    const response = await post(`/public/nfc-payment-links/${action}`, {
      token: "x".repeat(43), amountMinor: 1, status: "PAID", subscriptionId: 999, providerTransactionId: "1",
      ...(action === "checkout" ? { email: "guest@example.test" } : {}),
    });
    expect(response.status).toBe(400); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["checkout", "verify"])("disables public %s in a published deployment before database access", async action => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect((await post(`/public/nfc-payment-links/${action}`, {
      token: "x".repeat(43), ...(action === "checkout" ? { email: "guest@example.test" } : {}),
    })).status).toBe(503);
    expect(state.query).not.toHaveBeenCalled();
  });
  const validRow = () => ({
    id: 6, reference: "NFC_valid_test_reference", schoolName: "TEST School", studentIdentifier: "TEST-7",
    termName: "First Term", sessionName: "TEST Session", status: "PENDING", mode: "FLUTTERWAVE_SANDBOX",
    expires_at: new Date(Date.now() + 86400000), payment_id: 17, paymentReference: "student_valid_test_payment",
    subscriptionStatus: "pending", verificationStatus: "pending",
    expected_allocations: [{ recipientType: "SCHOOL", amountMinor: 200000 }, { recipientType: "PLATFORM", amountMinor: 300000 }],
  });
  it("reports missing TEST/webhook configuration without inserting a link or payment", async () => {
    const response = await post("/subscriptions/9/payment-link", { termId: 3, mode: "FLUTTERWAVE_SANDBOX" }, true);
    expect(response.status).toBe(503);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it("reserves payment before inserting the sandbox link and respects the existing isolation CHECK", async () => {
    vi.mocked(configuredStudentNfcTestAdapter).mockReturnValue({
      provider: "flutterwave", generateReference: () => "student_valid_test_payment",
    } as any);
    let saved: any;
    const order: string[] = [];
    state.query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes("FROM student_subscription_terms b")) return { rows: [state.scope] };
      if (sql.includes("SELECT sub.amount")) return { rows: [{ amount: 5000, status: "pending", verification_status: "pending" }] };
      if (sql.includes('SELECT t.id,t.name AS "termName" FROM academic_terms')) return { rows: [{ id: 3, termName: "FIRST" }] };
      if (sql.includes("INSERT INTO student_subscription_payments")) { order.push("payment"); return { rows: [{ id: 17 }] }; }
      if (sql.includes("INSERT INTO nfc_payment_links")) {
        // Reproduce PostgreSQL's nfc_payment_links_isolation rejection, not a permissive DB mock.
        if (params[8] === "FLUTTERWAVE_SANDBOX" && params[9] == null) {
          throw Object.assign(new Error("nfc_payment_links_isolation"), { code: "23514" });
        }
        expect(params[9]).toBe(17);
        order.push("link"); saved = { ...validRow(), reference: params[6] };
        return { rows: [saved] };
      }
      if (sql.includes("FROM nfc_payment_links l")) return { rows: saved ? [saved] : [] };
      return { rows: [] };
    });
    const response = await post("/subscriptions/9/payment-link", { termId: 3, mode: "FLUTTERWAVE_SANDBOX" }, true);
    expect(response.status).toBe(200); expect(order).toEqual(["payment", "link"]);
    const body = await response.json() as any;
    expect(body.amountMinor).toBe(500000); expect(body.status).toBe("PENDING");
    expect(body.expectedAllocations).toEqual([]);
    expect(body.subscriptionActivated).toBe(false); expect(body.receiptReference).toBeNull();
    expect(new URL(body.paymentUrl).hash.length).toBe(44);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("COMMIT"))).toBe(true);
  });
  it.each(["PENDING", "EXPIRED", "PAID"] as const)("retrieves an anonymous valid %s link without requiring Admin login", async status => {
    const row = validRow();
    if (status === "EXPIRED") row.expires_at = new Date(0);
    if (status === "PAID") { row.subscriptionStatus = "active"; row.verificationStatus = "verified"; }
    state.query.mockResolvedValue({ rows: [row] });
    const response = await post("/public/nfc-payment-links/view", { token: "x".repeat(43) });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.status).toBe(status); expect(body.subscriptionActivated).toBe(status === "PAID");
    expect(body.amountDueMinor).toBe(status === "PAID" ? 0 : 500000);
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(([sql]) => /UPDATE|INSERT/.test(sql))).toBe(false);
  });
  it.each(["binding", "reference", "allocations", "expiry"])("reports damaged %s instructions as review-required instead of HTTP 500", async cause => {
    const row: any = validRow();
    if (cause === "binding") row.paymentReference = null;
    if (cause === "reference") row.reference = "";
    if (cause === "allocations") row.expected_allocations = null;
    if (cause === "expiry") row.expires_at = "invalid";
    state.query.mockResolvedValue({ rows: [row] });
    expect((await post("/public/nfc-payment-links/view", { token: "x".repeat(43) })).status).toBe(409);
  });
});
