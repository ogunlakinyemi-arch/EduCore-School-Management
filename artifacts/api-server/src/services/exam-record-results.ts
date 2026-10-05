import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext } from "../middlewares/auth";
import { periodStudents, compileStudent } from "./result-compilation";
import { assignedTeacher, auditExam, batchWhere, scopeValues, validatePeriod, assertRevision, type ExamScope } from "./exam-record-scope";
import { numericScore, type Component } from "./exam-record-import";

export async function classLock(client:any,s:Pick<ExamScope,"schoolId"|"sessionId"|"termId"|"classId"|"section">) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`exam-record:${s.schoolId}:${s.sessionId}:${s.termId}:${s.classId}:${s.section}`]);
}
export async function gradingRules(client:any,schoolId:number) {
  return (await client.query(`SELECT min_score AS "minScore",max_score AS "maxScore",grade,grade_point AS "gradePoint",remark
    FROM academic_grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY min_score`,[schoolId])).rows.map((r:any)=>({
      ...r,minScore:Number(r.minScore),maxScore:Number(r.maxScore),gradePoint:r.gradePoint==null?null:Number(r.gradePoint)}));
}
export function calculateGrade(score:number,max:number,rules:any[]) {
  const percent=score*100/max;
  const matches=rules.filter(r=>percent>=Number(r.minScore)&&percent<=Number(r.maxScore));
  if(matches.length>1) throw new AuthError(409,"School grading rules overlap for this score");
  const rule=matches[0];
  return {grade:rule?.grade??null,gradePoint:rule?.gradePoint??null,remark:rule?.remark??null};
}
export async function sheet(req:Request,s:ExamScope,client:any=pool) {
  const teacherId=await assignedTeacher(req,s,client);
  await validatePeriod(client,s);
  const batch=(await client.query(`SELECT * FROM academic_result_batches WHERE ${batchWhere}`,scopeValues(s))).rows[0];
  if(batch&&Number(batch.teacher_employee_id)!==teacherId) throw new AuthError(409,"This sheet belongs to an earlier teacher; its history cannot be reassigned");
  const assessments=(await client.query(`SELECT id,assessment_type_id AS "typeId",title AS label,max_score AS "maxScore"
    FROM academic_assessments WHERE school_id=$1 AND academic_session_id=$2 AND academic_term_id=$3
    AND school_class_id=$4 AND COALESCE(section,'')=$5 AND subject_id=$6 AND teacher_employee_id=$7 AND status<>'ARCHIVED' ORDER BY id`,
    [...scopeValues(s),teacherId])).rows;
  const components:Component[]=batch?.components??assessments.map((a:any)=>({key:`a${a.id}`,label:a.label,typeId:a.typeId,maxScore:Number(a.maxScore),assessmentId:a.id}));
  if(!components.length) {
    const types=(await client.query(`SELECT t.id,t.name,array_agg(DISTINCT a.max_score) FILTER(WHERE a.id IS NOT NULL) maxima
      FROM academic_assessment_types t LEFT JOIN academic_assessments a ON a.school_id=t.school_id AND a.assessment_type_id=t.id AND a.status<>'ARCHIVED'
      WHERE t.school_id=$1 AND t.status='ACTIVE' GROUP BY t.id ORDER BY t.id`,[s.schoolId])).rows;
    for(const type of types) components.push({key:`type${type.id}`,label:type.name,typeId:type.id,maxScore:type.maxima?.length===1?Number(type.maxima[0]):0});
  }
  const students=await periodStudents(client,s);
  const scores=(await client.query(`SELECT r.* FROM academic_results r WHERE r.school_id=$1 AND r.academic_session_id=$2 AND r.academic_term_id=$3
    AND r.school_class_id=$4 AND r.section_snapshot=$5 AND r.subject_id=$6 AND r.teacher_employee_id=$7 AND r.status<>'ARCHIVED'`,
    [...scopeValues(s),teacherId])).rows;
  const published=scores.some((r:any)=>r.status==="PUBLISHED");
  const returned=scores.some((r:any)=>r.review_status==="RETURNED");
  return {scope:s,components,batchId:batch?.id??null,revision:batch?.revision??0,
    status:published?"LOCKED":batch?.status??(returned?"RETURNED":scores.some((r:any)=>r.status==="SUBMITTED")?"SUBMITTED":"DRAFT"),
    returnComment:batch?.return_comment??null,gradingRules:await gradingRules(client,s.schoolId),
    rows:students.map((st:any)=>({studentId:st.id,studentName:`${st.firstName} ${st.lastName}`,admissionNo:st.admissionNo,
      scores:Object.fromEntries(components.map(c=>{
        const value=scores.find((r:any)=>Number(r.student_id)===Number(st.id)&&
          Number(r.student_class_assignment_id)===Number(st.studentClassAssignmentId)&&Number(r.assessment_id)===Number(c.assessmentId))?.score;
        return [c.key,value==null?null:Number(value)];
      }))}))};
}
export function validateComponents(raw:any):Component[] {
  if(!Array.isArray(raw)||!raw.length||raw.length>16) throw new AuthError(400,"Select between 1 and 16 result components");
  const keys=new Set<string>(),labels=new Set<string>();
  return raw.map(c=>{
    if(!c||typeof c.key!=="string"||!/^[a-zA-Z0-9_-]{1,60}$/.test(c.key)||keys.has(c.key)||
      typeof c.label!=="string"||!c.label.trim()||c.label.length>200||labels.has(c.label.trim().toLowerCase())||
      !Number.isSafeInteger(c.typeId)||c.typeId<1||!Number.isFinite(c.maxScore)||c.maxScore<=0||c.maxScore>99999999.99||
      Math.abs(c.maxScore*100-Math.round(c.maxScore*100))>1e-6) throw new AuthError(400,"Each component needs a unique name/key, a school assessment type, and a valid maximum mark");
    keys.add(c.key);labels.add(c.label.trim().toLowerCase());
    if(c.assessmentId!==undefined&&(!Number.isSafeInteger(c.assessmentId)||c.assessmentId<1)) throw new AuthError(400,"Invalid component assessment");
    return {key:c.key,label:c.label.trim(),typeId:c.typeId,maxScore:c.maxScore,...(c.assessmentId?{assessmentId:c.assessmentId}:{})};
  });
}
export async function saveSheet(req:Request,s:ExamScope,body:any,client:any) {
  const teacherId=await assignedTeacher(req,s,client);
  const period=await validatePeriod(client,s);
  await classLock(client,s);
  const previous=await sheet(req,s,client);
  assertRevision(previous.revision,body.revision);
  if(!["DRAFT","RETURNED"].includes(previous.status)) throw new AuthError(409,"Submitted and published results are locked. Request a school review first.");
  const components=validateComponents(body.components);
  if(!Array.isArray(body.rows)||body.rows.length>3000) throw new AuthError(400,"Result rows are required");
  const roster=await periodStudents(client,s);
  if(!roster.length) throw new AuthError(409,"No students are assigned to this academic period and class/section");
  const seen=new Set<number>();
  const rows=body.rows.map((r:any)=>{
    const st=roster.find((v:any)=>v.id===r.studentId);
    if(!st||seen.has(r.studentId)||!r.scores||typeof r.scores!=="object"||Array.isArray(r.scores)) throw new AuthError(400,"Unknown, out-of-class or duplicate student row");
    seen.add(r.studentId);
    if(Object.keys(r.scores).some(k=>!components.some(c=>c.key===k))) throw new AuthError(400,"Unknown score component");
    return {student:st,scores:Object.fromEntries(components.map(c=>[c.key,numericScore(r.scores[c.key],c.maxScore)]))};
  });
  for(const existing of previous.components) {
    if(existing.assessmentId&&!components.some(c=>c.assessmentId===existing.assessmentId)) throw new AuthError(409,"Existing assessment columns must be retained to preserve academic records");
  }
  const types=(await client.query("SELECT id FROM academic_assessment_types WHERE school_id=$1 AND status='ACTIVE'",[s.schoolId])).rows;
  for(const c of components) {
    if(!types.some((t:any)=>t.id===c.typeId)) throw new AuthError(400,"Assessment type is not active in this school");
    if(c.assessmentId) {
      const a=(await client.query(`SELECT * FROM academic_assessments WHERE id=$1 AND school_id=$2 FOR UPDATE`,[c.assessmentId,s.schoolId])).rows[0];
      if(!a||a.academic_session_id!==s.sessionId||a.academic_term_id!==s.termId||a.school_class_id!==s.classId||
        (a.section??"")!==s.section||a.subject_id!==s.subjectId||a.teacher_employee_id!==teacherId||
        a.assessment_type_id!==c.typeId||Number(a.max_score)!==c.maxScore||a.status==="ARCHIVED") throw new AuthError(409,"Existing assessment scope and maximum marks cannot be silently changed");
    } else {
      const created=await client.query(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,
        assessment_type_id,teacher_employee_id,created_by,title,description,assessment_date,max_score,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Teacher result-entry component',$11,$12,'OPEN') RETURNING id`,
        [...scopeValues(s),c.typeId,teacherId,getUserContext(req).user.id,c.label,period.end_date,c.maxScore]);
      c.assessmentId=created.rows[0].id;
    }
  }
  const rules=await gradingRules(client,s.schoolId);
  for(const row of rows) for(const c of components) {
    const score=row.scores[c.key];
    const old=(await client.query("SELECT * FROM academic_results WHERE school_id=$1 AND assessment_id=$2 AND student_id=$3 FOR UPDATE",[s.schoolId,c.assessmentId,row.student.id])).rows[0];
    if(old&&(old.status!=="DRAFT"||old.teacher_employee_id!==teacherId||old.student_class_assignment_id!==row.student.studentClassAssignmentId)) {
      throw new AuthError(409,"Existing submitted, published, or historical-assignment scores cannot be replaced");
    }
    // Clearing a persisted numeric value needs an explicit correction; never silently delete a result.
    if(score===null) { if(old) throw new AuthError(409,"A saved score cannot be cleared; enter a corrected numeric value"); continue; }
    const grade=calculateGrade(score,c.maxScore,rules);
    await client.query(`INSERT INTO academic_results(school_id,assessment_id,student_id,student_class_assignment_id,teacher_employee_id,
      academic_session_id,academic_term_id,school_class_id,section_snapshot,subject_id,score,max_score,grade,grade_point,remark,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'DRAFT',$16)
      ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=EXCLUDED.score,grade=EXCLUDED.grade,grade_point=EXCLUDED.grade_point,
        remark=EXCLUDED.remark,updated_at=now()`,
      [s.schoolId,c.assessmentId,row.student.id,row.student.studentClassAssignmentId,teacherId,s.sessionId,s.termId,s.classId,s.section,
        s.subjectId,score,c.maxScore,grade.grade,grade.gradePoint,grade.remark,getUserContext(req).user.id]);
  }
  const batch=await client.query(`INSERT INTO academic_result_batches(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,
    teacher_employee_id,components,status,revision,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,1,$10)
    ON CONFLICT(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id)
    DO UPDATE SET components=EXCLUDED.components,revision=academic_result_batches.revision+1,updated_at=now() RETURNING id`,
    [...scopeValues(s),teacherId,JSON.stringify(components),previous.status,getUserContext(req).user.id]);
  await auditExam(req,client,s.schoolId,"Saved teacher subject result draft",batch.rows[0].id,
    {scope:s,previousRevision:previous.revision,previousRows:previous.rows,components,rows:body.rows});
  return sheet(req,s,client);
}
export async function compileDraftCards(client:any,s:ExamScope) {
  const students=await periodStudents(client,s);
  for(const student of students) {
    const compiled=await compileStudent(client,s,student);
    if(!compiled.complete||compiled.subjects.some((subject:any)=>!subject.grade)) continue;
    const existing=(await client.query(`SELECT * FROM academic_report_cards WHERE school_id=$1 AND student_id=$2
      AND academic_session_id=$3 AND academic_term_id=$4 FOR UPDATE`,[s.schoolId,student.id,s.sessionId,s.termId])).rows[0];
    if(existing&&(existing.status!=="DRAFT"||existing.student_class_assignment_id!==student.studentClassAssignmentId)) continue;
    if(existing&&(await client.query(`SELECT 1 FROM audit_logs WHERE school_id=$1 AND record_id=$2 AND action='Approved academic report card'`,[s.schoolId,existing.id])).rows.length) continue;
    const cardId=existing?.id??(await client.query(`INSERT INTO academic_report_cards(school_id,student_id,academic_session_id,academic_term_id,
      student_class_assignment_id,school_class_id,class_name_snapshot,section_snapshot,status,teacher_remark,school_remark)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT','','') RETURNING id`,
      [s.schoolId,student.id,s.sessionId,s.termId,student.studentClassAssignmentId,s.classId,student.className,s.section])).rows[0].id;
    for(const subject of compiled.subjects) {
      await client.query(`INSERT INTO academic_report_card_lines(school_id,report_card_id,result_id,subject_id,subject_name_snapshot,
        assessment_name_snapshot,score,max_score,grade,grade_point,remark)
        SELECT r.school_id,$1,r.id,r.subject_id,$2,a.title,r.score,r.max_score,COALESCE(r.grade,$3),COALESCE(r.grade_point,0),COALESCE(r.remark,'')
        FROM academic_results r JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id WHERE r.school_id=$4 AND r.id=ANY($5::int[])
        ON CONFLICT(report_card_id,result_id) DO UPDATE SET score=EXCLUDED.score,max_score=EXCLUDED.max_score,grade=EXCLUDED.grade,
          grade_point=EXCLUDED.grade_point,remark=EXCLUDED.remark`,[cardId,subject.subjectName,subject.grade,s.schoolId,subject.resultIds]);
    }
  }
}
