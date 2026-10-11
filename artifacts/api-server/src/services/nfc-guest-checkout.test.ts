import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  row: {} as any, query: vi.fn(), release: vi.fn(), initialize: vi.fn(),
  verify: vi.fn(), finalize: vi.fn(), canonical: vi.fn(), conflict: vi.fn(),
  current: true, configured: true,
}));
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => fake.query(...args),
    connect: async () => ({ query: (...args: any[]) => fake.query(...args), release: fake.release }) },
}));
vi.mock("../lib/fee-providers/factory", () => ({
  configuredStudentNfcTestAdapter: () => fake.configured ? {
    provider: "flutterwave", generateReference: () => "student_guest_123456",
    initializePayment: (...args: any[]) => fake.initialize(...args),
    verifyCheckoutStatus: (...args: any[]) => fake.verify(...args),
  } : null,
}));
vi.mock("../lib/student-subscription-return-url", () => ({
  configuredStudentSubscriptionCheckoutBaseUrl: () => "https://guest-test.replit.dev/edupulse",
}));
vi.mock("../lib/student-nfc-obligations", () => ({
  ensureStudentNfcSubscription: (...args: any[]) => fake.canonical(...args),
}));
vi.mock("../lib/student-subscription-billing", async original => ({
  ...await original<any>(),
  findStudentSubscriptionTermPaymentConflict: (...args: any[]) => fake.conflict(...args),
  finalizeVerifiedStudentSubscriptionPayment: (...args: any[]) => fake.finalize(...args),
}));
vi.mock("../lib/schoolLogoStorage", () => ({ canonicalSchoolLogoVersionUrl: vi.fn() }));
import { createGuestNfcCheckout, verifyGuestNfcCheckout, initializeStudentNfcHostedCheckout, reserveGuestNfcPayment } from "./nfc-guest-checkout";

const token = "g".repeat(43);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
  vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "mock-webhook-hash-only");
  fake.configured = true; fake.current = true;
  fake.row = { id: 6, subscription_id: 9, school_id: 44, student_id: 7, academic_term_id: 3,
    academic_session_id: 2, created_by: 10, reference: "NFC_guest_test_reference",
    mode: "FLUTTERWAVE_SANDBOX", status: "PENDING", expires_at: new Date(Date.now() + 86_400_000),
    schoolName: "TEST School", studentIdentifier: "TEST-7", termName: "First Term", sessionName: "TEST Session",
    subscriptionStatus: "pending", verificationStatus: "pending", payment_id: 17,
    paymentReference: "student_guest_123456", failureCode: "GUEST_CHECKOUT_RESERVED",
    expected_allocations: [{ recipientType: "SCHOOL", amountMinor: 200000 },
      { recipientType: "PLATFORM", amountMinor: 300000 }] };
  fake.query.mockReset(); fake.initialize.mockReset(); fake.verify.mockReset(); fake.finalize.mockReset();
  fake.release.mockReset(); fake.conflict.mockReset(); fake.canonical.mockReset();
  fake.conflict.mockResolvedValue(null); fake.canonical.mockResolvedValue({ subscriptionId: 9 });
  fake.initialize.mockResolvedValue({ reference: "student_guest_123456", checkoutUrl: "https://checkout.flutterwave.com/v3/test" });
  fake.verify.mockResolvedValue({ reference: "student_guest_123456", status: "SUCCESSFUL", providerTransactionId: "81" });
  fake.query.mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes("FROM nfc_payment_links l")) return { rows: [{ ...fake.row }] };
    if (sql.includes("SELECT sub.amount")) return { rows: [{ amount: 5000, status: "pending", verification_status: "pending" }] };
    if (sql.includes("FROM academic_terms t")) return { rows: fake.current ? [{ id: 3 }] : [] };
    if (sql.includes("INSERT INTO student_subscription_payments")) return { rows: [{
      id: 17, paymentId: 17, reference: params[6], grossAmountMinor: 500000, currency: "NGN",
    }] };
    if (sql.includes("UPDATE nfc_payment_links")) {
      fake.row.payment_id = params[0]; fake.row.paymentReference = "student_guest_123456"; fake.row.paymentStatus = "PENDING";
    }
    if (sql.includes("SET checkout_url")) {
      fake.row.checkoutUrl = params[0]; fake.row.failureCode = null; return { rows: [{ id: 17 }] };
    }
    if (sql.includes("SELECT id AS \"paymentId\"")) return { rows: [{
      paymentId: 17, reference: fake.row.paymentReference, grossAmountMinor: 500000, currency: "NGN",
      status: fake.row.paymentStatus ?? "PENDING", failureCode: fake.row.failureCode, checkoutUrl: fake.row.checkoutUrl,
    }] };
    if (sql.includes("SET failure_code='GUEST_CHECKOUT_INITIALIZING'")) fake.row.failureCode = "GUEST_CHECKOUT_INITIALIZING";
    if (sql.includes("SET status='RECONCILIATION_REQUIRED'")) fake.row.paymentStatus = "RECONCILIATION_REQUIRED";
    if (sql.includes("SELECT id,reference,gross_amount_minor")) return { rows: [{
      id: 17, reference: "student_guest_123456", gross_amount_minor: 500000, currency: "NGN",
    }] };
    return { rows: [] };
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("Guest NFC TEST checkout and server verification", () => {
  it("does not repeat the provider POST while another guest initialization is in progress", async () => {
    let resolve!: (result: any) => void;
    let started!: () => void;
    const initializing = new Promise<void>(r => { started = r; });
    fake.initialize.mockImplementation(() => {
      started();
      return new Promise(r => { resolve = r; });
    });
    const first = createGuestNfcCheckout(token, "guest@example.test");
    await initializing;
    await createGuestNfcCheckout(token, "guest@example.test");
    expect(fake.initialize).toHaveBeenCalledOnce();
    resolve({ reference: "student_guest_123456", checkoutUrl: "https://checkout.flutterwave.com/v3/test" });
    await first;
  });
  it("refuses to attach a pending live, mismatched or unresolved payment to a TEST link", async () => {
    fake.conflict.mockResolvedValue({ id: 99, subscriptionId: 9, status: "PENDING" });
    await expect(reserveGuestNfcPayment({ query: fake.query }, {
      subscriptionId: 9, schoolId: 44, studentId: 7, sessionId: 2, termId: 3,
    }, fake.row.reference, 10)).rejects.toThrow("not a matching TEST checkout");
    expect(fake.initialize).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it("leaves authenticated checkout persistence to the existing route on an uncertain response", async () => {
    fake.initialize.mockRejectedValue(new Error("Uncertain response"));
    expect(await initializeStudentNfcHostedCheckout(
      { paymentId: 17, reference: "student_guest_123456", grossAmountMinor: 500000, currency: "NGN" },
      "payer@example.test", "https://guest-test.replit.dev/subscriptions", false,
    )).toBeNull();
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("reserves the fixed bound charge before one provider POST and uses a guest callback", async () => {
    expect(await reserveGuestNfcPayment({ query: fake.query }, {
      subscriptionId: 9, schoolId: 44, studentId: 7, sessionId: 2, termId: 3,
    }, fake.row.reference, 10)).toBe(17);
    expect(fake.initialize).not.toHaveBeenCalled();
    const result = await createGuestNfcCheckout(token, "guest@example.test");
    expect(result.status).toBe("PENDING"); expect(result.subscriptionActivated).toBe(false);
    expect(result.receiptReference).toBeNull(); expect(result.amountMinor).toBe(500000);
    expect(result.expectedAllocations).toEqual(fake.row.expected_allocations);
    expect(fake.initialize).toHaveBeenCalledWith({
      reference: "student_guest_123456", amountMinor: 500000, currency: "NGN", email: "guest@example.test",
      returnUrl: `https://guest-test.replit.dev/edupulse/nfc/pay#${token}`,
    });
    const insert = fake.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO student_subscription_payments"))!;
    expect(insert[1].slice(0, 6)).toEqual([9, 44, 7, 2, 3, 10]);
    expect(insert[1][7]).toBe(`guest:${fake.row.reference}`);
    expect(fake.finalize).not.toHaveBeenCalled();
  });
  it("reuses the persisted checkout without another provider POST", async () => {
    await createGuestNfcCheckout(token, "guest@example.test");
    const result = await createGuestNfcCheckout(token, "different@example.test");
    expect(result.checkoutUrl).toBe("https://checkout.flutterwave.com/v3/test");
    expect(fake.initialize).toHaveBeenCalledTimes(1);
  });
  it("a retry during the first provider POST never starts another checkout", async () => {
    let resolve!: (value: any) => void;
    fake.initialize.mockImplementation(() => new Promise(r => { resolve = r; }));
    const first = createGuestNfcCheckout(token, "guest@example.test");
    await vi.waitFor(() => expect(fake.initialize).toHaveBeenCalledTimes(1));
    expect((await createGuestNfcCheckout(token, "guest@example.test")).checkoutUrl).toBeNull();
    expect(fake.initialize).toHaveBeenCalledTimes(1);
    resolve({ reference: "student_guest_123456", checkoutUrl: "https://checkout.flutterwave.com/v3/test" });
    await first;
  });
  it("keeps a lost provider response under reconciliation and blocks reinitialization", async () => {
    fake.initialize.mockRejectedValue(new Error("Timeout after provider acceptance"));
    expect((await createGuestNfcCheckout(token, "guest@example.test")).status).toBe("RECONCILIATION_REQUIRED");
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow();
    expect(fake.initialize).toHaveBeenCalledTimes(1); expect(fake.finalize).not.toHaveBeenCalled();
  });
  it.each(["CANCELLED", "SIMULATED_SUCCESS"])("rejects terminal %s links before payment writes", async status => {
    fake.row.status = status;
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow();
    expect(fake.initialize).not.toHaveBeenCalled();
  });
  it("rejects expiry and simulations", async () => {
    fake.row.expires_at = new Date(0);
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow();
    fake.row.expires_at = new Date(Date.now() + 86400000); fake.row.mode = "DEVELOPMENT_SIMULATION";
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow();
    expect(fake.initialize).not.toHaveBeenCalled();
  });
  it("rejects a noncurrent term without reserving payment", async () => {
    fake.current = false;
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow("active current term");
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it("blocks an existing term payment rather than creating a second charge", async () => {
    fake.conflict.mockResolvedValue({ id: 99 });
    await expect(reserveGuestNfcPayment({ query: fake.query }, {
      subscriptionId: 9, schoolId: 44, studentId: 7, sessionId: 2, termId: 3,
    }, fake.row.reference, 10)).rejects.toThrow("existing term payment");
    expect(fake.initialize).not.toHaveBeenCalled();
  });
  it.each(["configuration", "hash", "deployment"])("fails closed for missing/unsafe %s", async cause => {
    if (cause === "configuration") fake.configured = false;
    if (cause === "hash") vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "");
    if (cause === "deployment") vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    await expect(createGuestNfcCheckout(token, "guest@example.test")).rejects.toThrow();
    expect(fake.query).not.toHaveBeenCalled(); expect(fake.initialize).not.toHaveBeenCalled();
  });
  it("uses persisted binding and independent verification before invoking the existing finalizer", async () => {
    fake.row.payment_id = 17; fake.row.paymentReference = "student_guest_123456";
    fake.finalize.mockImplementation(async () => {
      fake.row.subscriptionStatus = "active"; fake.row.verificationStatus = "verified";
      fake.row.receiptSnapshot = { test: true };
    });
    const result = await verifyGuestNfcCheckout(token);
    expect(fake.verify).toHaveBeenCalledWith({ reference: "student_guest_123456", amountMinor: 500000, currency: "NGN" });
    expect(fake.finalize).toHaveBeenCalledTimes(1); expect(result.status).toBe("PAID");
    expect(result.receiptReference).toBe("student_guest_123456"); expect(result.settlementStatus).toBe("UNVERIFIED");
    await verifyGuestNfcCheckout(token);
    expect(fake.finalize).toHaveBeenCalledTimes(1); expect(fake.verify).toHaveBeenCalledTimes(1);
    const read = fake.query.mock.calls.find(([sql]) => sql.includes("SELECT id,reference,gross_amount_minor"))!;
    expect(read[1]).toEqual([17, 9, 44, 7, 2, 3]);
  });
  it("never finalizes an unknown or mismatched provider outcome", async () => {
    fake.row.payment_id = 17; fake.row.paymentReference = "student_guest_123456";
    fake.verify.mockRejectedValue(new Error("Amount/reference mismatch or provider unavailable"));
    await expect(verifyGuestNfcCheckout(token)).rejects.toThrow("not yet verified");
    expect(fake.finalize).not.toHaveBeenCalled();
    expect(fake.row.subscriptionStatus).toBe("pending");
  });
});
