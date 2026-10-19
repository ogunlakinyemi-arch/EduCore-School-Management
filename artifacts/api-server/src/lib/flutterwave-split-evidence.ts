import { ngnMinor } from "./flutterwave-split-policy";
import { studentAllocationPolicy } from "./student-allocation-policy";

export type ExpectedTransactionSplit = {
  transactionId: string; reference: string; currency: string;
  grossAmountMinor: number; platformGrossMinor: number;
  recipients: { subaccountId: string; amountMinor: number }[];
};
export type ReportedTransactionSplit = {
  // INTERNAL normalized comparison input, not a Flutterwave response schema.
  // No supported production adapter currently constructs a complete split set.
  recipients: { subaccountId: string; amountMinor: number }[];
  completeRecipientSet: boolean;
};

/** Only independently read provider amounts belong here, never checkout instructions/meta. */
export function compareTransactionSplits(
  expected: ExpectedTransactionSplit,
  transaction: Record<string, unknown>,
  reported: ReportedTransactionSplit | null,
) {
  const base = {
    status: "UNCONFIRMED" as "UNCONFIRMED" | "MISMATCH" | "CONFIRMED",
    evidenceLevel: "UNAVAILABLE" as "UNAVAILABLE" | "PARTIAL" | "MISMATCH" | "COMPLETE_VERIFIED",
    reason: "Reliable complete transaction-level split details are unavailable",
    bankSettlementVerified: false as const,
    platformGrossMinor: expected.platformGrossMinor,
    platformNetMinor: null as number | null,
    appFeeMinor: null as number | null,
    additionalFeeMinor: null as number | null,
    recipients: expected.recipients.map(r => ({
      ...r, observedAmountMinor: reported?.recipients.find(a => a.subaccountId === r.subaccountId)?.amountMinor ?? null,
    })),
  };
  const mismatch = (reason: string) => ({ ...base, status: "MISMATCH" as const, evidenceLevel: "MISMATCH" as const, reason });
  const policy = studentAllocationPolicy(expected.reference);
  // Deferred Partner entitlement is not a checkout recipient or a reduction in
  // merchant settlement. Historical references keep their original allocation.
  const expectedMerchantGross = 500000 - policy.schoolMinor
    - (!policy.deferredPartner && expected.recipients.length === 2 ? 10000 : 0);
  if (new Set(expected.recipients.map(r => r.subaccountId)).size !== expected.recipients.length
      || !(policy.deferredPartner ? [1] : [1,2]).includes(expected.recipients.length)
      || expected.recipients.some(r => !/^RS_[A-Za-z0-9]{12,80}$/.test(r.subaccountId))
      || expected.recipients[0]?.amountMinor !== policy.schoolMinor
      || (expected.recipients.length === 2 && expected.recipients[1].amountMinor !== 10000)
      || expected.platformGrossMinor !== expectedMerchantGross
      || expected.grossAmountMinor !== 500000 || expected.currency !== "NGN"
      || expected.recipients.reduce((sum, r) => sum + r.amountMinor, expected.platformGrossMinor) !== 500000) {
    return mismatch("Frozen expected plan is inconsistent");
  }
  if (transaction.id == null || transaction.tx_ref == null || transaction.currency == null || transaction.status == null) {
    return { ...base, reason: "Independent provider transaction identity fields are unavailable" };
  }
  if (String(transaction.id) !== expected.transactionId || transaction.tx_ref !== expected.reference
      || transaction.currency !== expected.currency || transaction.status !== "successful") {
    return mismatch("Provider transaction identity, reference, currency or successful status differs");
  }
  if (transaction.amount == null) return { ...base, reason: "Provider transaction amount is unavailable" };
  try {
    if (ngnMinor(transaction.amount) !== expected.grossAmountMinor
        || (transaction.charged_amount != null && ngnMinor(transaction.charged_amount) !== expected.grossAmountMinor)) {
      return mismatch("Provider amount or payer charge differs from NGN 5000");
    }
    base.evidenceLevel = "PARTIAL";
    if (transaction.charged_amount == null || transaction.app_fee == null || transaction.merchant_fee == null) {
      return { ...base, reason: "Exact payer charge and separate provider fee components are required" };
    }
    base.appFeeMinor = ngnMinor(transaction.app_fee);
    base.additionalFeeMinor = ngnMinor(transaction.merchant_fee);
    base.platformNetMinor = expected.platformGrossMinor - base.appFeeMinor - base.additionalFeeMinor;
    if (base.platformNetMinor < 0) return mismatch("Reported provider expenses exceed the platform gross share");
  } catch {
    return { ...base, reason: "Provider monetary fields are missing or invalid" };
  }
  if (!reported) return base;
  const ids = reported.recipients.map(r => r.subaccountId);
  if (new Set(ids).size !== ids.length || reported.recipients.some(r =>
    !Number.isSafeInteger(r.amountMinor) || r.amountMinor < 0
    || !expected.recipients.some(e => e.subaccountId === r.subaccountId && e.amountMinor === r.amountMinor))) {
    return mismatch("Provider recipient identities or allocated amounts differ from the frozen plan");
  }
  if (!reported.completeRecipientSet) return {
    ...base, reason: "Observed recipient amounts are partial evidence; a complete provider split set is not established",
  };
  if (reported.recipients.length !== expected.recipients.length) return mismatch("Provider recipient set differs");
  return {
    ...base, status: "CONFIRMED" as const, evidenceLevel: "COMPLETE_VERIFIED" as const,
    reason: "Complete provider-reported transaction allocation matches; this is not bank settlement",
  };
}

/**
 * Current supported v3 verify contract is COLLECTION ONLY.
 * Deliberately does not read subaccounts, meta, allocations, completeness flags,
 * or settlement lines from the provider payload. See the evidence-contract doc.
 */
export function compareVerificationResponse(expected: ExpectedTransactionSplit, transaction: Record<string, unknown>) {
  const result = compareTransactionSplits(expected, transaction, null);
  return result.status === "UNCONFIRMED" && result.evidenceLevel === "PARTIAL"
    ? { ...result, reason: `${result.reason}. Transaction verification does not establish recipient allocation; obtain a Flutterwave-issued transaction-linked complete split report.` }
    : result;
}
