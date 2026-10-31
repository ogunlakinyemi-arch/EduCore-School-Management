import { accrueBroCommissionInTransaction, BroCommissionBlocked, type BroSql } from "./bro-commission-policy";
import { appendFinancialHistory } from "./financial-history-writes";

/**
 * Runs inside verification's transaction, after the independently verified PAID
 * transition and event. Never executes a transfer, modifies a collection, or
 * credits a pending/failed payment. Duplicate verification also takes this path.
 */
export async function accrueVerifiedSubscriptionBro(c: BroSql, attemptId: number) {
  await c.query("SAVEPOINT verified_subscription_bro");
  try {
    // Source identity comes only from the frozen, Owner-approved release review;
    // a webhook or School Admin must not supply an Owner identity.
    const source = (await c.query(`SELECT o.school_id AS "schoolId",o.student_id AS "studentId",
        o.academic_term_id AS "termId",u.id,u.email,u.clerk_user_id AS "clerkUserId"
      FROM student_direct_live_attempts a
      JOIN student_direct_live_obligations o ON o.id=a.obligation_id
      JOIN student_direct_live_reviews r ON r.id=o.review_id
      JOIN app_users u ON u.id=r.approved_by
      WHERE a.id=$1 AND a.state='PAID' AND a.verified_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM student_direct_live_events ev WHERE ev.attempt_id=a.id
          AND ev.kind='PROVIDER_PAYMENT_VERIFIED' AND ev.details->>'transactionId'=a.provider_transaction_id)`,
      [attemptId])).rows[0];
    if (!source) throw new BroCommissionBlocked("Verified source and immutable approved release are required");
    const result = await accrueBroCommissionInTransaction(c, {
      schoolId: Number(source.schoolId), studentId: Number(source.studentId), termId: Number(source.termId),
    }, { id: Number(source.id), email: source.email, clerkUserId: source.clerkUserId }, true);
    await c.query("RELEASE SAVEPOINT verified_subscription_bro");
    return result;
  } catch (error) {
    await c.query("ROLLBACK TO SAVEPOINT verified_subscription_bro");
    await c.query("RELEASE SAVEPOINT verified_subscription_bro");
    // An ineligible term is not a failed payment. A storage/guard problem is also
    // recorded durably for review and retried on duplicate verification; never
    // undo independently verified collection or invent a zero entitlement.
    await appendFinancialHistory(c, "event", [attemptId, "BRO_COMMISSION_ACCRUAL_REVIEW", null, JSON.stringify({
      reason: error instanceof BroCommissionBlocked ? "ELIGIBILITY_OR_READINESS_BLOCKED" : "ACCRUAL_RETRY_REQUIRED",
    })]);
    return null;
  }
}
