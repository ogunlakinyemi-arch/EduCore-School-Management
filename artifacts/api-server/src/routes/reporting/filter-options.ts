import { pool } from "@workspace/db";
import type { ReportContext, ReportFilters } from "./core";

export type FilterOption = { value: string; label: string };
export type ReportFilterOptions = { options: Record<string, FilterOption[]>; truncated: string[]; requiresSchool: boolean };

// These are identifiers from the existing report queries, never request input.
function observedSource(report: string) {
  if (report.startsWith("attendance")) return report === "attendance-discrepancies"
    ? ["attendance_discrepancies", "status", "student_id"] : ["attendance_events", "attendance_status", "student_id"];
  if (["academics", "academic-results", "grade-distribution"].includes(report)) return ["academic_results", "status", "student_id"];
  if (report === "academic-assessments") return ["academic_assessments", "status", "school_class_id"];
  if (report === "report-card-summary") return ["academic_report_cards", "status", "student_id"];
  if (report === "students") return ["students", "status", "id"];
  if (report === "staff") return ["employees", "employment_status", ""];
  if (report === "finance") return ["fee_invoices", "status", "student_id"];
  if (report === "finance-payments") return ["fee_payments", "status", "invoice_id"];
  if (report === "subscriptions") return ["subscriptions", "status", "student_id"];
  if (report === "audit") return ["audit_logs", "result", ""];
  return null;
}

/** Read-only catalogs use the report's resolved identity, never client role claims.
 * Family/Teacher catalogs are restricted to related students and placements. */
export async function reportFilterOptions(context: ReportContext, filters: ReportFilters, report: string, keys: string[]): Promise<ReportFilterOptions> {
  const options: ReportFilterOptions["options"] = Object.fromEntries(keys.map(key => [key, []]));
  if (!context.schoolId && context.role !== "OWNER") return { options, truncated: [], requiresSchool: true };
  const broad = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(context.role);
  const values = [context.schoolId, broad, context.studentId ?? null, context.parentId ?? null,
    context.userId, filters.sessionId ?? null, filters.classId ?? null];
  const cte = `WITH selector_types AS (SELECT $6::int session_id,$7::int class_id), visible_students AS (
    SELECT st.* FROM students st WHERE st.school_id=$1 AND (
      $2::boolean OR st.id=$3 OR EXISTS (
        SELECT 1 FROM parent_student_relationships rel
        WHERE rel.student_id=st.id AND rel.parent_id=$4 AND UPPER(rel.status)='ACTIVE'
      ) OR (${context.role === "TEACHER" && report !== "library-loans" ? "true" : "false"} AND $3::int IS NULL AND $4::int IS NULL AND EXISTS (
        SELECT 1 FROM student_class_assignments a JOIN teacher_class_assignments t
          ON t.school_id=a.school_id AND t.school_class_id=a.school_class_id
          AND t.academic_session_id=a.academic_session_id AND t.section=a.section AND t.status='ACTIVE'
        JOIN employees e ON e.id=t.employee_id AND e.school_id=t.school_id
          AND e.user_id=$5 AND UPPER(e.employment_status)='ACTIVE'
        WHERE a.student_id=st.id AND a.school_id=st.school_id
      ))
    )
  ), placements AS (
    SELECT a.* FROM student_class_assignments a JOIN visible_students st
      ON st.id=a.student_id AND st.school_id=a.school_id
  )`;
  const candidates: Array<[string, string]> = [
    ["sessionId", `SELECT s.id::text value,s.name label FROM academic_sessions s WHERE s.school_id=$1
      AND ($2 OR EXISTS(SELECT 1 FROM placements a WHERE a.academic_session_id=s.id))`],
    ["termId", `SELECT t.id::text value,t.name || ' — ' || s.name label FROM academic_terms t
      JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.school_id=$1 AND ($6::int IS NULL OR t.academic_session_id=$6)
      AND ($2 OR EXISTS(SELECT 1 FROM placements a WHERE a.academic_session_id=t.academic_session_id
        AND (a.academic_term_id IS NULL OR a.academic_term_id=t.id)))`],
    ["classId", `SELECT c.id::text value,c.name || ' (' || c.section || ')' label FROM school_classes c
      WHERE c.school_id=$1 AND ($2 OR EXISTS(SELECT 1 FROM placements a WHERE a.school_class_id=c.id))
      AND ($6::int IS NULL OR EXISTS(SELECT 1 FROM placements a WHERE a.school_class_id=c.id AND a.academic_session_id=$6))`],
    ["section", `SELECT DISTINCT a.section value,a.section label FROM placements a
      WHERE ($6::int IS NULL OR a.academic_session_id=$6) AND ($7::int IS NULL OR a.school_class_id=$7)
      UNION SELECT c.section,c.section FROM school_classes c WHERE c.school_id=$1 AND $2
      AND ($7::int IS NULL OR c.id=$7) AND $6::int IS NULL`],
    ["subjectId", `SELECT s.id::text value,s.name label FROM subjects s WHERE s.school_id=$1
      AND ($2 OR EXISTS(SELECT 1 FROM class_subjects cs JOIN placements a ON a.school_class_id=cs.school_class_id
        AND a.school_id=cs.school_id AND a.academic_session_id=cs.academic_session_id
        WHERE cs.subject_id=s.id AND cs.school_id=s.school_id))
      AND ($7::int IS NULL OR EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.school_id=$1
        AND cs.subject_id=s.id AND cs.school_class_id=$7 AND ($6::int IS NULL OR cs.academic_session_id=$6)))`],
    ["studentId", `SELECT st.id::text value,st.first_name || ' ' || st.last_name || ' — ' || st.admission_no label
      FROM visible_students st WHERE ($6::int IS NULL AND $7::int IS NULL) OR EXISTS(
        SELECT 1 FROM placements a WHERE a.student_id=st.id AND ($6::int IS NULL OR a.academic_session_id=$6)
        AND ($7::int IS NULL OR a.school_class_id=$7))`],
  ];
  const source = observedSource(report);
  if (source) {
    const [table, column, studentColumn] = source;
    const related = studentColumn === "school_class_id" ? "x.school_class_id IN (SELECT school_class_id FROM placements)"
      : studentColumn === "borrower_student_id" ? "(x.borrower_type='STUDENT' AND x.borrower_student_id IN (SELECT id FROM visible_students))"
      : studentColumn === "invoice_id" ? "x.invoice_id IN (SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id IN (SELECT id FROM visible_students))"
      : studentColumn ? `x.${studentColumn} IN (SELECT id FROM visible_students)` : "false";
    candidates.push(["status", `SELECT DISTINCT x.${column}::text value,x.${column}::text label
      FROM ${table} x WHERE ($1::int IS NULL OR x.school_id=$1) AND ($2 OR ${related})`]);
  }
  if (report === "operations") candidates.push(["status", `SELECT DISTINCT status value,status label FROM (
    SELECT status FROM school_assets WHERE ($1::int IS NULL OR school_id=$1)
    UNION SELECT status FROM maintenance_requests WHERE ($1::int IS NULL OR school_id=$1)
    UNION SELECT status FROM operational_tasks WHERE ($1::int IS NULL OR school_id=$1)) s WHERE $2`]);
  if (report === "communication") candidates.push(["status", `SELECT DISTINCT d.status value,d.status label
    FROM communication_deliveries d JOIN communication_notifications n ON n.id=d.notification_id
    WHERE ($1::int IS NULL OR n.school_id=$1) AND $2 ${context.role === "ACCOUNTANT" ? "AND n.category='FINANCE'" : ""}`]);
  // OVERDUE is computed by loanWhere, not stored in library_loans.status.
  if (report === "library-loans") candidates.push(["status", `SELECT v value,v label
    FROM unnest(ARRAY['OPEN','RETURNED','LOST','OVERDUE']::text[]) v`]);
  if (report === "nfc") candidates.push(["status", `SELECT DISTINCT status value,status label
    FROM nfc_cards WHERE ($1::int IS NULL OR school_id=$1) AND ($2 OR student_id IN (SELECT id FROM visible_students)) UNION SELECT DISTINCT attendance_status,attendance_status
    FROM attendance_events WHERE ($1::int IS NULL OR school_id=$1) AND ($2 OR student_id IN (SELECT id FROM visible_students))`]);
  if (report.startsWith("attendance")) candidates.push(["method", `SELECT DISTINCT identification_method value,identification_method label
    FROM attendance_events WHERE ($1::int IS NULL OR school_id=$1) AND ($2 OR student_id IN (SELECT id FROM visible_students))`]);
  if (["finance", "finance-payments"].includes(report)) candidates.push(["method", `SELECT DISTINCT p.method value,p.method label
    FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
    WHERE ($1::int IS NULL OR p.school_id=$1) AND ($2 OR i.student_id IN (SELECT id FROM visible_students))`]);
  const requiresSchool = !context.schoolId && keys.some(key => ["sessionId","termId","classId","section","subjectId","studentId"].includes(key));
  const selected = candidates.filter(([key]) => keys.includes(key) && (context.schoolId || ["status","method"].includes(key)));
  if (!selected.length) return { options, truncated: [], requiresSchool: false };
  const sql = selected.map(([key, query]) => `SELECT '${key}' key,q.value,q.label FROM (${query}) q`).join(" UNION ALL ");
  const result = await pool.query(`${cte}, candidates AS (${sql}), ranked AS (
    SELECT DISTINCT key,value,label FROM candidates WHERE value IS NOT NULL AND value<>''
  ), numbered AS (SELECT *,row_number() OVER(PARTITION BY key ORDER BY label,value) n FROM ranked)
  SELECT key,value,label FROM numbered WHERE n<=1001 ORDER BY key,label,value`, values);
  const truncated = new Set<string>();
  for (const row of result.rows) {
    const list = options[row.key];
    if (!list) continue;
    if (list.length >= 1000) { truncated.add(row.key); continue; }
    list.push({ value: String(row.value), label: String(row.label) });
  }
  return { options, truncated: [...truncated], requiresSchool };
}
