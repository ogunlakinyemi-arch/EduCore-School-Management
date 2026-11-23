import type {CurrentPool,CurrentSource} from "./current-financial-contract";
import {currentTransaction,paidDirect,refundAmounts} from "./current-financial-store";
import {hasCurrentAdverseHold} from "./current-bro-lifecycle";

/** Platform accounting, not ordinary school fee invoices or academic access. */
export async function readCurrentPaymentAccounting(pool:CurrentPool,actorId:number,attemptId:CurrentSource) {
  return currentTransaction(pool,actorId,async c=>{
    const a=await paidDirect(c,attemptId),money=await refundAmounts(c,attemptId);
    const status=money.overRecoveryMinor>0?"RECOVERY_REQUIRED"
      :money.collectionReversedMinor===320000?"REVERSED"
      :money.collectionReversedMinor>0?"PARTIALLY_REVERSED"
      :money.refundedMinor===320000?"REFUNDED":money.refundedMinor>0?"PARTIALLY_REFUNDED":"PAID";
    return {attemptId,schoolId:Number(a.school_id),studentId:Number(a.student_id),
      termId:Number(a.academic_term_id),currency:"NGN",originalAmountMinor:320000,status,...money,
      adverseReviewRequired:await hasCurrentAdverseHold(c,attemptId),
      originalPaymentStatePreserved:a.state,schoolShareMinor:0,broShareMinor:0};
  });
}
