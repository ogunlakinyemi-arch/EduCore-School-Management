import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDirectStaffRule, isStaffSubscriptionOperation, readStaffSubscriptionAccess,
  STAFF_DIRECT_RULE, staffSubscriptionSchools,
} from "./staff-subscription-access";

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, unavailable: false }));
const query = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ pool: { query } }));
vi.mock("./subscription-enforcement", () => ({ assertSubscriptionAccess: vi.fn() }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class extends Error {
    constructor(public statusCode: number, message: string, public eventType: string) { super(message); }
  },
}));
import { enforceRequestSubscription } from "./subscription-request-access";

const role = (name = "TEACHER", schoolId: number | null = 1, status = "ACTIVE") => ({ role: name, schoolId, status, id: 1 });
const actor = (...roles: ReturnType<typeof role>[]) => ({ user: { id: 9 }, roles });
const request = (path: string, method = "POST", schoolId?: number) => ({
  originalUrl: path, method, query: schoolId ? { schoolId } : {}, body: {}, log: { error: vi.fn() },
}) as any;
const paid = { employeeId: 8, termId: 11, subscriptionId: 14, status: "PAID", verified: true };

beforeEach(() => {
  state.row = { ...paid, status: "UNPAID", verified: false }; state.unavailable = false;
  query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('AS "employeeId"')) {
      if (state.unavailable) throw new Error("offline fixture");
      return { rows: state.row ? [state.row] : [] };
    }
    return { rows: [] };
  });
});

describe("staff fixed direct billing policy", () => {
  it("fixes NGN 2,000 with no school, split or BRO share", () => {
    expect(isDirectStaffRule(STAFF_DIRECT_RULE)).toBe(true);
    expect(isDirectStaffRule({ ...STAFF_DIRECT_RULE, priceMinor: 320000 })).toBe(false);
    expect(isDirectStaffRule({ ...STAFF_DIRECT_RULE, schoolShareMinor: 80000 })).toBe(false);
    expect(isDirectStaffRule({ ...STAFF_DIRECT_RULE, partnerCommissionMinor: 10000 })).toBe(false);
  });
  it.each(["SCHOOL_ADMIN", "ACCOUNTANT", "PARENT", "STUDENT", "PARTNER", "DRIVER", "DEVICE_ACTIVATION_OFFICER", "COMPANY_ACCOUNTANT"])(
    "does not turn a %s role into a staff subscription requirement", name => {
      expect(staffSubscriptionSchools(actor(role(name)))).toEqual([]);
    });
  it("exempts Owner and same-school finance but not an unrelated school's teacher", () => {
    expect(staffSubscriptionSchools(actor(role(), role("PLATFORM_OWNER", null)))).toEqual([]);
    expect(staffSubscriptionSchools(actor(role(), role("SCHOOL_ADMIN")))).toEqual([]);
    expect(staffSubscriptionSchools(actor(role("STAFF"), role("ACCOUNTANT")))).toEqual([]);
    expect(staffSubscriptionSchools(actor(role(), role("SCHOOL_ADMIN", 2)))).toEqual([1]);
    expect(staffSubscriptionSchools(actor(role("TEACHER", 1, "INACTIVE")))).toEqual([]);
  });
});

describe("fresh verified term coverage", () => {
  it.each(["UNPAID", "PENDING", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"])(
    "keeps %s restricted", async status => {
      state.row = { ...paid, status };
      expect(await readStaffSubscriptionAccess({ query } as any, 9, 1)).toMatchObject({ restricted: true });
    });
  it("does not trust a PAID status without the verified payment predicate", async () => {
    state.row = { ...paid, verified: false };
    expect(await readStaffSubscriptionAccess({ query } as any, 9, 1)).toMatchObject({ restricted: true, status: "UNPAID" });
    expect(query.mock.calls[0][0]).toContain("p.provider='FLUTTERWAVE'");
    expect(query.mock.calls[0][0]).toContain("p.provider_mode='SANDBOX' AND $3<>'production'");
    expect(query.mock.calls[0][0]).toContain("p.academic_term_id=t.id");
    expect(query.mock.calls[0][0]).toContain("p.gross_amount_minor=sub.price_minor");
  });
  it("restores after verified success and re-restricts a new or expired term without a manual reset", async () => {
    expect((await readStaffSubscriptionAccess({ query } as any, 9, 1)).restricted).toBe(true);
    state.row = { ...paid };
    expect((await readStaffSubscriptionAccess({ query } as any, 9, 1)).restricted).toBe(false);
    state.row = { ...paid, termId: 12, subscriptionId: null, status: null, verified: false };
    expect(await readStaffSubscriptionAccess({ query } as any, 9, 1)).toMatchObject({ restricted: true, termId: 12, status: "UNPAID" });
    state.row = { ...paid, termId: null };
    expect(await readStaffSubscriptionAccess({ query } as any, 9, 1)).toMatchObject({ restricted: true, status: "EXPIRED" });
  });
  it("never grants access for an absent/inactive employee and does not swallow infrastructure failure", async () => {
    state.row = null;
    expect((await readStaffSubscriptionAccess({ query } as any, 9, 1)).restricted).toBe(true);
    state.unavailable = true;
    await expect(readStaffSubscriptionAccess({ query } as any, 9, 1)).rejects.toThrow("offline");
  });
});

describe("API operational policy", () => {
  it.each([
    "/api/academic/assignments", "/api/academic/assessments/2", "/api/school/attendance/manual",
    "/api/schools/1/lesson-notes/4/submit", "/api/schools/1/curriculum/3/progress",
    "/api/library/loans", "/api/operations/inventory", "/api/transport/assignments",
    "/api/exam-record/sheet/submit", "/api/exam-record/class-comment",
  ])("denies unpaid staff mutation %s before its handler", async path => {
    expect(isStaffSubscriptionOperation(path, "POST")).toBe(true);
    await expect(enforceRequestSubscription(request(path), actor(role()) as any))
      .rejects.toMatchObject({ statusCode: 403, eventType: "STAFF_SUBSCRIPTION_REQUIRED" });
  });
  it.each([
    ["/api/staff-nfc/subscriptions/14/checkout", "POST"], ["/api/staff-nfc/payments/verify", "POST"],
    ["/api/staff-nfc/payments/2/receipt", "GET"], ["/api/auth/me", "GET"],
    ["/api/communication/threads/4/replies", "POST"], ["/api/support", "POST"],
    ["/api/schools/1/lesson-notes", "GET"], ["/api/parent/fees/invoices/2/bank-transfers", "POST"],
  ])("preserves essential or read-only access %s %s", async (path, method) => {
    expect(isStaffSubscriptionOperation(path, method)).toBe(false);
    await expect(enforceRequestSubscription(request(path, method), actor(role()) as any)).resolves.toBeUndefined();
  });
  it("permits verified staff but never makes an infrastructure failure look paid", async () => {
    state.row = { ...paid };
    await expect(enforceRequestSubscription(request("/api/academic/assignments"), actor(role()) as any)).resolves.toBeUndefined();
    state.unavailable = true;
    await expect(enforceRequestSubscription(request("/api/academic/assignments"), actor(role()) as any))
      .rejects.toMatchObject({ statusCode: 503, eventType: "STAFF_SUBSCRIPTION_UNAVAILABLE" });
  });
  it("uses the URL school over a spoofed query, isolates schools and preserves other roles", async () => {
    await expect(enforceRequestSubscription(request("/api/schools/1/lesson-notes", "POST", 2), actor(role()) as any))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(enforceRequestSubscription(request("/api/academic/assignments", "POST", 2),
      actor(role(), role("SCHOOL_ADMIN", 2)) as any)).resolves.toBeUndefined();
    for (const name of ["SCHOOL_ADMIN", "ACCOUNTANT", "PARENT", "STUDENT", "PLATFORM_OWNER"]) {
      await expect(enforceRequestSubscription(request("/api/academic/assignments"),
        actor(role(name, name === "PLATFORM_OWNER" ? null : 1)) as any)).resolves.toBeUndefined();
    }
  });
});
