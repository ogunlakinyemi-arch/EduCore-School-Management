import {queueCommunicationNotification,type CommunicationDispatchPool} from "./communication-service";
import {financialReminderChannels,financialReminderScope,financialScheduleDay,guardianNfcReminderContent,type FinancialReminderKind} from "./financial-reminder-policy";
import {feeReminderDigest,guardianSchoolFeeSql,studentNfcReminderSnapshot,staffNfcReminderSnapshot,guardianStudentNfcSql,guardianNfcReminderSnapshot} from "./financial-reminder-eligibility";
import {readStudentUsageRollout} from "./student-platform-rollout";
/** Existing notification uniqueness + transaction advisory lock make concurrent
 * ticks/restarts idempotent. There is no new outbox, debt ledger or send loop. */
export async function queueWeeklyFinancialReminders(pool:CommunicationDispatchPool,now=new Date()){
 const day=financialScheduleDay(now);if(!day)return {queued:0};
 const c=await pool.connect();let queued=0;
 try{
  await c.query("BEGIN");
  const lock=(await c.query(`SELECT pg_try_advisory_xact_lock(hashtextextended('financial-weekly:'||$1,0)) AS held`,[day])).rows[0];
  if(!lock?.held){await c.query("ROLLBACK");return {queued};}
  const queue=async(schoolId:number,userId:number,kind:FinancialReminderKind,entity:number,term:number,
   digest:string,subjectStudentId:number|null,body:string,link:string|null)=>{
   const scope=financialReminderScope(day,kind,entity,term);
   // One scheduled reminder even when the balance changes during this day.
   if((await c.query(`SELECT 1 FROM communication_notifications WHERE school_id=$1 AND recipient_user_id=$2
    AND event_key LIKE $3 LIMIT 1`,[schoolId,userId,`${scope}%`])).rows.length)return;
   const content=kind==="GUARDIAN_NFC"?guardianNfcReminderContent:
    {category:"FINANCE" as const,subject:"School payment reminder",body,link};
   const id=await queueCommunicationNotification(c,{schoolId,recipientUserId:userId,subjectStudentId,
    ...content,eventKey:`${scope}${digest}`,
    channels:[...financialReminderChannels],useSchoolDefaults:false});
   if(id!==null)queued++;
  };
  const schools=(await c.query(`SELECT id,name FROM schools WHERE lower(status)='active' ORDER BY id`)).rows;
  for(const school of schools){
   const schoolId=Number(school.id);
   const fees=(await c.query(guardianSchoolFeeSql,[schoolId,day])).rows;
   for(const r of fees)await queue(schoolId,Number(r.recipientUserId),"FEE",Number(r.id),Number(r.termId),
    feeReminderDigest(r),Number(r.studentId),
    `${r.schoolName}: ${r.studentName}'s school invoice ${r.number} has ₦${(Number(r.outstanding)/100).toLocaleString("en-NG")} outstanding, due ${r.due}. Review your school's published invoice and payment instructions. A submitted receipt is pending until school verification.`,
    `/parent/fees/${r.studentId}`);
   const rollout=await readStudentUsageRollout(c,schoolId);
   if(!rollout.chargeable||!rollout.termId)continue;
   // A contact-school notice for guardians is separate from all remittance
   // notices. Its obligation identity is the required student/academic term,
   // never a financial ledger or payment reference.
   const guardians=(await c.query(guardianStudentNfcSql,[schoolId])).rows;
   for(const guardian of guardians){
    const studentId=Number(guardian.studentId),userId=Number(guardian.recipientUserId);
    const digest=await guardianNfcReminderSnapshot(c,schoolId,studentId,rollout.termId,userId,now);
    if(digest)await queue(schoolId,userId,"GUARDIAN_NFC",studentId,rollout.termId,digest,studentId,
     guardianNfcReminderContent.body,null);
   }
   // Internal student remittance reminders go only to school finance, never to
   // guardians/students/teachers, even when a guardian has paid the school.
   const finance=(await c.query(`SELECT DISTINCT m.user_id AS id FROM school_memberships m
    JOIN app_users u ON u.id=m.user_id AND upper(u.status)='ACTIVE'
    WHERE m.school_id=$1 AND m.status='ACTIVE' AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')`,[schoolId])).rows;
   const schoolDigest=await studentNfcReminderSnapshot(c,schoolId,schoolId,rollout.termId);
   if(schoolDigest){
    for(const user of finance)await queue(schoolId,Number(user.id),"STUDENT_NFC",schoolId,rollout.termId,schoolDigest,null,
     "Current-term student NFC entitlements remain unverified. Review affected students and remittance in Finance. School receipts and pending transfers are not platform payment. No automatic charge has been made.",
     "/finance");
   }
   const employees=(await c.query(`SELECT e.id,e.user_id AS "userId" FROM employees e JOIN app_users u ON u.id=e.user_id
    WHERE e.school_id=$1 AND upper(e.employment_status)='ACTIVE' AND upper(e.employee_type) IN ('TEACHER','STAFF')
    AND upper(u.status)='ACTIVE' ORDER BY e.id`,[schoolId])).rows;
   for(const e of employees){
    const digest=await staffNfcReminderSnapshot(c,schoolId,Number(e.id),rollout.termId,Number(e.userId));if(!digest)continue;
    await queue(schoolId,Number(e.userId),"STAFF_NFC",Number(e.id),rollout.termId,digest,null,
     "Your current-term NFC subscription needs attention. Open your account's subscription page to review its status. A pending payment is not yet verified; no automatic charge has been made.",
     "/my-nfc-subscription");
   }
  }
  await c.query("COMMIT");return {queued};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
