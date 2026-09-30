import { describe, expect, it } from "vitest";
import { invitationRedirect } from "./invitation-redirect";

describe("Clerk invitation return URL", () => {
  it("uses the public development host for every acceptance link", () => {
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

  it("does not alter production invitation routing", () => {
    expect(invitationRedirect("/accept-invitation", "production", undefined))
      .toBe("/accept-invitation");
  });
});