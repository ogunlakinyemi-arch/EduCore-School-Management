import {randomUUID} from "node:crypto";
import {financialTransaction} from "./financial-transaction";
import {currentSchoolAuthority,requireCurrentExtensions} from "./current-finance-access";
import {demand,requestKey,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {digest} from "./current-financial-store";
import {requireBankWorkflow,bulkProof} from "./current-payment-evidence";
import {batchRoot,batchState,bulkEvent,bulkView,assertNoBulkClaim,recoverCurrentBulk} from "./current-bulk-subscriptions";
import {ownerBankTransferInstructions} from "./owner-bank-transfer-instructions";
import {lagosDate,readStudentUsageRollout} from "./student-platform-rollout";

export function normalizedBankReference(value:string){
 demand(/^[A-Za-z0-9/._ -]{6,120}$/.test(value),"INVALID_BANK_STATEMENT_REFERENCE");
 const normalized=value.replace(/\s/g,"").toLowerCase();
 demand(normalized.length>=6&&/[a-z0-9]/.test(normalized),"INVALID_BANK_STATEMENT_REFERENCE");
 return normalized;
}
const reasonValue=(value:string)=>{
 demand(value.trim().length>=3&&value.trim().length<=500,"REASON_REQUIRED");return value.trim();
};
async function authority(c:CurrentSql,actorId:number,schoolId:number,owner=false){
 const a=await currentSchoolAuthority(c,actorId,schoolId);
 demand(!owner||a.owner,"OWNER_BANK_VERIFICATION_REQUIRED");
 await requireCurrentExtensions(c);await requireBankWorkflow(c);
 return a;
}
async function bankRule(c:CurrentSql,schoolId:number,termId:number){
 // Select authority first, then evaluate it. Never resurrect an older rule
 // because the latest effective rule was retired or withdrawn.
 const p=(await c.query(`SELECT p.*,t.start_date::text AS term_start,
   p.effective_at<=t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'
     AND (p.ends_at IS NULL OR p.ends_at>t.start_date::timestamp AT TIME ZONE 'Africa/Lagos') AS in_window,
   EXISTS(SELECT 1 FROM audit_logs a WHERE a.record_id=p.id AND a.role='PLATFORM_OWNER'
     AND a.event_type='SUBSCRIPTION_RULE_ACTIVATED'
     AND a.metadata->'after'->>'product'='STUDENT_PLATFORM'
     AND a.metadata->'after'->>'amountMinor'='320000'
     AND (a.metadata->'after'->>'version')::int=p.version
     AND (a.metadata->'after'->>'effectiveAt')::timestamptz=p.effective_at) AS approved
   FROM subscription_rule_proposals p JOIN academic_terms t ON t.id=$2 AND t.school_id=$1
   WHERE p.product='STUDENT_PLATFORM' AND p.status<>'DRAFT'
     AND p.effective_at<=t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'
   ORDER BY p.effective_at DESC,p.id DESC LIMIT 1`,[schoolId,termId])).rows[0];
 demand(p&&["ACTIVE","SCHEDULED"].includes(p.status)&&p.in_window===true&&p.approved===true
   &&p.activated_at&&Number(p.amount_minor)===320000&&p.currency==="NGN"&&Number(p.school_share_minor)===0,
   "APPROVED_3200_BANK_COLLECTION_RULE_REQUIRED");
 return p;
}
async function audit(c:CurrentSql,actorId:number,b:any,action:string,key:string,reason:string,details:object={}){
 const actor=(await c.query(`SELECT u.email,u.clerk_user_id,m.role FROM app_users u
   JOIN school_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
   WHERE u.id=$1 AND u.status='ACTIVE' AND
     ((m.role='PLATFORM_OWNER' AND m.school_id IS NULL)
      OR(m.role IN ('SCHOOL_ADMIN','ACCOUNTANT') AND m.school_id=$2))
   ORDER BY CASE WHEN m.role='PLATFORM_OWNER' THEN 0 ELSE 1 END LIMIT 1`,[actorId,b.school_id])).rows[0];
 demand(actor,"CURRENT_FINANCE_ACCESS_DENIED");
 await bulkEvent(c,Number(b.id),actorId,action,`${action}:${key}`,{reason,...details});
 await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
   VALUES($1,$2,$3,$4,$5,'Company bank remittances',$6,$5,$7::jsonb)`,
   [actor.email,actor.role,actorId,actor.clerk_user_id,`BANK_REMITTANCE_${action}`,b.id,
    JSON.stringify({schoolId:Number(b.school_id),termId:Number(b.academic_term_id),key,reason,...details})]);
}
export async function requestBankRemittance(pool:CurrentPool,actorId:number,input:{
 schoolId:number;termId:number;studentIds:number[];key:string;reason:string}){
 requestKey(input.key);const reason=reasonValue(input.reason),ids=[...input.studentIds].sort((a,b)=>a-b);
 demand(ids.length>0&&ids.length<=500&&ids.every(v=>Number.isSafeInteger(v)&&v>0)&&new Set(ids).size===ids.length,
   "DISTINCT_STUDENTS_REQUIRED");
 const id=await financialTransaction(pool,async c=>{
   await authority(c,actorId,input.schoolId);
   await c.query("SELECT pg_advisory_xact_lock(7749,$1::integer)",[input.schoolId]);
   const prior=(await c.query("SELECT * FROM current_payment_batches WHERE request_key=$1",[input.key])).rows[0];
   if(prior){
     demand(prior.snapshot.method==="COMPANY_BANK"&&Number(prior.created_by)===actorId
       &&Number(prior.school_id)===input.schoolId&&Number(prior.academic_term_id)===input.termId
       &&digest(prior.snapshot.studentIds)===digest(ids)&&prior.snapshot.reason===reason,"IDEMPOTENCY_CONTENT_CONFLICT");
     return Number(prior.id);
   }
   demand((await readStudentUsageRollout(c,input.schoolId,input.termId)).chargeable,"FREE_OR_INELIGIBLE_TERM");
   const rule=await bankRule(c,input.schoolId,input.termId),students=[];
   for(const studentId of ids){
     await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`direct-student:${input.schoolId}:${studentId}:${input.termId}`]);
     await assertNoBulkClaim(c,{schoolId:input.schoolId,studentId,termId:input.termId});
     const st=(await c.query(`SELECT s.* FROM students s WHERE s.id=$2 AND s.school_id=$1
       AND lower(s.status)='active' AND upper(s.admission_status)='ADMITTED'
       AND NOT EXISTS(SELECT 1 FROM student_subscription_terms t WHERE t.student_id=s.id AND t.academic_term_id=$3)
       AND NOT EXISTS(SELECT 1 FROM student_direct_live_obligations o WHERE o.student_id=s.id AND o.academic_term_id=$3
         AND (o.amount_minor<>320000 OR o.assistance_request_id IS NOT NULL OR EXISTS(
           SELECT 1 FROM student_direct_live_attempts a WHERE a.obligation_id=o.id AND a.state<>'FAILED')))
       AND NOT EXISTS(SELECT 1 FROM subscription_payment_assistance_requests ar
         WHERE ar.student_id=s.id AND ar.academic_term_id=$3 AND ar.status<>'CANCELLED')
       FOR SHARE OF s`,[input.schoolId,studentId,input.termId])).rows[0];
     demand(st,"STUDENT_INELIGIBLE_OR_EXISTING_PAYMENT_ASSISTANCE");
     students.push({studentId,studentName:[st.first_name,st.last_name].filter(Boolean).join(" "),
       amountMinor:320000});
   }
   const b=(await c.query(`INSERT INTO current_payment_batches(school_id,academic_term_id,reference,request_key,
     amount_minor,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
     [input.schoolId,input.termId,`YEC_BANK_${randomUUID().replaceAll("-","")}`,input.key,ids.length*320000,actorId,
      JSON.stringify({method:"COMPANY_BANK",studentIds:ids,students,reason,ruleId:Number(rule.id),ruleVersion:Number(rule.version)})])).rows[0];
   for(const st of students)await c.query(`INSERT INTO current_bulk_allocations(batch_id,school_id,student_id,academic_term_id,review_id)
     VALUES($1,$2,$3,$4,NULL)`,[b.id,input.schoolId,st.studentId,input.termId]);
   await audit(c,actorId,b,"REQUESTED",input.key,reason,{studentIds:ids,expectedAmountMinor:ids.length*320000,moneyMoved:false});
   return Number(b.id);
 });
 return bulkView(pool,actorId,id);
}
export async function bankRemittanceInstructions(pool:CurrentPool,actorId:number,id:number){
 return financialTransaction(pool,async c=>{
   const b=await batchRoot(c,id);await authority(c,actorId,Number(b.school_id));
   demand(b.snapshot.method==="COMPANY_BANK","BANK_REMITTANCE_REQUIRED");
   const instructions=await ownerBankTransferInstructions(c,{schoolId:Number(b.school_id),
     studentId:Number(b.snapshot.studentIds[0]),termId:Number(b.academic_term_id)},actorId);
   demand(instructions,"SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
   return {...instructions,amountMinor:Number(b.amount_minor),transferReference:b.reference,
     message:"Use this aggregate request reference. Requests and receipts are not payment. Only independently verified company-bank credit followed by Owner posting establishes entitlement; do not transfer twice."};
 });
}
export async function verifyBankRemittance(pool:CurrentPool,actorId:number,input:{
 id:number;bankName:string;statementReference:string;creditDate:string;amountMinor:number;
 independentlyChecked:true;key:string;reason:string}){
 requestKey(input.key);const reason=reasonValue(input.reason),reference=normalizedBankReference(input.statementReference);
 const date=new Date(`${input.creditDate}T00:00:00Z`);
 demand(input.independentlyChecked===true&&/^\d{4}-\d{2}-\d{2}$/.test(input.creditDate)
   &&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===input.creditDate
   &&input.creditDate<=lagosDate(),"INDEPENDENT_MATCHING_BANK_CREDIT_REQUIRED");
 await financialTransaction(pool,async c=>{
   const b=await batchRoot(c,input.id);await authority(c,actorId,Number(b.school_id),true);
   demand(b.snapshot.method==="COMPANY_BANK"&&input.amountMinor===Number(b.amount_minor),"EXACT_AGGREGATE_BANK_AMOUNT_REQUIRED");
   const prior=(await c.query("SELECT *,credit_date::text AS credit_date FROM current_bank_credits WHERE batch_id=$1",[input.id])).rows[0];
   if(prior){
     demand(prior.request_key===input.key&&Number(prior.verified_by)===actorId&&prior.normalized_reference===reference
       &&String(prior.credit_date).slice(0,10)===input.creditDate&&Number(prior.amount_minor)===input.amountMinor
       &&prior.bank_name===input.bankName.trim()&&prior.reason===reason,"BANK_CREDIT_ALREADY_RECORDED_OR_CONTENT_CHANGED");
     return;
   }
   demand(await batchState(c,input.id)==="REQUESTED","BANK_REQUEST_NOT_OPEN");
    // The statement's actual credit day, not the Owner's review day, must
    // belong to this school's saved term (both endpoints inclusive).
    demand((await c.query(`SELECT 1 FROM academic_terms WHERE id=$1 AND school_id=$2
      AND $3::date BETWEEN start_date AND end_date`,
      [b.academic_term_id,b.school_id,input.creditDate])).rows[0],"BANK_CREDIT_OUTSIDE_ACADEMIC_TERM");
   const rollout=await readStudentUsageRollout(c,Number(b.school_id),Number(b.academic_term_id));
   demand(rollout.chargeable,"FREE_OR_INELIGIBLE_TERM");
   const rule=await bankRule(c,Number(b.school_id),Number(b.academic_term_id));
   demand(Number(rule.id)===b.snapshot.ruleId&&Number(rule.version)===b.snapshot.ruleVersion,"BANK_REQUEST_RULE_CHANGED_REVIEW_REQUIRED");
   const instructions=await ownerBankTransferInstructions(c,{schoolId:Number(b.school_id),
     studentId:Number(b.snapshot.studentIds[0]),termId:Number(b.academic_term_id)},actorId);
   const account=instructions?.bank;
   demand(instructions?.available&&account,"VERIFIED_COMPANY_RECEIVING_ACCOUNT_REQUIRED");
   const bankName=(s:string)=>s.trim().replace(/\s+/g," ").toLowerCase();
   demand(bankName(input.bankName)===bankName(account.bankName),"BANK_NAME_MISMATCH");
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`company-credit:${reference}`]);
   demand(!(await c.query(`SELECT id FROM subscription_payment_assistance_requests
     WHERE status='BANK_VERIFIED' AND lower(regexp_replace(bank_statement_reference,'[[:space:]]','','g'))=$1
     UNION ALL SELECT batch_id AS id FROM current_bank_credits WHERE normalized_reference=$1`,[reference])).rows[0],
     "BANK_REFERENCE_ALREADY_USED");
   const allocation=(await c.query(`SELECT count(*)::int AS count,COALESCE(sum(a.amount_minor),0)::bigint AS amount,
     bool_and(s.school_id=a.school_id AND lower(s.status)='active' AND upper(s.admission_status)='ADMITTED') AS eligible
     FROM current_bulk_allocations a JOIN students s ON s.id=a.student_id WHERE a.batch_id=$1`,[b.id])).rows[0];
   demand(allocation?.eligible===true&&Number(allocation.count)===b.snapshot.studentIds.length
     &&Number(allocation.amount)===input.amountMinor,"BANK_ALLOCATION_SCOPE_OR_AMOUNT_MISMATCH");
   await c.query(`INSERT INTO current_bank_credits(batch_id,bank_name,statement_reference,normalized_reference,
     credit_date,amount_minor,independently_checked,account_fingerprint,request_key,reason,verified_by)
     VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10)`,
     [b.id,input.bankName.trim(),input.statementReference,reference,input.creditDate,input.amountMinor,
      digest({businessName:account.businessName,bankName:account.bankName,accountName:account.accountName,accountNumber:account.accountNumber}),
      input.key,reason,actorId]);
   await audit(c,actorId,b,"BANK_VERIFIED",input.key,reason,{amountMinor:input.amountMinor,
     normalizedReference:reference,creditDate:input.creditDate,independentlyChecked:true});
 });
 return bulkView(pool,actorId,input.id);
}
export async function postBankRemittance(pool:CurrentPool,actorId:number,id:number,key:string,reason:string){
 requestKey(key);reason=reasonValue(reason);
 await financialTransaction(pool,async c=>{
   const b=await batchRoot(c,id);await authority(c,actorId,Number(b.school_id),true);
   demand(b.snapshot.method==="COMPANY_BANK"&&await bulkProof(c,id),"VERIFIED_BANK_CREDIT_REQUIRED");
   const event=(await c.query("SELECT * FROM current_bulk_events WHERE event_key=$1",[`${id}:BANK_VERIFIED:${key}`])).rows[0];
   if(event)demand(event.details.action==="ALLOCATION_REQUESTED"&&event.details.reason===reason
     &&Number(event.actor_user_id)===actorId,"IDEMPOTENCY_CONTENT_CONFLICT");
   if(!event)await audit(c,actorId,b,"BANK_VERIFIED",key,reason,{action:"ALLOCATION_REQUESTED"});
 });
 return recoverCurrentBulk(pool,actorId,id);
}
export async function closeBankRemittance(pool:CurrentPool,actorId:number,id:number,key:string,reason:string,state:"REJECTED"|"CANCELLED"){
 requestKey(key);reason=reasonValue(reason);
 await financialTransaction(pool,async c=>{
   const b=await batchRoot(c,id),actor=await authority(c,actorId,Number(b.school_id),state==="REJECTED");
   demand(b.snapshot.method==="COMPANY_BANK"&&(actor.owner||Number(b.created_by)===actorId),"BANK_CANCELLATION_NOT_AUTHORIZED");
   const prior=(await c.query("SELECT * FROM current_bulk_events WHERE event_key=$1",[`${id}:${state}:${key}`])).rows[0];
   if(prior){demand(prior.details.reason===reason&&Number(prior.actor_user_id)===actorId,"IDEMPOTENCY_CONTENT_CONFLICT");return;}
   demand(await batchState(c,id)==="REQUESTED"&&!await bulkProof(c,id),"VERIFIED_BANK_CREDIT_CANNOT_BE_CANCELLED");
   await audit(c,actorId,b,state,key,reason);
   const event=(await c.query("SELECT id FROM current_bulk_events WHERE event_key=$1",[`${id}:${state}:${key}`])).rows[0];
   await c.query(`INSERT INTO current_bulk_allocation_releases(allocation_id,event_id,released_by)
     SELECT id,$2,$3 FROM current_bulk_allocations WHERE batch_id=$1`,[id,event.id,actorId]);
 });
 return bulkView(pool,actorId,id);
}
export async function cancelLegacyAssistance(pool:CurrentPool,actorId:number,id:number,key:string,reason:string){
 requestKey(key);reason=reasonValue(reason);
 return financialTransaction(pool,async c=>{
   const row=(await c.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1 FOR UPDATE",[id])).rows[0];
   demand(row,"ASSISTANCE_REQUEST_REQUIRED");
   await authority(c,actorId,Number(row.school_id),true);
   const prior=(await c.query(`SELECT metadata FROM audit_logs WHERE record_id=$1
     AND event_type='SUBSCRIPTION_ASSISTANCE_CANCELLED' AND metadata->>'key'=$2`,[id,key])).rows[0];
   if(prior){demand(prior.metadata.reason===reason&&prior.metadata.actorId===actorId,"IDEMPOTENCY_CONTENT_CONFLICT");
     return {id,status:"CANCELLED"};}
   demand(row.status==="REQUESTED"&&!row.verified_at&&!(await c.query(
     "SELECT id FROM student_direct_live_obligations WHERE assistance_request_id=$1",[id])).rows[0],"ASSISTANCE_HAS_CREDIT_OR_CHECKOUT");
   await c.query("UPDATE subscription_payment_assistance_requests SET status='CANCELLED' WHERE id=$1",[id]);
   const user=(await c.query("SELECT email,clerk_user_id FROM app_users WHERE id=$1",[actorId])).rows[0];
   await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
     VALUES($1,'PLATFORM_OWNER',$2,$3,'ASSISTANCE_CANCELLED','Company bank remittances',$4,'SUBSCRIPTION_ASSISTANCE_CANCELLED',$5::jsonb)`,
     [user.email,actorId,user.clerk_user_id,id,JSON.stringify({key,reason,actorId,before:"REQUESTED",after:"CANCELLED"})]);
   return {id,status:"CANCELLED"};
 });
}
