import { pool } from "@workspace/db";
import type {
  ReportContext,
  ReportDefinition,
  ReportFilters,
  ReportResult,
} from "./core";

type SqlValues = unknown[];

function page(filters: ReportFilters) {
  const limit = Number.isSafeInteger(filters.limit) ? Math.min(Math.max(filters.limit, 1), 200) : 50;
  const offset = Number.isSafeInteger(filters.offset) ? Math.min(Math.max(filters.offset, 0), 1_000_000) : 0;
  return { limit, offset };
}

function addValue(values: SqlValues, value: unknown) {
  values.push(value);
  return `$${values.length}`;
}

function schoolPredicate(alias: string, ctx: ReportContext, values: SqlValues) {
  return ctx.schoolId === null
    ? `${alias}.id IS NOT NULL`
    : `${alias}.id = ${addValue(values, ctx.schoolId)}`;
}

function tenantPredicate(column: string, ctx: ReportContext, values: SqlValues) {
  return ctx.schoolId === null
    ? `${column} IS NOT NULL`
    : `${column} = ${addValue(values, ctx.schoolId)}`;
}

function appendCommonStudentFilters(
  conditions: string[],
  values: SqlValues,
  filters: ReportFilters,
) {
  if (filters.status) conditions.push(`st.status = ${addValue(values, filters.status)}`);
  if (filters.from) conditions.push(`st.admission_date >= ${addValue(values, filters.from)}::date`);
  if (filters.to) conditions.push(`st.admission_date <= ${addValue(values, filters.to)}::date`);
  if (filters.classId !== undefined) {
    const id = addValue(values, filters.classId);
    const sessionId = filters.sessionId === undefined
      ? "TRUE"
      : `a.academic_session_id = ${addValue(values, filters.sessionId)}`;
    const section = filters.section
      ? `AND a.section = ${addValue(values, filters.section)}`
      : "";
    conditions.push(
      `EXISTS (SELECT 1 FROM student_class_assignments a
        WHERE a.student_id = st.id AND a.school_id = st.school_id
          AND a.school_class_id = ${id} AND a.status = 'ACTIVE'
          AND ${sessionId} ${section})`,
    );
  } else if (filters.sessionId !== undefined || filters.section) {
    const assignmentConditions = [
      "a.student_id = st.id",
      "a.school_id = st.school_id",
      "a.status = 'ACTIVE'",
    ];
    if (filters.sessionId !== undefined) {
      assignmentConditions.push(`a.academic_session_id = ${addValue(values, filters.sessionId)}`);
    }
    if (filters.section) {
      assignmentConditions.push(`a.section = ${addValue(values, filters.section)}`);
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM student_class_assignments a
        WHERE ${assignmentConditions.join(" AND ")})`,
    );
  }
}

async function paged(
  title: string,
  columns: ReportResult["columns"],
  countSql: string,
  dataSql: string,
  values: SqlValues,
  filters: ReportFilters,
  summary?: ReportResult["summary"],
  dataValues: SqlValues = values,
): Promise<ReportResult> {
  const countResult = await pool.query(countSql, values);
  const { limit, offset } = page(filters);
  const rowsResult = await pool.query(dataSql, [...dataValues, limit, offset]);
  return {
    title,
    columns,
    rows: rowsResult.rows as Record<string, unknown>[],
    total: Number(countResult.rows[0]?.total ?? 0),
    ...(summary ? { summary } : {}),
  };
}

async function overview(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const values: SqlValues = [];
  const scope = schoolPredicate("s", ctx, values);
  const countSql = `SELECT COUNT(*)::int AS total FROM schools s WHERE ${scope}`;
  const dataSql = `
    SELECT s.id AS "schoolId", s.code AS "schoolCode", s.name AS "schoolName",
           s.city, s.state, s.status AS "schoolStatus",
           COALESCE(st.student_count, 0)::int AS "studentCount",
           COALESCE(sub.active_count, 0)::int AS "activeSubscriptions",
           COALESCE(sub.subscription_count, 0)::int AS "subscriptionCount"
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS student_count
          FROM students st
         WHERE st.school_id = s.id
      ) st ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS subscription_count,
               COUNT(*) FILTER (WHERE LOWER(sb.status) = 'active')::int AS active_count
          FROM subscriptions sb
         WHERE sb.school_id = s.id
      ) sub ON TRUE
     WHERE ${scope}
     ORDER BY s.name, s.id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const countResult = await pool.query(countSql, ctx.schoolId === null ? [] : [ctx.schoolId]);
  const dataValues = ctx.schoolId === null ? [] : [ctx.schoolId];
  const { limit, offset } = page(filters);
  const rows = await pool.query(dataSql, [...dataValues, limit, offset]);
  const totals = await pool.query(
    `SELECT COUNT(*)::int AS "schoolCount",
            COALESCE(SUM(st.student_count), 0)::int AS "studentCount",
            COALESCE(SUM(sub.active_count), 0)::int AS "activeSubscriptions",
            COALESCE(SUM(sub.subscription_count), 0)::int AS "subscriptionCount"
       FROM schools s
       LEFT JOIN LATERAL (SELECT COUNT(*)::int AS student_count FROM students st WHERE st.school_id=s.id) st ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS subscription_count,
                COUNT(*) FILTER (WHERE LOWER(sb.status)='active')::int AS active_count
           FROM subscriptions sb WHERE sb.school_id=s.id
       ) sub ON TRUE
      WHERE ${scope}`,
    ctx.schoolId === null ? [] : [ctx.schoolId],
  );
  return {
    title: ctx.schoolId === null ? "Platform overview and school comparison" : "School overview",
    columns: [
      { key: "schoolId", label: "School ID" },
      { key: "schoolCode", label: "School code" },
      { key: "schoolName", label: "School" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "schoolStatus", label: "School status" },
      { key: "studentCount", label: "Students" },
      { key: "activeSubscriptions", label: "Active subscriptions" },
      { key: "subscriptionCount", label: "Subscription records" },
    ],
    rows: rows.rows as Record<string, unknown>[],
    total: Number(countResult.rows[0]?.total ?? 0),
    summary: (totals.rows[0] ?? {}) as Record<string, unknown>,
  };
}

async function students(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const values: SqlValues = [];
  const conditions = [tenantPredicate("st.school_id", ctx, values)];
  appendCommonStudentFilters(conditions, values, filters);
  const where = conditions.join(" AND ");
  return paged(
    "Student population, new and withdrawn students",
    [
      { key: "studentId", label: "Student ID" },
      { key: "admissionNo", label: "Admission number" },
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "gender", label: "Gender" },
      { key: "className", label: "Class" },
      { key: "section", label: "Section" },
      { key: "status", label: "Status" },
      { key: "admissionDate", label: "Admission date" },
    ],
    `SELECT COUNT(*)::int AS total FROM students st WHERE ${where}`,
    `SELECT st.id AS "studentId", st.admission_no AS "admissionNo",
            st.first_name AS "firstName", st.last_name AS "lastName",
            st.gender, st.class_name AS "className", st.section, st.status,
            st.admission_date AS "admissionDate"
       FROM students st WHERE ${where}
       ORDER BY st.last_name, st.first_name, st.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    filters,
  );
}

async function parents(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const values: SqlValues = [];
  const conditions = [tenantPredicate("st.school_id", ctx, values)];
  appendCommonStudentFilters(conditions, values, filters);
  const where = conditions.join(" AND ");
  return paged(
    "Parent links and students without linked parents",
    [
      { key: "studentId", label: "Student ID" },
      { key: "admissionNo", label: "Admission number" },
      { key: "studentName", label: "Student" },
      { key: "parentCount", label: "Linked parents" },
      { key: "parentNames", label: "Parent/guardian names" },
      { key: "linkStatus", label: "Link status" },
    ],
    `SELECT COUNT(*)::int AS total FROM students st WHERE ${where}`,
    `SELECT st.id AS "studentId", st.admission_no AS "admissionNo",
            CONCAT_WS(' ', st.first_name, st.last_name) AS "studentName",
            COUNT(DISTINCT p.id)::int AS "parentCount",
            COALESCE(STRING_AGG(DISTINCT p.name, ', ' ORDER BY p.name), '') AS "parentNames",
            CASE WHEN COUNT(DISTINCT p.id) = 0 THEN 'MISSING_LINK' ELSE 'LINKED' END AS "linkStatus"
       FROM students st
       LEFT JOIN parent_student_relationships psr
         ON psr.student_id=st.id AND psr.status='ACTIVE'
       LEFT JOIN parents p ON p.id=psr.parent_id AND p.school_id=st.school_id
      WHERE ${where}
      GROUP BY st.id, st.admission_no, st.first_name, st.last_name
      ORDER BY st.last_name, st.first_name, st.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    filters,
  );
}

async function staff(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const values: SqlValues = [];
  const conditions = [tenantPredicate("e.school_id", ctx, values)];
  if (filters.status) conditions.push(`e.employment_status = ${addValue(values, filters.status)}`);
  const where = conditions.join(" AND ");
  return paged(
    "Staff roles and assignments",
    [
      { key: "employeeId", label: "Employee ID" },
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "employeeType", label: "Staff role" },
      { key: "employmentStatus", label: "Employment status" },
      { key: "membershipRoles", label: "Account roles" },
      { key: "assignmentCount", label: "Active class assignments" },
      { key: "assignments", label: "Assignments" },
    ],
    `SELECT COUNT(*)::int AS total FROM employees e WHERE ${where}`,
    `SELECT e.employee_no AS "employeeId", e.first_name AS "firstName",
            e.last_name AS "lastName", e.employee_type AS "employeeType",
            e.employment_status AS "employmentStatus",
            COALESCE(roles.role_names, '') AS "membershipRoles",
            COALESCE(assignments.assignment_count, 0)::int AS "assignmentCount",
            COALESCE(assignments.assignment_names, '') AS "assignments"
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT sm.role, ', ' ORDER BY sm.role) AS role_names
           FROM school_memberships sm
          WHERE sm.user_id=e.user_id AND sm.school_id=e.school_id AND sm.status='ACTIVE'
       ) roles ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS assignment_count,
                STRING_AGG(DISTINCT CONCAT_WS(' ', sc.name, tca.section, sb.name), ', '
                           ORDER BY CONCAT_WS(' ', sc.name, tca.section, sb.name)) AS assignment_names
           FROM teacher_class_assignments tca
           JOIN school_classes sc ON sc.id=tca.school_class_id AND sc.school_id=tca.school_id
           LEFT JOIN subjects sb ON sb.id=tca.subject_id AND sb.school_id=tca.school_id
          WHERE tca.employee_id=e.id AND tca.school_id=e.school_id AND tca.status='ACTIVE'
       ) assignments ON TRUE
      WHERE ${where}
      ORDER BY e.last_name, e.first_name, e.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    filters,
  );
}

async function classes(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  const values: SqlValues = [];
  const conditions = [tenantPredicate("sc.school_id", ctx, values)];
  if (filters.classId !== undefined) conditions.push(`sc.id = ${addValue(values, filters.classId)}`);
  if (filters.section) conditions.push(`sc.section = ${addValue(values, filters.section)}`);
  if (filters.sessionId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM student_class_assignments sa
      WHERE sa.school_id=sc.school_id AND sa.school_class_id=sc.id
        AND sa.academic_session_id=${addValue(values, filters.sessionId)} AND sa.status='ACTIVE')`);
  }
  const where = conditions.join(" AND ");
  return paged(
    "Classes, sections, subjects and teacher assignments",
    [
      { key: "classId", label: "Class ID" },
      { key: "className", label: "Class" },
      { key: "section", label: "Section" },
      { key: "studentCount", label: "Current students" },
      { key: "subjects", label: "Subjects" },
      { key: "teachers", label: "Teachers" },
    ],
    `SELECT COUNT(*)::int AS total FROM school_classes sc WHERE ${where}`,
    `SELECT sc.id AS "classId", sc.name AS "className", sc.section,
            COALESCE(population.student_count, 0)::int AS "studentCount",
            COALESCE(subject_list.subject_names, '') AS subjects,
            COALESCE(teacher_list.teacher_names, '') AS teachers
       FROM school_classes sc
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT sa.student_id)::int AS student_count
           FROM student_class_assignments sa
          WHERE sa.school_id=sc.school_id AND sa.school_class_id=sc.id
            AND sa.section=sc.section AND sa.status='ACTIVE' AND sa.is_current=true
            AND ($${values.length + 1}::integer IS NULL OR sa.academic_session_id=$${values.length + 1})
       ) population ON TRUE
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT sb.name, ', ' ORDER BY sb.name) AS subject_names
           FROM class_subjects cs
           JOIN subjects sb ON sb.id=cs.subject_id AND sb.school_id=cs.school_id
          WHERE cs.school_id=sc.school_id AND cs.school_class_id=sc.id
            AND cs.status='ACTIVE' AND (cs.section IS NULL OR cs.section=sc.section)
            AND ($${values.length + 1}::integer IS NULL OR cs.academic_session_id=$${values.length + 1})
       ) subject_list ON TRUE
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT CONCAT_WS(' ', e.first_name, e.last_name), ', '
                           ORDER BY CONCAT_WS(' ', e.first_name, e.last_name)) AS teacher_names
           FROM teacher_class_assignments tca
           JOIN employees e ON e.id=tca.employee_id AND e.school_id=tca.school_id
          WHERE tca.school_id=sc.school_id AND tca.school_class_id=sc.id
            AND tca.section=sc.section AND tca.status='ACTIVE'
            AND ($${values.length + 1}::integer IS NULL OR tca.academic_session_id=$${values.length + 1})
       ) teacher_list ON TRUE
      WHERE ${where}
      ORDER BY sc.name, sc.section, sc.id
      LIMIT $${values.length + 2} OFFSET $${values.length + 3}`,
    values,
    filters,
    undefined,
    [...values, filters.sessionId ?? null],
  );
}

async function partners(ctx: ReportContext, filters: ReportFilters): Promise<ReportResult> {
  if (ctx.role === "PARTNER" && ctx.partnerId === undefined) {
    throw new Error("Partner report context is missing an authorized partner profile");
  }
  let partnerRole: string | undefined;
  let isProfileOwner = false;
  if (ctx.role === "PARTNER") {
    const profileUser = await pool.query(
      `SELECT pp.user_id=$2 AS "isOwner", active_user.role AS "partnerRole"
         FROM partner_profiles pp
         LEFT JOIN LATERAL (
           SELECT ppu.role
             FROM partner_profile_users ppu
            WHERE ppu.partner_profile_id=pp.id AND ppu.user_id=$2 AND ppu.status='ACTIVE'
              AND ppu.role IN ('PARTNER_OWNER','PARTNER_ADMIN','PARTNER_FINANCE','PARTNER_STAFF')
            LIMIT 1
         ) active_user ON TRUE
        WHERE pp.id=$1 AND UPPER(pp.status)='ACTIVE'
          AND (pp.user_id=$2 OR active_user.role IS NOT NULL)
        LIMIT 1`,
      [ctx.partnerId, ctx.userId],
    );
    const userRow = profileUser.rows[0] as { isOwner?: boolean; partnerRole?: string } | undefined;
    if (!userRow) throw new Error("Active partner profile membership required");
    isProfileOwner = userRow.isOwner === true;
    partnerRole = userRow.partnerRole;
  }
  const canReadCommissionDetails = ctx.role === "OWNER" ||
    isProfileOwner ||
    partnerRole === "PARTNER_ADMIN" ||
    partnerRole === "PARTNER_FINANCE";
  const values: SqlValues = ctx.role === "PARTNER"
    ? [ctx.partnerId, ctx.userId]
    : [];
  const scope = ctx.role === "PARTNER"
    ? `spa.partner_profile_id=$1 AND spa.is_current=true AND spa.status='ACTIVE'
       AND pp.status='ACTIVE'
       AND (pp.user_id=$2 OR EXISTS (
         SELECT 1 FROM partner_profile_users ppu
          WHERE ppu.partner_profile_id=pp.id AND ppu.user_id=$2 AND ppu.status='ACTIVE'
            AND ppu.role IN ('PARTNER_OWNER','PARTNER_ADMIN','PARTNER_FINANCE','PARTNER_STAFF')
       ))`
    : `spa.is_current=true AND spa.status='ACTIVE' AND pp.status='ACTIVE'`;
  const selectedSchoolId = filters.schoolId ?? ctx.schoolId ?? undefined;
  const schoolFilter = selectedSchoolId === undefined
    ? ""
    : `AND s.id=${addValue(values, selectedSchoolId)}`;
  const where = `${scope} ${schoolFilter}`;
  const countSql = `SELECT COUNT(DISTINCT s.id)::int AS total
      FROM school_partner_attributions spa
      JOIN schools s ON s.id=spa.school_id
      JOIN partner_profiles pp ON pp.id=spa.partner_profile_id
     WHERE ${where}`;
  const financialColumns = canReadCommissionDetails
    ? `, COALESCE(comm.ledger_count, 0)::int AS "commissionRecords",
         COALESCE(comm.total_amount, 0)::numeric AS "commissionAmount",
         COALESCE(comm.payable_amount, 0)::numeric AS "payableCommission",
         COALESCE(comm.paid_amount, 0)::numeric AS "paidCommission",
         COALESCE(comm.held_count, 0)::int AS "heldRecords",
         COALESCE(comm.reversed_count, 0)::int AS "reversedRecords",
         COALESCE(comm.cancelled_count, 0)::int AS "cancelledRecords"`
    : "";
  const commissionJoin = canReadCommissionDetails
    ? `LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS ledger_count, COALESCE(SUM(cl.amount), 0) AS total_amount,
                COALESCE(SUM(cl.amount) FILTER (WHERE cl.status='PAYABLE'), 0) AS payable_amount,
                COALESCE(SUM(cl.amount) FILTER (WHERE cl.status='PAID'), 0) AS paid_amount,
                COUNT(*) FILTER (WHERE cl.status='HELD')::int AS held_count,
                COUNT(*) FILTER (WHERE cl.status='REVERSED')::int AS reversed_count,
                COUNT(*) FILTER (WHERE cl.status='CANCELLED')::int AS cancelled_count
           FROM commission_ledger cl
          WHERE cl.school_id=s.id AND cl.partner_profile_id=spa.partner_profile_id
       ) comm ON TRUE`
    : "";
  const dataSql = `SELECT s.id AS "schoolId", s.name AS "schoolName", s.status AS "schoolStatus",
          COALESCE(st.student_count, 0)::int AS "studentCount"${financialColumns}
      FROM school_partner_attributions spa
      JOIN schools s ON s.id=spa.school_id
      JOIN partner_profiles pp ON pp.id=spa.partner_profile_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS student_count FROM students st WHERE st.school_id=s.id
      ) st ON TRUE
       ${commissionJoin}
     WHERE ${where}
     ORDER BY s.name, s.id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const columns = [
    { key: "schoolId", label: "School ID" },
    { key: "schoolName", label: "Referred school" },
    { key: "schoolStatus", label: "School status" },
    { key: "studentCount", label: "Students" },
    ...(canReadCommissionDetails ? [
      { key: "commissionRecords", label: "Commission records" },
      { key: "commissionAmount", label: "Commission ledger amount (all states)" },
      { key: "payableCommission", label: "Payable commission" },
      { key: "paidCommission", label: "Paid commission" },
      { key: "heldRecords", label: "Held records" },
      { key: "reversedRecords", label: "Reversed records" },
      { key: "cancelledRecords", label: "Cancelled records" },
    ] : []),
  ];
  const result = await paged(
    "Partner-attributed schools and commissions",
    columns,
    countSql,
    dataSql,
    values,
    filters,
  );
  return result;
}

export const organizationReports: Record<string, ReportDefinition> = {
  overview: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "limit", "offset"],
    run: overview,
  },
  students: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "from", "to", "sessionId", "classId", "section", "status", "limit", "offset"],
    run: students,
  },
  parents: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "sessionId", "classId", "section", "limit", "offset"],
    run: parents,
  },
  staff: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "status", "limit", "offset"],
    run: staff,
  },
  classes: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "sessionId", "classId", "section", "limit", "offset"],
    run: classes,
  },
  partners: {
    roles: ["OWNER", "PARTNER"],
    filters: ["schoolId", "limit", "offset"],
    run: partners,
  },
};