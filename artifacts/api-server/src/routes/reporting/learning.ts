import { pool } from "@workspace/db";
import type {
  ReportContext,
  ReportDefinition,
  ReportFilters,
  ReportResult,
} from "./core";

type QuerySpec = {
  title: string;
  columns: { key: string; label: string }[];
  from: string;
  select: string;
  countFrom?: string;
  countSql?: string;
  groupBy?: string;
  where: string[];
  values: unknown[];
  orderBy: string;
};

const eventColumns = [
  { key: "eventDate", label: "Date" },
  { key: "student", label: "Student" },
  { key: "eventType", label: "Event" },
  { key: "status", label: "Status" },
  { key: "occurredAt", label: "Occurred at" },
];

function base(context: ReportContext, alias: string) {
  return {
    values: [context.schoolId],
    where: [`($1::int IS NULL OR ${alias}.school_id=$1)`],
  };
}

function addFilter(
  query: { values: unknown[]; where: string[] },
  expression: string,
  value: unknown,
) {
  query.values.push(value);
  query.where.push(`${expression}=$${query.values.length}`);
}

function addDateFilters(
  query: { values: unknown[]; where: string[] },
  expression: string,
  filters: ReportFilters,
) {
  if (filters.from) {
    query.values.push(filters.from);
    query.where.push(`${expression}>=$${query.values.length}::date`);
  }
  if (filters.to) {
    query.values.push(filters.to);
    query.where.push(`${expression}<$${query.values.length}::date + INTERVAL '1 day'`);
  }
}

function addContextFilters(
  query: { values: unknown[]; where: string[] },
  columns: {
    session?: string;
    term?: string;
    class?: string;
    section?: string;
    subject?: string;
    student?: string;
    status?: string;
  },
  filters: ReportFilters,
) {
  if (filters.sessionId !== undefined && columns.session) addFilter(query, columns.session, filters.sessionId);
  if (filters.termId !== undefined && columns.term) addFilter(query, columns.term, filters.termId);
  if (filters.classId !== undefined && columns.class) addFilter(query, columns.class, filters.classId);
  if (filters.section !== undefined && columns.section) addFilter(query, columns.section, filters.section);
  if (filters.subjectId !== undefined && columns.subject) addFilter(query, columns.subject, filters.subjectId);
  if (filters.studentId !== undefined && columns.student) addFilter(query, columns.student, filters.studentId);
  if (filters.status !== undefined && columns.status) addFilter(query, columns.status, filters.status.toUpperCase());
}

function familyStudentScope(context: ReportContext, alias: string, userParam: string) {
  if (context.role === "STUDENT") {
    return { sql: `${alias}.student_id=${userParam}`, values: [context.studentId] };
  }
  if (context.role === "PARENT") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM parent_student_relationships psr
        JOIN parents p ON p.id=psr.parent_id AND p.school_id=${alias}.school_id
          AND UPPER(p.status)='ACTIVE'
        WHERE psr.student_id=${alias}.student_id AND psr.parent_id=${userParam}
          AND UPPER(psr.status)='ACTIVE'
      )`,
      values: [context.parentId],
    };
  }
  return null;
}

function addFamilyScope(query: { values: unknown[]; where: string[] }, context: ReportContext, alias: string) {
  const userParam = `$${query.values.length + 1}`;
  const scope = familyStudentScope(context, alias, userParam);
  if (scope) {
    query.values.push(...scope.values);
    query.where.push(scope.sql);
  }
}

const attendanceAssignmentJoin = `LEFT JOIN LATERAL (
  SELECT sca.school_class_id,sca.section,sca.academic_session_id,sca.academic_term_id
    FROM student_class_assignments sca
   WHERE sca.student_id=e.student_id AND sca.school_id=e.school_id
     AND (e.school_class_id IS NULL OR sca.school_class_id=e.school_class_id)
     AND (e.academic_session_id IS NULL OR sca.academic_session_id=e.academic_session_id)
     AND (e.academic_term_id IS NULL OR sca.academic_term_id=e.academic_term_id)
     AND sca.status IN ('ACTIVE','INACTIVE')
     AND sca.created_at<=e.occurred_at
     AND (sca.start_date IS NULL OR sca.start_date<=e.event_date)
     AND (sca.end_date IS NULL OR sca.end_date>=e.event_date)
   ORDER BY sca.start_date DESC NULLS LAST,sca.id DESC
   LIMIT 1
) sca ON e.student_id IS NOT NULL`;

function teacherAttendanceScope(userParam: string) {
  return `EXISTS (
    SELECT 1
      FROM teacher_class_assignments ta
      JOIN employees te ON te.id=ta.employee_id AND te.school_id=ta.school_id
     WHERE ta.school_id=e.school_id
       AND ta.school_class_id=COALESCE(e.school_class_id,sca.school_class_id)
       AND ta.academic_session_id=COALESCE(e.academic_session_id,sca.academic_session_id)
       AND ta.status='ACTIVE' AND te.user_id=${userParam}
       AND ta.assignment_type IN ('CLASS_TEACHER','SUBJECT_TEACHER')
       AND (ta.section IS NULL OR ta.section='' OR ta.section=COALESCE(e.section_snapshot,sca.section,''))
       AND (ta.start_date IS NULL OR ta.start_date<=e.event_date)
       AND (ta.end_date IS NULL OR ta.end_date>=e.event_date)
  )`;
}

function teacherAcademicScope(alias: string, userParam: string) {
  return `(
    EXISTS (
      SELECT 1 FROM teacher_class_assignments ta
      JOIN employees te ON te.id=ta.employee_id AND te.school_id=ta.school_id
      WHERE ta.school_id=${alias}.school_id AND ta.school_class_id=${alias}.school_class_id
        AND ta.academic_session_id=${alias}.academic_session_id
        AND ta.status='ACTIVE' AND te.user_id=${userParam}
        AND (ta.section='' OR ta.section=${alias}.section_snapshot)
        AND (ta.assignment_type='CLASS_TEACHER'
          OR (ta.assignment_type='SUBJECT_TEACHER' AND ta.subject_id=${alias}.subject_id))
      )
    OR EXISTS (
      SELECT 1 FROM class_subjects cs
      JOIN employees ce ON ce.id=cs.employee_id AND ce.school_id=cs.school_id
      WHERE cs.school_id=${alias}.school_id AND cs.school_class_id=${alias}.school_class_id
        AND cs.academic_session_id=${alias}.academic_session_id
        AND (cs.academic_term_id IS NULL OR cs.academic_term_id=${alias}.academic_term_id)
        AND cs.subject_id=${alias}.subject_id AND cs.status='ACTIVE'
        AND ce.user_id=${userParam}
        AND (cs.section IS NULL OR cs.section=${alias}.section_snapshot)
      )
  )`;
}

async function runQuery(spec: QuerySpec, filters: ReportFilters): Promise<ReportResult> {
  const where = spec.where.join(" AND ");
  const count = await pool.query(
    spec.countSql ??
      `SELECT COUNT(*)::int AS total FROM ${spec.countFrom ?? spec.from} WHERE ${where}`,
    spec.values,
  );
  const limitPosition = spec.values.length + 1;
  const offsetPosition = spec.values.length + 2;
  const rows = await pool.query(
    `SELECT ${spec.select} FROM ${spec.from} WHERE ${where}
     ${spec.groupBy ? `GROUP BY ${spec.groupBy}` : ""}
     ORDER BY ${spec.orderBy} LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    [...spec.values, filters.limit, filters.offset],
  );
  return {
    title: spec.title,
    columns: spec.columns,
    rows: rows.rows,
    total: Number(count.rows[0]?.total ?? 0),
  };
}

function attendanceEvents(context: ReportContext, filters: ReportFilters, title: string): Promise<ReportResult> {
  const query = base(context, "e");
  addDateFilters(query, "e.event_date", filters);
  addContextFilters(query, {
    session: "COALESCE(e.academic_session_id,sca.academic_session_id)",
    term: "COALESCE(e.academic_term_id,sca.academic_term_id)",
    class: "COALESCE(e.school_class_id,sca.school_class_id)",
    section: "COALESCE(e.section_snapshot,sca.section)",
    student: "e.student_id",
    status: "e.attendance_status",
  }, filters);
  if (filters.method !== undefined) addFilter(query, "e.identification_method", filters.method.toUpperCase());
  addFamilyScope(query, context, "e");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAttendanceScope(`$${query.values.length}`));
  }
  const family = context.role === "PARENT" || context.role === "STUDENT";
  return runQuery({
    title,
    columns: family ? eventColumns : [
      ...eventColumns,
      { key: "identificationMethod", label: "Method" },
      { key: "result", label: "Processing result" },
    ],
    from: `attendance_events e
      ${attendanceAssignmentJoin}
      LEFT JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
      LEFT JOIN employees emp ON emp.id=e.employee_id AND emp.school_id=e.school_id`,
    select: `e.event_date AS "eventDate",
      CASE WHEN e.student_id IS NOT NULL
        THEN CONCAT_WS(' ',st.first_name,st.last_name)
        ELSE CONCAT_WS(' ',emp.first_name,emp.last_name) END AS student,
      e.event_type AS "eventType",e.attendance_status AS status,e.occurred_at AS "occurredAt"
      ${family ? "" : `,e.identification_method AS "identificationMethod",e.result`}`,
    where: query.where,
    values: query.values,
    orderBy: "e.occurred_at DESC,e.id DESC",
  }, filters);
}

async function attendanceDiscrepancies(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "d");
  addDateFilters(query, "COALESCE(e.event_date,d.created_at::date)", filters);
  addContextFilters(query, {
    session: "COALESCE(e.academic_session_id,sca.academic_session_id)",
    term: "COALESCE(e.academic_term_id,sca.academic_term_id)",
    class: "COALESCE(e.school_class_id,sca.school_class_id)",
    section: "COALESCE(e.section_snapshot,sca.section)",
    student: "d.student_id",
    status: "d.status",
  }, filters);
  addFamilyScope(query, context, "d");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAttendanceScope(`$${query.values.length}`));
    query.where.push("e.student_id=d.student_id");
  }
  const family = context.role === "PARENT" || context.role === "STUDENT";
  return runQuery({
    title: "Attendance discrepancies",
    columns: [
      { key: "date", label: "Date" },
      { key: "student", label: "Student" },
      { key: "type", label: "Discrepancy" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Detected at" },
    ],
    from: `attendance_discrepancies d
      JOIN students st ON st.id=d.student_id AND st.school_id=d.school_id
      LEFT JOIN attendance_events e ON e.id=d.attendance_event_id AND e.school_id=d.school_id
      ${attendanceAssignmentJoin}`,
    select: `COALESCE(e.event_date,d.created_at::date) AS date,
      CONCAT_WS(' ',st.first_name,st.last_name) AS student,
      d.discrepancy_type AS type,d.status,d.created_at AS "createdAt"`,
    where: query.where,
    values: query.values,
    orderBy: "d.created_at DESC,d.id DESC",
  }, filters);
}

async function attendanceHistory(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "c");
  addDateFilters(query, "c.created_at::date", filters);
  addContextFilters(query, {
    session: "COALESCE(e.academic_session_id,sca.academic_session_id)",
    term: "COALESCE(e.academic_term_id,sca.academic_term_id)",
    class: "COALESCE(e.school_class_id,sca.school_class_id)",
    section: "COALESCE(e.section_snapshot,sca.section)",
    student: "e.student_id",
    status: "c.corrected_value->>'status'",
  }, filters);
  addFamilyScope(query, context, "e");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAttendanceScope(`$${query.values.length}`));
  }
  return runQuery({
    title: "Attendance correction history",
    columns: [
      { key: "date", label: "Corrected at" },
      { key: "student", label: "Student" },
      { key: "eventType", label: "Attendance event" },
      { key: "previousStatus", label: "Previous status" },
      { key: "correctedStatus", label: "Corrected status" },
    ],
    from: `attendance_corrections c
      JOIN attendance_events e
        ON e.id=c.attendance_event_id AND e.school_id=c.school_id
      ${attendanceAssignmentJoin}
      JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id`,
    select: `c.created_at AS date,CONCAT_WS(' ',st.first_name,st.last_name) AS student,
      e.event_type AS "eventType",c.original_value->>'status' AS "previousStatus",
      c.corrected_value->>'status' AS "correctedStatus"`,
    where: query.where,
    values: query.values,
    orderBy: "c.created_at DESC,c.id DESC",
  }, filters);
}

async function academicResults(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "r");
  addDateFilters(query, "a.assessment_date", filters);
  addContextFilters(query, {
    session: "r.academic_session_id",
    term: "r.academic_term_id",
    class: "r.school_class_id",
    section: "r.section_snapshot",
    subject: "r.subject_id",
    student: "r.student_id",
    status: "r.status",
  }, filters);
  addFamilyScope(query, context, "r");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAcademicScope("r", `$${query.values.length}`));
  }
  if (context.role === "PARENT" || context.role === "STUDENT") {
    query.where.push("r.status='PUBLISHED'");
  }
  return runQuery({
    title: "Academic results",
    columns: [
      { key: "assessment", label: "Assessment" },
      { key: "student", label: "Student" },
      { key: "session", label: "Session" },
      { key: "term", label: "Term" },
      { key: "class", label: "Class" },
      { key: "section", label: "Section" },
      { key: "subject", label: "Subject" },
      { key: "score", label: "Score" },
      { key: "maxScore", label: "Maximum score" },
      { key: "grade", label: "Grade" },
      { key: "status", label: "Publication status" },
      { key: "publishedAt", label: "Published at" },
    ],
    from: `academic_results r
      JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id
      JOIN students st ON st.id=r.student_id AND st.school_id=r.school_id
      JOIN academic_sessions ses ON ses.id=r.academic_session_id AND ses.school_id=r.school_id
      JOIN academic_terms trm ON trm.id=r.academic_term_id AND trm.school_id=r.school_id
      JOIN school_classes cl ON cl.id=r.school_class_id AND cl.school_id=r.school_id
      JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id`,
    select: `a.title AS assessment,CONCAT_WS(' ',st.first_name,st.last_name) AS student,
      ses.name AS session,trm.name AS term,cl.name AS class,r.section_snapshot AS section,
      sub.name AS subject,r.score,r.max_score AS "maxScore",r.grade,r.status,
      r.published_at AS "publishedAt"`,
    where: query.where,
    values: query.values,
    orderBy: "r.academic_session_id DESC,r.academic_term_id DESC,r.id",
  }, filters);
}

async function academicAssessments(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "a");
  addDateFilters(query, "a.assessment_date", filters);
  addContextFilters(query, {
    session: "a.academic_session_id",
    term: "a.academic_term_id",
    class: "a.school_class_id",
    section: "a.section",
    subject: "a.subject_id",
    status: "a.status",
  }, filters);
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(`(
      EXISTS (
        SELECT 1 FROM teacher_class_assignments ta
        JOIN employees te ON te.id=ta.employee_id AND te.school_id=ta.school_id
        WHERE ta.school_id=a.school_id AND ta.school_class_id=a.school_class_id
          AND ta.academic_session_id=a.academic_session_id AND ta.status='ACTIVE'
          AND te.user_id=$${query.values.length}
          AND (ta.section='' OR ta.section=a.section)
          AND (ta.assignment_type='CLASS_TEACHER'
            OR (ta.assignment_type='SUBJECT_TEACHER' AND ta.subject_id=a.subject_id))
          AND (ta.start_date IS NULL OR ta.start_date<=a.assessment_date)
          AND (ta.end_date IS NULL OR ta.end_date>=a.assessment_date)
      ) OR EXISTS (
        SELECT 1 FROM class_subjects cs
        JOIN employees ce ON ce.id=cs.employee_id AND ce.school_id=cs.school_id
        WHERE cs.school_id=a.school_id AND cs.school_class_id=a.school_class_id
          AND cs.academic_session_id=a.academic_session_id
          AND (cs.academic_term_id IS NULL OR cs.academic_term_id=a.academic_term_id)
          AND cs.subject_id=a.subject_id AND cs.status='ACTIVE' AND ce.user_id=$${query.values.length}
          AND (cs.section IS NULL OR cs.section=a.section)
      )
    )`);
  }
  return runQuery({
    title: "Academic assessments",
    columns: [
      { key: "title", label: "Assessment" },
      { key: "type", label: "Type" },
      { key: "session", label: "Session" },
      { key: "term", label: "Term" },
      { key: "class", label: "Class" },
      { key: "section", label: "Section" },
      { key: "subject", label: "Subject" },
      { key: "teacher", label: "Teacher" },
      { key: "assessmentDate", label: "Assessment date" },
      { key: "maxScore", label: "Maximum score" },
      { key: "status", label: "Status" },
    ],
    from: `academic_assessments a
      JOIN academic_sessions ses ON ses.id=a.academic_session_id AND ses.school_id=a.school_id
      JOIN academic_terms trm ON trm.id=a.academic_term_id AND trm.school_id=a.school_id
      JOIN school_classes cl ON cl.id=a.school_class_id AND cl.school_id=a.school_id
      JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=a.school_id
      JOIN academic_assessment_types typ ON typ.id=a.assessment_type_id AND typ.school_id=a.school_id
      JOIN employees emp ON emp.id=a.teacher_employee_id AND emp.school_id=a.school_id`,
    select: `a.title,typ.name AS type,ses.name AS session,trm.name AS term,cl.name AS class,
      a.section,sub.name AS subject,CONCAT_WS(' ',emp.first_name,emp.last_name) AS teacher,
      a.assessment_date AS "assessmentDate",a.max_score AS "maxScore",a.status`,
    where: query.where,
    values: query.values,
    orderBy: "a.assessment_date DESC,a.id DESC",
  }, filters);
}

function teacherClassScope(alias: string, userParam: string, sectionExpression = `${alias}.section`) {
  return `EXISTS (
    SELECT 1 FROM teacher_class_assignments ta
    JOIN employees te ON te.id=ta.employee_id AND te.school_id=ta.school_id
    WHERE ta.school_id=${alias}.school_id AND ta.school_class_id=${alias}.school_class_id
      AND ta.academic_session_id=${alias}.academic_session_id
      AND ta.status='ACTIVE' AND ta.assignment_type='CLASS_TEACHER'
      AND te.user_id=${userParam}
      AND (ta.section='' OR ta.section=${sectionExpression})
  )`;
}

async function academicTimetable(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "tt");
  addContextFilters(query, {
    session: "tt.academic_session_id",
    term: "tt.academic_term_id",
    class: "tt.school_class_id",
    section: "tt.section",
    subject: "tt.subject_id",
    status: "tt.status",
  }, filters);
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    const userParam = `$${query.values.length}`;
    query.where.push(`(
      EXISTS (
        SELECT 1 FROM teacher_class_assignments ta
        JOIN employees te ON te.id=ta.employee_id AND te.school_id=ta.school_id
        WHERE ta.school_id=tt.school_id AND ta.school_class_id=tt.school_class_id
          AND ta.academic_session_id=tt.academic_session_id AND ta.status='ACTIVE'
          AND te.user_id=${userParam}
          AND (ta.section='' OR ta.section=tt.section)
          AND (ta.assignment_type='CLASS_TEACHER'
            OR (ta.assignment_type='SUBJECT_TEACHER' AND ta.subject_id=tt.subject_id))
      ) OR EXISTS (
        SELECT 1 FROM class_subjects cs
        JOIN employees ce ON ce.id=cs.employee_id AND ce.school_id=cs.school_id
        WHERE cs.school_id=tt.school_id AND cs.school_class_id=tt.school_class_id
          AND cs.academic_session_id=tt.academic_session_id
          AND (cs.academic_term_id IS NULL OR cs.academic_term_id=tt.academic_term_id)
          AND cs.subject_id=tt.subject_id AND cs.status='ACTIVE' AND ce.user_id=${userParam}
          AND (cs.section IS NULL OR cs.section=tt.section)
      )
    )`);
  }
  return runQuery({
    title: "Academic timetable",
    columns: [
      { key: "session", label: "Session" },
      { key: "term", label: "Term" },
      { key: "class", label: "Class" },
      { key: "section", label: "Section" },
      { key: "subject", label: "Subject" },
      { key: "teacher", label: "Teacher" },
      { key: "weekday", label: "Weekday" },
      { key: "startTime", label: "Starts" },
      { key: "endTime", label: "Ends" },
      { key: "room", label: "Room" },
      { key: "status", label: "Status" },
    ],
    from: `academic_timetable_entries tt
      JOIN academic_sessions ses ON ses.id=tt.academic_session_id AND ses.school_id=tt.school_id
      JOIN academic_terms trm ON trm.id=tt.academic_term_id AND trm.school_id=tt.school_id
      JOIN school_classes cl ON cl.id=tt.school_class_id AND cl.school_id=tt.school_id
      JOIN subjects sub ON sub.id=tt.subject_id AND sub.school_id=tt.school_id
      JOIN employees emp ON emp.id=tt.teacher_employee_id AND emp.school_id=tt.school_id`,
    select: `ses.name AS session,trm.name AS term,cl.name AS class,tt.section,
      sub.name AS subject,CONCAT_WS(' ',emp.first_name,emp.last_name) AS teacher,
      tt.weekday,tt.start_time AS "startTime",tt.end_time AS "endTime",tt.room,tt.status`,
    where: query.where,
    values: query.values,
    orderBy: "tt.academic_session_id DESC,tt.academic_term_id DESC,tt.weekday,tt.start_time",
  }, filters);
}

async function reportCardSummary(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "rc");
  addContextFilters(query, {
    session: "rc.academic_session_id",
    term: "rc.academic_term_id",
    class: "rc.school_class_id",
    section: "rc.section_snapshot",
    student: "rc.student_id",
    status: "rc.status",
  }, filters);
  addFamilyScope(query, context, "rc");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherClassScope("rc", `$${query.values.length}`, "rc.section_snapshot"));
  }
  if (context.role === "PARENT" || context.role === "STUDENT") {
    query.where.push("rc.status='PUBLISHED'");
  }
  return runQuery({
    title: "Report-card summaries",
    columns: [
      { key: "student", label: "Student" },
      { key: "session", label: "Session" },
      { key: "term", label: "Term" },
      { key: "class", label: "Class" },
      { key: "section", label: "Section" },
      { key: "status", label: "Publication status" },
      { key: "publishedAt", label: "Published at" },
      { key: "lineCount", label: "Result lines" },
    ],
    from: `academic_report_cards rc
      JOIN students st ON st.id=rc.student_id AND st.school_id=rc.school_id
      JOIN academic_sessions ses ON ses.id=rc.academic_session_id AND ses.school_id=rc.school_id
      JOIN academic_terms trm ON trm.id=rc.academic_term_id AND trm.school_id=rc.school_id
      JOIN school_classes cl ON cl.id=rc.school_class_id AND cl.school_id=rc.school_id`,
    select: `CONCAT_WS(' ',st.first_name,st.last_name) AS student,ses.name AS session,
      trm.name AS term,COALESCE(rc.class_name_snapshot,cl.name) AS class,
      rc.section_snapshot AS section,rc.status,
      CASE WHEN rc.status='PUBLISHED' THEN rc.published_at ELSE NULL END AS "publishedAt",
      (SELECT COUNT(*)::int FROM academic_report_card_lines line
        WHERE line.report_card_id=rc.id AND line.school_id=rc.school_id) AS "lineCount"`,
    where: query.where,
    values: query.values,
    orderBy: "rc.academic_session_id DESC,rc.academic_term_id DESC,rc.id DESC",
  }, filters);
}

async function gradeDistribution(context: ReportContext, filters: ReportFilters) {
  const query = base(context, "r");
  addDateFilters(query, "a.assessment_date", filters);
  addContextFilters(query, {
    session: "r.academic_session_id",
    term: "r.academic_term_id",
    class: "r.school_class_id",
    section: "r.section_snapshot",
    subject: "r.subject_id",
    student: "r.student_id",
    status: "r.status",
  }, filters);
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAcademicScope("r", `$${query.values.length}`));
  }
  const from = `academic_results r
    JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id
    JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id`;
  const where = query.where.join(" AND ");
  const countSql = `SELECT COUNT(*)::int AS total FROM (
      SELECT r.grade,sub.name FROM ${from} WHERE ${where} GROUP BY r.grade,sub.name
    ) grade_groups`;
  return runQuery({
    title: "Grade distribution",
    columns: [
      { key: "grade", label: "Recorded grade" },
      { key: "subject", label: "Subject" },
      { key: "resultCount", label: "Results" },
    ],
    from,
    select: `r.grade,sub.name AS subject,COUNT(*)::int AS "resultCount"`,
    where: query.where,
    values: query.values,
    orderBy: "r.grade NULLS LAST,sub.name",
    countSql,
    groupBy: "r.grade,sub.name",
  }, filters);
}

async function attendanceAggregate(
  context: ReportContext,
  filters: ReportFilters,
  title: string,
  periodExpression: string,
  periodLabel: string,
) {
  const query = base(context, "e");
  addDateFilters(query, "e.event_date", filters);
  addContextFilters(query, {
    session: "COALESCE(e.academic_session_id,sca.academic_session_id)",
    term: "COALESCE(e.academic_term_id,sca.academic_term_id)",
    class: "COALESCE(e.school_class_id,sca.school_class_id)",
    section: "COALESCE(e.section_snapshot,sca.section)",
    student: "e.student_id",
    status: "e.attendance_status",
  }, filters);
  if (filters.method !== undefined) addFilter(query, "e.identification_method", filters.method.toUpperCase());
  addFamilyScope(query, context, "e");
  if (context.role === "TEACHER") {
    query.values.push(context.userId);
    query.where.push(teacherAttendanceScope(`$${query.values.length}`));
  }
  const from = `attendance_events e
    ${attendanceAssignmentJoin}
    LEFT JOIN academic_terms trm
      ON trm.id=COALESCE(e.academic_term_id,sca.academic_term_id)
     AND trm.school_id=e.school_id`;
  const where = query.where.join(" AND ");
  const groupBy = periodExpression === "trm.name"
    ? "trm.name,COALESCE(e.academic_term_id,sca.academic_term_id),e.event_type,e.attendance_status"
    : `${periodExpression},e.event_type,e.attendance_status`;
  const countSql = `SELECT COUNT(*)::int AS total FROM (
      SELECT ${groupBy} FROM ${from} WHERE ${where} GROUP BY ${groupBy}
    ) event_groups`;
  return runQuery({
    title,
    columns: [
      { key: "period", label: periodLabel },
      ...(periodExpression === "trm.name" ? [{ key: "termId", label: "Term ID" }] : []),
      { key: "eventType", label: "Event" },
      { key: "status", label: "Attendance status" },
      { key: "eventCount", label: "Recorded events" },
    ],
    from,
    select: `${periodExpression} AS period${
      periodExpression === "trm.name"
        ? `,COALESCE(e.academic_term_id,sca.academic_term_id) AS "termId"`
        : ""
    },e.event_type AS "eventType",e.attendance_status AS status,COUNT(*)::int AS "eventCount"`,
    where: query.where,
    values: query.values,
    orderBy: "period DESC NULLS LAST,e.event_type,e.attendance_status",
    countSql,
    groupBy,
  }, filters);
}

async function nfcReport(context: ReportContext, filters: ReportFilters) {
  const values: unknown[] = [
    context.schoolId,
    filters.from ?? null,
    filters.to ?? null,
    filters.status?.toUpperCase() ?? null,
    filters.studentId ?? null,
  ];
  const activity = `WITH report_rows AS (
    SELECT 'CARD'::text AS kind,card.school_id,
      CONCAT_WS(' ',st.first_name,st.last_name) AS student,
      card.status AS status,NULL::text AS event,
      card.issued_at AS "occurredAt",NULL::text AS "deviceType",
      NULL::text AS location,NULL::text AS device
    FROM nfc_cards card
    LEFT JOIN students st ON st.id=card.student_id AND st.school_id=card.school_id
    WHERE ($1::int IS NULL OR card.school_id=$1)
      AND ($2::date IS NULL OR card.issued_at::date >= $2::date)
      AND ($3::date IS NULL OR card.issued_at::date <= $3::date)
      AND ($4::text IS NULL OR UPPER(card.status)=UPPER($4))
      AND ($5::int IS NULL OR card.student_id=$5)
    UNION ALL
    SELECT 'DEVICE'::text AS kind,dev.school_id,NULL::text AS student,
      dev.status,NULL::text AS event,dev.last_seen_at AS "occurredAt",
      dev.device_type AS "deviceType",dev.location,dev.name AS device
    FROM platform_devices dev
    WHERE dev.school_id IS NOT NULL AND ($1::int IS NULL OR dev.school_id=$1)
      AND ($2::date IS NULL OR dev.last_seen_at::date >= $2::date)
      AND ($3::date IS NULL OR dev.last_seen_at::date <= $3::date)
      AND ($4::text IS NULL OR UPPER(dev.status)=UPPER($4))
      AND $5::int IS NULL
    UNION ALL
    SELECT 'ATTENDANCE'::text AS kind,e.school_id,
      CONCAT_WS(' ',st.first_name,st.last_name) AS student,
      e.attendance_status AS status,e.event_type AS event,e.occurred_at AS "occurredAt",
      NULL::text AS "deviceType",event_binding.location,NULL::text AS device
    FROM attendance_events e
    LEFT JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
    LEFT JOIN LATERAL (
      SELECT dah.location
        FROM device_assignment_history dah
       WHERE dah.device_id=e.device_id AND dah.new_school_id=e.school_id
         AND dah.created_at<=e.occurred_at
       ORDER BY dah.created_at DESC,dah.id DESC
       LIMIT 1
    ) event_binding ON true
    WHERE ($1::int IS NULL OR e.school_id=$1)
      AND ($2::date IS NULL OR e.event_date >= $2::date)
      AND ($3::date IS NULL OR e.event_date <= $3::date)
      AND ($4::text IS NULL OR UPPER(e.attendance_status)=UPPER($4))
      AND ($5::int IS NULL OR e.student_id=$5)
      AND e.device_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM device_school_bindings binding
         WHERE binding.device_id=e.device_id AND binding.school_id=e.school_id
      )
  )`;
  const reportColumns = [
    { key: "kind", label: "Record type" },
    { key: "student", label: "Student" },
    { key: "status", label: "Status" },
    { key: "event", label: "Attendance event" },
    { key: "occurredAt", label: "Date / last activity" },
    { key: "deviceType", label: "Device type" },
    { key: "location", label: "Location" },
    { key: "device", label: "Device" },
  ];
  const count = await pool.query(
    `${activity} SELECT COUNT(*)::int AS total FROM report_rows`,
    values,
  );
  const rows = await pool.query(
    `${activity}
     SELECT kind,student,status,event,"occurredAt","deviceType",location,device
       FROM report_rows
      ORDER BY "occurredAt" DESC NULLS LAST,kind
      LIMIT $6 OFFSET $7`,
    [...values, filters.limit, filters.offset],
  );
  return {
    title: "NFC and device activity",
    columns: reportColumns,
    rows: rows.rows,
    total: Number(count.rows[0]?.total ?? 0),
  };
}

export const learningReports: Record<string, ReportDefinition> = {
  attendance: {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
    run: (context, filters) => attendanceEvents(context, filters, "Attendance"),
  },
  "attendance-history": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "limit", "offset"],
    run: attendanceHistory,
  },
  "attendance-daily": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
    run: (context, filters) =>
      attendanceAggregate(context, filters, "Daily attendance event totals", "e.event_date", "Date"),
  },
  "attendance-weekly": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
    run: (context, filters) =>
      attendanceAggregate(context, filters, "Weekly attendance event totals", "date_trunc('week',e.event_date)::date", "Week starting"),
  },
  "attendance-monthly": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
    run: (context, filters) =>
      attendanceAggregate(context, filters, "Monthly attendance event totals", "date_trunc('month',e.event_date)::date", "Month"),
  },
  "attendance-term": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "method", "limit", "offset"],
    run: (context, filters) =>
      attendanceAggregate(context, filters, "Term attendance event totals", "trm.name", "Term"),
  },
  "attendance-discrepancies": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "studentId", "status", "limit", "offset"],
    run: attendanceDiscrepancies,
  },
  academics: {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "subjectId", "studentId", "status", "limit", "offset"],
    run: academicResults,
  },
  "academic-results": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "subjectId", "studentId", "status", "limit", "offset"],
    run: academicResults,
  },
  "academic-assessments": {
    roles: ["OWNER", "ADMIN", "TEACHER"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "subjectId", "status", "limit", "offset"],
    run: academicAssessments,
  },
  timetable: {
    roles: ["OWNER", "ADMIN", "TEACHER"],
    filters: ["schoolId", "sessionId", "termId", "classId", "section", "subjectId", "status", "limit", "offset"],
    run: academicTimetable,
  },
  "report-card-summary": {
    roles: ["OWNER", "ADMIN", "TEACHER", "PARENT", "STUDENT"],
    filters: ["schoolId", "sessionId", "termId", "classId", "section", "studentId", "status", "limit", "offset"],
    run: reportCardSummary,
  },
  "grade-distribution": {
    roles: ["OWNER", "ADMIN", "TEACHER"],
    filters: ["schoolId", "from", "to", "sessionId", "termId", "classId", "section", "subjectId", "studentId", "status", "limit", "offset"],
    run: gradeDistribution,
  },
  nfc: {
    roles: ["OWNER", "ADMIN"],
    filters: ["schoolId", "from", "to", "studentId", "status", "limit", "offset"],
    run: nfcReport,
  },
};