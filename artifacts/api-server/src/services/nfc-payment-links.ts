import { createHash, createHmac, randomBytes } from "node:crypto";
import { isFlutterwaveTestCheckoutUrl } from "../lib/flutterwave-checkout-url";
import { AuthError } from "../middlewares/auth";
import { calculateStudentSubscriptionAllocations, type StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import { studentAllocationPolicy } from "../lib/student-allocation-policy";

export function requireNfcLinkDevelopment() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new AuthError(503, "Guest NFC payments are Development-only; live settlement is not configured");
  }
}

export function nfcLinkToken(reference: string) {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 16) throw new AuthError(503, "Payment-link signing is unavailable");
  return createHmac("sha256", key).update(`educore:nfc-payment-link:v1:${reference}`).digest("base64url");
}
export const nfcLinkTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newNfcLinkReference = () => `NFC_${randomBytes(24).toString("base64url")}`;

export const linkScopeSql = `
 SELECT b.school_id AS "schoolId",b.student_id AS "studentId",
        b.subscription_id AS "subscriptionId",b.academic_session_id AS "sessionId",
        b.academic_term_id AS "termId",sc.name AS "schoolName",
        st.admission_no AS "studentIdentifier",t.name AS "termName",ses.name AS "sessionName",
        sub.amount,sub.term AS "subscriptionTerm",sub.status AS "subscriptionStatus",
        sub.verification_status AS "verificationStatus",b.legacy_invoice_id AS "legacyInvoiceId"
 FROM student_subscription_terms b
 JOIN subscriptions sub ON sub.id=b.subscription_id AND sub.school_id=b.school_id AND sub.student_id=b.student_id
 JOIN schools sc ON sc.id=b.school_id AND LOWER(sc.status)='active'
 JOIN students st ON st.id=b.student_id AND st.school_id=b.school_id AND LOWER(st.status)='active'
 JOIN academic_terms t ON t.id=b.academic_term_id AND t.school_id=b.school_id AND t.academic_session_id=b.academic_session_id
 JOIN academic_sessions ses ON ses.id=b.academic_session_id AND ses.school_id=b.school_id`;

export const publicLinkSql = `
 SELECT l.*,sc.name AS "schoolName",st.admission_no AS "studentIdentifier",
        trim(concat_ws(' ',NULLIF(trim(st.first_name),''),NULLIF(trim(st.last_name),''))) AS "studentName",
        t.name AS "termName",ses.name AS "sessionName",
        sub.status AS "subscriptionStatus",sub.verification_status AS "verificationStatus",
        p.status AS "paymentStatus",p.reconciliation_status AS "paymentReconciliation",
        p.checkout_url AS "checkoutUrl",p.reference AS "paymentReference",
        p.receipt_snapshot AS "receiptSnapshot"
 FROM nfc_payment_links l
 JOIN subscriptions sub ON sub.id=l.subscription_id AND sub.school_id=l.school_id AND sub.student_id=l.student_id
 JOIN student_subscription_terms b ON b.subscription_id=l.subscription_id AND b.school_id=l.school_id
   AND b.student_id=l.student_id AND b.academic_session_id=l.academic_session_id AND b.academic_term_id=l.academic_term_id
 JOIN schools sc ON sc.id=l.school_id AND LOWER(sc.status)='active'
 JOIN students st ON st.id=l.student_id AND st.school_id=l.school_id AND LOWER(st.status)='active'
 JOIN academic_terms t ON t.id=l.academic_term_id AND t.school_id=l.school_id AND t.academic_session_id=l.academic_session_id
 JOIN academic_sessions ses ON ses.id=l.academic_session_id AND ses.school_id=l.school_id
 LEFT JOIN student_subscription_payments p ON p.id=l.payment_id
   AND p.subscription_id=l.subscription_id AND p.school_id=l.school_id AND p.student_id=l.student_id
   AND p.academic_session_id=l.academic_session_id AND p.academic_term_id=l.academic_term_id
    AND p.provider='FLUTTERWAVE' AND p.provider_mode='SANDBOX'
 WHERE l.token_hash=$1`;

/** Never attach a reused link or resolved bearer token to another intent. */
export function assertNfcLinkBinding(row: any, scope: any) {
  if (!row || [
    [row.school_id,scope.schoolId],[row.student_id,scope.studentId],
    [row.subscription_id,scope.subscriptionId],[row.academic_session_id,scope.sessionId],
    [row.academic_term_id,scope.termId],
  ].some(([actual,expected])=>!Number.isSafeInteger(Number(actual))||Number(actual)<=0||Number(actual)!==Number(expected))) {
    throw new AuthError(409, "Payment link could not be safely resolved. Ask school staff for a new link.");
  }
}

export function nfcLinkStatus(row: any, now = Date.now()) {
  const verified = String(row.verificationStatus).toLowerCase() === "verified"
    && String(row.subscriptionStatus).toLowerCase() === "active";
  if (verified) return "PAID";
  if (row.status === "CANCELLED") return "CANCELLED";
  if (new Date(row.expires_at).getTime() <= now) return "EXPIRED";
  if (row.mode === "FLUTTERWAVE_SANDBOX" && ["FAILED", "RECONCILIATION_REQUIRED"].includes(row.paymentStatus)) {
    return row.paymentStatus;
  }
  return row.status;
}

export function publicNfcLink(row: any) {
  if (typeof row.studentName !== "string" || !row.studentName.trim()
      || typeof row.studentIdentifier !== "string" || !row.studentIdentifier.trim()
      || typeof row.reference !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(row.reference)
      || !Number.isFinite(new Date(row.expires_at).getTime())
      || !Array.isArray(row.expected_allocations)
      || row.expected_allocations.some((a: any) => !a || typeof a.recipientType !== "string" || !Number.isSafeInteger(a.amountMinor))) {
    throw new AuthError(409, "These payment instructions require school review. Ask for a new link.");
  }
  if (row.mode === "FLUTTERWAVE_SANDBOX" && (!row.payment_id || !row.paymentReference)) {
    throw new AuthError(409, "The linked TEST payment could not be resolved. Ask school staff to review the link.");
  }
  const status = nfcLinkStatus(row);
  const sandboxUrl = typeof row.checkoutUrl === "string" ? row.checkoutUrl : null;
  let checkoutUrl: string | null = null;
  if (status === "PENDING" && row.mode === "FLUTTERWAVE_SANDBOX" && sandboxUrl) {
    if (isFlutterwaveTestCheckoutUrl(sandboxUrl)) checkoutUrl = sandboxUrl;
  }
  return {
    reference: row.reference, schoolName: row.schoolName,
    studentName: row.studentName.trim(), studentIdentifier: row.studentIdentifier, termName: row.termName, sessionName: row.sessionName,
    amountMinor: 500_000, amountDueMinor: status === "PAID" ? 0 : 500_000, currency: "NGN",
    mode: row.mode, status, expiresAt: new Date(row.expires_at).toISOString(),
    settlementStatus: "UNVERIFIED", subscriptionActivated: status === "PAID",
    checkoutUrl,
    // Never manufacture a receipt for a simulation or reveal a full financial snapshot.
    receiptReference: status === "PAID" && row.receiptSnapshot ? row.paymentReference ?? null : null,
    // This serializer also serves unauthenticated payers. Internal forecasts
    // remain persisted for audit; public links never disclose recipient shares.
    expectedAllocations: [],
  };
}

/** Same eligibility lookup as existing billing, for an explicitly NONfinancial preview. */
export async function expectedNfcAllocations(db: StudentSubscriptionSqlClient, scope: any) {
  const policy = studentAllocationPolicy(scope.paymentReference ?? "SCV2_");
  const attribution = (await db.query(
    `SELECT a.partner_profile_id AS "partnerProfileId"
       FROM school_partner_attributions a JOIN partner_profiles pp ON pp.id=a.partner_profile_id
      WHERE a.school_id=$1 AND a.is_current=true AND a.status='ACTIVE' AND pp.status='ACTIVE'
        AND a.starts_at<=NOW() AND (a.ends_at IS NULL OR a.ends_at>NOW())
      ORDER BY a.starts_at DESC,a.id DESC LIMIT 1`, [scope.schoolId],
  )).rows[0];
  if (!attribution) return calculateStudentSubscriptionAllocations({ partnerProfileId: null, policyVersion: policy.version });
  const rule = (await db.query(
    `SELECT id,allocation_total AS "allocationTotal",school_amount AS "schoolAmount",
            partner_amount AS "partnerAmount",edupulse_amount AS "edupulseAmount",currency
       FROM commission_rules WHERE status='ACTIVE' AND currency='NGN'
         AND (term=$1 OR term IS NULL) AND effective_at<=NOW() AND (ends_at IS NULL OR ends_at>NOW())
          AND allocation_total=5000 AND school_amount=$2 AND partner_amount=100 AND edupulse_amount=$3
       ORDER BY (term=$1) DESC,effective_at DESC,id DESC LIMIT 1 FOR SHARE`,
    [scope.subscriptionTerm, policy.schoolMinor / 100, policy.platformWithPartnerMinor / 100],
  )).rows[0];
  if (!rule) throw new AuthError(409, "The existing eligible Partner commission rule must be configured");
  return calculateStudentSubscriptionAllocations({
    policyVersion: policy.version,
    partnerProfileId: Number(attribution.partnerProfileId),
    commissionRule: {
      id: Number(rule.id), allocationTotal: Number(rule.allocationTotal),
      schoolAmount: Number(rule.schoolAmount), partnerAmount: Number(rule.partnerAmount),
      edupulseAmount: Number(rule.edupulseAmount), currency: String(rule.currency),
    },
  });
}

/** Locked link transitions make retries, concurrent clicks and duplicate callbacks idempotent. */
export async function simulateNfcLink(db: StudentSubscriptionSqlClient, token: string, outcome: "SUCCESS" | "FAILED") {
  requireNfcLinkDevelopment();
  const row = (await db.query(`${publicLinkSql} FOR UPDATE OF l`, [nfcLinkTokenHash(token)])).rows[0];
  if (!row) throw new AuthError(404, "Invalid payment link");
  if (row.mode !== "DEVELOPMENT_SIMULATION") throw new AuthError(409, "A provider payment cannot be simulated");
  const status = nfcLinkStatus(row);
  if (status === "EXPIRED" || status === "CANCELLED") throw new AuthError(409, "This payment link is no longer available");
  if (status === "PENDING") {
    const target = outcome === "SUCCESS" ? "SIMULATED_SUCCESS" : "SIMULATED_FAILED";
    await db.query("UPDATE nfc_payment_links SET status=$1,updated_at=NOW() WHERE id=$2", [target, row.id]);
    row.status = target;
  }
  // Terminal retries return the persisted outcome, even if the caller supplies a different outcome.
  return publicNfcLink(row);
}
