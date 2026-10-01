import { afterEach, describe, expect, it, vi } from "vitest";
import { invitationRedirect, PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

describe("Clerk invitation return URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("supports one trusted PUBLIC_APP_URL setting without reading request origins", () => {
    vi.stubEnv("PUBLIC_APP_URL", PUBLIC_PRODUCTION_ORIGIN);
    expect(invitationRedirect("/accept-invitation?partnerInvitation=synthetic-context", "production", "private.riker.replit.dev"))
      .toBe(`${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation?partnerInvitation=synthetic-context`);
  });

  it("fails closed for a private PUBLIC_APP_URL instead of falling back silently", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://private.riker.replit.dev");
    expect(() => invitationRedirect("/accept-invitation", "production"))
      .toThrow("Invalid public production invitation origin");
    expect(invitationRedirect("/accept-invitation", "development", "sample.replit.dev"))
      .toBe("https://sample.replit.dev/accept-invitation");
  });

  it("uses the explicit development host for test invitations", () => {
    expect(invitationRedirect("/accept-invitation", "development", "sample.replit.dev"))
      .toBe("https://sample.replit.dev/accept-invitation");
    expect(invitationRedirect("/accept-invitation?partnerInvitation=opaque", "development", "sample.replit.dev"))
      .toBe("https://sample.replit.dev/accept-invitation?partnerInvitation=opaque");
  });

  it("fails closed when the development host is absent or malformed", () => {
    expect(() => invitationRedirect("/accept-invitation", "development", "")).toThrow();
    expect(() => invitationRedirect("/accept-invitation", "development", "attacker.test/redirect")).toThrow();
    expect(() => invitationRedirect("//attacker.test", "development", "sample.replit.dev")).toThrow();
  });

  it.each([
    "attacker.test",
    "attacker.replit.dev.evil.test",
    "replit.dev",
    "replit.com",
    "attacker.replit.com",
    "attacker..replit.dev",
    "-attacker.replit.dev",
    "attacker-.replit.dev",
    "attacker.replit.dev.",
    "attacker.replit.dev:443",
    "attacker@replit.dev",
    "attacker.replit.dev/accept-invitation",
    "127.0.0.1",
    "localhost",
    "[::1]",
  ])("rejects an untrusted REPLIT_DEV_DOMAIN (%s)", (domain) => {
    expect(() => invitationRedirect("/accept-invitation", "development", domain)).toThrow();
  });

  it("accepts an explicitly configured Replit development domain without changing Production isolation", () => {
    const dev = invitationRedirect("/accept-invitation", "development", "trusted-workspace.replit.dev");
    expect(dev).toBe("https://trusted-workspace.replit.dev/accept-invitation");
    const production = invitationRedirect(
      "/accept-invitation",
      "production",
      "trusted-workspace.replit.dev",
    );
    expect(production).toBe(`${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`);
  });

  it("uses the verified public deployment for production invitations", () => {
    expect(invitationRedirect("/accept-invitation", "production", undefined))
      .toBe(`${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`);
  });

  it("preserves synthetic partner context and ignores development domains in production", () => {
    const path = "/accept-invitation?partnerInvitation=synthetic%2Bcontext%2Fonly";
    const result = invitationRedirect(path, "production", "private.riker.replit.dev");
    expect(result).toBe(`${PUBLIC_PRODUCTION_ORIGIN}${path}`);
    expect(new URL(result).searchParams.get("partnerInvitation"))
      .toBe("synthetic+context/only");
    expect(result).not.toMatch(/replit\.dev|silent-auth|__replshield/);
  });

  it("does not infer production origins from request-like environment headers", () => {
    expect(invitationRedirect("/accept-invitation", "production", "attacker.example"))
      .toBe(`${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`);
    expect(invitationRedirect("/accept-invitation", "test", "private.replit.dev"))
      .toBe(`${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`);
  });

  it.each([
    "",
    "http://school.example.org",
    "https://private.riker.replit.dev",
    "https://private.replit.dev.",
    "https://replit.dev",
    "https://replit.com",
    "https://replit.com/silent-auth",
    "https://school.example.org/__replshield",
    "https://school.example.org?redirect=private",
    "https://school.example.org#private",
    "https://user:password@school.example.org",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
  ])("fails closed for an invalid production origin (%s)", (origin) => {
    expect(() => invitationRedirect("/accept-invitation", "production", undefined, origin))
      .toThrow("Invalid public production invitation origin");
  });

  it.each([
    "//attacker.example/accept-invitation",
    "https://attacker.example/accept-invitation",
    "/__replshield",
    "/accept-invitation/other",
    "/accept-invitation#other",
  ])("rejects a noncanonical acceptance path (%s)", (path) => {
    expect(() => invitationRedirect(path, "production")).toThrow();
  });
});