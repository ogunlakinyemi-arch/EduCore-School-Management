import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  invoices: [
    { id: 41, schoolId: 1, studentId: 101, invoiceNumber: "A-41", studentName: "Student A", sessionId: 1, termId: 1, currency: "NGN", subtotalMinor: 5000, discountMinor: 0, waiverMinor: 0, totalMinor: 5000, paidMinor: 0, outstandingMinor: 5000, status: "UNPAID" },
    { id: 42, schoolId: 2, studentId: 202, invoiceNumber: "B-42", studentName: "Student B", sessionId: 1, termId: 1, currency: "NGN", subtotalMinor: 6000, discountMinor: 0, waiverMinor: 0, totalMinor: 6000, paidMinor: 0, outstandingMinor: 6000, status: "UNPAID" },
  ] as Array<Record<string, any>>,
  parentChildren: { 20: [101], 21: [202] } as Record<number, number[]>,
  studentUsers: { 101: 1010, 202: 2020 } as Record<number, number>,
  payments: [
    { id: 71, schoolId: 1, invoiceId: 41, studentId: 101, status: "VERIFIED" },
    { id: 72, schoolId: 2, invoiceId: 42, studentId: 202, status: "VERIFIED" },
  ] as Array<Record<string, any>>,
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_invoices i WHERE i.school_id=$1")) {
      return { rows: state.invoices.filter((invoice) => invoice.schoolId === Number(values[0])) };
    }
    if (sql.includes("FROM fee_invoices i") && sql.includes("parent_student_relationships")) {
      const students = state.parentChildren[Number(values[0])] ?? [];
      return { rows: state.invoices.filter((invoice) => students.includes(invoice.studentId)) };
    }
    if (sql.includes("FROM fee_invoices i") && sql.includes("JOIN students st")) {
      const userId = Number(values[0]);
      return { rows: state.invoices.filter((invoice) => state.studentUsers[invoice.studentId] === userId) };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("WHERE p.id=$1 AND p.school_id=$2")) {
      return { rows: state.payments.filter((payment) =>
        payment.id === Number(values[0]) && payment.schoolId === Number(values[1])) };
    }
    if (sql.includes("FROM fee_receipts r JOIN fee_payments p")) {
      let eligible = state.payments.filter((payment) =>
        payment.id === Number(values[0]) && payment.status === "VERIFIED");
      if (sql.includes("AND p.school_id=$2")) {
        eligible = eligible.filter((payment) => payment.schoolId === Number(values[1]));
      } else if (sql.includes("pa.user_id=$2")) {
        const childIds = state.parentChildren[Number(values[1])] ?? [];
        eligible = eligible.filter((payment) => childIds.includes(payment.studentId));
      } else if (sql.includes("st.user_id=$2")) {
        eligible = eligible.filter((payment) => state.studentUsers[payment.studentId] === Number(values[1]));
      }
      return { rows: eligible.map((payment) => ({
        receiptNumber: `RCP-${payment.schoolId}-${payment.id}`,
        paymentId: payment.id,
        schoolId: payment.schoolId,
        invoiceId: payment.invoiceId,
        snapshot: { schoolId: payment.schoolId, invoiceId: payment.invoiceId },
      })) };
    }
    throw new Error(`Unhandled finance authorization query: ${sql}`);
  });
  const clientQuery = vi.fn(async (sql: string) => {
    state.calls.push({ sql, values: [] });
    if (sql === "ROLLBACK") return { rows: [] };
    throw new Error(`Unexpected finance mutation query: ${sql}`);
  });
  return {
    query,
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    clientQuery,
  };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? "ACCOUNTANT") as any;
      (req as any).edupulseUser = {
        user: {
          id: Number(req.header("x-test-user") ?? 20),
          clerkUserId: "finance-authorization-test",
          email: "finance-security@example.test",
          firstName: "Finance",
          lastName: "Security",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{
          id: 1, role,
          schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1),
          status: "ACTIVE",
        }],
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
  state.calls.length = 0;
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
  poolMock.clientQuery.mockClear();
});

const get = (path: string, role: string, schoolId = 1, userId = 20) =>
  fetch(`${baseUrl}${path}`, {
    headers: { "x-test-role": role, "x-test-school": String(schoolId), "x-test-user": String(userId) },
  });

describe("finance role and tenant authorization matrix", () => {
  it("keeps school invoice, payment, receipt, and report reads inside the caller's school", async () => {
    const invoices = await get("/school/finance/invoices?schoolId=1", "ACCOUNTANT");
    expect(invoices.status).toBe(200);
    expect((await invoices.json() as any[]).map((invoice) => invoice.id)).toEqual([41]);

    const hiddenInvoices = await get("/school/finance/invoices?schoolId=2", "ACCOUNTANT");
    expect(hiddenInvoices.status).toBe(404);
    const payment = await get("/school/finance/payments/72?schoolId=1", "SCHOOL_ADMIN");
    expect(payment.status).toBe(404);
    const receipt = await get("/finance/payments/72/receipt?schoolId=1", "ACCOUNTANT");
    expect(receipt.status).toBe(404);
    const report = await get("/school/finance/reports?schoolId=2&reportType=summary", "ACCOUNTANT");
    expect(report.status).toBe(404);
    expect(state.calls.some(({ values }) => values[0] === 2)).toBe(false);
  });

  it("limits parent invoice results to that parent's linked child and school", async () => {
    const parentA = await get("/parent/fees/invoices", "PARENT", 1, 20);
    expect(parentA.status).toBe(200);
    expect((await parentA.json() as any[]).map((invoice) => invoice.id)).toEqual([41]);

    const parentB = await get("/parent/fees/invoices", "PARENT", 2, 21);
    expect(parentB.status).toBe(200);
    expect((await parentB.json() as any[]).map((invoice) => invoice.id)).toEqual([42]);

    const unlinkedParentTampering = await get("/parent/fees/invoices?studentId=202&schoolId=2", "PARENT", 1, 20);
    expect(unlinkedParentTampering.status).toBe(200);
    expect((await unlinkedParentTampering.json() as any[]).map((invoice) => invoice.id)).toEqual([41]);
  });

  it("limits student invoice access to the authenticated student's own record", async () => {
    const studentA = await get("/student/fees/invoices", "STUDENT", 1, 1010);
    expect(studentA.status).toBe(200);
    expect((await studentA.json() as any[]).map((invoice) => invoice.id)).toEqual([41]);
    const studentB = await get("/student/fees/invoices", "STUDENT", 2, 2020);
    expect(studentB.status).toBe(200);
    expect((await studentB.json() as any[]).map((invoice) => invoice.id)).toEqual([42]);

    const manipulatedStudent = await get("/student/fees/invoices?studentId=202&schoolId=2", "STUDENT", 1, 1010);
    expect(manipulatedStudent.status).toBe(200);
    expect((await manipulatedStudent.json() as any[]).map((invoice) => invoice.id)).toEqual([41]);
  });

  it.each(["TEACHER", "PARTNER"])("rejects %s finance-admin mutations, refunds, and manual verification", async (role) => {
    const updateSettings = await fetch(`${baseUrl}/school/finance/settings?schoolId=1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-role": role, "x-test-school": "1" },
      body: JSON.stringify({ bankTransferEnabled: false }),
    });
    const refund = await fetch(`${baseUrl}/school/finance/payments/71/refunds?schoolId=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-test-role": role, "x-test-school": "1",
        "Idempotency-Key": `unauthorized-${role}`,
      },
      body: JSON.stringify({ amountMinor: 100, reason: "Unauthorized refund attempt", transactionType: "REFUND" }),
    });
    const verification = await fetch(`${baseUrl}/school/finance/payments/71/verify?schoolId=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": role, "x-test-school": "1" },
      body: JSON.stringify({ evidenceReference: "bank-line-1", reviewerNotes: "Matched statement" }),
    });
    expect(updateSettings.status).toBe(404);
    expect(refund.status).toBe(404);
    expect(verification.status).toBe(404);
    expect(state.calls.some(({ sql }) => /INSERT INTO fee_refunds|UPDATE fee_payments SET status='VERIFIED'|INSERT INTO fee_school_settings/i.test(sql))).toBe(false);
  });
});