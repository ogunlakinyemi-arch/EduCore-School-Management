import { describe, expect, it, vi } from "vitest";
import { assertLiveOnboardingTransition, mutateLiveOnboarding } from "./flutterwave-live-onboarding-mutations";

const row = {
  id: 1, environment: "LIVE", merchant_scope: "fixture_merchant", school_id: 10, profile_id: 10,
  snapshot_sha256: "a".repeat(64), snapshot_ciphertext: "fixture_ciphertext",
  encryption_key_version: "fixture-v1", bank_fingerprint: "fixture_fingerprint",
  account_last4: "0002", submitted_by: 2, created_at: new Date("2026-01-01T00:00:00Z"),
  last_actor_id: 2, status: "BANK_VERIFIED", creation_claimed_at: null as Date | null,
  approved_by: null as number | null, approval_evidence: null as object | null,
  provider_id: null as string | null, provider_subaccount_id: null as string | null,
};
const claim = { ...row, status: "CREATING", creation_claimed_at: new Date("2026-01-02T00:00:00Z"),
  approved_by: 1, approval_evidence: { ownershipConfirmed: true, note: "fixture" } };

describe("application onboarding history policy (independent of triggers)", () => {
  it.each([
    "UPDATE flutterwave_live_school_onboarding SET status='BANK_VERIFIED' WHERE id=$1",
    "DELETE FROM flutterwave_live_school_onboarding WHERE id=$1 RETURNING *",
    "UPDATE flutterwave_live_school_onboarding_audits SET actor_id=9 RETURNING *",
    "UPDATE flutterwave_live_school_onboarding SET status='BANK_VERIFIED' RETURNING *; DELETE FROM app_users",
  ])("rejects unsafe internal SQL shape before any query: %s", async sql => {
    const query=vi.fn();
    await expect(mutateLiveOnboarding({query},{transaction:"own",merchantScope:"fixture_merchant",
      id:1,sql,values:[1]})).rejects.toMatchObject({code:"LIVE_ONBOARDING_MUTATION_SHAPE_INVALID"});
    expect(query).not.toHaveBeenCalled();
  });
  it("allows only a fresh unclaimed SUBMITTED insert", () => {
    expect(() => assertLiveOnboardingTransition(null, { ...row, status: "SUBMITTED" })).not.toThrow();
    expect(() => assertLiveOnboardingTransition(null, row)).toThrow();
    expect(() => assertLiveOnboardingTransition(null, claim)).toThrow();
  });
  it.each(["id", "environment", "merchant_scope", "school_id", "profile_id", "snapshot_sha256",
    "snapshot_ciphertext", "encryption_key_version", "bank_fingerprint", "account_last4",
    "submitted_by", "created_at"])("rejects mutation of frozen %s", field => {
    expect(() => assertLiveOnboardingTransition(row, { ...row, [field]: "changed" })).toThrow();
  });
  it("permits the initial permanent claim with approval but never a reset", () => {
    expect(() => assertLiveOnboardingTransition(row, claim)).not.toThrow();
    expect(() => assertLiveOnboardingTransition(claim, { ...claim, creation_claimed_at: null })).toThrow();
    expect(() => assertLiveOnboardingTransition(claim, { ...claim, approved_by: 2 })).toThrow();
    expect(() => assertLiveOnboardingTransition(claim, { ...claim, approval_evidence: {} })).toThrow();
    // JSON object property order is not an identity change.
    expect(() => assertLiveOnboardingTransition(claim, {
      ...claim, approval_evidence: { note: "fixture", ownershipConfirmed: true },
    })).not.toThrow();
  });
  it.each(["SUBMITTED", "BANK_VERIFIED", "ACTION_REQUIRED", "REJECTED", "STALE"])(
    "an uncertain provider claim cannot transition back to %s", status => {
      expect(() => assertLiveOnboardingTransition({ ...claim, status: "CREATION_UNKNOWN" },
        { ...claim, status })).toThrow();
    });
  it.each(["LIVE_VERIFIED", "REJECTED", "STALE"])("keeps terminal %s irreversible", status => {
    const before = { ...claim, status, provider_id: "701", provider_subaccount_id: "RS_fixture12345678" };
    expect(() => assertLiveOnboardingTransition(before, { ...before, status: "BANK_VERIFIED" })).toThrow();
    expect(() => assertLiveOnboardingTransition(before, { ...before, last_actor_id: 1 })).not.toThrow();
  });
  it("preserves each non-null provider identity", () => {
    const before = { ...claim, provider_id: "701", provider_subaccount_id: "RS_fixture12345678" };
    expect(() => assertLiveOnboardingTransition(before, { ...before, provider_id: "702" })).toThrow();
    expect(() => assertLiveOnboardingTransition(before, { ...before, provider_subaccount_id: null })).toThrow();
    expect(() => assertLiveOnboardingTransition(claim, { ...before, status: "LIVE_VERIFIED" })).not.toThrow();
  });
  it("requires approval on a claim and provider identity on a verified row", () => {
    expect(() => assertLiveOnboardingTransition(row, { ...claim, approved_by: null })).toThrow();
    expect(() => assertLiveOnboardingTransition(row, { ...claim, approval_evidence: null })).toThrow();
    expect(() => assertLiveOnboardingTransition(claim, { ...claim, status: "LIVE_VERIFIED" })).toThrow();
  });
});
