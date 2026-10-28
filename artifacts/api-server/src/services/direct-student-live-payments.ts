import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { FlutterwaveLiveTransport } from "../lib/flutterwave-live-transport";
import { directLiveConfiguration } from "../lib/flutterwave-direct-live-config";
import { flutterwaveLiveWebhookVerifier } from "../lib/flutterwave-live-config";
import { previewStudentNfcReconciliation } from "./student-nfc-reconciliation";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import {inspectDirectReleaseSchema,findApprovedDirectReview} from "./direct-student-live-release";
import {initialStudentFreePeriod,readStudentRollout} from "./student-platform-rollout";
import {appendFinancialHistory,requireFinancialActor,transitionDirectAttempt} from "./financial-history-writes";
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
  await appendFinancialHistory(c,"event",[id,kind,actorId,JSON.stringify(details)]);
}
/** No provider access, conversion or writes. Fresh evidence is checked before each new POST. */
export async function directStudentReadiness(pool:StudentSubscriptionSqlPool,scope:Scope,deps:Dependencies={}){
  if(initialStudentFreePeriod())return{ready:false as const,blockers:["FREE_ROLLOUT_NO_PLATFORM_PAYMENT"]};
  const config=directLiveConfiguration(deps.env);
  if(!config.ready)return{ready:false as const,blockers:["LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED"]};
  const report=await (deps.report??previewStudentNfcReconciliation)(pool,scope);
  if(report.sourceStatus!=="COMPLETE")return{ready:false as const,blockers:["COMPLETE_RECONCILIATION_REQUIRED"]};
  const row=report.rows.find(r=>r.studentId===scope.studentId);
  if(row?.status!=="NEW_OBLIGATION_AFTER_REVIEW")
    return{ready:false as const,blockers:["LEGACY_HISTORY_OR_OBLIGATION_REQUIRES_SEPARATE_TRANSITION_APPROVAL"]};
  const schemaClient=await pool.connect();
  try{
    if(!(await inspectDirectReleaseSchema(schemaClient)).ready)
      return{ready:false as const,blockers:["DIRECT_RELEASE_SCHEMA_REQUIRED"]};
  }finally{schemaClient.release();}
  const c=await pool.connect();
  try{
    const rollout=await readStudentRollout(c,scope.schoolId,scope.termId);
    if(!rollout.chargeable)return{ready:false as const,blockers:["FREE_ROLLOUT_NO_PLATFORM_PAYMENT",rollout.reason]};
    const review=await findApprovedDirectReview(c,scope,report.evidenceDigest,config);
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
    await requireFinancialActor(c,input.actorId,input.assistanceId?undefined:input.schoolId);
    if(!(await readStudentRollout(c,input.schoolId,input.termId)).chargeable)block("FREE_ROLLOUT_NO_PLATFORM_PAYMENT");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`direct-student:${input.schoolId}:${input.studentId}:${input.termId}`]);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`direct-release:${review.request_id}`]);
    // Revalidate reviewed facts after acquiring the scope lock.
    const fresh=await findApprovedDirectReview(c,input,review.report_digest,directLiveConfiguration(deps.env));
    if(!fresh||Number(fresh.id)!==Number(review.id))block("REVIEW_CHANGED");
    if(input.assistanceId){
      const bank=(await c.query(`SELECT b.* FROM subscription_payment_assistance_requests b WHERE b.id=$1
        AND b.school_id=$2 AND b.student_id=$3 AND b.academic_term_id=$4
        AND b.status IN ('REQUESTED','BANK_VERIFIED') AND b.amount_minor=320000
        AND (b.status='REQUESTED' OR (b.verified_amount_minor=320000 AND b.verified_by IS NOT NULL
        AND b.verified_at IS NOT NULL AND b.bank_credit_date IS NOT NULL AND b.bank_credit_date<=current_date
        AND NULLIF(trim(b.bank_name),'') IS NOT NULL AND NULLIF(trim(b.bank_statement_reference),'') IS NOT NULL
        AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.record_id=b.id AND a.actor_user_id=b.verified_by
          AND a.role='PLATFORM_OWNER' AND a.event_type='SUBSCRIPTION_RULE_BANK_CREDIT_VERIFIED'
          AND a.metadata->'after'->>'status'='BANK_VERIFIED'
          AND (a.metadata->'after'->>'amountMinor')::integer=b.verified_amount_minor
          AND a.metadata->'after'->>'bankStatementReference'=b.bank_statement_reference
          AND (a.metadata->'after'->>'bankCreditDate')::date=b.bank_credit_date))) FOR SHARE OF b`,
        [input.assistanceId,input.schoolId,input.studentId,input.termId])).rows[0];
      if(!bank)block("INDEPENDENT_BANK_CREDIT_REQUIRED");
    }
    await appendFinancialHistory(c,"obligation",
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
    attempt=(await appendFinancialHistory(c,"attempt",
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
      const saved=await transitionDirectAttempt(c,Number(attempt.id),{state:"READY",checkoutUrl:url});
      await event(c,attempt.id,"CHECKOUT_READY",input.actorId);
      await c.query("COMMIT");return view(saved);
    }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
  }catch{
    c=await pool.connect();
    try{
      await c.query("BEGIN");
      const current=(await c.query("SELECT * FROM student_direct_live_attempts WHERE id=$1 FOR UPDATE",[attempt.id])).rows[0];
      // A concurrent callback may already have finalized this attempt.
      if(current?.state==="RESERVED"){
        await transitionDirectAttempt(c,Number(attempt.id),{state:"UNKNOWN"});
        await event(c,attempt.id,"CHECKOUT_RESPONSE_UNCERTAIN",input.actorId);
      }
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
    // Verification also mutates protected history. Never bypass the schema gate
    // through a public callback/webhook while checkout itself is fail-closed.
    if(!(await inspectDirectReleaseSchema(c)).ready)block("DIRECT_RELEASE_SCHEMA_REQUIRED");
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
      const pending=await transitionDirectAttempt(c,Number(a.id),{state:"PENDING",transactionId:facts.transactionId});
      await event(c,a.id,"PROVIDER_PENDING_OBSERVED",input.actorId,{transactionId:facts.transactionId});
      await c.query("COMMIT");return view(pending);
    }
    const saved=await transitionDirectAttempt(c,Number(a.id),{state:facts.status==="successful"?"PAID":"FAILED",
      transactionId:facts.transactionId,providerReference:facts.providerReference,
      providerFeeMinor:facts.providerFeeMinor,additionalFeeMinor:facts.additionalFeeMinor});
    await event(c,a.id,facts.status==="successful"?"PROVIDER_PAYMENT_VERIFIED":"PROVIDER_FAILURE_VERIFIED",input.actorId,
      {transactionId:facts.transactionId,providerFeeMinor:facts.providerFeeMinor,additionalFeeMinor:facts.additionalFeeMinor});
    await c.query("COMMIT");return view(saved);
  }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}finally{c.release();}
}
/** V3 uses verif-hash, NOT the V4 HMAC envelope. Independent transaction GET is mandatory. */
export function authenticateDirectStudentWebhook(headers:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env){
  const expected=flutterwaveLiveWebhookVerifier(env),supplied=headers["verif-hash"];
  if(!directLiveConfiguration(env).ready||!expected||typeof supplied!=="string"
    ||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)
    ||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new DirectPaymentBlocked("WEBHOOK_AUTHENTICATION_FAILED",401);
}
