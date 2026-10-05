import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, getUserContext, assertSchoolOperationalAccess } from "../middlewares/auth";
import { timetableSelectionSql } from "../lib/timetable-selection-sql";

export type ExamScope = { schoolId:number; sessionId:number; termId:number; classId:number; section:string; subjectId:number };
export const numberId = (value:unknown,label:string) => {
  const n = Number(value);
  if(!Number.isSafeInteger(n)||n<1) throw new AuthError(400,`${label} must be a positive integer`);
  return n;
};
export function text(value:unknown,label:string,max=250,optional=false) {
  if(optional && value==null) return "";
  if(typeof value!=="string"||value.length>max||(!optional&&!value.trim())) throw new AuthError(400,`${label} is invalid`);
  return value.trim();
}
export function scopeFrom(raw:any):ExamScope {
  if(!raw||typeof raw!=="object") throw new AuthError(400,"Academic scope is required");
  return {schoolId:numberId(raw.schoolId,"schoolId"),sessionId:numberId(raw.sessionId,"sessionId"),
    termId:numberId(raw.termId,"termId"),classId:numberId(raw.classId,"classId"),
    subjectId:numberId(raw.subjectId,"subjectId"),section:text(raw.section??"","section",80,true)};
}
export function scopeValues(s:ExamScope) {
  return [s.schoolId,s.sessionId,s.termId,s.classId,s.section,s.subjectId];
}
export function schoolRole(req:Request,schoolId:number) {
  const ctx=getUserContext(req);
  if(ctx.roles.some(r=>r.status==="ACTIVE"&&r.role==="PLATFORM_OWNER"&&r.schoolId===null)) return "OWNER" as const;
  const roles=ctx.roles.filter(r=>r.status==="ACTIVE"&&r.schoolId===schoolId).map(r=>r.role);
  if(roles.includes("SCHOOL_ADMIN")) return "ADMIN" as const;
  if(roles.includes("TEACHER")) return "TEACHER" as const;
  throw new AuthError(404,"Exam/Record not found");
}
export function requireOperator(req:Request,schoolId:number,role:"TEACHER"|"SCHOOL_ADMIN") {
  assertSchoolOperationalAccess(req,schoolId,[role]);
  const actual=schoolRole(req,schoolId);
  if((role==="TEACHER"&&actual!=="TEACHER")||(role==="SCHOOL_ADMIN"&&actual!=="ADMIN")) throw new AuthError(403,"This action belongs to the assigned school role");
}
export async function validatePeriod(client:any,s:Pick<ExamScope,"schoolId"|"sessionId"|"termId">) {
  const r=await client.query(`SELECT t.start_date,t.end_date,s.name AS "sessionName",t.name AS "termName"
    FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
    WHERE t.school_id=$1 AND s.id=$2 AND t.id=$3`,[s.schoolId,s.sessionId,s.termId]);
  if(!r.rows.length) throw new AuthError(404,"Academic session/term not found in this school");
  return r.rows[0];
}
// Reuse the complete existing staffing predicate, then require explicit subject ownership.
// A class-teacher appointment alone must never grant another teacher's subject scores.
export async function assignedTeacher(req:Request,s:ExamScope,client:any=pool) {
  requireOperator(req,s.schoolId,"TEACHER");
  const employee=await client.query(`SELECT id FROM employees WHERE school_id=$1 AND user_id=$2
    AND employee_type='TEACHER' AND employment_status='ACTIVE'`,[s.schoolId,getUserContext(req).user.id]);
  if(!employee.rows.length) throw new AuthError(404,"Teaching assignment not found");
  for(const row of employee.rows) {
    const values=[s.schoolId,s.sessionId,s.termId,s.classId,s.subjectId,row.id,s.section];
    const allowed=await client.query(`${timetableSelectionSql} AND (
      EXISTS(SELECT 1 FROM class_subjects own WHERE own.school_id=$1 AND own.academic_session_id=$2
        AND (own.academic_term_id IS NULL OR own.academic_term_id=$3) AND own.school_class_id=$4 AND own.subject_id=$5
        AND (NULLIF(own.section,'') IS NULL OR own.section=$7) AND own.employee_id=$6 AND own.status='ACTIVE')
      OR EXISTS(SELECT 1 FROM teacher_class_assignments own WHERE own.school_id=$1 AND own.academic_session_id=$2
        AND own.school_class_id=$4 AND own.subject_id=$5 AND own.employee_id=$6 AND own.status='ACTIVE'
        AND own.assignment_type='SUBJECT_TEACHER' AND (own.section='' OR own.section=$7)
        AND own.start_date<=(SELECT end_date FROM academic_terms WHERE id=$3 AND school_id=$1)
        AND (own.end_date IS NULL OR own.end_date>=(SELECT start_date FROM academic_terms WHERE id=$3 AND school_id=$1))))`,values);
    if(allowed.rows.length) return Number(row.id);
  }
  throw new AuthError(404,"Teacher is not assigned to this class, section, subject, session and term");
}
export async function auditExam(req:Request,client:any,schoolId:number,action:string,recordId:number,metadata:unknown={}) {
  const ctx=getUserContext(req);
  await client.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
    VALUES($1,$2,$3,$4,$5,$6,'ExamRecord',$7,'info','EXAM_RECORD_WORKFLOW','SUCCESS',$8::jsonb)`,
    [[ctx.user.firstName,ctx.user.lastName].filter(Boolean).join(" ")||ctx.user.email,
      {OWNER:"PLATFORM_OWNER",ADMIN:"SCHOOL_ADMIN",TEACHER:"TEACHER"}[schoolRole(req,schoolId)],ctx.user.id,
      ctx.user.clerkUserId,schoolId,action,recordId,JSON.stringify(metadata)]);
}
export function assertRevision(actual:number,expected:unknown) {
  if(!Number.isSafeInteger(expected)||expected!==actual) throw new AuthError(409,"This record changed. Refresh before saving or reviewing.");
}
export const batchWhere = "school_id=$1 AND academic_session_id=$2 AND academic_term_id=$3 AND school_class_id=$4 AND section=$5 AND subject_id=$6";
