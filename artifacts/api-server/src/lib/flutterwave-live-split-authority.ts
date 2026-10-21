import { createHash } from "node:crypto";
import { z } from "zod";
import { fixedSplitInstructions } from "./flutterwave-split-policy";
import { LiveFinalizationBlocked } from "./flutterwave-live-verification";

/** Support confirms the model, NOT a merchant's current dashboard or recipients.
 * Evidence is a reviewed document commitment, never a credential or release flag.
 * No raw bank data, emails, keys or arbitrary provider payloads belong here.
 */
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const authoritySchema = z.object({
  version: z.literal(1),
  provider: z.literal("FLUTTERWAVE"),
  environment: z.literal("LIVE"),
  merchantScope: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  schoolId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  schoolSubaccountId: z.string().regex(/^RS_[A-Za-z0-9]{12,80}$/),
  dashboardFeeBearer: z.literal("MERCHANT"),
  dashboardFeeBearerEvidenceSha256: digest,
  liveSubaccountVerified: z.literal(true),
  schoolOwnershipVerified: z.literal(true),
  schoolOwnershipEvidenceSha256: digest,
}).strict();
export type LiveSplitAuthorityEvidence = z.infer<typeof authoritySchema>;

export const confirmedLiveSplitModel = Object.freeze({
  supportConfirmation: "USER_WRITTEN_FIXED_SUBACCOUNT_MERCHANT" as const,
  currency: "NGN" as const,
  amount: 5000 as const,
  schoolAmount: 1900 as const,
  transactionChargeType: "flat_subaccount" as const,
  transactionSplitRatio: "OMITTED" as const,
  feeBearer: "MERCHANT" as const,
  eligiblePartnerAmount: 100 as const,
  partnerPayment: "INTERNAL_TERM_END_OWNER_APPROVAL_EXPORT" as const,
});

function parseAuthority(value: unknown): LiveSplitAuthorityEvidence {
  const result = authoritySchema.safeParse(value);
  if (!result.success) throw new LiveFinalizationBlocked("LIVE_SPLIT_AUTHORITY_EVIDENCE_INVALID");
  return result.data;
}

/** Canonical field order comes from the strict schema, not input JSON ordering. */
export function liveSplitAuthorityDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(parseAuthority(value))).digest("hex");
}

export function verifyLiveSplitAuthority(value: unknown, review: {
  merchantScope: string; schoolId: number; schoolSubaccountId: string; evidenceSha256: string;
}) {
  const evidence = parseAuthority(value);
  if (evidence.merchantScope !== review.merchantScope || evidence.schoolId !== review.schoolId
      || evidence.schoolSubaccountId !== review.schoolSubaccountId)
    throw new LiveFinalizationBlocked("LIVE_SPLIT_AUTHORITY_SCOPE_MISMATCH");
  if (liveSplitAuthorityDigest(evidence) !== review.evidenceSha256)
    throw new LiveFinalizationBlocked("LIVE_SPLIT_AUTHORITY_HASH_MISMATCH");
  return evidence;
}

/** Allocation preview only. This cannot initialize a checkout or release a gate.
 * Amounts and recipients are server-owned; never spread caller/provider objects.
 */
export function confirmedLiveSplitPreview(evidence: LiveSplitAuthorityEvidence) {
  const authority = parseAuthority(evidence);
  return {
    amount: confirmedLiveSplitModel.amount,
    currency: confirmedLiveSplitModel.currency,
    subaccounts: fixedSplitInstructions(authority.schoolSubaccountId, null, 3),
  };
}
