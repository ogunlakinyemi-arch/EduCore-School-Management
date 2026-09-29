import express from "express";
import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

// Keep the real auth helpers and database pool; only authentication context is
// supplied so HTTP handlers can be exercised without Clerk credentials.
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: Request, _res: Response, next: NextFunction) => {
      const role = req.header("x-test-role") ?? "ACCOUNTANT";
      const defaultUserIds: Record<string, number> = {
        ACCOUNTANT: 1,
        PARENT: 2,
        TEACHER: 4,
        PARTNER: 5,
        STUDENT: 6,
        SCHOOL_ADMIN: 8,
        PLATFORM_OWNER: 9,
      };
      const userId = Number(req.header("x-test-user") ?? defaultUserIds[role] ?? 1);
      const schoolHeader = req.header("x-test-school");
      const schoolId = role === "PLATFORM_OWNER" || role === "PARTNER"
        ? null
        : schoolHeader === "null" ? null : Number(schoolHeader ?? 1);
      const testUsers: Record<number, { clerkUserId: string; email: string; firstName: string; lastName: string }> = {
        1: { clerkUserId: "ledger-admin", email: "finance-admin@example.invalid", firstName: "Ada", lastName: "Accountant" },
        2: { clerkUserId: "ledger-parent-one", email: "parent-one@example.invalid", firstName: "Sam", lastName: "Guardian" },
        3: { clerkUserId: "ledger-parent-two", email: "parent-two@example.invalid", firstName: "Lee", lastName: "Guardian" },
        4: { clerkUserId: "ledger-teacher", email: "teacher@example.invalid", firstName: "Taylor", lastName: "Teacher" },
        5: { clerkUserId: "ledger-partner", email: "partner@example.invalid", firstName: "Pat", lastName: "Partner" },
        6: { clerkUserId: "ledger-student-one", email: "student-one@example.invalid", firstName: "Tomi", lastName: "Student" },
        7: { clerkUserId: "ledger-student-two", email: "student-two@example.invalid", firstName: "Mina", lastName: "Student" },
        8: { clerkUserId: "ledger-school-admin", email: "school-admin@example.invalid", firstName: "Alex", lastName: "Admin" },
        9: { clerkUserId: "ledger-platform-owner", email: "platform-owner@example.invalid", firstName: "Morgan", lastName: "Owner" },
      };
      const user = testUsers[userId];
      if (!user) throw new Error(`No seeded integration user for id ${userId}`);
      (req as Request & { edupulseUser?: unknown }).edupulseUser = {
        user: {
          id: userId,
          ...user,
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
import financeNotificationsRouter from "./finance-notifications";

const app = express();
app.use(express.json());
app.use(financeRouter);
app.use(financeNotificationsRouter);

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let routePaymentIds: number[] = [];

async function jsonRequest(
  path: string,
  options: {
    method?: string;
    role?: string;
    userId?: number;
    schoolId?: number | null;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-role": options.role ?? "ACCOUNTANT",
    ...options.headers,
  };
  if (options.userId !== undefined) headers["x-test-user"] = String(options.userId);
  if (options.schoolId !== undefined) headers["x-test-school"] = String(options.schoolId);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body: any = await response.json();
  return { status: response.status, body };
}

describe("Finance HTTP lifecycle against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const serverCheck = await pool.query(
      `SELECT current_database() AS database_name, inet_server_addr() AS tcp_address,
        current_setting('data_directory') AS data_directory,
        current_setting('unix_socket_directories') AS socket_directories`,
    );
    const localCluster = "/tmp/finance-ledger.";
    if (serverCheck.rows[0]?.database_name !== "postgres"
        || serverCheck.rows[0]?.tcp_address !== null
        || !String(serverCheck.rows[0]?.data_directory).startsWith(localCluster)
        || !String(serverCheck.rows[0]?.socket_directories).startsWith(localCluster)) {
      throw new Error("Refusing Finance HTTP integration test unless connected to the local socket-only disposable database");
    }
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await pool.end();
  });

  it("submits and verifies parent transfers, serves receipt/report, then approves refund and reversal ledgers", async () => {
    const firstSubmission = await jsonRequest("/parent/fees/invoices/2/bank-transfer", {
      method: "POST",
      role: "PARENT",
      headers: { "Idempotency-Key": "http-lifecycle-payment-a" },
      body: {
        amountMinor: 4000,
        bank: "Example Bank",
        transferReference: "HTTP-TRANSFER-001",
        transferDate: "2025-09-12",
      },
    });
    expect(firstSubmission.status).toBe(201);
    expect(firstSubmission.body).toMatchObject({ invoiceId: 2, amountMinor: 4000, status: "PENDING" });
    const firstPaymentId = firstSubmission.body.id as number;
    routePaymentIds.push(firstPaymentId);

    const firstVerification = await jsonRequest(
      `/school/finance/payments/${firstPaymentId}/verify?schoolId=1`,
      {
        method: "POST",
        body: { evidenceReference: "HTTP-EVIDENCE-001", reviewerNotes: "Confirmed bank credit one" },
      },
    );
    expect(firstVerification.status).toBe(200);
    expect(firstVerification.body).toMatchObject({
      id: firstPaymentId,
      status: "VERIFIED",
      receiptNumber: `RCP-1-${String(firstPaymentId).padStart(8, "0")}`,
    });
    const partial = await pool.query(
      "SELECT paid_minor,outstanding_minor,status FROM fee_invoices WHERE id=2",
    );
    expect(partial.rows[0]).toMatchObject({
      paid_minor: 4000,
      outstanding_minor: 6000,
      status: "PARTIALLY_PAID",
    });

    const firstReceipt = await jsonRequest(`/finance/payments/${firstPaymentId}/receipt?schoolId=1`);
    expect(firstReceipt.status).toBe(200);
    expect(firstReceipt.body).toMatchObject({
      paymentId: firstPaymentId,
      receiptNumber: firstVerification.body.receiptNumber,
      snapshot: { amountMinor: 4000, remainingBalanceMinor: 6000, invoiceId: 2, schoolId: 1 },
    });

    const secondSubmission = await jsonRequest("/parent/fees/invoices/2/bank-transfer", {
      method: "POST",
      role: "PARENT",
      headers: { "Idempotency-Key": "http-lifecycle-payment-b" },
      body: {
        amountMinor: 6000,
        bank: "Example Bank",
        transferReference: "HTTP-TRANSFER-002",
        transferDate: "2025-09-13",
      },
    });
    expect(secondSubmission.status).toBe(201);
    expect(secondSubmission.body).toMatchObject({ invoiceId: 2, amountMinor: 6000, status: "PENDING" });
    const secondPaymentId = secondSubmission.body.id as number;
    routePaymentIds.push(secondPaymentId);

    const secondVerification = await jsonRequest(
      `/school/finance/payments/${secondPaymentId}/verify?schoolId=1`,
      {
        method: "POST",
        body: { evidenceReference: "HTTP-EVIDENCE-002", reviewerNotes: "Confirmed bank credit two" },
      },
    );
    expect(secondVerification.status).toBe(200);
    expect(secondVerification.body.status).toBe("VERIFIED");
    const full = await pool.query(
      "SELECT paid_minor,outstanding_minor,status FROM fee_invoices WHERE id=2",
    );
    expect(full.rows[0]).toMatchObject({ paid_minor: 10000, outstanding_minor: 0, status: "PAID" });

    const refundRequest = await jsonRequest(`/school/finance/payments/${firstPaymentId}/refunds?schoolId=1`, {
      method: "POST",
      headers: { "Idempotency-Key": "http-lifecycle-refund-a" },
      body: { amountMinor: 1000, transactionType: "REFUND", reason: "Overpayment adjustment" },
    });
    expect(refundRequest.status).toBe(201);
    expect(refundRequest.body).toMatchObject({
      paymentId: firstPaymentId,
      invoiceId: 2,
      transactionType: "REFUND",
      amountMinor: 1000,
      status: "PENDING",
    });
    for (const roleUser of [
      { role: "TEACHER", userId: 4 },
      { role: "PARTNER", userId: 5 },
      { role: "STUDENT", userId: 6 },
    ]) {
      const deniedVerify = await jsonRequest(
        `/school/finance/payments/${firstPaymentId}/verify?schoolId=1`,
        {
          method: "POST",
          ...roleUser,
          body: { evidenceReference: `DENIED-${roleUser.role}`, reviewerNotes: "Must not verify" },
        },
      );
      expect(deniedVerify.status).toBe(404);

      const deniedRefundRequest = await jsonRequest(
        `/school/finance/payments/${firstPaymentId}/refunds?schoolId=1`,
        {
          method: "POST",
          ...roleUser,
          headers: { "Idempotency-Key": `denied-refund-${roleUser.role}` },
          body: { amountMinor: 100, transactionType: "REFUND", reason: "Must not request" },
        },
      );
      expect(deniedRefundRequest.status).toBe(404);

      const deniedRefundApproval = await jsonRequest(
        `/school/finance/refunds/${refundRequest.body.id}/approve?schoolId=1`,
        {
          method: "POST",
          ...roleUser,
          body: { evidenceReference: `DENIED-${roleUser.role}`, reviewerNotes: "Must not approve" },
        },
      );
      expect(deniedRefundApproval.status).toBe(404);

      const deniedInvoiceAdjustment = await jsonRequest("/school/finance/invoices/2/adjustments?schoolId=1", {
        method: "POST",
        ...roleUser,
        body: { kind: "DISCOUNT", amountMinor: 100, reason: "Must not alter invoice" },
      });
      expect(deniedInvoiceAdjustment.status).toBe(404);
    }
    const deniedRoleMutationCheck = await pool.query(
      `SELECT i.paid_minor,i.outstanding_minor,i.status,p.status AS payment_status,
         fr.status AS refund_status,
         (SELECT COUNT(*)::int FROM fee_refunds WHERE payment_id=$1) AS refund_count,
         (SELECT COUNT(*)::int FROM fee_adjustments WHERE invoice_id=2) AS adjustment_count
       FROM fee_invoices i JOIN fee_payments p ON p.invoice_id=i.id
       JOIN fee_refunds fr ON fr.id=$2
       WHERE i.id=2 AND p.id=$1`,
      [firstPaymentId, refundRequest.body.id],
    );
    expect(deniedRoleMutationCheck.rows[0]).toMatchObject({
      paid_minor: 10000,
      outstanding_minor: 0,
      status: "PAID",
      payment_status: "VERIFIED",
      refund_status: "PENDING",
      refund_count: 1,
      adjustment_count: 0,
    });
    const refundApproval = await jsonRequest(
      `/school/finance/refunds/${refundRequest.body.id}/approve?schoolId=1`,
      {
        method: "POST",
        role: "SCHOOL_ADMIN",
        body: { evidenceReference: "HTTP-REFUND-EVIDENCE", reviewerNotes: "Refund evidence confirmed" },
      },
    );
    expect(refundApproval.status).toBe(200);
    expect(refundApproval.body.status).toBe("APPROVED");

    const reversalRequest = await jsonRequest(`/school/finance/payments/${secondPaymentId}/refunds?schoolId=1`, {
      method: "POST",
      headers: { "Idempotency-Key": "http-lifecycle-reversal-b" },
      body: { amountMinor: 6000, transactionType: "REVERSAL", reason: "Duplicate transfer reversal" },
    });
    expect(reversalRequest.status).toBe(201);
    expect(reversalRequest.body).toMatchObject({
      paymentId: secondPaymentId,
      transactionType: "REVERSAL",
      amountMinor: 6000,
      status: "PENDING",
    });
    const reversalApproval = await jsonRequest(
      `/school/finance/refunds/${reversalRequest.body.id}/approve?schoolId=1`,
      {
        method: "POST",
        role: "SCHOOL_ADMIN",
        body: { evidenceReference: "HTTP-REVERSAL-EVIDENCE", reviewerNotes: "Reversal evidence confirmed" },
      },
    );
    expect(reversalApproval.status).toBe(200);
    expect(reversalApproval.body.status).toBe("APPROVED");

    const finalInvoice = await pool.query(
      "SELECT paid_minor,outstanding_minor,status FROM fee_invoices WHERE id=2",
    );
    expect(finalInvoice.rows[0]).toMatchObject({
      paid_minor: 3000,
      outstanding_minor: 7000,
      status: "PARTIALLY_PAID",
    });
    const statuses = await pool.query(
      "SELECT id,status FROM fee_payments WHERE id=ANY($1::int[]) ORDER BY id",
      [[firstPaymentId, secondPaymentId]],
    );
    expect(statuses.rows).toEqual([
      { id: firstPaymentId, status: "VERIFIED" },
      { id: secondPaymentId, status: "REVERSED" },
    ]);

    const report = await jsonRequest("/school/finance/summary?schoolId=1");
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({
      totalBilledMinor: 22000,
      totalCollectedMinor: 5000,
      totalOutstandingMinor: 17000,
      totalRefundedMinor: 2000,
      totalReversedMinor: 13000,
    });
    const filteredReport = await jsonRequest(
      "/school/finance/reports?schoolId=1&reportType=summary&sessionId=1&termId=1&classId=1&section=Blue&from=2025-09-01&to=2025-09-30",
    );
    expect(filteredReport.status).toBe(200);
    expect(filteredReport.body).toMatchObject({
      totalBilledMinor: 20000,
      totalCollectedMinor: 5000,
      totalOutstandingMinor: 15000,
      totalRefundedMinor: 2000,
      totalReversedMinor: 13000,
    });
    const dateAndClassFilteredReport = await jsonRequest(
      "/school/finance/reports?schoolId=1&reportType=summary&sessionId=1&termId=1&classId=3&section=Green&from=2025-10-01&to=2025-10-31",
    );
    expect(dateAndClassFilteredReport.status).toBe(200);
    expect(dateAndClassFilteredReport.body).toMatchObject({
      totalBilledMinor: 2000,
      totalCollectedMinor: 0,
      totalOutstandingMinor: 2000,
    });
    const routeLedgers = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fee_receipts WHERE payment_id=ANY($1::int[])) AS receipts,
         (SELECT COUNT(*)::int FROM fee_refunds WHERE payment_id=ANY($1::int[]) AND status='APPROVED') AS approved_ledgers,
         (SELECT COUNT(*)::int FROM fee_payment_notification_outbox WHERE payment_id=ANY($1::int[])) AS outbox_rows,
         (SELECT COUNT(*)::int FROM fee_payment_notifications WHERE payment_id=ANY($1::int[])) AS notices,
         (SELECT COUNT(*)::int FROM audit_logs WHERE module='Finance' AND record_id=ANY($1::int[])) AS audit_rows`,
      [[firstPaymentId, secondPaymentId]],
    );
    expect(routeLedgers.rows[0]).toEqual({
      receipts: 2,
      approved_ledgers: 2,
      outbox_rows: 0,
      notices: 24,
      audit_rows: 16,
    });
  });

  it("enforces seeded tenant and role boundaries without cross-school mutation or reporting leakage", async () => {
    for (const roleUser of [
      { role: "ACCOUNTANT", userId: 1 },
      { role: "SCHOOL_ADMIN", userId: 8 },
      { role: "PLATFORM_OWNER", userId: 9 },
    ]) {
      const invoices = await jsonRequest("/school/finance/invoices?schoolId=1", roleUser);
      expect(invoices.status).toBe(200);
      expect(invoices.body.some((invoice: { schoolId: number }) => invoice.schoolId === 2)).toBe(false);

      const payments = await jsonRequest("/school/finance/payments?schoolId=1", roleUser);
      expect(payments.status).toBe(200);
      expect(payments.body.some((payment: { schoolId: number }) => payment.schoolId === 2)).toBe(false);

      const report = await jsonRequest("/school/finance/reports?schoolId=1&reportType=summary", roleUser);
      expect(report.status).toBe(200);
      expect(report.body).toMatchObject({
        totalBilledMinor: 22000,
        totalCollectedMinor: 5000,
        totalOutstandingMinor: 17000,
      });

      const receipt = await jsonRequest(
        `/finance/payments/${routePaymentIds[0]}/receipt?schoolId=1`,
        roleUser,
      );
      expect(receipt.status).toBe(200);
    }

    const accountantOtherSchoolRead = await jsonRequest(
      "/school/finance/invoices?schoolId=2",
      { role: "ACCOUNTANT", userId: 1 },
    );
    expect(accountantOtherSchoolRead.status).toBe(404);
    const adminOtherSchoolRead = await jsonRequest(
      "/school/finance/reports?schoolId=2&reportType=summary",
      { role: "SCHOOL_ADMIN", userId: 8 },
    );
    expect(adminOtherSchoolRead.status).toBe(404);

    const ownerOtherSchoolRead = await jsonRequest(
      "/school/finance/reports?schoolId=2&reportType=summary",
      { role: "PLATFORM_OWNER", userId: 9 },
    );
    expect(ownerOtherSchoolRead.status).toBe(200);
    expect(ownerOtherSchoolRead.body).toMatchObject({
      totalBilledMinor: 5000,
      totalCollectedMinor: 2500,
      totalOutstandingMinor: 2500,
    });

    const parentOneInvoices = await jsonRequest("/parent/fees/invoices", {
      role: "PARENT",
      userId: 2,
      schoolId: 1,
    });
    expect(parentOneInvoices.status).toBe(200);
    expect(parentOneInvoices.body.some((invoice: { id: number }) => invoice.id === 3)).toBe(false);

    const parentTwoInvoices = await jsonRequest("/parent/fees/invoices", {
      role: "PARENT",
      userId: 3,
      schoolId: 2,
    });
    expect(parentTwoInvoices.status).toBe(200);
    expect(parentTwoInvoices.body).toEqual([
      expect.objectContaining({ id: 3, schoolId: 2, studentId: 2 }),
    ]);

    const studentTwoInvoices = await jsonRequest("/student/fees/invoices", {
      role: "STUDENT",
      userId: 7,
      schoolId: 2,
    });
    expect(studentTwoInvoices.status).toBe(200);
    expect(studentTwoInvoices.body).toEqual([
      expect.objectContaining({ id: 3, schoolId: 2, studentId: 2 }),
    ]);

    const before = await pool.query(
      `SELECT i.paid_minor,i.outstanding_minor,i.status,p.status AS payment_status,
         r.receipt_number,fr.status AS refund_status,n.is_read,o.id AS outbox_id
       FROM fee_invoices i
       JOIN fee_payments p ON p.id=50 AND p.invoice_id=i.id AND p.school_id=i.school_id
       JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=i.id
       JOIN fee_refunds fr ON fr.id=50 AND fr.payment_id=p.id AND fr.school_id=p.school_id
       JOIN fee_payment_notifications n ON n.id=50 AND n.payment_id=p.id AND n.school_id=p.school_id
       JOIN fee_payment_notification_outbox o ON o.id=50 AND o.payment_id=p.id AND o.school_id=p.school_id
       WHERE i.id=3 AND i.school_id=2`,
    );
    expect(before.rows).toHaveLength(1);

    const foreignInvoiceSubmission = await jsonRequest("/parent/fees/invoices/3/bank-transfer", {
      method: "POST",
      role: "PARENT",
      userId: 2,
      schoolId: 1,
      headers: { "Idempotency-Key": "denied-foreign-invoice-payment" },
      body: {
        amountMinor: 100,
        bank: "Example Bank",
        transferReference: "DENIED-FOREIGN-INVOICE",
        transferDate: "2025-09-15",
      },
    });
    expect(foreignInvoiceSubmission.status).toBe(404);

    const foreignPaymentDetail = await jsonRequest("/school/finance/payments/50?schoolId=1", {
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
    });
    expect(foreignPaymentDetail.status).toBe(404);
    const foreignPaymentVerification = await jsonRequest("/school/finance/payments/50/verify?schoolId=1", {
      method: "POST",
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
      body: { evidenceReference: "CROSS-SCHOOL-EVIDENCE", reviewerNotes: "Should not verify" },
    });
    expect(foreignPaymentVerification.status).toBe(404);
    const foreignPaymentRefund = await jsonRequest("/school/finance/payments/50/refunds?schoolId=1", {
      method: "POST",
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
      headers: { "Idempotency-Key": "denied-foreign-refund-request" },
      body: { amountMinor: 100, transactionType: "REFUND", reason: "Should not refund" },
    });
    expect(foreignPaymentRefund.status).toBe(404);

    const foreignReceipt = await jsonRequest("/finance/payments/50/receipt?schoolId=1", {
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
    });
    expect(foreignReceipt.status).toBe(404);
    const foreignRefundDetail = await jsonRequest("/school/finance/refunds/50?schoolId=1", {
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
    });
    expect(foreignRefundDetail.status).toBe(404);
    const foreignRefundApproval = await jsonRequest("/school/finance/refunds/50/approve?schoolId=1", {
      method: "POST",
      role: "SCHOOL_ADMIN",
      userId: 8,
      schoolId: 1,
      body: { evidenceReference: "CROSS-SCHOOL-REFUND", reviewerNotes: "Should not approve" },
    });
    expect(foreignRefundApproval.status).toBe(404);

    const foreignNotificationList = await jsonRequest("/me/finance/payment-notifications?schoolId=2", {
      role: "PARENT",
      userId: 2,
      schoolId: 1,
    });
    expect(foreignNotificationList.status).toBe(404);
    const foreignNotificationRead = await jsonRequest("/me/finance/payment-notifications/50/read", {
      method: "PATCH",
      role: "PARENT",
      userId: 2,
      schoolId: 1,
    });
    expect(foreignNotificationRead.status).toBe(404);

    const foreignReport = await jsonRequest("/school/finance/reports?schoolId=2&reportType=summary", {
      role: "ACCOUNTANT",
      userId: 1,
      schoolId: 1,
    });
    expect(foreignReport.status).toBe(404);
    const foreignStudentFilter = await jsonRequest(
      "/school/finance/reports?schoolId=1&reportType=summary&studentId=2",
      { role: "ACCOUNTANT", userId: 1, schoolId: 1 },
    );
    expect(foreignStudentFilter.status).toBe(200);
    expect(foreignStudentFilter.body).toMatchObject({
      totalBilledMinor: 0,
      totalCollectedMinor: 0,
      totalOutstandingMinor: 0,
    });

    const after = await pool.query(
      `SELECT i.paid_minor,i.outstanding_minor,i.status,p.status AS payment_status,
         r.receipt_number,fr.status AS refund_status,n.is_read,o.id AS outbox_id
       FROM fee_invoices i
       JOIN fee_payments p ON p.id=50 AND p.invoice_id=i.id AND p.school_id=i.school_id
       JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=i.id
       JOIN fee_refunds fr ON fr.id=50 AND fr.payment_id=p.id AND fr.school_id=p.school_id
       JOIN fee_payment_notifications n ON n.id=50 AND n.payment_id=p.id AND n.school_id=p.school_id
       JOIN fee_payment_notification_outbox o ON o.id=50 AND o.payment_id=p.id AND o.school_id=p.school_id
       WHERE i.id=3 AND i.school_id=2`,
    );
    expect(after.rows).toEqual(before.rows);
    const deniedCrossTenantMutations = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM fee_payments WHERE idempotency_key='BANK_TRANSFER:2:denied-foreign-invoice-payment') AS leaked_payment,
        (SELECT COUNT(*)::int FROM fee_refunds WHERE idempotency_key='denied-foreign-refund-request') AS leaked_refund,
        (SELECT COUNT(*)::int FROM fee_adjustments WHERE invoice_id=2) AS route_invoice_adjustments`,
    );
    expect(deniedCrossTenantMutations.rows[0]).toEqual({
      leaked_payment: 0,
      leaked_refund: 0,
      route_invoice_adjustments: 0,
    });
  });
});