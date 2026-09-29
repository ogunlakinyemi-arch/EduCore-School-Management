import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
}));

const database = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("AS \"totalCollectedMinor\"") && sql.includes("FROM fee_invoices i")) {
      return { rows: [{
        invoiceCount: "4", billableInvoiceCount: "3", cancelledInvoiceCount: "1",
        cancelledInvoiceAmountMinor: "2000", totalBilledMinor: "12000", totalOutstandingMinor: "5000",
        totalDiscountMinor: "500", totalWaiverMinor: "0", totalCollectedMinor: "7000",
        totalRefundedMinor: "1000", totalReversedMinor: "0",
      }] };
    }
    if (sql.includes("COUNT(DISTINCT i.status)")) {
      return { rows: [{ total: values.some(value => ["CANCELLED", "WAIVED", "OVERDUE"].includes(String(value))) ? 1 : 3 }] };
    }
    if (sql.includes("GROUP BY i.status")) {
      const status = ["CANCELLED", "WAIVED", "OVERDUE"].find(value => values.includes(value));
      return { rows: status
        ? [{ status, invoiceCount: "1", invoiceTotalMinor: "2000", totalOutstandingMinor: "0" }]
        : [
          { status: "CANCELLED", invoiceCount: "1", invoiceTotalMinor: "2000", totalOutstandingMinor: "0" },
          { status: "OVERDUE", invoiceCount: "1", invoiceTotalMinor: "5000", totalOutstandingMinor: "1000" },
          { status: "WAIVED", invoiceCount: "1", invoiceTotalMinor: "1000", totalOutstandingMinor: "0" },
        ] };
    }
    if (sql.includes("SELECT i.invoice_number AS \"invoiceNumber\",p.currency")) {
      return { rows: [
        { invoiceNumber: "INV-1", currency: "NGN", method: "BANK_TRANSFER", status: "VERIFIED", submittedAmountMinor: 5000, netCollectedMinor: "4000", paymentDate: "2026-01-02T00:00:00.000Z" },
        { invoiceNumber: "INV-2", currency: "NGN", method: "PAYSTACK", status: "PENDING", submittedAmountMinor: 3000, netCollectedMinor: "0", paymentDate: "2026-01-03T00:00:00.000Z" },
        { invoiceNumber: "INV-3", currency: "NGN", method: "PAYSTACK", status: "REFUNDED", submittedAmountMinor: 2000, netCollectedMinor: "0", paymentDate: "2026-01-04T00:00:00.000Z" },
      ] };
    }
    if (sql.includes("SELECT COUNT(*)::int AS total FROM fee_invoices i")) return { rows: [{ total: 1 }] };
    if (sql.includes("SELECT i.invoice_number AS \"invoiceNumber\"")) {
      return { rows: [{
        invoiceNumber: "INV-1", currency: "NGN", totalMinor: 5000, paidMinor: 4000,
        outstandingMinor: 1000, status: "PARTIALLY_PAID", issueDate: "2026-01-02", dueDate: "2026-01-31",
      }] };
    }
    if (sql.includes("SELECT COUNT(*)::bigint AS total") && sql.includes("FROM fee_payments p")) return { rows: [{ total: "3" }] };
    if (sql.includes("SELECT COUNT(*)::int AS total FROM (") && sql.includes("FROM subscriptions sub")) return { rows: [{ total: 2 }] };
    if (sql.includes("AS \"subscriptionCount\"")) {
      return { rows: [{ subscriptionCount: "4", activeCount: "2", pendingCount: "1", expiredCount: "1", verifiedRevenue: "15000.00" }] };
    }
    if (sql.includes("FROM subscriptions sub JOIN schools s")) {
      return { rows: [{ schoolId: 8, schoolName: "North School", status: "active", verificationStatus: "verified", count: "2", verifiedRevenue: "15000.00" }] };
    }
    if (sql.includes("SELECT COUNT(*)::int AS total FROM (") && sql.includes("communication_deliveries")) return { rows: [{ total: 2 }] };
    if (sql.includes("GROUP BY n.category,d.channel,d.status")) {
      return { rows: [{ category: "ANNOUNCEMENT", channel: "EMAIL", status: "DELIVERED", deliveryRecords: "2" }] };
    }
    if (sql.includes("AS \"deliveryRecords\"") && sql.includes("FROM communication_deliveries d")) {
      return { rows: [{ deliveryRecords: "5", deliveredRecords: "2", sentRecords: "1", queuedRecords: "1", failedRecords: "1" }] };
    }
    throw new Error(`Unexpected business report query: ${sql}`);
  }),
}));

vi.mock("@workspace/db", () => ({ pool: database }));

import { businessReports } from "./business";
import type { ReportContext, ReportFilters } from "./core";

const filters: ReportFilters = { limit: 50, offset: 0 };
const context = (role: ReportContext["role"], schoolId: number | null, extra: Partial<ReportContext> = {}): ReportContext => ({
  req: {} as ReportContext["req"],
  userId: 71,
  role,
  schoolId,
  ...extra,
});

beforeEach(() => {
  state.calls.length = 0;
  database.query.mockClear();
});

describe("business reporting", () => {
  it("keeps finance and communication report roles limited to authorized audiences", () => {
    expect(businessReports.finance.roles).not.toContain("TEACHER");
    expect(businessReports.finance.roles).not.toContain("PARTNER");
    expect(businessReports["finance-payments"].roles).toContain("PARENT");
    expect(businessReports["finance-payments"].roles).toContain("STUDENT");
    expect(businessReports.subscriptions.roles).toEqual(["OWNER", "ADMIN", "ACCOUNTANT"]);
    expect(businessReports.communication.roles).not.toContain("PARENT");
    expect(businessReports.communication.roles).not.toContain("STUDENT");
    expect(businessReports.communication.roles).not.toContain("PARTNER");
  });

  it("uses only verified-like finance status conventions for net collections and subtracts approved refunds", async () => {
    const report = await businessReports.finance.run(context("ADMIN", 8), filters);
    expect(report.summary).toMatchObject({
      totalCollectedMinor: "7000", totalRefundedMinor: "1000", totalReversedMinor: "0",
    });
    const summaryQuery = state.calls.find(({ sql }) => sql.includes("AS \"totalCollectedMinor\""))!;
    expect(summaryQuery.sql).toContain("p.status IN ('VERIFIED','REFUNDED','REVERSED')");
    expect(summaryQuery.sql).toContain("fr.status='APPROVED'");
    expect(summaryQuery.sql).toContain("GREATEST(p.amount_minor");
    expect(summaryQuery.values[0]).toBe(8);
    expect(summaryQuery.sql).toContain("i.school_id");
    expect(report.total).toBe(3);
    expect(report.rows.map(row => row.status)).toEqual(["CANCELLED", "OVERDUE", "WAIVED"]);
    expect(report.summary).toMatchObject({ invoiceCount: "4", cancelledInvoiceCount: "1", cancelledInvoiceAmountMinor: "2000" });
  });

  it("includes cancelled, waived, and overdue invoices when each status is selected", async () => {
    for (const status of ["CANCELLED", "WAIVED", "OVERDUE"]) {
      state.calls.length = 0;
      const report = await businessReports.finance.run(context("ACCOUNTANT", 8), { ...filters, status });
      expect(report.rows).toEqual([
        expect.objectContaining({ status }),
      ]);
      const groupedQuery = state.calls.find(({ sql }) => sql.includes("GROUP BY i.status"))!;
      expect(groupedQuery.sql).toContain("i.status=$2");
      expect(groupedQuery.values).toEqual([8, status, 50, 0]);
      expect(groupedQuery.sql).not.toContain("AND i.status <> 'CANCELLED'");
    }
  });

  it("limits family invoice reporting to the authenticated parent's active linked children", async () => {
    const report = await businessReports.finance.run(context("PARENT", 8, { parentId: 22 }), filters);
    expect(report.title).toBe("My fee invoices");
    expect(report.rows).toHaveLength(1);
    const invoiceQuery = state.calls.find(({ sql }) => sql.includes("SELECT i.invoice_number AS \"invoiceNumber\""))!;
    expect(invoiceQuery.sql).toContain("parent_student_relationships");
    expect(invoiceQuery.sql).toContain("pa.id=$2");
    expect(invoiceQuery.sql).toContain("pa.user_id=$3");
    expect(invoiceQuery.sql).toContain("pa.school_id=i.school_id");
    expect(invoiceQuery.sql).toContain("rel.status='ACTIVE'");
    expect(invoiceQuery.values.slice(0, 3)).toEqual([8, 22, 71]);
    expect(JSON.stringify(report.rows)).not.toContain("studentName");
  });

  it("returns payment submission status separately from verified net collection", async () => {
    const report = await businessReports["finance-payments"].run(context("ACCOUNTANT", 8), filters);
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "PENDING", netCollectedMinor: "0" }),
      expect.objectContaining({ status: "REFUNDED", netCollectedMinor: "0" }),
      expect.objectContaining({ status: "VERIFIED", netCollectedMinor: "4000" }),
    ]));
    const paymentQuery = state.calls.find(({ sql }) => sql.includes("SELECT i.invoice_number AS \"invoiceNumber\",p.currency"))!;
    expect(paymentQuery.sql).toContain("p.status IN ('VERIFIED','REFUNDED','REVERSED')");
    expect(paymentQuery.sql).toContain("fr.status='APPROVED'");
    expect(paymentQuery.sql).toContain("ELSE 0 END");
    expect(paymentQuery.sql).toContain("i.school_id=$1");
    expect(paymentQuery.sql).toContain("i.school_id=p.school_id");
    expect(paymentQuery.sql).toContain("LIMIT $2 OFFSET $3");
    expect(report.total).toBe(3);
  });

  it("keeps parent payments within their linked children and school even when filtered", async () => {
    await businessReports["finance-payments"].run(
      context("PARENT", 8, { parentId: 22 }),
      { ...filters, studentId: 109 },
    );
    const query = state.calls.find(({ sql }) => sql.includes("SELECT i.invoice_number AS \"invoiceNumber\",p.currency"))!;
    expect(query.sql).toContain("parent_student_relationships");
    expect(query.sql).toContain("pa.school_id=p.school_id");
    expect(query.sql).toContain("rel.student_id=p.student_id");
    expect(query.sql).toContain("i.student_id=$2");
    expect(query.values.slice(0, 2)).toEqual([8, 109]);
    expect(query.values).toContain(22);
    expect(query.values).toContain(71);
  });

  it("reports subscription revenue only under existing verified subscription status", async () => {
    const report = await businessReports.subscriptions.run(context("OWNER", null), filters);
    expect(report.summary).toMatchObject({ verifiedRevenue: "15000.00", activeCount: "2", pendingCount: "1" });
    const summary = state.calls.find(({ sql }) => sql.includes("AS \"subscriptionCount\""))!;
    expect(summary.sql).toContain("SUM(sub.amount) FILTER (WHERE sub.verification_status='verified')");
    expect(summary.values).toEqual([null]);
    expect(report.rows[0]).toMatchObject({ schoolName: "North School", verificationStatus: "verified" });
  });

  it("uses recorded communication delivery states and enforces school scope", async () => {
    const report = await businessReports.communication.run(context("ADMIN", 8), filters);
    expect(report.summary).toMatchObject({ deliveryRecords: "5", deliveredRecords: "2", sentRecords: "1" });
    expect(report.rows[0]).toMatchObject({ status: "DELIVERED", deliveryRecords: "2" });
    const query = state.calls.find(({ sql }) => sql.includes("GROUP BY n.category,d.channel,d.status"))!;
    expect(query.sql).toContain("communication_deliveries");
    expect(query.sql).toContain("n.school_id=$1");
    expect(query.values[0]).toBe(8);
    expect(report.columns.find(({ key }) => key === "status")?.label).toContain("Recorded");
  });
});