import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PARENT",
  userId: 20,
  linked: true,
  providerEnabled: true,
  partialPaymentsEnabled: false,
  outstandingMinor: 5600,
  invoiceId: 41,
  schoolId: 7,
  settings: { partialPaymentsEnabled: false, bankTransferEnabled: false, paystackEnabled: true, flutterwaveEnabled: true },
  payment: null as Record<string, any> | null,
  session: null as Record<string, any> | null,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  clientCalls: [] as Array<{ sql: string; values: unknown[] }>,
}));
const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("COALESCE(fs.partial_payments_enabled")) {
      return state.linked && Number(values[0]) === state.invoiceId && Number(values[1]) === state.userId
        ? { rows: [{
          invoiceId: state.invoiceId, schoolId: state.schoolId,
          outstandingMinor: state.outstandingMinor, partialPaymentsEnabled: state.partialPaymentsEnabled,
        }] }
        : { rows: [] };
    }
    if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='READY'")) {
      if (state.session) {
        state.session.state = "READY";
        state.session.checkout_url = values[0];
      }
      return { rows: state.session ? [{ payment_id: state.session.payment_id }] : [] };
    }
    if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='FAILED'")) return { rows: [] };
    if (sql.includes("UPDATE fee_payments SET status='FAILED'")) return { rows: [] };
    throw new Error(`Unhandled pool query: ${sql}`);
  }),
  connect: vi.fn(async () => {
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        state.clientCalls.push({ sql, values });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM fee_invoices i") && sql.includes("JOIN parents p")) {
          return state.linked && Number(values[0]) === state.invoiceId && Number(values[1]) === state.userId
            ? { rows: [{
              id: state.invoiceId, school_id: state.schoolId, student_id: 31, parent_id: 51,
              outstanding_minor: state.outstandingMinor, currency: "NGN", status: "UNPAID",
            }] }
            : { rows: [] };
        }
        if (sql.includes("FROM fee_school_settings")) {
          return [{ school_id: state.schoolId, paystackEnabled: state.providerEnabled, flutterwaveEnabled: state.providerEnabled }].length
            ? { rows: [{
              paystackEnabled: state.providerEnabled, flutterwaveEnabled: state.providerEnabled,
              partialPaymentsEnabled: state.partialPaymentsEnabled,
            }] }
            : { rows: [] };
        }
        if (sql.includes("FROM fee_payments p JOIN fee_provider_checkout_sessions")) {
          if (!state.payment || !state.session
              || Number(values[0]) !== state.payment.school_id
              || values[1] !== state.session.idempotency_key) return { rows: [] };
          return { rows: [{
            id: state.payment.id, invoice_id: state.payment.invoice_id, student_id: state.payment.student_id,
            parent_id: state.payment.parent_id, reference: state.payment.reference,
            amount_minor: state.payment.amount_minor, currency: state.payment.currency,
            provider: state.payment.provider, status: state.payment.status,
            session_state: state.session.state, checkoutUrl: state.session.checkout_url,
          }] };
        }
        if (sql.includes("FROM fee_provider_checkout_sessions s") && sql.includes("s.invoice_id=$2")) {
          return {
            rows: state.session && ["INITIALIZING", "READY", "FAILED"].includes(state.session.state)
                && Number(values[0]) === state.session.school_id
                && Number(values[1]) === state.session.invoice_id
              ? [{ id: state.payment?.id }]
              : [],
          };
        }
        if (sql.includes("INSERT INTO fee_payments")) {
          state.payment = {
            id: 88, school_id: values[0], invoice_id: values[1], student_id: values[2], parent_id: values[3],
            reference: values[4], idempotency_key: values[5], amount_minor: values[6], currency: values[7],
            method: values[8], provider: values[8], status: "PENDING", submitted_by: values[9],
          };
          return { rows: [{ id: state.payment.id }] };
        }
        if (sql.includes("INSERT INTO fee_provider_checkout_sessions")) {
          state.session = {
            payment_id: values[0], school_id: values[1], invoice_id: values[2],
            provider: values[3], reference: values[4], idempotency_key: values[5],
            state: "INITIALIZING", checkout_url: null,
          };
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='INITIALIZING'")) {
          if (state.session) state.session.state = "INITIALIZING";
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_payments SET status='PENDING'")) {
          if (state.payment) state.payment.status = "PENDING";
          return { rows: [] };
        }
        throw new Error(`Unhandled transaction query: ${sql}`);
      },
      release: () => undefined,
    };
    return client;
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? state.role) as any;
      (req as any).edupulseUser = {
        user: {
          id: Number(req.header("x-test-user") ?? state.userId),
          clerkUserId: "provider-checkout-test",
          email: "parent@example.test",
          firstName: "Parent",
          lastName: "Test",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId: state.schoolId, status: "ACTIVE" }],
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
  vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "sk_test_checkout_fixture_123456789");
  vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-checkout_fixture_123456789");
  vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "flutterwave-webhook-fixture-secret");
  vi.stubEnv("FEE_PAYMENT_RETURN_URL", "https://school.example/fees/return");
  state.role = "PARENT";
  state.userId = 20;
  state.linked = true;
  state.providerEnabled = true;
  state.partialPaymentsEnabled = false;
  state.outstandingMinor = 5600;
  state.invoiceId = 41;
  state.schoolId = 7;
  state.payment = null;
  state.session = null;
  state.calls.length = 0;
  state.clientCalls.length = 0;
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

function initialize(headers: Record<string, string> = {}, body?: unknown, invoiceId = state.invoiceId) {
  return httpFetch(`${baseUrl}/parent/fees/invoices/${invoiceId}/providers/PAYSTACK/initialize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": "checkout-parent-41",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("parent fee checkout initialization", () => {
  it("derives outstanding amount and tenant/student context from the linked invoice", async () => {
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      const reference = JSON.parse(String(init?.body)).reference;
      return new Response(JSON.stringify({
        status: true, data: {
          reference, authorization_url: "https://checkout.paystack.com/test-checkout", access_code: "ignored",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);
    const response = await initialize({}, { schoolId: 999, studentId: 999 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      paymentId: 88, invoiceId: 41, provider: "PAYSTACK", amountMinor: 5600, currency: "NGN",
      status: "PENDING", checkoutUrl: "https://checkout.paystack.com/test-checkout",
    });
    expect(state.payment).toMatchObject({
      school_id: 7, invoice_id: 41, student_id: 31, parent_id: 51,
      amount_minor: 5600, currency: "NGN", status: "PENDING", provider: "PAYSTACK",
    });
    expect(state.session).toMatchObject({ state: "READY", checkout_url: "https://checkout.paystack.com/test-checkout" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("returns the stored hosted checkout for Idempotency-Key retries without a second provider call", async () => {
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => new Response(JSON.stringify({
      status: true, data: {
        reference: JSON.parse(String(init?.body)).reference,
        authorization_url: "https://checkout.paystack.com/test-checkout",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", transport);
    const first = await initialize();
    const replay = await initialize();
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ paymentId: 88, checkoutUrl: "https://checkout.paystack.com/test-checkout" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses the requested partial amount consistently for persistence, provider initialization, and idempotent replay", async () => {
    state.partialPaymentsEnabled = true;
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      const providerBody = JSON.parse(String(init?.body));
      expect(providerBody.amount).toBe(1700);
      return new Response(JSON.stringify({ status: true, data: {
        reference: providerBody.reference, authorization_url: "https://checkout.paystack.com/partial",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);

    const response = await initialize({}, { amountMinor: 1700 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ amountMinor: 1700 });
    expect(state.payment).toMatchObject({ amount_minor: 1700 });
    expect(state.clientCalls.some(({ sql, values }) =>
      sql.includes("INSERT INTO fee_payments") && values[6] === 1700,
    )).toBe(true);

    const replay = await initialize({}, { amountMinor: 1700 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ amountMinor: 1700 });
    expect((await initialize({}, { amountMinor: 1800 })).status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects zero, overpaying, and policy-disabled partial amounts before creating a payment", async () => {
    state.partialPaymentsEnabled = false;
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);

    expect((await initialize({}, { amountMinor: 0 })).status).toBe(400);
    expect((await initialize({}, { amountMinor: 1 })).status).toBe(400);
    expect((await initialize({}, { amountMinor: state.outstandingMinor + 1 })).status).toBe(409);
    expect(state.payment).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("allows a subsequent final-balance checkout after the partial payment settles", async () => {
    state.partialPaymentsEnabled = true;
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => {
      const providerBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: true, data: {
        reference: providerBody.reference, authorization_url: "https://checkout.paystack.com/next",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", transport);

    expect((await initialize({}, { amountMinor: 1400 })).status).toBe(201);
    state.payment!.status = "VERIFIED";
    state.session!.state = "SETTLED";
    state.outstandingMinor = 4200;
    const final = await initialize({ "Idempotency-Key": "checkout-final-balance" });
    expect(final.status).toBe(201);
    expect(await final.json()).toMatchObject({ amountMinor: 4200 });
    expect(state.payment).toMatchObject({ amount_minor: 4200, status: "PENDING" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("exposes only parent-safe outstanding amount and partial-payment policy", async () => {
    state.partialPaymentsEnabled = true;
    const result = await httpFetch(`${baseUrl}/parent/fees/invoices/${state.invoiceId}/checkout-policy`);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      invoiceId: state.invoiceId, schoolId: state.schoolId,
      outstandingMinor: 5600, partialPaymentsEnabled: true,
    });
    expect(state.calls.at(-1)?.sql).not.toContain("bank_account_number");
  });

  it("creates no payment if provider is disabled, credentials are absent, or parent is unlinked", async () => {
    state.providerEnabled = false;
    const disabled = await initialize();
    expect(disabled.status).toBe(409);
    expect(state.payment).toBeNull();

    state.providerEnabled = true;
    vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "");
    const unconfigured = await initialize({}, undefined, 41);
    expect(unconfigured.status).toBe(503);
    expect(state.payment).toBeNull();

    vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "sk_test_checkout_fixture_123456789");
    state.linked = false;
    const unlinked = await initialize();
    expect(unlinked.status).toBe(404);
    expect(state.payment).toBeNull();
  });

  it("rejects unauthorized roles, idempotency conflicts, and unsafe return configuration", async () => {
    state.role = "STUDENT";
    const wrongRole = await initialize();
    expect(wrongRole.status).toBe(403);
    expect(state.payment).toBeNull();

    state.role = "PARENT";
    const transport = vi.fn(async (_url: URL, init?: RequestInit) => new Response(JSON.stringify({
      status: true, data: {
        reference: JSON.parse(String(init?.body)).reference,
        authorization_url: "https://checkout.paystack.com/test-checkout",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", transport);
    expect((await initialize()).status).toBe(201);
    state.invoiceId = 42;
    const conflict = await initialize({}, undefined, 42);
    expect(conflict.status).toBe(409);

    state.payment = null;
    state.session = null;
    vi.stubEnv("FEE_PAYMENT_RETURN_URL", "http://unsafe.example/return");
    const unsafe = await initialize({}, undefined, 41);
    expect(unsafe.status).toBe(503);
    expect(state.payment).toBeNull();
  });

  it("keeps provider reconciliation school-scoped and unavailable to platform or unrelated-school roles", async () => {
    state.role = "PLATFORM_OWNER";
    const platformOwner = await httpFetch(`${baseUrl}/school/finance/provider-reconciliation?schoolId=7`);
    expect(platformOwner.status).toBe(404);

    state.role = "ACCOUNTANT";
    const otherSchool = await httpFetch(`${baseUrl}/school/finance/provider-reconciliation?schoolId=8`);
    expect(otherSchool.status).toBe(404);
    expect(state.clientCalls).toHaveLength(0);
  });
});