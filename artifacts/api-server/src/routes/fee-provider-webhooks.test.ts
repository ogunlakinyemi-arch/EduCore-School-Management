import { createHmac } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  payment: {} as Record<string, any>,
  invoice: {} as Record<string, any>,
  session: {} as Record<string, any>,
  events: new Map<string, Record<string, any>>(),
  receipt: null as Record<string, any> | null,
  audits: [] as unknown[],
  calls: [] as string[],
  failReceiptOnce: false,
  locks: Promise.resolve() as Promise<void>,
  poolQuery: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => fake.poolQuery(...args), connect: (...args: any[]) => fake.connect(...args) },
}));

import webhookRouter, { settleVerifiedPayment } from "./fee-provider-webhooks";

const paystackSecret = "sk_test_route_adapter_123456789";
const expectedReference = "fee_0123456789abcdef";
const httpFetch = fetch;
const response = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const sign = (body: Uint8Array | string) => createHmac("sha512", paystackSecret).update(body).digest("hex");
const signedWebhook = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ event: "charge.success", data: { id: 456, reference: expectedReference, ...overrides } });

function recordKey(provider: string, eventId: string) {
  return `${provider}:${eventId}`;
}

beforeEach(() => {
  vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", paystackSecret);
  vi.stubEnv("FEE_PAYMENT_RETURN_URL", "https://school.example/fees/return");
  fake.payment = {
    id: 11, school_id: 2, invoice_id: 22, student_id: 33, parent_id: 44,
    reference: expectedReference, amount_minor: 1234, currency: "NGN",
    method: "PAYSTACK", provider: "PAYSTACK", provider_transaction_id: null,
    status: "PENDING", submitted_by: 55, provider_metadata: {},
  };
  fake.invoice = {
    total_minor: 1234, paid_minor: 0, outstanding_minor: 1234, invoice_currency: "NGN", invoice_status: "UNPAID",
    invoice_number: "INV-22", student_name_snapshot: "Student Name", admission_no_snapshot: "ADM-33",
    class_name_snapshot: "Class A", academic_session_id: 1, academic_term_id: 2,
    invoice_student_id: 33,
  };
  fake.session = {
    session_provider: "PAYSTACK", session_reference: expectedReference,
    state: "READY", session_state: "READY", claim_token: null, claim_expires_at: null,
  };
  fake.events = new Map();
  fake.receipt = null;
  fake.audits = [];
  fake.calls = [];
  fake.failReceiptOnce = false;
  fake.locks = Promise.resolve();

  fake.poolQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("SELECT reference,amount_minor AS")) {
      return String(values[0]) === fake.payment.reference && String(values[1]) === "PAYSTACK"
        ? { rows: [{ reference: fake.payment.reference, amountMinor: fake.payment.amount_minor, currency: fake.payment.currency }] }
        : { rows: [] };
    }
    if (sql.includes("SELECT id,school_id FROM fee_payments WHERE reference=$1")) {
      return String(values[0]) === fake.payment.reference
        ? { rows: [{ id: fake.payment.id, school_id: fake.payment.school_id }] }
        : { rows: [] };
    }
    if (sql.includes("INSERT INTO fee_provider_webhook_events") && sql.includes("RECONCILIATION_REQUIRED")) {
      const key = recordKey(String(values[0]), String(values[1]));
      if (!fake.events.has(key)) {
        fake.events.set(key, {
          provider: values[0], event_id: values[1], payment_id: values[2], school_id: values[3],
          provider_reference: values[4], webhook_transaction_id: values[5],
          status: "RECONCILIATION_REQUIRED", signature_verified: true,
          payload_sha256: values[6], error_message: values[7],
        });
      } else if (fake.events.get(key)?.status !== "VERIFIED") {
        fake.events.get(key)!.status = "RECONCILIATION_REQUIRED";
        fake.events.get(key)!.error_message = values[7];
      }
      return { rows: [] };
    }
    throw new Error(`Unhandled pool query: ${sql}`);
  });

  fake.connect.mockImplementation(async () => {
    let releaseLock: (() => void) | undefined;
    let snapshot: any;
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        fake.calls.push(sql);
        if (sql === "BEGIN") {
          const previous = fake.locks;
          fake.locks = new Promise<void>((resolve) => { releaseLock = resolve; });
          await previous;
          snapshot = {
            payment: structuredClone(fake.payment), invoice: structuredClone(fake.invoice),
            session: structuredClone(fake.session),
            events: structuredClone([...fake.events.entries()]), receipt: structuredClone(fake.receipt),
            audits: structuredClone(fake.audits),
          };
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          releaseLock?.();
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          if (snapshot) {
            fake.payment = snapshot.payment;
            fake.invoice = snapshot.invoice;
            fake.session = snapshot.session;
            fake.events = new Map(snapshot.events);
            fake.receipt = snapshot.receipt;
            fake.audits = snapshot.audits;
          }
          releaseLock?.();
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO fee_provider_webhook_events") && sql.includes("'RECEIVED'")) {
          const key = recordKey(String(values[0]), String(values[1]));
          if (fake.events.has(key)) return { rows: [] };
          fake.events.set(key, {
            id: fake.events.size + 1, provider: values[0], event_id: values[1],
            provider_reference: values[2], webhook_transaction_id: values[3],
            verified_transaction_id: values[4], status: "RECEIVED", signature_verified: values[6],
            payload_sha256: values[5],
          });
          return { rows: [{ id: fake.events.size }] };
        }
        if (sql.includes("SELECT status FROM fee_provider_webhook_events")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          return { rows: event ? [{ status: event.status }] : [] };
        }
        if (sql.includes("UPDATE fee_provider_webhook_events SET status='RECEIVED'")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          if (event) { event.status = "RECEIVED"; event.error_message = null; }
          return { rows: [] };
        }
        if (sql.includes("SELECT p.*,i.total_minor")) {
          return String(values[0]) === fake.payment.reference && String(values[1]) === fake.payment.provider
            ? { rows: [{ ...fake.payment, ...fake.invoice, ...fake.session, school_name: "School", school_logo: null, payer_name: "Parent" }] }
            : { rows: [] };
        }
        if (sql.includes("SELECT id FROM fee_payments") && sql.includes("provider_transaction_id=$2")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_webhook_events SET status='RECONCILIATION_REQUIRED'")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          if (event) {
            event.status = "RECONCILIATION_REQUIRED"; event.error_message = values[6];
            event.payment_id = values[2]; event.school_id = values[3];
            event.provider_reference ??= values[4]; event.webhook_transaction_id ??= values[5];
          }
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_webhook_events SET status='PENDING'")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          if (event) event.status = "PENDING";
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_webhook_events SET status='FAILED'")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          if (event) event.status = "FAILED";
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_webhook_events SET status='VERIFIED'")) {
          const event = fake.events.get(recordKey(String(values[0]), String(values[1])));
          if (event) event.status = "VERIFIED";
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_payments SET status='VERIFIED'")) {
          fake.payment.status = "VERIFIED";
          fake.payment.provider_transaction_id = values[0];
          fake.payment.provider_metadata = JSON.parse(String(values[1]));
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_payments SET status='FAILED'")) {
          fake.payment.status = "FAILED";
          fake.payment.provider_transaction_id = values[0];
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_invoices SET paid_minor=$1")) {
          fake.invoice.paid_minor = values[0];
          fake.invoice.outstanding_minor = values[1];
          return { rows: [] };
        }
        if (sql.includes("UPDATE fee_provider_checkout_sessions SET state='SETTLED'")) {
          if (!["INITIALIZING", "READY", "FAILED", "RELEASED"].includes(fake.session.state)) return { rows: [] };
          fake.session.state = "SETTLED";
          fake.session.claim_token = null;
          fake.session.claim_expires_at = null;
          return { rows: [{ payment_id: values[0] }] };
        }
        if (sql.includes("INSERT INTO fee_receipts")) {
          if (fake.failReceiptOnce) {
            fake.failReceiptOnce = false;
            throw new Error("simulated crash before settlement commit");
          }
          fake.receipt ??= { receipt_number: values[3], snapshot: values[4] };
          return { rows: [] };
        }
        if (sql.includes("SELECT receipt_number FROM fee_receipts")) {
          return fake.receipt ? { rows: [{ receipt_number: fake.receipt.receipt_number }] } : { rows: [] };
        }
        if (sql.includes("INSERT INTO fee_payment_notifications")) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO audit_logs")) {
          fake.audits.push(values);
          return { rows: [] };
        }
        throw new Error(`Unhandled transaction query: ${sql}`);
      },
      release: () => undefined,
    };
    return client;
  });
});

const app = express();
app.use(express.raw({ type: "application/json", limit: "64kb" }), webhookRouter);
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

function postWebhook(body: string) {
  return httpFetch(`${baseUrl}/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": sign(body) },
    body,
  });
}

describe("public fee-provider webhook settlement", () => {
  it("credits only independently verified payments and atomically issues receipt and audit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: expectedReference, amount: 1234, currency: "NGN",
    } })));
    const result = await postWebhook(signedWebhook());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ received: true, outcome: "verified" });
    expect(fake.payment).toMatchObject({ status: "VERIFIED", provider_transaction_id: "456" });
    expect(fake.invoice).toMatchObject({ paid_minor: 1234, outstanding_minor: 0 });
    expect(fake.session.state).toBe("SETTLED");
    expect(fake.receipt?.receipt_number).toBe("RCP-2-00000011");
    expect(fake.audits).toHaveLength(2);
    const notificationIndex = fake.calls.findIndex((sql) => sql.includes("INSERT INTO fee_payment_notifications"));
    const receiptCheckIndex = fake.calls.findIndex((sql) => sql.includes("SELECT receipt_number FROM fee_receipts"));
    const commitIndex = fake.calls.findIndex((sql) => sql === "COMMIT");
    expect(notificationIndex).toBeGreaterThan(receiptCheckIndex);
    expect(notificationIndex).toBeLessThan(commitIndex);
  });

  it("settles an independently verified partial amount and snapshots a receipt for that payment", async () => {
    fake.payment.amount_minor = 700;
    fake.invoice.total_minor = 1234;
    fake.invoice.outstanding_minor = 1234;
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: expectedReference, amount: 700, currency: "NGN",
    } })));

    const result = await postWebhook(signedWebhook());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ received: true, outcome: "verified" });
    expect(fake.payment).toMatchObject({ status: "VERIFIED", amount_minor: 700 });
    expect(fake.invoice).toMatchObject({ paid_minor: 700, outstanding_minor: 534 });
    expect(fake.receipt?.snapshot).toMatchObject({ amountMinor: 700, remainingBalanceMinor: 534 });
  });

  it("does not double-credit duplicate or concurrent webhook deliveries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: expectedReference, amount: 1234, currency: "NGN",
    } })));
    const [first, second] = await Promise.all([postWebhook(signedWebhook()), postWebhook(signedWebhook())]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fake.invoice.paid_minor).toBe(1234);
    expect(fake.receipt?.receipt_number).toBe("RCP-2-00000011");
    expect(fake.audits).toHaveLength(2);
    expect([...fake.events.values()].filter((event) => event.status === "VERIFIED")).toHaveLength(1);
  });

  it("rolls back a failed receipt transaction so provider retry can safely settle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: expectedReference, amount: 1234, currency: "NGN",
    } })));
    fake.failReceiptOnce = true;
    const failed = await postWebhook(signedWebhook());
    expect(failed.status).toBe(500);
    expect(fake.payment.status).toBe("PENDING");
    expect(fake.invoice.paid_minor).toBe(0);
    expect(fake.events.size).toBe(0);

    const retry = await postWebhook(signedWebhook());
    expect(retry.status).toBe(200);
    expect(fake.payment.status).toBe("VERIFIED");
    expect(fake.invoice.paid_minor).toBe(1234);
    expect(fake.events.size).toBe(1);
  });

  it.each([
    ["amount mismatch", { id: 456, status: "success", reference: expectedReference, amount: 1235, currency: "NGN" }],
    ["fake success", { id: 456, status: "pending", reference: expectedReference, amount: 1234, currency: "NGN" }],
  ])("retains %s without invoice credit", async (_caseName, providerData) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: providerData })));
    const result = await postWebhook(signedWebhook());
    if (_caseName === "fake success") {
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ outcome: "pending" });
    } else {
      expect(result.status).toBe(202);
      expect(await result.json()).toMatchObject({ outcome: "reconciliation_required" });
      expect([...fake.events.values()][0]).toMatchObject({
        status: "RECONCILIATION_REQUIRED", signature_verified: true, school_id: 2, payment_id: 11,
      });
    }
    expect(fake.payment.status).toBe("PENDING");
    expect(fake.invoice.paid_minor).toBe(0);
    expect(fake.receipt).toBeNull();
  });

  it("records a provider failure without crediting the invoice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "failed", reference: expectedReference, amount: 1234, currency: "NGN",
    } })));
    const result = await postWebhook(signedWebhook({ status: "failed" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ outcome: "failed" });
    expect(fake.payment.status).toBe("FAILED");
    expect(fake.invoice.paid_minor).toBe(0);
    expect(fake.receipt).toBeNull();
  });

  it("re-verifies a previously failed provider event and settles it atomically after success", async () => {
    let providerStatus = "failed";
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: providerStatus, reference: expectedReference, amount: 1234, currency: "NGN",
    } })));
    const body = signedWebhook({ status: "failed" });
    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ outcome: "failed" });
    expect(fake.payment.status).toBe("FAILED");
    expect(fake.invoice.paid_minor).toBe(0);

    providerStatus = "success";
    const retry = await postWebhook(body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ outcome: "verified" });
    expect(fake.payment).toMatchObject({ status: "VERIFIED", provider_transaction_id: "456" });
    expect(fake.invoice).toMatchObject({ paid_minor: 1234, outstanding_minor: 0 });
    expect(fake.session.state).toBe("SETTLED");
    expect(fake.events.get("PAYSTACK:paystack:456")).toMatchObject({ status: "VERIFIED" });
    expect(fake.audits).toHaveLength(2);
  });

  it("holds a delayed success for reconciliation after the reservation was released", async () => {
    fake.session.state = "RELEASED";
    fake.session.session_state = "RELEASED";
    fake.payment.status = "FAILED";
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: expectedReference, amount: 1234, currency: "NGN",
    } })));

    const result = await postWebhook(signedWebhook());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ received: true, outcome: "reconciliation_required" });
    expect(fake.payment.status).toBe("FAILED");
    expect(fake.invoice).toMatchObject({ paid_minor: 0, outstanding_minor: 1234 });
    expect(fake.session.state).toBe("RELEASED");
    expect(fake.receipt).toBeNull();
    expect(fake.events.get(recordKey("PAYSTACK", "paystack:456"))?.status).toBe("RECONCILIATION_REQUIRED");
  });

  it("settles a delayed success after release only through explicit admin reconciliation", async () => {
    fake.session.state = "RELEASED";
    fake.session.session_state = "RELEASED";
    fake.payment.status = "FAILED";

    const outcome = await settleVerifiedPayment(
      "PAYSTACK",
      `reconcile:paystack:456`,
      {
        reference: expectedReference, amountMinor: 1234, currency: "NGN",
        status: "succeeded", providerTransactionId: "456",
      },
      Buffer.alloc(0),
      "ADMIN_RECONCILIATION",
    );

    expect(outcome).toBe("verified");
    expect(fake.payment).toMatchObject({ status: "VERIFIED", provider_transaction_id: "456" });
    expect(fake.invoice).toMatchObject({ paid_minor: 1234, outstanding_minor: 0 });
    expect(fake.session.state).toBe("SETTLED");
    expect(fake.receipt).not.toBeNull();
    expect(fake.events.get(recordKey("PAYSTACK", "reconcile:paystack:456"))?.signature_verified).toBe(false);
  });

  it("records an authenticated unknown reference for reconciliation but rejects invalid signatures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: true, data: {
      id: 456, status: "success", reference: "fee_unknown1234567", amount: 1234, currency: "NGN",
    } })));
    const unknownBody = signedWebhook({ reference: "fee_unknown1234567" });
    const unknown = await postWebhook(unknownBody);
    expect(unknown.status).toBe(202);
    expect([...fake.events.values()][0]).toMatchObject({
      status: "RECONCILIATION_REQUIRED", signature_verified: true, school_id: null, payment_id: null,
    });

    const invalid = await httpFetch(`${baseUrl}/paystack`, {
      method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": "bad" },
      body: signedWebhook(),
    });
    expect(invalid.status).toBe(401);
    expect(fake.events.size).toBe(1);
  });
});