// Canonical public deployment origin, verified with Replit deployment metadata.
// Keep this explicit: request headers and workspace domains must never select
// the destination of an invitation issued by the production Clerk instance.
export const PUBLIC_PRODUCTION_ORIGIN =
  "https://edu-pulse-school-management--ogunlakinyemi.replit.app";

function publicProductionOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Invalid public production invitation origin");
  }
  const hostname = origin.hostname.toLowerCase().replace(/\.$/, "");
  if (
    origin.protocol !== "https:" ||
    origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash || origin.port ||
    hostname === "replit.dev" || hostname.endsWith(".replit.dev") ||
    hostname === "replit.com" || hostname.endsWith(".replit.com") ||
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || !hostname.includes(".") ||
    /^[\d.]+$/.test(hostname) || hostname.includes(":")
  ) {
    throw new Error("Invalid public production invitation origin");
  }
  return origin;
}

/**
 * Production invitations always return to the explicit public application.
 * Development invitations remain scoped to the development Clerk environment.
 * No incoming Host, Origin, or forwarded header is used here.
 */
export function invitationRedirect(
  path: string,
  environment = process.env.NODE_ENV,
  developmentDomain = process.env.REPLIT_DEV_DOMAIN,
  productionOrigin = PUBLIC_PRODUCTION_ORIGIN,
): string {
  if (!/^\/accept-invitation(?:\?|$)/.test(path)) {
    throw new Error("Invalid invitation acceptance path");
  }
  if (environment !== "development") {
    return new URL(path, publicProductionOrigin(productionOrigin)).toString();
  }

  const domain = developmentDomain?.trim();
  if (!domain || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    throw new Error("The development invitation host is not configured");
  }
  const origin = new URL(`https://${domain}`);
  if (origin.hostname !== domain.toLowerCase()) {
    throw new Error("Invalid development invitation host");
  }
  return new URL(path, origin).toString();
}