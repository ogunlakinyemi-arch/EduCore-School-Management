import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { requireLiveRelease } from "../lib/flutterwave-live-release";
import { authenticateLiveWebhook,FlutterwaveLiveTransport,liveCollectionVerifier,liveCheckoutUrl } from "../lib/flutterwave-live-transport";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";
import { persistAuthenticatedLiveWebhookReceipt } from "./flutterwave-live-webhook-inbox";
import { processLiveWorkflow } from "./flutterwave-live-lifecycle";
import { issueLiveIntent } from "./flutterwave-live-intents";
import { verifyLiveSplitAuthority } from "../lib/flutterwave-live-split-authority";

export async function processReleasedLiveWebhook(pool:StudentSubscriptionSqlPool,raw:Buffer,
  headers:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch) {
  // Authenticate before acquiring any DB connection, including release checks.
  authenticateLiveWebhook(headers,env);
  const release=await requireLiveRelease(pool,env);
  const transport=new FlutterwaveLiveTransport(env,fetcher);
  const receiptId=await persistAuthenticatedLiveWebhookReceipt(pool,raw);
  const result=await processLiveWorkflow(pool,receiptId,raw,
    liveCollectionVerifier(pool,transport,release.merchantScope),release.capability);
  return {...result,processed:true,operationallyProcessed:true};
}

export async function initializeLiveSubscriptionCheckout(pool:StudentSubscriptionSqlPool,input:{
  actorId:number;schoolId:number;studentId:number;termId:number;idempotencyKey:string;email:string;
},env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch) {
  const release=await requireLiveRelease(pool,env);
  let client=await pool.connect(),authority:any;
  try {
    const config=(await client.query(`SELECT sc.authority_evidence,ar.*
      FROM flutterwave_live_school_configuration sc JOIN flutterwave_live_authority_reviews ar
       ON ar.id=sc.authority_review_id AND ar.environment='LIVE' AND ar.school_id=sc.school_id
       AND ar.merchant_scope=sc.merchant_scope
      WHERE sc.merchant_scope=$1 AND sc.school_id=$2 AND ar.expires_at>now()
      ORDER BY ar.id DESC LIMIT 1`,
    [release.merchantScope,input.schoolId])).rows[0];
    if(!config)throw new LiveFinalizationBlocked("LIVE_SCHOOL_CONFIGURATION_REQUIRED");
    authority=verifyLiveSplitAuthority(config.authority_evidence,{merchantScope:release.merchantScope,
      schoolId:input.schoolId,schoolSubaccountId:config.school_subaccount_id,evidenceSha256:config.evidence_sha256});
  }finally{client.release();}
  const intent=await issueLiveIntent(pool,{...input,merchantScope:release.merchantScope,
    authorityEvidence:authority},release.capability);
  client=await pool.connect();
  let reserved=false;
  try {
    // One permanent claim, not an expiring lease. Ambiguous POSTs must never be resent.
    const inserted=await client.query(`INSERT INTO flutterwave_live_checkout_attempts(intent_id,state)
      VALUES($1,'RESERVED') ON CONFLICT(intent_id) DO NOTHING RETURNING intent_id`,[intent.id]);
    reserved=inserted.rows.length===1;
    if(!reserved){
      const prior=(await client.query("SELECT state,checkout_url FROM flutterwave_live_checkout_attempts WHERE intent_id=$1",[intent.id])).rows[0];
      if(prior?.state==="READY"&&liveCheckoutUrl(prior.checkout_url))
        return {reference:intent.reference,checkoutUrl:prior.checkout_url};
      throw new LiveFinalizationBlocked("LIVE_CHECKOUT_RECONCILIATION_REQUIRED");
    }
  }finally{client.release();}
  try {
    const checkoutUrl=await new FlutterwaveLiveTransport(env,fetcher).checkout({
      reference:intent.reference,email:input.email,schoolSubaccountId:intent.school_subaccount_id});
    client=await pool.connect();
    try {
      const saved=await client.query(`UPDATE flutterwave_live_checkout_attempts SET state='READY',checkout_url=$2
        WHERE intent_id=$1 AND state='RESERVED' RETURNING intent_id`,[intent.id,checkoutUrl]);
      if(saved.rows.length!==1)throw new LiveFinalizationBlocked("LIVE_CHECKOUT_RECONCILIATION_REQUIRED");
    }finally{client.release();}
    return {reference:intent.reference,checkoutUrl};
  }catch{
    // If provider accepted or DB commit became uncertain, keep the same intent/ref.
    client=await pool.connect();
    try {await client.query(`UPDATE flutterwave_live_checkout_attempts SET state='UNKNOWN'
      WHERE intent_id=$1 AND state='RESERVED'`,[intent.id]);}
    finally{client.release();}
    throw new LiveFinalizationBlocked("LIVE_CHECKOUT_RECONCILIATION_REQUIRED");
  }
}

/** Browser redirects are untrusted. Read back collection and allocation independently.
 * Only a signed provider webhook can finalize; callback never fabricates a signature.
 * A callback after a completed webhook returns the existing immutable result. */
export async function verifyLiveCallback(pool:StudentSubscriptionSqlPool,input:{transactionId:string;reference:string},
  env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch) {
  if(!/^[1-9][0-9]{0,15}$/.test(input.transactionId)||!/^SCV3_live_[A-Za-z0-9_-]{8,80}$/.test(input.reference))
    throw new LiveFinalizationBlocked("LIVE_CALLBACK_INVALID");
  const release=await requireLiveRelease(pool,env);
  const client=await pool.connect();
  let intent:any;
  try {
    intent=(await client.query(`SELECT i.* FROM flutterwave_live_subscription_intents i
      JOIN flutterwave_live_checkout_attempts a ON a.intent_id=i.id AND a.state IN ('READY','UNKNOWN','RESERVED')
      WHERE i.environment='LIVE' AND i.merchant_scope=$1 AND i.reference=$2`,
    [release.merchantScope,input.reference])).rows[0];
  }finally{client.release();}
  if(!intent||intent.verified_transaction_id&&intent.verified_transaction_id!==input.transactionId)
    throw new LiveFinalizationBlocked("LIVE_CALLBACK_UNMATCHED");
  await liveCollectionVerifier(pool,new FlutterwaveLiveTransport(env,fetcher),release.merchantScope).verify({
    ...input,currency:"NGN",amountMinor:500000,schoolSubaccountId:intent.school_subaccount_id,signal:AbortSignal.timeout(3000)});
  // Re-read after verification: an adverse webhook may have placed a concurrent hold.
  const current=await pool.connect();
  try {
    const row=(await current.query(`SELECT i.on_hold,i.state,i.verified_transaction_id,
      EXISTS(SELECT 1 FROM flutterwave_live_subscription_activations a
        JOIN flutterwave_live_official_receipts r ON r.intent_id=a.intent_id
        WHERE a.intent_id=i.id AND a.status='ACTIVE') AS activated
      FROM flutterwave_live_subscription_intents i WHERE i.id=$1 AND i.environment='LIVE'`,[intent.id])).rows[0];
    const verified=row?.state==="COLLECTION_VERIFIED"&&!row.on_hold&&row.activated===true
      &&row.verified_transaction_id===input.transactionId;
    return {processed:verified,status:row?.on_hold?"HELD":verified?"VERIFIED":"AWAITING_AUTHENTICATED_WEBHOOK"};
  }finally{current.release();}
}
