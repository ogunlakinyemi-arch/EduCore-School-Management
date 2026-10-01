import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  payment: {} as Record<string, any>,
  isPlatformOwner: false,
  termConflict: null as Record<string, any> | null,
  allocations: [] as unknown[][],
  receipt: null as Record<string, any> | null,
  calls: [] as string[],
  transactionTail: Promise.resolve() as Promise<void>,
  beginCount: 0,
  firstBegin: null as (() => void) | null,
  insertDelayMs: 0,
  poolQuery: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => fake.poolQuery(...args), connect: (...args: any[]) => fake.connect(...args) },
}));

vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: any, _res: any, next: () => void) => {
      req.edupulseUser = {
        user: {
          id: 6,
          clerkUserId: "test-payer",
          email: "payer@example.test",
          firstName: null,
          lastName: null,
          phone: null,
          status: "ACTIVE",
        },
        roles: [fake.isPlatformOwner
          ? { id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }
          : { id: 1, role: "SCHOOL_ADMIN", schoolId: 8, status: "ACTIVE" }],
      };
      next();
    },
    assertSchoolOperationalAccess: () => undefined,
  };
});

import edupulseRouter from "./edupulse";
import { studentSubscriptionFlutterwaveWebhookRouter } from "./student-subscription-webhooks";

const reference = "student_webhook_123456";
const webhookSecret = "student-subscription-test-webhook-secret";
const flutterwaveSecret = "FLWSECK_TEST-student-webhook-key";
const providerResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
const httpFetch = fetch;
const webhookBody = JSON.stringify({
  event: "charge.completed",
  data: { id: 812345, tx_ref: reference },
});

function signedWebhook() {
  return httpFetch(`${baseUrl}/webhook/`, {
    method: "POST",
    headers: { "content-type": "application/json", "verif-hash": webhookSecret },
    body: webhookBody,
  });
}

beforeEach(() => {
  vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", flutterwaveSecret);
  vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
  vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", webhookSecret);
  fake.payment = {
    paymentId: 17,
    id: 17,
    subscriptionId: 12,
    schoolId: 8,
    studentId: 4,
    sessionId: 3,
    termId: 2,
    payerUserId: 6,
    reference,
    grossAmountMinor: 500_000,
    currency: "NGN",
    status: "PENDING",
    provider: "FLUTTERWAVE",
    providerMode: "SANDBOX",
    providerTransactionId: null,
    subscriptionTerm: "First Term",
    subscriptionStatus: "pending",
    verificationStatus: "pending",
    studentStatus: "ACTIVE",
    academicTermName: "First Term",
    termEndDate: "2026-01-31",
    currentTerm: true,
  };
  fake.isPlatformOwner = false;
  fake.termConflict = null;
  fake.allocations = [];
  fake.receipt = null;
  fake.calls = [];
  fake.transactionTail = Promise.resolve();
  fake.beginCount = 0;
  fake.insertDelayMs = 0;
  fake.firstBegin = null;

  fake.poolQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("JOIN subscriptions s") && sql.includes("WHERE p.subscription_id=$1 AND p.reference=$2")) {
      return { rows: [{ ...fake.payment }] };
    }
    if (sql.includes('SELECT school_id AS "schoolId" FROM subscriptions WHERE id=$1')) {
      return { rows: [{ schoolId: fake.payment.schoolId }] };
    }
    if (sql.includes('SELECT id AS "paymentId"') && sql.includes("FROM student_subscription_payments")) {
      return String(values[0]) === reference
        ? { rows: [{
          paymentId: fake.payment.paymentId,
          subscriptionId: fake.payment.subscriptionId,
          schoolId: fake.payment.schoolId,
          studentId: fake.payment.studentId,
          sessionId: fake.payment.sessionId,
          termId: fake.payment.termId,
          payerUserId: fake.payment.payerUserId,
          reference: fake.payment.reference,
          grossAmountMinor: fake.payment.grossAmountMinor,
          currency: fake.payment.currency,
        }] }
        : { rows: [] };
    }
    if (sql.includes("UPDATE student_subscription_payments")
        && sql.includes("SIGNED_WEBHOOK_PROVIDER_VERIFICATION_UNCERTAIN")) {
      if (fake.payment.reference === values[0] && fake.payment.status !== "PAID") {
        fake.payment.status = "RECONCILIATION_REQUIRED";
      }
      return { rows: [] };
    }
    if (sql.includes("FROM student_subscription_payments p") && sql.includes("WHERE p.id=$1")) {
      return { rows: [{
        ...fake.payment,
        createdAt: "2026-01-30T09:00:00.000Z",
        paidAt: "2026-01-30T10:00:00.000Z",
        providerFeeMinor: fake.payment.providerFeeMinor ?? null,
        settlementAmountMinor: fake.payment.settlementAmountMinor ?? null,
        settlementStatus: "PENDING",
        reconciliationStatus: "RECONCILED",
        checkoutUrl: null,
        failureCode: null,
        receiptSnapshot: fake.receipt,
      }] };
    }
    if (sql.includes("FROM subscriptions s") && sql.includes("WHERE s.id=$1")) {
      return { rows: [{
        id: fake.payment.subscriptionId,
        schoolId: fake.payment.schoolId,
        studentId: fake.payment.studentId,
        amount: 5000,
        schoolShare: 2000,
        edupulseShare: 3000,
        partnerShare: 100,
        allocationSnapshot: {
          grossAmountMinor: 500_000,
          schoolAmountMinor: 200_000,
          platformAmountMinor: 290_000,
          partnerAmountMinor: 10_000,
          partnerProfileId: 88,
          allocations: [
            { recipientType: "SCHOOL", amountMinor: 200_000 },
            { recipientType: "PLATFORM", amountMinor: 290_000 },
            { recipientType: "PARTNER", amountMinor: 10_000 },
          ],
        },
        status: fake.payment.status === "PAID" ? "active" : "pending",
        verificationStatus: fake.payment.status === "PAID" ? "verified" : "pending",
        provider: "flutterwave",
        term: "First Term",
        expiresAt: "2026-02-01T00:00:00.000Z",
      }] };
    }
    if (sql.includes("FROM student_subscription_allocations") && sql.includes("WHERE payment_id=$1")) {
      return { rows: fake.allocations.map((entry) => ({
        recipientType: entry[2],
        recipientId: entry[3],
        entryType: entry[1],
        amountMinor: entry[13],
        currency: "NGN",
      })) };
    }
    throw new Error(`Unhandled pool query: ${sql}`);
  });

  fake.connect.mockImplementation(async () => {
    let releaseTransaction: (() => void) | undefined;
    return {
      query: async (sql: string, values: unknown[] = []) => {
        fake.calls.push(sql);
        if (sql === "BEGIN") {
          const previous = fake.transactionTail;
          fake.transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
          fake.beginCount += 1;
          fake.firstBegin?.();
          await previous;
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          releaseTransaction?.();
          releaseTransaction = undefined;
          return { rows: [] };
        }
        if (sql.includes("FROM subscriptions sub") && sql.includes("WHERE sub.id=$1")) {
          return { rows: [{
            id: Number(values[0]),
            schoolId: fake.payment.schoolId,
            studentId: fake.payment.studentId,
            amount: "5000.00",
            status: "pending",
            verificationStatus: "pending",
            providerReference: null,
            term: "First Term",
            studentStatus: "ACTIVE",
          }] };
        }
        if (sql.includes("FROM student_subscription_payments")
            && sql.includes("WHERE subscription_id=$1 AND idempotency_key=$2")) return { rows: [] };
        if (sql.includes("FROM academic_terms t") && sql.includes("ses.is_current=true")) {
          return { rows: [{ termId: 2, sessionId: 3, endDate: "2026-01-31" }] };
        }
        if (sql.includes("SELECT p.id,p.subscription_id AS")) {
          return { rows: [{ ...fake.payment }] };
        }
        if (sql.includes("FROM student_subscription_payments")
            && sql.includes("provider_transaction_id=$2")) return { rows: [] };
        if (sql.includes("SELECT id,subscription_id AS")
            && sql.includes("status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')")) {
          return { rows: fake.termConflict ? [fake.termConflict] : [] };
        }
        if (sql.includes("FROM school_partner_attributions a")) return { rows: [] };
        if (sql.includes("UPDATE subscriptions")) return { rows: [{ id: fake.payment.subscriptionId }] };
        if (sql.includes("INSERT INTO student_subscription_allocations")) {
          if (fake.insertDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.insertDelayMs));
          fake.allocations.push(values);
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO commission_ledger")) return { rows: [] };
        if (sql.includes("UPDATE nfc_cards")) return { rows: [] };
        if (sql.includes("UPDATE student_subscription_payments")) {
          if (sql.includes("SET receipt_snapshot=")) {
            fake.receipt = JSON.parse(String(values[0]));
            return { rows: [] };
          }
          if (sql.includes("SET status='PAID'")) {
            fake.payment.status = "PAID";
            fake.payment.providerTransactionId = values[0];
          } else if (sql.includes("SET status='RECONCILIATION_REQUIRED'") || sql.includes("SET status=CASE")) {
            fake.payment.status = "RECONCILIATION_REQUIRED";
          }
          return { rows: [] };
        }
        if (sql.includes("SELECT p.reference,p.paid_at")) {
          return { rows: [{
            paidAt: "2026-01-30T10:00:00.000Z",
            schoolName: "Example School",
            studentName: "Student Name",
            sessionName: "2025/2026",
            termName: "First Term",
          }] };
        }
        if (sql.includes("FROM school_branding_logos") && sql.includes("is_current=true")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
  });
});

const app = express();
app.use(
  "/webhook",
  express.raw({ type: "application/json", limit: "64kb" }),
  studentSubscriptionFlutterwaveWebhookRouter,
);
app.use(express.json());
app.use("/api", edupulseRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

describe("public student subscription Flutterwave webhook", () => {
  it("settles and creates the immutable receipt without any browser callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse({ status: "success", data: {
      id: 812345,
      status: "successful",
      tx_ref: reference,
      amount: 5_000,
      currency: "NGN",
      created_at: "2026-01-30T10:00:00.000Z",
    } })));

    const response = await signedWebhook();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "paid" });
    expect(fake.payment.status).toBe("PAID");
    expect(fake.allocations).toHaveLength(2);
    expect(fake.receipt?.receiptNumber).toBe(`STUDENT-${reference}`);
  });

  it("rejects an invalid raw signature without querying or changing a payment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Provider verification must not run for invalid signatures");
    }));
    const response = await httpFetch(`${baseUrl}/webhook/`, {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": "wrong" },
      body: webhookBody,
    });

    expect(response.status).toBe(401);
    expect(fake.payment.status).toBe("PENDING");
    expect(fake.poolQuery).not.toHaveBeenCalled();
  });

  it("does not allocate a payment from a second Subscription row for the same current student term", async () => {
    fake.termConflict = { id: 29, subscriptionId: 99, status: "PENDING" };
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse({ status: "success", data: {
      id: 812345, status: "successful", tx_ref: reference, amount: 5_000, currency: "NGN",
    } })));

    const response = await signedWebhook();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true, outcome: "reconciliation_required" });
    expect(fake.payment.status).toBe("RECONCILIATION_REQUIRED");
    expect(fake.allocations).toEqual([]);
  });

  it("rejects checkout on a second Subscription row before any provider initialization", async () => {
    fake.termConflict = { id: 29, subscriptionId: 99, status: "PENDING" };
    const providerFetch = vi.fn(async () => {
      throw new Error("Provider checkout must not initialize while a same-term attempt is open");
    });
    vi.stubGlobal("fetch", providerFetch);

    const response = await httpFetch(`${baseUrl}/api/subscriptions/99/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "another-attempt-123" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STUDENT_TERM_PAYMENT_ALREADY_EXISTS" });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(fake.calls.some((sql) => sql.includes("INSERT INTO student_subscription_payments"))).toBe(false);
  });

  it("filters raw receipt and financial snapshots for school users while retaining full owner JSON", async () => {
    const fullReceipt = {
      receiptNumber: `STUDENT-${reference}`,
      paidAt: "2026-01-30T10:00:00.000Z",
      grossAmountMinor: 500_000,
      currency: "NGN",
      allocations: [
        { entryType: "CREDIT", recipientType: "SCHOOL", recipientId: 8, amountMinor: 200_000, currency: "NGN" },
        { entryType: "CREDIT", recipientType: "PLATFORM", recipientId: null, amountMinor: 290_000, currency: "NGN" },
        { entryType: "CREDIT", recipientType: "PARTNER", recipientId: 88, amountMinor: 10_000, currency: "NGN" },
        { entryType: "EXPENSE", recipientType: "PLATFORM_PROVIDER_FEE", recipientId: null, amountMinor: 500, currency: "NGN" },
      ],
      fullSnapshot: {
        schoolAmountMinor: 200_000,
        platformAmountMinor: 290_000,
        partnerAmountMinor: 10_000,
        allocations: [
          { recipientType: "SCHOOL", amountMinor: 200_000 },
          { recipientType: "PLATFORM", amountMinor: 290_000 },
          { recipientType: "PARTNER", amountMinor: 10_000 },
        ],
      },
    };
    fake.payment.status = "PAID";
    fake.payment.providerFeeMinor = 500;
    fake.payment.settlementAmountMinor = 499_500;
    fake.receipt = fullReceipt;
    fake.allocations = [
      [null, "CREDIT", "SCHOOL", 8, null, null, null, null, null, null, null, null, null, 200_000],
      [null, "CREDIT", "PLATFORM", null, null, null, null, null, null, null, null, null, null, 290_000],
      [null, "CREDIT", "PARTNER", 88, null, null, null, null, null, null, null, null, null, 10_000],
      [null, "EXPENSE", "PLATFORM_PROVIDER_FEE", null, null, null, null, null, null, null, null, null, null, 500],
    ];

    const schoolResponse = await httpFetch(`${baseUrl}/api/subscriptions/12/payments/17`);
    expect(schoolResponse.status).toBe(200);
    const schoolJson: any = await schoolResponse.json();
    expect(schoolJson.payment).toMatchObject({
      payerUserId: 6,
      grossAmountMinor: 500_000,
      providerFeeMinor: null,
      settlementAmountMinor: null,
    });
    expect(schoolJson.allocations.map((allocation: any) => allocation.recipientType)).toEqual(["SCHOOL"]);
    expect(schoolJson.receipt.grossAmountMinor).toBe(500_000);
    expect(schoolJson.receipt.allocations.map((allocation: any) => allocation.recipientType)).toEqual(["SCHOOL"]);
    expect(schoolJson.receipt.fullSnapshot).toEqual({
      schoolAmountMinor: 200_000,
      allocations: [{ recipientType: "SCHOOL", amountMinor: 200_000 }],
    });
    expect(schoolJson.subscription).not.toHaveProperty("edupulseShare");
    expect(schoolJson.subscription).not.toHaveProperty("partnerShare");
    expect(schoolJson.subscription.allocationSnapshot).not.toHaveProperty("platformAmountMinor");
    expect(schoolJson.subscription.allocationSnapshot).not.toHaveProperty("partnerAmountMinor");

    fake.isPlatformOwner = true;
    const ownerResponse = await httpFetch(`${baseUrl}/api/subscriptions/12/payments/17`);
    expect(ownerResponse.status).toBe(200);
    const ownerJson: any = await ownerResponse.json();
    expect(ownerJson.payment).toMatchObject({ providerFeeMinor: 500, settlementAmountMinor: 499_500 });
    expect(ownerJson.allocations.map((allocation: any) => allocation.recipientType)).toEqual([
      "SCHOOL", "PLATFORM", "PARTNER", "PLATFORM_PROVIDER_FEE",
    ]);
    expect(ownerJson.receipt).toEqual(fullReceipt);
    expect(ownerJson.subscription.allocationSnapshot).toMatchObject({
      platformAmountMinor: 290_000,
      partnerAmountMinor: 10_000,
    });
    expect(fake.receipt).toEqual(fullReceipt);
  });

  it("is idempotent when callback settlement races the signed webhook", async () => {
    fake.insertDelayMs = 15;
    let signalBegin: (() => void) | null = null;
    const began = new Promise<void>((resolve) => { signalBegin = resolve; });
    fake.firstBegin = () => signalBegin?.();
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse({ status: "success", data: {
      id: 812345, status: "successful", tx_ref: reference, amount: 5_000, currency: "NGN",
    } })));

    const callback = httpFetch(`${baseUrl}/api/subscriptions/12/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentReference: reference, providerTransactionId: "812345" }),
    });
    await began;
    const webhook = signedWebhook();
    const [callbackResponse, webhookResponse] = await Promise.all([callback, webhook]);

    expect(callbackResponse.status).toBe(200);
    expect(webhookResponse.status).toBe(200);
    expect(fake.payment.status).toBe("PAID");
    expect(fake.allocations).toHaveLength(2);
  });
});