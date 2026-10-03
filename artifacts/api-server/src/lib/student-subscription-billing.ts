import type { VerifiedPayment, ExpectedPayment } from "./fee-providers";

export type StudentSubscriptionAllocation = {
  recipientType: "SCHOOL" | "PLATFORM" | "PARTNER" | "PLATFORM_PROVIDER_FEE";
  recipientId: number | null;
  amountMinor: number;
};

export type StudentSubscriptionAllocationInput = {
  partnerProfileId: number | null;
  commissionRule?: {
    id: number;
    allocationTotal: number;
    schoolAmount: number;
    partnerAmount: number;
    edupulseAmount: number;
    currency: string;
  } | null;
};

export type StudentSubscriptionSqlClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};
export type StudentSubscriptionSqlPool = {
  connect: () => Promise<StudentSubscriptionSqlClient & { release: () => void }>;
};

export type StudentSubscriptionTermPaymentScope = {
  schoolId: number;
  studentId: number;
  sessionId: number;
  termId: number;
};

export const STUDENT_SUBSCRIPTION_GROSS_MINOR = 500_000;

export class StudentSubscriptionBillingError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 503,
    message: string,
    public readonly code = "STUDENT_SUBSCRIPTION_PAYMENT_ERROR",
  ) {
    super(message);
  }
}

/**
 * Find another active or uncertain payment by business identity, rather than
 * only by a legacy subscriptions row. A provider-confirmed FAILED attempt is
 * intentionally retryable.
 */
export async function findStudentSubscriptionTermPaymentConflict(
  client: StudentSubscriptionSqlClient,
  scope: StudentSubscriptionTermPaymentScope,
  excludePaymentId?: number,
): Promise<{ id: number; subscriptionId: number; status: string } | null> {
  const result = await client.query(
    `SELECT id,subscription_id AS "subscriptionId",status
       FROM student_subscription_payments
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4
        AND ($5::integer IS NULL OR id<>$5)
        AND (status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
          OR reconciliation_status='RECONCILIATION_REQUIRED')
      ORDER BY CASE status WHEN 'PAID' THEN 0 WHEN 'RECONCILIATION_REQUIRED' THEN 1 ELSE 2 END,
               created_at DESC,id DESC
      LIMIT 1`,
    [scope.schoolId, scope.studentId, scope.sessionId, scope.termId, excludePaymentId ?? null],
  );
  return result.rows[0] ?? null;
}

async function hasUnresolvedFailedStudentTermPayment(
  client: StudentSubscriptionSqlClient,
  scope: StudentSubscriptionTermPaymentScope,
  excludePaymentId: number,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
       FROM student_subscription_payments
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4
        AND id<>$5 AND status='FAILED'
        AND COALESCE(failure_code,'')<>'PROVIDER_VERIFIED_FAILED'
      LIMIT 1`,
    [scope.schoolId, scope.studentId, scope.sessionId, scope.termId, excludePaymentId],
  );
  return Boolean(result.rows[0]);
}

/**
 * Student subscription revenue is a fixed NGN 5,000 allocation. A partner
 * receives a share only when the caller supplies the active, server-validated
 * attribution and its matching effective commission rule.
 */
export function calculateStudentSubscriptionAllocations(
  input: StudentSubscriptionAllocationInput,
): StudentSubscriptionAllocation[] {
  if (input.partnerProfileId === null) {
    if (input.commissionRule) {
      throw new StudentSubscriptionBillingError(409, "Unattributed subscriptions cannot use a Partner commission rule");
    }
    return [
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 300_000 },
    ];
  }
  const rule = input.commissionRule;
  if (!Number.isSafeInteger(input.partnerProfileId) || input.partnerProfileId < 1 || !rule
      || !Number.isSafeInteger(rule.id) || rule.id < 1
      || rule.currency.toUpperCase() !== "NGN"
      || rule.allocationTotal !== 5_000
      || rule.schoolAmount !== 2_000
      || rule.partnerAmount !== 100
      || rule.edupulseAmount !== 2_900
      || rule.schoolAmount + rule.partnerAmount + rule.edupulseAmount !== rule.allocationTotal) {
    throw new StudentSubscriptionBillingError(
      409,
      "An active NGN 5,000 Partner commission rule matching the student allocation is required",
      "STUDENT_COMMISSION_RULE_REQUIRED",
    );
  }
  return [
    { recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
    { recipientType: "PLATFORM", recipientId: null, amountMinor: 290_000 },
    { recipientType: "PARTNER", recipientId: input.partnerProfileId, amountMinor: 10_000 },
  ];
}

export function normalizeStudentSubscriptionProviderPayment(
  expected: ExpectedPayment,
  verified: VerifiedPayment,
): VerifiedPayment {
  if (verified.reference !== expected.reference
      || verified.amountMinor !== expected.amountMinor
      || verified.currency.toUpperCase() !== expected.currency.toUpperCase()
      || !/^[0-9]+$/.test(verified.providerTransactionId)
      || BigInt(verified.providerTransactionId) <= 0n
      || BigInt(verified.providerTransactionId) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StudentSubscriptionBillingError(
      409,
      "Flutterwave payment does not match the persisted student subscription checkout",
      "STUDENT_PAYMENT_RECONCILIATION_REQUIRED",
    );
  }
  if (expected.currency.toUpperCase() !== "NGN" || expected.amountMinor !== STUDENT_SUBSCRIPTION_GROSS_MINOR) {
    throw new StudentSubscriptionBillingError(409, "Student subscription price is not the fixed NGN 5,000 amount");
  }
  for (const snapshot of [verified.providerFeeMinor, verified.providerSettlementAmountMinor]) {
    if (snapshot !== undefined && (!Number.isSafeInteger(snapshot) || snapshot < 0)) {
      throw new StudentSubscriptionBillingError(409, "Flutterwave fee or settlement snapshot is invalid");
    }
    if (snapshot !== undefined && snapshot > expected.amountMinor) {
      throw new StudentSubscriptionBillingError(409, "Flutterwave fee or settlement snapshot exceeds the gross payment");
    }
  }
  return verified;
}

export function studentSubscriptionPaymentActivates(
  expected: ExpectedPayment,
  verified: VerifiedPayment,
): boolean {
  try {
    normalizeStudentSubscriptionProviderPayment(expected, verified);
  } catch {
    return false;
  }
  return verified.status === "succeeded";
}

export function normalizeStudentSubscriptionTerm(term: string): string {
  const normalized = term.trim();
  if (!normalized || normalized.length > 120) {
    throw new StudentSubscriptionBillingError(400, "A valid current academic term is required");
  }
  return normalized;
}

export function studentSubscriptionAmountToMinor(amount: string | number): number {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(String(amount));
  if (!match) throw new StudentSubscriptionBillingError(409, "Student subscription amount is not a valid NGN amount");
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StudentSubscriptionBillingError(409, "Student subscription amount exceeds the safe monetary range");
  }
  return Number(minor);
}

export type StudentSubscriptionFinalizeResult = {
  status: "PENDING" | "FAILED" | "PAID" | "RECONCILIATION_REQUIRED";
  activated: boolean;
  reconciliationRequired: boolean;
  allocations: Array<StudentSubscriptionAllocation & { entryType: "CREDIT" | "EXPENSE" }>;
};

/**
 * Finalize a previously persisted checkout only from an independently verified
 * provider response. The DB transaction re-locks the payment and business-term
 * subscription so concurrent verification and retry requests are idempotent.
 */
export async function finalizeVerifiedStudentSubscriptionPayment(
  database: StudentSubscriptionSqlPool,
  paymentId: number,
  verified: VerifiedPayment,
  canonicalLogoVersionUrl?: (schoolId: number, logoId: number) => string,
): Promise<StudentSubscriptionFinalizeResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT p.id,p.subscription_id AS "subscriptionId",p.school_id AS "schoolId",
              p.student_id AS "studentId",p.academic_session_id AS "sessionId",
              p.academic_term_id AS "termId",p.payer_user_id AS "payerUserId",
              p.provider,p.provider_mode AS "providerMode",p.reference,
              p.gross_amount_minor AS "grossAmountMinor",p.currency,p.status,
              p.provider_transaction_id AS "providerTransactionId",
              p.provider_fee_minor AS "providerFeeMinor",
              p.settlement_amount_minor AS "settlementAmountMinor",
              sub.term AS "subscriptionTerm",sub.status AS "subscriptionStatus",
              sub.verification_status AS "verificationStatus",st.status AS "studentStatus",
              t.name AS "academicTermName",t.end_date AS "termEndDate",
              (t.is_current=true AND UPPER(t.status)='ACTIVE'
                AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
                AND ses.is_current=true AND UPPER(ses.status)='ACTIVE') AS "currentTerm"
         FROM student_subscription_payments p
         JOIN subscriptions sub
           ON sub.id=p.subscription_id AND sub.school_id=p.school_id AND sub.student_id=p.student_id
         JOIN students st ON st.id=p.student_id AND st.school_id=p.school_id
         JOIN academic_terms t ON t.id=p.academic_term_id AND t.school_id=p.school_id
         JOIN academic_sessions ses ON ses.id=p.academic_session_id AND ses.school_id=p.school_id
        WHERE p.id=$1
        FOR UPDATE OF p,sub,st`,
      [paymentId],
    );
    const payment = locked.rows[0];
    if (!payment) throw new StudentSubscriptionBillingError(404, "Student subscription payment not found");
    if (payment.status === "PAID") {
      await client.query("COMMIT");
      return { status: "PAID", activated: true, reconciliationRequired: false, allocations: [] };
    }
    const expected = {
      reference: String(payment.reference),
      amountMinor: Number(payment.grossAmountMinor),
      currency: String(payment.currency),
    };
    try {
      normalizeStudentSubscriptionProviderPayment(expected, verified);
    } catch {
      await markStudentPaymentForReconciliation(client, paymentId, "PROVIDER_PAYMENT_MISMATCH");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    if (payment.providerTransactionId
        && String(payment.providerTransactionId) !== verified.providerTransactionId) {
      await markStudentPaymentForReconciliation(client, paymentId, "PROVIDER_TRANSACTION_CONFLICT");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    const txOwner = await client.query(
      `SELECT id FROM student_subscription_payments
        WHERE provider=$1 AND provider_transaction_id=$2 AND id<>$3 LIMIT 1`,
      [payment.provider, verified.providerTransactionId, paymentId],
    );
    if (txOwner.rows[0]) {
      await markStudentPaymentForReconciliation(client, paymentId, "PROVIDER_TRANSACTION_ALREADY_USED");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    if (verified.status === "pending" || verified.status === "failed") {
      if (verified.status === "failed" && await hasUnresolvedFailedStudentTermPayment(client, {
        schoolId: Number(payment.schoolId),
        studentId: Number(payment.studentId),
        sessionId: Number(payment.sessionId),
        termId: Number(payment.termId),
      }, Number(payment.id))) {
        await markStudentPaymentForReconciliation(client, paymentId, "STUDENT_TERM_PAYMENT_CONFLICT");
        await client.query("COMMIT");
        return {
          status: "RECONCILIATION_REQUIRED",
          activated: false,
          reconciliationRequired: true,
          allocations: [],
        };
      }
      const status = verified.status === "pending" ? "PENDING" : "FAILED";
      await client.query(
        `UPDATE student_subscription_payments
            SET status=$1,provider_transaction_id=$2,provider_paid_at=$3,
                provider_fee_minor=$4,settlement_amount_minor=$5,
                reconciliation_status='RECONCILED',
                failure_code=CASE WHEN $1='FAILED' THEN 'PROVIDER_VERIFIED_FAILED' ELSE NULL END,
                updated_at=NOW()
          WHERE id=$6`,
        [
          status,
          verified.providerTransactionId,
          verified.paidAt ? new Date(verified.paidAt) : null,
          verified.providerFeeMinor ?? null,
          verified.providerSettlementAmountMinor ?? null,
          paymentId,
        ],
      );
      await client.query("COMMIT");
      return { status, activated: false, reconciliationRequired: false, allocations: [] };
    }
    if (payment.provider !== "FLUTTERWAVE" || payment.providerMode !== "SANDBOX"
        || Number(payment.grossAmountMinor) !== STUDENT_SUBSCRIPTION_GROSS_MINOR
        || String(payment.currency).toUpperCase() !== "NGN") {
      await markStudentPaymentForReconciliation(client, paymentId, "PERSISTED_PAYMENT_MODE_MISMATCH");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    if (payment.currentTerm !== true || String(payment.subscriptionTerm) !== String(payment.academicTermName)
        || String(payment.studentStatus).toUpperCase() !== "ACTIVE") {
      await markStudentPaymentForReconciliation(client, paymentId, "ACADEMIC_TERM_OR_STUDENT_NOT_CURRENT");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    const otherTermPayment = await findStudentSubscriptionTermPaymentConflict(client, {
      schoolId: Number(payment.schoolId),
      studentId: Number(payment.studentId),
      sessionId: Number(payment.sessionId),
      termId: Number(payment.termId),
    }, Number(payment.id));
    if (otherTermPayment) {
      if (String(payment.status) === "FAILED") {
        await client.query(
          `UPDATE student_subscription_payments
            SET failure_code='STUDENT_TERM_PAYMENT_CONFLICT',updated_at=NOW()
            WHERE id=$1 AND status='FAILED'`,
          [paymentId],
        );
      } else {
        await markStudentPaymentForReconciliation(client, paymentId, "STUDENT_TERM_PAYMENT_CONFLICT");
      }
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    if (await hasUnresolvedFailedStudentTermPayment(client, {
      schoolId: Number(payment.schoolId),
      studentId: Number(payment.studentId),
      sessionId: Number(payment.sessionId),
      termId: Number(payment.termId),
    }, Number(payment.id))) {
      await markStudentPaymentForReconciliation(client, paymentId, "STUDENT_TERM_PAYMENT_CONFLICT");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    if (String(payment.verificationStatus).toLowerCase() === "verified"
        || String(payment.subscriptionStatus).toLowerCase() === "active") {
      await markStudentPaymentForReconciliation(client, paymentId, "LEGACY_OR_CONFLICTING_SUBSCRIPTION_STATE");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }

    const attributionResult = await client.query(
      `SELECT a.id AS "attributionId",a.partner_profile_id AS "partnerProfileId"
         FROM school_partner_attributions a
         JOIN partner_profiles pp ON pp.id=a.partner_profile_id
        WHERE a.school_id=$1 AND a.is_current=true AND a.status='ACTIVE' AND pp.status='ACTIVE'
          AND a.starts_at<=NOW() AND (a.ends_at IS NULL OR a.ends_at>NOW())
        ORDER BY a.starts_at DESC,a.id DESC
        LIMIT 1`,
      [payment.schoolId],
    );
    const attribution = attributionResult.rows[0] ?? null;
    let commissionRule: StudentSubscriptionAllocationInput["commissionRule"] = null;
    if (attribution) {
      const ruleResult = await client.query(
        `SELECT id,allocation_total AS "allocationTotal",school_amount AS "schoolAmount",
                partner_amount AS "partnerAmount",edupulse_amount AS "edupulseAmount",currency
           FROM commission_rules
          WHERE status='ACTIVE' AND currency='NGN'
            AND (term=$1 OR term IS NULL)
            AND effective_at<=NOW() AND (ends_at IS NULL OR ends_at>NOW())
            AND allocation_total=5000 AND school_amount=2000
            AND partner_amount=100 AND edupulse_amount=2900
          ORDER BY (term=$1) DESC,effective_at DESC,id DESC
          LIMIT 1
          FOR SHARE`,
        [payment.subscriptionTerm],
      );
      const rule = ruleResult.rows[0];
      if (!rule) {
        await markStudentPaymentForReconciliation(client, paymentId, "STUDENT_COMMISSION_RULE_REQUIRED");
        await client.query("COMMIT");
        return {
          status: "RECONCILIATION_REQUIRED",
          activated: false,
          reconciliationRequired: true,
          allocations: [],
        };
      }
      commissionRule = {
        id: Number(rule.id),
        allocationTotal: Number(rule.allocationTotal),
        schoolAmount: Number(rule.schoolAmount),
        partnerAmount: Number(rule.partnerAmount),
        edupulseAmount: Number(rule.edupulseAmount),
        currency: String(rule.currency),
      };
    }
    let revenueAllocations: StudentSubscriptionAllocation[];
    try {
      revenueAllocations = calculateStudentSubscriptionAllocations({
        partnerProfileId: attribution ? Number(attribution.partnerProfileId) : null,
        commissionRule,
      });
    } catch {
      await markStudentPaymentForReconciliation(client, paymentId, "STUDENT_ALLOCATION_RULE_INVALID");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    const providerFeeMinor = verified.providerFeeMinor ?? 0;
    const allocations: StudentSubscriptionFinalizeResult["allocations"] = revenueAllocations.map((item) => ({
      ...item,
      entryType: "CREDIT" as const,
    }));
    if (providerFeeMinor > 0) {
      allocations.push({
        recipientType: "PLATFORM_PROVIDER_FEE",
        recipientId: null,
        amountMinor: providerFeeMinor,
        entryType: "EXPENSE",
      });
    }
    const subscriptionUpdate = await client.query(
      `UPDATE subscriptions
          SET status='active',verification_status='verified',provider='flutterwave',
              provider_reference=$1,partner_profile_id=$2,partner_share=$3,
              school_share=$4,edupulse_share=$5,
              allocation_snapshot=$6::jsonb,
              expires_at=($7::date + 1)::timestamptz
        WHERE id=$8 AND school_id=$9 AND student_id=$10
          AND LOWER(verification_status)<>'verified' AND LOWER(status)<>'active'
        RETURNING id`,
      [
        payment.reference,
        attribution ? Number(attribution.partnerProfileId) : null,
        attribution ? 100 : null,
        2_000,
        attribution ? 2_900 : 3_000,
        JSON.stringify({
          grossAmountMinor: STUDENT_SUBSCRIPTION_GROSS_MINOR,
          currency: "NGN",
          schoolAmountMinor: 200_000,
          platformAmountMinor: attribution ? 290_000 : 300_000,
          partnerAmountMinor: attribution ? 10_000 : 0,
          partnerProfileId: attribution ? Number(attribution.partnerProfileId) : null,
          attributionId: attribution ? Number(attribution.attributionId) : null,
          commissionRuleId: commissionRule?.id ?? null,
          sessionId: Number(payment.sessionId),
          termId: Number(payment.termId),
          term: payment.subscriptionTerm,
          paymentId,
        }),
        payment.termEndDate,
        payment.subscriptionId,
        payment.schoolId,
        payment.studentId,
      ],
    );
    if (!subscriptionUpdate.rows[0]) {
      await markStudentPaymentForReconciliation(client, paymentId, "SUBSCRIPTION_STATE_CONFLICT");
      await client.query("COMMIT");
      return {
        status: "RECONCILIATION_REQUIRED",
        activated: false,
        reconciliationRequired: true,
        allocations: [],
      };
    }
    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO student_subscription_allocations (
           idempotency_key,entry_type,recipient_type,recipient_id,school_id,student_id,payer_user_id,
           academic_session_id,academic_term_id,subscription_id,payment_id,attribution_id,
           commission_rule_id,amount_minor,currency
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'NGN')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          `student-subscription:payment:${paymentId}:${allocation.entryType}:${allocation.recipientType}`,
          allocation.entryType,
          allocation.recipientType,
          allocation.recipientId,
          payment.schoolId,
          payment.studentId,
          payment.payerUserId,
          payment.sessionId,
          payment.termId,
          payment.subscriptionId,
          paymentId,
          attribution ? Number(attribution.attributionId) : null,
          commissionRule?.id ?? null,
          allocation.amountMinor,
        ],
      );
    }
    if (attribution && commissionRule) {
      await client.query(
        `INSERT INTO commission_ledger (
           partner_profile_id,school_id,student_id,subscription_id,commission_rule_id,
           academic_session_id,term,rate,count,amount,currency,status,created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,100,1,100,'NGN','PENDING',$8)
         ON CONFLICT (subscription_id,term) DO NOTHING`,
        [
          attribution.partnerProfileId,
          payment.schoolId,
          payment.studentId,
          payment.subscriptionId,
          commissionRule.id,
          payment.sessionId,
          payment.subscriptionTerm,
          payment.payerUserId,
        ],
      );
    }
    await client.query(
      `UPDATE nfc_cards SET status='active'
        WHERE student_id=$1 AND school_id=$2 AND status='unassigned'`,
      [payment.studentId, payment.schoolId],
    );
    await client.query(
      `UPDATE student_subscription_payments
          SET status='PAID',provider_transaction_id=$1,provider_paid_at=$2,paid_at=COALESCE($2,NOW()),
              provider_fee_minor=$3,settlement_amount_minor=$4,
              settlement_status='PENDING',reconciliation_status='RECONCILED',
              failure_code=NULL,updated_at=NOW()
        WHERE id=$5`,
      [
        verified.providerTransactionId,
        verified.paidAt ? new Date(verified.paidAt) : null,
        verified.providerFeeMinor ?? null,
        verified.providerSettlementAmountMinor ?? null,
        paymentId,
      ],
    );
    const receiptDataResult = await client.query(
      `SELECT p.reference,p.paid_at AS "paidAt",p.gross_amount_minor AS "grossAmountMinor",p.currency,
              sc.name AS "schoolName",
              trim(concat_ws(' ',st.first_name,st.last_name)) AS "studentName",
              ses.name AS "sessionName",t.name AS "termName"
         FROM student_subscription_payments p
         JOIN schools sc ON sc.id=p.school_id
         JOIN students st ON st.id=p.student_id AND st.school_id=p.school_id
         JOIN academic_sessions ses ON ses.id=p.academic_session_id AND ses.school_id=p.school_id
         JOIN academic_terms t ON t.id=p.academic_term_id AND t.school_id=p.school_id
        WHERE p.id=$1`,
      [paymentId],
    );
    const logoResult = await client.query(
      `SELECT id FROM school_branding_logos
        WHERE school_id=$1 AND is_current=true
        ORDER BY id DESC LIMIT 1`,
      [payment.schoolId],
    );
    const receiptData = receiptDataResult.rows[0] ?? {};
    const logoId = logoResult.rows[0]?.id;
    const receiptSnapshot = {
      receiptNumber: `STUDENT-${payment.reference}`,
      paidAt: receiptData.paidAt ?? verified.paidAt ?? null,
      grossAmountMinor: Number(payment.grossAmountMinor),
      currency: String(payment.currency),
      schoolName: receiptData.schoolName ?? null,
      studentName: receiptData.studentName ?? null,
      sessionName: receiptData.sessionName ?? null,
      termName: receiptData.termName ?? payment.subscriptionTerm,
      allocations: allocations.map((allocation) => ({
        entryType: allocation.entryType,
        recipientType: allocation.recipientType,
        recipientId: allocation.recipientId,
        amountMinor: allocation.amountMinor,
        currency: "NGN",
      })),
      schoolLogoVersionUrl: logoId != null && canonicalLogoVersionUrl
        ? canonicalLogoVersionUrl(Number(payment.schoolId), Number(logoId))
        : null,
    };
    await client.query(
      `UPDATE student_subscription_payments
          SET receipt_snapshot=$1::jsonb,updated_at=NOW()
        WHERE id=$2 AND status='PAID'`,
      [JSON.stringify(receiptSnapshot), paymentId],
    );
    await client.query("COMMIT");
    return { status: "PAID", activated: true, reconciliationRequired: false, allocations };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markStudentPaymentForReconciliation(
  client: StudentSubscriptionSqlClient,
  paymentId: number,
  failureCode: string,
) {
  await client.query(
    `UPDATE student_subscription_payments AS p
        SET status=CASE WHEN p.status='FAILED' AND EXISTS (
              SELECT 1 FROM student_subscription_payments other
               WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                 AND other.academic_session_id=p.academic_session_id
                 AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                 AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                   OR other.reconciliation_status='RECONCILIATION_REQUIRED')
            ) THEN p.status ELSE 'RECONCILIATION_REQUIRED' END,
            reconciliation_status=CASE WHEN p.status='FAILED' AND EXISTS (
              SELECT 1 FROM student_subscription_payments other
               WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                 AND other.academic_session_id=p.academic_session_id
                 AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                 AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                   OR other.reconciliation_status='RECONCILIATION_REQUIRED')
            ) THEN p.reconciliation_status ELSE 'RECONCILIATION_REQUIRED' END,
            failure_code=$1,updated_at=NOW()
      WHERE p.id=$2`,
    [failureCode, paymentId],
  );
}