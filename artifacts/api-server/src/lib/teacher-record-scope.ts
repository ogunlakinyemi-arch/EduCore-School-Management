import { getUserContext } from "../middlewares/auth";

export function teacherScoped(context: ReturnType<typeof getUserContext>, schoolId: number) {
  const active = context.roles.filter(r => r.status === "ACTIVE");
  return active.some(r => r.role === "TEACHER" && r.schoolId === schoolId)
    && !active.some(r => (r.role === "PLATFORM_OWNER" && r.schoolId === null)
      || (r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId));
}

/** Current explicit assignments, never display names or caller-supplied employee IDs. */
export function teacherClassScope(classAlias: string, actor: string) {
  return `EXISTS (SELECT 1 FROM teacher_class_assignments authorized_ta
    JOIN employees authorized_e ON authorized_e.id=authorized_ta.employee_id
      AND authorized_e.school_id=authorized_ta.school_id
    JOIN academic_sessions authorized_session ON authorized_session.id=authorized_ta.academic_session_id
      AND authorized_session.school_id=authorized_ta.school_id
    WHERE authorized_ta.school_id=${classAlias}.school_id
      AND authorized_ta.school_class_id=${classAlias}.id AND authorized_e.user_id=${actor}
      AND authorized_e.employee_type='TEACHER' AND authorized_e.employment_status='ACTIVE'
      AND authorized_session.status='ACTIVE' AND authorized_session.is_current
      AND authorized_ta.status='ACTIVE'
      AND (authorized_ta.start_date IS NULL OR authorized_ta.start_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date)
      AND (authorized_ta.end_date IS NULL OR authorized_ta.end_date>=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date)
      AND (NULLIF(authorized_ta.section,'') IS NULL OR authorized_ta.section=${classAlias}.section))`;
}

export function teacherStudentScope(studentAlias: string, actor: string, classId?: string) {
  return `EXISTS (SELECT 1 FROM student_class_assignments authorized_sa
    JOIN school_classes authorized_c ON authorized_c.id=authorized_sa.school_class_id
      AND authorized_c.school_id=authorized_sa.school_id
    JOIN academic_sessions student_session ON student_session.id=authorized_sa.academic_session_id
      AND student_session.school_id=authorized_sa.school_id
    WHERE authorized_sa.school_id=${studentAlias}.school_id AND authorized_sa.student_id=${studentAlias}.id
      AND authorized_sa.status='ACTIVE' AND authorized_sa.is_current
      AND student_session.status='ACTIVE' AND student_session.is_current
      AND (authorized_sa.start_date IS NULL OR authorized_sa.start_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date)
      AND (authorized_sa.end_date IS NULL OR authorized_sa.end_date>=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date)
      AND authorized_sa.section=authorized_c.section
      ${classId ? `AND authorized_c.id=${classId}` : ""}
      AND ${teacherClassScope("authorized_c", actor)})`;
}
