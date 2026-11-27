import {randomUUID} from "node:crypto";
import {financialTransaction} from "./financial-transaction";
import {currentSchoolAuthority,requireCurrentExtensions} from "./current-finance-access";
import {requireBankWorkflow,bulkProof} from "./current-payment-evidence";
import {batchRoot,batchState,bulkView,bulkEvent,recordCheckoutOutcome,type BulkDependencies} from "./current-bulk-subscriptions";
import {FlutterwaveLiveTransport} from "../lib/flutterwave-live-transport";
import {demand,requestKey,type CurrentPool} from "./current-financial-contract";
import {revalidateBulkRetry} from "./bulk-retry-authorization";

/** Retry the existing immutable student allocation set; never release a
 * Flutterwave reservation or use a timeout/client checkbox as no-charge proof. */
export async function retryCurrentBulk(pool:CurrentPool,actorId:number,input:{id:number;key:string;reason:string},deps:BulkDependencies={}){
 requestKey(input.key);
 demand(input.reason.trim().length>=3&&input.reason.trim().length<=500,"REASON_REQUIRED");
 const prepared=await financialTransaction(pool,async c=>{
   await requireCurrentExtensions(c);await requireBankWorkflow(c);
   const b=await batchRoot(c,input.id);await currentSchoolAuthority(c,actorId,Number(b.school_id));
   demand(b.snapshot.method!=="COMPANY_BANK","FLUTTERWAVE_BATCH_REQUIRED");
   // Known stale authorization must not even initiate a verification GET.
    await revalidateBulkRetry(c,b,deps);
   const prior=(await c.query("SELECT * FROM current_bulk_checkout_attempts WHERE request_key=$1",[input.key])).rows[0];
   if(prior){
     demand(Number(prior.batch_id)===input.id&&Number(prior.created_by)===actorId&&prior.reason===input.reason.trim(),"IDEMPOTENCY_CONTENT_CONFLICT");
     return {b,replay:true as const};
   }
   demand(await batchState(c,input.id)==="FAILED"&&!await bulkProof(c,input.id),"ONLY_VERIFIED_FAILED_BATCH_CAN_RETRY");
   const failed=(await c.query(`SELECT details FROM current_bulk_events WHERE batch_id=$1
     AND allocation_id IS NULL AND state='FAILED' ORDER BY id DESC LIMIT 1`,[input.id])).rows[0]?.details;
   demand(failed&&/^[1-9][0-9]{0,15}$/.test(failed.transactionId)&&typeof failed.reference==="string",
     "RETAINED_PROVIDER_FAILURE_REQUIRED");
   return {b,replay:false as const,failed};
 });
 if(prepared.replay)return bulkView(pool,actorId,input.id);
 const {b,failed}=prepared;
 const verify=deps.verify??((t,r,a)=>new FlutterwaveLiveTransport(undefined,undefined,"DIRECT_STUDENT").bulkStudentCollection(t,r,a));
 const facts=await verify(failed.transactionId,failed.reference,Number(b.amount_minor));
 demand(facts.transactionId===failed.transactionId&&facts.reference===failed.reference
   &&facts.amountMinor===Number(b.amount_minor)&&facts.currency==="NGN"
   &&["failed","cancelled"].includes(facts.status)&&facts.chargedAmountMinor===0,
   "FRESH_INDEPENDENT_ZERO_CHARGE_EVIDENCE_REQUIRED");
 const attempt=await financialTransaction(pool,async c=>{
   await currentSchoolAuthority(c,actorId,Number(b.school_id));await requireBankWorkflow(c);
   const existing=(await c.query("SELECT * FROM current_bulk_checkout_attempts WHERE request_key=$1",[input.key])).rows[0];
   if(existing){
     demand(Number(existing.batch_id)===input.id&&Number(existing.created_by)===actorId&&existing.reason===input.reason.trim(),
       "IDEMPOTENCY_CONTENT_CONFLICT");return null;
   }
   demand(await batchState(c,input.id)==="FAILED"&&!await bulkProof(c,input.id),"BATCH_STATE_CHANGED_NO_RETRY");
   const latest=(await c.query("SELECT reference FROM current_bulk_checkout_attempts WHERE batch_id=$1 ORDER BY id DESC LIMIT 1",[input.id])).rows[0];
   demand((latest?.reference??b.reference)===facts.reference,"STALE_ATTEMPT_FAILURE_CANNOT_AUTHORIZE_RETRY");
    await revalidateBulkRetry(c,b,deps);
   const row=(await c.query(`INSERT INTO current_bulk_checkout_attempts(batch_id,reference,request_key,
     previous_transaction_id,evidence,reason,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
     [input.id,`SCV4_live_bulk_${randomUUID().replaceAll("-","")}`,input.key,facts.transactionId,
      JSON.stringify(facts),input.reason.trim(),actorId])).rows[0];
   await bulkEvent(c,input.id,actorId,"PROCESSING",`retry-claim:${row.id}`,
     {attemptReference:row.reference,reason:input.reason.trim(),independentNoChargeEvidence:facts,moneyMoved:false});
   return row;
 });
 if(attempt){
   try{
     // Final durable dispatch-authorization boundary. A withdrawal committed
     // during the independent GET or after reservation blocks the POST.
     await financialTransaction(pool,async c=>{
       await currentSchoolAuthority(c,actorId,Number(b.school_id));
       await revalidateBulkRetry(c,await batchRoot(c,input.id),deps);
       demand(await batchState(c,input.id)==="PROCESSING","RETRY_DISPATCH_STATE_CHANGED");
       await bulkEvent(c,input.id,actorId,"PROCESSING",`retry-dispatch-authorized:${attempt.id}`,
         {attemptReference:attempt.reference,moneyMoved:false});
     });
   }catch(error){
     await financialTransaction(pool,async c=>{
       // A concurrent verification may already have confirmed/posted payment.
       // A no-send failure must not rewind those independently retained facts.
       if(await batchState(c,input.id)!=="PROCESSING")return;
       const latest=(await c.query("SELECT reference FROM current_bulk_checkout_attempts WHERE batch_id=$1 ORDER BY id DESC LIMIT 1",[input.id])).rows[0];
       if(latest?.reference!==attempt.reference)return;
       await bulkEvent(c,input.id,actorId,"FAILED",`retry-dispatch-blocked:${attempt.id}`,
         {attemptReference:attempt.reference,providerDispatch:"NOT_SENT",automaticResend:false,moneyMoved:false});
     });
     throw error;
   }
   try{
     const checkout=deps.checkout??(v=>new FlutterwaveLiveTransport(undefined,undefined,"DIRECT_STUDENT").bulkStudentCheckout(v));
     const checkoutUrl=await checkout({reference:attempt.reference,email:b.snapshot.email,amountMinor:Number(b.amount_minor)});
     demand(/^https:\/\/(?:[a-z0-9-]+\.)*flutterwave\.com\//i.test(checkoutUrl),"INVALID_PROVIDER_CHECKOUT_URL");
     await recordCheckoutOutcome(pool,input.id,actorId,"READY",{checkoutUrl,attemptReference:attempt.reference,moneyMoved:false});
   }catch{
     await recordCheckoutOutcome(pool,input.id,actorId,"UNKNOWN",{attemptReference:attempt.reference,automaticResend:false});
   }
 }
 return bulkView(pool,actorId,input.id);
}
