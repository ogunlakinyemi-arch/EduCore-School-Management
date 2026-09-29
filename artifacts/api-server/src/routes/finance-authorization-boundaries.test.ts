import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  invoices: [
    {
      id: 41, schoolId: 1, studentId: 101, invoiceNumber: "A-41", studentName: "Student A",
      sessionId: 1, termId: 1, currency: "NGN", subtotalMinor: 5000, discountMinor: 0,
      waiverMinor: 0, totalMinor: 5000, paidMinor: 0, outstandingMinor: 5000, status: "UNPAID",
    },
    {
      id: 42, schoolId: 1, studentId: 102, invoiceNumber: "A-42", studentName: "Student B",
      sessionId: 1, termId: 1, currency: "NGN", subtotalMinor: 6000, discountMinor: 0,
      waiverMinor: 0, totalMinor: 6000, paidMinor: 0, outstandingMinor: 6000, status: "UNPAID",
    },
    {
      id: 82, schoolId: 2, studentId: 202, invoiceNumber: "B-82", studentName: "Student C",
      sessionId: 1, termId: 1, currency: "NGN", subtotalMinor: 7000, discountMinor: 0,
      waiverMinor: 0, totalMinor: 7000, paidMinor: 0, outstandingMinor: 7000, status: "UNPAID",
    },
  ] as Array<Record<string, any>>,
  parentChildren: { 20: [101], 21: [102] } as Record<number, number[]>,
  studentUsers: { 101: 1010, 102: 1020, 202: 2020 } as Record<number, number>,
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_invoices i WHERE i.school_id=$1")) {
      return { rows: state.invoices.filter((invoice) => invoice.schoolId === Number(values[0])) };
    }
    if (sql.includes("FROM fee_invoices i") && sql.includes("parent_student_relationships")) {
      const linkedStudents = state.parentChildren[Number(values[0])] ?? [];
      return { rows: state.invoices.filter((invoice) => linkedStudents.includes(invoice.studentId)) };
    }
    if (sql.includes("FROM fee_invoices i") && sql.includes("JOIN students st")) {
      const userId = Number(values[0]);
      return { rows: state.invoices.filter((invoice) => state.studentUsers[invoice.studentId] === userId) };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("WHERE p.id=$1 AND p.school_id=$2")) {
      return { rows: [] };
    }
    if (sql.includes("FROM fee_receipts r JOIN fee_payments p")) {
      return { rows: [] };
    }
    if (sql.includes("FROM fee_refunds fr")) {
      return { rows: [] };
    }
    if (sql.includes("FROM fee_payment_notification_outbox")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM fee_payment_notifications n")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unhandled finance authorization boundary query: ${sql}`);
  });
  const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    throw new Error(`Unexpected finance authorization boundary mutation: ${sql}`);
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
          clerkUserId: "finance-boundary-test",
          email: "finance-boundary@example.test",
          firstName: "Finance",
          lastName: "Boundary",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{
          id: 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1),
          status: "ACTIVE",
        }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";
import financeNotificationsRouter from "./finance-notifications";

const app = express();
app.use(express.json());
app.use(financeRouter);
app.use(financeNotificationsRouter);
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

const mutations = () => state.calls.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql));

describe("finance direct-API authorization boundaries", () => {
  it("denies cross-school invoice, payment, receipt, refund, report, and notification reads", async () => {
    const invoice = await get("/school/finance/invoices?schoolId=2", "ACCOUNTANT", 1);
    const payment = await get("/school/finance/payments/72?schoolId=1", "ACCOUNTANT", 1);
    const receipt = await get("/finance/payments/72/receipt?schoolId=1", "ACCOUNTANT", 1);
    const refund = await get("/school/finance/refunds/82?schoolId=1", "SCHOOL_ADMIN", 1);
    const report = await get("/school/finance/reports?schoolId=2&reportType=summary", "ACCOUNTANT", 1);
    const notification = await get("/me/finance/payment-notifications?schoolId=2", "ACCOUNTANT", 1);

    expect([invoice.status, payment.status, receipt.status, refund.status, report.status, notification.status])
      .toEqual([404, 404, 404, 404, 404, 404]);
    expect(state.calls.some(({ sql, values }) =>
      sql.includes("FROM fee_payments p") && values[0] === 72 && values[1] === 1,
    )).toBe(true);
    expect(state.calls.some(({ sql, values }) =>
      sql.includes("FROM fee_receipts r JOIN fee_payments p") && values[0] === 72 && values[1] === 1,
    )).toBe(true);
    expect(state.calls.some(({ sql, values }) =>
      sql.includes("FROM fee_refunds fr") && values[0] === 82 && values[1] === 1,
    )).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("FROM fee_payment_notification_outbox"))).toBe(false);
    expect(mutations()).toEqual([]);
  });

  it("keeps parent invoice reads restricted to their linked child despite query tampering", async () => {
    const parentA = await get("/parent/fees/invoices?studentId=102&schoolId=2", "PARENT", 1, 20);
    expect(parentA.status).toBe(200);
    expect((await parentA.json() as Array<{ id: number }>).map(({ id }) => id)).toEqual([41]);

    const parentB = await get("/parent/fees/invoices", "PARENT", 1, 21);
    expect(parentB.status).toBe(200);
    expect((await parentB.json() as Array<{ id: number }>).map(({ id }) => id)).toEqual([42]);

    const parentQuery = state.calls.find(({ sql }) => sql.includes("parent_student_relationships"));
    expect(parentQuery?.values).toEqual([20]);
    expect(parentQuery?.sql).toContain("r.student_id=i.student_id");
    expect(mutations()).toEqual([]);
  });

  it("keeps student invoice reads restricted to the authenticated student's own record", async () => {
    const studentA = await get("/student/fees/invoices?studentId=102&schoolId=2", "STUDENT", 1, 1010);
    expect(studentA.status).toBe(200);
    expect((await studentA.json() as Array<{ id: number }>).map(({ id }) => id)).toEqual([41]);

    const studentB = await get("/student/fees/invoices", "STUDENT", 1, 1020);
    expect(studentB.status).toBe(200);
    expect((await studentB.json() as Array<{ id: number }>).map(({ id }) => id)).toEqual([42]);

    const studentQuery = state.calls.find(({ sql }) => sql.includes("JOIN students st"));
    expect(studentQuery?.values).toEqual([1010]);
    expect(studentQuery?.sql).toContain("st.user_id=$1");
    expect(mutations()).toEqual([]);
  });

  it.each(["TEACHER", "PARTNER"])(
    "prevents %s from verifying transfers, requesting refunds, or changing adjustments",
    async (role) => {
      const headers = { "content-type": "application/json", "x-test-role": role, "x-test-school": "1" };
      const verify = await fetch(`${baseUrl}/school/finance/payments/71/verify?schoolId=1`, {
        method: "POST",
        headers,
        body: JSON.stringify({ evidenceReference: "bank-line-1", reviewerNotes: "Matched statement" }),
      });
      const refund = await fetch(`${baseUrl}/school/finance/payments/71/refunds?schoolId=1`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `unauthorized-${role}` },
        body: JSON.stringify({ amountMinor: 100, reason: "Unauthorized", transactionType: "REFUND" }),
      });
      const adjustment = await fetch(`${baseUrl}/school/finance/invoices/41/adjustments?schoolId=1`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "DISCOUNT", amountMinor: 100, reason: "Unauthorized" }),
      });

      expect([verify.status, refund.status, adjustment.status]).toEqual([404, 404, 404]);
      expect(mutations()).toEqual([]);
      expect(state.calls.every(({ sql }) => ["ROLLBACK"].includes(sql))).toBe(true);
    },
  );

  it("prevents non-admin finance roles from approving refunds or adjustments", async () => {
    const headers = { "content-type": "application/json", "x-test-role": "ACCOUNTANT", "x-test-school": "1" };
    const refund = await fetch(`${baseUrl}/school/finance/refunds/81/approve?schoolId=1`, {
      method: "POST",
      headers,
      body: JSON.stringify({ evidenceReference: "external-refund-1", reviewerNotes: "Bank refund confirmed" }),
    });
    const adjustment = await fetch(`${baseUrl}/school/finance/adjustments/91/approve?schoolId=1`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    expect([refund.status, adjustment.status]).toEqual([404, 404]);
    expect(mutations()).toEqual([]);
    expect(state.calls.every(({ sql }) => ["ROLLBACK"].includes(sql))).toBe(true);
  });

  it("denies non-finance roles access to school-wide reports before querying", async () => {
    const response = await get("/school/finance/reports?schoolId=1&reportType=summary", "PARENT", 1, 20);
    expect(response.status).toBe(404);
    expect(state.calls).toEqual([]);
    expect(mutations()).toEqual([]);
  });
});