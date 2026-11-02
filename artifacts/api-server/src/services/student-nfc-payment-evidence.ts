import {AuthError} from "../middlewares/auth";
import {lagosDate,readStudentRollout} from "./student-platform-rollout";
type Sql={query(sql:string,values?:any[]):Promise<{rows:any[]}>};

/** Shared activation/attendance/replacement subscription boundary.
 * All card assignments are free until the school's configured January 2027
 * second term begins. Missing/ambiguous rollout dates never authorize billing.
 * Free access is not payment evidence and never writes a financial record.
 * Strict independent payment evidence: never treats grace or manual receipts as payment.
 * During chargeable terms attendance may separately apply an explicitly audited,
 * exact-card temporary grace; initial activation and replacement issuance require
 * independently verified payment only when this shared rollout requires payment.
 * Ordinary app access retains its separate rollout policy. The reference binds
 * the server-created checkout to one immutable school/student/term obligation.
 */
export async function assertVerifiedStudentNfcPayment(db:Sql,schoolId:number,studentId:number){
  const today=lagosDate();
  const rollout=await readStudentRollout(db,schoolId,undefined,today);
  if(!rollout.chargeable)return;
  const result=await db.query(`SELECT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o
    JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    JOIN students st ON st.id=o.student_id AND st.school_id=o.school_id AND upper(st.status)='ACTIVE'
    JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
    JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
    WHERE o.school_id=$1 AND o.student_id=$2 AND o.amount_minor=320000 AND o.currency='NGN'
      AND o.school_share_minor=0 AND o.bro_share_minor=0
      AND t.is_current=true AND upper(t.status)='ACTIVE'
      AND ses.is_current=true AND upper(ses.status)='ACTIVE'
      AND $3::date BETWEEN t.start_date AND t.end_date
      AND (SELECT count(*) FROM academic_terms current_term WHERE current_term.school_id=$1
        AND current_term.is_current=true AND upper(current_term.status)='ACTIVE')=1
      AND a.reference ~ '^SCV4_live_[A-Za-z0-9_-]{8,80}$'
      AND a.state='PAID' AND a.verified_at IS NOT NULL
      AND a.provider_transaction_id ~ '^[1-9][0-9]*$'
      AND NULLIF(trim(a.provider_reference),'') IS NOT NULL
      AND a.provider_fee_minor>=0 AND a.additional_fee_minor>=0
      AND a.provider_fee_minor+a.additional_fee_minor<320000
      AND EXISTS(SELECT 1 FROM student_direct_live_events ev WHERE ev.attempt_id=a.id
        AND ev.kind='PROVIDER_PAYMENT_VERIFIED' AND ev.details->>'transactionId'=a.provider_transaction_id)
    ) AS nfc_payment_verified`,[schoolId,studentId,today]);
  if(result.rows[0]?.nfc_payment_verified!==true)throw new AuthError(409,
    "NFC activation requires a successful, independently server-verified ₦3,200 Flutterwave checkout for this student and current term. Cash, company-account transfers and assistance receipts do not activate NFC.",
    "NFC_FLUTTERWAVE_PAYMENT_REQUIRED");
}
