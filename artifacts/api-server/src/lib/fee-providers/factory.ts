import {
  FlutterwaveTestAdapter,
  FlutterwaveLiveAdapter,
  PaymentProviderError,
  PaystackTestAdapter,
  type PaymentProviderAdapter,
} from "./index";
import { developmentFlutterwaveCredential } from "../flutterwave-development-config";
import { flutterwaveLiveStatus, flutterwaveTestWebhookVerifier } from "../flutterwave-live-config";

/** Never auto-select LIVE based on credentials, and never fall back to TEST. */
export function configuredLiveStudentSubscriptionAdapter(env: NodeJS.ProcessEnv = process.env) {
  if (!flutterwaveLiveStatus(env).configurationReady) return null;
  return new FlutterwaveLiveAdapter(env);
}

export type ConfigurableFeeProvider = "PAYSTACK" | "FLUTTERWAVE";

/**
 * Reads only test-mode server secrets. Missing configuration returns null;
 * constructor validation rejects live/malformed keys without exposing values.
 */
export function configuredTestAdapter(
  provider: ConfigurableFeeProvider,
  env: NodeJS.ProcessEnv = process.env,
): PaymentProviderAdapter | null {
  if (provider === "PAYSTACK") {
    const secretKey = env.PAYSTACK_TEST_SECRET_KEY;
    if (!secretKey) return null;
    return new PaystackTestAdapter({ secretKey });
  }
  if (env.EDUCORE_FLUTTERWAVE_MODE !== undefined && env.EDUCORE_FLUTTERWAVE_MODE !== "TEST") return null;
  if (env.NODE_ENV === "development" && !env.REPLIT_DEPLOYMENT) {
    const credential = developmentFlutterwaveCredential(env);
    if (credential.state === "INVALID" || credential.state === "CONFLICT") {
      throw new PaymentProviderError("Invalid dedicated Flutterwave TEST credential configuration");
    }
    if (!credential.secret) return null;
    return new FlutterwaveTestAdapter({
      secretKey: credential.secret,
      webhookSecret: flutterwaveTestWebhookVerifier(env),
    });
  }
  // The mixed-case alias remains Development-only; deployed TEST uses its explicit alias.
  const secretKey = env.FLUTTERWAVE_TEST_SECRET_KEY;
  if (!secretKey) return null;
  return new FlutterwaveTestAdapter({ secretKey, webhookSecret: flutterwaveTestWebhookVerifier(env) });
}

export function configuredCheckoutReturnUrl(): string | null {
  const value = process.env.FEE_PAYMENT_RETURN_URL;
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? value : null;
  } catch {
    return null;
  }
}

/**
 * NFC's newly supplied TEST credential is isolated to Development.
 * Never compare it with, or select, the generic potentially live credential.
 * Development invoice/staff adapters share the dedicated TEST-only selector.
 * Deployed configuration stays unchanged.
 */
export function configuredStudentNfcTestAdapter(): PaymentProviderAdapter | null {
  if (process.env.EDUCORE_FLUTTERWAVE_MODE !== undefined && process.env.EDUCORE_FLUTTERWAVE_MODE !== "TEST") return null;
  if (process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT) {
    const credential = developmentFlutterwaveCredential();
    if (credential.state === "CONFLICT") return null;
    if (credential.state === "INVALID") throw new Error("Invalid dedicated Flutterwave TEST credential configuration");
    if (credential.secret) return new FlutterwaveTestAdapter({
      secretKey: credential.secret,
      webhookSecret: flutterwaveTestWebhookVerifier(),
    });
  }
  return configuredTestAdapter("FLUTTERWAVE");
}