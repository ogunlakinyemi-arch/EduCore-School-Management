import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const state = vi.hoisted(() => ({
  context: {
    user: {
      id: 8,
      clerkUserId: "user_owner",
      email: "owner@example.test",
      firstName: "Platform",
      lastName: "Owner",
      status: "ACTIVE",
    },
    roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
  },
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getUser: vi.fn(),
}));

const db = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: db }));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: {
      createInvitation: state.createInvitation,
      revokeInvitation: state.revokeInvitation,
    },
    users: { getUser: state.getUser },
  },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserContext: () => state.context,
    assertRoles: () => state.context,
  };
});

import partnersRouter, { publicPartnersRouter } from "./partners";

const app = express();
app.use(express.json());
app.use(partnersRouter);
app.use(publicPartnersRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const authError = error as { statusCode?: number; message?: string };
  res.status(authError.statusCode ?? 500).json({ error: authError.message ?? String(error) });
});

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));

beforeEach(() => {
  vi.clearAllMocks();
  state.queries.length = 0;
  state.context = {
    user: {
      id: 8, clerkUserId: "user_owner", email: "owner@example.test",
      firstName: "Platform", lastName: "Owner", status: "ACTIVE",
    },
    roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
  };
  db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("SELECT 1 FROM partner_invitations WHERE id=$1")) return { rows: [{ "?column?": 1 }] };
    if (sql.includes("FROM partner_profiles p")) {
      return { rows: [{ id: 4, status: "ACTIVE", isOwner: true, partnerRole: "PARTNER_OWNER" }] };
    }
    return { rows: [] };
  });
  db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("INSERT INTO partner_profiles")) {
      return { rows: [{ id: 4, partnerCode: "PENDING-123", email: "partner@example.test", status: "INVITED" }] };
    }
    if (sql.includes("INSERT INTO partner_invitations")) {
      return { rows: [{ id: 9, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
    }
    if (sql.includes("SELECT i.id,i.partner_profile_id")) {
      return { rows: [{
        id: 9,
        partner_profile_id: 4,
        invited_email: "partner@example.test",
        expires_at: new Date(Date.now() + 7 * 86400000),
        partnerStatus: "INVITED",
      }] };
    }
    if (sql.includes("UPDATE partner_profiles SET user_id=$1")) return { rows: [{ id: 4 }] };
    if (sql.includes("RETURNING id")) return { rows: [{ id: 9 }] };
    return { rows: [] };
  });
  db.connect.mockResolvedValue({ query: db.clientQuery, release: db.release });
  state.createInvitation.mockResolvedValue({
    id: "clerk_invitation_1",
    createdAt: Date.now(),
    status: "pending",
  });
  state.revokeInvitation.mockResolvedValue({});
  state.getUser.mockResolvedValue({
    primaryEmailAddress: {
      emailAddress: "partner@example.test",
      verification: { status: "verified" },
    },
  });
});

async function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Partner invitation dispatch and activation", () => {
  it("reports Clerk request acceptance without claiming inbox delivery or exposing the local token URL", async () => {
    const response = await post("/platform/partners/invitations", {
      email: "Partner@Example.Test",
      fullName: "Partner User",
    });
    expect(response.status).toBe(201);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "PENDING",
      invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
    });
    expect(result.invitationUrl).toBeUndefined();
    expect(result.invitationEmailSent).toBeUndefined();
    const request = state.createInvitation.mock.calls[0][0];
    expect(request).toEqual(expect.objectContaining({
      emailAddress: "partner@example.test",
      notify: true,
      ignoreExisting: false,
    }));
    const redirectUrl = request.redirectUrl as string;
    expect(redirectUrl).toMatch(/^\/accept-invitation\?partnerInvitation=[A-Za-z0-9_-]{43}$/);
    const opaqueToken = new URL(redirectUrl, "https://example.test").searchParams.get("partnerInvitation")!;
    expect(JSON.stringify(result)).not.toContain(opaqueToken);
    expect(JSON.stringify(state.queries)).not.toContain(opaqueToken);
  });

  it("binds partner acceptance to the verified invited email and grants only partner roles", async () => {
    const token = "a".repeat(48);
    state.context = {
      user: {
        id: 21, clerkUserId: "user_partner", email: "partner@example.test",
        firstName: "Partner", lastName: "User", status: "ACTIVE",
      },
      roles: [],
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: "partner@example.test",
        verification: { status: "verified" },
      },
    });
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT i.id,i.partner_profile_id")) {
        return { rows: [{
          id: 9, partner_profile_id: 4, invited_email: "partner@example.test",
          expires_at: new Date(Date.now() + 7 * 86400000), partnerStatus: "INVITED",
        }] };
      }
      if (sql.includes("UPDATE partner_profiles SET user_id=$1")) return { rows: [{ id: 4 }] };
      if (sql.includes("INSERT INTO partner_profile_users")) return { rows: [] };
      if (sql.includes("INSERT INTO school_memberships")) return { rows: [] };
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles p")) {
        return { rows: [{ id: 4, status: "ACTIVE", userId: 21 }] };
      }
      return { rows: [] };
    });

    const response = await post(`/partner/invitations/${token}/accept`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ACTIVE",
      role: "PARTNER_OWNER",
      redirectTo: "/partner",
    });
    expect(state.getUser).toHaveBeenCalledWith("user_partner");
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO school_memberships") &&
      sql.includes("VALUES($1,NULL,'PARTNER','ACTIVE')"))).toBe(true);
    expect(state.queries.some(({ values }) => values.includes("PLATFORM_OWNER"))).toBe(false);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("UPDATE partner_profiles SET user_id=$1") && values[0] === 21)).toBe(true);
    expect(db.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE i.token_hash=$1"),
      [createHash("sha256").update(token).digest("hex")],
    );
  });

  it("rejects acceptance from an unverified Clerk email", async () => {
    const token = "b".repeat(48);
    state.context = {
      user: {
        id: 21, clerkUserId: "user_partner", email: "partner@example.test",
        firstName: "Partner", lastName: "User", status: "ACTIVE",
      },
      roles: [],
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: "partner@example.test",
        verification: { status: "unverified" },
      },
    });
    const response = await post(`/partner/invitations/${token}/accept`, {});
    expect(response.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO school_memberships"))).toBe(false);
  });

  it("resends a pending owner invitation by revoking its previous token and known Clerk invite", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    const response = await post("/platform/partners/4/invitations/resend", {});
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      partnerId: 4,
      email: "partner@example.test",
      status: "PENDING",
      invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
    });
    expect(body.invitationUrl).toBeUndefined();
    expect(body.emailSent).toBeUndefined();
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old");
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") && (values[0] as number[]).includes(9))).toBe(true);
    expect(state.createInvitation.mock.calls[0][0].redirectUrl).toMatch(
      /^\/accept-invitation\?partnerInvitation=[A-Za-z0-9_-]{43}$/,
    );
  });

  it("leaves the old Clerk invitation intact on create failure, then commits replacement before revocation", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockRejectedValueOnce(new Error("provider unavailable"));
    const failed = await post("/platform/partners/4/invitations/resend", {});
    expect(failed.status).toBe(503);
    expect(state.revokeInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);

    state.queries.length = 0;
    state.createInvitation.mockResolvedValueOnce({ id: "clerk_new" });
    state.revokeInvitation.mockImplementationOnce(async (id: string) => {
      state.queries.push({ sql: "MOCK_REVOKE", values: [id] });
      throw new Error("provider revoke unavailable");
    });
    const recovered = await post("/platform/partners/4/invitations/resend", {});
    expect(recovered.status).toBe(503);
    expect(await recovered.json()).toMatchObject({
      code: "INVITATION_RECOVERY_REQUIRED",
      error: expect.stringContaining("replacement is committed"),
    });
    const commitIndex = state.queries.findIndex(({ sql }) => sql === "COMMIT");
    const revokeIndex = state.queries.findIndex(({ sql }) => sql === "MOCK_REVOKE");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(commitIndex);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") &&
      Array.isArray(values[0]) && (values[0] as number[]).includes(9))).toBe(true);
  });

  it("lists invitation lifecycle states through the Platform Owner directory endpoint", async () => {
    const response = await fetch(`${baseUrl}/platform/partners/invitations?status=PENDING`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM partner_invitations i"),
      ["PENDING"],
    );
    expect(db.query.mock.calls[0][0]).toContain("EXISTS (");
    expect(db.query.mock.calls[0][0]).toContain("p.status='ACTIVE'");
  });

  it("commits a staff replacement and invalidates its old local token before Clerk revocation", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
        return { rows: [{ id: 9, partnerId: 4, email: "staff@example.test", status: "ACTIVE" }] };
      }
      if (sql.includes("metadata->>'permission'")) return { rows: [{ permission: "FINANCE" }] };
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_staff_old" }] };
      }
      if (sql.includes("SELECT 1 FROM partner_profile_users")) return { rows: [] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockResolvedValueOnce({ id: "clerk_staff_new" });
    state.revokeInvitation.mockImplementationOnce(async (id: string) => {
      state.queries.push({ sql: "MOCK_REVOKE", values: [id] });
      throw new Error("provider revoke unavailable");
    });
    const response = await post("/partner/staff-invitations/9/resend", {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "INVITATION_RECOVERY_REQUIRED",
      error: expect.stringContaining("replacement is committed"),
    });
    const commitIndex = state.queries.findIndex(({ sql }) => sql === "COMMIT");
    const revokeIndex = state.queries.findIndex(({ sql }) => sql === "MOCK_REVOKE");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(commitIndex);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") &&
      Array.isArray(values[0]) && (values[0] as number[]).includes(9))).toBe(true);
    const creationAudit = state.queries.find(({ sql }) =>
      sql.includes("INSERT INTO audit_logs") && String(sql).includes("VALUES"));
    expect(creationAudit?.values.at(-1)).toMatchObject({ clerkInvitationId: "clerk_staff_new" });
  });

  it("accepts the canonical query-token API route while retaining the legacy path", async () => {
    const token = "c".repeat(48);
    state.context = {
      user: { id: 21, clerkUserId: "user_partner", email: "partner@example.test",
        firstName: "Partner", lastName: "User", status: "ACTIVE" },
      roles: [],
    };
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT i.id,i.partner_profile_id")) return { rows: [{
        id: 10, partner_profile_id: 4, invited_email: "partner@example.test",
        expires_at: new Date(Date.now() + 7 * 86400000), partnerStatus: "INVITED",
      }] };
      if (sql.includes("UPDATE partner_profiles SET user_id=$1")) return { rows: [{ id: 4 }] };
      return { rows: [] };
    });
    const response = await post("/partner/invitations/accept", { partnerInvitation: token });
    expect(response.status).toBe(200);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("WHERE i.token_hash=$1") &&
      values[0] === createHash("sha256").update(token).digest("hex"))).toBe(true);
  });

  it("keeps partner staff permission and does not claim confirmed email delivery", async () => {
    const response = await post("/partner/staff-invitations", {
      email: "staff@example.test",
      permission: "FINANCE",
    });
    expect(response.status).toBe(201);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      email: "staff@example.test",
      role: "PARTNER_FINANCE",
      permission: "FINANCE",
      status: "PENDING",
      invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
    });
    expect(result.invitationUrl).toBeUndefined();
    expect(result.emailSent).toBeUndefined();
    expect(state.createInvitation.mock.calls[0][0].redirectUrl).toMatch(
      /^\/accept-invitation\?partnerInvitation=[A-Za-z0-9_-]{43}$/,
    );
  });

  it("recovers the requested staff role from the invitation audit claim for opaque tokens", async () => {
    const token = "d".repeat(48);
    state.context = {
      user: { id: 22, clerkUserId: "user_staff", email: "staff@example.test",
        firstName: "Staff", lastName: "Member", status: "ACTIVE" },
      roles: [],
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: "staff@example.test",
        verification: { status: "verified" },
      },
    });
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT i.id,i.partner_profile_id")) return { rows: [{
        id: 12, partner_profile_id: 4, invited_email: "staff@example.test",
        expires_at: new Date(Date.now() + 7 * 86400000), partnerStatus: "ACTIVE",
      }] };
      if (sql.includes("metadata->>'permission'")) return { rows: [{ permission: "FINANCE" }] };
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles p")) {
        return { rows: [{ id: 4, status: "ACTIVE" }] };
      }
      return { rows: [] };
    });
    const response = await post("/partner/invitations/accept", { partnerInvitation: token });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "PARTNER_FINANCE" });
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO partner_profile_users") && values[2] === "PARTNER_FINANCE")).toBe(true);
  });

  it("creates a referral School Admin invitation with the canonical redirect and activation claim audit", async () => {
    const priorSessionSecret = process.env.SESSION_SECRET;
    const priorClerkSecret = process.env.CLERK_SECRET_KEY;
    process.env.SESSION_SECRET = "test-session-secret-for-partner-referrals";
    process.env.CLERK_SECRET_KEY = "test-clerk-secret-for-partner-referrals";
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT l.id,l.partner_profile_id")) {
        return { rows: [{ id: 7, partner_profile_id: 4 }] };
      }
      if (sql.includes("SELECT id FROM schools")) return { rows: [] };
      if (sql.includes("INSERT INTO schools")) {
        return { rows: [{ id: 33, code: "REF-SCHOOL", name: "Referral School", status: "active" }] };
      }
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT 1 FROM schools WHERE id=$1")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    try {
      const response = await post("/partner/onboarding", {
        referralToken: "r".repeat(48),
        school: { code: "REF-SCHOOL", name: "Referral School", city: "Lagos", state: "Lagos" },
        administrator: { fullName: "School Administrator", email: "admin@example.test" },
      });
      expect(response.status).toBe(201);
      const clerkRequest = state.createInvitation.mock.calls[0][0];
      expect(clerkRequest.redirectUrl).toBe("/accept-invitation");
      const claim = clerkRequest.publicMetadata.edupulseSchoolInvitation;
      expect(claim).toMatchObject({ schoolId: 33, role: "SCHOOL_ADMIN", emailProof: expect.any(String) });
      const audit = state.queries.find(({ sql }) => sql.includes("'SCHOOL_ADMIN_INVITED'"));
      expect(audit).toBeDefined();
      expect(audit!.sql).toContain("'claimId'");
      expect(audit!.sql).toContain("'invitedEmail'");
      expect(audit!.sql).toContain("'schoolId'");
      expect(audit!.values).toEqual(expect.arrayContaining([33, claim.claimId, "admin@example.test", "clerk_invitation_1"]));
    } finally {
      if (priorSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = priorSessionSecret;
      if (priorClerkSecret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = priorClerkSecret;
    }
  });
});