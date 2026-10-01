import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  type PaymentProviderAdapter,
  type VerifiedPayment,
} from "../lib/fee-providers";
import { configuredTestAdapter } from "../lib/fee-providers/factory";

export const STAFF_NFC_PRODUCT = "TEACHER_STAFF_NFC_EID" as const;
export const STAFF_NFC_CURRENCY = "NGN" as const;

export type StaffNfcRecipientType = "SCHOOL" | "PLATFORM" | "PARTNER";

export interface StaffNfcAllocationSnapshot {
  recipientType: StaffNfcRecipientType;
  recipientId: number | null;
  amountMinor: number;
}

export interface StaffNfcAllocationRule {
  priceMinor: number;
  schoolShareMinor: number;
  platformShareMinor: number;
  partnerCommissionMinor: number;
  noPartnerPlatformShareMinor: number;
}

/**
 * The only supported staff allocation decision: the Partner is supplied by
 * the server's valid current-school attribution lookup, never by the caller.
 * All financial values are integer minor units and both branches must balance.
 */
export function calculateStaffNfcAllocations(
  rule: StaffNfcAllocationRule,
  attributedPartnerId: number | null,
): StaffNfcAllocationSnapshot[] {
  const values = [
    rule.priceMinor,
    rule.schoolShareMinor,
    rule.platformShareMinor,
    rule.partnerCommissionMinor,
    rule.noPartnerPlatformShareMinor,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)
      || rule.priceMinor <= 0
      || BigInt(rule.schoolShareMinor) + BigInt(rule.platformShareMinor) + BigInt(rule.partnerCommissionMinor)
        !== BigInt(rule.priceMinor)
      || BigInt(rule.schoolShareMinor) + BigInt(rule.noPartnerPlatformShareMinor)
        !== BigInt(rule.priceMinor)) {
    throw new StaffNfcDomainError(409, "Staff billing rule allocations are inconsistent");
  }
  const hasPartner = attributedPartnerId !== null;
  if (hasPartner && (!Number.isSafeInteger(attributedPartnerId) || attributedPartnerId < 1)) {
    throw new StaffNfcDomainError(409, "Partner attribution is invalid");
  }
  return [
    {
      recipientType: "SCHOOL",
      recipientId: null,
      amountMinor: rule.schoolShareMinor,
    },
    {
      recipientType: "PLATFORM",
      recipientId: null,
      amountMinor: hasPartner ? rule.platformShareMinor : rule.noPartnerPlatformShareMinor,
    },
    ...(hasPartner
      ? [{
          recipientType: "PARTNER" as const,
          recipientId: attributedPartnerId,
          amountMinor: rule.partnerCommissionMinor,
        }]
      : []),
  ];
}

/**
 * Computes deterministic cumulative proportional reversals. Using BigInt and
 * the cumulative target makes the last partial-refund cent absorb rounding
 * rather than creating or deleting value over multiple refunds.
 */
export function calculateStaffNfcRefundReversals(
  allocations: readonly StaffNfcAllocationSnapshot[],
  totalPriceMinor: number,
  refundedBeforeMinor: number,
  refundAmountMinor: number,
): StaffNfcAllocationSnapshot[] {
  if (!Number.isSafeInteger(totalPriceMinor) || totalPriceMinor <= 0
      || !Number.isSafeInteger(refundedBeforeMinor) || refundedBeforeMinor < 0
      || !Number.isSafeInteger(refundAmountMinor) || refundAmountMinor <= 0
      || refundedBeforeMinor + refundAmountMinor > totalPriceMinor) {
    throw new StaffNfcDomainError(409, "Refund exceeds the verified, unrefunded payment amount");
  }
  const originalTotal = allocations.reduce((sum, allocation) => {
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor < 0
        || !["SCHOOL", "PLATFORM", "PARTNER"].includes(allocation.recipientType)
        || (allocation.recipientType === "PARTNER"
          ? !Number.isSafeInteger(allocation.recipientId) || Number(allocation.recipientId) < 1
          : allocation.recipientId !== null)) {
      throw new StaffNfcDomainError(409, "Original immutable payment allocation is invalid");
    }
    return sum + BigInt(allocation.amountMinor);
  }, 0n);
  if (originalTotal !== BigInt(totalPriceMinor)) {
    throw new StaffNfcDomainError(409, "Original immutable payment allocations do not balance to the verified gross payment");
  }
  const refundedAfterMinor = refundedBeforeMinor + refundAmountMinor;
  return allocations.flatMap((allocation) => {
    const targetBefore = BigInt(allocation.amountMinor) * BigInt(refundedBeforeMinor)
      / BigInt(totalPriceMinor);
    const targetAfter = refundedAfterMinor === totalPriceMinor
      ? BigInt(allocation.amountMinor)
      : BigInt(allocation.amountMinor) * BigInt(refundedAfterMinor) / BigInt(totalPriceMinor);
    const amountMinor = Number(targetAfter - targetBefore);
    return amountMinor > 0
      ? [{ recipientType: allocation.recipientType, recipientId: allocation.recipientId, amountMinor }]
      : [];
  });
}

export function staffNfcPaymentActivatesSubscription(
  expected: { reference: string; amountMinor: number; currency: string },
  verified: Pick<VerifiedPayment, "reference" | "amountMinor" | "currency" | "status" | "providerTransactionId">,
): boolean {
  return verified.status === "succeeded"
    && verified.reference === expected.reference
    && verified.amountMinor === expected.amountMinor
    && verified.currency.toUpperCase() === expected.currency.toUpperCase()
    && /^[0-9]+$/.test(verified.providerTransactionId)
    && BigInt(verified.providerTransactionId) > 0n
    && BigInt(verified.providerTransactionId) <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Flutterwave's documented v3 signature is HMAC-SHA256/base64 of raw bytes. */
export function verifyFlutterwaveStaffWebhookSignature(
  rawBody: Uint8Array,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!signature || !secret || secret.length < 16 || signature.length > 1024) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function staffNfcWebhookDigest(rawBody: Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export interface StaffNfcSqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export class StaffNfcDomainError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "StaffNfcDomainError";
  }
}

export type StaffNfcEligibility = {
  eligible: boolean;
  status: "PAID" | "PENDING" | "UNPAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "EXPIRED";
  subscriptionId: number | null;
};

/**
 * Stable, read-only integration point used by the employee NFC worker. The
 * caller must pass its already-selected active academicTermId. A student
 * subscription, physical card state, callback parameter, or a previous term
 * is never treated as a paid staff entitlement.
 */
export async function getStaffNfcEligibility(
  client: StaffNfcSqlExecutor,
  employeeId: number,
  schoolId: number,
  academicTermId: number,
): Promise<StaffNfcEligibility> {
  if (![employeeId, schoolId, academicTermId].every((id) => Number.isSafeInteger(id) && id > 0)) {
    return { eligible: false, status: "UNPAID", subscriptionId: null };
  }
  const result = await client.query<{
    subscriptionId: number | string | null;
    status: string | null;
    activeTerm: boolean;
  }>(
    `SELECT s.id AS "subscriptionId", s.status,
            (UPPER(e.employment_status)='ACTIVE'
             AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
             AND t.is_current=true AND UPPER(t.status)='ACTIVE'
             AND ss.is_current=true AND UPPER(ss.status)='ACTIVE'
             AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE) AS "activeTerm"
       FROM employees e
       JOIN academic_terms t ON t.id=$3 AND t.school_id=e.school_id
       JOIN academic_sessions ss ON ss.id=t.academic_session_id AND ss.school_id=e.school_id
       LEFT JOIN staff_nfc_subscriptions s
         ON s.employee_id=e.id AND s.school_id=e.school_id
        AND s.academic_session_id=t.academic_session_id AND s.academic_term_id=t.id
       WHERE e.id=$1 AND e.school_id=$2
      LIMIT 1`,
    [employeeId, schoolId, academicTermId],
  );
  const row = result.rows[0];
  if (!row) return { eligible: false, status: "UNPAID", subscriptionId: null };
  const subscriptionId = row.subscriptionId == null ? null : Number(row.subscriptionId);
  if (!row.activeTerm) return { eligible: false, status: "EXPIRED", subscriptionId };
  const status = String(row.status ?? "UNPAID").toUpperCase();
  const allowedStatus: StaffNfcEligibility["status"] =
    status === "PAID" || status === "PENDING" || status === "FAILED" || status === "REFUNDED"
      || status === "PARTIALLY_REFUNDED" || status === "EXPIRED"
      ? status
      : "UNPAID";
  return {
    eligible: allowedStatus === "PAID",
    status: allowedStatus,
    subscriptionId,
  };
}

/**
 * Called inside an already-open academic-term activation transaction. If an
 * active current term is not successfully provisioned, the enclosing academic
 * transaction fails closed and the caller must report the provisioning error.
 */
export async function generateStaffNfcTermSubscriptions(
  client: StaffNfcSqlExecutor,
  schoolId: number,
  academicSessionId: number,
  academicTermId: number,
  createdBy: number | null,
): Promise<{ eligibleCount: number; generatedCount: number; unchangedCount: number }> {
  const term = await client.query<{
    schoolId: number;
    sessionId: number;
    dueDate: string;
    eligible: boolean;
  }>(
    `SELECT t.school_id AS "schoolId", t.academic_session_id AS "sessionId",
            t.end_date::text AS "dueDate",
            (t.is_current=true AND UPPER(t.status)='ACTIVE'
              AND s.is_current=true AND UPPER(s.status)='ACTIVE'
              AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE) AS eligible
       FROM academic_terms t
       JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.id=$1 AND t.school_id=$2 AND t.academic_session_id=$3
      FOR UPDATE OF t`,
    [academicTermId, schoolId, academicSessionId],
  );
  if (!term.rows[0]) throw new StaffNfcDomainError(404, "Academic term not found");
  if (!term.rows[0].eligible) {
    throw new StaffNfcDomainError(409, "Staff subscriptions can only be generated for the active current academic term", "TERM_NOT_ELIGIBLE");
  }
  const ruleResult = await client.query<StaffNfcAllocationRule & {
    id: number;
    version: number;
    currency: string;
    effectiveAt: string;
  }>(
    `SELECT id, version, price_minor AS "priceMinor",
            school_share_minor AS "schoolShareMinor",
            platform_share_minor AS "platformShareMinor",
            partner_commission_minor AS "partnerCommissionMinor",
            no_partner_platform_share_minor AS "noPartnerPlatformShareMinor",
            currency, effective_at AS "effectiveAt"
       FROM staff_nfc_billing_rules
      WHERE product=$1 AND effective_at<=CURRENT_TIMESTAMP
      ORDER BY effective_at DESC, version DESC
      LIMIT 1`,
    [STAFF_NFC_PRODUCT],
  );
  const rule = ruleResult.rows[0];
  if (!rule || rule.currency !== STAFF_NFC_CURRENCY) {
    throw new StaffNfcDomainError(409, "No effective staff NFC billing rule is configured", "BILLING_RULE_REQUIRED");
  }
  const employeeRows = await client.query<{ id: number; partnerProfileId: number | null; attributionId: number | null }>(
    `SELECT e.id, attribution.partner_profile_id AS "partnerProfileId",
            attribution.id AS "attributionId"
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT a.id, a.partner_profile_id
           FROM school_partner_attributions a
           JOIN partner_profiles p ON p.id=a.partner_profile_id
          WHERE a.school_id=e.school_id AND a.is_current=true AND a.status='ACTIVE'
            AND a.starts_at<=CURRENT_TIMESTAMP
            AND (a.ends_at IS NULL OR a.ends_at>CURRENT_TIMESTAMP)
            AND p.status='ACTIVE'
          ORDER BY a.starts_at DESC, a.id DESC
          LIMIT 1
       ) attribution ON true
      WHERE e.school_id=$1 AND UPPER(e.employment_status)='ACTIVE'
        AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
      ORDER BY e.id`,
    [schoolId],
  );
  const eligibleCount = employeeRows.rows.length;
  if (!eligibleCount) return { eligibleCount: 0, generatedCount: 0, unchangedCount: 0 };

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO staff_nfc_subscriptions (
       school_id, employee_id, academic_session_id, academic_term_id, product,
       billing_rule_id, billing_rule_version, price_minor, school_share_minor,
       platform_share_minor, partner_share_minor, partner_profile_id, attribution_id,
       currency, status, due_date, created_by
     )
     SELECT $1, e.id, $2, $3, $4, $5, $6, $7, $8,
            CASE WHEN e.partner_profile_id IS NULL THEN $9 ELSE $10 END,
            CASE WHEN e.partner_profile_id IS NULL THEN 0 ELSE $11 END,
            e.partner_profile_id, e.attribution_id, $12, 'UNPAID', $13, $14
       FROM jsonb_to_recordset($15::jsonb) AS e(
         id integer, partner_profile_id integer, attribution_id integer
       )
     ON CONFLICT (employee_id, school_id, academic_session_id, academic_term_id) DO NOTHING
     RETURNING id`,
    [
      schoolId,
      academicSessionId,
      academicTermId,
      STAFF_NFC_PRODUCT,
      rule.id,
      rule.version,
      rule.priceMinor,
      rule.schoolShareMinor,
      rule.noPartnerPlatformShareMinor,
      rule.platformShareMinor,
      rule.partnerCommissionMinor,
      STAFF_NFC_CURRENCY,
      term.rows[0].dueDate,
      createdBy,
      JSON.stringify(employeeRows.rows.map((employee) => ({
        id: Number(employee.id),
        partner_profile_id: employee.partnerProfileId == null ? null : Number(employee.partnerProfileId),
        attribution_id: employee.attributionId == null ? null : Number(employee.attributionId),
      }))),
    ],
  );
  const generatedCount = inserted.rowCount ?? inserted.rows.length;
  if (generatedCount > 0) {
    await client.query(
      `INSERT INTO audit_logs (
         "user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
         severity,event_type,result,metadata
       )
       VALUES (
         COALESCE((SELECT COALESCE(NULLIF(trim(first_name || ' ' || last_name),''),email)
                     FROM app_users WHERE id=$3),'Staff billing service'),
         $2,$3,(SELECT clerk_user_id FROM app_users WHERE id=$3),$4,
         'Generated staff NFC term subscriptions','Staff NFC Billing',$5,
         'info','STAFF_NFC_TERM_SUBSCRIPTIONS_GENERATED','SUCCESS',$6::jsonb
       )`,
      [
        createdBy ? "SCHOOL_ADMIN" : "STAFF_NFC_SYSTEM",
        createdBy,
        schoolId,
        academicTermId,
        JSON.stringify({
          product: STAFF_NFC_PRODUCT,
          sessionId: academicSessionId,
          eligibleCount,
          generatedCount,
          unchangedCount: eligibleCount - generatedCount,
          billingRuleId: rule.id,
          billingRuleVersion: rule.version,
        }),
      ],
    );
  }
  return {
    eligibleCount,
    generatedCount,
    unchangedCount: eligibleCount - generatedCount,
  };
}

/** Idempotent academic-transaction hook for the one currently payable school term. */
export async function ensureCurrentStaffNfcTermSubscriptions(
  client: StaffNfcSqlExecutor,
  schoolId: number,
  createdBy: number | null,
): Promise<{ termId: number | null; sessionId: number | null; generatedCount: number; unchangedCount: number }> {
  const active = await client.query<{ termId: number; sessionId: number }>(
    `SELECT t.id AS "termId",t.academic_session_id AS "sessionId"
       FROM academic_terms t
       JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      WHERE t.school_id=$1 AND t.is_current=true AND UPPER(t.status)='ACTIVE'
        AND s.is_current=true AND UPPER(s.status)='ACTIVE'
        AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
      ORDER BY t.start_date DESC,t.id DESC
      LIMIT 1`,
    [schoolId],
  );
  const target = active.rows[0];
  if (!target) return { termId: null, sessionId: null, generatedCount: 0, unchangedCount: 0 };
  const result = await generateStaffNfcTermSubscriptions(
    client,
    schoolId,
    Number(target.sessionId),
    Number(target.termId),
    createdBy,
  );
  return {
    termId: Number(target.termId),
    sessionId: Number(target.sessionId),
    generatedCount: result.generatedCount,
    unchangedCount: result.unchangedCount,
  };
}

export function makeStaffNfcProviderAdapter() {
  try {
    return configuredTestAdapter("FLUTTERWAVE") as
      | (PaymentProviderAdapter & {
          requestRefund?: (input: {
            providerTransactionId: string;
            amountMinor: number;
            currency: string;
            reason: string;
          }) => Promise<import("../lib/fee-providers").FlutterwaveRefundResult>;
          verifyRefund?: (refundId: string) => Promise<import("../lib/fee-providers").FlutterwaveRefundResult>;
        })
      | null;
  } catch {
    return null;
  }
}

export function staffNfcWebhookSigningSecret() {
  return process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? null;
}

export function createStaffNfcPaymentReference() {
  return `staffnfc_${randomUUID().replaceAll("-", "")}`;
}

export function normalizeVerifiedProviderPayment(
  expected: { reference: string; amountMinor: number; currency: string },
  verified: VerifiedPayment,
) {
  const activates = staffNfcPaymentActivatesSubscription(expected, verified);
  if (verified.reference !== expected.reference
      || verified.amountMinor !== expected.amountMinor
      || verified.currency.toUpperCase() !== expected.currency.toUpperCase()
      || !/^[0-9]+$/.test(verified.providerTransactionId)
      || BigInt(verified.providerTransactionId) <= 0n
      || BigInt(verified.providerTransactionId) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StaffNfcDomainError(409, "Verified provider transaction does not match the reserved payment", "PAYMENT_MISMATCH");
  }
  const optionalAmount = (value: number | undefined) =>
    value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    activates,
    providerTransactionId: verified.providerTransactionId,
    providerPaidAt: verified.paidAt ?? null,
    providerFeeMinor: optionalAmount(verified.providerFeeMinor),
    providerSettlementAmountMinor: optionalAmount(verified.providerSettlementAmountMinor),
    status: verified.status === "succeeded" ? "PAID" : verified.status === "failed" ? "FAILED" : "PENDING",
  } as const;
}