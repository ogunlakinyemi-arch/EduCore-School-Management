import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { acceptedInvitationFromMetadata } from "./school-invitations";

const originalClerkSecret = process.env.CLERK_SECRET_KEY;
const testSecret = "school-invitation-test-secret";
const invitedEmail = "admin@example.test";

function invitationMetadata(overrides: Record<string, unknown> = {}) {
  const emailProof = createHmac("sha256", testSecret)
    .update(invitedEmail)
    .digest("hex");
  return {
    edupulseSchoolInvitation: {
      version: 1,
      claimId: "2fc287e7-9a7a-4db7-8962-61caa939d44a",
      emailProof,
      schoolId: 123,
      role: "SCHOOL_ADMIN",
      employeeNo: null,
      firstName: "Ada",
      lastName: "Okafor",
      ...overrides,
    },
  };
}

describe("partner-created School Administrator invitation claims", () => {
  afterEach(() => {
    if (originalClerkSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = originalClerkSecret;
  });

  it("accepts a Clerk claim for its verified email and carries the requested administrator name", () => {
    process.env.CLERK_SECRET_KEY = testSecret;
    expect(acceptedInvitationFromMetadata(invitationMetadata(), invitedEmail)).toEqual({
      claimId: "2fc287e7-9a7a-4db7-8962-61caa939d44a",
      emailProof: createHmac("sha256", testSecret).update(invitedEmail).digest("hex"),
      schoolId: 123,
      role: "SCHOOL_ADMIN",
      employeeNo: null,
      firstName: "Ada",
      lastName: "Okafor",
    });
  });

  it("rejects a claim when the invitation email does not match the accepted Clerk account", () => {
    process.env.CLERK_SECRET_KEY = testSecret;
    expect(() =>
      acceptedInvitationFromMetadata(invitationMetadata(), "someone-else@example.test"),
    ).toThrow("does not match the authenticated account");
  });

  it("rejects malformed name metadata instead of accepting an incomplete claim", () => {
    process.env.CLERK_SECRET_KEY = testSecret;
    expect(() =>
      acceptedInvitationFromMetadata(invitationMetadata({ firstName: 42 }), invitedEmail),
    ).toThrow("does not match the authenticated account");
  });

  it("continues to accept older school invitation claims without optional name fields", () => {
    process.env.CLERK_SECRET_KEY = testSecret;
    const legacy = invitationMetadata();
    const marker = legacy.edupulseSchoolInvitation as Record<string, unknown>;
    delete marker.firstName;
    delete marker.lastName;
    expect(acceptedInvitationFromMetadata(legacy, invitedEmail)).toMatchObject({
      role: "SCHOOL_ADMIN",
      firstName: null,
      lastName: null,
    });
  });
});