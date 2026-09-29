import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payment: { id: 11, school_id: 1, invoice_id: 22, status: "VERIFIED", amount_minor: 5000, currency: "NGN" } as Record<string, any>,
  invoice: { id: 22, school_id: 1, total_minor: 5000, paid_minor: 5000, outstanding_minor: 0, status: "PAID" } as Record<string, any>,
  refunds: [] as Array<Record<string, any>>,
  calls: [] as Array<{ sql: string; values: any[] }>,
  auditCount: 0,
  notificationAudits: [] as Array<{ schoolId: number; recordId: number; metadata: Record<string, any> }>,
  failNotificationInsert: false,
  failNotificationOutbox: false,
  notificationOutbox: [] as any[],
}));

const refundView = (refund: Record<string, any>) => ({
  id: refund.id,
  schoolId: refund.school_id,
  paymentId: refund.payment_id,
  invoiceId: refund.invoice_id,
  transactionType: refund.transaction_type ?? "REFUND",
  amountMinor: refund.amount_minor,
  currency: refund.currency,
  reason: refund.reason,
  status: refund.status,
  reference: refund.reference,
  evidenceReference: refund.evidence_reference ?? null,
  reviewerNotes: refund.reviewer_notes ?? null,
});

const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
        || sql.startsWith("SAVEPOINT") || sql.startsWith("RELEASE SAVEPOINT")
        || sql.startsWith("ROLLBACK TO SAVEPOINT")) return result();
    if (sql.includes("SELECT invoice_id FROM fee_payments")) {
      return result(state.payment.id === Number(values[0]) && state.payment.school_id === Number(values[1])
        ? [{ invoice_id: state.payment.invoice_id }] : []);
    }
    if (sql.includes("SELECT * FROM fee_payments")) {
      return result(state.payment.id === Number(values[0]) && state.payment.school_id === Number(values[1])
        ? [{ ...state.payment }] : []);
    }
    if (sql.includes("SELECT * FROM fee_invoices")) {
      return result(state.invoice.id === Number(values[0]) && state.invoice.school_id === Number(values[1])
        ? [{ ...state.invoice }] : []);
    }
    if (sql.includes("SELECT payment_id,invoice_id FROM fee_refunds")) {
      const item = state.refunds.find((refund) => refund.id === Number(values[0]) && refund.school_id === Number(values[1]));
      return result(item ? [{ payment_id: item.payment_id, invoice_id: item.invoice_id }] : []);
    }
    if (sql.includes("FROM fee_refunds WHERE school_id=$1 AND idempotency_key=$2")) {
      const item = state.refunds.find((refund) => refund.school_id === Number(values[0]) && refund.idempotency_key === values[1]);
      return result(item ? [refundView(item)] : []);
    }
    if (sql.includes("SELECT * FROM fee_refunds WHERE id=$1")) {
      const item = state.refunds.find((refund) => refund.id === Number(values[0]) && refund.school_id === Number(values[1]));
      return result(item ? [{ ...item }] : []);
    }
    if (sql.includes("SELECT COALESCE(SUM(amount_minor),0)::int AS total_minor")) {
      const statuses = sql.includes("'PENDING','APPROVED'") ? ["PENDING", "APPROVED"] : ["APPROVED"];
      const total = state.refunds
        .filter((refund) => refund.school_id === Number(values[0]) && refund.payment_id === Number(values[1]) && statuses.includes(refund.status))
        .reduce((sum, refund) => sum + refund.amount_minor, 0);
      return result([{ total_minor: total }]);
    }
    if (sql.includes("SELECT id FROM fee_refunds WHERE school_id=$1 AND id<>$2")) return result();
    if (sql.includes("INSERT INTO fee_refunds")) {
      const item = {
        id: state.refunds.length + 101,
        school_id: values[0], payment_id: values[1], invoice_id: values[2], reference: values[3],
        idempotency_key: values[4], transaction_type: values[5], amount_minor: values[6],
        currency: values[7], reason: values[8], requested_by: values[9], status: "PENDING",
      };
      state.refunds.push(item);
      return result([refundView(item)]);
    }
    if (sql.includes("UPDATE fee_refunds SET status='APPROVED'")) {
      const item = state.refunds.find((refund) => refund.id === Number(values[3]));
      if (!item || item.status !== "PENDING") return result();
      item.status = "APPROVED";
      item.approved_by = values[0];
      item.evidence_reference = values[1];
      item.reviewer_notes = values[2];
      return result([refundView(item)]);
    }
    if (sql.includes("UPDATE fee_invoices SET paid_minor")) {
      state.invoice.paid_minor = values[0];
      state.invoice.outstanding_minor = values[1];
      state.invoice.status = values[2];
      return result();
    }
    if (sql.includes("UPDATE fee_payments SET status=$1")) {
      state.payment.status = values[0];
      return result();
    }
    if (sql.includes("INSERT INTO fee_payment_notifications")) {
      if (state.failNotificationInsert) {
        state.failNotificationInsert = false;
        throw new Error("simulated notification insert failure");
      }
      return result([{ id: 71 }]);
    }
    if (sql.includes("INSERT INTO fee_payment_notification_outbox")) {
      if (state.failNotificationOutbox) throw new Error("simulated outbox persistence failure");
      state.notificationOutbox.push({
        paymentId: values[0], schoolId: values[1], eventType: values[2], eventReferenceId: values[3],
      });
      return result([{ id: state.notificationOutbox.length }]);
    }
    if (sql.includes("DELETE FROM fee_payment_notification_outbox")) {
      state.notificationOutbox = state.notificationOutbox.filter((event) =>
        !(event.paymentId === values[0] && event.schoolId === values[1]
          && event.eventType === values[2] && event.eventReferenceId === values[3]));
      return result();
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      state.auditCount += 1;
      if (sql.includes("'FEE_PAYMENT_NOTIFICATION'")) {
        state.notificationAudits.push({
          schoolId: Number(values[0]),
          recordId: Number(values[1]),
          metadata: values[2] as Record<string, any>,
        });
      }
      return result();
    }
    throw new Error(`Unhandled refund test query: ${sql}`);
  });
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
});

vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const schoolId = Number(req.header("x-test-school") ?? 1);
      (req as any).edupulseUser = {
         user: {
           id: Number(req.header("x-test-user") ?? 20), clerkUserId: "refund-user",
           email: "refund@example.test", firstName: "Refund", lastName: "Reviewer",
         },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";

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
  state.payment = { id: 11, school_id: 1, invoice_id: 22, status: "VERIFIED", amount_minor: 5000, currency: "NGN" };
  state.invoice = { id: 22, school_id: 1, total_minor: 5000, paid_minor: 5000, outstanding_minor: 0, status: "PAID" };
  state.refunds.length = 0;
  state.calls.length = 0;
  state.auditCount = 0;
  state.notificationAudits.length = 0;
  state.failNotificationInsert = false;
  state.failNotificationOutbox = false;
  state.notificationOutbox.length = 0;
  dbMock.query.mockClear();
});

const requestRefund = (
  amountMinor: unknown = 3000,
  headers: Record<string, string> = {},
  transactionType: "REFUND" | "REVERSAL" = "REFUND",
  reason = "Approved credit correction",
) =>
  fetch(`${baseUrl}/school/finance/payments/11/refunds?schoolId=1`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "refund-request-0001", ...headers },
    body: JSON.stringify({ amountMinor, reason, transactionType }),
  });

describe("school fee refunds", () => {
  it("enforces exact-school roles and rejects precision-loss amounts", async () => {
    const wrongSchool = await requestRefund(1000, { "x-test-role": "ACCOUNTANT", "x-test-school": "2" });
    expect(wrongSchool.status).toBe(404);
    const parent = await requestRefund(1000, { "x-test-role": "PARENT" });
    expect(parent.status).toBe(404);
    const fractional = await requestRefund(1000.5);
    expect(fractional.status).toBe(400);
    const unsafeInteger = await requestRefund(9007199254740992, { "Idempotency-Key": "refund-precision-0001" });
    expect(unsafeInteger.status).toBe(400);
    expect(state.refunds).toHaveLength(0);
  });

  it("uses idempotency and reserves the refundable balance without mutating the original payment", async () => {
    const first = await requestRefund();
    const replay = await requestRefund();
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ id: 101, amountMinor: 3000, status: "PENDING" });
    expect(state.refunds).toHaveLength(1);
    expect(state.payment.status).toBe("VERIFIED");
    expect(state.refunds[0].idempotency_key).toBe("refund-request-0001");
    expect(state.refunds[0].requested_by).toBe(20);
    const excess = await requestRefund(3000, { "Idempotency-Key": "refund-request-0002" });
    expect(excess.status).toBe(409);
  });

  it("scopes idempotency to the school key, replays across actors, and rejects fingerprint changes", async () => {
    const first = await requestRefund(1000);
    const crossActorReplay = await requestRefund(1000, { "x-test-user": "21" });
    expect(first.status).toBe(201);
    expect(crossActorReplay.status).toBe(201);
    expect(await crossActorReplay.json()).toMatchObject({ id: 101, amountMinor: 1000 });
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0].requested_by).toBe(20);

    expect((await requestRefund(1001)).status).toBe(409);
    expect((await requestRefund(1000, {}, "REVERSAL")).status).toBe(409);
    expect((await requestRefund(1000, {}, "REFUND", "Different reason")).status).toBe(409);
    expect(state.refunds).toHaveLength(1);
  });

  it("requires approval evidence and idempotently restores invoice balance while preserving payment", async () => {
    const requested = await requestRefund();
    const refund = await requested.json() as { id: number };
    const approve = (evidenceReference: string, reviewerNotes: string) =>
      fetch(`${baseUrl}/school/finance/refunds/${refund.id}/approve?schoolId=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceReference, reviewerNotes }),
      });
    const missingEvidence = await approve(" ", " ");
    expect(missingEvidence.status).toBe(400);
    const approved = await approve("bank-refund-line-22", "Confirmed external refund transaction");
    expect(approved.status).toBe(200);
    expect(state.invoice).toMatchObject({ paid_minor: 2000, outstanding_minor: 3000, status: "PARTIALLY_PAID" });
    expect(state.payment.status).toBe("VERIFIED");
    const delivery = state.calls.find(({ sql }) => sql.includes("INSERT INTO fee_payment_notifications"));
    expect(delivery?.values).toEqual([11, 1, "REFUND_APPROVED", refund.id]);
    const replay = await approve("bank-refund-line-22", "Confirmed external refund transaction");
    expect(replay.status).toBe(200);
    expect(state.invoice.paid_minor).toBe(2000);
    expect(state.auditCount).toBe(3);
    expect(state.notificationAudits).toHaveLength(1);
    expect(state.notificationAudits[0]).toMatchObject({
      schoolId: 1,
      recordId: 11,
      metadata: {
        refundId: refund.id,
        transactionType: "REFUND",
        amountMinor: 3000,
        eventType: "REFUND_APPROVED",
        channel: "IN_APP",
        createdCount: 1,
        externalChannels: { email: "BLOCKED_UNCONFIGURED", sms: "BLOCKED_UNCONFIGURED" },
      },
    });
  });

  it("commits approved refund balance updates while queuing a failed notification", async () => {
    const requested = await requestRefund();
    const refund = await requested.json() as { id: number };
    state.failNotificationInsert = true;
    const approved = await fetch(`${baseUrl}/school/finance/refunds/${refund.id}/approve?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidenceReference: "bank-refund-line-22", reviewerNotes: "Confirmed" }),
    });
    expect(approved.status).toBe(200);
    expect(state.refunds[0].status).toBe("APPROVED");
    expect(state.invoice).toMatchObject({ paid_minor: 2000, outstanding_minor: 3000 });
    expect(state.notificationOutbox).toEqual([{
      paymentId: 11, schoolId: 1, eventType: "REFUND_APPROVED", eventReferenceId: refund.id,
    }]);
    expect(state.calls.some(({ sql }) => sql === "ROLLBACK TO SAVEPOINT fee_payment_notification_delivery")).toBe(true);
    expect(state.calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("rolls refund approval back when the atomic notification intent cannot persist", async () => {
    const requested = await requestRefund();
    const refund = await requested.json() as { id: number };
    state.calls.length = 0;
    state.failNotificationOutbox = true;
    const approved = await fetch(`${baseUrl}/school/finance/refunds/${refund.id}/approve?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidenceReference: "bank-refund-line-22", reviewerNotes: "Confirmed" }),
    });
    expect(approved.status).toBe(500);
    expect(state.calls.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(state.calls.some(({ sql }) => sql === "COMMIT")).toBe(false);
  });

  it("marks the original payment refunded after a full internal refund while retaining its receipt record", async () => {
    const requested = await requestRefund(5000, { "Idempotency-Key": "refund-full-0001" });
    const refund = await requested.json() as { id: number };
    const approved = await fetch(`${baseUrl}/school/finance/refunds/${refund.id}/approve?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidenceReference: "internal-ledger-5000", reviewerNotes: "Approved internal correction record" }),
    });
    expect(approved.status).toBe(200);
    expect(state.payment.status).toBe("REFUNDED");
    expect(state.invoice).toMatchObject({ paid_minor: 0, outstanding_minor: 5000, status: "UNPAID" });
    expect(state.calls?.some((call: { sql: string }) => /DELETE FROM fee_receipts/i.test(call.sql))).toBe(false);
  });

  it("marks a fully reversed internal ledger entry as REVERSED, not REFUNDED", async () => {
    const requested = await requestRefund(5000, { "Idempotency-Key": "reversal-full-0001" }, "REVERSAL");
    const refund = await requested.json() as { id: number; transactionType: string };
    expect(refund.transactionType).toBe("REVERSAL");
    const approved = await fetch(`${baseUrl}/school/finance/refunds/${refund.id}/approve?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evidenceReference: "internal-reversal-5000", reviewerNotes: "Approved internal reversal record" }),
    });
    expect(approved.status).toBe(200);
    expect(state.payment.status).toBe("REVERSED");
    expect(state.notificationAudits).toHaveLength(1);
    expect(state.notificationAudits[0].metadata).toMatchObject({
      transactionType: "REVERSAL", eventType: "REVERSAL_APPROVED", refundId: refund.id,
    });
  });
});