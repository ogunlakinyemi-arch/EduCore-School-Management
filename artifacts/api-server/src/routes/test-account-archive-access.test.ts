import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  partnerId: 3,
  archives: [] as any[],
  providerUser: vi.fn(),
  providerInvitation: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("test-account-access-archive-ledger")) return { rows: state.archives.map(metadata => ({ metadata })) };
      if (sql.includes("role='PLATFORM_OWNER'") || sql.includes("SELECT 1 WHERE")) return { rows: [] };
      if (sql.includes("FROM partner_referral_links")) return {
        rows: [{ id: 12, partnerId: state.partnerId, status: "ACTIVE", partnerStatus: "ACTIVE", partnerCode: "fictional-partner" }],
      };
      throw new Error("Unexpected query in archive denial test");
    }),
    connect: vi.fn(() => { throw new Error("Archive denial must precede any write transaction"); }),
  },
}));
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  clerkClient: { users: { getUser: state.providerUser },
    invitations: { createInvitation: state.providerInvitation } },
}));

import { createSchoolInvitation, activateAcceptedSchoolInvitation } from "./school-invitations";
import { publicPartnersRouter } from "./partners";

async function validateReferral() {
  const layer = (publicPartnersRouter as any).stack.find((entry: any) => entry.route?.path === "/partner/referrals/validate");
  const json = vi.fn();
  await layer.route.stack[0].handle({ body: { referralToken: "fictional".repeat(8) } },
    { json }, (error: unknown) => { throw error; });
  return json.mock.calls[0][0];
}

beforeEach(() => {
  state.partnerId = 3;
  state.archives = [{ version: 1, batchId: "a".repeat(64), operation: "BLOCK",
    schoolIds: [9], partnerIds: [3], userIds: [2], emails: ["test@fictional.invalid"] }];
  state.providerUser.mockClear(); state.providerInvitation.mockClear();
});

describe("archived school invitation and partner-link re-entry", () => {
  it("refuses invitations to an archived school before any provider call or write", async () => {
    await expect(createSchoolInvitation({
      schoolId: 9, email: "new@fictional.invalid", fullName: "Fictional User", phone: null, role: "TEACHER",
    }, {} as any)).rejects.toMatchObject({ statusCode: 403, eventType: "ARCHIVED_TEST_ACCESS_BLOCKED" });
    expect(state.providerInvitation).not.toHaveBeenCalled();
  });
  it("refuses an old accepted invitation for a blocked account before fetching provider metadata", async () => {
    await expect(activateAcceptedSchoolInvitation(2, "fictional-subject")).rejects.toMatchObject({
      statusCode: 403, eventType: "ARCHIVED_TEST_ACCESS_BLOCKED",
    });
    expect(state.providerUser).not.toHaveBeenCalled();
  });
  it("makes an otherwise ACTIVE archived Partner referral invalid without exposing the partner", async () => {
    expect(await validateReferral()).toEqual({ valid: false, status: "INVALID", partnerCode: null, referralLinkId: null });
  });
  it("keeps an unrelated real Partner referral usable", async () => {
    state.partnerId = 4;
    expect((await validateReferral()).valid).toBe(true);
  });
});
