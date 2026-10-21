import type { CommunicationQueryClient } from "./communication-service";
import { requireLiveWorkflow, type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

export type LiveApplicationContext = { merchantScope: string; capability: LiveWorkflowCapability };
// Not configurable through env, HTTP, school settings or dashboard controls.
export function releasedLiveApplicationContext(): LiveApplicationContext | undefined { return undefined; }
export function assertLiveApplicationContext(context: LiveApplicationContext) {
  requireLiveWorkflow(context.capability);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(context.merchantScope)) throw new LiveFinalizationBlocked("LIVE_APPLICATION_SCOPE_INVALID");
}

/** Fixed internal alias i. A receipt fingerprint or collection alone is not
 * entitlement. Require the coordinated immutable issuance AND result binding. */
export const liveVerifiedIssuance = `i.environment='LIVE' AND i.state='COLLECTION_VERIFIED' AND NOT i.on_hold
 AND i.issued_by IS NOT NULL AND i.authority_snapshot IS NOT NULL
 AND (SELECT count(*) FROM flutterwave_live_subscription_intents duplicate
   WHERE duplicate.environment='LIVE' AND duplicate.merchant_scope=i.merchant_scope
    AND duplicate.school_id=i.school_id AND duplicate.student_id=i.student_id AND duplicate.term_id=i.term_id)=1
 AND EXISTS(SELECT 1 FROM academic_terms canonical_term WHERE canonical_term.id=i.term_id
   AND canonical_term.school_id=i.school_id AND canonical_term.academic_session_id=i.session_id)
 AND EXISTS(SELECT 1 FROM flutterwave_live_authority_reviews authority WHERE authority.id=i.authority_review_id
   AND authority.environment='LIVE' AND authority.merchant_scope=i.merchant_scope
   AND authority.school_id=i.school_id AND authority.school_subaccount_id=i.school_subaccount_id)
 AND EXISTS(SELECT 1 FROM flutterwave_live_collection_evidence c
   WHERE c.intent_id=i.id AND c.environment='LIVE' AND c.transaction_id=i.verified_transaction_id
    AND c.provider_reference=i.verified_provider_reference AND c.gross_minor=500000
    AND c.school_minor=190000 AND c.merchant_gross_minor=310000 AND c.currency='NGN')
 AND EXISTS(SELECT 1 FROM flutterwave_live_official_receipts r WHERE r.intent_id=i.id AND r.environment='LIVE'
   AND r.snapshot->>'environment'='LIVE' AND r.snapshot->>'reference'=i.reference
   AND r.snapshot->>'receiptNumber'=r.receipt_number AND r.receipt_number='LIVE-STUDENT-'||i.reference
   AND r.snapshot->>'grossAmountMinor'='500000' AND r.snapshot->>'currency'='NGN'
   AND r.snapshot->>'schoolName'=i.authority_snapshot->>'schoolName'
   AND r.snapshot->>'studentName'=i.authority_snapshot->>'studentName'
   AND r.snapshot->>'sessionName'=i.authority_snapshot->>'sessionName'
   AND r.snapshot->>'termName'=i.authority_snapshot->>'termName')
 AND EXISTS(SELECT 1 FROM flutterwave_live_subscription_activations a
   WHERE a.intent_id=i.id AND a.environment='LIVE' AND a.status='ACTIVE' AND a.expires_at>now())
 AND EXISTS(SELECT 1 FROM flutterwave_live_finalization_events e
   JOIN flutterwave_live_receipt_results rr ON rr.event_id=e.id AND rr.environment='LIVE'
   JOIN flutterwave_live_webhook_receipts wr ON wr.id=rr.receipt_id AND wr.environment='LIVE' AND wr.signature_verified=true
   WHERE e.intent_id=i.id AND e.environment='LIVE' AND e.kind='COLLECTION'
     AND e.transaction_id=i.verified_transaction_id)`;

export async function readLiveSchoolSubscriptionStudents(db: CommunicationQueryClient,
  schoolId: number,termId: number,context: LiveApplicationContext) {
  assertLiveApplicationContext(context);
  if (![schoolId,termId].every(id=>Number.isSafeInteger(id)&&id>0)) throw new LiveFinalizationBlocked("LIVE_APPLICATION_SCOPE_INVALID");
  return db.query<{studentId:number;paid:boolean;waived:boolean;pending:boolean;unknown:boolean;amountMinor:number}>(
    `SELECT st.id AS "studentId",
      EXISTS(SELECT 1 FROM flutterwave_live_subscription_intents i WHERE i.merchant_scope=$1
       AND i.school_id=st.school_id AND i.student_id=st.id AND i.term_id=$3 AND ${liveVerifiedIssuance}) AS paid,
      false AS waived,
      EXISTS(SELECT 1 FROM flutterwave_live_subscription_intents i WHERE i.environment='LIVE' AND i.merchant_scope=$1
       AND i.school_id=st.school_id AND i.student_id=st.id AND i.term_id=$3 AND i.state='PENDING') AS pending,
      EXISTS(SELECT 1 FROM flutterwave_live_subscription_intents i WHERE i.environment='LIVE' AND i.merchant_scope=$1
       AND i.school_id=st.school_id AND i.student_id=st.id AND i.term_id=$3 AND
         (i.on_hold OR (i.state='COLLECTION_VERIFIED' AND NOT (${liveVerifiedIssuance})))) AS unknown,
      500000 AS "amountMinor"
     FROM students st WHERE st.school_id=$2 AND lower(st.status)='active' ORDER BY st.id`,
    [context.merchantScope,schoolId,termId]);
}

/** Internal receipt consumer; routes must authorize the exact original-school
 * identity first. No shared subscription/payment ID translation or fallback. */
export async function readLiveApplicationReceipt(db: CommunicationQueryClient,
  scope:{intentId:number;schoolId:number;studentId:number;termId:number},context:LiveApplicationContext) {
  assertLiveApplicationContext(context);
  if(!Object.values(scope).every(id=>Number.isSafeInteger(id)&&id>0))throw new LiveFinalizationBlocked("LIVE_APPLICATION_SCOPE_INVALID");
  const row=(await db.query(`SELECT r.snapshot,i.on_hold AS held,(${liveVerifiedIssuance}) AS entitled
    FROM flutterwave_live_subscription_intents i
    JOIN flutterwave_live_collection_evidence c ON c.intent_id=i.id AND c.environment='LIVE'
    JOIN flutterwave_live_official_receipts r ON r.intent_id=i.id AND r.environment='LIVE'
    WHERE i.environment='LIVE' AND i.merchant_scope=$1 AND i.id=$2 AND i.school_id=$3 AND i.student_id=$4 AND i.term_id=$5`,
    [context.merchantScope,scope.intentId,scope.schoolId,scope.studentId,scope.termId])).rows[0];
  if(!row)throw new LiveFinalizationBlocked("LIVE_OFFICIAL_RECEIPT_UNAVAILABLE");
  const receipt=row.snapshot as Record<string,unknown>;
  // Whitelist payer-safe fields even if a future stored template adds allocations.
  return {environment:"LIVE",recorded:true,held:row.held,activated:row.entitled,operationallyProcessed:false,
    receipt:Object.fromEntries(["environment","receiptNumber","reference","grossAmountMinor","currency","schoolName",
      "studentName","sessionName","termName","paidAt","verifiedAt"].map(key=>[key,receipt[key]??null]))};
}
