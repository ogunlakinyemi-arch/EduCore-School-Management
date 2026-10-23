import { canonicalPublicUrl, CANONICAL_PUBLIC_ORIGIN } from "../lib/canonical-public-url";
export { CANONICAL_PUBLIC_ORIGIN } from "../lib/canonical-public-url";

// Legacy payment-return compatibility ONLY. Do not use for invitations.
// Payment code imports this existing constant; changing its default destination
// is outside this correction's authorization.
export const PUBLIC_PRODUCTION_ORIGIN =
  "https://edu-pulse-school-management--ogunlakinyemi.replit.app";

/**
 * Production invitations always return to the explicit public application.
 * Development invitations remain scoped to the development Clerk environment.
 * No incoming Host, Origin, or forwarded header is used here.
 */
export function invitationRedirect(
  path: string,
  environment = process.env.NODE_ENV,
  developmentDomain = process.env.REPLIT_DEV_DOMAIN,
  productionOrigin = process.env.PUBLIC_APP_URL ?? CANONICAL_PUBLIC_ORIGIN,
): string {
  if (!/^\/accept-invitation(?:\?|$)/.test(path)) {
    throw new Error("Invalid invitation acceptance path");
  }
  return canonicalPublicUrl(path, environment, developmentDomain, productionOrigin);
}