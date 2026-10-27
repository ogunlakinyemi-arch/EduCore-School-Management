import { describe, expect, it, vi } from "vitest";
import { flutterwavePaymentMode } from "./flutterwave-payment-mode";
import { flutterwaveLiveWebhookVerifier, flutterwaveTestWebhookVerifier } from "./flutterwave-live-config";
import { liveReleaseConfiguration, requireLiveRelease } from "./flutterwave-live-release";
import { onboardingConfiguration } from "./flutterwave-live-onboarding-gate";

// Fictional values only; no application DB, inherited credentials or transport.
const configured = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production", EDUCORE_FLUTTERWAVE_MODE: "LIVE",
  FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-fictional-live-secret",
  FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH: "fictional-dedicated-live-verifier",
  PUBLIC_APP_URL: "https://school.invalid",
  FLUTTERWAVE_LIVE_WEBHOOK_URL: "https://school.invalid/api/webhooks/flutterwave/live/student-subscription",
  EDUCORE_FLUTTERWAVE_RELEASE: "SCV3_V1",
  EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE: "fictional_merchant",
});

describe("single server-owned Flutterwave mode selector", () => {
  it("defaults safely to TEST; legacy switches and credential presence cannot select LIVE", () => {
    expect(flutterwavePaymentMode({})).toBe("TEST");
    expect(flutterwavePaymentMode({EDUCORE_FLUTTERWAVE_LIVE_ENABLED:"true",
      EDUCORE_FLUTTERWAVE_RELEASE:"SCV3_V1"})).toBe("TEST");
    expect(flutterwavePaymentMode(configured())).toBe("LIVE");
  });
  it.each(["live", "", "INVALID", " LIVE", "LIVE "])("fails closed for malformed mode %s", mode => {
    expect(flutterwavePaymentMode({EDUCORE_FLUTTERWAVE_MODE:mode})).toBeNull();
    expect(liveReleaseConfiguration({...configured(),EDUCORE_FLUTTERWAVE_MODE:mode}).ready).toBe(false);
  });
  it("needs no legacy enable or webhook-environment switch and no unrelated TEST credential", () => {
    expect(liveReleaseConfiguration(configured())).toMatchObject({ready:true,blockers:[]});
    expect(liveReleaseConfiguration({...configured(),EDUCORE_FLUTTERWAVE_LIVE_ENABLED:"false",
      EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"TEST"}).ready).toBe(true);
  });
  it("school onboarding also uses the selected mode and dedicated LIVE verifier, not the obsolete scope flag", () => {
    const blockers=onboardingConfiguration({...configured(),
      EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"TEST"}).blockers;
    expect(blockers).not.toContain("LIVE_WEBHOOK_BINDING_REQUIRED");
    expect(blockers).not.toContain("DISTINCT_TEST_WEBHOOK_BINDING_REQUIRED");
    // Onboarding permissions remain independent and are not granted by mode.
    expect(blockers).toContain("LIVE_ONBOARDING_ENABLEMENT_REQUIRED");
    expect(blockers).toContain("MERCHANT_KYC_APPROVAL_REQUIRED");
  });
  it("never consumes a generic webhook verifier as a LIVE secret", () => {
    const env = {...configured(),FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:undefined,
      FLUTTERWAVE_WEBHOOK_VERIF_HASH:"fictional-legacy-test-verifier"};
    expect(flutterwaveLiveWebhookVerifier(env)).toBeUndefined();
    expect(liveReleaseConfiguration(env).blockers).toContain("FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH");
  });
  it("rejects dedicated and legacy TEST reuse of the LIVE verifier", () => {
    const live = configured();
    expect(flutterwaveTestWebhookVerifier({...live,EDUCORE_FLUTTERWAVE_MODE:"TEST",
      FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:live.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH})).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier({...live,EDUCORE_FLUTTERWAVE_MODE:"TEST",
      FLUTTERWAVE_WEBHOOK_VERIF_HASH:live.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH})).toBeUndefined();
  });
  it.each([
    undefined,
    "https://school.invalid/api/webhooks/flutterwave/student-subscription",
    "https://other.invalid/api/webhooks/flutterwave/live/student-subscription",
    "http://school.invalid/api/webhooks/flutterwave/live/student-subscription",
    "https://school.invalid/api/webhooks/flutterwave/live/student-subscription?token=wrong",
  ])("blocks unconfirmed/wrong dashboard registration %s before DB access", async url => {
    const pool = {connect:vi.fn()};
    const env = {...configured(),FLUTTERWAVE_LIVE_WEBHOOK_URL:url};
    expect(liveReleaseConfiguration(env).blockers).toContain("FLUTTERWAVE_LIVE_WEBHOOK_URL");
    await expect(requireLiveRelease(pool as any,env)).rejects.toHaveProperty("code","LIVE_RELEASE_CONFIGURATION_BLOCKED");
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each(["https://example.replit.dev","http://school.invalid","https://school.invalid/?token=wrong"])(
    "rejects noncanonical production origin %s", origin => {
      expect(liveReleaseConfiguration({...configured(),PUBLIC_APP_URL:origin}).blockers).toContain("PUBLIC_APP_URL");
    },
  );
});
