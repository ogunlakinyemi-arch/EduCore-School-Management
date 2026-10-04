import { AuthError } from "../middlewares/auth";

// Executed only after the unchanged authoritative save predicate rejects a
// selection. Each existence check is scoped to the already-authorized school;
// messages never reveal whether an ID exists in some other tenant.
export const timetableSelectionDiagnosticsSql = `
SELECT
  EXISTS(SELECT 1 FROM school_classes WHERE id=$4 AND school_id=$1) AS class_valid,
  EXISTS(SELECT 1 FROM academic_sessions WHERE id=$2 AND school_id=$1) AS session_valid,
  EXISTS(SELECT 1 FROM academic_terms WHERE id=$3 AND school_id=$1 AND academic_session_id=$2) AS term_valid,
  EXISTS(SELECT 1 FROM subjects WHERE id=$5 AND school_id=$1) AS subject_valid,
  EXISTS(SELECT 1 FROM employees WHERE id=$6 AND school_id=$1) AS teacher_valid,
  EXISTS(SELECT 1 FROM class_subjects cs
    WHERE cs.school_id=$1 AND cs.school_class_id=$4 AND cs.subject_id=$5 AND cs.academic_session_id=$2
      AND (cs.academic_term_id IS NULL OR cs.academic_term_id IS NOT DISTINCT FROM $3)
      AND (cs.section IS NULL OR cs.section='' OR cs.section=$7)
      AND UPPER(cs.status)='ACTIVE') AS subject_assignment_valid,
  EXISTS(SELECT 1 FROM class_subjects cs
    WHERE cs.school_id=$1 AND cs.school_class_id=$4 AND cs.subject_id=$5 AND cs.academic_session_id=$2
      AND (cs.academic_term_id IS NULL OR cs.academic_term_id IS NOT DISTINCT FROM $3)
      AND (cs.section IS NULL OR cs.section='' OR cs.section=$7)
      AND (cs.employee_id IS NULL OR cs.employee_id=$6) AND UPPER(cs.status)='ACTIVE')
  AND EXISTS(SELECT 1 FROM teacher_class_assignments ta
    JOIN academic_sessions ac ON ac.id=ta.academic_session_id AND ac.school_id=ta.school_id
    WHERE ta.school_id=$1 AND ta.employee_id=$6 AND ta.school_class_id=$4 AND ta.academic_session_id=$2
      AND (ta.section='' OR ta.section=$7)
      AND (ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=$5)
      AND ta.status='ACTIVE' AND ta.start_date<=COALESCE(ac.end_date,CURRENT_DATE)
      AND (ta.end_date IS NULL OR ta.end_date>=ac.start_date)) AS teacher_assignment_valid`;

export async function timetableSelectionError(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rows: Record<string, boolean>[] }> },
  values: { schoolId: number; sessionId: number; termId: number; classId: number; subjectId: number; teacherId: number; section: string },
) {
  const { rows } = await client.query(timetableSelectionDiagnosticsSql,
    [values.schoolId, values.sessionId, values.termId, values.classId, values.subjectId, values.teacherId, values.section]);
  const checks: [string, string][] = [
    ["class_valid", "Selected class/section is not available in this school."],
    ["session_valid", "Selected session is not available in this school."],
    ["term_valid", "Selected term does not belong to this school and session."],
    ["subject_valid", "Selected subject is not available in this school."],
    ["teacher_valid", "Selected teacher is not available in this school."],
    ["subject_assignment_valid", "Selected subject is not assigned to this class/section for the selected session and term."],
    ["teacher_assignment_valid", "Selected teacher is not assigned to this subject/class in the selected session."],
  ];
  return new AuthError(404, checks.find(([key]) => rows[0]?.[key] === false)?.[1]
    ?? "Selected timetable assignment is no longer available. Reload the choices and try again.");
}