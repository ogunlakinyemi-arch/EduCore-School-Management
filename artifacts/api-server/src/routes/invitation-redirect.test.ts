import { describe, expect, it } from "vitest";
import { invitationRedirect, PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

describe("Clerk invitation return URL", () => {
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