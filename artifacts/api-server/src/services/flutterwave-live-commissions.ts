import { createHash } from "node:crypto";
import type { StudentSubscriptionSqlClient,StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow,requireLiveWorkflow,type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

async function owner(client: StudentSubscriptionSqlClient,actorId: number) {
  const result=await client.query(`SELECT au.id FROM app_users au JOIN school_memberships sm ON sm.user_id=au.id
    WHERE au.id=$1 AND au.status='ACTIVE' AND sm.role='PLATFORM_OWNER' AND sm.status='ACTIVE'
    FOR SHARE OF au,sm`,[actorId]);
  if(!result.rows.length) throw new LiveFinalizationBlocked("LIVE_OWNER_APPROVAL_REQUIRED");
}
async function evidence(client: StudentSubscriptionSqlClient,ids: number[],merchantScope: string) {
  // Same lock order as collection/hold: original intent, then accrual, then batch.
  await client.query(`SELECT id FROM flutterwave_live_subscription_intents WHERE environment='LIVE'
    AND merchant_scope=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR UPDATE`,[merchantScope,ids]);
  return (await client.query(`SELECT i.*,a.amount_minor,a.state AS accrual_state
    FROM flutterwave_live_subscription_intents i
    JOIN flutterwave_live_collection_evidence c ON c.intent_id=i.id AND c.environment='LIVE'
    JOIN flutterwave_live_partner_accruals a ON a.intent_id=i.id AND a.environment='LIVE'
    JOIN flutterwave_live_subscription_activations act ON act.intent_id=i.id AND act.environment='LIVE' AND act.status='ACTIVE'
    JOIN flutterwave_live_official_receipts receipt ON receipt.intent_id=i.id AND receipt.environment='LIVE'
    JOIN academic_terms t ON t.id=i.term_id AND t.school_id=i.school_id AND t.academic_session_id=i.session_id
    WHERE i.environment='LIVE' AND i.merchant_scope=$1 AND i.id=ANY($2::bigint[])
      AND NOT i.on_hold AND i.state='COLLECTION_VERIFIED' AND a.state='ACCRUED'
      AND i.authority_snapshot IS NOT NULL AND i.issued_by IS NOT NULL AND a.amount_minor=10000
      AND t.end_date=i.term_end_date AND t.end_date<CURRENT_DATE
    ORDER BY i.id FOR UPDATE OF a`,[merchantScope,ids])).rows;
}
export async function approveLiveCommissionBatch(pool: StudentSubscriptionSqlPool,input: {
  actorId: number;merchantScope: string;intentIds: number[];idempotencyKey: string;
},capability: LiveWorkflowCapability=blockedLiveWorkflow) {
  requireLiveWorkflow(capability);
  if(!Number.isSafeInteger(input.actorId)||input.actorId<=0||!Array.isArray(input.intentIds)
    ||!input.intentIds.length||input.intentIds.length>5000||new Set(input.intentIds).size!==input.intentIds.length
    ||input.intentIds.some(id=>!Number.isSafeInteger(id)||id<=0)
    ||!/^[A-Za-z0-9_-]{8,80}$/.test(input.merchantScope)||!/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey))
    throw new LiveFinalizationBlocked("LIVE_APPROVAL_INPUT_INVALID");
  const ids=[...input.intentIds].sort((a,b)=>a-b),hash=createHash("sha256").update(JSON.stringify(ids)).digest("hex");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='3s'");
    await owner(client,input.actorId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`live-commission:${input.merchantScope}`]);
    const prior=(await client.query(`SELECT * FROM flutterwave_live_commission_batches
      WHERE environment='LIVE' AND merchant_scope=$1 AND idempotency_key=$2`,[input.merchantScope,input.idempotencyKey])).rows[0];
    if(prior){
      if(prior.request_hash!==hash) throw new LiveFinalizationBlocked("LIVE_APPROVAL_KEY_CONFLICT");
      await client.query("COMMIT");return prior;
    }
    const entries=await evidence(client,ids,input.merchantScope);
    if(entries.length!==ids.length) throw new LiveFinalizationBlocked("LIVE_COMMISSION_NOT_ELIGIBLE");
    const snapshot={environment:"LIVE",executionMode:"EXPORT_ONLY",currency:"NGN",amountMinor:entries.length*10000,
      items:entries.map(e=>({intentId:Number(e.id),partnerId:e.partner_profile_id,amountMinor:10000,
        schoolId:e.school_id,studentId:e.student_id,sessionId:e.session_id,termId:e.term_id,reference:e.reference}))};
    const batch=(await client.query(`INSERT INTO flutterwave_live_commission_batches
      (merchant_scope,idempotency_key,request_hash,approved_by,snapshot) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
      [input.merchantScope,input.idempotencyKey,hash,input.actorId,JSON.stringify(snapshot)])).rows[0];
    for(const id of ids) await client.query(`INSERT INTO flutterwave_live_commission_items(batch_id,intent_id) VALUES($1,$2)`,[batch.id,id]);
    await client.query(`INSERT INTO flutterwave_live_workflow_audits(actor_id,action,batch_id) VALUES($1,'APPROVE_EXPORT_ONLY',$2)`,[input.actorId,batch.id]);
    await client.query("COMMIT");return batch;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
export async function exportLiveCommissionBatch(pool: StudentSubscriptionSqlPool,input: {
  actorId: number;merchantScope: string;batchId: number;
},capability: LiveWorkflowCapability=blockedLiveWorkflow) {
  requireLiveWorkflow(capability);
  if(!Number.isSafeInteger(input.actorId)||input.actorId<=0||!Number.isSafeInteger(input.batchId)||input.batchId<=0
    ||!/^[A-Za-z0-9_-]{8,80}$/.test(input.merchantScope)) throw new LiveFinalizationBlocked("LIVE_EXPORT_INPUT_INVALID");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='3s'");
    await owner(client,input.actorId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`live-commission:${input.merchantScope}`]);
    const ids=(await client.query(`SELECT bi.intent_id FROM flutterwave_live_commission_items bi
      JOIN flutterwave_live_commission_batches b ON b.id=bi.batch_id
      WHERE b.id=$1 AND b.environment='LIVE' AND b.merchant_scope=$2 ORDER BY bi.intent_id`,
      [input.batchId,input.merchantScope])).rows.map(r=>Number(r.intent_id));
    const valid=ids.length ? await evidence(client,ids,input.merchantScope) : [];
    const batch=(await client.query(`SELECT * FROM flutterwave_live_commission_batches
      WHERE id=$1 AND environment='LIVE' AND merchant_scope=$2 FOR UPDATE`,[input.batchId,input.merchantScope])).rows[0];
    if(!batch||batch.status!=="APPROVED"||!ids.length||valid.length!==ids.length)
      throw new LiveFinalizationBlocked("LIVE_EXPORT_REVIEW_REQUIRED");
    await client.query(`INSERT INTO flutterwave_live_workflow_audits(actor_id,action,batch_id) VALUES($1,'EXPORT_ONLY',$2)`,[input.actorId,batch.id]);
    await client.query("COMMIT");return batch.snapshot;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
