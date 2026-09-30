import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

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
    roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null as number | null, status: "ACTIVE" }],
  },
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  createInvitation: vi.fn(),
  listInvitations: vi.fn(),
  getUserList: vi.fn(),
  revokeInvitation: vi.fn(),
  getUser: vi.fn(),
  resendLockHeld: false,
  partnerIsOwner: true,
  partnerRole: "PARTNER_OWNER",
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
      getInvitationList: state.listInvitations,
      revokeInvitation: state.revokeInvitation,
    },
    users: { getUser: state.getUser, getUserList: state.getUserList },
  },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserContext: () => state.context,
    assertRoles: (_req: express.Request, roles: string[]) => {
      if (!state.context.roles.some(({ role }) => roles.includes(role))) {
        throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }
      return state.context;
    },
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
  state.resendLockHeld = false;
  state.partnerIsOwner = true;
  state.partnerRole = "PARTNER_OWNER";
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
      return { rows: [{
        id: 4, status: "ACTIVE", isOwner: state.partnerIsOwner, partnerRole: state.partnerRole,
      }] };
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
  db.connect.mockImplementation(async () => ({
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("pg_try_advisory_lock")) {
        state.queries.push({ sql, values });
        if (state.resendLockHeld) return { rows: [{ locked: false }] };
        state.resendLockHeld = true;
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("pg_advisory_unlock")) {
        state.queries.push({ sql, values });
        state.resendLockHeld = false;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return db.clientQuery(sql, values);
    },
    release: db.release,
  }));
  state.createInvitation.mockResolvedValue({
    id: "clerk_invitation_1",
    createdAt: Date.now(),
    status: "pending",
  });
  state.listInvitations.mockResolvedValue({ data: [], totalCount: 0 });
  state.getUserList.mockResolvedValue({ data: [] });
  state.revokeInvitation.mockResolvedValue({});
  state.getUser.mockResolvedValue({
    primaryEmailAddress: {
      emailAddress: "partner@example.test",
      verification: { status: "verified" },
    },
  });
});

function expectPublicPartnerInvitationUrl(value: string, context: "partner" | "school-admin" | "either" = "partner") {
  const url = new URL(value);
  expect(url.origin).toBe(PUBLIC_PRODUCTION_ORIGIN);
  expect(url.pathname).toBe("/accept-invitation");
  if (context === "partner") {
    expect(url.search).toMatch(/^\?partnerInvitation=[A-Za-z0-9_-]{43}$/);
  } else if (context === "school-admin") {
    expect(url.search).toBe("");
  } else {
    expect(url.search === "" || /^\?partnerInvitation=[A-Za-z0-9_-]{43}$/.test(url.search)).toBe(true);
  }
  for (const prohibited of [
    "riker.replit.dev", ".replit.dev", "replit.com/silent-auth",
    "__replshield", "privateDevDomain=true", "__clerk_ticket",
  ]) {
    expect(value).not.toContain(prohibited);
  }
}

afterEach(() => {
  for (const [request] of state.createInvitation.mock.calls) {
    expectPublicPartnerInvitationUrl(String(request.redirectUrl), "either");
  }
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
    expectPublicPartnerInvitationUrl(redirectUrl);
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

  it("rejects a verified Clerk email that differs from the partner invitation and session", async () => {
    const token = "f".repeat(48);
    state.context = {
      user: {
        id: 21, clerkUserId: "user_partner", email: "partner@example.test",
        firstName: "Partner", lastName: "User", status: "ACTIVE",
      },
      roles: [],
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: "attacker@example.test",
        verification: { status: "verified" },
      },
    });
    const response = await post(`/partner/invitations/${token}/accept`, {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Invitation email does not match authenticated user",
    });
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_profile_users"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO school_memberships"))).toBe(false);
  });

  it("resends a pending owner invitation by revoking its previous token and known Clerk invite", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("status='DISPATCHING' FOR UPDATE")) return { rows: [{ id: 10 }] };
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
    expectPublicPartnerInvitationUrl(state.createInvitation.mock.calls[0][0].redirectUrl);
    expect(state.createInvitation.mock.calls[0][0].ignoreExisting).toBe(true);
    expect(state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation)
      .toMatchObject({ attemptId: expect.any(String), partnerInvitationId: 10 });
  });

  it("does not use ignoreExisting when a Clerk account already exists for the partner email", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      return { rows: [] };
    });
    state.getUserList.mockResolvedValueOnce({ data: [{
      emailAddresses: [{ emailAddress: "Partner@Example.Test" }],
    }] });

    const response = await post("/platform/partners/4/invitations/resend", {});
    expect(response.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_invitations"))).toBe(false);
    expect(state.getUserList).toHaveBeenCalledWith({
      emailAddress: ["partner@example.test"], limit: 100,
    });
  });

  it("serializes concurrent resend while Clerk is pending and keeps the old invitation usable", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      if (sql.includes("status='DISPATCHING' FOR UPDATE")) return { rows: [{ id: 10 }] };
      return { rows: [] };
    });
    let resolveProvider!: (invitation: { id: string }) => void;
    state.createInvitation.mockImplementationOnce(() => new Promise((resolve) => {
      resolveProvider = resolve;
    }));

    const firstRequest = post("/platform/partners/4/invitations/resend", {});
    await vi.waitFor(() => expect(state.createInvitation).toHaveBeenCalledTimes(1));
    const concurrent = await post("/platform/partners/4/invitations/resend", {});
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toMatchObject({ code: "INVITATION_DISPATCH_IN_PROGRESS" });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_invitations SET status='ACTIVE'"))).toBe(false);
    expect(state.resendLockHeld).toBe(true);

    resolveProvider({ id: "clerk_new" });
    const completed = await firstRequest;
    expect(completed.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.resendLockHeld).toBe(false);
    expectPublicPartnerInvitationUrl(state.createInvitation.mock.calls[0][0].redirectUrl);
  });

  it("treats a fresh orphaned DISPATCHING attempt as in flight rather than absent", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{ id: 10, status: "DISPATCHING", createdAt: new Date(), expiresAt: new Date() }] };
      }
      if (sql.includes("created_at>NOW()-INTERVAL '5 minutes'")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });

    const response = await post("/platform/partners/4/invitations/resend", {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "INVITATION_DISPATCH_IN_PROGRESS" });
    expect(state.queries.some(({ sql }) =>
      sql.includes("created_at>NOW()-INTERVAL '5 minutes'"))).toBe(true);
    expect(state.listInvitations).not.toHaveBeenCalled();
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("SET status='FAILED'"))).toBe(false);
  });

  it("persists an unknown provider attempt, retains the old invitation, and blocks duplicate provider calls", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", createdAt: new Date(), expiresAt: new Date() }] : [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        expect(sql).toContain("ORDER BY timestamp DESC");
        expect(sql).not.toContain("ORDER BY created_at");
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
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
    expect(await failed.json()).toMatchObject({ code: "INVITATION_RECOVERY_REQUIRED" });
    expect(state.queries.some(({ sql }) => sql === "COMMIT")).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO partner_invitations") &&
      sql.includes("'DISPATCHING'") && typeof values[2] === "string" &&
      values[2] === createHash("sha256").update(String(state.createInvitation.mock.calls[0][0].redirectUrl)
        .split("partnerInvitation=")[1]).digest("hex"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))).toBe(true);
    expect(state.revokeInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    state.listInvitations.mockRejectedValueOnce(new Error("Clerk list temporarily unavailable"));
    const retry = await post("/platform/partners/4/invitations/resend", {});
    expect(retry.status).toBe(503);
    expect(await retry.json()).toMatchObject({ code: "INVITATION_RECOVERY_REQUIRED" });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.listInvitations).toHaveBeenCalledTimes(1);
    const rawToken = new URL(String(state.createInvitation.mock.calls[0][0].redirectUrl),
      "https://example.test").searchParams.get("partnerInvitation")!;
    expect(JSON.stringify(state.queries)).not.toContain(rawToken);
    expect(JSON.stringify(state.queries)).not.toContain("test-secret");
    expect(JSON.stringify(state.queries)).not.toContain("clerk_sk_");
  });

  it("reconciles a previously accepted Clerk request by exact attempt metadata without sending again", async () => {
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT id FROM partner_invitations") && sql.includes("status IN ('ACTIVE','REVOKED')")) {
        return { rows: [{ id: 9 }] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      return { rows: [] };
    });
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", createdAt: new Date(), expiresAt: new Date() }] : [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE') FOR UPDATE")) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockRejectedValueOnce(new Error("provider accepted but response was lost"));
    const uncertain = await post("/platform/partners/4/invitations/resend", {});
    expect(uncertain.status).toBe(503);
    const attemptId = state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation.attemptId;
    state.listInvitations.mockResolvedValueOnce({ data: [{
      id: "clerk_reconciled",
      emailAddress: "partner@example.test",
      status: "pending",
      revoked: false,
      publicMetadata: { edupulsePartnerInvitation: { attemptId, partnerInvitationId: 10 } },
    }], totalCount: 1 });

    const recovered = await post("/platform/partners/4/invitations/resend", {});
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({
      id: 10, invitationDispatchStatus: "REQUEST_ACCEPTED", status: "PENDING",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.listInvitations).toHaveBeenCalledWith({
      query: "partner@example.test", status: "pending", limit: 100, offset: 0,
    });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='ACTIVE'"))).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO audit_logs") && values[4] === "Recovered partner invitation resend" &&
      (values.at(-1) as any)?.recoveryStatus === "RECONCILED_FROM_CLERK_METADATA")).toBe(true);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old");
  });

  it("marks a definitively revoked Clerk attempt retryable without superseding the old invitation", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        const failed = state.queries.some(({ sql: seen }) => seen.includes("SET status='FAILED'"));
        return { rows: !failed && state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", createdAt: new Date(), expiresAt: new Date() }] : [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        expect(sql).toContain("ORDER BY timestamp DESC");
        expect(sql).not.toContain("ORDER BY created_at");
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
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
    state.createInvitation.mockRejectedValueOnce(new Error("provider response unavailable"));
    const ambiguous = await post("/platform/partners/4/invitations/resend", {});
    expect(ambiguous.status).toBe(503);
    const marker = state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation;
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) => ({
      data: status === "revoked" ? [{
        id: "clerk_revoked_attempt",
        emailAddress: "partner@example.test",
        status: "revoked",
        revoked: true,
        publicMetadata: { edupulsePartnerInvitation: marker },
      }] : [],
      totalCount: status === "revoked" ? 1 : 0,
    }));

    const resolved = await post("/platform/partners/4/invitations/resend", {});
    expect(resolved.status).toBe(409);
    expect(await resolved.json()).toMatchObject({ code: "INVITATION_PROVIDER_ABSENT" });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='FAILED',revoked_at=NOW()"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.listInvitations.mock.calls.map(([params]) => params.status)).toEqual([
      "pending", "accepted", "revoked", "expired",
    ]);

    const safeRetry = await post("/platform/partners/4/invitations/resend", {});
    expect(safeRetry.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
  });

  it("does not conclude an attempt is absent until every invitation-list page is read", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", createdAt: new Date(), expiresAt: new Date() }] : [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockRejectedValueOnce(new Error("provider response unavailable"));
    expect((await post("/platform/partners/4/invitations/resend", {})).status).toBe(503);
    state.listInvitations.mockImplementation(async ({ status, offset }: { status: string; offset: number }) => ({
      data: status === "pending" && offset === 0 ? Array.from({ length: 100 }, (_, index) => ({
        id: `other-${index}`, emailAddress: "partner@example.test", status: "pending",
        publicMetadata: {},
      })) : status === "pending" && offset === 100 ? [{
        id: "other-last", emailAddress: "partner@example.test", status: "pending", publicMetadata: {},
      }] : [],
      totalCount: status === "pending" ? 101 : 0,
    }));

    const unresolved = await post("/platform/partners/4/invitations/resend", {});
    expect(unresolved.status).toBe(409);
    expect(await unresolved.json()).toMatchObject({ code: "INVITATION_PROVIDER_ABSENT" });
    expect(state.listInvitations.mock.calls.map(([params]) => params.offset)).toEqual([0, 100, 0, 0, 0]);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='FAILED',revoked_at=NOW()"))).toBe(true);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
  });

  it("records a definitive Clerk 429 separately and returns Retry-After while keeping the old invite usable", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("SET status='RATE_LIMITED'")) ? [{ retryAfterSeconds: 37 }] : [] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old" }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockRejectedValueOnce({ status: 429, headers: { get: () => "37" } });
    const response = await post("/platform/partners/4/invitations/resend", {});
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(await response.json()).toMatchObject({
      code: "INVITATION_PROVIDER_RATE_LIMITED", retryAfterSeconds: 37,
    });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='RATE_LIMITED'"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.revokeInvitation).not.toHaveBeenCalled();
    const retry = await post("/platform/partners/4/invitations/resend", {});
    expect(retry.status).toBe(429);
    expect(retry.headers.get("retry-after")).toBe("37");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
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

  it.each([
    ["STANDARD", "PARTNER_STAFF"],
    ["FINANCE", "PARTNER_FINANCE"],
    ["ADMIN", "PARTNER_ADMIN"],
  ])("keeps %s partner staff permission without claiming confirmed delivery", async (permission, role) => {
    const response = await post("/partner/staff-invitations", {
      email: "staff@example.test",
      permission,
    });
    expect(response.status).toBe(201);
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({
      email: "staff@example.test",
      role,
      permission,
      status: "PENDING",
      invitationDispatchStatus: "REQUEST_ACCEPTED",
      invitationDeliveryStatus: "UNVERIFIED",
    });
    expect(result.invitationUrl).toBeUndefined();
    expect(result.emailSent).toBeUndefined();
    expectPublicPartnerInvitationUrl(state.createInvitation.mock.calls[0][0].redirectUrl);
  });

  it.each([
    ["STANDARD", "PARTNER_STAFF"],
    ["FINANCE", "PARTNER_FINANCE"],
    ["ADMIN", "PARTNER_ADMIN"],
  ])("recovers the %s staff role from the opaque invitation audit claim", async (permission, role) => {
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
      if (sql.includes("metadata->>'permission'")) return { rows: [{ permission }] };
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
    expect(await response.json()).toMatchObject({ role });
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO partner_profile_users") && values[2] === role)).toBe(true);
  });

  it("rejects a staff invitation permission that attempts to grant an unrelated platform role", async () => {
    const token = "e".repeat(48);
    state.context = {
      user: { id: 23, clerkUserId: "user_staff", email: "staff@example.test",
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
      if (sql.includes("metadata->>'permission'")) return { rows: [{ permission: "PLATFORM_OWNER" }] };
      return { rows: [] };
    });

    const response = await post("/partner/invitations/accept", { partnerInvitation: token });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("cannot be verified") });
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_profile_users"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO school_memberships"))).toBe(false);
  });

  it("denies partner staff invitation creation by a non-owner partner role", async () => {
    state.partnerIsOwner = false;
    state.partnerRole = "PARTNER_STAFF";
    const response = await post("/partner/staff-invitations", {
      email: "staff@example.test",
      permission: "FINANCE",
    });
    expect(response.status).toBe(403);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_invitations"))).toBe(false);
  });

  it("denies Platform Owner partner invitation creation and resend to another role", async () => {
    state.context.roles = [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
    const created = await post("/platform/partners/invitations", {
      email: "new-partner@example.test", fullName: "New Partner",
    });
    const resent = await post("/platform/partners/4/invitations/resend", {});
    expect(created.status).toBe(403);
    expect(resent.status).toBe(403);
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects Partner-to-School-Admin onboarding for a revoked referral without dispatching", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT l.id,l.partner_profile_id")) return { rows: [] };
      return { rows: [] };
    });
    const response = await post("/partner/onboarding", {
      referralToken: "x".repeat(48),
      school: { code: "REJECTED-SCHOOL", name: "Rejected School", city: "Lagos", state: "Lagos" },
      administrator: { fullName: "School Administrator", email: "admin@example.test" },
    });
    expect(response.status).toBe(400);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO schools"))).toBe(false);
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
        return { rows: [{ id: 33, code: "REF-SCHOOL", name: "Referral School", status: "pending" }] };
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
      const schoolInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO schools"));
      expect(schoolInsert?.sql).toContain("VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')");
      expect(schoolInsert?.values).not.toContain("active");
      const result = await response.json() as { school: { status: string } };
      expect(result.school.status).toBe("pending");
      const clerkRequest = state.createInvitation.mock.calls[0][0];
      const redirectUrl = clerkRequest.redirectUrl as string;
      expectPublicPartnerInvitationUrl(redirectUrl, "school-admin");
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