import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";

export const linkedChildAcademicSql = `
SELECT st.id AS "studentId",st.school_id AS "schoolId",st.class_name,st.section
FROM parents p
JOIN parent_student_relationships r ON r.parent_id=p.id AND UPPER(r.status)='ACTIVE'
JOIN students st ON st.id=r.student_id AND st.school_id=p.school_id
WHERE p.user_id=$1 AND UPPER(p.status)='ACTIVE' AND st.id=$2`;

export const currentChildPlacementSql = `
SELECT ac.id AS "sessionId",ac.name AS "sessionName",at.id AS "termId",at.name AS "termName",
       c.id AS "classId",c.name AS "className",
       CASE WHEN a.id IS NOT NULL THEN COALESCE(a.section,c.section,'')
         ELSE COALESCE(st.section,c.section,'') END AS section
FROM students st
JOIN academic_sessions ac ON ac.school_id=st.school_id AND ac.is_current=true AND ac.status='ACTIVE'
JOIN academic_terms at ON at.school_id=ac.school_id AND at.academic_session_id=ac.id
  AND at.status='ACTIVE' AND (at.is_current=true OR (
    NOT EXISTS(SELECT 1 FROM academic_terms marked WHERE marked.school_id=ac.school_id
      AND marked.academic_session_id=ac.id AND marked.is_current=true AND marked.status='ACTIVE')
    AND CURRENT_DATE BETWEEN at.start_date AND at.end_date
  ))
LEFT JOIN student_class_assignments a ON a.student_id=st.id AND a.school_id=st.school_id
  AND a.academic_session_id=ac.id AND a.is_current=true AND UPPER(a.status)='ACTIVE'
  AND (a.academic_term_id=at.id OR a.academic_term_id IS NULL)
JOIN school_classes c ON c.school_id=st.school_id AND (
  c.id=a.school_class_id OR (
    a.id IS NULL
    AND NOT EXISTS(SELECT 1 FROM student_class_assignments history
      WHERE history.student_id=st.id AND history.school_id=st.school_id)
    AND c.name=st.class_name AND COALESCE(c.section,'')=COALESCE(st.section,'')
  ))
WHERE st.id=$1 AND st.school_id=$2 AND UPPER(st.status)='ACTIVE'`;

export const currentClassTeacherSql = `
SELECT e.id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS name
FROM teacher_class_assignments t
JOIN employees e ON e.id=t.employee_id AND e.school_id=t.school_id
  AND UPPER(e.employment_status)='ACTIVE' AND UPPER(e.employee_type)='TEACHER'
WHERE t.school_id=$1 AND t.academic_session_id=$2 AND t.school_class_id=$3
  AND (t.section IS NULL OR t.section=$4) AND t.assignment_type='CLASS_TEACHER'
  AND UPPER(t.status)='ACTIVE' AND t.start_date<=CURRENT_DATE
  AND (t.end_date IS NULL OR t.end_date>=CURRENT_DATE)
ORDER BY t.id`;

export async function parentChildAcademicContext(parentUserId:number,studentId:number,schoolId?:number) {
  const children=(await pool.query(linkedChildAcademicSql,[parentUserId,studentId])).rows;
  const child=children[0];
  if(children.length!==1 || (schoolId!==undefined && child.schoolId!==schoolId))
    throw new AuthError(404,"Student not found");
  const placements=(await pool.query(currentChildPlacementSql,[studentId,child.schoolId])).rows;
  if(placements.length>1) throw new AuthError(409,"Current child enrollment is ambiguous");
  const enrollment=placements[0]??null;
  let classTeacher=null;
  if(enrollment) {
    const teachers=(await pool.query(currentClassTeacherSql,
      [child.schoolId,enrollment.sessionId,enrollment.classId,enrollment.section])).rows;
    const distinct=[...new Map(teachers.map(t=>[t.employeeId,t])).values()];
    if(distinct.length>1) throw new AuthError(409,"Current class teacher assignment is ambiguous");
    classTeacher=distinct[0]??null;
  }
  return {studentId,schoolId:child.schoolId,enrollment,classTeacher};
}