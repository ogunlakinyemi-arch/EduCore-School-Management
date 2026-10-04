// Timetable only: do not modify academic enrollment or staffing records.
// $1 school, $2 session, $3 term, $4 class, $5 subject, $6 teacher, $7 section.
export function timetableSubjectScopeSql(forTeacher: boolean) {
  return `(
    EXISTS(SELECT 1 FROM class_subjects cs
      WHERE cs.school_id=$1 AND cs.academic_session_id=$2
        AND cs.school_class_id=$4 AND cs.subject_id=$5
        AND (cs.academic_term_id IS NULL OR cs.academic_term_id=$3)
        AND (cs.section IS NULL OR cs.section='' OR cs.section=$7)
        ${forTeacher ? "AND (cs.employee_id IS NULL OR cs.employee_id=$6)" : ""}
        AND UPPER(cs.status)='ACTIVE')
    OR (
      NOT EXISTS(SELECT 1 FROM class_subjects existing
        WHERE existing.school_id=$1 AND existing.academic_session_id=$2
          AND existing.school_class_id=$4 AND existing.subject_id=$5)
      AND EXISTS(SELECT 1 FROM teacher_class_assignments assigned
        JOIN academic_sessions scope ON scope.id=assigned.academic_session_id AND scope.school_id=assigned.school_id
        WHERE assigned.school_id=$1 AND assigned.academic_session_id=$2
          AND assigned.school_class_id=$4 AND assigned.subject_id=$5
          AND assigned.assignment_type='SUBJECT_TEACHER' AND assigned.status='ACTIVE'
          ${forTeacher ? "AND assigned.employee_id=$6" : ""}
          AND (assigned.section='' OR assigned.section=$7)
          AND assigned.start_date<=COALESCE(scope.end_date,CURRENT_DATE)
          AND (assigned.end_date IS NULL OR assigned.end_date>=scope.start_date))
    )
  )`;
}

export const timetableTeacherScopeSql = `EXISTS(SELECT 1 FROM teacher_class_assignments ta
  JOIN academic_sessions ac ON ac.id=ta.academic_session_id AND ac.school_id=ta.school_id
  WHERE ta.school_id=$1 AND ta.employee_id=$6 AND ta.school_class_id=$4 AND ta.academic_session_id=$2
    AND (ta.section='' OR ta.section=$7)
    AND (ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=$5)
    AND ta.status='ACTIVE' AND ta.start_date<=COALESCE(ac.end_date,CURRENT_DATE)
    AND (ta.end_date IS NULL OR ta.end_date>=ac.start_date))`;

export const timetableSelectionSql = `SELECT c.id FROM school_classes c
  JOIN academic_sessions ac ON ac.id=$2 AND ac.school_id=c.school_id
  JOIN academic_terms t ON t.id=$3 AND t.school_id=c.school_id AND t.academic_session_id=ac.id
  JOIN subjects sub ON sub.id=$5 AND sub.school_id=c.school_id
  JOIN employees e ON e.id=$6 AND e.school_id=c.school_id
  WHERE c.id=$4 AND c.school_id=$1
    AND UPPER(e.employee_type)='TEACHER' AND UPPER(e.employment_status)='ACTIVE'
    AND ${timetableSubjectScopeSql(true)}
    AND ${timetableTeacherScopeSql}`;