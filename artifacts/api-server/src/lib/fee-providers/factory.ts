import {
  FlutterwaveTestAdapter,
  PaystackTestAdapter,
  type PaymentProviderAdapter,
} from "./index";
import { developmentFlutterwaveCredential } from "../flutterwave-development-config";

export type ConfigurableFeeProvider = "PAYSTACK" | "FLUTTERWAVE";

/**
 * Reads only test-mode server secrets. Missing configuration returns null;
 * constructor validation rejects live/malformed keys without exposing values.
 */
export function configuredTestAdapter(
  provider: ConfigurableFeeProvider,
): PaymentProviderAdapter | null {
  if (provider === "PAYSTACK") {
    const secretKey = process.env.PAYSTACK_TEST_SECRET_KEY;
    if (!secretKey) return null;
    return new PaystackTestAdapter({ secretKey });
  }
  const legacyTestSecret = process.env.FLUTTERWAVE_TEST_SECRET_KEY;
  const configuredSecret = process.env.FLUTTERWAVE_SECRET_KEY;
  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_VERIF_HASH;
  const configuredSecrets = [legacyTestSecret, configuredSecret]
    .filter((value): value is string => Boolean(value));
  if (new Set(configuredSecrets).size > 1) return null;
  const secretKey = configuredSecrets[0];
  if (!secretKey) return null;
  return new FlutterwaveTestAdapter({ secretKey, webhookSecret: webhookSecret || undefined });
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
 * Existing invoice/staff adapters and deployed configuration stay unchanged.
 */
export function configuredStudentNfcTestAdapter(): PaymentProviderAdapter | null {
  if (process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT) {
    const credential = developmentFlutterwaveCredential();
    if (credential.state === "CONFLICT") return null;
    if (credential.state === "INVALID") throw new Error("Invalid dedicated Flutterwave TEST credential configuration");
    if (credential.secret) return new FlutterwaveTestAdapter({
      secretKey: credential.secret,
      webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_VERIF_HASH || undefined,
    });
  }
  return configuredTestAdapter("FLUTTERWAVE");
}