import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
}));
const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes('"totalBilledMinor"')) {
      return result([{
        totalBilledMinor: "12000", totalCollectedMinor: "7000", totalOutstandingMinor: "5000",
        totalDiscountMinor: "500", totalWaiverMinor: "0", totalRefundedMinor: "1000",
        totalAdjustmentsMinor: "500", totalReversedMinor: "0", pendingPayments: 1,
      }]);
    }
    if (sql.includes("SELECT 'TOTAL'::text AS label")) {
      return result([{ label: "TOTAL", count: 3, amountMinor: "12000", secondaryAmountMinor: "5000" }]);
    }
    if (sql.includes("'CHECKOUT'::text AS \"sourceType\"")) {
      return result([
        {
          sourceType: "CHECKOUT", schoolId: 5, provider: "PAYSTACK", checkoutState: "FAILED",
          reconciliationStatus: null, signatureVerified: null, eventId: null, webhookTransactionId: null,
          verifiedTransactionId: null, reference: "EDC-31", providerReference: "EDC-31",
          reason: "Bearer abc123", studentId: 19, studentName: "Ada Example", invoiceId: 31,
          invoiceNumber: "INV-31", paymentStatus: "FAILED", eventDate: "2026-10-03T11:12:13.000Z",
          label: "CHECKOUT:FAILED", count: 1, amountMinor: "0", secondaryAmountMinor: "0",
        },
        {
          sourceType: "WEBHOOK", schoolId: 5, provider: "PAYSTACK", checkoutState: "FAILED",
          reconciliationStatus: "RECONCILIATION_REQUIRED", signatureVerified: true,
          eventId: "evt-31", webhookTransactionId: "txn-webhook-31", verifiedTransactionId: null,
          reference: "EDC-31", providerReference: "EDC-31", reason: "Mismatch token=secret https://provider.test/path",
          studentId: 19, studentName: "Ada Example", invoiceId: 31, invoiceNumber: "INV-31",
          paymentStatus: "FAILED", eventDate: "2026-10-03T11:13:13.000Z",
          label: "WEBHOOK:RECONCILIATION_REQUIRED", count: 1, amountMinor: "0", secondaryAmountMinor: "0",
        },
      ]);
    }
    if (sql.includes("AS \"paymentDate\"")) {
      return result([{
        label: values.includes("REFUNDED") ? "BANK_TRANSFER:REFUNDED" : "BANK_TRANSFER:VERIFIED",
        count: 1, amountMinor: values.includes("REFUNDED") ? "0" : "1500", secondaryAmountMinor: "0",
        studentId: 19, studentName: "Ada Example", invoiceId: 31, invoiceNumber: "INV-31",
        reference: "PAY-31", paymentDate: "2026-10-03T11:12:13.000Z",
        paidMinor: null, outstandingMinor: null, overdue: null,
      }]);
    }
    if (sql.includes("AS \"totalCollectedMinor\"") && !sql.includes("totalBilledMinor")) {
      return result([{ totalCollectedMinor: values.includes("REFUNDED") ? "0" : "1500" }]);
    }
    if (sql.includes("outstanding_minor::bigint AS \"outstandingMinor\"")) {
      return result([{
        label: "OVERDUE", count: 1, amountMinor: "1200", secondaryAmountMinor: "5000",
        studentId: 19, studentName: "Ada Example", invoiceId: 31, invoiceNumber: "INV-31",
        reference: null, originalAmountMinor: "5000", paidMinor: "3800", outstandingMinor: "1200", overdue: true,
      }]);
    }
    throw new Error(`Unhandled finance report test query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});
vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const schoolId = Number(req.header("x-test-school") ?? 5);
      (req as any).edupulseUser = {
        user: { id: 30, clerkUserId: "report-user", email: "report@example.test" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";
const app = express();
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
  state.calls.length = 0;
  dbMock.query.mockClear();
});

describe("school finance reports", () => {
  it("includes approved adjustments and refunds in school finance summary", async () => {
    const response = await fetch(`${baseUrl}/school/finance/summary?schoolId=5`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      totalBilledMinor: 12000, totalCollectedMinor: 7000, totalOutstandingMinor: 5000,
      totalAdjustmentsMinor: 500, totalRefundedMinor: 1000, pendingPayments: 1,
      totalReversedMinor: 0,
    });
  });

  it("returns school-filtered aggregate totals and summary rows without student data", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&sessionId=7&termId=8&classId=9&reportType=summary`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body).toMatchObject({
      schoolId: 5, reportType: "summary", totalBilledMinor: 12000, totalCollectedMinor: 7000,
      totalOutstandingMinor: 5000, totalDiscountMinor: 500, totalWaiverMinor: 0, totalRefundedMinor: 1000,
      rows: [{ label: "TOTAL", count: 3, amountMinor: 12000, secondaryAmountMinor: 5000 }],
    });
    expect(JSON.stringify(body)).not.toContain("studentName");
    expect(state.calls[0].sql).toContain("i.school_id=$1");
    expect(state.calls[0].sql).toContain("i.academic_session_id=$2");
    expect(state.calls[0].sql).toContain("i.academic_term_id=$3");
    expect(state.calls[0].sql).toContain("fee_structures fs");
    expect(state.calls[0].sql).toContain("FROM fee_payments p");
    expect(state.calls[0].sql).toContain("fr.status='APPROVED'");
    expect(state.calls[0].sql).toContain("GREATEST(p.amount_minor");
    expect(state.calls[0].values).toEqual([5, 7, 8, 9]);
  });

  it("does not allow report reads from another school", async () => {
    const response = await fetch(`${baseUrl}/school/finance/reports?schoolId=5`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "6" },
    });
    expect(response.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("filters and displays payment date by verification timestamp and returns payment details", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&reportType=payments&studentId=19&method=BANK_TRANSFER&provider=MANUAL_BANK_TRANSFER&from=2026-10-01&to=2026-10-31`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.rows[0]).toMatchObject({
      studentId: 19, studentName: "Ada Example", invoiceId: 31, invoiceNumber: "INV-31",
      reference: "PAY-31", paymentDate: "2026-10-03T11:12:13.000Z", amountMinor: 1500,
    });
    expect(body.totalCollectedMinor).toBe(1500);
    const paymentQuery = state.calls.find((call) => call.sql.includes("AS \"paymentDate\""));
    expect(paymentQuery?.sql).toContain("i.student_id=$2");
    expect(paymentQuery?.sql).toContain("fp.method=$3");
    expect(paymentQuery?.sql).toContain("p.provider=$4");
    expect(paymentQuery?.sql).toContain("p.method=$5");
    expect(paymentQuery?.sql).toContain("COALESCE(p.verified_at,p.created_at) >= $6::date");
    expect(paymentQuery?.sql).toContain("COALESCE(p.verified_at,p.created_at) < $7::date + INTERVAL '1 day'");
    expect(paymentQuery?.sql).toContain("COALESCE(p.verified_at,p.created_at) AT TIME ZONE 'UTC'");
    expect(paymentQuery?.sql).toContain("ORDER BY COALESCE(p.verified_at,p.created_at) DESC");
    expect(paymentQuery?.sql).not.toContain("i.issue_date");
    expect(paymentQuery?.values).toEqual([5, 19, "BANK_TRANSFER", "MANUAL_BANK_TRANSFER", "BANK_TRANSFER", "2026-10-01", "2026-10-31"]);
    const collectionQuery = state.calls.find((call) => call.sql.includes("AS \"totalCollectedMinor\"") && !call.sql.includes("totalBilledMinor"));
    expect(collectionQuery?.sql).toContain("p.status IN ('VERIFIED','REFUNDED','REVERSED')");
    expect(collectionQuery?.sql).toContain("p.provider=$6");
    expect(collectionQuery?.sql).toContain("p.method=$7");
    expect(collectionQuery?.sql).toContain("SUM(fr.amount_minor)");
    expect(collectionQuery?.sql).toContain("fr.status='APPROVED'");
    expect(collectionQuery?.values).toContain(19);
    expect(collectionQuery?.values).toContain("BANK_TRANSFER");
    expect(collectionQuery?.values).toContain("MANUAL_BANK_TRANSFER");
    expect(state.calls[0].sql).toContain("FROM fee_payments p");
    expect(state.calls[0].sql).toContain("fr.status='APPROVED'");
  });

  it("returns tenant-scoped checkout and webhook reconciliation events with sanitized reasons", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&reportType=provider-reconciliation&studentId=19&method=PAYSTACK&provider=PAYSTACK&from=2026-10-01&to=2026-10-31`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({
      sourceType: "CHECKOUT", schoolId: 5, provider: "PAYSTACK", checkoutState: "FAILED",
      reference: "EDC-31", studentId: 19, eventDate: "2026-10-03T11:12:13.000Z",
      reason: "Bearer [redacted]",
    });
    expect(body.rows[1]).toMatchObject({
      sourceType: "WEBHOOK", schoolId: 5, provider: "PAYSTACK",
      reconciliationStatus: "RECONCILIATION_REQUIRED", signatureVerified: true,
      eventId: "evt-31", webhookTransactionId: "txn-webhook-31", providerReference: "EDC-31",
      reason: "Mismatch token=[redacted] [provider URL]",
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("checkoutUrl");
    const eventsQuery = state.calls.find((call) => call.sql.includes("'CHECKOUT'::text AS \"sourceType\""));
    expect(eventsQuery?.sql).toContain("cs.school_id=$1");
    expect(eventsQuery?.sql).toContain("e.school_id=$1");
    expect(eventsQuery?.sql).toContain("p.student_id=$2");
    expect(eventsQuery?.sql).toContain("p.method=$3");
    expect(eventsQuery?.sql).toContain("cs.created_at >= $5::date");
    expect(eventsQuery?.sql).toContain("e.received_at >= $5::date");
    expect(eventsQuery?.values).toEqual([
      5, 19, "PAYSTACK", "PAYSTACK", "2026-10-01", "2026-10-31",
    ]);
    expect(eventsQuery?.sql).not.toContain("LEFT JOIN fee_provider_checkout_sessions cs ON cs.payment_id=p.id");
    expect(eventsQuery?.sql).toContain("p.amount_minor::bigint AS \"amountMinor\"");
  });

  it("retains refunded status filters and excludes fully refunded payments from net collections", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&reportType=payments&status=REFUNDED`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.totalCollectedMinor).toBe(0);
    expect(body.rows[0]).toMatchObject({ label: "BANK_TRANSFER:REFUNDED", amountMinor: 0 });
    const collectionQuery = state.calls.find((call) => call.sql.includes("AS \"totalCollectedMinor\"") && !call.sql.includes("totalBilledMinor"));
    expect(collectionQuery?.sql).toContain("p.status=$2");
    expect(collectionQuery?.sql).toContain("GREATEST(p.amount_minor");
    expect(collectionQuery?.values).toContain("REFUNDED");
    const paymentQuery = state.calls.find((call) => call.sql.includes("AS \"paymentDate\""));
    expect(paymentQuery?.sql).toContain("p.status=$2");
    expect(paymentQuery?.values).toContain("REFUNDED");
  });

  it("returns outstanding invoice details and overdue state", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&reportType=outstanding`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.rows[0]).toMatchObject({
      studentName: "Ada Example", invoiceNumber: "INV-31", amountMinor: 1200,
      originalAmountMinor: 5000, paidMinor: 3800, outstandingMinor: 1200, overdue: true,
    });
  });
});