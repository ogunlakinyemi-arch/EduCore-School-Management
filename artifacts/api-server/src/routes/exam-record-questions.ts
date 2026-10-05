import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext } from "../middlewares/auth";
import { scopeFrom, scopeValues, numberId, text, schoolRole, requireOperator, assignedTeacher, validatePeriod, assertRevision, auditExam, type ExamScope } from "../services/exam-record-scope";
import { questionDocument, storeQuestionDocument, readQuestionDocument, printableStructuredPaper } from "../services/exam-question-documents";
import { queueCommunicationNotification } from "../services/communication-service";

const router=Router();
const disposition=(filename:string)=>`inline; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g,"_")}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`;
const run=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>fn(req,res).catch(next);
const paperSelect=`p.id,p.school_id AS "schoolId",p.academic_session_id AS "sessionId",p.academic_term_id AS "termId",
 p.school_class_id AS "classId",c.name AS "className",p.section,p.subject_id AS "subjectId",sub.name AS "subjectName",
 p.teacher_employee_id AS "teacherId",concat_ws(' ',e.first_name,e.last_name) AS "teacherName",p.examination_name AS "examinationName",
 p.instructions,p.duration,p.total_marks::float AS "totalMarks",p.status,p.revision,p.submitted_at AS "submittedAt",p.approved_at AS "approvedAt",
 sess.name AS "sessionName",term.name AS "termName"`;
const paperJoin=`FROM exam_question_papers p JOIN school_classes c ON c.id=p.school_class_id AND c.school_id=p.school_id
 JOIN subjects sub ON sub.id=p.subject_id AND sub.school_id=p.school_id
 JOIN employees e ON e.id=p.teacher_employee_id AND e.school_id=p.school_id
 JOIN academic_sessions sess ON sess.id=p.academic_session_id AND sess.school_id=p.school_id
 JOIN academic_terms term ON term.id=p.academic_term_id AND term.school_id=p.school_id`;
async function getPaper(req:Request,client:any=pool,lock=false) {
  const schoolId=numberId(req.query.schoolId??req.body?.schoolId,"schoolId");
  const role=schoolRole(req,schoolId);
  const paper=(await client.query(`SELECT ${paperSelect} ${paperJoin} WHERE p.school_id=$1 AND p.id=$2 ${lock?"FOR UPDATE OF p":""}`,
    [schoolId,numberId(req.params.id,"paperId")])).rows[0];
  if(!paper) throw new AuthError(404,"Question paper not found");
  if(role==="TEACHER") {
    const teacherId=await assignedTeacher(req,scopeFrom(paper),client);
    if(teacherId!==paper.teacherId) throw new AuthError(404,"Question paper not found");
  }
  return paper;
}
async function transaction<T>(fn:(c:any)=>Promise<T>):Promise<T> {
  const c=await pool.connect();
  try{await c.query("BEGIN");const r=await fn(c);await c.query("COMMIT");return r;}catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
async function notify(req:Request,c:any,paper:any,status:string) {
  const recipients=new Set<number>();
  const teacher=(await c.query("SELECT user_id FROM employees WHERE id=$1 AND school_id=$2",[paper.teacherId,paper.schoolId])).rows[0];
  if(teacher?.user_id) recipients.add(teacher.user_id);
  if(["SUBMITTED","RESUBMITTED"].includes(status)) {
    const admins=(await c.query("SELECT user_id FROM school_memberships WHERE school_id=$1 AND role='SCHOOL_ADMIN' AND status='ACTIVE'",[paper.schoolId])).rows;
    admins.forEach((r:any)=>recipients.add(r.user_id));
  }
  for(const recipientUserId of recipients) await queueCommunicationNotification(c,{recipientUserId,schoolId:paper.schoolId,category:"ACADEMIC",
    subjectClassId:paper.classId,eventKey:`exam-paper:${paper.id}:${paper.revision+1}:${status}`,subject:`Exam questions: ${status.toLowerCase()}`,
    body:`${paper.subjectName} — ${paper.examinationName}: ${status==="APPROVED"?"approved and ready for printing":status.toLowerCase()}.`,
    link:"/exam-record/questions",channels:["IN_APP"]});
}
router.get("/exam-record/questions",run(async(req,res)=>{
  const schoolId=numberId(req.query.schoolId,"schoolId"),role=schoolRole(req,schoolId);
  const values:any[]=[schoolId],where=["p.school_id=$1"];
  for(const [key,column] of [["sessionId","academic_session_id"],["termId","academic_term_id"],["classId","school_class_id"],["subjectId","subject_id"]]) {
    if(req.query[key]) {values.push(numberId(req.query[key],key));where.push(`p.${column}=$${values.length}`);}
  }
  if(req.query.section!==undefined){values.push(text(req.query.section,"section",80,true));where.push(`p.section=$${values.length}`);}
  const papers=(await pool.query(`SELECT ${paperSelect} ${paperJoin} WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC,p.id DESC`,values)).rows;
  if(role!=="TEACHER") {res.json(papers);return;}
  const allowed=[];
  for(const paper of papers) {
    try{if(await assignedTeacher(req,scopeFrom(paper))===paper.teacherId)allowed.push(paper);}
    catch(error){if(!(error instanceof AuthError))throw error;}
  }
  res.json(allowed);
}));
router.post("/exam-record/questions",run(async(req,res)=>{
  const s=scopeFrom(req.body?.scope),teacherId=await assignedTeacher(req,s);
  await validatePeriod(pool,s);
  const examinationName=text(req.body.examinationName,"Examination name",200),instructions=text(req.body.instructions??"","Instructions",5000,true),
    duration=text(req.body.duration,"Duration",150,true)||null;
  const totalMarks=req.body.totalMarks===null||req.body.totalMarks===undefined||req.body.totalMarks===""?null:Number(req.body.totalMarks);
  if(totalMarks!==null&&(!Number.isFinite(totalMarks)||totalMarks<=0||totalMarks>99999999.99||Math.abs(totalMarks*100-Math.round(totalMarks*100))>1e-6)) throw new AuthError(400,"Total marks must be a positive number with at most two decimal places");
  const file=questionDocument(req.body);
  const paper=await transaction(async c=>{
    // Revalidate live teaching entitlement before retaining a file.
    await assignedTeacher(req,s,c);
    const objectPath=await storeQuestionDocument(file,s.schoolId);
    const actor=getUserContext(req).user.id;
    const created=(await c.query(`INSERT INTO exam_question_papers(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,
      teacher_employee_id,examination_name,instructions,duration,total_marks,revision,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12) RETURNING id`,
      [...scopeValues(s),teacherId,examinationName,instructions,duration,totalMarks,actor])).rows[0];
    await c.query(`INSERT INTO exam_question_versions(school_id,paper_id,revision,filename,mime_type,object_path,sha256,preview_text,created_by)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)`,[s.schoolId,created.id,file.filename,file.mimeType,objectPath,file.digest,file.previewText,actor]);
    await auditExam(req,c,s.schoolId,"Uploaded exam question draft",created.id,{scope:s,sha256:file.digest});
    return created;
  });
  const rows=(await pool.query(`SELECT ${paperSelect} ${paperJoin} WHERE p.id=$1 AND p.school_id=$2`,[paper.id,s.schoolId])).rows;
  res.status(201).json(rows[0]);
}));
router.get("/exam-record/questions/:id",run(async(req,res)=>{
  const paper=await getPaper(req);
  const versions=(await pool.query(`SELECT id,revision,filename,mime_type AS "mimeType",preview_text AS "previewText",created_at AS "createdAt"
    FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2 ORDER BY revision`,[paper.schoolId,paper.id])).rows;
  const reviews=(await pool.query(`SELECT r.id,r.version_id AS "versionId",r.decision,r.comment,r.created_at AS "createdAt",
    concat_ws(' ',u.first_name,u.last_name) AS "reviewerName" FROM exam_question_reviews r
    JOIN app_users u ON u.id=r.reviewer_user_id WHERE r.school_id=$1 AND r.paper_id=$2 ORDER BY r.id`,[paper.schoolId,paper.id])).rows;
  res.json({...paper,versions,reviews});
}));
router.post("/exam-record/questions/:id/version",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"TEACHER");
  res.json(await transaction(async c=>{
    const paper=await getPaper(req,c,true);assertRevision(paper.revision,req.body.revision);
    if(!["DRAFT","RETURNED"].includes(paper.status)) throw new AuthError(409,"Submitted and approved documents cannot be replaced");
    const file=questionDocument(req.body),objectPath=await storeQuestionDocument(file,schoolId);
    const version=(await c.query("SELECT COALESCE(max(revision),0)+1 AS revision FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2",[schoolId,paper.id])).rows[0].revision;
    await c.query(`INSERT INTO exam_question_versions(school_id,paper_id,revision,filename,mime_type,object_path,sha256,preview_text,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[schoolId,paper.id,version,file.filename,file.mimeType,objectPath,file.digest,file.previewText,getUserContext(req).user.id]);
    const updated=(await c.query("UPDATE exam_question_papers SET revision=revision+1,updated_at=now() WHERE id=$1 AND school_id=$2 RETURNING revision",[paper.id,schoolId])).rows[0];
    await auditExam(req,c,schoolId,"Added exam question version",paper.id,{version,sha256:file.digest});
    return {...paper,revision:updated.revision};
  }));
}));
router.post("/exam-record/questions/:id/submit",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"TEACHER");
  res.json(await transaction(async c=>{
    const paper=await getPaper(req,c,true);assertRevision(paper.revision,req.body.revision);
    if(!["DRAFT","RETURNED"].includes(paper.status)) throw new AuthError(409,"Only draft or returned question papers may be submitted");
    const latest=(await c.query("SELECT id FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2 ORDER BY revision DESC LIMIT 1",[schoolId,paper.id])).rows[0];
    if(!latest)throw new AuthError(409,"Upload a question document before submitting");
    if(paper.status==="RETURNED") {
      const returned=(await c.query("SELECT version_id FROM exam_question_reviews WHERE school_id=$1 AND paper_id=$2 AND decision='RETURN' ORDER BY id DESC LIMIT 1",[schoolId,paper.id])).rows[0];
      if(returned?.version_id===latest.id) throw new AuthError(409,"Upload a corrected new version before resubmitting");
    }
    const status=paper.status==="RETURNED"?"RESUBMITTED":"SUBMITTED";
    const updated=(await c.query("UPDATE exam_question_papers SET status=$1,revision=revision+1,submitted_at=now(),updated_at=now() WHERE id=$2 RETURNING status,revision",[status,paper.id])).rows[0];
    await auditExam(req,c,schoolId,`${status==="RESUBMITTED"?"Resubmitted":"Submitted"} exam questions`,paper.id,{versionId:latest.id});
    await notify(req,c,paper,status);return updated;
  }));
}));
router.post("/exam-record/questions/:id/review",run(async(req,res)=>{
  const schoolId=numberId(req.body?.schoolId,"schoolId");requireOperator(req,schoolId,"SCHOOL_ADMIN");
  const decision=req.body.decision;
  if(!["RETURN","APPROVE"].includes(decision)) throw new AuthError(400,"Choose Return or Approve");
  const comment=text(req.body.comment??"","Review comment",2000,decision!=="RETURN");
  res.json(await transaction(async c=>{
    const paper=await getPaper(req,c,true);assertRevision(paper.revision,req.body.revision);
    if(!["SUBMITTED","RESUBMITTED"].includes(paper.status)) throw new AuthError(409,"Only submitted question papers may be reviewed");
    const version=(await c.query("SELECT id FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2 ORDER BY revision DESC LIMIT 1",[schoolId,paper.id])).rows[0];
    if(!version)throw new AuthError(409,"Question document is missing");
    await c.query("INSERT INTO exam_question_reviews(school_id,paper_id,version_id,reviewer_user_id,decision,comment) VALUES($1,$2,$3,$4,$5,$6)",
      [schoolId,paper.id,version.id,getUserContext(req).user.id,decision,comment]);
    const status=decision==="APPROVE"?"APPROVED":"RETURNED";
    const updated=(await c.query("UPDATE exam_question_papers SET status=$1,revision=revision+1,approved_at=CASE WHEN $1='APPROVED' THEN now() ELSE NULL END,updated_at=now() WHERE id=$2 RETURNING status,revision",[status,paper.id])).rows[0];
    await auditExam(req,c,schoolId,`${decision==="APPROVE"?"Approved":"Returned"} exam question paper`,paper.id,{versionId:version.id,comment});
    await notify(req,c,paper,status);return updated;
  }));
}));
router.get("/exam-record/questions/:id/document",run(async(req,res)=>{
  const paper=await getPaper(req),versionId=req.query.versionId?numberId(req.query.versionId,"versionId"):null;
  const version=(await pool.query(`SELECT * FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2
    AND ($3::int IS NULL OR id=$3) ORDER BY revision DESC LIMIT 1`,[paper.schoolId,paper.id,versionId])).rows[0];
  if(!version)throw new AuthError(404,"Question version not found");
  res.setHeader("Content-Type",version.mime_type);res.setHeader("Cache-Control","private, no-store");
  res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Content-Disposition",disposition(version.filename));
  res.send(await readQuestionDocument(version));
}));
router.get("/exam-record/questions/:id/print",run(async(req,res)=>{
  const schoolId=numberId(req.query.schoolId,"schoolId");requireOperator(req,schoolId,"SCHOOL_ADMIN");
  const paper=await getPaper(req);
  if(paper.status!=="APPROVED")throw new AuthError(409,"Only approved question papers are ready for official printing");
  const version=(await pool.query("SELECT * FROM exam_question_versions WHERE school_id=$1 AND paper_id=$2 ORDER BY revision DESC LIMIT 1",[schoolId,paper.id])).rows[0];
  const approval=version&&(await pool.query("SELECT id FROM exam_question_reviews WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND decision='APPROVE'",[schoolId,paper.id,version.id])).rows[0];
  if(!approval)throw new AuthError(409,"This exact document version has not been approved");
  const bytes=await readQuestionDocument(version);
  await auditExam(req,pool,schoolId,"Opened approved exam question paper for official printing",paper.id,{versionId:version.id,sha256:version.sha256});
  res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");
  if(version.mime_type.includes("spreadsheet")) {
    res.type("html").send(await printableStructuredPaper(paper,version,bytes));
  } else {
    res.setHeader("Content-Type",version.mime_type);res.setHeader("Content-Disposition",disposition(version.filename));res.send(bytes);
  }
}));
export default router;
