// Verified against deployment metadata: the custom domain is the primary URL.
export const CANONICAL_PUBLIC_ORIGIN = "https://educore.yetenia.com";

function publicOrigin(value: string): URL {
  let origin: URL;
  try { origin = new URL(value); }
  catch { throw new Error("Invalid public production invitation origin"); }
  const hostname = origin.hostname.toLowerCase().replace(/\.$/, "");
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash || origin.port ||
    ["replit.app", "replit.dev", "replit.com", "localhost"].some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)) ||
    hostname.endsWith(".local") || !hostname.includes(".") ||
    /^[\d.]+$/.test(hostname) || hostname.includes(":")
  ) throw new Error("Invalid public production invitation origin");
  return origin;
}

/**
 * Shared destination for public invitations, referrals and signup links.
 * Never infer the production origin from request headers or workspace hosts.
 * Development identity links must stay on the Development Clerk environment.
 */
export function canonicalPublicUrl(
  path: string,
  environment = process.env.NODE_ENV,
  developmentDomain = process.env.REPLIT_DEV_DOMAIN,
  productionOrigin = process.env.PUBLIC_APP_URL ?? CANONICAL_PUBLIC_ORIGIN,
): string {
  if (!/^\/(?:accept-invitation|school\/register|sign-up|sign-in)(?:\?|$)/.test(path) ||
      path.includes("#") || path.includes("\\")) {
    throw new Error("Invalid public onboarding path");
  }
  if (environment !== "development") return new URL(path, publicOrigin(productionOrigin)).toString();
  const domain = developmentDomain?.trim();
  if (!domain || !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+replit\.dev$/i.test(domain)) {
    throw new Error("The development invitation host is not configured");
  }
  const origin = new URL(`https://${domain}`);
  if (origin.hostname !== domain.toLowerCase() || origin.port || origin.username || origin.password) {
    throw new Error("Invalid development invitation host");
  }
  return new URL(path, origin).toString();
}
