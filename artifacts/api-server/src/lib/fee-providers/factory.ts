import {
  FlutterwaveTestAdapter,
  PaystackTestAdapter,
  type PaymentProviderAdapter,
} from "./index";

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
  const secretKey = process.env.FLUTTERWAVE_TEST_SECRET_KEY;
  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_VERIF_HASH;
  if (!secretKey || !webhookSecret) return null;
  return new FlutterwaveTestAdapter({ secretKey, webhookSecret });
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