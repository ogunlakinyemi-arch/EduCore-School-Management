import { AuthError } from "../middlewares/auth";
import { classLock } from "./exam-record-results";
import { periodStudents } from "./result-compilation";
export async function guardManagedLegacyCardCreation(client:any,scope:{schoolId:number;sessionId:number;termId:number;studentId:number}) {
  const students=await periodStudents(client,scope);
  if(!students.length)return;
  const row=students[0];await classLock(client,{...scope,classId:row.classId,section:row.section});
  const managed=(await client.query(`SELECT id FROM academic_result_batches WHERE school_id=$1 AND academic_session_id=$2
    AND academic_term_id=$3 AND school_class_id=$4 AND section=$5 LIMIT 1`,
    [scope.schoolId,scope.sessionId,scope.termId,row.classId,row.section])).rows[0];
  if(managed)throw new AuthError(409,"Exam/Record compiles this period automatically. Review and publish the consolidated draft there.");
}

// Legacy mutations and the simple sheet take the same period/class lock.
// Old historical records without a managed batch retain their existing journey.
export async function guardManagedLegacyResource(client:any,schoolId:number,kind:"assessment"|"result"|"card",id:number) {
  const table={assessment:"academic_assessments",result:"academic_results",card:"academic_report_cards"}[kind];
  const section=kind==="assessment"?"section":"section_snapshot";
  const row=(await client.query(`SELECT academic_session_id AS "sessionId",academic_term_id AS "termId",
    school_class_id AS "classId",COALESCE(${section},'') AS section ${kind==="card"?"":",subject_id AS \"subjectId\""}
    FROM ${table} WHERE school_id=$1 AND id=$2`,[schoolId,id])).rows[0];
  if(!row)return;
  await classLock(client,{...row,schoolId});
  const managed=(await client.query(`SELECT id FROM academic_result_batches WHERE school_id=$1 AND academic_session_id=$2
    AND academic_term_id=$3 AND school_class_id=$4 AND section=$5 ${kind==="card"?"":"AND subject_id=$6"} LIMIT 1`,
    [schoolId,row.sessionId,row.termId,row.classId,row.section,...(kind==="card"?[]:[row.subjectId])])).rows[0];
  if(managed)throw new AuthError(409,"This period uses Exam/Record. Use its teacher sheet and consolidated School Admin review rather than legacy per-result actions.");
}
