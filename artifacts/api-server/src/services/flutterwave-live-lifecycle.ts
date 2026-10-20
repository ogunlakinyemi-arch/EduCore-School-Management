import { createHash } from "node:crypto";
import type { StudentSubscriptionSqlClient, StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow, requireLiveWorkflow, type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { blockedLiveCollectionVerifier, LiveFinalizationBlocked, type LiveCollectionVerifier } from "../lib/flutterwave-live-verification";
import { finalizeLiveSubscriptionDesign } from "./flutterwave-live-finalization-design";

async function collection(client: StudentSubscriptionSqlClient,intent: any) {
  if(!intent.issued_by || !intent.issuer_key || !intent.authority_snapshot)
    throw new LiveFinalizationBlocked("LIVE_AUTHORITATIVE_INTENT_REQUIRED");
  const prior=(await client.query(`SELECT a.intent_id FROM flutterwave_live_subscription_activations a
    JOIN flutterwave_live_official_receipts r ON r.intent_id=a.intent_id AND r.environment='LIVE'
    WHERE a.intent_id=$1 AND a.environment='LIVE'`,[intent.id])).rows[0];
  if(prior) return; // Replay the completed immutable issuance, not a new activation.
  // Legacy hand-seeded design snapshots are NOT authoritative operational intents.
  const review=(await client.query(`SELECT id FROM flutterwave_live_authority_reviews WHERE id=$1
    AND environment='LIVE' AND merchant_scope=$2 AND school_id=$3 AND school_subaccount_id=$4 AND expires_at>now() FOR SHARE`,
    [intent.authority_review_id,intent.merchant_scope,intent.school_id,intent.school_subaccount_id])).rows[0];
  if(!review)
    throw new LiveFinalizationBlocked("LIVE_AUTHORITATIVE_INTENT_REQUIRED");
  await client.query(`INSERT INTO flutterwave_live_subscription_activations(intent_id,environment,status,expires_at)
    SELECT id,'LIVE','ACTIVE',(term_end_date+1)::timestamp AT TIME ZONE 'Africa/Lagos'
    FROM flutterwave_live_subscription_intents WHERE id=$1 AND environment='LIVE' AND NOT on_hold
    ON CONFLICT(intent_id) DO NOTHING`,[intent.id]);
  const names=intent.authority_snapshot;
  // Payer-visible receipt deliberately excludes the Owner-only allocation detail.
  const snapshot={environment:"LIVE",receiptNumber:`LIVE-STUDENT-${intent.reference}`,
    reference:intent.reference,grossAmountMinor:500000,currency:"NGN",
    schoolName:names.schoolName,studentName:names.studentName,sessionName:names.sessionName,termName:names.termName};
  if(["schoolName","studentName","sessionName","termName"].some(key=>typeof names[key]!=="string"||!names[key].length))
    throw new LiveFinalizationBlocked("LIVE_RECEIPT_SNAPSHOT_INCOMPLETE");
  await client.query(`INSERT INTO flutterwave_live_official_receipts(intent_id,environment,receipt_number,snapshot)
    SELECT $1,'LIVE',$2,$3::jsonb||jsonb_build_object('paidAt',NULL,'verifiedAt',verified_at) FROM flutterwave_live_collection_evidence
    WHERE intent_id=$1 AND environment='LIVE' ON CONFLICT(intent_id) DO NOTHING`,
    [intent.id,snapshot.receiptNumber,JSON.stringify(snapshot)]);
}
async function hold(client: StudentSubscriptionSqlClient,intent: any,receiptId: number) {
  await client.query("UPDATE flutterwave_live_subscription_activations SET status='HELD' WHERE intent_id=$1 AND environment='LIVE'",[intent.id]);
  await client.query(`INSERT INTO flutterwave_live_reconciliation_cases(receipt_id,environment,reason_code)
    VALUES($1,'LIVE','SIGNED_ADVERSE_EVENT') ON CONFLICT(receipt_id) DO NOTHING`,[receiptId]);
}

/** Coordinated kernel: default capability AND verifier both refuse. No runtime
 * caller receives an enabled capability; only disposable-fixture E2E tests do.
 * Existing shared/SANDBOX access enforcement/readers are intentionally untouched.
 */
export async function processLiveWorkflow(pool: StudentSubscriptionSqlPool,receiptId: number,rawBody: Buffer,
  verifier: LiveCollectionVerifier=blockedLiveCollectionVerifier,
  capability: LiveWorkflowCapability=blockedLiveWorkflow) {
  requireLiveWorkflow(capability);
  try {
    return await finalizeLiveSubscriptionDesign(pool,receiptId,rawBody,verifier,{collection,hold});
  }catch(error){
    // Only authenticated original bytes may get a reconciliation case. No intent
    // is guessed, financial state is never rewritten, and no error is acknowledged.
    if(Buffer.isBuffer(rawBody) && Number.isSafeInteger(receiptId) && receiptId>0
      && !(error instanceof LiveFinalizationBlocked && error.code==="LIVE_VERIFICATION_TRANSPORT_DISABLED")){
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout='3s'");
        await client.query(`INSERT INTO flutterwave_live_reconciliation_cases(receipt_id,environment,reason_code)
          SELECT id,'LIVE','VERIFICATION_OR_FINALIZATION_UNRESOLVED' FROM flutterwave_live_webhook_receipts
          WHERE id=$1 AND environment='LIVE' AND signature_verified=true AND payload_sha256=$2
          ON CONFLICT(receipt_id) DO NOTHING`,[receiptId,createHash("sha256").update(rawBody).digest("hex")]);
        await client.query("COMMIT");
      }catch{
        await client.query("ROLLBACK").catch(()=>undefined);
        throw new LiveFinalizationBlocked("LIVE_RECONCILIATION_PERSISTENCE_UNAVAILABLE");
      }
      finally{client.release();}
    }
    throw error;
  }
}

/** Internal access adapter: caller must already authorize this original-school
 * scope. Explicit LIVE selection only; no fallback to shared/SANDBOX subscriptions.
 */
export async function hasLiveTermEntitlement(pool: StudentSubscriptionSqlPool,scope: {
  merchantScope:string;schoolId:number;studentId:number;termId:number;
},capability:LiveWorkflowCapability=blockedLiveWorkflow){
  requireLiveWorkflow(capability);
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(scope.merchantScope)
    ||![scope.schoolId,scope.studentId,scope.termId].every(id=>Number.isSafeInteger(id)&&id>0))
    throw new LiveFinalizationBlocked("LIVE_ENTITLEMENT_SCOPE_INVALID");
  const client=await pool.connect();
  try{
    return Boolean((await client.query(`SELECT a.intent_id FROM flutterwave_live_subscription_activations a
      JOIN flutterwave_live_subscription_intents i ON i.id=a.intent_id AND i.environment='LIVE'
      WHERE a.environment='LIVE' AND a.status='ACTIVE' AND a.expires_at>now() AND NOT i.on_hold
       AND i.merchant_scope=$1 AND i.school_id=$2 AND i.student_id=$3 AND i.term_id=$4`,
      [scope.merchantScope,scope.schoolId,scope.studentId,scope.termId])).rows[0]);
  }finally{client.release();}
}
