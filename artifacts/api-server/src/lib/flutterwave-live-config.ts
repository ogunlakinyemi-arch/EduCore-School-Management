import { confirmedLiveSplitModel } from "./flutterwave-live-model";
import { flutterwavePaymentMode } from "./flutterwave-payment-mode";

/** Server-only configuration. Never return credentials or infer dashboard settings.
 * configurationReady describes credential/runtime wiring ONLY, never activation.
 */
export function flutterwaveLiveStatus(env: NodeJS.ProcessEnv = process.env) {
  const enabled = flutterwavePaymentMode(env) === "LIVE";
  const modeMatches = enabled;
  const runtimeMatches = env.NODE_ENV === "production";
  const secret = env.FLUTTERWAVE_LIVE_SECRET_KEY;
  const credentialConfigured = !!secret;
  const credentialValid = typeof secret === "string"
    && /^FLWSECK-(?!TEST-)[A-Za-z0-9_-]{8,}$/.test(secret);
  const hash = flutterwaveLiveWebhookVerifier(env);
  const webhookConfigured = typeof hash === "string" && hash.trim().length >= 16 && hash === hash.trim();
  const webhookEnvironmentMatches = modeMatches;
  const webhookSeparated = !env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH
    || env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH !== hash;
  const configurationReady = enabled && modeMatches && runtimeMatches && credentialValid
    && webhookConfigured && webhookEnvironmentMatches && webhookSeparated;
  return {
    mode: "LIVE" as const, enabled, modeMatches, runtimeMatches,
    credentialConfigured, credentialValid, webhookConfigured, webhookEnvironmentMatches,
    webhookSeparated, configurationReady,
    runtimeImplementation: "SCV3_V1_DEFAULT_DISABLED" as const,
    // Configuration alone is not DB release approval or per-school readiness.
    checkoutEnabled: false as const, providerTransportEnabled: false as const,
    confirmedSplitModel: confirmedLiveSplitModel,
    releaseChecks: {
      dashboardFeeBearer: "REQUIRES_REVIEWED_MERCHANT_EVIDENCE",
      schoolLiveIdentityAndOwnership: "REQUIRES_REVIEWED_LIVE_EVIDENCE",
      applicationMigrations: "REQUIRES_TARGET_VERIFICATION_AND_EXPLICIT_APPROVAL",
      workflow: "HARD_DISABLED",
      independentVerificationTransport: "HARD_DISABLED",
      durableWebhookFinalization: "NOT_RELEASED_RECEIPT_ONLY_503",
    } as const,
    readiness: "BLOCKED_PENDING_MERCHANT_EVIDENCE_AND_RELEASE_REVIEW" as const,
  };
}

/** LIVE exclusively uses its dedicated verifier. Never reinterpret a shared or
 * TEST verifier as LIVE, even when old webhook-environment flags say LIVE. */
export function flutterwaveLiveWebhookVerifier(env:NodeJS.ProcessEnv=process.env):string|undefined {
  if(flutterwavePaymentMode(env)!=="LIVE")return undefined;
  const value=env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH;
  if(value!==undefined && value===env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH)return undefined;
  return typeof value==="string"&&value===value.trim()&&value.length>=16?value:undefined;
}

/** Dedicated TEST verifier, or legacy shared verifier only when not bound to LIVE. */
export function flutterwaveTestWebhookVerifier(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if(flutterwavePaymentMode(env)!=="TEST")return undefined;
  const dedicated = env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH;
  if (dedicated !== undefined) {
    if (dedicated.trim().length < 16 || dedicated !== dedicated.trim()) return undefined;
    if (dedicated === env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH) return undefined;
    return dedicated;
  }
  const legacy=env.FLUTTERWAVE_WEBHOOK_VERIF_HASH;
  if(legacy && legacy===env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH)return undefined;
  return legacy || undefined;
}
