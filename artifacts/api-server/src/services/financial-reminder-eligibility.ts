import {familyChildSchoolScope} from "../lib/family-child-school-scope";
import {publishedSchoolInvoiceSql} from "./school-fee-carry-forward";
import {financialSnapshot,parseFinancialReminder,guardianNfcReminderContent} from "./financial-reminder-policy";
import {readSchoolSubscription} from "./subscription-enforcement";
import {readStaffSubscriptionAccess} from "./staff-subscription-access";
import {readManualSchoolState} from "./school-subscription-lock";
import {readStudentUsageRollout,lagosDate} from "./student-platform-rollout";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
export type FinancialReminderRecord={eventKey:string|null;schoolId:number|string|null;recipientUserId:number|string;
 subjectStudentId?:number|string|null;subjectClassId?:number|string|null;
 category?:string;subject?:string|null;body?:string;link?:string|null};
/** Existing live family/tenant scope plus an active guardian role. Deliberately
 * selects no financial record, amount, name interpolation or private reference. */
export const guardianStudentNfcSql=`SELECT DISTINCT st.id AS "studentId",st.school_id AS "schoolId",p.user_id AS "recipientUserId"
 FROM students st JOIN schools sc ON sc.id=st.school_id AND lower(sc.status)='active'
 JOIN parent_student_relationships rel ON rel.student_id=st.id AND upper(rel.status)='ACTIVE'
 JOIN parents p ON p.id=rel.parent_id AND upper(p.status)='ACTIVE' AND ${familyChildSchoolScope("p","st")}
 JOIN app_users u ON u.id=p.user_id AND upper(u.status)='ACTIVE'
 JOIN school_memberships guardian_role ON guardian_role.user_id=p.user_id AND guardian_role.school_id=st.school_id
  AND guardian_role.role='PARENT' AND upper(guardian_role.status)='ACTIVE'
 WHERE st.school_id=$1 AND lower(st.status)='active' AND upper(st.admission_status)='ADMITTED'`;
export async function guardianNfcReminderSnapshot(db:Db,schoolId:number,studentId:number,termId:number,userId:number,now=new Date()){
 const authorized=(await db.query(`${guardianStudentNfcSql} AND st.id=$2 AND p.user_id=$3`,
  [schoolId,studentId,userId])).rows;
 if(!authorized.length)return null;
 const rollout=await readStudentUsageRollout(db,schoolId,undefined,lagosDate(now));
 if(!rollout.chargeable||rollout.inGracePeriod||rollout.termId!==termId)return null;
 // Reuse the existing entitlement decision, including verified direct/bulk/bank
 // credits, explicit free terms, legacy holds and per-student exclusions.
 // Aggregate totals and other students' identities never enter the public digest.
 const access=await readSchoolSubscription(db,schoolId);
 if(!access||Number(access.termId)!==termId||!["UNPAID","PENDING","PARTIALLY_PAID","OVERDUE"].includes(access.status)||access.inGracePeriod
  ||!access.restrictedStudentIds.includes(studentId))return null;
 return financialSnapshot([schoolId,studentId,termId,rollout.termStartDate,rollout.collectionStartDate,"REQUIRED_NFC_OUTSTANDING"]);
}
export const guardianSchoolFeeSql=`SELECT i.id,i.school_id AS "schoolId",i.student_id AS "studentId",
 i.academic_term_id AS "termId",i.invoice_number AS number,i.due_date::text AS due,
 i.total_minor AS total,i.paid_minor AS paid,i.outstanding_minor AS outstanding,
 i.discount_minor AS discount,i.waiver_minor AS waiver,i.currency,i.status,
 sc.name AS "schoolName",st.first_name||' '||st.last_name AS "studentName",p.user_id AS "recipientUserId"
 FROM fee_invoices i JOIN schools sc ON sc.id=i.school_id AND lower(sc.status)='active'
 JOIN students st ON st.id=i.student_id AND st.school_id=i.school_id
  AND lower(st.status)='active' AND upper(st.admission_status)='ADMITTED'
 JOIN parent_student_relationships rel ON rel.student_id=st.id AND upper(rel.status)='ACTIVE'
 JOIN parents p ON p.id=rel.parent_id AND upper(p.status)='ACTIVE' AND ${familyChildSchoolScope("p","st")}
 JOIN app_users u ON u.id=p.user_id AND upper(u.status)='ACTIVE'
 WHERE i.school_id=$1 AND i.outstanding_minor>0 AND i.due_date<=$2::date
 AND i.currency='NGN' AND i.status IN ('UNPAID','PARTIALLY_PAID','OVERDUE')
 AND ${publishedSchoolInvoiceSql("i")}`;
export function feeReminderDigest(r:any){
 return financialSnapshot([Number(r.id),Number(r.schoolId),Number(r.studentId),Number(r.termId),
  r.number,r.due,Number(r.total),Number(r.paid),Number(r.outstanding),Number(r.discount),Number(r.waiver),r.currency,r.status,
  r.schoolName,r.studentName]);
}
/** One finance reminder per school/term, not an O(students²) re-read and not
 * a list of individual children's internal liabilities sent to guardians. */
export async function studentNfcReminderSnapshot(db:Db,schoolId:number,scopeId:number,termId:number){
 if(scopeId!==schoolId)return null;
 const rollout=await readStudentUsageRollout(db,schoolId);
 if(!rollout.chargeable||rollout.termId!==termId)return null;
 const access=await readSchoolSubscription(db,schoolId);
 if(!access||Number(access.termId)!==termId||access.status==="UNAVAILABLE"||access.inGracePeriod
  ||access.outstandingMinor<=0||access.studentsAffected<=0)return null;
 return financialSnapshot([schoolId,termId,rollout.termStartDate,rollout.collectionStartDate,
  access.outstandingMinor,[...access.restrictedStudentIds].sort((a,b)=>a-b)]);
}
export async function staffNfcReminderSnapshot(db:Db,schoolId:number,employeeId:number,termId:number,userId:number){
 const employee=(await db.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND user_id=$3
  AND upper(employment_status)='ACTIVE' AND upper(employee_type) IN ('TEACHER','STAFF')`,[employeeId,schoolId,userId])).rows[0];
 if(!employee)return null;
 // An independent Owner lock is not an unpaid entitlement and must not abort
 // other schools'/guardians' ordinary-fee reminders or suggest payment lifts it.
 if((await readManualSchoolState(db,schoolId)).schoolLocked)return null;
 const access=await readStaffSubscriptionAccess(db as any,userId,schoolId);
 if(access.termId!==termId||!access.restricted||access.priceMinor<=0||!["UNPAID","PENDING","FAILED","REFUNDED","PARTIALLY_REFUNDED"].includes(access.status))return null;
 return financialSnapshot([schoolId,employeeId,termId,access.status,access.subscriptionId]);
}
/** Runs before every transport attempt, not just when the notification is queued.
 * An old balance, paid/withdrawn charge, removed guardian or prior scheduled day
 * cancels the stale delivery; history is retained. */
export async function financialReminderStillCurrent(db:Db,record:FinancialReminderRecord,now=new Date()){
 const event=parseFinancialReminder(record.eventKey);
 if(!event||event.day!==lagosDate(now)||record.schoolId===null)return false;
 const schoolId=Number(record.schoolId),userId=Number(record.recipientUserId);
 if(event.kind==="GUARDIAN_NFC"){
  if(Number(record.subjectStudentId)!==event.entity||record.subjectClassId!=null
   ||record.category!==guardianNfcReminderContent.category||record.subject!==guardianNfcReminderContent.subject
   ||record.body!==guardianNfcReminderContent.body||record.link!==null)return false;
  return await guardianNfcReminderSnapshot(db,schoolId,event.entity,event.term,userId,now)===event.digest;
 }
 if(event.kind==="FEE"){
  const rows=(await db.query(`${guardianSchoolFeeSql} AND i.id=$3 AND p.user_id=$4`,
   [schoolId,event.day,event.entity,userId])).rows;
  return rows.length>0&&rows.every(r=>Number(r.studentId)===Number(record.subjectStudentId)
   &&Number(r.termId)===event.term&&feeReminderDigest(r)===event.digest);
 }
 const school=(await db.query(`SELECT id FROM schools WHERE id=$1 AND lower(status)='active'`,[schoolId])).rows[0];
 if(!school)return false;
 if(event.kind==="STAFF_NFC")return record.subjectStudentId==null&&
  await staffNfcReminderSnapshot(db,schoolId,event.entity,event.term,userId)===event.digest;
 const authority=(await db.query(`SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=$2
  AND status='ACTIVE' AND role IN ('SCHOOL_ADMIN','ACCOUNTANT') LIMIT 1`,[userId,schoolId])).rows[0];
 return !!authority&&record.subjectStudentId==null&&
  await studentNfcReminderSnapshot(db,schoolId,event.entity,event.term)===event.digest;
}
