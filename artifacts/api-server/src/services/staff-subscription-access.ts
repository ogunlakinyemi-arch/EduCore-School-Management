import type { StaffNfcSqlExecutor } from "../routes/staff-nfc-billing-service";
import {readStaffCollection} from "./staff-free-rollout";
import {assertManualSchoolUnlocked} from "./school-subscription-lock";

export const STAFF_SUBSCRIPTION_PRICE_MINOR = 200_000;
export const STAFF_DIRECT_RULE = {
  priceMinor: STAFF_SUBSCRIPTION_PRICE_MINOR,
  schoolShareMinor: 0,
  platformShareMinor: STAFF_SUBSCRIPTION_PRICE_MINOR,
  partnerCommissionMinor: 0,
  noPartnerPlatformShareMinor: STAFF_SUBSCRIPTION_PRICE_MINOR,
} as const;

export function isDirectStaffRule(rule: Record<keyof typeof STAFF_DIRECT_RULE, number>) {
  return Object.entries(STAFF_DIRECT_RULE).every(([key, value]) =>
    rule[key as keyof typeof STAFF_DIRECT_RULE] === value);
}

type Actor = {
  user: { id: number };
  roles: Array<{ role: string; schoolId: number | null; status: string }>;
};

/** Subscription is an additional restriction, never a grant of authorization. */
export function staffSubscriptionSchools(actor: Actor) {
  const active = actor.roles.filter(r => r.status === "ACTIVE");
  if (active.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null)) return [];
  return [...new Set(active.filter(r => ["TEACHER", "STAFF"].includes(r.role) && r.schoolId !== null)
    .filter(r => !active.some(other => other.schoolId === r.schoolId &&
      ["SCHOOL_ADMIN", "ACCOUNTANT"].includes(other.role)))
    .map(r => r.schoolId!))];
}

/**
 * Deliberately bounded operational policy. Account, payment, finance receipts,
 * family portals, inbox/support and historical reads are not gated. Hardware
 * authentication remains its separate device policy.
 */
export function isStaffSubscriptionOperation(path: string, method: string) {
  const p = path.split("?")[0].replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "");
  if (/^\/(?:parent|parents|student|me|staff-nfc|auth|account|help|support|notifications)(?:\/|$)/.test(p)) return false;
  if (/^\/academic\/(?:parents|students\/me)(?:\/|$)/.test(p)) return false;
  const read = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (read) return false; // Operational writes, not necessary/historical read-only access.
  return /^\/(?:academic|curriculum|library|operations|transport)(?:\/|$)/.test(p)
    || /^\/school\/attendance(?:\/|$)/.test(p)
    || /^\/schools\/\d+\/(?:lesson-notes|curriculum)(?:\/|$)/.test(p)
    || /^\/(?:assignments|assessments|lesson-notes|exam-record|exam-records|timetable)(?:\/|$)/.test(p);
}

export type StaffSubscriptionAccess = {
  schoolId: number;
  restricted: boolean;
  status: "PAID" | "UNPAID" | "PENDING" | "FAILED" | "EXPIRED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "NOT_APPLICABLE" | "NOT_REQUIRED";
  termId: number | null;
  subscriptionId: number | null;
  priceMinor: number;
  renewalPath: string;
};

/** Fresh database decision on each request; no cached PAID flag or callback trust. */
export async function readStaffSubscriptionAccess(
  db: StaffNfcSqlExecutor, userId: number, schoolId: number,
): Promise<StaffSubscriptionAccess> {
  const result = await db.query<{
    employeeId: number; termId: number | null; subscriptionId: number | null;
    status: string | null; verified: boolean;
  }>(`SELECT e.id AS "employeeId", t.id AS "termId", sub.id AS "subscriptionId", sub.status,
    EXISTS(SELECT 1 FROM staff_nfc_payments p
      WHERE p.subscription_id=sub.id AND p.employee_id=e.id AND p.school_id=e.school_id
        AND p.academic_session_id=t.academic_session_id AND p.academic_term_id=t.id
        AND p.status='PAID' AND p.provider='FLUTTERWAVE'
        AND (p.provider_mode='LIVE' OR (p.provider_mode='SANDBOX' AND $3<>'production'))
        AND p.provider_transaction_id IS NOT NULL AND p.paid_at IS NOT NULL
        AND p.currency='NGN' AND p.gross_amount_minor=sub.price_minor) AS verified
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT term.id,term.academic_session_id FROM academic_terms term
      JOIN academic_sessions ses ON ses.id=term.academic_session_id AND ses.school_id=term.school_id
      WHERE term.school_id=e.school_id AND term.is_current=true AND UPPER(term.status)='ACTIVE'
        AND ses.is_current=true AND UPPER(ses.status)='ACTIVE'
        AND term.start_date<=CURRENT_DATE AND term.end_date>=CURRENT_DATE
      ORDER BY term.start_date DESC,term.id DESC LIMIT 1
    ) t ON true
    LEFT JOIN staff_nfc_subscriptions sub ON sub.employee_id=e.id AND sub.school_id=e.school_id
      AND sub.academic_session_id=t.academic_session_id AND sub.academic_term_id=t.id
    WHERE e.user_id=$1 AND e.school_id=$2 AND UPPER(e.employment_status)='ACTIVE'
      AND UPPER(e.employee_type) IN ('TEACHER','STAFF') ORDER BY e.id LIMIT 1`, [userId, schoolId, process.env.NODE_ENV ?? "development"]);
  const row = result.rows[0];
  if(row){
    await assertManualSchoolUnlocked(db,schoolId);
    if(!(await readStaffCollection(db,schoolId)).chargeable)return{
      schoolId,restricted:false,status:"NOT_REQUIRED",termId:row.termId??null,
      subscriptionId:row.subscriptionId??null,priceMinor:0,renewalPath:"/my-nfc-subscription",
    };
  }
  const paid = row?.status === "PAID" && row.verified === true && row.termId !== null;
  const statuses = ["PENDING", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
  const status: StaffSubscriptionAccess["status"] = paid ? "PAID" : !row?.termId ? "EXPIRED"
    : statuses.includes(row.status as typeof statuses[number])
      ? row.status as typeof statuses[number] : "UNPAID";
  return { schoolId, restricted: !paid, status, termId: row?.termId ?? null,
    subscriptionId: row?.subscriptionId ?? null, priceMinor: STAFF_SUBSCRIPTION_PRICE_MINOR,
    renewalPath: "/my-nfc-subscription" };
}
