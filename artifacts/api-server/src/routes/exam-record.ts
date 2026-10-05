import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";
import { scopeFrom, scopeValues, schoolRole, numberId, requireOperator, assignedTeacher, auditExam, validatePeriod, assertRevision, text, batchWhere, type ExamScope } from "../services/exam-record-scope";
import { sheet, saveSheet, validateComponents, gradingRules, classLock, calculateGrade, compileDraftCards } from "../services/exam-record-results";
import { uploadBytes, previewResultImport } from "../services/exam-record-import";
import { compileStudent, periodStudents } from "../services/result-compilation";
import { serializeReportExport } from "./reporting/exports";
import { queueCommunicationNotification } from "../services/communication-service";
import questionsRouter from "./exam-record-questions";
import { publishedConsolidation } from "../services/exam-record-published";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";

const router=Router();
router.use(requireAuthentication());
const run=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>fn(req,res).catch(next);
async function transaction<T>(fn:(client:any)=>Promise<T>):Promise<T> {
  const c=await pool.connect();
  try {await c.query("BEGIN");const result=await fn(c);await c.query("COMMIT");return result;}
  catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
function batchScope(b:any):ExamScope {return {schoolId:b.school_id,sessionId:b.academic_session_id,termId:b.academic_term_id,
  classId:b.school_class_id,section:b.section,subjectId:b.subject_id};}
async function assignments(req:Request,schoolId:number,sessionId:number,termId:number) {
  const role=schoolRole(req,schoolId);
  const candidates=(await pool.query(`WITH sections AS (
    SELECT c.id,c.name,sec.section FROM school_classes c CROSS JOIN LATERAL (
      SELECT c.section UNION SELECT sca.section FROM student_class_assignments sca WHERE sca.school_id=c.school_id
        AND sca.school_class_id=c.id AND sca.academic_session_id=$2 AND (sca.academic_term_id=$3 OR sca.academic_term_id IS NULL)
      UNION SELECT ta.section FROM teacher_class_assignments ta WHERE ta.school_id=c.school_id AND ta.school_class_id=c.id
        AND ta.academic_session_id=$2 AND ta.section<>'' AND ta.status='ACTIVE'
    ) sec WHERE c.school_id=$1), explicit AS (
    SELECT DISTINCT ON(c.id,c.section,cs.subject_id) c.id AS "classId",c.name AS "className",c.section,cs.subject_id AS "subjectId",
      COALESCE(cs.employee_id,(SELECT ta.employee_id FROM teacher_class_assignments ta WHERE ta.school_id=$1
        AND ta.academic_session_id=$2 AND ta.school_class_id=c.id AND ta.subject_id=cs.subject_id AND ta.status='ACTIVE'
        AND ta.assignment_type='SUBJECT_TEACHER' AND (ta.section='' OR ta.section=c.section) ORDER BY ta.id DESC LIMIT 1)) AS "teacherId"
    FROM sections c JOIN class_subjects cs ON cs.school_class_id=c.id AND cs.school_id=$1 AND cs.academic_session_id=$2
      AND (cs.academic_term_id=$3 OR cs.academic_term_id IS NULL) AND (NULLIF(cs.section,'') IS NULL OR cs.section=c.section)
    JOIN academic_terms t ON t.id=$3 AND t.school_id=cs.school_id
    WHERE cs.status='ACTIVE' OR (cs.status='INACTIVE' AND (t.status='COMPLETED' OR t.end_date<CURRENT_DATE))
    ORDER BY c.id,c.section,cs.subject_id,(cs.academic_term_id=$3) DESC NULLS LAST,cs.id DESC
    ), configured AS (SELECT * FROM explicit UNION ALL
    SELECT c.id,c.name,c.section,ta.subject_id,ta.employee_id FROM sections c JOIN teacher_class_assignments ta
      ON ta.school_id=$1 AND ta.school_class_id=c.id AND ta.academic_session_id=$2 AND ta.subject_id IS NOT NULL
      AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE' AND (ta.section='' OR ta.section=c.section)
    WHERE NOT EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.school_id=$1 AND cs.academic_session_id=$2
      AND cs.school_class_id=c.id AND cs.subject_id=ta.subject_id))
    SELECT DISTINCT c.*,sub.name AS "subjectName",concat_ws(' ',e.first_name,e.last_name) AS "teacherName",
      b.id AS "batchId",COALESCE(b.status,'AWAITING') AS status,COALESCE(b.revision,0) AS revision
    FROM configured c JOIN subjects sub ON sub.id=c."subjectId" AND sub.school_id=$1
    LEFT JOIN employees e ON e.id=c."teacherId" AND e.school_id=$1
    LEFT JOIN academic_result_batches b ON b.school_id=$1 AND b.academic_session_id=$2 AND b.academic_term_id=$3
      AND b.school_class_id=c."classId" AND b.section=c.section AND b.subject_id=c."subjectId"
    ORDER BY c."className",c.section,sub.name`,[schoolId,sessionId,termId])).rows;
  if(role!=="TEACHER") return candidates;
  const authorized=[];
  for(const candidate of candidates) {
    try {
      const teacherId=await assignedTeacher(req,{schoolId,sessionId,termId,classId:candidate.classId,section:candidate.section,subjectId:candidate.subjectId});
      authorized.push({...candidate,teacherId});
    } catch(error){if(!(error instanceof AuthError)) throw error;}
  }
  const comments=(await pool.query(`SELECT DISTINCT ta.school_class_id AS "classId",c.name AS "className",
    COALESCE(NULLIF(ta.section,''),c.section) AS section,0 AS "subjectId",'Class Teacher comments' AS "subjectName",
    e.id AS "teacherId",concat_ws(' ',e.first_name,e.last_name) AS "teacherName",'COMMENT_ONLY' AS status,
    NULL::int AS "batchId",0 AS revision,true AS "commentOnly"
    FROM teacher_class_assignments ta JOIN employees e ON e.id=ta.employee_id AND e.school_id=ta.school_id
    JOIN school_classes c ON c.id=ta.school_class_id AND c.school_id=ta.school_id
    JOIN academic_terms t ON t.id=$3 AND t.school_id=ta.school_id AND t.academic_session_id=ta.academic_session_id
    WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND e.user_id=$4 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'
      AND ta.status='ACTIVE' AND ta.assignment_type='CLASS_TEACHER' AND ta.start_date<=t.end_date
      AND (ta.end_date IS NULL OR ta.end_date>=t.start_date)`,[schoolId,sessionId,termId,getUserContext(req).user.id])).rows;
  return [...authorized,...comments];
}
function commentScope(raw:any) {
  return {schoolId:numberId(raw.schoolId,"schoolId"),sessionId:numberId(raw.sessionId,"sessionId"),
    termId:numberId(raw.termId,"termId"),classId:numberId(raw.classId,"classId"),section:text(raw.section??"","section",80,true)};
}
async function requireClassTeacher(req:Request,s:ReturnType<typeof commentScope>,client:any=pool) {
  requireOperator(req,s.schoolId,"TEACHER");await validatePeriod(client,s);
  const r=await client.query(`SELECT ta.id FROM teacher_class_assignments ta JOIN employees e ON e.id=ta.employee_id AND e.school_id=ta.school_id
    JOIN academic_terms t ON t.id=$3 AND t.school_id=ta.school_id AND t.academic_session_id=ta.academic_session_id
    WHERE ta.school_id=$1 AND ta.academic_session_id=$2 AND ta.school_class_id=$4 AND (ta.section='' OR ta.section=$5)
      AND ta.assignment_type='CLASS_TEACHER' AND ta.status='ACTIVE' AND ta.start_date<=t.end_date
      AND (ta.end_date IS NULL OR ta.end_date>=t.start_date) AND e.user_id=$6 AND e.employee_type='TEACHER' AND e.employment_status='ACTIVE'`,
    [s.schoolId,s.sessionId,s.termId,s.classId,s.section,getUserContext(req).user.id]);
  if(!r.rows.length)throw new AuthError(404,"Class-teacher appointment not found");
}
router.get("/exam-record/class-comments",run(async(req,res)=>{
  const s=commentScope(req.query);await requireClassTeacher(req,s);const roster=await periodStudents(pool,s);
  const rows=await Promise.all(roster.map(async(st:any)=>{
    const card=(await pool.query(`SELECT id AS "reportCardId",teacher_remark AS "teacherRemark",status FROM academic_report_cards
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4 AND student_class_assignment_id=$5`,
      [s.schoolId,st.id,s.sessionId,s.termId,st.studentClassAssignmentId])).rows[0];
    return {studentId:st.id,studentName:`${st.firstName} ${st.lastName}`,reportCardId:card?.reportCardId??null,
      teacherRemark:card?.teacherRemark??"",status:card?.status??"AWAITING"};
  }));res.json(rows);
}));
router.post("/exam-record/class-comment",run(async(req,res)=>{
  const s=commentScope(req.body),studentId=numberId(req.body.studentId,"studentId"),teacherRemark=text(req.body.teacherRemark,"Teacher comment",500,true);
  res.json(await transaction(async c=>{
    await requireClassTeacher(req,s,c);await classLock(c,s);
    const roster=await periodStudents(c,{...s,studentId});if(!roster.length)throw new AuthError(404,"Student not found in this period's class");
    const card=(await c.query(`SELECT * FROM academic_report_cards WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3
      AND academic_term_id=$4 AND student_class_assignment_id=$5 FOR UPDATE`,
      [s.schoolId,studentId,s.sessionId,s.termId,roster[0].studentClassAssignmentId])).rows[0];
    if(!card||card.status!=="DRAFT")throw new AuthError(409,"Comments are editable only on an unpublished compiled draft");
    await c.query("UPDATE academic_report_cards SET teacher_remark=$1,updated_at=now() WHERE id=$2 AND school_id=$3",[teacherRemark,card.id,s.schoolId]);
    await auditExam(req,c,s.schoolId,"Updated class teacher report comment",card.id,{previous:card.teacher_remark,teacherRemark,studentId});
    return {studentId,studentName:`${roster[0].firstName} ${roster[0].lastName}`,reportCardId:card.id,teacherRemark,status:"DRAFT"};
  }));
}));
router.get("/exam-record/context",run(async(req,res)=>{
  const schoolId=numberId(req.query.schoolId,"schoolId"),role=schoolRole(req,schoolId);
  const sessions=(await pool.query(`SELECT id,name,is_current AS "isCurrent",status FROM academic_sessions WHERE school_id=$1 ORDER BY is_current DESC,start_date DESC,id DESC`,[schoolId])).rows;
  const sessionId=req.query.sessionId?numberId(req.query.sessionId,"sessionId"):sessions[0]?.id??null;
  if(sessionId&&!sessions.some(s=>s.id===sessionId)) throw new AuthError(404,"Academic session not found");
  const terms=sessionId?(await pool.query(`SELECT id,name,is_current AS "isCurrent",status,academic_session_id AS "sessionId" FROM academic_terms
    WHERE school_id=$1 AND academic_session_id=$2 ORDER BY is_current DESC,start_date,id`,[schoolId,sessionId])).rows:[];
  const termId=req.query.termId?numberId(req.query.termId,"termId"):terms[0]?.id??null;
  if(termId&&!terms.some(t=>t.id===termId)) throw new AuthError(404,"Academic term not found");
  const types=(await pool.query(`SELECT t.id,t.name,t.code,
    CASE WHEN count(DISTINCT a.max_score)=1 THEN min(a.max_score)::float ELSE NULL END AS "maxScore"
    FROM academic_assessment_types t LEFT JOIN academic_assessments a ON a.school_id=t.school_id AND a.assessment_type_id=t.id AND a.status<>'ARCHIVED'
    WHERE t.school_id=$1 AND t.status='ACTIVE' GROUP BY t.id ORDER BY t.id`,[schoolId])).rows;
  res.json({role,sessions,terms,sessionId,termId,assignments:sessionId&&termId?await assignments(req,schoolId,sessionId,termId):[],
    assessmentTypes:types,gradingRules:await gradingRules(pool,schoolId)});
}));
router.get("/exam-record/sheet",run(async(req,res)=>{res.json(await sheet(req,scopeFrom(req.query)));}));
router.post("/exam-record/sheet/draft",run(async(req,res)=>{const s=scopeFrom(req.body?.scope);res.json(await transaction(c=>saveSheet(req,s,req.body,c)));}));
router.post("/exam-record/sheet/submit",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"TEACHER");
  res.json(await transaction(async c=>{
    const b=(await c.query("SELECT * FROM academic_result_batches WHERE id=$1 AND school_id=$2",[numberId(req.body.batchId,"batchId"),schoolId])).rows[0];
    if(!b) throw new AuthError(404,"Result sheet not found");
    const s=batchScope(b);await assignedTeacher(req,s,c);await classLock(c,s);
    const current=(await c.query("SELECT * FROM academic_result_batches WHERE id=$1 AND school_id=$2 FOR UPDATE",[b.id,schoolId])).rows[0];
    assertRevision(current.revision,req.body.revision);
    if(!["DRAFT","RETURNED"].includes(current.status)) throw new AuthError(409,"Only draft or returned subject results may be submitted");
    const worksheet=await sheet(req,s,c);
    const components=validateComponents(worksheet.components);
    if(!worksheet.rows.length||worksheet.rows.some((r:any)=>components.some(col=>r.scores[col.key]===null))) throw new AuthError(409,"Enter every authorized student's component scores before submitting");
    for(const r of worksheet.rows) {
      const total=components.reduce((n,col)=>n+Number(r.scores[col.key]),0),maximum=components.reduce((n,col)=>n+col.maxScore,0);
      if(!calculateGrade(total,maximum,worksheet.gradingRules).grade) throw new AuthError(409,"School grading configuration does not cover every subject total");
    }
    const roster=await periodStudents(c,s);
    const resultIds=(await c.query(`SELECT r.id FROM academic_results r WHERE r.school_id=$1 AND r.academic_session_id=$2 AND r.academic_term_id=$3
      AND r.school_class_id=$4 AND r.section_snapshot=$5 AND r.subject_id=$6 AND r.teacher_employee_id=$7 AND r.status='DRAFT'
      AND r.assessment_id=ANY($8::int[]) AND r.student_class_assignment_id=ANY($9::int[])`,
      [...scopeValues(s),b.teacher_employee_id,components.map(col=>col.assessmentId),roster.map((r:any)=>r.studentClassAssignmentId)])).rows.map((r:any)=>r.id);
    if(resultIds.length!==roster.length*components.length) throw new AuthError(409,"The roster or saved assessment scores changed; refresh this sheet");
    await c.query(`UPDATE academic_results SET status='SUBMITTED',review_status='NOT_REVIEWED',review_comment=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
      WHERE school_id=$1 AND id=ANY($2::int[])`,[schoolId,resultIds]);
    const status=current.status==="RETURNED"?"RESUBMITTED":"SUBMITTED";
    const updated=(await c.query("UPDATE academic_result_batches SET status=$1,revision=revision+1,submitted_at=now(),updated_at=now() WHERE id=$2 RETURNING status,revision",[status,b.id])).rows[0];
    await compileDraftCards(c,s);
    await auditExam(req,c,schoolId,`${status==="RESUBMITTED"?"Resubmitted":"Submitted"} teacher subject results`,b.id,{scope:s,resultIds,revision:updated.revision});
    return updated;
  }));
}));
router.get("/exam-record/template",run(async(req,res)=>{
  const current=await sheet(req,scopeFrom(req.query));
  const exported=serializeReportExport("xlsx",{title:"Result Template",columns:[
    {key:"id",label:"Student ID"},{key:"admission",label:"Admission No"},{key:"name",label:"Student Name"},...current.components.map(c=>({key:c.key,label:c.label}))],
    rows:current.rows.map((r:any)=>({id:r.studentId,admission:r.admissionNo,name:r.studentName,...Object.fromEntries(current.components.map(c=>[c.key,""]))})),total:current.rows.length});
  res.setHeader("Content-Type",exported.contentType);res.setHeader("Content-Disposition",exported.contentDisposition);res.setHeader("Cache-Control","private, no-store");res.send(exported.body);
}));
router.post("/exam-record/import/preview",run(async(req,res)=>{
  const s=scopeFrom(req.body?.scope),current=await sheet(req,s);assertRevision(current.revision,req.body.revision);
  if(!["DRAFT","RETURNED"].includes(current.status)) throw new AuthError(409,"This result sheet is locked");
  const file=uploadBytes(req.body),components=validateComponents(req.body.components);
  res.json({...previewResultImport(file.buffer,file.filename,components,current.rows),digest:file.digest});
}));
router.post("/exam-record/import/confirm",run(async(req,res)=>{
  const s=scopeFrom(req.body?.scope),file=uploadBytes(req.body);
  if(req.body.digest!==file.digest) throw new AuthError(409,"The file changed after preview; preview it again");
  res.json(await transaction(async c=>{
    await classLock(c,s);const current=await sheet(req,s,c);assertRevision(current.revision,req.body.revision);
    const components=validateComponents(req.body.components),preview=previewResultImport(file.buffer,file.filename,components,current.rows);
    if(preview.uncertain||preview.invalidCount||!preview.validCount) throw new AuthError(400,"Correct every invalid or uncertain import row before confirming");
    const merged=current.rows.map((r:any)=>{const imported=preview.rows.find(p=>p.studentId===r.studentId);return imported?{...r,scores:imported.scores}:r;});
    const saved=await saveSheet(req,s,{revision:req.body.revision,components,rows:merged},c);
    await auditExam(req,c,s.schoolId,"Confirmed result import",saved.batchId!,{filename:file.filename,digest:file.digest,matched:preview.validCount,scope:s});
    return saved;
  }));
}));
router.get("/exam-record/class",run(async(req,res)=>{
  const schoolId=numberId(req.query.schoolId,"schoolId");if(schoolRole(req,schoolId)==="TEACHER") throw new AuthError(403,"Consolidated review belongs to School Admin");
  const s={schoolId,sessionId:numberId(req.query.sessionId,"sessionId"),termId:numberId(req.query.termId,"termId"),
    classId:numberId(req.query.classId,"classId"),section:text(req.query.section??"","section",80,true)};
  const roster=await periodStudents(pool,s);
  const students=await Promise.all(roster.map(async(st:any)=>{
    const compiled=await compileStudent(pool,s,st);
    const card=(await pool.query(`SELECT id,status,teacher_remark AS "teacherRemark",school_remark AS "schoolRemark" FROM academic_report_cards
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4 AND student_class_assignment_id=$5`,
      [schoolId,st.id,s.sessionId,s.termId,st.studentClassAssignmentId])).rows[0];
    const frozen=card?await publishedConsolidation({...card,schoolId}):{};
    return {...compiled,...(frozen.consolidatedSubjects?{subjects:frozen.consolidatedSubjects,total:frozen.total,average:frozen.average,
      attendance:frozen.attendance??compiled.attendance}:{}),
      reportCardId:card?.id??null,teacherRemark:card?.teacherRemark??"",schoolRemark:card?.schoolRemark??"",
      status:card?.status==="PUBLISHED"?"PUBLISHED":compiled.complete&&compiled.subjects.every((v:any)=>v.grade)?"READY_FOR_REVIEW":"AWAITING"};
  }));
  const known=await assignments(req,schoolId,s.sessionId,s.termId),batches=(await pool.query(`SELECT * FROM academic_result_batches
    WHERE school_id=$1 AND academic_session_id=$2 AND academic_term_id=$3 AND school_class_id=$4 AND section=$5`,
    [schoolId,s.sessionId,s.termId,s.classId,s.section])).rows;
  const subjects=known.filter(a=>a.classId===s.classId&&a.section===s.section).map(a=>{
    const b=batches.find(b=>b.subject_id===a.subjectId);
    const states=students.map(st=>st.subjects.find((sub:any)=>sub.subjectId===a.subjectId)?.status);
    return {...a,status:b?.status??(states.length&&states.every(v=>["SUBMITTED","APPROVED","PUBLISHED"].includes(v!))?"SUBMITTED":"AWAITING"),
      batchId:b?.id??null,revision:b?.revision??0};
  });
  res.json({subjects,students,submittedCount:subjects.filter(s=>["SUBMITTED","RESUBMITTED","LOCKED"].includes(s.status)).length,requiredCount:subjects.length});
}));
router.post("/exam-record/return",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"SCHOOL_ADMIN");
  const comment=text(req.body.comment,"Correction reason",2000);
  res.json(await transaction(async c=>{
    const row=(await c.query("SELECT * FROM academic_result_batches WHERE school_id=$1 AND id=$2",[schoolId,numberId(req.body.batchId,"batchId")])).rows[0];
    if(!row) throw new AuthError(404,"Result sheet not found");const s=batchScope(row);await classLock(c,s);
    const b=(await c.query("SELECT * FROM academic_result_batches WHERE id=$1 FOR UPDATE",[row.id])).rows[0];
    assertRevision(b.revision,req.body.revision);
    if(!["SUBMITTED","RESUBMITTED"].includes(b.status)) throw new AuthError(409,"Only submitted subject results may be returned");
    const all=(await c.query(`SELECT * FROM academic_results WHERE ${batchWhere.replace("section=$5","section_snapshot=$5")} AND status<>'ARCHIVED'`,scopeValues(s))).rows;
    if(all.some((r:any)=>r.status==="PUBLISHED")) throw new AuthError(409,"Published results are locked; the existing authorized correction process is required");
    await c.query(`UPDATE academic_results SET status='DRAFT',review_status='RETURNED',review_comment=$7,reviewed_by=$8,reviewed_at=now(),updated_at=now()
      WHERE ${batchWhere.replace("section=$5","section_snapshot=$5")} AND teacher_employee_id=$9 AND status='SUBMITTED'`,
      [...scopeValues(s),comment,getUserContext(req).user.id,b.teacher_employee_id]);
    const updated=(await c.query("UPDATE academic_result_batches SET status='RETURNED',return_comment=$1,revision=revision+1,updated_at=now() WHERE id=$2 RETURNING status,revision",[comment,b.id])).rows[0];
    await auditExam(req,c,schoolId,"Returned subject results for correction",b.id,{scope:s,comment,previousScores:all});
    return updated;
  }));
}));
router.post("/exam-record/publish",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"SCHOOL_ADMIN");
  const s={schoolId,sessionId:numberId(req.body.sessionId,"sessionId"),termId:numberId(req.body.termId,"termId"),
    classId:numberId(req.body.classId,"classId"),section:text(req.body.section??"","section",80,true),studentId:numberId(req.body.studentId,"studentId")};
  res.json(await transaction(async c=>{
    await classLock(c,s);const roster=await periodStudents(c,s);
    if(!roster.length) throw new AuthError(404,"Student is not in this historical class/section/period");
    await c.query("SELECT pg_advisory_xact_lock($1,$2)",[schoolId,s.studentId]);
    const compiled=await compileStudent(c,s,roster[0]);
    const missing=compiled.subjects.filter((sub:any)=>sub.missing);
    if(!compiled.complete) throw new AuthError(409,missing.length?missing.map((sub:any)=>`${sub.subjectName} has not been submitted by ${sub.teacherName||"the assigned teacher"}`).join("; "):"No required subjects are configured");
    if(compiled.subjects.some((sub:any)=>!sub.grade)) throw new AuthError(409,"School grading rules do not cover all consolidated subject totals");
    await compileDraftCards(c,{...s,subjectId:compiled.subjects[0].subjectId});
    const card=(await c.query(`SELECT * FROM academic_report_cards WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4 FOR UPDATE`,
      [schoolId,s.studentId,s.sessionId,s.termId])).rows[0];
    if(!card||card.status!=="DRAFT"||card.student_class_assignment_id!==roster[0].studentClassAssignmentId) throw new AuthError(409,"Only the current compiled draft report may be published");
    const ids=compiled.subjects.flatMap((sub:any)=>sub.resultIds);
    const resultRows=(await c.query("SELECT id,status,review_status FROM academic_results WHERE school_id=$1 AND id=ANY($2::int[]) FOR UPDATE",[schoolId,ids])).rows;
    if(resultRows.length!==ids.length||resultRows.some((r:any)=>!["SUBMITTED","PUBLISHED"].includes(r.status)||r.review_status==="RETURNED")) throw new AuthError(409,"A subject changed during review; refresh the report");
    const frozenLines=(await c.query("SELECT result_id FROM academic_report_card_lines WHERE school_id=$1 AND report_card_id=$2",[schoolId,card.id])).rows;
    if(frozenLines.length!==ids.length||frozenLines.some((l:any)=>!ids.includes(l.result_id))) throw new AuthError(409,"The report snapshot is stale; review the current compiled report");
    await c.query(`UPDATE academic_results SET status='PUBLISHED',review_status='APPROVED',reviewed_by=$3,reviewed_at=now(),
      published_by=$3,published_at=COALESCE(published_at,now()),updated_at=now() WHERE school_id=$1 AND id=ANY($2::int[])`,[schoolId,ids,getUserContext(req).user.id]);
    await c.query(`UPDATE academic_report_cards SET status='PUBLISHED',school_remark=COALESCE($3,school_remark),published_by=$4,published_at=now(),updated_at=now()
      WHERE id=$1 AND school_id=$2`,[card.id,schoolId,req.body.schoolRemark===undefined?null:text(req.body.schoolRemark,"School remark",500,true),getUserContext(req).user.id]);
    await c.query(`UPDATE academic_result_batches SET status='LOCKED',revision=revision+1,updated_at=now() WHERE school_id=$1 AND academic_session_id=$2
      AND academic_term_id=$3 AND school_class_id=$4 AND section=$5 AND subject_id=ANY($6::int[])`,
      [schoolId,s.sessionId,s.termId,s.classId,s.section,compiled.subjects.map((sub:any)=>sub.subjectId)]);
    await auditExam(req,c,schoolId,"Published consolidated Exam/Record report",card.id,{scope:s,consolidatedSubjects:compiled.subjects,total:compiled.total,
      average:compiled.average,attendance:compiled.attendance});
    const recipients=(await c.query(`SELECT user_id FROM students WHERE id=$1 AND school_id=$2 AND user_id IS NOT NULL
       UNION SELECT p.user_id FROM parents p JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
       JOIN students st ON st.id=psr.student_id AND st.school_id=$2
       WHERE psr.student_id=$1 AND UPPER(p.status)='ACTIVE' AND p.user_id IS NOT NULL AND ${familyChildSchoolScope()}`,[s.studentId,schoolId])).rows;
    for(const recipient of recipients) await queueCommunicationNotification(c,{recipientUserId:recipient.user_id,schoolId,subjectStudentId:s.studentId,
      subjectClassId:s.classId,category:"ACADEMIC",eventKey:`exam-record-published:${card.id}`,subject:"Term result published",
      body:"Your published term report is now available in Exam/Record.",link:"/results",channels:["IN_APP"]});
    return {reportCardId:card.id,status:"PUBLISHED"};
  }));
}));
router.use(questionsRouter);
export default router;
