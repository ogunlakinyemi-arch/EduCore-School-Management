import { Router, type IRouter, type NextFunction, type Request } from "express";
import {
  ListStudentClassAssignmentsParams, ListStudentClassAssignmentsQueryParams,
  AssignStudentClassParams, AssignStudentClassQueryParams, AssignStudentClassBody,
  ListAcademicSessionsQueryParams, CreateAcademicSessionQueryParams, CreateAcademicSessionBody,
  ListAcademicTermsParams, ListAcademicTermsQueryParams, CreateAcademicTermParams, CreateAcademicTermQueryParams, CreateAcademicTermBody,
  UpdateAcademicSessionParams, UpdateAcademicSessionQueryParams, UpdateAcademicSessionBody,
  UpdateAcademicTermParams, UpdateAcademicTermQueryParams, UpdateAcademicTermBody,
  ListSubjectsQueryParams, CreateSubjectQueryParams, CreateSubjectBody, GetSubjectParams, GetSubjectQueryParams, UpdateSubjectParams, UpdateSubjectQueryParams, UpdateSubjectBody,
  ListClassSubjectAssignmentsQueryParams, AssignClassSubjectQueryParams, AssignClassSubjectBody,
  ListTeacherClassAssignmentsQueryParams, AssignTeacherClassQueryParams, AssignTeacherClassBody,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { generateSubjectCode } from "../lib/generated-person-codes";
import {
  AuthError,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";
import { ensureCurrentStaffNfcTermSubscriptions } from "./staff-nfc-billing-service";
import { refreshConfiguredTermCalendarEvents } from "../lib/academicCalendarProjection";

const router: IRouter = Router();
router.use(requireAuthentication());
const writeRoles = ["SCHOOL_ADMIN"] as const;
const viewRoles = ["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER"] as const;

function audit(req: Request, schoolId: number, action: string, recordId: number) {
  const c = getUserContext(req);
  const actor = [c.user.firstName, c.user.lastName].filter(Boolean).join(" ") || c.user.email;
  const role = c.roles.find((r) => r.schoolId === schoolId || r.schoolId === null)?.role ?? "AUTHENTICATED";
  return pool.query(`INSERT INTO audit_logs ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id, severity, event_type, result)
    VALUES ($1,$2,$3,$4,$5,$6,'Academics',$7,'info','APPLICATION_EVENT','SUCCESS')`,
    [actor, role, c.user.id, c.user.clerkUserId, schoolId, action, recordId]);
}
function school(req: Request, raw: unknown, roles: readonly string[], operational = false) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new AuthError(400, "A valid schoolId is required");
  if (operational) assertSchoolOperationalAccess(req, id, roles as any);
  else assertSchoolAccess(req, id, roles as any);
  return id;
}
function wrap(fn: (req: Request, res: any) => Promise<void>) {
  return (req: Request, res: any, next: NextFunction) =>
    fn(req, res).catch((error) => handleAuthError(error, req, res, next));
}
const sessionSelect = `id, school_id AS "schoolId", name, start_date AS "startDate", end_date AS "endDate", status, is_current AS "isCurrent"`;
const termSelect = `id, academic_session_id AS "sessionId", name, start_date AS "startDate", end_date AS "endDate", status, is_current AS "isCurrent"`;

function currentFlag(req: Request): boolean {
  if (req.body?.isCurrent !== undefined && typeof req.body.isCurrent !== "boolean") {
    throw new AuthError(400, "isCurrent must be a boolean");
  }
  return req.body?.isCurrent === true;
}

router.get("/academic-sessions", wrap(async (req, res) => {
  const q = ListAcademicSessionsQueryParams.parse(req.query); school(req, q.schoolId, viewRoles);
  const r = await pool.query(`SELECT ${sessionSelect} FROM academic_sessions WHERE school_id=$1 AND ($2='all' OR status=$2) ORDER BY start_date DESC`, [q.schoolId, q.status ?? "all"]);
  res.json(r.rows);
}));
router.post("/academic-sessions", wrap(async (req, res) => {
  const q = CreateAcademicSessionQueryParams.parse(req.query); const b = CreateAcademicSessionBody.parse(req.body); school(req, q.schoolId, writeRoles, true);
  const isCurrent = currentFlag(req);
  const client = await pool.connect();
  let r;
  try {
    await client.query("BEGIN");
    if (isCurrent) await client.query(`UPDATE academic_sessions SET is_current=false, updated_at=NOW() WHERE school_id=$1 AND is_current=true`, [q.schoolId]);
    r = await client.query(`INSERT INTO academic_sessions (school_id,name,start_date,end_date,status,is_current) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${sessionSelect}`, [q.schoolId,b.name,b.startDate,b.endDate,b.status ?? "ACTIVE",isCurrent]);
    await ensureCurrentStaffNfcTermSubscriptions(client, q.schoolId, getUserContext(req).user.id);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await audit(req,q.schoolId,"Created academic session",r.rows[0].id); res.status(201).json(r.rows[0]);
}));
router.patch("/academic-sessions/:sessionId", wrap(async (req, res) => {
  const p = UpdateAcademicSessionParams.parse(req.params), q = UpdateAcademicSessionQueryParams.parse(req.query), b = UpdateAcademicSessionBody.parse(req.body); school(req,q.schoolId,writeRoles,true);
  const wantsCurrent = req.body?.isCurrent !== undefined;
  const isCurrent = currentFlag(req);
  const client = await pool.connect();
  let r;
  try {
    await client.query("BEGIN");
    if (isCurrent) await client.query(`UPDATE academic_sessions SET is_current=false, updated_at=NOW() WHERE school_id=$1 AND id<>$2 AND is_current=true`, [q.schoolId,p.sessionId]);
    r = await client.query(`UPDATE academic_sessions SET name=COALESCE($1,name),start_date=COALESCE($2,start_date),end_date=COALESCE($3,end_date),status=COALESCE($4,status),is_current=CASE WHEN $5 THEN $6 ELSE is_current END,updated_at=NOW() WHERE id=$7 AND school_id=$8 RETURNING ${sessionSelect}`, [b.name??null,b.startDate??null,b.endDate??null,wantsCurrent ? b.status ?? null : b.status ?? null,wantsCurrent,isCurrent,p.sessionId,q.schoolId]);
    await ensureCurrentStaffNfcTermSubscriptions(client, q.schoolId, getUserContext(req).user.id);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  if (!r.rows[0]) throw new AuthError(404,"Academic session not found"); await audit(req,q.schoolId,"Updated academic session",p.sessionId); res.json(r.rows[0]);
}));
router.get("/academic-sessions/:sessionId/terms", wrap(async (req,res) => {
  const p=ListAcademicTermsParams.parse(req.params), q=ListAcademicTermsQueryParams.parse(req.query); school(req,q.schoolId,viewRoles);
  const r=await pool.query(`SELECT ${termSelect} FROM academic_terms WHERE academic_session_id=$1 AND school_id=$2 ORDER BY start_date`,[p.sessionId,q.schoolId]); res.json(r.rows);
}));
router.post("/academic-sessions/:sessionId/terms", wrap(async (req,res) => {
  const p=CreateAcademicTermParams.parse(req.params), q=CreateAcademicTermQueryParams.parse(req.query), b=CreateAcademicTermBody.parse(req.body); school(req,q.schoolId,writeRoles,true);
  const isCurrent = currentFlag(req);
  const exists=await pool.query(`SELECT id FROM academic_sessions WHERE id=$1 AND school_id=$2`,[p.sessionId,q.schoolId]); if(!exists.rows[0]) throw new AuthError(404,"Academic session not found");
  const client = await pool.connect(); let r;
  try {
    await client.query("BEGIN");
    if (isCurrent) await client.query(`UPDATE academic_terms SET is_current=false, updated_at=NOW() WHERE school_id=$1 AND academic_session_id=$2 AND is_current=true`,[q.schoolId,p.sessionId]);
    r=await client.query(`INSERT INTO academic_terms (school_id,academic_session_id,name,start_date,end_date,status,is_current) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${termSelect}`,[q.schoolId,p.sessionId,b.name,b.startDate,b.endDate,b.status??"ACTIVE",isCurrent]);
    await ensureCurrentStaffNfcTermSubscriptions(client, q.schoolId, getUserContext(req).user.id);
    await refreshConfiguredTermCalendarEvents(client, {
      schoolId: q.schoolId,
      sessionId: Number(r.rows[0].sessionId),
      termId: Number(r.rows[0].id),
      actorUserId: getUserContext(req).user.id,
    });
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await audit(req,q.schoolId,"Created academic term",r.rows[0].id); res.status(201).json(r.rows[0]);
}));
router.patch("/academic-terms/:termId", wrap(async(req,res)=>{
  const p=UpdateAcademicTermParams.parse(req.params),q=UpdateAcademicTermQueryParams.parse(req.query),b=UpdateAcademicTermBody.parse(req.body);school(req,q.schoolId,writeRoles,true);
  const wantsCurrent=req.body?.isCurrent !== undefined; const isCurrent=currentFlag(req);
  const client=await pool.connect(); let r;
  try {
    await client.query("BEGIN");
    const target=await client.query(`SELECT academic_session_id FROM academic_terms WHERE id=$1 AND school_id=$2 FOR UPDATE`,[p.termId,q.schoolId]);
    if(!target.rows[0]) throw new AuthError(404,"Academic term not found");
    if(isCurrent) await client.query(`UPDATE academic_terms SET is_current=false,updated_at=NOW() WHERE school_id=$1 AND academic_session_id=$2 AND id<>$3 AND is_current=true`,[q.schoolId,target.rows[0].academic_session_id,p.termId]);
    r=await client.query(`UPDATE academic_terms SET name=COALESCE($1,name),start_date=COALESCE($2,start_date),end_date=COALESCE($3,end_date),status=COALESCE($4,status),is_current=CASE WHEN $5 THEN $6 ELSE is_current END,updated_at=NOW() WHERE id=$7 AND school_id=$8 RETURNING ${termSelect}`,[b.name??null,b.startDate??null,b.endDate??null,b.status??null,wantsCurrent,isCurrent,p.termId,q.schoolId]);
    await ensureCurrentStaffNfcTermSubscriptions(client, q.schoolId, getUserContext(req).user.id);
    await refreshConfiguredTermCalendarEvents(client, {
      schoolId: q.schoolId,
      sessionId: Number(r.rows[0].sessionId),
      termId: Number(r.rows[0].id),
      actorUserId: getUserContext(req).user.id,
    });
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  if(!r.rows[0])throw new AuthError(404,"Academic term not found");await audit(req,q.schoolId,"Updated academic term",p.termId);res.json(r.rows[0]);
}));

router.get("/students/:studentId/class-assignments",wrap(async(req,res)=>{
  const p=ListStudentClassAssignmentsParams.parse(req.params),q=ListStudentClassAssignmentsQueryParams.parse(req.query);school(req,q.schoolId,viewRoles);
  const r=await pool.query(`SELECT a.id,a.student_id AS "studentId",a.school_id AS "schoolId",a.academic_session_id AS "sessionId",a.academic_term_id AS "termId",a.school_class_id AS "classId",c.name AS "className",a.section,a.start_date AS "startDate",a.end_date AS "endDate",a.status FROM student_class_assignments a JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id WHERE a.student_id=$1 AND a.school_id=$2 AND ($3::int IS NULL OR a.academic_session_id=$3) AND ($4='all' OR a.status=$4) ORDER BY a.start_date DESC`,[p.studentId,q.schoolId,q.sessionId??null,q.status??"all"]);res.json(r.rows);
}));
router.post("/students/:studentId/class-assignments",wrap(async(req,res)=>{
  const p=AssignStudentClassParams.parse(req.params),q=AssignStudentClassQueryParams.parse(req.query),b=AssignStudentClassBody.parse(req.body);school(req,q.schoolId,writeRoles,true);
  const client=await pool.connect();try{await client.query("BEGIN");const st=await client.query(`SELECT st.id FROM students st JOIN school_classes c ON c.id=$4 AND c.school_id=st.school_id JOIN academic_sessions s ON s.id=$3 AND s.school_id=st.school_id LEFT JOIN academic_terms t ON t.id=$5 AND t.school_id=st.school_id WHERE st.id=$1 AND st.school_id=$2 AND ($5::int IS NULL OR (t.id IS NOT NULL AND t.academic_session_id=$3))`,[p.studentId,q.schoolId,b.sessionId,b.classId,b.termId??null]);if(!st.rows[0])throw new AuthError(404,"Student or academic resource not found");
    await client.query(`UPDATE student_class_assignments SET is_current=false,status='INACTIVE',end_date=COALESCE(end_date,CURRENT_DATE),updated_at=NOW() WHERE student_id=$1 AND school_id=$2 AND is_current=true`,[p.studentId,q.schoolId]);
     const r=await client.query(`INSERT INTO student_class_assignments (school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,is_current,start_date) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',true,COALESCE($7,CURRENT_DATE)) RETURNING id,student_id AS "studentId",school_id AS "schoolId",academic_session_id AS "sessionId",academic_term_id AS "termId",school_class_id AS "classId",section,start_date AS "startDate",end_date AS "endDate",status`,[q.schoolId,p.studentId,b.sessionId,b.termId??null,b.classId,b.section,b.startDate??null]);
     await client.query(`UPDATE students SET class_name=(SELECT name FROM school_classes WHERE id=$1 AND school_id=$2),section=$3,updated_at=NOW() WHERE id=$4 AND school_id=$2`,[b.classId,q.schoolId,b.section,p.studentId]);
     await client.query("COMMIT");await audit(req,q.schoolId,"Assigned student to class",r.rows[0].id);res.status(201).json(r.rows[0]);}catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
}));

router.get("/subjects",wrap(async(req,res)=>{const q=ListSubjectsQueryParams.parse(req.query);school(req,q.schoolId,viewRoles);const r=await pool.query(`SELECT id,school_id AS "schoolId",name,code,description,status FROM subjects WHERE school_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR name ILIKE $3 OR code ILIKE $3) ORDER BY name`,[q.schoolId,q.status??null,q.search?`%${q.search}%`:null]);res.json(r.rows)}));
router.post("/subjects",wrap(async(req,res)=>{const q=CreateSubjectQueryParams.parse(req.query),b=CreateSubjectBody.parse(req.body);school(req,q.schoolId,writeRoles,true);const r=await pool.query(`INSERT INTO subjects(school_id,name,code,description,status) VALUES($1,$2,$3,$4,$5) RETURNING id,school_id AS "schoolId",name,code,description,status`,[q.schoolId,b.name,generateSubjectCode(b.name),b.description??null,b.status??"ACTIVE"]);await audit(req,q.schoolId,"Created subject",r.rows[0].id);res.status(201).json(r.rows[0])}));
router.get("/subjects/:subjectId",wrap(async(req,res)=>{const p=GetSubjectParams.parse(req.params),q=GetSubjectQueryParams.parse(req.query);school(req,q.schoolId,viewRoles);const r=await pool.query(`SELECT id,school_id AS "schoolId",name,code,description,status FROM subjects WHERE id=$1 AND school_id=$2`,[p.subjectId,q.schoolId]);if(!r.rows[0])throw new AuthError(404,"Subject not found");res.json(r.rows[0])}));
router.patch("/subjects/:subjectId",wrap(async(req,res)=>{
  const p=UpdateSubjectParams.parse(req.params),q=UpdateSubjectQueryParams.parse(req.query),b=UpdateSubjectBody.parse(req.body);
  school(req,q.schoolId,writeRoles,true);
  if(b.code !== undefined) {
    const current=await pool.query("SELECT code FROM subjects WHERE id=$1 AND school_id=$2",[p.subjectId,q.schoolId]);
    if(!current.rows[0]) throw new AuthError(404,"Subject not found");
    if(b.code !== current.rows[0].code) throw new AuthError(409,"Subject codes are permanent");
  }
  const r=await pool.query(`UPDATE subjects SET name=COALESCE($1,name),description=COALESCE($2,description),status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND school_id=$5 RETURNING id,school_id AS "schoolId",name,code,description,status`,[b.name??null,b.description??null,b.status??null,p.subjectId,q.schoolId]);
  if(!r.rows[0])throw new AuthError(404,"Subject not found");await audit(req,q.schoolId,"Updated subject",p.subjectId);res.json(r.rows[0]);
}));

router.get("/class-subject-assignments",wrap(async(req,res)=>{
  const q=ListClassSubjectAssignmentsQueryParams.parse(req.query); school(req,q.schoolId,viewRoles);
  const vals:any[]=[q.schoolId]; const w=["cs.school_id=$1"];
  if(q.classId){vals.push(q.classId);w.push(`cs.school_class_id=$${vals.length}`)}
  if(q.subjectId){vals.push(q.subjectId);w.push(`cs.subject_id=$${vals.length}`)}
  if(q.sessionId){vals.push(q.sessionId);w.push(`cs.academic_session_id=$${vals.length}`)}
  const r=await pool.query(`SELECT cs.id,cs.school_id AS "schoolId",cs.school_class_id AS "classId",cs.subject_id AS "subjectId",cs.academic_session_id AS "sessionId",cs.academic_term_id AS "termId",cs.employee_id AS "teacherId",cs.section,cs.status FROM class_subjects cs WHERE ${w.join(" AND ")} ORDER BY cs.id`,vals);
  res.json(r.rows);
}));
router.post("/class-subject-assignments",wrap(async(req,res)=>{
  const q=AssignClassSubjectQueryParams.parse(req.query),b=AssignClassSubjectBody.parse(req.body); school(req,q.schoolId,writeRoles,true);
  const valid=await pool.query(`SELECT c.id FROM school_classes c JOIN subjects s ON s.id=$3 AND s.school_id=c.school_id JOIN academic_sessions ac ON ac.id=$4 AND ac.school_id=c.school_id LEFT JOIN academic_terms at ON at.id=$5 AND at.school_id=c.school_id LEFT JOIN employees e ON e.id=$6 AND e.school_id=c.school_id WHERE c.id=$2 AND c.school_id=$1 AND ($5::int IS NULL OR (at.id IS NOT NULL AND at.academic_session_id=$4)) AND ($6::int IS NULL OR e.id IS NOT NULL)`,[q.schoolId,b.classId,b.subjectId,b.sessionId,b.termId??null,b.teacherId??null]);
  if(!valid.rows[0])throw new AuthError(404,"Class, subject, session, term, or teacher not found in school");
  const r=await pool.query(`INSERT INTO class_subjects(school_id,school_class_id,subject_id,academic_session_id,academic_term_id,employee_id,section,status) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE') RETURNING id,school_id AS "schoolId",school_class_id AS "classId",subject_id AS "subjectId",academic_session_id AS "sessionId",academic_term_id AS "termId",employee_id AS "teacherId",section,status`,[q.schoolId,b.classId,b.subjectId,b.sessionId,b.termId??null,b.teacherId??null,b.section??null]);
  await audit(req,q.schoolId,"Assigned subject to class",r.rows[0].id); res.status(201).json(r.rows[0]);
}));

router.get("/teacher-class-assignments",wrap(async(req,res)=>{const q=ListTeacherClassAssignmentsQueryParams.parse(req.query);school(req,q.schoolId,viewRoles);const vals:any[]=[q.schoolId];const w=["a.school_id=$1"];if(q.employeeId){vals.push(q.employeeId);w.push(`a.employee_id=$${vals.length}`)}if(q.sessionId){vals.push(q.sessionId);w.push(`a.academic_session_id=$${vals.length}`)}if(q.status&&q.status!=="all"){vals.push(q.status);w.push(`a.status=$${vals.length}`)}const r=await pool.query(`SELECT a.id,a.school_id AS "schoolId",a.employee_id AS "teacherId",a.academic_session_id AS "sessionId",a.school_class_id AS "classId",a.section,a.assignment_type AS "assignmentType",a.subject_id AS "subjectId",a.start_date AS "startDate",a.end_date AS "endDate",a.status FROM teacher_class_assignments a WHERE ${w.join(" AND ")} ORDER BY a.start_date DESC`,vals);res.json(r.rows)}));
  router.post("/teacher-class-assignments",wrap(async(req,res)=>{const q=AssignTeacherClassQueryParams.parse(req.query),b=AssignTeacherClassBody.parse(req.body);school(req,q.schoolId,writeRoles,true);const client=await pool.connect();try{await client.query("BEGIN");const valid=await client.query(`SELECT e.id FROM employees e JOIN school_classes c ON c.id=$4 AND c.school_id=e.school_id JOIN academic_sessions s ON s.id=$3 AND s.school_id=e.school_id LEFT JOIN subjects sub ON sub.id=$5 AND sub.school_id=e.school_id WHERE e.id=$2 AND e.school_id=$1 AND ($5::int IS NULL OR sub.id IS NOT NULL)`,[q.schoolId,b.teacherId,b.sessionId,b.classId,b.subjectId??null]);if(!valid.rows[0])throw new AuthError(404,"Teacher, class, subject, or session not found in school");await client.query(`UPDATE teacher_class_assignments SET status='INACTIVE',end_date=COALESCE(end_date,CURRENT_DATE),updated_at=NOW() WHERE school_id=$1 AND employee_id=$2 AND academic_session_id=$3 AND school_class_id=$4 AND section=COALESCE($5,section) AND assignment_type=$6 AND ($6<>'SUBJECT_TEACHER' OR subject_id IS NOT DISTINCT FROM $7) AND status='ACTIVE'`,[q.schoolId,b.teacherId,b.sessionId,b.classId,b.section??null,b.assignmentType,b.subjectId??null]);const r=await client.query(`INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,subject_id,section,assignment_type,status,start_date) VALUES($1,$2,$3,$4,$5,COALESCE($6,''),$7,'ACTIVE',$8) RETURNING id,school_id AS "schoolId",employee_id AS "teacherId",academic_session_id AS "sessionId",school_class_id AS "classId",section,assignment_type AS "assignmentType",subject_id AS "subjectId",start_date AS "startDate",end_date AS "endDate",status`,[q.schoolId,b.teacherId,b.sessionId,b.classId,b.subjectId??null,b.section??null,b.assignmentType,b.startDate]);await client.query("COMMIT");await audit(req,q.schoolId,"Assigned teacher to class",r.rows[0].id);res.status(201).json(r.rows[0]);}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}));
export default router;