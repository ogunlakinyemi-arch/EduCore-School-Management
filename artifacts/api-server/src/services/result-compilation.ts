import { AuthError } from "../middlewares/auth";

export type PeriodContext = { schoolId: number; sessionId: number; termId: number; classId?: number; section?: string; studentId?: number };
export async function periodStudents(client: any, scope: PeriodContext) {
  const period = await client.query(`SELECT t.id FROM academic_terms t JOIN academic_sessions s
    ON s.id=t.academic_session_id AND s.school_id=t.school_id WHERE t.id=$3 AND s.id=$2 AND t.school_id=$1`,
    [scope.schoolId,scope.sessionId,scope.termId]);
  if (!period.rows.length) throw new AuthError(404,"Academic session/term not found in this school");
  const roster = await client.query(`WITH chosen AS (
    SELECT DISTINCT ON (sca.student_id) sca.* FROM student_class_assignments sca
    WHERE sca.school_id=$1 AND sca.academic_session_id=$2 AND (sca.academic_term_id=$3 OR sca.academic_term_id IS NULL)
      AND sca.status IN ('ACTIVE','INACTIVE')
    ORDER BY sca.student_id,(sca.academic_term_id=$3) DESC NULLS LAST,sca.id DESC)
    SELECT st.id,st.first_name AS "firstName",st.last_name AS "lastName",st.admission_no AS "admissionNo",
      sca.school_class_id AS "classId",c.name AS "className",sca.section,sca.id AS "studentClassAssignmentId"
    FROM chosen sca JOIN students st ON st.id=sca.student_id AND st.school_id=sca.school_id
    JOIN school_classes c ON c.id=sca.school_class_id AND c.school_id=sca.school_id
    WHERE ($4::int IS NULL OR sca.school_class_id=$4) AND ($5::text IS NULL OR sca.section=$5)
      AND ($6::int IS NULL OR st.id=$6) ORDER BY st.last_name,st.first_name,st.id`,
    [scope.schoolId,scope.sessionId,scope.termId,scope.classId ?? null,scope.section ?? null,scope.studentId ?? null]);
  return roster.rows;
}

export async function compileStudent(client: any, scope: PeriodContext, student: any) {
  const expected = await client.query(`WITH configured AS (SELECT DISTINCT ON (cs.subject_id) cs.subject_id AS "subjectId",
    sub.name AS "subjectName",concat_ws(' ',e.first_name,e.last_name) AS "teacherName"
    FROM class_subjects cs JOIN subjects sub ON sub.id=cs.subject_id AND sub.school_id=cs.school_id
    LEFT JOIN employees e ON e.school_id=cs.school_id AND e.id=COALESCE(cs.employee_id,
      (SELECT ta.employee_id FROM teacher_class_assignments ta WHERE ta.school_id=cs.school_id AND ta.academic_session_id=$2
        AND ta.school_class_id=$4 AND ta.subject_id=cs.subject_id AND ta.assignment_type='SUBJECT_TEACHER'
        AND ta.status='ACTIVE' AND (ta.section='' OR ta.section=$5) ORDER BY ta.id DESC LIMIT 1))
    JOIN academic_sessions sess ON sess.id=cs.academic_session_id AND sess.school_id=cs.school_id
    JOIN academic_terms term ON term.id=$3 AND term.academic_session_id=sess.id AND term.school_id=cs.school_id
    WHERE cs.school_id=$1 AND cs.academic_session_id=$2 AND (cs.academic_term_id=$3 OR cs.academic_term_id IS NULL)
      AND cs.school_class_id=$4 AND (NULLIF(cs.section,'') IS NULL OR cs.section=$5)
      AND (cs.status='ACTIVE' OR (cs.status='INACTIVE' AND (sess.status='COMPLETED' OR term.status='COMPLETED' OR term.end_date<CURRENT_DATE)))
    ORDER BY cs.subject_id,(cs.academic_term_id=$3) DESC NULLS LAST,cs.id DESC)
    SELECT * FROM configured UNION ALL
    SELECT DISTINCT ON(ta.subject_id) ta.subject_id,sub.name,concat_ws(' ',e.first_name,e.last_name)
    FROM teacher_class_assignments ta JOIN subjects sub ON sub.id=ta.subject_id AND sub.school_id=ta.school_id
    JOIN employees e ON e.id=ta.employee_id AND e.school_id=ta.school_id
    JOIN academic_terms term ON term.id=$3 AND term.school_id=ta.school_id
    WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.school_class_id=$4
      AND ta.assignment_type='SUBJECT_TEACHER' AND ta.subject_id IS NOT NULL AND (ta.section='' OR ta.section=$5)
      AND ta.start_date<=term.end_date AND (ta.end_date IS NULL OR ta.end_date>=term.start_date)
      AND (ta.status='ACTIVE' OR (ta.status='INACTIVE' AND (term.status='COMPLETED' OR term.end_date<CURRENT_DATE)))
      AND NOT EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.school_id=$1 AND cs.academic_session_id=$2
        AND cs.school_class_id=$4 AND cs.subject_id=ta.subject_id)`,
    [scope.schoolId,scope.sessionId,scope.termId,student.classId,student.section]);
  const scores = await client.query(`SELECT r.id,r.assessment_id AS "assessmentId",r.subject_id AS "subjectId",r.score,r.max_score AS "maxScore",
    r.grade,r.status,r.review_status AS "reviewStatus",concat_ws(' ',e.first_name,e.last_name) AS "teacherName",
    a.title AS "componentName",at.code AS "componentCode",a.assessment_type_id AS "assessmentTypeId"
    FROM academic_results r JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id
    JOIN academic_assessment_types at ON at.id=a.assessment_type_id AND at.school_id=a.school_id
    LEFT JOIN employees e ON e.id=r.teacher_employee_id AND e.school_id=r.school_id
    WHERE r.school_id=$1 AND r.student_id=$2 AND r.academic_session_id=$3 AND r.academic_term_id=$4
      AND r.school_class_id=$5 AND r.section_snapshot=$6 AND r.student_class_assignment_id=$7
      AND r.status<>'ARCHIVED' AND a.status<>'ARCHIVED' ORDER BY r.id`,
    [scope.schoolId,student.id,scope.sessionId,scope.termId,student.classId,student.section,student.studentClassAssignmentId]);
  const rules = await client.query("SELECT min_score,max_score,grade,grade_point,remark FROM academic_grading_rules WHERE school_id=$1 AND status='ACTIVE'", [scope.schoolId]);
  const batches=(await client.query(`SELECT subject_id,components,status FROM academic_result_batches WHERE school_id=$1
    AND academic_session_id=$2 AND academic_term_id=$3 AND school_class_id=$4 AND section=$5`,
    [scope.schoolId,scope.sessionId,scope.termId,student.classId,student.section])).rows;
  const subjects = expected.rows.map((subject: any) => {
    const rows = scores.rows.filter((r: any) => Number(r.subjectId) === Number(subject.subjectId));
    const batch=batches.find((b:any)=>Number(b.subject_id)===Number(subject.subjectId));
    const required=batch?.components??[];
    const submitted = rows.length > 0 && rows.every((r: any) => ["SUBMITTED","PUBLISHED"].includes(r.status) && r.reviewStatus !== "RETURNED") &&
      (!batch||(["SUBMITTED","RESUBMITTED","LOCKED"].includes(batch.status)&&required.length>0&&
        required.every((c:any)=>rows.some((r:any)=>Number(r.assessmentId)===Number(c.assessmentId)))));
    const score = submitted ? rows.reduce((sum: number,r: any)=>sum+Number(r.score),0) : null;
    const maxScore = submitted ? rows.reduce((sum: number,r: any)=>sum+Number(r.maxScore),0) : null;
    const percent = score === null || !maxScore ? null : score*100/maxScore;
    const matches = percent === null ? [] : rules.rows.filter((r: any)=>percent>=Number(r.min_score)&&percent<=Number(r.max_score));
    if(matches.length>1) throw new AuthError(409,"School grading rules overlap for a compiled subject");
    return {...subject,teacherName:rows.map((r: any)=>r.teacherName).filter(Boolean).filter((v: string,i: number,a: string[])=>a.indexOf(v)===i).join(", ")||subject.teacherName,
      score,maxScore,grade:matches[0]?.grade ?? null,gradePoint:matches[0]?.grade_point==null?null:Number(matches[0].grade_point),
      remark:matches[0]?.remark??null,missing:!submitted,
      components:rows.map((r:any)=>({name:r.componentName,typeId:r.assessmentTypeId,code:r.componentCode,score:submitted?Number(r.score):null,maxScore:Number(r.maxScore)})),
      status:!rows.length ? "AWAITING_TEACHER_SUBMISSION" : rows.some((r: any)=>r.reviewStatus==="RETURNED") ? "RETURNED"
        : !submitted ? "DRAFT" : rows.every((r: any)=>r.status==="PUBLISHED") ? "PUBLISHED"
        : rows.every((r: any)=>r.reviewStatus==="APPROVED") ? "APPROVED" : "SUBMITTED",
      resultIds:rows.map((r: any)=>Number(r.id))};
  });
  const missingSubjects = subjects.filter((s: any)=>s.missing).map((s: any)=>s.subjectName);
  const complete = subjects.length>0 && missingSubjects.length===0;
  const total = complete ? subjects.reduce((sum: number,s: any)=>sum+Number(s.score)*100/Number(s.maxScore),0) : null;
  const attendance=(await client.query(`WITH days AS (
    SELECT ae.event_date,bool_or(ae.attendance_status='LATE') AS late,
      bool_or(ae.attendance_status='PRESENT') AS present,bool_or(ae.attendance_status='ABSENT') AS absent
    FROM attendance_events ae JOIN academic_terms t ON t.id=$4 AND t.school_id=ae.school_id AND t.academic_session_id=$3
    WHERE ae.school_id=$1 AND ae.student_id=$2 AND ae.result='ACCEPTED' AND ae.event_date BETWEEN t.start_date AND t.end_date
      AND (ae.academic_session_id IS NULL OR ae.academic_session_id=$3) AND (ae.academic_term_id IS NULL OR ae.academic_term_id=$4)
    GROUP BY ae.event_date)
    SELECT count(*) FILTER(WHERE present AND NOT late)::int AS present,count(*) FILTER(WHERE late)::int AS late,
      count(*) FILTER(WHERE absent AND NOT present AND NOT late)::int AS absent,
      count(*) FILTER(WHERE present OR late OR absent)::int AS total FROM days`,
    [scope.schoolId,student.id,scope.sessionId,scope.termId])).rows[0]??{present:0,late:0,absent:0,total:0};
  return {studentId:student.id,studentName:`${student.firstName} ${student.lastName}`,admissionNo:student.admissionNo,
    classId:student.classId,className:student.className,section:student.section,studentClassAssignmentId:student.studentClassAssignmentId,
    subjects,missingSubjects,complete,total,average:total===null?null:total/subjects.length,attendance};
}

export async function assertCompilationReady(client: any, scope: PeriodContext) {
  const students = await periodStudents(client,scope);
  if(!students.length) throw new AuthError(404,"Student academic assignment not found");
  const compiled = await compileStudent(client,scope,students[0]);
  if(!compiled.complete) throw new AuthError(409,compiled.subjects.length
    ? `Awaiting teacher submission: ${compiled.missingSubjects.join(", ")}` : "Assign the expected curriculum subjects before approving this result");
  if(compiled.subjects.some((s: any)=>s.grade===null || !["APPROVED","PUBLISHED"].includes(s.status))) {
    throw new AuthError(409,"Approve and grade every expected subject before approving or publishing the consolidated result");
  }
  return compiled;
}