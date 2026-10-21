import { describe, expect, it } from "vitest";
import {
  confirmedLiveSplitModel, confirmedLiveSplitPreview, liveSplitAuthorityDigest,
  verifyLiveSplitAuthority, type LiveSplitAuthorityEvidence,
} from "./flutterwave-live-split-authority";
import { flutterwaveLiveStatus } from "./flutterwave-live-config";

const authority = (): LiveSplitAuthorityEvidence => ({
  version: 1, provider: "FLUTTERWAVE", environment: "LIVE", merchantScope: "fictional_merchant",
  schoolId: 10, schoolSubaccountId: "RS_FictionalSchool123",
  dashboardFeeBearer: "MERCHANT", dashboardFeeBearerEvidenceSha256: "a".repeat(64),
  liveSubaccountVerified: true, schoolOwnershipVerified: true,
  schoolOwnershipEvidenceSha256: "b".repeat(64),
});
const review = () => ({
  merchantScope: "fictional_merchant", schoolId: 10, schoolSubaccountId: "RS_FictionalSchool123",
  evidenceSha256: liveSplitAuthorityDigest(authority()),
});

describe("written support model and hash-bound LIVE account review; no network or database", () => {
  it("builds exactly the fixed single-school allocation and never a Partner or ratio field", () => {
    expect(confirmedLiveSplitPreview(verifyLiveSplitAuthority(authority(), review()))).toEqual({
      amount: 5000, currency: "NGN",
      subaccounts: [{ id: "RS_FictionalSchool123", transaction_charge_type: "flat_subaccount", transaction_charge: 1900 }],
    });
    expect(confirmedLiveSplitModel).toMatchObject({
      feeBearer: "MERCHANT", eligiblePartnerAmount: 100,
      partnerPayment: "INTERNAL_TERM_END_OWNER_APPROVAL_EXPORT", transactionSplitRatio: "OMITTED",
    });
  });
  it.each([
    ["dashboardFeeBearer", "CUSTOMER"], ["dashboardFeeBearer", "SUBACCOUNT"], ["dashboardFeeBearer", undefined],
    ["environment", "TEST"], ["liveSubaccountVerified", false], ["schoolOwnershipVerified", false],
    ["schoolSubaccountId", "RS_bad"], ["schoolOwnershipEvidenceSha256", ""],
    ["dashboardFeeBearerEvidenceSha256", ""], ["transaction_split_ratio", 1],
    ["partnerSubaccountId", "RS_FictionalPartner123"], ["amount", 5001], ["schoolAmount", 1901], ["version", 0],
  ])("rejects unreviewable or caller-supplied allocation evidence: %s = %s", (field, value) => {
    expect(() => verifyLiveSplitAuthority({ ...authority(), [field as string]: value }, review()))
      .toThrow(expect.objectContaining({ code: "LIVE_SPLIT_AUTHORITY_EVIDENCE_INVALID" }));
  });
  it("refuses missing evidence and support-only evidence", () => {
    for (const value of [undefined, {}, { supportConfirmation: confirmedLiveSplitModel.supportConfirmation }])
      expect(() => verifyLiveSplitAuthority(value, review())).toThrow();
  });
  it.each([
    { merchantScope: "another_merchant" }, { schoolId: 20 }, { schoolSubaccountId: "RS_AnotherSchool1234" },
  ])("binds the reviewed merchant, school and recipient: %o", change => {
    expect(() => verifyLiveSplitAuthority({ ...authority(), ...change }, review()))
      .toThrow(expect.objectContaining({ code: "LIVE_SPLIT_AUTHORITY_SCOPE_MISMATCH" }));
  });
  it("rejects substituted dashboard or ownership evidence even when all attestations say true", () => {
    for (const field of ["dashboardFeeBearerEvidenceSha256", "schoolOwnershipEvidenceSha256"])
      expect(() => verifyLiveSplitAuthority({ ...authority(), [field]: "c".repeat(64) }, review()))
        .toThrow(expect.objectContaining({ code: "LIVE_SPLIT_AUTHORITY_HASH_MISMATCH" }));
  });
  it("canonicalizes property ordering without accepting extra fields", () => {
    const reversed = Object.fromEntries(Object.entries(authority()).reverse());
    expect(liveSplitAuthorityDigest(reversed)).toBe(liveSplitAuthorityDigest(authority()));
  });
  it("does not turn provider confirmation or account evidence into runtime activation", () => {
    verifyLiveSplitAuthority(authority(), review());
    const status = flutterwaveLiveStatus({
      NODE_ENV: "production", EDUCORE_FLUTTERWAVE_MODE: "LIVE", EDUCORE_FLUTTERWAVE_LIVE_ENABLED: "true",
      EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT: "LIVE",
      FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-fictional-live-credential",
      FLUTTERWAVE_WEBHOOK_VERIF_HASH: "fictional-live-verifier-123",
      FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH: "fictional-test-verifier-456",
    });
    expect(status).toMatchObject({
      configurationReady: true,
      checkoutEnabled: false, providerTransportEnabled: false,
      confirmedSplitModel: confirmedLiveSplitModel,
      releaseChecks: {
        dashboardFeeBearer: "REQUIRES_REVIEWED_MERCHANT_EVIDENCE",
        schoolLiveIdentityAndOwnership: "REQUIRES_REVIEWED_LIVE_EVIDENCE",
        applicationMigrations: "REQUIRES_TARGET_VERIFICATION_AND_EXPLICIT_APPROVAL",
        workflow: "HARD_DISABLED", independentVerificationTransport: "HARD_DISABLED",
        durableWebhookFinalization: "NOT_RELEASED_RECEIPT_ONLY_503",
      },
    });
  });
});
