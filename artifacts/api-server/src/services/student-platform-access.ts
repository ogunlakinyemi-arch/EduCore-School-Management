import type { CommunicationQueryClient } from "./communication-service";
import { assertManualSchoolUnlocked } from "./school-subscription-lock";
import { initialStudentFreePeriod,lagosDate,readStudentUsageRollout as readStudentRollout } from "./student-platform-rollout";
import {verifiedBulkStudentIds} from "./current-bulk-payment-evidence";

export type StudentPlatformAccess={
  schoolId:number;studentId:number;termId:number|null;
  status:"VERIFIED"|"PAYMENT_REQUIRED"|"UNAVAILABLE"|"NOT_REQUIRED";restricted:boolean;
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
  const rollout=initialStudentFreePeriod()?null:await readStudentRollout(db,schoolId);
  const free=initialStudentFreePeriod() || !rollout?.chargeable;
  if(free){
    const eligible=await db.query(`SELECT st.id FROM students st JOIN schools sc ON sc.id=st.school_id
      WHERE st.id=$2 AND st.school_id=$1 AND lower(st.status)='active' AND lower(sc.status)='active'`,
      [schoolId,studentId]);
    return eligible.rows.length===1?{schoolId,studentId,termId:rollout?.termId??null,status:"NOT_REQUIRED",restricted:false}:base;
  }
  const terms=await db.query<{id:number;name:string}>(`SELECT t.id,t.name FROM academic_terms t
    JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
    JOIN schools sc ON sc.id=t.school_id AND lower(sc.status)='active'
    JOIN students st ON st.id=$2 AND st.school_id=t.school_id AND lower(st.status)='active'
    WHERE t.school_id=$1 AND t.is_current=true AND upper(t.status)='ACTIVE'
      AND ses.is_current=true AND upper(ses.status)='ACTIVE'
      AND (NOW() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date`,[schoolId,studentId]);
  if(terms.rows.length!==1)return base;
  const term=terms.rows[0];
  if(term.id!==rollout?.termId)return base;
  // New collection periods require exact direct proof. Never reinterpret an old
  // 5,000 split, school fee, or sandbox payment as the new 3,200 payment.
  const result=await db.query<{paid:boolean}>(`SELECT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    WHERE o.school_id=$1 AND o.student_id=$2 AND o.academic_term_id=$3
      AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0
      AND o.currency='NGN' AND a.state='PAID' AND a.verified_at IS NOT NULL
      AND a.provider_transaction_id ~ '^[1-9][0-9]*$' AND a.provider_reference IS NOT NULL
      AND EXISTS(SELECT 1 FROM student_direct_live_events ev WHERE ev.attempt_id=a.id
        AND ev.kind='PROVIDER_PAYMENT_VERIFIED' AND ev.details->>'transactionId'=a.provider_transaction_id)
    ) AS paid`,[schoolId,studentId,term.id]);
  const paid=result.rows[0]?.paid===true||(await verifiedBulkStudentIds(db,schoolId,term.id)).has(studentId);
  const enforcementDate=new Date(Date.parse(`${rollout.termStartDate}T00:00:00Z`)+7*86_400_000).toISOString().slice(0,10);
  return{schoolId,studentId,termId:term.id,status:paid?"VERIFIED":"PAYMENT_REQUIRED",
    restricted:!paid&&lagosDate()>=enforcementDate};
}
export async function readStudentPlatformAccess(db:CommunicationQueryClient,userId:number){
  const profiles=await db.query<{id:number;schoolId:number}>(`SELECT st.id,st.school_id AS "schoolId"
    FROM students st WHERE st.user_id=$1 AND lower(st.status)='active' ORDER BY st.id`,[userId]);
  const students=await Promise.all(profiles.rows.map(s=>readStudentTermPlatformAccess(db,s.schoolId,s.id)));
  for(const student of students)if(!student.restricted)await assertManualSchoolUnlocked(db,student.schoolId);
  return{restricted:students.length===0 || students.some(s=>s.restricted),students};
}
