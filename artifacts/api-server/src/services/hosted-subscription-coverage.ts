import type { CommunicationQueryClient } from "./communication-service";
import type { SubscriptionStudent } from "./subscription-enforcement-policy";
/** Never let a TEST journal row or legacy TEST active flag unlock LIVE access. */
export function hostedLiveSelected(env: NodeJS.ProcessEnv = process.env) {
  return env.EDUCORE_HOSTED_PAYMENTS_ENABLED === "true" && env.EDUCORE_HOSTED_PAYMENTS_MODE === "LIVE";
}
export async function readHostedSubscriptionCoverage(db: CommunicationQueryClient, schoolId: number, termId: number) {
  return db.query<SubscriptionStudent & { amountMinor: number }>(`SELECT st.id AS "studentId",
    EXISTS(SELECT 1 FROM hosted_checkout_orders o JOIN hosted_checkout_events e
      ON e.order_reference=o.reference AND e.environment=o.environment AND e.kind='PAYMENT_VERIFIED'
      WHERE o.school_id=st.school_id AND o.student_id=st.id AND o.term_id=$2 AND o.environment='LIVE'
        AND NOT EXISTS(SELECT 1 FROM hosted_checkout_events h WHERE h.order_reference=o.reference AND h.kind='RECONCILIATION_HOLD')) AS paid,
    false AS waived,
    EXISTS(SELECT 1 FROM hosted_checkout_orders o WHERE o.school_id=st.school_id AND o.student_id=st.id
      AND o.term_id=$2 AND o.environment='LIVE'
      AND NOT EXISTS(SELECT 1 FROM hosted_checkout_events e WHERE e.order_reference=o.reference AND e.kind='PAYMENT_VERIFIED')) AS pending,
    EXISTS(SELECT 1 FROM hosted_checkout_orders o JOIN hosted_checkout_events e ON e.order_reference=o.reference
      WHERE o.school_id=st.school_id AND o.student_id=st.id AND o.term_id=$2 AND o.environment='LIVE'
        AND e.kind='RECONCILIATION_HOLD') AS unknown,
    500000 AS "amountMinor"
    FROM students st WHERE st.school_id=$1 AND lower(st.status)='active' ORDER BY st.id`, [schoolId, termId]);
}
