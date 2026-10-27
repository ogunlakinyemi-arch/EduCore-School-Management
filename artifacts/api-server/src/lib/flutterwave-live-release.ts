import { flutterwaveLiveStatus } from "./flutterwave-live-config";
import { configuredStudentSubscriptionCheckoutBaseUrl } from "./student-subscription-return-url";
import type { StudentSubscriptionSqlPool } from "./student-subscription-billing";
import { LiveFinalizationBlocked } from "./flutterwave-live-verification";

export const LIVE_RELEASE = "SCV3_V1";
// Runtime requirements, not automatic DDL or proof of a fully rehearsed upgrade.
const requiredColumns={
  flutterwave_live_webhook_receipts:["id","environment","signature_verified","payload_sha256","claims"],
  flutterwave_live_subscription_intents:["id","reference","merchant_scope","authority_review_id","on_hold","state","verified_transaction_id"],
  flutterwave_live_collection_evidence:["intent_id","transaction_id","school_minor","partner_accrual_minor"],
  flutterwave_live_finalization_events:["id","intent_id","semantic_key","kind","transaction_id"],
  flutterwave_live_receipt_results:["receipt_id","event_id"],
  flutterwave_live_partner_accruals:["intent_id","amount_minor","state"],
  flutterwave_live_authority_reviews:["id","school_id","merchant_scope","school_subaccount_id","evidence_sha256","expires_at"],
  flutterwave_live_subscription_activations:["intent_id","status"],
  flutterwave_live_official_receipts:["intent_id"],
  flutterwave_live_reconciliation_cases:["receipt_id","reason_code"],
  flutterwave_live_commission_batches:["id"],
  flutterwave_live_commission_items:["intent_id","batch_id"],
  flutterwave_live_workflow_audits:["id","batch_id"],
  flutterwave_live_operator_reviews:["id","receipt_id"],
  flutterwave_live_school_configuration:["id","school_id","merchant_scope","authority_review_id","authority_evidence"],
  flutterwave_live_checkout_attempts:["intent_id","state","checkout_url","created_at"],
  flutterwave_live_allocation_reviews:["merchant_scope","reference","transaction_id","provider_reference","school_subaccount_id",
    "currency","gross_minor","school_minor","provider_fee_minor","additional_fee_minor","source","evidence_sha256","reviewed_by"],
};
const requiredGuards={
  flutterwave_live_subscription_intents:"live_intent_history_guard",
  flutterwave_live_collection_evidence:"live_collection_history_guard",
  flutterwave_live_finalization_events:"live_event_history_guard",
  flutterwave_live_authority_reviews:"live_authority_history",
  flutterwave_live_official_receipts:"live_official_receipt_history",
  flutterwave_live_school_configuration:"live_school_config_history",
  flutterwave_live_allocation_reviews:"live_allocation_review_history",
  flutterwave_live_checkout_attempts:"live_checkout_attempt_history",
};
/** No flag is changed by this module. Defaults never acquire a DB or call a provider. */
export function liveReleaseConfiguration(env:NodeJS.ProcessEnv=process.env) {
  const status=flutterwaveLiveStatus(env);
  const base=env.PUBLIC_APP_URL
    ? configuredStudentSubscriptionCheckoutBaseUrl({environment:"production",publicAppUrl:env.PUBLIC_APP_URL}) : null;
  const blockers:string[]=[];
  if(!status.modeMatches) blockers.push("EDUCORE_FLUTTERWAVE_MODE");
  if(!status.runtimeMatches) blockers.push("PRODUCTION_RUNTIME_REQUIRED");
  if(!status.credentialValid) blockers.push("FLUTTERWAVE_LIVE_SECRET_KEY");
  if(!status.webhookConfigured || !status.webhookSeparated) blockers.push("FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH");
  if(env.EDUCORE_FLUTTERWAVE_RELEASE!==LIVE_RELEASE) blockers.push("RELEASE_APPROVAL");
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE??"")) blockers.push("MERCHANT_SCOPE");
  if(!base) blockers.push("PUBLIC_APP_URL");
  // Operator-declared dashboard registration must match the canonical production
  // raw-body LIVE route exactly. Never accept a Development/TEST callback URL.
  const webhookUrl=base?`${base}/api/webhooks/flutterwave/live/student-subscription`:null;
  if(!webhookUrl || env.FLUTTERWAVE_LIVE_WEBHOOK_URL!==webhookUrl)
    blockers.push("FLUTTERWAVE_LIVE_WEBHOOK_URL");
  return {ready:blockers.length===0,blockers,merchantScope:env.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE??"",
    callbackUrl:base?`${base}/api/flutterwave/live/callback`:null,webhookUrl};
}
export async function requireLiveRelease(pool:StudentSubscriptionSqlPool,env:NodeJS.ProcessEnv=process.env) {
  const config=liveReleaseConfiguration(env);
  if(!config.ready) throw new LiveFinalizationBlocked("LIVE_RELEASE_CONFIGURATION_BLOCKED");
  const client=await pool.connect();
  try {
    const row=(await client.query(`SELECT release_id FROM flutterwave_live_release_manifests
      WHERE release_id=$1 AND merchant_scope=$2 AND enabled AND verified_at IS NOT NULL`,
    [LIVE_RELEASE,config.merchantScope])).rows[0];
    if(!row) throw new LiveFinalizationBlocked("LIVE_TARGET_RELEASE_NOT_APPROVED");
    // Missing tables/columns must fail before any outbound provider request.
    await client.query(`SELECT c.intent_id,c.state,s.school_id,a.transaction_id
      FROM flutterwave_live_checkout_attempts c
      JOIN flutterwave_live_subscription_intents i ON i.id=c.intent_id
      JOIN flutterwave_live_school_configuration s ON s.school_id=i.school_id
      LEFT JOIN flutterwave_live_allocation_reviews a ON a.reference=i.reference WHERE false`);
    const schema=(await client.query(`SELECT
      NOT EXISTS (
        SELECT 1 FROM jsonb_each($1::jsonb) AS required(table_name,columns),
          LATERAL jsonb_array_elements_text(required.columns) AS col(name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
          WHERE attrelid=to_regclass(required.table_name) AND attname=col.name AND attnum>0 AND NOT attisdropped)
      ) AND NOT EXISTS (
        SELECT 1 FROM jsonb_each_text($2::jsonb) AS guard(table_name,trigger_name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(guard.table_name)
          AND tgname=guard.trigger_name AND NOT tgisinternal AND tgenabled IN ('O','A')
          AND tgtype&1=1 AND tgtype&2=2 AND tgtype&8=8 AND tgtype&16=16)
      ) AS ready`,[JSON.stringify(requiredColumns),JSON.stringify(requiredGuards)])).rows[0];
    if(schema?.ready!==true)throw new LiveFinalizationBlocked("LIVE_TARGET_SCHEMA_UNAVAILABLE");
    return {...config,capability:Object.freeze({enabled:true})};
  }catch(error) {
    if(error instanceof LiveFinalizationBlocked) throw error;
    throw new LiveFinalizationBlocked("LIVE_TARGET_SCHEMA_UNAVAILABLE");
  }finally{client.release();}
}
