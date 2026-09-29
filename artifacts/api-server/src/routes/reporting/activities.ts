import { pool } from "@workspace/db";
import { AuthError } from "../../middlewares/auth";
import type {
  ReportContext,
  ReportDefinition,
  ReportFilters,
  ReportResult,
} from "./core";

type QueryRow = Record<string, unknown>;

function totalFrom(rows: QueryRow[]) {
  return Number(rows[0]?.total ?? 0);
}

function scopedSchool(context: ReportContext) {
  if (context.schoolId === null && context.role !== "OWNER") {
    throw new AuthError(403, "A school scope is required for this report");
  }
  return context.schoolId;
}

function datePredicates(
  column: string,
  filters: ReportFilters,
  values: unknown[],
) {
  const clauses: string[] = [];
  if (filters.from) {
    values.push(filters.from);
    clauses.push(`${column} >= $${values.length}::date`);
  }
  if (filters.to) {
    values.push(filters.to);
    clauses.push(`${column} < $${values.length}::date + INTERVAL '1 day'`);
  }
  return clauses;
}

function assertLoanStatus(status: string | undefined) {
  if (
    status !== undefined &&
    !["OPEN", "RETURNED", "LOST", "OVERDUE"].includes(status.toUpperCase())
  ) {
    throw new AuthError(400, "status is not a supported library loan status");
  }
  return status?.toUpperCase();
}

function loanWhere(
  context: ReportContext,
  filters: ReportFilters,
  values: unknown[],
) {
  const schoolId = scopedSchool(context);
  values.push(schoolId);
  const clauses = ["($1::integer IS NULL OR l.school_id=$1)"];
  if (context.role === "PARENT") {
    if (!context.parentId) throw new AuthError(403, "Parent profile is not available");
    values.push(context.parentId);
    clauses.push(`l.borrower_type='STUDENT' AND l.borrower_student_id IN (
      SELECT psr.student_id
        FROM parent_student_relationships psr
        JOIN students s ON s.id=psr.student_id AND s.school_id=$1
        JOIN parents p ON p.id=psr.parent_id AND p.school_id=$1
       WHERE psr.parent_id=$${values.length} AND psr.status='ACTIVE'
         AND UPPER(s.status)='ACTIVE' AND UPPER(p.status)='ACTIVE'
    )`);
  } else if (context.role === "STUDENT") {
    if (!context.studentId) throw new AuthError(403, "Student profile is not available");
    values.push(context.studentId);
    clauses.push(`l.borrower_type='STUDENT' AND l.borrower_student_id=$${values.length}
      AND l.borrower_user_id=$${values.length + 1} AND EXISTS (
        SELECT 1 FROM students s
         WHERE s.id=$${values.length} AND s.school_id=$1
           AND s.user_id=$${values.length + 1} AND UPPER(s.status)='ACTIVE'
      )`);
    values.push(context.userId);
  }
  if (filters.studentId !== undefined) {
    values.push(filters.studentId);
    clauses.push(`l.borrower_student_id=$${values.length}`);
  }
  const status = assertLoanStatus(filters.status);
  if (status === "OVERDUE") {
    clauses.push("l.status='OPEN' AND l.due_on<CURRENT_DATE");
  } else if (status) {
    values.push(status);
    clauses.push(`l.status=$${values.length}`);
  }
  clauses.push(...datePredicates("l.issued_at", filters, values));
  return clauses.join(" AND ");
}

async function runLibrary(context: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const schoolId = scopedSchool(context);
  const params: unknown[] = [schoolId];
  const rowsResult = await pool.query(
    `SELECT b.id AS "bookId", b.title, COALESCE(c.name, '') AS category,
            COUNT(DISTINCT cp.id)::int AS copies,
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.status='AVAILABLE')::int AS available,
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.status='BORROWED')::int AS borrowed,
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.status='LOST')::int AS lost,
            COUNT(DISTINCT cp.id) FILTER (WHERE cp.status='DAMAGED')::int AS damaged
       FROM library_books b
       LEFT JOIN library_categories c ON c.id=b.category_id AND c.school_id=b.school_id
       LEFT JOIN library_book_copies cp ON cp.book_id=b.id AND cp.school_id=b.school_id
      WHERE ($1::integer IS NULL OR b.school_id=$1) AND b.status='ACTIVE'
      GROUP BY b.id, b.title, c.name
      ORDER BY b.title, b.id
      LIMIT $2 OFFSET $3`,
    [...params, filters.limit, filters.offset],
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM library_books b
      WHERE ($1::integer IS NULL OR b.school_id=$1) AND b.status='ACTIVE'`,
    params,
  );
  const summaryResult = await pool.query(
    `SELECT COUNT(DISTINCT b.id)::int AS books,
            COUNT(cp.id)::int AS copies,
            COUNT(cp.id) FILTER (WHERE cp.status='AVAILABLE')::int AS available,
            COUNT(cp.id) FILTER (WHERE cp.status='BORROWED')::int AS borrowed,
            COUNT(cp.id) FILTER (WHERE cp.status='LOST')::int AS lost,
            COUNT(cp.id) FILTER (WHERE cp.status='DAMAGED')::int AS damaged
       FROM library_books b
       LEFT JOIN library_book_copies cp ON cp.book_id=b.id AND cp.school_id=b.school_id
      WHERE ($1::integer IS NULL OR b.school_id=$1) AND b.status='ACTIVE'`,
    params,
  );
  return {
    title: "Library catalogue and copies",
    columns: [
      { key: "bookId", label: "Book ID" },
      { key: "title", label: "Title" },
      { key: "category", label: "Category" },
      { key: "copies", label: "Copies" },
      { key: "available", label: "Available" },
      { key: "borrowed", label: "Borrowed" },
      { key: "lost", label: "Lost" },
      { key: "damaged", label: "Damaged" },
    ],
    rows: rowsResult.rows,
    total: totalFrom(countResult.rows),
    summary: summaryResult.rows[0] ?? {},
  };
}

async function runLibraryLoans(
  context: ReportContext,
  filters: ReportFilters,
): Promise<ReportResult> {
  const values: unknown[] = [];
  const where = loanWhere(context, filters, values);
  const pageValues = [...values, filters.limit, filters.offset];
  const rowsResult = await pool.query(
    `SELECT l.id AS "loanId", b.title AS "bookTitle", l.borrower_type AS "borrowerType",
            l.issued_at AS "issuedAt", l.due_on AS "dueOn", l.returned_at AS "returnedAt",
            l.status, l.returned_overdue AS "returnedOverdue",
            l.days_overdue_at_return AS "daysOverdueAtReturn",
            l.renewal_count AS "renewalCount",
            (l.status='OPEN' AND l.due_on<CURRENT_DATE) AS overdue,
            CASE WHEN l.status='OPEN' AND l.due_on<CURRENT_DATE
                 THEN CURRENT_DATE-l.due_on ELSE 0 END::int AS "daysOverdue"
       FROM library_loans l
       JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
      WHERE ${where}
      ORDER BY l.issued_at DESC, l.id DESC
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM library_loans l
      WHERE ${where}`,
    values,
  );
  const summaryResult = await pool.query(
    `SELECT COUNT(*)::int AS loans,
            COUNT(*) FILTER (WHERE l.status='OPEN')::int AS open,
            COUNT(*) FILTER (WHERE l.status='OPEN' AND l.due_on<CURRENT_DATE)::int AS overdue,
            COUNT(*) FILTER (WHERE l.status='RETURNED')::int AS returned,
            COUNT(*) FILTER (WHERE l.status='LOST')::int AS lost,
            COALESCE(SUM(l.renewal_count), 0)::int AS renewals
       FROM library_loans l
      WHERE ${where}`,
    values,
  );
  return {
    title: "Library loans",
    columns: [
      { key: "loanId", label: "Loan ID" },
      { key: "bookTitle", label: "Book" },
      { key: "borrowerType", label: "Borrower type" },
      { key: "issuedAt", label: "Issued" },
      { key: "dueOn", label: "Due date" },
      { key: "returnedAt", label: "Returned" },
      { key: "status", label: "Status" },
      { key: "overdue", label: "Overdue" },
      { key: "daysOverdue", label: "Days overdue" },
      { key: "returnedOverdue", label: "Returned overdue" },
      { key: "daysOverdueAtReturn", label: "Days overdue at return" },
      { key: "renewalCount", label: "Renewals" },
    ],
    rows: rowsResult.rows,
    total: totalFrom(countResult.rows),
    summary: summaryResult.rows[0] ?? {},
  };
}

const OPERATIONS_STATUS_VALUES = new Set([
  "ACTIVE", "AVAILABLE", "ASSIGNED", "MAINTENANCE", "DAMAGED", "LOST", "RETIRED",
  "INACTIVE", "OPEN", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED",
]);

function assertOperationsStatus(status: string | undefined) {
  if (status && !OPERATIONS_STATUS_VALUES.has(status.toUpperCase())) {
    throw new AuthError(400, "status is not a supported operations status");
  }
  return status?.toUpperCase();
}

async function runOperations(
  context: ReportContext,
  filters: ReportFilters,
): Promise<ReportResult> {
  const schoolId = scopedSchool(context);
  const status = assertOperationsStatus(filters.status);
  if (context.role === "OWNER") {
    const values: unknown[] = [schoolId];
    const statusClause = status ? "AND status=$2" : "";
    if (status) values.push(status);
    const result = await pool.query(
      `SELECT school_id AS "schoolId", entity_type AS "entityType", status,
              COUNT(*)::int AS count
         FROM (
           SELECT school_id, 'ASSET'::text AS entity_type, status FROM school_assets
           UNION ALL
           SELECT school_id, 'MAINTENANCE'::text, status FROM maintenance_requests
           UNION ALL
           SELECT school_id, 'TASK'::text, status FROM operational_tasks
           UNION ALL
           SELECT school_id, 'FACILITY'::text, status FROM school_facilities
         ) op
        WHERE ($1::integer IS NULL OR school_id=$1) ${statusClause}
        GROUP BY school_id, entity_type, status
        ORDER BY school_id, entity_type, status
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.limit, filters.offset],
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT school_id, entity_type, status FROM (
           SELECT school_id, 'ASSET'::text AS entity_type, status FROM school_assets
           UNION ALL SELECT school_id, 'MAINTENANCE'::text, status FROM maintenance_requests
           UNION ALL SELECT school_id, 'TASK'::text, status FROM operational_tasks
           UNION ALL SELECT school_id, 'FACILITY'::text, status FROM school_facilities
         ) op
         WHERE ($1::integer IS NULL OR school_id=$1) ${statusClause}
         GROUP BY school_id, entity_type, status
       ) grouped`,
      values,
    );
    return {
      title: "Operations summary",
      columns: [
        { key: "schoolId", label: "School ID" },
        { key: "entityType", label: "Record type" },
        { key: "status", label: "Status" },
        { key: "count", label: "Count" },
      ],
      rows: result.rows,
      total: totalFrom(count.rows),
    };
  }

  const values: unknown[] = [schoolId];
  const statusClause = status ? "AND status=$2" : "";
  if (status) values.push(status);
  const result = await pool.query(
    `SELECT entity_type AS "entityType", id, title, category, status, location,
            occurred_at AS "occurredAt"
       FROM (
         SELECT 'ASSET'::text AS entity_type, a.id, a.name AS title, c.name AS category,
                a.status, a.location, a.updated_at AS occurred_at
           FROM school_assets a
           LEFT JOIN school_operation_categories c
             ON c.id=a.category_id AND c.school_id=a.school_id AND c.category_type='ASSET'
          WHERE a.school_id=$1
         UNION ALL
         SELECT 'MAINTENANCE'::text, m.id, m.title, c.name, m.status, m.location, m.reported_at
           FROM maintenance_requests m
           LEFT JOIN school_operation_categories c
             ON c.id=m.category_id AND c.school_id=m.school_id AND c.category_type='MAINTENANCE'
          WHERE m.school_id=$1
         UNION ALL
         SELECT 'TASK'::text, t.id, t.title, c.name, t.status, NULL::text, t.created_at
           FROM operational_tasks t
           LEFT JOIN school_operation_categories c
             ON c.id=t.category_id AND c.school_id=t.school_id AND c.category_type='TASK'
          WHERE t.school_id=$1
         UNION ALL
         SELECT 'FACILITY'::text, f.id, f.name, f.facility_type, f.status, f.location, f.updated_at
           FROM school_facilities f WHERE f.school_id=$1
       ) op
      WHERE TRUE ${statusClause}
      ORDER BY occurred_at DESC, entity_type, id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, filters.offset],
  );
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT status FROM school_assets WHERE school_id=$1
       UNION ALL SELECT status FROM maintenance_requests WHERE school_id=$1
       UNION ALL SELECT status FROM operational_tasks WHERE school_id=$1
       UNION ALL SELECT status FROM school_facilities WHERE school_id=$1
     ) op WHERE TRUE ${statusClause}`,
    values,
  );
  return {
    title: "School operations",
    columns: [
      { key: "entityType", label: "Record type" },
      { key: "id", label: "Record ID" },
      { key: "title", label: "Name" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "location", label: "Location" },
      { key: "occurredAt", label: "Last recorded" },
    ],
    rows: result.rows,
    total: totalFrom(count.rows),
  };
}

async function runOperationsHistory(
  context: ReportContext,
  filters: ReportFilters,
): Promise<ReportResult> {
  const schoolId = scopedSchool(context);
  if (context.role === "OWNER") {
    const values: unknown[] = [schoolId];
    const result = await pool.query(
      `SELECT school_id AS "schoolId", history_type AS "historyType", status_or_event AS "statusOrEvent",
              COUNT(*)::int AS count
         FROM (
           SELECT school_id, 'ASSET'::text AS history_type,
                  COALESCE(status_after, event_type) AS status_or_event, event_at
             FROM school_asset_history
           UNION ALL
           SELECT school_id, 'MAINTENANCE'::text, to_status, occurred_at
             FROM maintenance_request_status_history
           UNION ALL
           SELECT school_id, 'TASK'::text, to_status, occurred_at
             FROM operational_task_status_history
         ) history
        WHERE ($1::integer IS NULL OR school_id=$1)
          AND ($2::date IS NULL OR event_at >= $2::date)
          AND ($3::date IS NULL OR event_at < $3::date + INTERVAL '1 day')
        GROUP BY school_id, history_type, status_or_event
        ORDER BY school_id, history_type, status_or_event
        LIMIT $4 OFFSET $5`,
      [schoolId, filters.from ?? null, filters.to ?? null, filters.limit, filters.offset],
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT school_id, history_type, status_or_event FROM (
           SELECT school_id, 'ASSET'::text AS history_type,
                  COALESCE(status_after, event_type) AS status_or_event, event_at
             FROM school_asset_history
           UNION ALL
           SELECT school_id, 'MAINTENANCE'::text, to_status, occurred_at
             FROM maintenance_request_status_history
           UNION ALL
           SELECT school_id, 'TASK'::text, to_status, occurred_at
             FROM operational_task_status_history
         ) history
         WHERE ($1::integer IS NULL OR school_id=$1)
           AND ($2::date IS NULL OR event_at >= $2::date)
           AND ($3::date IS NULL OR event_at < $3::date + INTERVAL '1 day')
         GROUP BY school_id, history_type, status_or_event
       ) grouped`,
      [schoolId, filters.from ?? null, filters.to ?? null],
    );
    return {
      title: "Operations history summary",
      columns: [
        { key: "schoolId", label: "School ID" },
        { key: "historyType", label: "History type" },
        { key: "statusOrEvent", label: "Status / event" },
        { key: "count", label: "Count" },
      ],
      rows: result.rows,
      total: totalFrom(count.rows),
    };
  }

  const result = await pool.query(
    `SELECT history_type AS "historyType", record_id AS "recordId",
            event_type AS "eventType", from_status AS "fromStatus",
            to_status AS "toStatus", quantity_before AS "quantityBefore",
            quantity_after AS "quantityAfter", event_at AS "eventAt"
       FROM (
         SELECT 'ASSET'::text AS history_type, h.asset_id AS record_id, h.event_type,
                h.status_before AS from_status, h.status_after AS to_status,
                h.quantity_before, h.quantity_after, h.event_at
           FROM school_asset_history h WHERE h.school_id=$1
         UNION ALL
         SELECT 'MAINTENANCE'::text, h.maintenance_request_id, 'STATUS_CHANGED'::text,
                h.from_status, h.to_status, NULL::integer, NULL::integer, h.occurred_at
           FROM maintenance_request_status_history h WHERE h.school_id=$1
         UNION ALL
         SELECT 'TASK'::text, h.task_id, 'STATUS_CHANGED'::text,
                h.from_status, h.to_status, NULL::integer, NULL::integer, h.occurred_at
           FROM operational_task_status_history h WHERE h.school_id=$1
       ) history
      WHERE ($2::date IS NULL OR event_at >= $2::date)
        AND ($3::date IS NULL OR event_at < $3::date + INTERVAL '1 day')
      ORDER BY event_at DESC, history_type, record_id
      LIMIT $4 OFFSET $5`,
    [schoolId, filters.from ?? null, filters.to ?? null, filters.limit, filters.offset],
  );
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT event_at FROM school_asset_history WHERE school_id=$1
       UNION ALL SELECT occurred_at FROM maintenance_request_status_history WHERE school_id=$1
       UNION ALL SELECT occurred_at FROM operational_task_status_history WHERE school_id=$1
     ) history
     WHERE ($2::date IS NULL OR event_at >= $2::date)
       AND ($3::date IS NULL OR event_at < $3::date + INTERVAL '1 day')`,
    [schoolId, filters.from ?? null, filters.to ?? null],
  );
  return {
    title: "Operations status and asset history",
    columns: [
      { key: "historyType", label: "History type" },
      { key: "recordId", label: "Record ID" },
      { key: "eventType", label: "Event" },
      { key: "fromStatus", label: "Previous status" },
      { key: "toStatus", label: "New status" },
      { key: "quantityBefore", label: "Quantity before" },
      { key: "quantityAfter", label: "Quantity after" },
      { key: "eventAt", label: "Date" },
    ],
    rows: result.rows,
    total: totalFrom(count.rows),
  };
}

async function runAudit(context: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const schoolId = scopedSchool(context);
  const values: unknown[] = [schoolId];
  const clauses = ["($1::integer IS NULL OR al.school_id=$1)"];
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`al.result=$${values.length}`);
  }
  clauses.push(...datePredicates("al.timestamp", filters, values));
  const where = clauses.join(" AND ");
  const rowsResult = await pool.query(
    `SELECT al.timestamp AS "eventAt", al.role, al.action, al.module,
            al.record_id AS "recordId", al.severity, al.event_type AS "eventType",
            al.result, al.school_id AS "schoolId"
       FROM audit_logs al
      WHERE ${where}
      ORDER BY al.timestamp DESC, al.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, filters.limit, filters.offset],
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs al WHERE ${where}`,
    values,
  );
  return {
    title: "System activity",
    columns: [
      { key: "eventAt", label: "Date" },
      { key: "role", label: "Role" },
      { key: "action", label: "Action" },
      { key: "module", label: "Module" },
      { key: "recordId", label: "Record ID" },
      { key: "severity", label: "Severity" },
      { key: "eventType", label: "Event type" },
      { key: "result", label: "Result" },
      { key: "schoolId", label: "School ID" },
    ],
    rows: rowsResult.rows,
    total: totalFrom(countResult.rows),
  };
}

const schoolLibraryRoles = ["OWNER", "ADMIN"] as const;
const loanRoles = ["OWNER", "ADMIN", "PARENT", "STUDENT"] as const;
const operationsRoles = ["OWNER", "ADMIN"] as const;

export const activitiesReports: Record<string, ReportDefinition> = {
  library: {
    roles: [...schoolLibraryRoles],
    filters: ["schoolId", "limit", "offset"],
    run: runLibrary,
  },
  "library-loans": {
    roles: [...loanRoles],
    filters: ["schoolId", "from", "to", "status", "studentId", "limit", "offset"],
    run: runLibraryLoans,
  },
  operations: {
    roles: [...operationsRoles],
    filters: ["schoolId", "status", "limit", "offset"],
    run: runOperations,
  },
  "operations-history": {
    roles: [...operationsRoles],
    filters: ["schoolId", "from", "to", "limit", "offset"],
    run: runOperationsHistory,
  },
  audit: {
    roles: [...operationsRoles],
    filters: ["schoolId", "from", "to", "status", "limit", "offset"],
    run: runAudit,
  },
};