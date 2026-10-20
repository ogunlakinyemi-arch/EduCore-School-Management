/** Server-only configuration. Never return credentials or infer dashboard settings. */
export function flutterwaveLiveStatus(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.EDUCORE_FLUTTERWAVE_LIVE_ENABLED === "true";
  const modeMatches = env.EDUCORE_FLUTTERWAVE_MODE === "LIVE";
  const runtimeMatches = env.NODE_ENV === "production";
  const secret = env.FLUTTERWAVE_LIVE_SECRET_KEY;
  const credentialConfigured = !!secret;
  const credentialValid = typeof secret === "string"
    && /^FLWSECK-(?!TEST-)[A-Za-z0-9_-]{8,}$/.test(secret);
  const hash = env.FLUTTERWAVE_WEBHOOK_VERIF_HASH;
  const webhookConfigured = typeof hash === "string" && hash.trim().length >= 16 && hash === hash.trim();
  const webhookEnvironmentMatches = env.EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT === "LIVE";
  const webhookSeparated = !env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH
    || env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH !== hash;
  const configurationReady = enabled && modeMatches && runtimeMatches && credentialValid
    && webhookConfigured && webhookEnvironmentMatches && webhookSeparated;
  return {
    mode: "LIVE" as const, enabled, modeMatches, runtimeMatches,
    credentialConfigured, credentialValid, webhookConfigured, webhookEnvironmentMatches,
    webhookSeparated, configurationReady,
    // No environment variable can substitute for the outstanding acceptance/release work.
    checkoutEnabled: false as const, providerTransportEnabled: false as const,
    readiness: "BLOCKED_PENDING_MERCHANT_EVIDENCE_AND_RELEASE_REVIEW" as const,
  };
}

/** Dedicated TEST verifier, or legacy shared verifier only when not bound to LIVE. */
export function flutterwaveTestWebhookVerifier(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const scope = env.EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT;
  if (scope !== undefined && scope !== "TEST" && scope !== "LIVE") return undefined;
  const dedicated = env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH;
  if (dedicated !== undefined) {
    if (dedicated.trim().length < 16 || dedicated !== dedicated.trim()) return undefined;
    if (scope === "LIVE" && dedicated === env.FLUTTERWAVE_WEBHOOK_VERIF_HASH) return undefined;
    return dedicated;
  }
  return scope === "LIVE" ? undefined : env.FLUTTERWAVE_WEBHOOK_VERIF_HASH || undefined;
}
