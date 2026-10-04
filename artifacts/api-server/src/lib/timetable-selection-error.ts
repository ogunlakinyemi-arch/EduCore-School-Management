import { AuthError } from "../middlewares/auth";
import { timetableSubjectScopeSql, timetableTeacherScopeSql } from "./timetable-selection-sql";

// Executed only after the authoritative save predicate rejects a
// selection. Each existence check is scoped to the already-authorized school;
// messages never reveal whether an ID exists in some other tenant.
export const timetableSelectionDiagnosticsSql = `
SELECT
  EXISTS(SELECT 1 FROM school_classes WHERE id=$4 AND school_id=$1) AS class_valid,
  EXISTS(SELECT 1 FROM academic_sessions WHERE id=$2 AND school_id=$1) AS session_valid,
  EXISTS(SELECT 1 FROM academic_terms WHERE id=$3 AND school_id=$1 AND academic_session_id=$2) AS term_valid,
  EXISTS(SELECT 1 FROM subjects WHERE id=$5 AND school_id=$1) AS subject_valid,
  EXISTS(SELECT 1 FROM employees WHERE id=$6 AND school_id=$1) AS teacher_valid,
  EXISTS(SELECT 1 FROM employees WHERE id=$6 AND school_id=$1
    AND UPPER(employee_type)='TEACHER' AND UPPER(employment_status)='ACTIVE') AS teacher_active,
  ${timetableSubjectScopeSql(false)} AS subject_assignment_valid,
  (${timetableSubjectScopeSql(true)} AND ${timetableTeacherScopeSql}) AS teacher_assignment_valid`;

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
    ["teacher_active", "Selected employee is not an active teacher in this school."],
    ["subject_assignment_valid", "Selected subject is not assigned to this class/section for the selected session and term."],
    ["teacher_assignment_valid", "Selected teacher is not assigned to this subject/class in the selected session."],
  ];
  return new AuthError(404, checks.find(([key]) => rows[0]?.[key] === false)?.[1]
    ?? "Selected timetable assignment is no longer available. Reload the choices and try again.");
}