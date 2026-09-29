import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ACCOUNTANT",
  schoolId: 1,
  userId: 20,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  payment: {} as Record<string, any>,
  adjustment: {} as Record<string, any>,
  receipt: null as null | Record<string, any>,
  bankInvoiceId: 41,
  bankInvoiceSchoolId: 1,
  bankInvoiceStatus: "UNPAID",
  bankInvoiceOutstandingMinor: 45000,
  linkedParentUserId: 20,
  linkedParentSchoolId: 1,
  bankSettings: null as null | Record<string, any>,
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_invoices i") && sql.includes("WHERE i.id=$1 AND EXISTS")) {
      if (!sql.includes("p.status='ACTIVE'") || !sql.includes("r.status='ACTIVE'")) {
        throw new Error("Parent bank-details query is missing active relationship filters");
      }
      return Number(values[0]) === state.bankInvoiceId
          && Number(values[1]) === state.linkedParentUserId
          && state.bankInvoiceSchoolId === state.linkedParentSchoolId
        ? { rows: [{
          schoolId: state.bankInvoiceSchoolId,
          status: state.bankInvoiceStatus,
          outstandingMinor: state.bankInvoiceOutstandingMinor,
        }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_school_settings WHERE school_id=$1")) {
      return state.bankSettings && Number(values[0]) === state.bankInvoiceSchoolId
        ? { rows: [{ ...state.bankSettings }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("WHERE p.school_id=$1 AND")) {
      if (Number(values[0]) !== state.payment.schoolId) return { rows: [] };
      if (values[1] && values[1] !== state.payment.status) return { rows: [] };
      if (values[2] && values[2] !== state.payment.studentId) return { rows: [] };
      return { rows: [{ ...state.payment }] };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("WHERE p.id=$1 AND p.school_id=$2")) {
      return Number(values[0]) === state.payment.id && Number(values[1]) === state.payment.schoolId
        ? { rows: [{ ...state.payment }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("FROM parents pa")) {
      if (!sql.includes("pa.status='ACTIVE'") || !sql.includes("rel.status='ACTIVE'")) {
        throw new Error("Parent payment history query is missing active relationship filters");
      }
      return Number(values[0]) === state.userId
        ? { rows: [{ ...state.payment, verificationEvidenceReference: null, reviewerNotes: null }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_payments p") && sql.includes("JOIN students st")) {
      return Number(values[0]) === state.userId
        ? { rows: [{ ...state.payment, verificationEvidenceReference: null, reviewerNotes: null }] }
        : { rows: [] };
    }
    if (sql.includes("FROM fee_adjustments a")) {
      if (Number(values[0]) !== state.adjustment.schoolId || !sql.includes("a.status='PENDING'")) return { rows: [] };
      return { rows: [{ ...state.adjustment }] };
    }
    if (sql.includes("FROM fee_receipts r JOIN fee_payments p")) {
      if (!sql.includes("p.invoice_id=r.invoice_id")) throw new Error("Receipt query does not enforce invoice linkage");
      if (state.payment.status !== "VERIFIED" || Number(values[0]) !== state.payment.id) return { rows: [] };
      if (sql.includes("pa.user_id=$2") && Number(values[1]) !== state.userId) return { rows: [] };
      return state.receipt ? { rows: [{ ...state.receipt }] } : { rows: [] };
    }
    throw new Error(`Unhandled finance history query: ${sql}`);
  }),
  connect: vi.fn(async () => {
    throw new Error("No finance-history route should open a write connection");
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? state.role) as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? state.schoolId);
      (req as any).edupulseUser = {
        user: {
          id: Number(req.header("x-test-user") ?? state.userId),
          clerkUserId: "history-test-user",
          email: "history@example.test",
          firstName: "Test",
          lastName: "Viewer",
          phone: null,
          status: "ACTIVE",
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
  state.role = "ACCOUNTANT";
  state.schoolId = 1;
  state.userId = 20;
  state.bankInvoiceId = 41;
  state.bankInvoiceSchoolId = 1;
  state.bankInvoiceStatus = "UNPAID";
  state.bankInvoiceOutstandingMinor = 45000;
  state.linkedParentUserId = 20;
  state.linkedParentSchoolId = 1;
  state.bankSettings = null;
  state.calls.length = 0;
  state.payment = {
    id: 77,
    schoolId: 1,
    invoiceId: 41,
    invoiceNumber: "INV-41",
    studentId: 31,
    studentName: "Linked Student",
    schoolName: "Tenant One School",
    reference: "EDC-PAY-77",
    amountMinor: 45000,
    currency: "NGN",
    method: "BANK_TRANSFER",
    status: "PENDING",
    transferBank: "Test Bank",
    transferReference: "TRF-77",
    transferDate: "2026-09-01",
    proofUrl: "https://proof.example.test/77",
    rejectionReason: null,
    verificationEvidenceReference: "bank-statement-77",
    reviewerNotes: "Private internal review note",
    createdAt: "2026-09-01T12:00:00.000Z",
    verifiedAt: null,
    receiptNumber: null,
  };
  state.receipt = null;
  state.adjustment = {
    id: 91,
    schoolId: 1,
    invoiceId: 41,
    invoiceNumber: "INV-41",
    studentId: 31,
    studentName: "Linked Student",
    kind: "SCHOLARSHIP",
    amountMinor: 10000,
    percentage: null,
    originalBalanceMinor: 10000,
    requestedBy: 20,
    reason: "Approved scholarship requested",
    status: "PENDING",
    requestedAt: "2026-09-01T12:00:00.000Z",
  };
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

describe("school-scoped payment and adjustment queues", () => {
  it("lists and reads payment transfer proof only for authorized school finance roles", async () => {
    const list = await fetch(`${baseUrl}/school/finance/payments?schoolId=1&status=PENDING`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "1" },
    });
    expect(list.status).toBe(200);
    const rows = await list.json() as Array<Record<string, any>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 77,
      transferReference: "TRF-77",
      transferBank: "Test Bank",
      proofUrl: "https://proof.example.test/77",
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/providerMetadata|verificationMetadata|secret/i);

    const detail = await fetch(`${baseUrl}/school/finance/payments/77?schoolId=1`, {
      headers: { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "1" },
    });
    expect(detail.status).toBe(200);
    expect((await detail.json() as Record<string, any>).verificationEvidenceReference).toBe("bank-statement-77");
  });

  it("denies cross-school details and prevents parent/partner roles from using school queues", async () => {
    const before = state.calls.length;
    const crossSchool = await fetch(`${baseUrl}/school/finance/payments/77?schoolId=1`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "2" },
    });
    expect(crossSchool.status).toBe(404);
    expect(state.calls).toHaveLength(before);

    const parentList = await fetch(`${baseUrl}/school/finance/payments?schoolId=1`, {
      headers: { "x-test-role": "PARENT" },
    });
    expect(parentList.status).toBe(404);
    const partnerAdjustments = await fetch(`${baseUrl}/school/finance/adjustments/pending?schoolId=1`, {
      headers: { "x-test-role": "PARTNER" },
    });
    expect(partnerAdjustments.status).toBe(404);
  });

  it("limits parent/student payment histories to their own authorized relationships", async () => {
    const parent = await fetch(`${baseUrl}/parent/fees/payments`, { headers: { "x-test-role": "PARENT" } });
    expect(parent.status).toBe(200);
    const parentRows = await parent.json() as Array<Record<string, any>>;
    expect(parentRows).toHaveLength(1);
    expect(parentRows[0]).toMatchObject({ studentId: 31, studentName: "Linked Student", reviewerNotes: null });
    expect(parentRows[0].verificationEvidenceReference).toBeNull();
    expect(state.calls.at(-1)?.sql).toContain("rel.student_id=p.student_id");

    const student = await fetch(`${baseUrl}/student/fees/payments`, { headers: { "x-test-role": "STUDENT" } });
    expect(student.status).toBe(200);
    expect(await student.json()).toHaveLength(1);
    const anotherStudent = await fetch(`${baseUrl}/student/fees/payments`, {
      headers: { "x-test-role": "STUDENT", "x-test-user": "999" },
    });
    expect(anotherStudent.status).toBe(200);
    expect(await anotherStudent.json()).toHaveLength(0);

    const partner = await fetch(`${baseUrl}/parent/fees/payments`, { headers: { "x-test-role": "PARTNER" } });
    expect(partner.status).toBe(403);
  });

  it("allows a linked parent to retrieve the persisted receipt with invoice and school identity", async () => {
    state.payment.status = "VERIFIED";
    state.receipt = {
      receiptNumber: "RCP-1-00000077",
      paymentId: 77,
      schoolId: 1,
      invoiceId: 41,
      snapshot: {
        invoiceId: 41,
        schoolId: 1,
        invoiceNumber: "INV-41",
        paymentReference: "EDC-PAY-77",
      },
    };
    const response = await fetch(`${baseUrl}/finance/payments/77/receipt`, {
      headers: { "x-test-role": "PARENT" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      paymentId: 77,
      schoolId: 1,
      snapshot: { invoiceId: 41, schoolId: 1, invoiceNumber: "INV-41" },
    });
    expect(state.calls.at(-1)?.sql).toContain("p.invoice_id=r.invoice_id");

    const unlinkedParent = await fetch(`${baseUrl}/finance/payments/77/receipt`, {
      headers: { "x-test-role": "PARENT", "x-test-user": "999" },
    });
    expect(unlinkedParent.status).toBe(404);
  });

  it("returns enabled bank details only for payable invoices linked to the active parent", async () => {
    const path = `${baseUrl}/parent/fees/invoices/41/bank-details`;
    state.bankSettings = {
      bankTransferEnabled: true,
      bankName: "Example Nigerian Bank",
      accountName: "Example School",
      accountNumber: "0123456789",
    };
    const configured = await fetch(path, { headers: { "x-test-role": "PARENT" } });
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({
      invoiceId: 41,
      schoolId: 1,
      available: true,
      bankName: "Example Nigerian Bank",
      accountName: "Example School",
      accountNumber: "0123456789",
    });

    state.bankSettings = null;
    const unconfigured = await fetch(path, { headers: { "x-test-role": "PARENT" } });
    expect(unconfigured.status).toBe(200);
    expect(await unconfigured.json()).toMatchObject({
      invoiceId: 41, schoolId: 1, available: false, reason: "BANK_DETAILS_UNAVAILABLE",
    });

    const unlinkedChild = await fetch(path, {
      headers: { "x-test-role": "PARENT", "x-test-user": "999" },
    });
    expect(unlinkedChild.status).toBe(404);

    state.bankInvoiceId = 42;
    state.bankInvoiceSchoolId = 2;
    state.bankSettings = {
      bankTransferEnabled: true,
      bankName: "Other School Bank",
      accountName: "Other School",
      accountNumber: "9876543210",
    };
    const crossSchoolInvoice = await fetch(`${baseUrl}/parent/fees/invoices/42/bank-details`, {
      headers: { "x-test-role": "PARENT" },
    });
    expect(crossSchoolInvoice.status).toBe(404);
  });

  it("lists pending adjustments only within an authorized school", async () => {
    const queue = await fetch(`${baseUrl}/school/finance/adjustments/pending?schoolId=1`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "1" },
    });
    expect(queue.status).toBe(200);
    expect(await queue.json()).toMatchObject([{
      id: 91, schoolId: 1, invoiceId: 41, studentId: 31, status: "PENDING",
    }]);
    const query = state.calls.at(-1);
    expect(query?.sql).toContain("a.status='PENDING'");
    expect(query?.values).toEqual([1]);

    const otherSchool = await fetch(`${baseUrl}/school/finance/adjustments/pending?schoolId=1`, {
      headers: { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "2" },
    });
    expect(otherSchool.status).toBe(404);
  });
});