import { createHash } from "node:crypto";
import type { StudentSubscriptionSqlPool,StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow,requireLiveWorkflow,type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { blockedLiveCollectionVerifier,LiveFinalizationBlocked,type LiveCollectionVerifier } from "../lib/flutterwave-live-verification";
import { processLiveWorkflow } from "./flutterwave-live-lifecycle";

export type LiveOperatorContext={actorId:number;merchantScope:string;development:boolean;capability?:LiveWorkflowCapability};
export type LiveReviewAction="REVIEW"|"CONFIRM_DURABILITY"|"RETRY";
export type LiveReviewReason="PENDING"|"DUPLICATE"|"UNCERTAIN_COMMIT"|"REFUND"|"REVERSAL"|"DISPUTE";
function guard(context:LiveOperatorContext){
  requireLiveWorkflow(context.capability??blockedLiveWorkflow);
  if(!context.development)throw new LiveFinalizationBlocked("LIVE_OPERATOR_DEVELOPMENT_ONLY");
  if(!Number.isSafeInteger(context.actorId)||context.actorId<=0||!/^[A-Za-z0-9_-]{8,80}$/.test(context.merchantScope))
    throw new LiveFinalizationBlocked("LIVE_OPERATOR_SCOPE_INVALID");
}
async function owner(client:StudentSubscriptionSqlClient,context:LiveOperatorContext){
  const result=await client.query(`SELECT au.id FROM app_users au JOIN school_memberships sm ON sm.user_id=au.id
    WHERE au.id=$1 AND au.status='ACTIVE' AND sm.role='PLATFORM_OWNER' AND sm.status='ACTIVE' FOR SHARE OF au,sm`,[context.actorId]);
  if(!result.rows.length)throw new LiveFinalizationBlocked("LIVE_OPERATOR_OWNER_REQUIRED");
}
const projection=`SELECT wr.id AS receipt_id,wr.payload_sha256,wr.delivery_count,
  rc.reason_code AS reconciliation_reason,i.id AS intent_id,i.merchant_scope AS verified_merchant_scope,
  i.school_id,i.student_id,i.term_id,
  CASE WHEN i.on_hold OR e.kind='ADVERSE_HOLD' OR act.status='HELD' THEN 'HELD_RETAINED'
    WHEN e.kind='COLLECTION' AND c.intent_id IS NOT NULL AND act.intent_id IS NOT NULL
     AND off.intent_id IS NOT NULL AND i.state='COLLECTION_VERIFIED' THEN 'RECORDED_UNRELEASED'
    ELSE 'EVIDENCE_REQUIRED' END AS outcome
 FROM flutterwave_live_webhook_receipts wr
 LEFT JOIN flutterwave_live_reconciliation_cases rc ON rc.receipt_id=wr.id AND rc.environment='LIVE'
 LEFT JOIN flutterwave_live_receipt_results rr ON rr.receipt_id=wr.id AND rr.environment='LIVE'
 LEFT JOIN flutterwave_live_finalization_events e ON e.id=rr.event_id AND e.environment='LIVE'
 LEFT JOIN flutterwave_live_subscription_intents i ON i.id=e.intent_id AND i.environment='LIVE'
 LEFT JOIN flutterwave_live_collection_evidence c ON c.intent_id=i.id AND c.environment='LIVE'
 LEFT JOIN flutterwave_live_subscription_activations act ON act.intent_id=i.id AND act.environment='LIVE'
 LEFT JOIN flutterwave_live_official_receipts off ON off.intent_id=i.id AND off.environment='LIVE'
 WHERE wr.environment='LIVE' AND wr.signature_verified=true AND (i.id IS NULL OR i.merchant_scope=$1)`;

export async function listLiveOperatorReceipts(pool:StudentSubscriptionSqlPool,context:LiveOperatorContext,receiptId?:number){
  guard(context);const client=await pool.connect();
  try{
    await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout='3s'");
    // FOR SHARE is forbidden in read-only transactions; authorization below is a
    // nonlocking positive check. Mutating reviews lock the current authority.
    const allowed=await client.query(`SELECT au.id FROM app_users au JOIN school_memberships sm ON sm.user_id=au.id
      WHERE au.id=$1 AND au.status='ACTIVE' AND sm.role='PLATFORM_OWNER' AND sm.status='ACTIVE'`,[context.actorId]);
    if(!allowed.rows.length)throw new LiveFinalizationBlocked("LIVE_OPERATOR_OWNER_REQUIRED");
    if(receiptId!==undefined&&(!Number.isSafeInteger(receiptId)||receiptId<=0))throw new LiveFinalizationBlocked("LIVE_OPERATOR_INPUT_INVALID");
    const rows=(await client.query(`${projection}${receiptId===undefined?"":" AND wr.id=$2"} ORDER BY wr.id DESC LIMIT 100`,
      receiptId===undefined?[context.merchantScope]:[context.merchantScope,receiptId])).rows;
    await client.query("COMMIT");
    return {environment:"LIVE",operationallyProcessed:false,settlementVerified:false,
      receipts:rows.map(({payload_sha256:_fingerprint,...row})=>row)};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}

/** An operator records review, confirms durability, or retries a verified kernel.
 * It cannot send money, assert settlement, close/delete evidence, release holds,
 * or reconstruct original bytes from untrusted inbox claims. */
export async function reviewLiveReceipt(pool:StudentSubscriptionSqlPool,context:LiveOperatorContext,input:{
  receiptId:number;action:LiveReviewAction;reason:LiveReviewReason;idempotencyKey:string;originalBody?:Buffer;
},verifier:LiveCollectionVerifier=blockedLiveCollectionVerifier){
  guard(context);
  if(!Number.isSafeInteger(input.receiptId)||input.receiptId<=0
    ||!["REVIEW","CONFIRM_DURABILITY","RETRY"].includes(input.action)
    ||!["PENDING","DUPLICATE","UNCERTAIN_COMMIT","REFUND","REVERSAL","DISPUTE"].includes(input.reason)
    ||!/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey))
    throw new LiveFinalizationBlocked("LIVE_OPERATOR_INPUT_INVALID");
  if(input.action==="RETRY"&&(!Buffer.isBuffer(input.originalBody)||!input.originalBody.length||input.originalBody.length>65536))
    throw new LiveFinalizationBlocked("LIVE_ORIGINAL_BYTES_REQUIRED");
  const fingerprint=input.originalBody ? createHash("sha256").update(input.originalBody).digest("hex") : null;
  const requestHash=createHash("sha256").update(JSON.stringify([context.actorId,input.receiptId,input.action,input.reason,fingerprint])).digest("hex");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='3s'");
    await owner(client,context);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`live-review:${context.merchantScope}:${input.idempotencyKey}`]);
    const previous=(await client.query(`SELECT * FROM flutterwave_live_operator_reviews
      WHERE environment='LIVE' AND merchant_scope=$1 AND idempotency_key=$2`,[context.merchantScope,input.idempotencyKey])).rows[0];
    if(previous&&previous.request_hash!==requestHash)throw new LiveFinalizationBlocked("LIVE_REVIEW_KEY_CONFLICT");
    let receipt=(await client.query(`${projection} AND wr.id=$2`,[context.merchantScope,input.receiptId])).rows[0];
    if(!receipt)throw new LiveFinalizationBlocked("LIVE_OPERATOR_RECEIPT_UNAVAILABLE");
    if(input.action==="RETRY"&&fingerprint!==receipt.payload_sha256)throw new LiveFinalizationBlocked("LIVE_ORIGINAL_BYTES_MISMATCH");
    if(previous){
      await client.query("COMMIT");
      // A replay returns CURRENT financial protection, not a stale approved view.
      return {review:previous,duplicate:true,currentOutcome:receipt.outcome,operationallyProcessed:false};
    }
    let outcome=input.action==="REVIEW" ? "REVIEW_RECORDED" : receipt.outcome;
    if(input.action==="RETRY"&&receipt.outcome==="EVIDENCE_REQUIRED"){
      if(verifier.enabled && verifier.environment==="LIVE" && verifier.merchantScope===context.merchantScope){
        try{await processLiveWorkflow(pool,input.receiptId,input.originalBody!,verifier,context.capability);}
        catch{outcome="RETRY_REFUSED";} // Never convert a transport/commit failure into Paid.
        receipt=(await client.query(`${projection} AND wr.id=$2`,[context.merchantScope,input.receiptId])).rows[0];
        if(!receipt)throw new LiveFinalizationBlocked("LIVE_OPERATOR_RECEIPT_UNAVAILABLE");
        if(receipt.outcome!=="EVIDENCE_REQUIRED")outcome=receipt.outcome;
      }else outcome="EVIDENCE_REQUIRED"; // No disabled verifier call or provider fallback.
    }
    const row=(await client.query(`INSERT INTO flutterwave_live_operator_reviews
      (merchant_scope,receipt_id,actor_id,idempotency_key,request_hash,action,reason,outcome)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [context.merchantScope,input.receiptId,context.actorId,input.idempotencyKey,requestHash,input.action,input.reason,outcome])).rows[0];
    await client.query("COMMIT");
    return {review:row,duplicate:false,currentOutcome:receipt.outcome,operationallyProcessed:false};
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
