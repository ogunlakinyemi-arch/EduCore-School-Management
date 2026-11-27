import {randomUUID} from "node:crypto";
import {financialTransaction} from "./financial-transaction";
import {directStudentReadiness} from "./direct-student-live-payments";
import {findApprovedDirectReview} from "./direct-student-live-release";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
import {FlutterwaveLiveTransport} from "../lib/flutterwave-live-transport";
import {readStudentRollout,lagosDate} from "./student-platform-rollout";
import {currentSchoolAuthority,requireCurrentExtensions} from "./current-finance-access";
import {broEntitlementAmount} from "./bro-commission-policy";
import {demand,requestKey,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {digest} from "./current-financial-store";
import {bulkProof,bulkCreditSource,activeAllocationPredicate} from "./current-payment-evidence";
type Review={id:number;rule_id:number;report_digest:string;merchant_scope:string};
type Proof={transactionId:string;reference:string;amountMinor:number;currency:string;providerReference:string;
 status:"successful"|"failed"|"cancelled"|"pending";providerFeeMinor:number|null;additionalFeeMinor:number|null;chargedAmountMinor?:number};
export type BulkDependencies={
 now?:()=>Date;
 review?:(scope:{schoolId:number;studentId:number;termId:number})=>Promise<Review>;
 revalidate?:(c:CurrentSql,scope:{schoolId:number;studentId:number;termId:number},review:Review)=>Promise<boolean>;
 checkout?:(input:{reference:string;email:string;amountMinor:number})=>Promise<string>;
 verify?:(transactionId:string,reference:string,amountMinor:number)=>Promise<Proof>;
};
export async function bulkEvent(c:CurrentSql,batchId:number,actorId:number,state:string,key:string,details:object={},allocationId?:number){
 await c.query(`INSERT INTO current_bulk_events(batch_id,allocation_id,event_key,state,actor_user_id,details)
   VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(event_key) DO NOTHING`,
   [batchId,allocationId??null,`${batchId}:${key}`,state,actorId,JSON.stringify(details)]);
}
export async function batchState(c:CurrentSql,id:number){
 return (await c.query(`SELECT state FROM current_bulk_events WHERE batch_id=$1 AND allocation_id IS NULL ORDER BY id DESC LIMIT 1`,[id])).rows[0]?.state??"RESERVED";
}
export async function recordCheckoutOutcome(pool:CurrentPool,id:number,actorId:number,state:"READY"|"UNKNOWN",details:object){
 await financialTransaction(pool,async c=>{
   // The provider may notify us before its checkout POST returns. The shared
   // transaction gate serializes this check with verification/recovery writes;
   // checkout transport evidence must never rewind independently verified facts.
   if(await batchState(c,id)!=="PROCESSING")return;
   const reference=(details as {attemptReference?:string}).attemptReference;
   if((await c.query("SELECT to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL AS present")).rows[0]?.present){
     const latest=(await c.query("SELECT reference FROM current_bulk_checkout_attempts WHERE batch_id=$1 ORDER BY id DESC LIMIT 1",[id])).rows[0];
     if(latest&&latest.reference!==reference)return;
   }
   await bulkEvent(c,id,actorId,state,`${state==="READY"?"checkout-ready":"checkout-unknown"}:${reference??"original"}`,details);
 });
}
export async function batchRoot(c:CurrentSql,id:number){
 const r=(await c.query("SELECT * FROM current_payment_batches WHERE id=$1",[id])).rows[0];
 demand(r,"BATCH_NOT_FOUND");return r;
}
export async function assertNoBulkClaim(c:CurrentSql,scope:{schoolId:number;studentId:number;termId:number}){
 if(!(await c.query(`SELECT to_regclass('public.current_bulk_allocations') IS NOT NULL AS present`)).rows[0]?.present)return;
 demand(!(await c.query(`SELECT a.id FROM current_bulk_allocations a WHERE a.school_id=$1 AND a.student_id=$2
   AND a.academic_term_id=$3 AND ${await activeAllocationPredicate(c)} LIMIT 1`,
   [scope.schoolId,scope.studentId,scope.termId])).rows[0],"STUDENT_RESERVED_BY_AGGREGATE_PAYMENT");
}
async function defaultReview(pool:CurrentPool,scope:{schoolId:number;studentId:number;termId:number}):Promise<Review>{
 const r=await directStudentReadiness(pool as any,scope);
 demand(r.ready,r.blockers[0]??"DIRECT_RELEASE_NOT_READY");return r.review as Review;
}
export async function createCurrentBulk(pool:CurrentPool,actorId:number,input:{
 schoolId:number;termId:number;studentIds:number[];key:string;reason:string},deps:BulkDependencies={}){
 requestKey(input.key);
 demand(input.reason.trim().length>=3&&input.reason.trim().length<=500,"REASON_REQUIRED");
 demand(input.studentIds.length>0&&input.studentIds.length<=500&&input.studentIds.every(Number.isSafeInteger)
   &&input.studentIds.every(v=>v>0)&&new Set(input.studentIds).size===input.studentIds.length,"DISTINCT_STUDENTS_REQUIRED");
 const ids=[...input.studentIds].sort((a,b)=>a-b);
 // Readiness is computed outside the gate, then exact authority is rechecked inside.
 const pre=await financialTransaction(pool,async c=>{
   await currentSchoolAuthority(c,actorId,input.schoolId);await requireCurrentExtensions(c);
   const old=(await c.query("SELECT * FROM current_payment_batches WHERE request_key=$1",[input.key])).rows[0];
   if(old)demand(old.snapshot.method!=="COMPANY_BANK"&&Number(old.created_by)===actorId&&Number(old.school_id)===input.schoolId
     &&Number(old.academic_term_id)===input.termId&&digest(old.snapshot.studentIds)===digest(ids)
     &&old.snapshot.reason===input.reason.trim(),"IDEMPOTENCY_CONTENT_CONFLICT");
   return old;
 });
 if(pre)return bulkView(pool,actorId,Number(pre.id));
 const reviews=new Map<number,Review>();
 for(const studentId of ids)reviews.set(studentId,await (deps.review??(s=>defaultReview(pool,s)))({...input,studentId}));
 const batch=await financialTransaction(pool,async c=>{
   await currentSchoolAuthority(c,actorId,input.schoolId);await requireCurrentExtensions(c);
   await c.query("SELECT pg_advisory_xact_lock(7749,$1::integer)",[input.schoolId]);
   const {readStudentUsageRollout}=await import("./student-platform-rollout");
   const rollout=await readStudentUsageRollout(c,input.schoolId,input.termId,deps.now?lagosDate(deps.now()):undefined);
   demand(rollout.chargeable,"FREE_OR_INELIGIBLE_TERM");
   const prior=(await c.query("SELECT * FROM current_payment_batches WHERE request_key=$1",[input.key])).rows[0];
   if(prior){
     demand(prior.snapshot.method!=="COMPANY_BANK"&&Number(prior.created_by)===actorId&&Number(prior.school_id)===input.schoolId
       &&Number(prior.academic_term_id)===input.termId&&digest(prior.snapshot.studentIds)===digest(ids)
       &&prior.snapshot.reason===input.reason.trim(),"IDEMPOTENCY_CONTENT_CONFLICT");
     return {row:prior,dispatch:false};
   }
   const students=[];
   for(const studentId of ids){
     await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`direct-student:${input.schoolId}:${studentId}:${input.termId}`]);
     await assertNoBulkClaim(c,{schoolId:input.schoolId,studentId,termId:input.termId});
     const st=(await c.query(`SELECT s.* FROM students s WHERE s.id=$1 AND s.school_id=$2
       AND lower(s.status)='active' AND upper(s.admission_status)='ADMITTED'
       AND NOT EXISTS(SELECT 1 FROM student_subscription_terms t WHERE t.student_id=s.id AND t.academic_term_id=$3)
        AND NOT EXISTS(SELECT 1 FROM subscription_payment_assistance_requests ar
          WHERE ar.student_id=s.id AND ar.academic_term_id=$3 AND ar.status<>'CANCELLED')
       AND NOT EXISTS(SELECT 1 FROM student_direct_live_obligations o WHERE o.student_id=s.id AND o.academic_term_id=$3
         AND (o.amount_minor<>320000 OR o.assistance_request_id IS NOT NULL OR EXISTS(
           SELECT 1 FROM student_direct_live_attempts a WHERE a.obligation_id=o.id AND a.state<>'FAILED')))
       FOR SHARE OF s`,[studentId,input.schoolId,input.termId])).rows[0];
     demand(st,"STUDENT_INELIGIBLE_OR_ALREADY_CLAIMED");
     const review=reviews.get(studentId)!;
     const scope={schoolId:input.schoolId,studentId,termId:input.termId};
     const valid=deps.revalidate?await deps.revalidate(c,scope,review):
       Number((await findApprovedDirectReview(c as CurrentSql&{release():void},scope,review.report_digest,directLiveConfiguration()))?.id)===Number(review.id);
     demand(valid,"REVIEW_CHANGED_OR_WITHDRAWN");
     students.push({studentId,studentName:[st.first_name,st.last_name].filter(Boolean).join(" ")||`Student #${studentId}`,
       reviewId:Number(review.id),ruleId:Number(review.rule_id),reviewDigest:review.report_digest,
       merchantScope:review.merchant_scope,amountMinor:320000,schoolShareMinor:0,broShareMinor:0});
   }
   const email=(await c.query("SELECT email FROM app_users WHERE id=$1",[actorId])).rows[0]?.email;
   demand(typeof email==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),"VERIFIED_PAYER_EMAIL_REQUIRED");
   const row=(await c.query(`INSERT INTO current_payment_batches(school_id,academic_term_id,reference,request_key,
     amount_minor,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
     [input.schoolId,input.termId,`SCV4_live_bulk_${randomUUID().replaceAll("-","")}`,input.key,ids.length*320000,actorId,
       JSON.stringify({studentIds:ids,students,email,reason:input.reason.trim(),policy:"CURRENT_3200_PLATFORM_ONLY"})])).rows[0];
   for(const st of students)await c.query(`INSERT INTO current_bulk_allocations(batch_id,school_id,student_id,academic_term_id,review_id)
     VALUES($1,$2,$3,$4,$5)`,[row.id,input.schoolId,st.studentId,input.termId,st.reviewId]);
   await bulkEvent(c,Number(row.id),actorId,"PROCESSING","permanent-dispatch-claim",{moneyMoved:false});
   return {row,dispatch:true};
 });
 if(batch.dispatch){
   try{
     const checkout=deps.checkout??(v=>new FlutterwaveLiveTransport(undefined,undefined,"DIRECT_STUDENT").bulkStudentCheckout(v));
     const checkoutUrl=await checkout({reference:batch.row.reference,email:batch.row.snapshot.email,amountMinor:Number(batch.row.amount_minor)});
     demand(/^https:\/\/(?:[a-z0-9-]+\.)*flutterwave\.com\//i.test(checkoutUrl),"INVALID_PROVIDER_CHECKOUT_URL");
     await recordCheckoutOutcome(pool,Number(batch.row.id),actorId,"READY",{checkoutUrl,moneyMoved:false});
   }catch{
     await recordCheckoutOutcome(pool,Number(batch.row.id),actorId,"UNKNOWN",{automaticResend:false});
   }
 }
 return bulkView(pool,actorId,Number(batch.row.id));
}
export async function bulkView(pool:CurrentPool,actorId:number,id:number){
 return financialTransaction(pool,async c=>{
   const b=await batchRoot(c,id);await currentSchoolAuthority(c,actorId,Number(b.school_id));
   const ready=(await c.query(`SELECT details->>'checkoutUrl' AS url FROM current_bulk_events
     WHERE batch_id=$1 AND state='READY' ORDER BY id DESC LIMIT 1`,[id])).rows[0];
   const state=await batchState(c,id);
   return {id,reference:b.reference,state,amountMinor:Number(b.amount_minor),
     method:b.snapshot.method==="COMPANY_BANK"?"COMPANY_BANK":"FLUTTERWAVE",
     checkoutUrl:state==="READY"?ready?.url??null:null};
 });
}
export async function verifyCurrentBulk(pool:CurrentPool,actorId:number|null,id:number,transactionId:string,deps:BulkDependencies={},callbackReference?:string){
 const b=await financialTransaction(pool,async c=>{
   await requireCurrentExtensions(c);const row=await batchRoot(c,id);
   demand(row.snapshot.method!=="COMPANY_BANK","BANK_CREDIT_CANNOT_USE_PROVIDER_VERIFICATION");
   if(actorId!==null)await currentSchoolAuthority(c,actorId,Number(row.school_id));
   const attempts=(await c.query("SELECT to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL AS present")).rows[0]?.present;
   const latest=attempts?(await c.query("SELECT reference FROM current_bulk_checkout_attempts WHERE batch_id=$1 ORDER BY id DESC LIMIT 1",[id])).rows[0]:null;
   if(callbackReference&&callbackReference!==row.reference){
     demand(attempts&&(await c.query("SELECT 1 FROM current_bulk_checkout_attempts WHERE batch_id=$1 AND reference=$2",[id,callbackReference])).rows[0],
       "CHECKOUT_REFERENCE_NOT_BOUND_TO_BATCH");
   }
   row.verification_reference=callbackReference??latest?.reference??row.reference;
   return row;
 });
 const verify=deps.verify??((t,r,a)=>new FlutterwaveLiveTransport(undefined,undefined,"DIRECT_STUDENT").bulkStudentCollection(t,r,a));
 const facts=await verify(transactionId,b.verification_reference,Number(b.amount_minor));
 demand(facts.transactionId===transactionId&&facts.reference===b.verification_reference&&facts.amountMinor===Number(b.amount_minor)
   &&facts.currency==="NGN","AGGREGATE_VERIFICATION_MISMATCH");
 if(facts.status!=="successful"){
   // Only a fresh independently verified no-charge failure is retry evidence.
   return financialTransaction(pool,async c=>{
     if((await c.query("SELECT 1 FROM current_bulk_confirmations WHERE batch_id=$1",[id])).rows[0])
       return {id,state:await batchState(c,id),ignoredStaleProviderOutcome:true};
     if((await c.query("SELECT to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL AS present")).rows[0]?.present){
       const latest=(await c.query("SELECT reference FROM current_bulk_checkout_attempts WHERE batch_id=$1 ORDER BY id DESC LIMIT 1",[id])).rows[0];
       if(latest&&latest.reference!==facts.reference)return {id,state:await batchState(c,id),ignoredStaleAttemptOutcome:true};
     }
     await bulkEvent(c,id,actorId??Number(b.created_by),facts.status==="pending"?"PENDING":"FAILED",
       `verified-outcome:${digest(facts)}`,facts);
     return {id,state:facts.status==="pending"?"PENDING":"FAILED",moneyMoved:false};
   });
 }
 demand(/^[1-9][0-9]*$/.test(facts.transactionId)&&facts.providerReference
   &&Number.isSafeInteger(facts.providerFeeMinor)&&Number.isSafeInteger(facts.additionalFeeMinor)
   &&facts.providerFeeMinor!>=0&&facts.additionalFeeMinor!>=0
   &&facts.providerFeeMinor!+facts.additionalFeeMinor!<Number(b.amount_minor),"AGGREGATE_PROVIDER_FACTS_INVALID");
 await financialTransaction(pool,async c=>{
   const prior=(await c.query("SELECT * FROM current_bulk_confirmations WHERE batch_id=$1",[id])).rows[0];
   if(prior)demand(prior.provider_transaction_id===facts.transactionId&&prior.provider_reference===facts.providerReference,
     "AGGREGATE_TRANSACTION_CHANGED");
   else await c.query(`INSERT INTO current_bulk_confirmations(batch_id,provider_transaction_id,provider_reference,amount_minor,evidence)
     VALUES($1,$2,$3,$4,$5::jsonb)`,[id,facts.transactionId,facts.providerReference,facts.amountMinor,JSON.stringify(facts)]);
   await bulkEvent(c,id,actorId??Number(b.created_by),"VERIFIED","aggregate-verified",facts);
 });
 // Anonymous callbacks persist provider facts, never grant school operational authority.
 if(actorId===null)return {reference:b.reference,state:"VERIFIED",allocationRecoveryRequired:true};
 return recoverCurrentBulk(pool,actorId,id);
}
export async function verifyPublicCurrentBulk(pool:CurrentPool,reference:string,transactionId:string,deps:BulkDependencies={}){
 demand(/^SCV4_live_bulk_[A-Za-z0-9_-]{8,70}$/.test(reference),"INVALID_AGGREGATE_REFERENCE");
 const c=await pool.connect();let id:number;
 try{const b=(await c.query("SELECT id FROM current_payment_batches WHERE reference=$1",[reference])).rows[0];
   let found=b;
   if(!found&&(await c.query("SELECT to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL AS present")).rows[0]?.present)
     found=(await c.query("SELECT batch_id AS id FROM current_bulk_checkout_attempts WHERE reference=$1",[reference])).rows[0];
   demand(found,"BATCH_NOT_FOUND");id=Number(found.id);}finally{c.release();}
 return verifyCurrentBulk(pool,null,id,transactionId,deps,reference);
}
export async function recoverCurrentBulk(pool:CurrentPool,actorId:number,id:number){
 const children=await financialTransaction(pool,async c=>{
   await requireCurrentExtensions(c);const b=await batchRoot(c,id);
   const actor=await currentSchoolAuthority(c,actorId,Number(b.school_id));
   demand(b.snapshot.method!=="COMPANY_BANK"||actor.owner,"OWNER_BANK_ALLOCATION_REQUIRED");
   demand(await bulkProof(c,id),"VERIFIED_AGGREGATE_REQUIRED");
   return (await c.query("SELECT id FROM current_bulk_allocations WHERE batch_id=$1 ORDER BY id",[id])).rows;
 });
 let unresolved=0;
 for(const child of children){
   try{await financialTransaction(pool,async c=>{
     const b=await batchRoot(c,id),actor=await currentSchoolAuthority(c,actorId,Number(b.school_id));
     demand(b.snapshot.method!=="COMPANY_BANK"||actor.owner,"OWNER_BANK_ALLOCATION_REQUIRED");
     const allocation=(await c.query("SELECT * FROM current_bulk_allocations WHERE id=$1 AND batch_id=$2",[child.id,id])).rows[0];
     const posted=(await c.query("SELECT 1 FROM current_bulk_events WHERE allocation_id=$1 AND state='POSTED'",[child.id])).rows[0];
     if(!posted){
       const conflicting=(await c.query(`SELECT a.id FROM student_direct_live_attempts a
         JOIN student_direct_live_obligations o ON o.id=a.obligation_id WHERE o.student_id=$1 AND o.academic_term_id=$2
         AND a.state<>'FAILED'`,[allocation.student_id,allocation.academic_term_id])).rows[0];
       demand(!conflicting,"ALLOCATION_CONFLICT_REQUIRES_REVIEW");
       await bulkEvent(c,id,actorId,"POSTED",`posted:${child.id}`,{amountMinor:320000,receiptNumber:`YEC-B${id}-S${allocation.student_id}`},Number(child.id));
     }
     // A commission failure must never roll back a verified student's posting.
     // Savepoint recovery also keeps the transaction usable after SQL errors.
     await c.query("SAVEPOINT bulk_bro_accrual");
     try{
       await accrueBulkBro(c,actorId,Number(child.id));
       await bulkEvent(c,id,actorId,"BRO_ACCRUAL_CHECKED",`bro-checked:${child.id}:${randomUUID()}`,{},Number(child.id));
       await c.query("RELEASE SAVEPOINT bulk_bro_accrual");
     }catch{
       await c.query("ROLLBACK TO SAVEPOINT bulk_bro_accrual");
       await c.query("RELEASE SAVEPOINT bulk_bro_accrual");
       await bulkEvent(c,id,actorId,"BRO_ACCRUAL_PENDING",`bro-pending:${child.id}:${randomUUID()}`,
         {retryable:true,subscriptionPosted:true},Number(child.id));
     }
   });}catch(e){
     unresolved++;
     await financialTransaction(pool,c=>bulkEvent(c,id,actorId,"ALLOCATION_ERROR",`error:${child.id}:${randomUUID()}`,
       {code:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:"ALLOCATION_REQUIRES_REVIEW"},Number(child.id)));
   }
 }
 await financialTransaction(pool,c=>bulkEvent(c,id,actorId,unresolved?"RECOVERY_REQUIRED":"COMPLETED",
   `recovery:${randomUUID()}`,{unresolved}));
 return {id,state:unresolved?"RECOVERY_REQUIRED":"COMPLETED",unresolved,chargedAgain:false};
}
export async function accrueBulkBro(c:CurrentSql,actorId:number,allocationId:number){
 const prior=(await c.query("SELECT id FROM current_bulk_bro_entitlements WHERE allocation_id=$1",[allocationId])).rows[0];if(prior)return;
 const rows=(await c.query(`SELECT a.*,p.verified_at,t.start_date::timestamp AT TIME ZONE 'Africa/Lagos' AS term_start,
   at.id AS attribution_id,at.partner_profile_id
   FROM current_bulk_allocations a JOIN ${await bulkCreditSource(c)} p ON p.batch_id=a.batch_id
   JOIN academic_terms t ON t.id=a.academic_term_id AND t.school_id=a.school_id
   JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id AND lower(st.status)='active' AND upper(st.admission_status)='ADMITTED'
   JOIN school_partner_attributions at ON at.school_id=a.school_id AND at.status='ACTIVE'
     AND at.starts_at<=p.verified_at AND (at.ends_at IS NULL OR at.ends_at>p.verified_at)
   JOIN partner_profiles bp ON bp.id=at.partner_profile_id AND bp.status='ACTIVE'
   WHERE a.id=$1 AND NOT EXISTS(SELECT 1 FROM current_bulk_events e WHERE e.allocation_id=a.id AND e.state='ADVERSE_HOLD')`,
   [allocationId])).rows;
 if(rows.length===0)return;demand(rows.length===1,"AMBIGUOUS_BRO_ATTRIBUTION");
 const e=rows[0];
 const legacy=(await c.query(`SELECT 1 FROM bro_term_commission_entitlements WHERE student_id=$1 AND academic_term_id=$2
   UNION ALL SELECT 1 FROM commission_ledger l LEFT JOIN student_subscription_payments lp ON lp.id=l.payment_id
   WHERE l.student_id=$1 AND l.school_id=$3 AND (lp.academic_term_id=$2 OR lp.academic_term_id IS NULL) LIMIT 1`,
   [e.student_id,e.academic_term_id,e.school_id])).rows[0];
 if(legacy)return;
 const rollout=await readStudentRollout(c,Number(e.school_id),Number(e.academic_term_id),lagosDate(new Date(e.verified_at)));
 demand(rollout.periodEligible&&lagosDate(new Date(e.verified_at))>=rollout.collectionStartDate!,"BULK_BRO_ROLLOUT_INELIGIBLE");
 const p=(await c.query(`SELECT p.*,EXISTS(SELECT 1 FROM audit_logs a WHERE a.record_id=p.id AND a.role='PLATFORM_OWNER'
   AND a.event_type='SUBSCRIPTION_RULE_ACTIVATED' AND a.metadata->'after'->>'product'='BRO_COMMISSION'
   AND a.metadata->'after'->>'amountMinor'='15000' AND (a.metadata->'after'->>'version')::int=p.version
   AND (a.metadata->'after'->>'effectiveAt')::timestamptz=p.effective_at) AS approved
   FROM subscription_rule_proposals p WHERE p.product='BRO_COMMISSION' AND p.status<>'DRAFT'
   AND p.effective_at<=$1 ORDER BY p.effective_at DESC,p.id DESC LIMIT 1`,[e.term_start])).rows[0];
 demand(p,"APPROVED_BRO_RULE_REQUIRED");
 demand(broEntitlementAmount({id:Number(p.id),status:p.status,amountMinor:Number(p.amount_minor),
   effectiveAt:new Date(p.effective_at).toISOString(),endsAt:p.ends_at?new Date(p.ends_at).toISOString():null,approved:p.approved===true},
   {termStart:new Date(e.term_start).toISOString(),paidAt:new Date(e.verified_at).toISOString(),verified:true,
     studentEligible:true,attributionEligible:true,legacyExists:false})===15000,"APPROVED_BRO_RULE_REQUIRED");
 await c.query(`INSERT INTO current_bulk_bro_entitlements(allocation_id,school_id,student_id,academic_term_id,
   partner_profile_id,attribution_id,policy_id,earned_at,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
   [allocationId,e.school_id,e.student_id,e.academic_term_id,e.partner_profile_id,e.attribution_id,p.id,e.verified_at,
     JSON.stringify({funding:"SEPARATE_PLATFORM_EXPENSE",studentCollectionMinor:320000,collectionBroShareMinor:0}),actorId]);
}
