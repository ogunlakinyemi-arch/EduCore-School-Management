import type { StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

/** Additional application check; never a replacement for relational constraints
 * or immutable-snapshot enforcement. Amounts are integer kobo, not naira. */
export function assertLiveIntentAllocation(intent: {
  environment: unknown;
  currency: unknown;
  gross_minor: unknown;
  school_minor: unknown;
  merchant_gross_minor: unknown;
  partner_profile_id: unknown;
  partner_accrual_minor: unknown;
}): void {
  const eligible = typeof intent.partner_profile_id === "number"
    && Number.isSafeInteger(intent.partner_profile_id) && intent.partner_profile_id > 0;
  if (intent.environment !== "LIVE" || intent.currency !== "NGN"
    || intent.gross_minor !== 500000 || intent.school_minor !== 190000
    || intent.merchant_gross_minor !== 310000
    || (intent.partner_profile_id !== null && !eligible)
    || intent.partner_accrual_minor !== (eligible ? 10000 : 0)) {
    throw new LiveFinalizationBlocked("LIVE_INTENT_ALLOCATION_INVALID");
  }
}

/** Internal finalization step. Caller owns BEGIN, the original intent FOR UPDATE
 * lock, the preceding accrual HELD update, and COMMIT/ROLLBACK on THIS client.
 * Do not expose this as a standalone mutation or use it to remove the trigger.
 * A failure must propagate so finalization cannot acknowledge a partial hold.
 */
export async function invalidateHeldLiveCommissionBatches(
  client: StudentSubscriptionSqlClient,
  intent: { id: unknown; merchant_scope: string },
): Promise<void> {
  await client.query(
    `UPDATE flutterwave_live_commission_batches b SET status='REVIEW_REQUIRED'
       WHERE b.environment='LIVE' AND b.merchant_scope=$2
         AND EXISTS (
           SELECT 1 FROM flutterwave_live_commission_items bi
           JOIN flutterwave_live_partner_accruals a ON a.intent_id=bi.intent_id
           WHERE bi.batch_id=b.id AND bi.intent_id=$1
             AND a.environment='LIVE' AND a.state='HELD'
         )`,
    [intent.id, intent.merchant_scope],
  );
}
