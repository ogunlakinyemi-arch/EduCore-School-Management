/** Pure, credential-free model metadata. Keep configuration-only release checks
 * independent of authorization, application DB and provider implementation imports. */
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
