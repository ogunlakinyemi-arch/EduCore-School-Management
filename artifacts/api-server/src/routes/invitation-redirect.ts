/**
 * Clerk accepts a relative redirect path, but a development invitation must
 * unambiguously return to this application's public preview host. Keep the
 * existing production behavior until production routing is explicitly changed.
 */
export function invitationRedirect(
  path: string,
  environment = process.env.NODE_ENV,
  developmentDomain = process.env.REPLIT_DEV_DOMAIN,
): string {
  if (!/^\/accept-invitation(?:\?|$)/.test(path)) {
    throw new Error("Invalid invitation acceptance path");
  }
  if (environment !== "development") return path;

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