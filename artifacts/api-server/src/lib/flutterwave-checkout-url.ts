/**
 * Standard v3 returned the exact sandbox host below during a genuine TEST API
 * request. It is not covered by the documentation's canonical-host example.
 * Never allow arbitrary *.flutterwave domains or enable this host on deployment.
 */
export function isFlutterwaveTestCheckoutUrl(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname === "checkout.flutterwave.com") return true;
    return env.NODE_ENV === "development" && !env.REPLIT_DEPLOYMENT
      && url.hostname === "checkout-v2.dev-flutterwave.com"
      && /^\/v3\/hosted\/pay\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}
