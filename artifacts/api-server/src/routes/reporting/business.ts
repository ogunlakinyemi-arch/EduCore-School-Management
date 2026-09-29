import { pool } from "@workspace/db";
import type {
  ReportContext,
  ReportDefinition,
  ReportFilters,
  ReportResult,
} from "./core";

type QueryResultRow = Record<string, unknown>;

function bind(values: unknown[], value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function invoicePredicates(
  context: ReportContext,
  filters: ReportFilters,
  values: unknown[],
  alias = "i",
  includeMethod = true,
  includeDatesAndStatus = true,
) {
  bind(values, context.schoolId);
  const predicates = [`($${values.length}::integer IS NULL OR ${alias}.school_id=$${values.length})`];
  if (filters.sessionId !== undefined) predicates.push(`${alias}.academic_session_id=${bind(values, filters.sessionId)}`);
  if (filters.termId !== undefined) predicates.push(`${alias}.academic_term_id=${bind(values, filters.termId)}`);
  if (filters.classId !== undefined) {
    const classId = bind(values, filters.classId);
    predicates.push(`EXISTS (
      SELECT 1 FROM fee_structures fs
       WHERE fs.id=${alias}.structure_id AND fs.school_id=${alias}.school_id
         AND fs.school_class_id=${classId}
    )`);
  }
  if (filters.section !== undefined) predicates.push(`${alias}.section_snapshot=${bind(values, filters.section)}`);
  if (filters.studentId !== undefined) predicates.push(`${alias}.student_id=${bind(values, filters.studentId)}`);
  if (includeDatesAndStatus && filters.from !== undefined) predicates.push(`${alias}.issue_date >= ${bind(values, filters.from)}::date`);
  if (includeDatesAndStatus && filters.to !== undefined) predicates.push(`${alias}.issue_date <= ${bind(values, filters.to)}::date`);
  if (includeDatesAndStatus && filters.status !== undefined) predicates.push(`${alias}.status=${bind(values, filters.status)}`);
  if (includeMethod && filters.method !== undefined) {
    const method = bind(values, filters.method);
    predicates.push(`EXISTS (
      SELECT 1 FROM fee_payments method_payment
       WHERE method_payment.invoice_id=${alias}.id
         AND method_payment.school_id=${alias}.school_id
         AND method_payment.method=${method}
    )`);
  }
  return { predicates };
}

function paymentPredicates(
  context: ReportContext,
  filters: ReportFilters,
  values: unknown[],
  familyScope: boolean,
) {
  const { predicates } = invoicePredicates(context, filters, values, "i", false, false);
  predicates.push("i.id=p.invoice_id", "i.school_id=p.school_id");
  if (filters.from !== undefined) {
    predicates.push(`COALESCE(p.verified_at,p.created_at) >= ${bind(values, filters.from)}::date`);
  }
  if (filters.to !== undefined) {
    predicates.push(`COALESCE(p.verified_at,p.created_at) < ${bind(values, filters.to)}::date + INTERVAL '1 day'`);
  }
  if (filters.status !== undefined) predicates.push(`p.status=${bind(values, filters.status)}`);
  if (filters.method !== undefined) predicates.push(`p.method=${bind(values, filters.method)}`);

  if (familyScope && context.role === "PARENT") {
    predicates.push(`EXISTS (
      SELECT 1 FROM parents pa
      JOIN parent_student_relationships rel ON rel.parent_id=pa.id
       WHERE pa.id=${bind(values, context.parentId)}
         AND pa.user_id=${bind(values, context.userId)}
         AND pa.school_id=p.school_id AND pa.status='ACTIVE'
         AND rel.student_id=p.student_id AND rel.status='ACTIVE'
    )`);
  } else if (familyScope && context.role === "STUDENT") {
    predicates.push(`p.student_id=${bind(values, context.studentId)}`);
  }
  return predicates;
}

function pagination(values: unknown[], filters: ReportFilters) {
  const limit = bind(values, Math.min(Math.max(Math.trunc(filters.limit), 1), 200));
  const offset = bind(values, Math.min(Math.max(Math.trunc(filters.offset), 0), 1_000_000));
  return { limit, offset };
}

const finance: ReportDefinition = {
  roles: ["OWNER", "ADMIN", "ACCOUNTANT", "PARENT", "STUDENT"],
  filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
  async run(context, filters): Promise<ReportResult> {
    const familyScope = context.role === "PARENT" || context.role === "STUDENT";
    const values: unknown[] = [];
    const { predicates } = invoicePredicates(context, filters, values);
    if (familyScope && context.role === "PARENT") {
      predicates.push(`EXISTS (
        SELECT 1 FROM parents pa
        JOIN parent_student_relationships rel ON rel.parent_id=pa.id
         WHERE pa.id=${bind(values, context.parentId)}
           AND pa.user_id=${bind(values, context.userId)}
           AND pa.school_id=i.school_id AND pa.status='ACTIVE'
           AND rel.student_id=i.student_id AND rel.status='ACTIVE'
      )`);
    } else if (familyScope && context.role === "STUDENT") {
      predicates.push(`i.student_id=${bind(values, context.studentId)}`);
    }
    const where = predicates.join(" AND ");

    if (familyScope) {
      const countValues = [...values];
      const totalResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM fee_invoices i WHERE ${where}`,
        countValues,
      );
      const pageValues = [...values];
      const { limit, offset } = pagination(pageValues, filters);
      const rows = await pool.query(
        `SELECT i.invoice_number AS "invoiceNumber",i.currency,i.total_minor AS "totalMinor",
           i.paid_minor AS "paidMinor",i.outstanding_minor AS "outstandingMinor",i.status,
           i.issue_date::text AS "issueDate",i.due_date::text AS "dueDate"
         FROM fee_invoices i WHERE ${where}
         ORDER BY i.issue_date DESC,i.id DESC LIMIT ${limit} OFFSET ${offset}`,
        pageValues,
      );
      return {
        title: "My fee invoices",
        columns: [
          { key: "invoiceNumber", label: "Invoice" },
          { key: "currency", label: "Currency" },
          { key: "totalMinor", label: "Total (minor units)" },
          { key: "paidMinor", label: "Paid (minor units)" },
          { key: "outstandingMinor", label: "Outstanding (minor units)" },
          { key: "status", label: "Status" },
          { key: "issueDate", label: "Issue date" },
          { key: "dueDate", label: "Due date" },
        ],
        rows: rows.rows as QueryResultRow[],
        total: Number(totalResult.rows[0]?.total ?? 0),
      };
    }

    const summaryValues = [...values];
    const scopedWhere = where.replaceAll(/\bi\./g, "scoped_i.");
    const summaryResult = await pool.query(
      `SELECT COUNT(*)::bigint AS "invoiceCount",
          COUNT(*) FILTER (WHERE i.status <> 'CANCELLED')::bigint AS "billableInvoiceCount",
          COUNT(*) FILTER (WHERE i.status='CANCELLED')::bigint AS "cancelledInvoiceCount",
          COALESCE(SUM(i.total_minor) FILTER (WHERE i.status <> 'CANCELLED'),0)::bigint AS "totalBilledMinor",
          COALESCE(SUM(i.total_minor) FILTER (WHERE i.status='CANCELLED'),0)::bigint AS "cancelledInvoiceAmountMinor",
          COALESCE(SUM(i.outstanding_minor) FILTER (WHERE i.status <> 'CANCELLED'),0)::bigint AS "totalOutstandingMinor",
          COALESCE(SUM(i.discount_minor) FILTER (WHERE i.status <> 'CANCELLED'),0)::bigint AS "totalDiscountMinor",
          COALESCE(SUM(i.waiver_minor) FILTER (WHERE i.status <> 'CANCELLED'),0)::bigint AS "totalWaiverMinor",
          COALESCE((
            SELECT SUM(GREATEST(p.amount_minor-COALESCE((
              SELECT SUM(fr.amount_minor) FROM fee_refunds fr
               WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
            ),0),0))
              FROM fee_payments p JOIN fee_invoices paid_i
                ON paid_i.id=p.invoice_id AND paid_i.school_id=p.school_id
             WHERE paid_i.status <> 'CANCELLED'
               AND ($1::integer IS NULL OR p.school_id=$1)
               AND p.status IN ('VERIFIED','REFUNDED','REVERSED')
               AND EXISTS (SELECT 1 FROM fee_invoices scoped_i
                WHERE ${scopedWhere}
                  AND scoped_i.id=p.invoice_id AND scoped_i.school_id=p.school_id)
          ),0)::bigint AS "totalCollectedMinor",
          (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint FROM fee_refunds fr
            WHERE fr.status='APPROVED' AND fr.transaction_type='REFUND'
              AND ($1::integer IS NULL OR fr.school_id=$1)
               AND EXISTS (SELECT 1 FROM fee_invoices scoped_i WHERE ${scopedWhere}
                 AND scoped_i.status <> 'CANCELLED' AND scoped_i.id=fr.invoice_id AND scoped_i.school_id=fr.school_id)
          ) AS "totalRefundedMinor",
          (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint FROM fee_refunds fr
            WHERE fr.status='APPROVED' AND fr.transaction_type='REVERSAL'
              AND ($1::integer IS NULL OR fr.school_id=$1)
               AND EXISTS (SELECT 1 FROM fee_invoices scoped_i WHERE ${scopedWhere}
                 AND scoped_i.status <> 'CANCELLED' AND scoped_i.id=fr.invoice_id AND scoped_i.school_id=fr.school_id)
          ) AS "totalReversedMinor"
         FROM fee_invoices i WHERE ${where}`,
      summaryValues,
    );
    const groupValues = [...values];
    const groupsCount = await pool.query(
      `SELECT COUNT(DISTINCT i.status)::int AS total FROM fee_invoices i WHERE ${where}`,
      groupValues,
    );
    const pageValues = [...values];
    const { limit, offset } = pagination(pageValues, filters);
    const groups = await pool.query(
      `SELECT i.status,COUNT(*)::bigint AS "invoiceCount",
          COALESCE(SUM(i.total_minor),0)::bigint AS "invoiceTotalMinor",
          COALESCE(SUM(i.outstanding_minor),0)::bigint AS "totalOutstandingMinor"
         FROM fee_invoices i WHERE ${where}
         GROUP BY i.status ORDER BY i.status LIMIT ${limit} OFFSET ${offset}`,
      pageValues,
    );
    return {
      title: "Fee invoice summary",
      columns: [
        { key: "status", label: "Invoice status" },
        { key: "invoiceCount", label: "Invoices" },
        { key: "invoiceTotalMinor", label: "Invoice total (minor units)" },
        { key: "totalOutstandingMinor", label: "Outstanding (minor units)" },
      ],
      rows: groups.rows as QueryResultRow[],
      total: Number(groupsCount.rows[0]?.total ?? 0),
      summary: summaryResult.rows[0] as QueryResultRow | undefined,
    };
  },
};

const financePayments: ReportDefinition = {
  roles: ["OWNER", "ADMIN", "ACCOUNTANT", "PARENT", "STUDENT"],
  filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
  async run(context, filters): Promise<ReportResult> {
    const familyScope = context.role === "PARENT" || context.role === "STUDENT";
    const countValues: unknown[] = [];
    const countWhere = paymentPredicates(context, filters, countValues, familyScope).join(" AND ");
    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint AS total
         FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
        WHERE ${countWhere}`,
      countValues,
    );
    const pageValues: unknown[] = [];
    const pageWhere = paymentPredicates(context, filters, pageValues, familyScope).join(" AND ");
    const { limit, offset } = pagination(pageValues, filters);
    const result = await pool.query(
      `SELECT i.invoice_number AS "invoiceNumber",p.currency,p.method,p.status,
          p.amount_minor AS "submittedAmountMinor",
          CASE WHEN p.status IN ('VERIFIED','REFUNDED','REVERSED')
            THEN GREATEST(p.amount_minor-COALESCE((
              SELECT SUM(fr.amount_minor) FROM fee_refunds fr
               WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
            ),0),0) ELSE 0 END::bigint AS "netCollectedMinor",
          COALESCE(p.verified_at,p.created_at) AS "paymentDate"
         FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
        WHERE ${pageWhere}
        ORDER BY COALESCE(p.verified_at,p.created_at) DESC,p.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      pageValues,
    );
    return {
      title: familyScope ? "My fee payments" : "Fee payments",
      columns: [
        { key: "invoiceNumber", label: "Invoice" },
        { key: "currency", label: "Currency" },
        { key: "method", label: "Method" },
        { key: "status", label: "Payment status" },
        { key: "submittedAmountMinor", label: "Submitted amount (minor units)" },
        { key: "netCollectedMinor", label: "Net collected (minor units)" },
        { key: "paymentDate", label: "Payment date" },
      ],
      rows: result.rows as QueryResultRow[],
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  },
};

const subscriptions: ReportDefinition = {
  roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
  filters: ["schoolId", "from", "to", "status", "limit", "offset"],
  async run(context, filters): Promise<ReportResult> {
    const values: unknown[] = [];
    const predicates = [
      `($1::integer IS NULL OR sub.school_id=$1)`,
    ];
    values.push(context.schoolId);
    if (filters.from !== undefined) predicates.push(`sub.created_at >= ${bind(values, filters.from)}::date`);
    if (filters.to !== undefined) predicates.push(`sub.created_at < ${bind(values, filters.to)}::date + INTERVAL '1 day'`);
    if (filters.status !== undefined) predicates.push(`sub.status=${bind(values, filters.status)}`);
    const where = predicates.join(" AND ");

    const countValues = [...values];
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT sub.school_id,sub.status,sub.verification_status
           FROM subscriptions sub WHERE ${where}
          GROUP BY sub.school_id,sub.status,sub.verification_status
       ) grouped`,
      countValues,
    );
    const summary = await pool.query(
      `SELECT COUNT(*)::bigint AS "subscriptionCount",
          COUNT(*) FILTER (WHERE sub.status='active')::bigint AS "activeCount",
          COUNT(*) FILTER (WHERE sub.status='pending')::bigint AS "pendingCount",
          COUNT(*) FILTER (WHERE sub.status='expired')::bigint AS "expiredCount",
          COALESCE(SUM(sub.amount) FILTER (WHERE sub.verification_status='verified'),0)::numeric AS "verifiedRevenue"
         FROM subscriptions sub WHERE ${where}`,
      [...values],
    );
    const pageValues = [...values];
    const { limit, offset } = pagination(pageValues, filters);
    const groups = await pool.query(
      `SELECT sub.school_id AS "schoolId",s.name AS "schoolName",sub.status,
          sub.verification_status AS "verificationStatus",COUNT(*)::bigint AS count,
          COALESCE(SUM(sub.amount) FILTER (WHERE sub.verification_status='verified'),0)::numeric AS "verifiedRevenue"
         FROM subscriptions sub JOIN schools s ON s.id=sub.school_id
        WHERE ${where}
        GROUP BY sub.school_id,s.name,sub.status,sub.verification_status
        ORDER BY s.name,sub.status,sub.verification_status
        LIMIT ${limit} OFFSET ${offset}`,
      pageValues,
    );
    return {
      title: "Subscription status and revenue",
      columns: [
        { key: "schoolName", label: "School" },
        { key: "status", label: "Subscription status" },
        { key: "verificationStatus", label: "Verification status" },
        { key: "count", label: "Subscriptions" },
        { key: "verifiedRevenue", label: "Verified revenue" },
      ],
      rows: groups.rows as QueryResultRow[],
      total: Number(countResult.rows[0]?.total ?? 0),
      summary: summary.rows[0] as QueryResultRow | undefined,
    };
  },
};

const communication: ReportDefinition = {
  roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
  filters: ["schoolId", "from", "to", "status", "limit", "offset"],
  async run(context, filters): Promise<ReportResult> {
    const values: unknown[] = [context.schoolId];
    const predicates = ["($1::integer IS NULL OR n.school_id=$1)"];
    if (context.role === "ACCOUNTANT") predicates.push("n.category='FINANCE'");
    if (filters.from !== undefined) predicates.push(`d.created_at >= ${bind(values, filters.from)}::date`);
    if (filters.to !== undefined) predicates.push(`d.created_at < ${bind(values, filters.to)}::date + INTERVAL '1 day'`);
    if (filters.status !== undefined) predicates.push(`d.status=${bind(values, filters.status)}`);
    const where = predicates.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT d.channel,d.status,n.category FROM communication_deliveries d
         JOIN communication_notifications n ON n.id=d.notification_id
         WHERE ${where} GROUP BY d.channel,d.status,n.category
       ) grouped`,
      [...values],
    );
    const summary = await pool.query(
      `SELECT COUNT(*)::bigint AS "deliveryRecords",
          COUNT(*) FILTER (WHERE d.status IN ('DELIVERED','READ'))::bigint AS "deliveredRecords",
          COUNT(*) FILTER (WHERE d.status='SENT')::bigint AS "sentRecords",
          COUNT(*) FILTER (WHERE d.status='QUEUED')::bigint AS "queuedRecords",
          COUNT(*) FILTER (WHERE d.status='FAILED')::bigint AS "failedRecords"
         FROM communication_deliveries d
         JOIN communication_notifications n ON n.id=d.notification_id
        WHERE ${where}`,
      [...values],
    );
    const pageValues = [...values];
    const { limit, offset } = pagination(pageValues, filters);
    const groups = await pool.query(
      `SELECT n.category,d.channel,d.status,COUNT(*)::bigint AS "deliveryRecords"
         FROM communication_deliveries d
         JOIN communication_notifications n ON n.id=d.notification_id
        WHERE ${where}
        GROUP BY n.category,d.channel,d.status
        ORDER BY n.category,d.channel,d.status
        LIMIT ${limit} OFFSET ${offset}`,
      pageValues,
    );
    return {
      title: "Communication delivery records",
      columns: [
        { key: "category", label: "Category" },
        { key: "channel", label: "Channel" },
        { key: "status", label: "Recorded delivery status" },
        { key: "deliveryRecords", label: "Delivery records" },
      ],
      rows: groups.rows as QueryResultRow[],
      total: Number(countResult.rows[0]?.total ?? 0),
      summary: summary.rows[0] as QueryResultRow | undefined,
    };
  },
};

export const businessReports: Record<string, ReportDefinition> = {
  finance,
  "finance-payments": financePayments,
  subscriptions,
  communication,
};