import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { FlutterwaveLiveTransport } from "../lib/flutterwave-live-transport";
import { directLiveConfiguration } from "../lib/flutterwave-direct-live-config";
import { flutterwaveLiveWebhookVerifier } from "../lib/flutterwave-live-config";
import { previewStudentNfcReconciliation } from "./student-nfc-reconciliation";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
type Db=Awaited<ReturnType<StudentSubscriptionSqlPool["connect"]>>;
export class DirectPaymentBlocked extends Error{
  constructor(public readonly code:string,public readonly statusCode=409){super(code);}
}
const block=(code:string):never=>{throw new DirectPaymentBlocked(code);};
export const directAllocation=Object.freeze({amountMinor:320000,platformGrossMinor:320000,schoolShareMinor:0,broShareMinor:0,currency:"NGN"});
type Scope={schoolId:number;studentId:number;termId:number};
type Dependencies={env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;report?:typeof previewStudentNfcReconciliation};
const view=(a:any)=>({id:Number(a.id),reference:a.reference,state:a.state,
  checkoutUrl:a.state==="READY"?a.checkout_url:null});
async function event(c:Db,id:number,kind:string,actorId:number|null,details:object={}){
  await c.query(`INSERT INTO student_direct_live_events(attempt_id,kind,actor_user_id,details)
    VALUES($1,$2,$3,$4::jsonb)`,[id,kind,actorId,JSON.stringify(details)]);
}
/** No provider access, conversion or writes. Fresh evidence is checked before each new POST. */
export async function directStudentReadiness(pool:StudentSubscriptionSqlPool,scope:Scope,deps:Dependencies={}){
  const config=directLiveConfiguration(deps.env);
  if(!config.ready)return{ready:false as const,blockers:["LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED"]};
  const report=await (deps.report??previewStudentNfcReconciliation)(pool,scope);
  if(report.sourceStatus!=="COMPLETE")return{ready:false as const,blockers:["COMPLETE_RECONCILIATION_REQUIRED"]};
  const row=report.rows.find(r=>r.studentId===scope.studentId);
  if(row?.status!=="NEW_OBLIGATION_AFTER_REVIEW")
    return{ready:false as const,blockers:["LEGACY_HISTORY_OR_OBLIGATION_REQUIRES_SEPARATE_TRANSITION_APPROVAL"]};
  const c=await pool.connect();
  try{
    const review=(await c.query(`SELECT v.*,r.version AS rule_version FROM student_direct_live_reviews v
      JOIN subscription_rule_proposals r ON r.id=v.rule_id
      JOIN academic_terms t ON t.id=v.academic_term_id AND t.school_id=v.school_id
      JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
      JOIN students st ON st.id=$3 AND st.school_id=v.school_id AND lower(st.status)='active'
      JOIN schools sc ON sc.id=v.school_id AND lower(sc.status)='active'
      JOIN app_users approver ON approver.id=v.approved_by AND approver.status='ACTIVE'
      WHERE v.school_id=$1 AND v.academic_term_id=$2 AND v.report_digest=$4
        AND v.no_split_confirmed=true AND v.approved_at<=now() AND v.expires_at>now()
        AND r.product='STUDENT_PLATFORM' AND r.status IN ('ACTIVE','SCHEDULED')
        AND r.amount_minor=320000 AND r.school_share_minor=0 AND r.currency='NGN' AND r.billing_period='ACADEMIC_TERM'
        AND r.effective_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())
        AND t.is_current=true AND upper(t.status)='ACTIVE' AND ses.is_current=true AND upper(ses.status)='ACTIVE'
        AND (now() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date
      ORDER BY v.id DESC LIMIT 1`,[scope.schoolId,scope.termId,scope.studentId,report.evidenceDigest])).rows[0];
    if(!review)return{ready:false as const,blockers:["ACTIVE_3200_RULE_AND_EXPLICIT_MATCHING_RECONCILIATION_APPROVAL_REQUIRED"]};
    return{ready:true as const,blockers:[],review};
  }finally{c.release();}
}
/** A permanent pre-POST claim survives uncertain responses. Never auto-resend a POST. */
export async function startDirectStudentPayment(pool:StudentSubscriptionSqlPool,input:Scope&{
  actorId:number;email:string;idempotencyKey:string;assistanceId?:number;
},deps:Dependencies={}){
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey))block("IDEMPOTENCY_KEY_REQUIRED");
  const readiness=await directStudentReadiness(pool,input,deps);
  if(!readiness.ready)block(readiness.blockers[0]);
  const review=readiness.review!;
  let c=await pool.connect(),attempt:any;
  try{
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`direct-student:${input.schoolId}:${input.studentId}:${input.termId}`]);
    // Revalidate reviewed facts after acquiring the scope lock.
    const fresh=(await c.query(`SELECT r.id FROM subscription_rule_proposals r
      JOIN student_direct_live_reviews v ON v.rule_id=r.id WHERE r.id=$1 AND v.id=$2
      AND r.version=$3 AND r.status IN ('ACTIVE','SCHEDULED') AND r.effective_at<=now()
      AND (r.ends_at IS NULL OR r.ends_at>now()) AND v.expires_at>now() FOR SHARE OF r,v`,
      [review.rule_id,review.id,review.rule_version])).rows[0];
    if(!fresh)block("REVIEW_CHANGED");
    if(input.assistanceId){
      const bank=(await c.query(`SELECT * FROM subscription_payment_assistance_requests WHERE id=$1
        AND school_id=$2 AND student_id=$3 AND academic_term_id=$4 AND status='BANK_VERIFIED'
        AND amount_minor=320000 AND verified_amount_minor=320000 AND verified_by IS NOT NULL
        AND verified_at IS NOT NULL AND bank_credit_date IS NOT NULL
        AND NULLIF(trim(bank_statement_reference),'') IS NOT NULL FOR SHARE`,
        [input.assistanceId,input.schoolId,input.studentId,input.termId])).rows[0];
      if(!bank)block("INDEPENDENT_BANK_CREDIT_REQUIRED");
    }
    await c.query(`INSERT INTO student_direct_live_obligations(school_id,student_id,academic_term_id,
      rule_id,review_id,merchant_scope,assistance_request_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,student_id,academic_term_id) DO NOTHING`,
      [input.schoolId,input.studentId,input.termId,review.rule_id,review.id,review.merchant_scope,input.assistanceId??null,input.actorId]);
    const obligation=(await c.query(`SELECT * FROM student_direct_live_obligations
      WHERE school_id=$1 AND student_id=$2 AND academic_term_id=$3 FOR UPDATE`,
      [input.schoolId,input.studentId,input.termId])).rows[0];
    if(Number(obligation.rule_id)!==Number(review.rule_id) || obligation.merchant_scope!==review.merchant_scope
      || Number(obligation.assistance_request_id??0)!==Number(input.assistanceId??0))block("OBLIGATION_REVIEW_OR_PAYER_MISMATCH");
    const prior=(await c.query(`SELECT * FROM student_direct_live_attempts WHERE obligation_id=$1
      AND (idempotency_key=$2 OR state<>'FAILED') ORDER BY id DESC LIMIT 1`,
      [obligation.id,input.idempotencyKey])).rows[0];
    if(prior){
      await c.query("COMMIT");
      if(["READY","PAID","FAILED"].includes(prior.state))return view(prior);
      block("EXISTING_ATTEMPT_RECONCILIATION_REQUIRED");
    }
    attempt=(await c.query(`INSERT INTO student_direct_live_attempts(obligation_id,reference,idempotency_key,state,created_by)
      VALUES($1,$2,$3,'RESERVED',$4) RETURNING *`,
      [obligation.id,`SCV4_live_${randomUUID().replaceAll("-","")}`,input.idempotencyKey,input.actorId])).rows[0];
    await event(c,attempt.id,"CHECKOUT_RESERVED",input.actorId,{assistanceId:input.assistanceId??null,...directAllocation});
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
  try{
    const transport=new FlutterwaveLiveTransport(deps.env,deps.fetcher,"DIRECT_STUDENT");
    const url=await transport.directStudentCheckout({reference:attempt.reference,email:input.email});
    c=await pool.connect();
    try{
      await c.query("BEGIN");
      const saved=(await c.query(`UPDATE student_direct_live_attempts SET state='READY',checkout_url=$2
        WHERE id=$1 AND state='RESERVED' RETURNING *`,[attempt.id,url])).rows[0];
      if(!saved)block("EXISTING_ATTEMPT_RECONCILIATION_REQUIRED");
      await event(c,attempt.id,"CHECKOUT_READY",input.actorId);
      await c.query("COMMIT");return view(saved);
    }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
  }catch{
    c=await pool.connect();
    try{
      await c.query("BEGIN");
      const changed=(await c.query(`UPDATE student_direct_live_attempts SET state='UNKNOWN'
        WHERE id=$1 AND state='RESERVED' RETURNING id`,[attempt.id])).rows[0];
      if(changed)await event(c,attempt.id,"CHECKOUT_RESPONSE_UNCERTAIN",input.actorId);
      await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
    block("EXISTING_ATTEMPT_RECONCILIATION_REQUIRED");
  }
}
/** Redirects and signed webhooks supply identifiers only; GET verification supplies the facts. */
export async function verifyDirectStudentPayment(pool:StudentSubscriptionSqlPool,input:{
  reference:string;transactionId:string;actorId:number|null;
},deps:Dependencies={}){
  if(!/^SCV4_live_[A-Za-z0-9_-]{8,80}$/.test(input.reference))block("INVALID_REFERENCE");
  let c=await pool.connect();
  try{
    const attempt=(await c.query("SELECT id FROM student_direct_live_attempts WHERE reference=$1",[input.reference])).rows[0];
    if(!attempt)block("UNKNOWN_REFERENCE");
  }finally{c.release();}
  const facts=await new FlutterwaveLiveTransport(deps.env,deps.fetcher,"DIRECT_STUDENT")
    .directStudentCollection(input.transactionId,input.reference);
  c=await pool.connect();
  try{
    await c.query("BEGIN");
    const a=(await c.query("SELECT * FROM student_direct_live_attempts WHERE reference=$1 FOR UPDATE",[input.reference])).rows[0];
    if(!a)block("UNKNOWN_REFERENCE");
    if(a.provider_transaction_id && a.provider_transaction_id!==facts.transactionId)block("VERIFIED_TRANSACTION_CONFLICT");
    if(["PAID","FAILED"].includes(a.state)){
      if(a.provider_transaction_id!==facts.transactionId || (a.state==="PAID")!==(facts.status==="successful"))
        block("VERIFIED_TRANSACTION_CONFLICT");
      await c.query("COMMIT");return view(a);
    }
    if(facts.status==="pending"){
      if(a.state==="PENDING"){await c.query("COMMIT");return view(a);}
      const pending=(await c.query(`UPDATE student_direct_live_attempts SET state='PENDING',provider_transaction_id=$2
        WHERE id=$1 AND state IN ('READY','UNKNOWN','RESERVED') RETURNING *`,[a.id,facts.transactionId])).rows[0];
      if(!pending)block("VERIFIED_TRANSACTION_CONFLICT");
      await event(c,a.id,"PROVIDER_PENDING_OBSERVED",input.actorId,{transactionId:facts.transactionId});
      await c.query("COMMIT");return view(pending);
    }
    const saved=(await c.query(`UPDATE student_direct_live_attempts SET state=$2,provider_transaction_id=$3,
      provider_reference=$4,provider_fee_minor=$5,additional_fee_minor=$6,verified_at=now()
      WHERE id=$1 RETURNING *`,[a.id,facts.status==="successful"?"PAID":"FAILED",facts.transactionId,
      facts.providerReference,facts.providerFeeMinor,facts.additionalFeeMinor])).rows[0];
    await event(c,a.id,facts.status==="successful"?"PROVIDER_PAYMENT_VERIFIED":"PROVIDER_FAILURE_VERIFIED",input.actorId,
      {transactionId:facts.transactionId,providerFeeMinor:facts.providerFeeMinor,additionalFeeMinor:facts.additionalFeeMinor});
    await c.query("COMMIT");return view(saved);
  }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
}
export function authenticateDirectStudentWebhook(headers:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env){
  const expected=flutterwaveLiveWebhookVerifier(env),supplied=headers["verif-hash"];
  if(!directLiveConfiguration(env).ready || !expected || typeof supplied!=="string"
    || Buffer.byteLength(supplied)!==Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new DirectPaymentBlocked("WEBHOOK_AUTHENTICATION_FAILED",401);
}
