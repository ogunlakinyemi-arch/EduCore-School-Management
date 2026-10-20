import { flutterwaveTestWebhookVerifier } from "./flutterwave-live-config";

/** Dedicated TEST aliases only. Never use or compare a potentially live generic key. */
export function developmentFlutterwaveCredential(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT)
    return { state: "BLOCKED" as const, secret: null };
  return dedicatedFlutterwaveTestCredential(env);
}

export function dedicatedFlutterwaveTestCredential(env: NodeJS.ProcessEnv = process.env) {
  if (env.EDUCORE_FLUTTERWAVE_MODE !== undefined && env.EDUCORE_FLUTTERWAVE_MODE !== "TEST")
    return { state: "BLOCKED" as const, secret: null };
  const values = [env.FLUTTERWAVE_SECRET_Test_Key?.trim(), env.FLUTTERWAVE_TEST_SECRET_KEY?.trim()].filter(Boolean) as string[];
  if (!values.length) return { state: "MISSING" as const, secret: null };
  if (new Set(values).size !== 1) return { state: "CONFLICT" as const, secret: null };
  if (!/^FLWSECK_TEST-[A-Za-z0-9_-]{8,}$/.test(values[0]))
    return { state: "INVALID" as const, secret: null };
  return { state: "CONFIGURED" as const, secret: values[0] };
}

/** Safe projection: contains no keys, webhook values, bank data or provider claims. */
export function developmentFlutterwaveCollectionStatus(env: NodeJS.ProcessEnv = process.env) {
  const credential = developmentFlutterwaveCredential(env);
  const configured = credential.state === "CONFIGURED";
  const webhookConfigured = !!flutterwaveTestWebhookVerifier(env)?.trim();
  return {
    mode: configured ? "TEST" as const : "NOT_CONFIGURED" as const,
    credentialState: credential.state,
    credentialsConfigured: configured,
    webhookConfigured,
    checkoutConfigured: configured && !!env.REPLIT_DEV_DOMAIN && !!env.SESSION_SECRET,
    assistedCheckoutConfigured: configured && webhookConfigured && !!env.REPLIT_DEV_DOMAIN && !!env.SESSION_SECRET,
    checkoutVerified: false as const,
    automaticSplitSettlementEnabled: false as const,
    automaticSplitSettlementVerified: false as const,
    subaccountIntegration: env.NODE_ENV === "development" && !env.REPLIT_DEPLOYMENT
      ? "DEVELOPMENT_TEST_ONBOARDING" as const : "NOT_IMPLEMENTED" as const,
    bankAccountVerificationConfigured: configured,
  };
}
