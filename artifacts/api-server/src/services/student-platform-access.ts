import type { CommunicationQueryClient } from "./communication-service";
import { hostedLiveSelected,readHostedSubscriptionCoverage } from "./hosted-subscription-coverage";
import { releasedLiveApplicationContext,readLiveSchoolSubscriptionStudents } from "./flutterwave-live-application";
import { assertManualSchoolUnlocked } from "./school-subscription-lock";

export type StudentPlatformAccess={
  schoolId:number;studentId:number;termId:number|null;
  status:"VERIFIED"|"PAYMENT_REQUIRED"|"UNAVAILABLE";restricted:boolean;
};
/** These are student operations, not payments, identity, help, welfare or transport. */
export function isStudentCoreOperation(path:string,method="GET"){
  let p:string;
  try{p=decodeURIComponent(path.split("?")[0]).toLowerCase().replace(/^\/api(?=\/|$)/,"");}
  catch{return true;}
  if(method==="GET" && /^\/academic\/(?:calendar|sessions|terms)(?:\/|$)/.test(p))return false;
  return /^\/(?:academic|curriculum|exam-record|library|reporting|reports)(?:\/|$)/.test(p) ||
    /^\/(?:attendance\/(?:me|own)|student\/attendance|students\/me\/attendance|dashboard\/student)(?:\/|$)/.test(p);
}

/** Read-only. No price conversion, waiver, receipt upload or school cash can establish payment. */
export async function readStudentTermPlatformAccess(db:CommunicationQueryClient,schoolId:number,studentId:number):Promise<StudentPlatformAccess>{
  const base={schoolId,studentId,termId:null,status:"UNAVAILABLE" as const,restricted:true};
  const terms=await db.query<{id:number;name:string}>(`SELECT t.id,t.name FROM academic_terms t
    JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
    JOIN schools sc ON sc.id=t.school_id AND lower(sc.status)='active'
    JOIN students st ON st.id=$2 AND st.school_id=t.school_id AND lower(st.status)='active'
    WHERE t.school_id=$1 AND t.is_current=true AND upper(t.status)='ACTIVE'
      AND ses.is_current=true AND upper(ses.status)='ACTIVE'
      AND (NOW() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date`,[schoolId,studentId]);
  if(terms.rows.length!==1)return base;
  const term=terms.rows[0],live=releasedLiveApplicationContext();
  let paid=false;
  // Historical verified coverage remains readable, never an active checkout dependency.
  if(hostedLiveSelected()){
    const result=await readHostedSubscriptionCoverage(db,schoolId,term.id);
    paid=result.rows.find(r=>r.studentId===studentId)?.paid===true;
  }else if(live){
    const result=await readLiveSchoolSubscriptionStudents(db,schoolId,term.id,live);
    paid=result.rows.find(r=>r.studentId===studentId)?.paid===true;
  }else{
    const result=await db.query<{paid:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM student_subscription_payments p JOIN subscriptions s
        ON s.id=p.subscription_id AND s.school_id=p.school_id AND s.student_id=p.student_id
      WHERE p.school_id=$1 AND p.student_id=$2 AND p.academic_term_id=$3
        AND p.provider='FLUTTERWAVE' AND p.provider_mode='SANDBOX' AND p.currency='NGN'
        AND p.status='PAID' AND p.reconciliation_status='RECONCILED'
        AND p.provider_transaction_id ~ '^[1-9][0-9]*$' AND p.paid_at IS NOT NULL
        AND p.gross_amount_minor>0 AND p.gross_amount_minor=round(s.amount*100)
        AND lower(s.status)='active' AND lower(s.verification_status)='verified'
        AND s.term=$4) AS paid`,[schoolId,studentId,term.id,term.name]);
    paid=result.rows[0]?.paid===true;
  }
  return{schoolId,studentId,termId:term.id,status:paid?"VERIFIED":"PAYMENT_REQUIRED",restricted:!paid};
}
export async function readStudentPlatformAccess(db:CommunicationQueryClient,userId:number){
  const profiles=await db.query<{id:number;schoolId:number}>(`SELECT st.id,st.school_id AS "schoolId"
    FROM students st WHERE st.user_id=$1 AND lower(st.status)='active' ORDER BY st.id`,[userId]);
  const students=await Promise.all(profiles.rows.map(s=>readStudentTermPlatformAccess(db,s.schoolId,s.id)));
  for(const student of students)if(!student.restricted)await assertManualSchoolUnlocked(db,student.schoolId);
  return{restricted:students.length===0 || students.some(s=>s.restricted),students};
}
