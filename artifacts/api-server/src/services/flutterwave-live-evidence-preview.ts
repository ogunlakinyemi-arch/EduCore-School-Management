import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";
import { confirmedLiveSplitModel, confirmedLiveSplitPreview, verifyLiveSplitAuthority } from "../lib/flutterwave-live-split-authority";

export const livePreviewTables=[
  "flutterwave_live_webhook_receipts","flutterwave_live_subscription_intents",
  "flutterwave_live_collection_evidence","flutterwave_live_finalization_events",
  "flutterwave_live_receipt_results","flutterwave_live_partner_accruals",
  "flutterwave_live_authority_reviews","flutterwave_live_subscription_activations",
  "flutterwave_live_official_receipts","flutterwave_live_reconciliation_cases",
  "flutterwave_live_commission_batches","flutterwave_live_commission_items",
  "flutterwave_live_workflow_audits","flutterwave_live_operator_reviews",
] as const;

/** Read-only preview, not approval/import/persistence or an activation decision.
 * Never inspects credentials, contacts providers, or accepts client release flags.
 */
export async function previewLiveEvidence(pool:StudentSubscriptionSqlPool,input:{
  merchantScope:string;schoolId:number;reviewId:number;authorityEvidence:unknown;
}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='3s'");
    const columns=(await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=ANY($1::text[])`,[livePreviewTables])).rows;
    const present=new Set(columns.map(row=>row.table_name));
    const missingTables=livePreviewTables.filter(name=>!present.has(name));
    const required=["id","environment","merchant_scope","school_id","school_subaccount_id","evidence_sha256","expires_at","reviewed_by"];
    const reviewColumns=new Set(columns.filter(row=>row.table_name==="flutterwave_live_authority_reviews").map(row=>row.column_name));
    const reviewReadable=required.every(name=>reviewColumns.has(name));
    let evidenceStatus="AUTHORITY_SCHEMA_UNAVAILABLE",allocationPreview=null,reviewHash:string|null=null;
    if(reviewReadable){
      const review=(await client.query(`SELECT school_subaccount_id,evidence_sha256,
        (expires_at>now() AND reviewed_by>0) AS current FROM flutterwave_live_authority_reviews
        WHERE id=$1 AND environment='LIVE' AND merchant_scope=$2 AND school_id=$3`,
        [input.reviewId,input.merchantScope,input.schoolId])).rows[0];
      evidenceStatus=review?"AUTHORITY_REVIEW_EXPIRED":"AUTHORITY_REVIEW_NOT_FOUND";
      if(review?.current){
        reviewHash=review.evidence_sha256;
        try{
          const evidence=verifyLiveSplitAuthority(input.authorityEvidence,{
            merchantScope:input.merchantScope,schoolId:input.schoolId,
            schoolSubaccountId:review.school_subaccount_id,evidenceSha256:review.evidence_sha256,
          });
          allocationPreview=confirmedLiveSplitPreview(evidence);
          evidenceStatus="MATCHES_EXISTING_REVIEW";
        }catch(error){
          if(!(error instanceof LiveFinalizationBlocked))throw error;
          evidenceStatus=error.code;
        }
      }
    }
    await client.query("COMMIT");
    const evidenceValid=evidenceStatus==="MATCHES_EXISTING_REVIEW";
    return {
      previewOnly:true as const,approved:false as const,persisted:false as const,activationReady:false as const,
      evidenceValid,evidenceStatus,reviewHash,allocationPreview,policy:confirmedLiveSplitModel,
      checks:[
        {key:"MERCHANT_FEE_BEARER",status:evidenceValid?"BOUND_TO_REVIEW":"UNVERIFIED",detail:"Merchant dashboard evidence must match the immutable reviewed document; this is not a dashboard inspection."},
        {key:"LIVE_SCHOOL_OWNERSHIP_ASSOCIATION",status:evidenceValid?"BOUND_TO_REVIEW":"UNVERIFIED",detail:"Exact LIVE merchant/school/subaccount tuple and ownership evidence; an RS_ prefix alone proves neither environment nor ownership."},
        {key:"TARGET_SCHEMA",status:missingTables.length||!reviewReadable?"INCOMPLETE":"TABLES_OBSERVED_ONLY",detail:"Read-only table/authority-column observation is not complete DDL, constraint, index or migration-ledger acceptance."},
        {key:"MIGRATION_APPROVAL",status:"UNVERIFIED",detail:"Independently verify target/schema/ledger and approve inbox → finalization → workflow → readiness drafts before any application DDL."},
        {key:"WEBHOOK_ENVIRONMENT_AUTHENTICATION",status:"UNVERIFIED",detail:"No secrets inspected. Operator must confirm LIVE verifier binding, authentication/version, public HTTPS routes, TEST separation and adverse-event configuration."},
        {key:"CHECKOUT_VERIFICATION_WORKFLOW",status:"HARD_DISABLED",detail:"No LIVE checkout, outbound verification or enabled workflow capability is supplied by this preview."},
        {key:"DURABLE_WEBHOOK_RELEASE",status:"NOT_RELEASED",detail:"Actual ingress remains HTTP 503 / processed:false; isolated lifecycle acceptance does not authorize delivery or financial acknowledgement."},
        {key:"EXPLICIT_RELEASE_AUTHORIZATION",status:"NOT_GRANTED",detail:"Separate real-money release and controlled transaction/settlement acceptance approval remain required."},
      ],
      missingTables,
    };
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
