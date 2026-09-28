import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  role: "PARENT",
  userId: 20,
  schoolId: 7,
  invoiceId: 41,
  linked: true,
  invoiceSchoolId: 7,
  invoiceStatus: "UNPAID",
  outstandingMinor: 5600,
  paidMinor: 0,
  currency: "NGN",
  paystackEnabled: true,
  flutterwaveEnabled: true,
  bankTransferEnabled: false,
  bankName: "Example Bank",
  accountName: "Example School",
  accountNumber: "1234567890",
  payment: null as Record<string, any> | null,
  session: null as Record<string, any> | null,
  receipt: null as Record<string, any> | null,
  txLock: Promise.resolve() as Promise<void>,
  clientCalls: [] as Array<{ sql: string; values: unknown[] }>,
  poolCalls: [] as Array<{ sql: string; values: unknown[] }>,
  connect: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: (...args: any[]) => db.connect(...args), query: (...args: any[]) => db.query(...args) },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? db.role) as any;
      (req as any).edupulseUser = {
        user: {
          id: Number(req.header("x-test-user") ?? db.userId),
          clerkUserId: "checkout-safety-test",
          email: "parent@example.test",
          firstName: "Parent",
          lastName: "Test",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId: db.schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";

const httpFetch = fetch;
const app = express();
app.use(express.json());
app.use(financeRouter);
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

beforeEach(() => {
  vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "sk_test_safety_fixture_123456789");
  vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-safety_fixture_123456789");
  vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "flutterwave-safety-fixture-secret");
  vi.stubEnv("FEE_PAYMENT_RETURN_URL", "https://school.example/fees/return");
  db.role = "PARENT";
  db.userId = 20;
  db.schoolId = 7;
  db.invoiceId = 41;
  db.invoiceSchoolId = 7;
  db.linked = true;
  db.invoiceStatus = "UNPAID";
  db.outstandingMinor = 5600;
  db.paidMinor = 0;
  db.currency = "NGN";
  db.paystackEnabled = true;
  db.flutterwaveEnabled = true;
  db.bankTransferEnabled = false;
  db.bankName = "Example Bank";
  db.accountName = "Example School";
  db.accountNumber = "1234567890";
  db.payment = null;
  db.session = null;
  db.receipt = null;
  db.txLock = Promise.resolve();
  db.clientCalls.length = 0;
  db.poolCalls.length = 0;

  db.query.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    db.poolCalls.push({ sql, values });
    if (sql.includes("FROM fee_invoices i") && sql.includes("WHERE i.id=$1 AND EXISTS")) {
      return db.linked && db.invoiceSchoolId === db.schoolId
          && Number(values[0]) === db.invoiceId && Number(values[1]) === db.userId
        ? { rows: [{
          id: db.invoiceId, schoolId: db.schoolId, status: db.invoiceStatus,
          outstandingMinor: db.outstandingMinor, currency: db.currency,
        }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_school_settings WHERE school_id=$1")) {
      return { rows: [{
        bankTransferEnabled: db.bankTransferEnabled, bankName: db.bankName,
        accountName: db.accountName, accountNumber: db.accountNumber,
        paystackEnabled: db.paystackEnabled, flutterwaveEnabled: db.flutterwaveEnabled,
      }] };
    }
    if (sql.includes("FROM fee_invoices i") && sql.includes("WHERE i.id=$1 AND EXISTS")) {
      return db.linked && db.invoiceSchoolId === db.schoolId
          && Number(values[0]) === db.invoiceId && Number(values[1]) === db.userId
        ? { rows: [{
          id: db.invoiceId, schoolId: db.schoolId, status: db.invoiceStatus,
          outstandingMinor: db.outstandingMinor, currency: db.currency,
        }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_school_settings WHERE school_id=$1")) {
      return { rows: [{
        bankTransferEnabled: db.bankTransferEnabled, bankName: db.bankName,
        accountName: db.accountName, accountNumber: db.accountNumber,
        paystackEnabled: db.paystackEnabled, flutterwaveEnabled: db.flutterwaveEnabled,
      }] };
    }
    if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='READY'")) {
      if (db.session?.state === "INITIALIZING" && db.session.claim_token === values[5]) {
        db.session.state = "READY";
        db.session.checkout_url = values[0];
        db.session.claim_token = null;
        db.session.claim_expires_at = null;
        return { rows: [{ payment_id: db.session.payment_id }] };
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='FAILED'")) {
      if (db.session?.state === "INITIALIZING" && db.session.claim_token === values[2]) {
        db.session.state = "FAILED";
        db.session.claim_token = null;
        db.session.claim_expires_at = null;
        return { rows: [{ payment_id: db.session.payment_id }] };
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE fee_payments SET status='FAILED'")) {
      if (db.payment && db.payment.id === values[0] && db.payment.status === "PENDING") db.payment.status = "FAILED";
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unhandled checkout pool query: ${sql}`);
  });

  db.connect.mockReset().mockImplementation(async () => {
    let unlockTransaction: (() => void) | undefined;
    return {
      query: async (sql: string, values: unknown[] = []) => {
        db.clientCalls.push({ sql, values });
        if (sql === "BEGIN") {
          const previous = db.txLock;
          db.txLock = new Promise<void>((resolve) => { unlockTransaction = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          unlockTransaction?.();
          return { rows: [] };
        }
        if (sql.includes("FROM fee_invoices i") && sql.includes("JOIN parents p")) {
          return db.linked && Number(values[0]) === db.invoiceId && Number(values[1]) === db.userId
            ? { rows: [{
              id: db.invoiceId, school_id: db.schoolId, student_id: 31, parent_id: 51,
              outstanding_minor: db.outstandingMinor, currency: db.currency, status: db.invoiceStatus,
            }] }
            : { rows: [] };
        }
        if (sql.includes("FROM fee_school_settings")) {
          return { rows: [{
            paystackEnabled: db.paystackEnabled, flutterwaveEnabled: db.flutterwaveEnabled,
          }] };
        }
        if (sql.includes("FROM fee_payments p JOIN fee_provider_checkout_sessions")) {
          if (!db.payment || !db.session
              || Number(values[0]) !== db.payment.school_id || values[1] !== db.session.idempotency_key) {
            return { rows: [] };
          }
          return { rows: [{
            id: db.payment.id, invoice_id: db.payment.invoice_id, student_id: db.payment.student_id,
            parent_id: db.payment.parent_id, reference: db.payment.reference,
            amount_minor: db.payment.amount_minor, currency: db.payment.currency,
            provider: db.payment.provider, status: db.payment.status,
            session_state: db.session.state, checkoutUrl: db.session.checkout_url,
            claimExpiresAt: db.session.claim_expires_at,
          }] };
        }
        if (sql.includes("FROM fee_provider_checkout_sessions s") && sql.includes("s.invoice_id=$2")) {
          return {
            rows: db.session && ["INITIALIZING", "READY", "FAILED"].includes(db.session.state)
                && Number(values[0]) === db.session.school_id
                && Number(values[1]) === db.session.invoice_id
              ? [{ id: db.payment?.id }]
              : [],
          };
        }
        if (sql.includes("WHERE p.id=$1 AND p.school_id=$2") && sql.includes("FOR UPDATE OF p,cs,i")) {
          if (Number(values[0]) !== Number(db.payment?.id) || Number(values[1]) !== db.schoolId
              || !db.payment || !db.session) return { rows: [] };
          return { rows: [{
            id: db.payment.id, school_id: db.schoolId, invoice_id: db.invoiceId,
            reference: db.payment.reference, amount_minor: db.payment.amount_minor, currency: db.payment.currency,
            provider: db.payment.provider, provider_transaction_id: db.payment.provider_transaction_id ?? null,
            status: db.payment.status, invoice_student_id: 31, invoice_currency: db.currency,
            invoice_status: db.invoiceStatus, outstanding_minor: db.outstandingMinor,
            session_state: db.session.state, claim_token: db.session.claim_token ?? null,
            claim_expires_at: db.session.claim_expires_at ?? null,
          }] };
        }
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='INITIALIZING'")) {
          if (!db.session || db.session.payment_id !== Number(values[1])) return { rows: [] };
          db.session.state = "INITIALIZING";
          db.session.claim_token = values[0];
          db.session.claim_expires_at = new Date(Date.now() + 30_000);
          return { rows: [{ payment_id: db.session.payment_id }] };
        }
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET claim_token=$1")) {
          if (!db.session || db.session.state === "SETTLED") return { rows: [] };
          db.session.claim_token = values[0];
          db.session.claim_expires_at = new Date(Date.now() + 30_000);
          return { rows: [{ payment_id: db.session.payment_id }] };
        }
        if (sql.includes("SET claim_token=NULL,claim_expires_at=NULL")) {
          const session = db.session;
          if (session && session.claim_token === values[2] && session.payment_id === values[0]) {
            session.claim_token = null;
            session.claim_expires_at = null;
            if (sql.includes("last_error=$4")) session.last_error = values[3];
          }
          return { rows: [] };
        }
        if (sql.includes("SELECT p.*,i.total_minor")) {
          if (!db.payment || !db.session || values[0] !== db.payment.reference
              || values[1] !== db.payment.provider) return { rows: [] };
          return { rows: [{
            ...db.payment,
            school_id: db.schoolId, invoice_id: db.invoiceId, student_id: 31, amount_minor: 5600,
            currency: db.currency, method: db.payment.provider, provider: db.payment.provider,
            total_minor: 5600, paid_minor: db.paidMinor, outstanding_minor: db.outstandingMinor,
            invoice_currency: db.currency, invoice_status: db.invoiceStatus, invoice_number: "INV-41",
            student_name_snapshot: "Student", admission_no_snapshot: "ADM-31", class_name_snapshot: "Class",
            academic_session_id: 1, academic_term_id: 2, invoice_student_id: 31,
            session_provider: db.session.provider, session_reference: db.session.reference,
            session_state: db.session.state, school_name: "School", school_logo: null, payer_name: "Parent",
          }] };
        }
        if (sql.includes("INSERT INTO fee_provider_webhook_events") && sql.includes("'RECEIVED'")) {
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes("SELECT status FROM fee_provider_webhook_events")) return { rows: [] };
        if (sql.includes("UPDATE fee_provider_webhook_events")) return { rows: [] };
        if (sql.includes("UPDATE fee_payments SET status='VERIFIED'")) {
          if (db.payment) {
            db.payment.status = "VERIFIED";
            db.payment.provider_transaction_id = values[0];
          }
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_invoices SET paid_minor=$1")) {
          db.paidMinor = Number(values[0]);
          db.outstandingMinor = Number(values[1]);
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='SETTLED'")) {
          if (!db.session || !["INITIALIZING", "READY", "FAILED", "RELEASED"].includes(db.session.state)) {
            return { rows: [] };
          }
          db.session.state = "SETTLED";
          db.session.claim_token = null;
          db.session.claim_expires_at = null;
          return { rows: [{ payment_id: db.session.payment_id }] };
        }
        if (sql.includes("INSERT INTO fee_receipts")) {
          db.receipt = { receipt_number: values[3], snapshot: values[4] };
          return { rows: [] };
        }
        if (sql.includes("SELECT receipt_number FROM fee_receipts")) {
          return db.receipt ? { rows: [{ receipt_number: db.receipt.receipt_number }] } : { rows: [] };
        }
        if (sql.includes("INSERT INTO fee_payment_notifications")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT id FROM fee_payments") && sql.includes("provider_transaction_id=$2")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_payments SET status='FAILED',provider_transaction_id=$1")) {
          if (!db.payment || db.payment.id !== values[1]
              || (db.payment.status !== "PENDING" && db.payment.status !== "FAILED")) return { rows: [] };
          db.payment.status = "FAILED";
          db.payment.provider_transaction_id = values[0];
          return { rows: [{ id: db.payment.id }] };
        }
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='RELEASED'")) {
          if (!db.session || db.session.claim_token !== values[2]
              || !["INITIALIZING", "READY", "FAILED"].includes(db.session.state)) return { rows: [] };
          db.session.state = "RELEASED";
          db.session.claim_token = null;
          db.session.claim_expires_at = null;
          return { rows: [{ payment_id: db.session.payment_id }] };
        }
        if (sql.includes("INSERT INTO fee_payments")) {
          db.payment = {
            id: 88, school_id: values[0], invoice_id: values[1], student_id: values[2], parent_id: values[3],
            reference: values[4], idempotency_key: values[5], amount_minor: values[6], currency: values[7],
            method: values[8], provider: values[8], status: "PENDING", submitted_by: values[9],
          };
          return { rows: [{ id: db.payment.id }] };
        }
        if (sql.includes("INSERT INTO fee_provider_checkout_sessions")) {
          db.session = {
            payment_id: values[0], school_id: values[1], invoice_id: values[2], provider: values[3],
            reference: values[4], idempotency_key: values[5], state: "INITIALIZING", checkout_url: null,
            claim_token: values[6], claim_expires_at: new Date(Date.now() + 30_000),
          };
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
        if (sql.includes("UPDATE fee_payments SET status='PENDING'")) {
          if (db.payment) db.payment.status = "PENDING";
          return { rows: [] };
        }
        throw new Error(`Unhandled checkout transaction query: ${sql}`);
      },
      release: () => undefined,
    };
  });
});

function initialize(idempotencyKey = "checkout-parent-41") {
  return httpFetch(`${baseUrl}/parent/fees/invoices/${db.invoiceId}/providers/PAYSTACK/initialize`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey, "content-type": "application/json" },
  });
}

function reconcileCheckout(
  paymentId = 88,
  schoolId = db.schoolId,
  role = "ACCOUNTANT",
) {
  return httpFetch(`${baseUrl}/school/finance/provider-checkouts/${paymentId}/reconcile?schoolId=${schoolId}`, {
    method: "POST",
    headers: { "x-test-role": role },
  });
}

function successTransport(url: string) {
  return vi.fn(async (_target: URL, init?: RequestInit) => new Response(JSON.stringify({
    status: true,
    data: { reference: JSON.parse(String(init?.body)).reference, authorization_url: url },
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("online checkout reservation and claim safety", () => {
  it("does not expose unconfigured/disabled methods or methods for another parent’s invoice", async () => {
    const methodsUrl = `${baseUrl}/parent/fees/invoices/${db.invoiceId}/payment-methods`;
    db.bankTransferEnabled = true;
    db.paystackEnabled = false;
    db.flutterwaveEnabled = false;
    let response = await httpFetch(methodsUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(["BANK_TRANSFER"]);

    db.linked = false;
    response = await httpFetch(methodsUrl);
    expect(response.status).toBe(404);
    db.linked = true;
    db.invoiceSchoolId = 99;
    response = await httpFetch(methodsUrl);
    expect(response.status).toBe(404);

    db.invoiceSchoolId = db.schoolId;
    db.bankTransferEnabled = true;
    db.accountNumber = "not-a-valid-account";
    db.paystackEnabled = true;
    db.flutterwaveEnabled = true;
    vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "sk_live_invalid-test-key");
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
    vi.stubEnv("FEE_PAYMENT_RETURN_URL", "");
    response = await httpFetch(methodsUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("reserves one invoice checkout even when a second caller uses a different key", async () => {
    const entered = deferred();
    const gate = deferred();
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      entered.resolve();
      await gate.promise;
      return new Response(JSON.stringify({
        status: true,
        data: { reference: JSON.parse(String(init?.body)).reference, authorization_url: "https://checkout.paystack.com/one" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    const first = initialize("different-key-one");
    await entered.promise;
    const second = await initialize("different-key-two");
    expect(second.status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.clientCalls.filter(({ sql }) => sql.includes("INSERT INTO fee_payments"))).toHaveLength(1);
    gate.resolve();
    expect((await first).status).toBe(201);
  });

  it("does not reinitialize the same reference while the original provider request is processing", async () => {
    const entered = deferred();
    const gate = deferred();
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      entered.resolve();
      await gate.promise;
      return new Response(JSON.stringify({
        status: true,
        data: { reference: JSON.parse(String(init?.body)).reference, authorization_url: "https://checkout.paystack.com/one" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    const first = initialize();
    await entered.promise;
    const duplicate = await initialize();
    expect(duplicate.status).toBe(202);
    expect(await duplicate.json()).toMatchObject({ outcome: "processing" });
    expect(transport).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect((await first).status).toBe(201);
  });

  it("keeps an uncertain failed initialization blocked instead of reusing its chargeable reference", async () => {
    let attempt = 0;
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) throw new Error("simulated ambiguous network failure");
      return new Response(JSON.stringify({
        status: true,
        data: { reference: JSON.parse(String(init?.body)).reference, authorization_url: "https://checkout.paystack.com/recovered" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    expect((await initialize()).status).toBe(503);
    const originalReference = db.session?.reference;
    expect(db.payment?.status).toBe("FAILED");
    expect(db.session?.state).toBe("FAILED");

    const replay = await initialize();
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ outcome: "reconciliation_required" });
    expect(db.session).toMatchObject({ state: "FAILED", reference: originalReference });
    expect(db.payment?.status).toBe("FAILED");
    expect(db.clientCalls.filter(({ sql }) => sql.includes("INSERT INTO fee_payments"))).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("allows a new checkout for a later remaining balance only after prior settlement", async () => {
    db.payment = { id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, status: "VERIFIED" };
    db.session = { payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, state: "SETTLED" };
    db.invoiceStatus = "PARTIAL";
    db.outstandingMinor = 1200;
    const transport = successTransport("https://checkout.paystack.com/remaining");
    vi.stubGlobal("fetch", transport);
    const response = await initialize("checkout-after-settlement");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ amountMinor: 1200, checkoutUrl: "https://checkout.paystack.com/remaining" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("releases an abandoned checkout only after an exact provider-confirmed terminal failure", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, student_id: 31, parent_id: 51,
      reference: "fee_0123456789abcdef", amount_minor: 5600, currency: "NGN", provider: "PAYSTACK",
      status: "PENDING", provider_transaction_id: null,
    };
    db.session = {
      payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId,
      idempotency_key: "ONLINE:PAYSTACK:20:old-key", state: "READY",
      checkout_url: "https://checkout.paystack.com/old",
    };
    const statusFetch = vi.fn(async () => new Response(JSON.stringify({ status: true, data: {
      id: 456, status: "abandoned", reference: "fee_0123456789abcdef", amount: 5600, currency: "NGN",
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", statusFetch);

    const released = await reconcileCheckout();
    expect(released.status).toBe(200);
    expect(await released.json()).toMatchObject({ paymentId: 88, outcome: "released" });
    expect(db.payment).toMatchObject({ status: "FAILED", provider_transaction_id: "456" });
    expect(db.session).toMatchObject({ state: "RELEASED", claim_token: null });
    expect(statusFetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", successTransport("https://checkout.paystack.com/new"));
    expect((await initialize("new-attempt")).status).toBe(201);
    expect((await initialize("third-attempt")).status).toBe(409);
  });

  it("keeps a not-found checkout blocked and never initializes it again", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, student_id: 31, parent_id: 51,
      reference: "fee_0123456789abcdef", amount_minor: 5600, currency: "NGN", provider: "PAYSTACK",
      status: "FAILED", provider_transaction_id: null,
    };
    db.session = {
      payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId,
      idempotency_key: "ONLINE:PAYSTACK:20:checkout-parent-41", state: "FAILED",
    };
    const notFound = vi.fn(async () => new Response(JSON.stringify({ status: false, message: "not found" }), {
      status: 404, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", notFound);

    const result = await reconcileCheckout();
    expect(result.status, await result.clone().text()).toBe(202);
    expect(await result.json()).toMatchObject({ outcome: "reconciliation_required" });
    expect(db.session).toMatchObject({ state: "FAILED", claim_token: null });
    expect(db.payment?.status).toBe("FAILED");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect((await initialize()).status).toBe(202);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("does not release when terminal provider status does not match the stored reference", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, student_id: 31, parent_id: 51,
      reference: "fee_0123456789abcdef", amount_minor: 5600, currency: "NGN", provider: "PAYSTACK",
      status: "FAILED", provider_transaction_id: null,
    };
    db.session = {
      payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId,
      idempotency_key: "ONLINE:PAYSTACK:20:checkout-parent-41", state: "FAILED",
    };
    const mismatched = vi.fn(async () => new Response(JSON.stringify({ status: true, data: {
      id: 458, status: "cancelled", reference: "fee_another-reference", amount: 5600, currency: "NGN",
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mismatched);

    const result = await reconcileCheckout();
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ outcome: "reconciliation_required" });
    expect(db.session).toMatchObject({ state: "FAILED", claim_token: null });
    expect(db.payment?.status).toBe("FAILED");
    expect(mismatched).toHaveBeenCalledTimes(1);
  });

  it("keeps the checkout reservation active when the provider status request has a network error", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, reference: "fee_0123456789abcdef",
      amount_minor: 5600, currency: "NGN", provider: "PAYSTACK", status: "FAILED",
    };
    db.session = {
      payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId,
      idempotency_key: "ONLINE:PAYSTACK:20:checkout-parent-41", state: "FAILED",
    };
    const networkFailure = vi.fn(async () => {
      throw new Error("provider request timed out");
    });
    vi.stubGlobal("fetch", networkFailure);

    const result = await reconcileCheckout();
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ outcome: "reconciliation_required" });
    expect(db.session).toMatchObject({ state: "FAILED", claim_token: null });
    expect(db.payment?.status).toBe("FAILED");
    expect(networkFailure).toHaveBeenCalledTimes(1);
  });

  it("settles a released checkout only after explicit provider-status reconciliation confirms success", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, student_id: 31, parent_id: 51,
      reference: "fee_0123456789abcdef", amount_minor: 5600, currency: "NGN", provider: "PAYSTACK",
      status: "FAILED", provider_transaction_id: "455",
    };
    db.session = {
      payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, provider: "PAYSTACK",
      reference: "fee_0123456789abcdef", state: "RELEASED", claim_token: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: true, data: {
      id: 456, status: "success", reference: "fee_0123456789abcdef", amount: 5600, currency: "NGN",
    } }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await reconcileCheckout();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ paymentId: 88, outcome: "verified" });
    expect(db.payment).toMatchObject({ status: "VERIFIED", provider_transaction_id: "456" });
    expect(db.session).toMatchObject({ state: "SETTLED", claim_token: null });
    expect(db.paidMinor).toBe(5600);
    expect(db.outstandingMinor).toBe(0);
    expect(db.receipt).not.toBeNull();
  });

  it("denies cross-school and unauthorized checkout release attempts", async () => {
    db.payment = {
      id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, reference: "fee_0123456789abcdef",
      amount_minor: 5600, currency: "NGN", provider: "PAYSTACK", status: "FAILED",
    };
    db.session = { payment_id: 88, school_id: db.schoolId, invoice_id: db.invoiceId, state: "FAILED" };
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    expect((await reconcileCheckout(88, db.schoolId, "PARENT")).status).toBe(404);
    expect((await reconcileCheckout(88, db.schoolId + 1, "ACCOUNTANT")).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
    expect(db.session.state).toBe("FAILED");
  });

  it("does not make a second initialization when the expired first claim may still succeed", async () => {
    const entered = deferred();
    const gate = deferred();
    let attempt = 0;
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        entered.resolve();
        await gate.promise;
        return new Response(JSON.stringify({
          status: true,
          data: {
            reference: JSON.parse(String(init?.body)).reference,
            authorization_url: "https://checkout.paystack.com/late-first-success",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        status: true,
        data: { reference: JSON.parse(String(init?.body)).reference, authorization_url: "https://checkout.paystack.com/current" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    const stale = initialize();
    await entered.promise;
    db.session!.claim_expires_at = new Date(Date.now() - 1_000);
    const current = await initialize();
    expect(current.status).toBe(202);
    expect(await current.json()).toMatchObject({ outcome: "reconciliation_required" });
    expect(transport).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect((await stale).status).toBe(201);
    expect(db.session).toMatchObject({
      state: "READY", checkout_url: "https://checkout.paystack.com/late-first-success",
    });
    expect(db.payment?.status).toBe("PENDING");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});