import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { AuthError } from "../middlewares/auth";
import { requireLiveRelease } from "../lib/flutterwave-live-release";
import { liveCheckoutUrl } from "../lib/flutterwave-live-transport";
import { verifyLiveSplitAuthority } from "../lib/flutterwave-live-split-authority";
import { liveVerifiedIssuance } from "./flutterwave-live-application";
import { GetSchoolBillingContextResponse } from "@workspace/api-zod";
import { flutterwavePaymentMode } from "../lib/flutterwave-payment-mode";
import type { z } from "zod";
type SchoolBillingContext=z.infer<typeof GetSchoolBillingContextResponse>;
type SchoolBillingStudent=SchoolBillingContext["students"][number];

/** Read-only. No provider calls, capability creation, schema changes or legacy
 * payment reads. A selected but unavailable LIVE runtime never becomes TEST. */
export async function readSchoolBillingContext(pool:StudentSubscriptionSqlPool,
  input:{actorId:number;schoolId:number},env:NodeJS.ProcessEnv=process.env):Promise<SchoolBillingContext> {
  const result:SchoolBillingContext={...input,mode:"UNAVAILABLE",reason:"BILLING_UNAVAILABLE",
    termId:null,termName:null,students:[]};
  const db=await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout='3s'");
    const actor=(await db.query(`SELECT bool_or(sm.role='SCHOOL_ADMIN') AS admin
      FROM school_memberships sm JOIN app_users u ON u.id=sm.user_id
      JOIN schools s ON s.id=sm.school_id
      WHERE u.id=$1 AND u.status='ACTIVE' AND sm.school_id=$2 AND sm.status='ACTIVE'
        AND sm.role IN ('SCHOOL_ADMIN','ACCOUNTANT') AND lower(s.status)='active'
        AND NOT EXISTS(SELECT 1 FROM school_memberships o WHERE o.user_id=u.id
          AND o.role='PLATFORM_OWNER' AND o.status='ACTIVE')
      HAVING count(*)>0`,[input.actorId,input.schoolId])).rows[0];
    if(!actor)throw new AuthError(403,"Current school finance access is required");
    const mode=flutterwavePaymentMode(env);
    if(mode!=="LIVE"){
      if(mode==="TEST"){
        result.mode="TEST";result.reason="TEST_RUNTIME";
      }
      return result;
    }
    if(!actor.admin){result.reason="LIVE_SCHOOL_ADMIN_REQUIRED";return result;}
    let release;
    try{release=await requireLiveRelease(pool,env);}
    catch{result.reason="LIVE_RELEASE_UNAVAILABLE";return result;}
    result.mode="LIVE";
    const terms=(await db.query(`SELECT t.id,t.name FROM academic_terms t
      JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.school_id=$1 AND t.is_current AND upper(t.status)='ACTIVE'
        AND s.is_current AND upper(s.status)='ACTIVE'
        AND t.start_date<=(now() AT TIME ZONE 'Africa/Lagos')::date
        AND t.end_date>=(now() AT TIME ZONE 'Africa/Lagos')::date`,[input.schoolId])).rows;
    if(terms.length!==1){result.reason="CURRENT_TERM_UNAVAILABLE";return result;}
    result.termId=Number(terms[0].id);result.termName=terms[0].name;
    let authority=false;
    const config=(await db.query(`SELECT sc.authority_evidence,ar.evidence_sha256,ar.school_subaccount_id
      FROM flutterwave_live_school_configuration sc JOIN flutterwave_live_authority_reviews ar
        ON ar.id=sc.authority_review_id AND ar.school_id=sc.school_id AND ar.merchant_scope=sc.merchant_scope
      WHERE sc.school_id=$1 AND sc.merchant_scope=$2 AND ar.environment='LIVE' AND ar.expires_at>now()
      ORDER BY ar.id DESC LIMIT 1`,[input.schoolId,release.merchantScope])).rows[0];
    if(config)try{
      verifyLiveSplitAuthority(config.authority_evidence,{merchantScope:release.merchantScope,
        schoolId:input.schoolId,schoolSubaccountId:config.school_subaccount_id,evidenceSha256:config.evidence_sha256});
      authority=true;
    }catch{/* Invalid authority can never enable checkout; retained status stays readable. */}
    const rows=(await db.query(`SELECT st.id AS "studentId",concat_ws(' ',st.first_name,st.last_name) AS "studentName",
      i.reference,i.state,i.on_hold,i.issued_by,i.issuer_key,attempt.state AS attempt_state,attempt.checkout_url,
      (SELECT count(*)::int FROM flutterwave_live_subscription_intents c
        WHERE c.environment='LIVE' AND c.merchant_scope=$2 AND c.school_id=st.school_id
          AND c.student_id=st.id AND c.term_id=$3) AS candidate_count,
      (${liveVerifiedIssuance}) AS verified
      FROM students st LEFT JOIN LATERAL (
        SELECT candidate.* FROM flutterwave_live_subscription_intents candidate
        WHERE candidate.environment='LIVE' AND candidate.merchant_scope=$2
          AND candidate.school_id=st.school_id AND candidate.student_id=st.id AND candidate.term_id=$3
        ORDER BY candidate.id DESC LIMIT 1
      ) i ON true
      LEFT JOIN flutterwave_live_checkout_attempts attempt ON attempt.intent_id=i.id
      WHERE st.school_id=$1 AND lower(st.status)='active' ORDER BY st.id`,
    [input.schoolId,release.merchantScope,result.termId])).rows;
    result.reason=authority?"LIVE_CONTEXT":"SCHOOL_AUTHORITY_REQUIRED";
    result.students=rows.map((r:any):SchoolBillingStudent=>{
      const ambiguous=r.reference&&(r.candidate_count!==1||!r.issued_by||!r.issuer_key
        ||!/^SCV3_live_[A-Za-z0-9_-]{8,80}$/.test(r.reference));
      const status:SchoolBillingStudent["status"]=r.on_hold?"HELD":ambiguous?"RECONCILIATION_REQUIRED":
        r.verified?"VERIFIED":!r.reference?"UNPAID":
        r.state==="COLLECTION_VERIFIED"?"RECONCILIATION_REQUIRED":
        r.attempt_state==="READY"&&liveCheckoutUrl(r.checkout_url)?"READY":
        r.attempt_state==="UNKNOWN"||r.attempt_state==="RESERVED"?"RECONCILIATION_REQUIRED":"AWAITING_FINALIZATION";
      return {studentId:r.studentId,studentName:r.studentName,status,
        checkoutAllowed:authority&&status==="UNPAID",
        reference:r.reference??null,checkoutUrl:status==="READY"?r.checkout_url:null};
    });
    return result;
  }finally{
    // A read-only snapshot has no business changes to commit, including early returns.
    await db.query("ROLLBACK").catch(()=>undefined);db.release();
  }
}
