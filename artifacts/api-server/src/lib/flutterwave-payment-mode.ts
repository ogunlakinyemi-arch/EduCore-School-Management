/**
 * The only payment-mode selector. Missing configuration safely defaults to TEST;
 * malformed values are unavailable, never coerced or interpreted as LIVE.
 * Legacy enable/release/webhook flags do not select a payment mode.
 */
export function flutterwavePaymentMode(env: NodeJS.ProcessEnv = process.env): "TEST" | "LIVE" | null {
  const mode = env.EDUCORE_FLUTTERWAVE_MODE ?? "TEST";
  return mode === "TEST" || mode === "LIVE" ? mode : null;
}
