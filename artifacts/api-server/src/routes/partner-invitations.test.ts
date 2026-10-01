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
  selectedOwnerInvitation: true,
  selectedOwnerInvitationIds: [] as number[],
  selectedOwnerEmail: "partner@example.test",
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
import * as schoolInvitationService from "./school-invitations";

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
  state.selectedOwnerInvitation = true;
  state.selectedOwnerInvitationIds = [];
  state.selectedOwnerEmail = "partner@example.test";
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
    if (sql.includes("SELECT status FROM partner_profiles")) {
      return { rows: [{ status: "ACTIVE" }] };
    }
    if (sql.includes("a.metadata->>'attemptKind'=$6")) return { rows: [{ id: Number(values[0]) }] };
    if (sql.includes("FROM partner_invitations i") && sql.includes("a.action=ANY($4::text[])") &&
        sql.includes("lower(trim(a.metadata->>'invitedEmail'))=$3") &&
        sql.includes("upper(a.metadata->>'permission')=$5")) {
      return { rows: [{ id: Number(values[0]) }] };
    }
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
      if (sql.includes("pg_advisory_lock")) {
        state.queries.push({ sql, values });
        return { rows: [{ pg_advisory_lock: true }] };
      }
      if (sql.includes("pg_advisory_unlock")) {
        state.queries.push({ sql, values });
        state.resendLockHeld = false;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      if (sql.includes("FROM partner_invitations i") && sql.includes("a.action=ANY($4::text[])") &&
          sql.includes("lower(trim(a.metadata->>'invitedEmail'))=$3") &&
          sql.includes("i.status='ACTIVE'")) {
        state.queries.push({ sql, values });
        const id = Number(values[0]);
        const selected = state.selectedOwnerInvitationIds.length
          ? state.selectedOwnerInvitationIds.includes(id)
          : state.selectedOwnerInvitation;
        return { rows: selected
          ? [{ id, email: state.selectedOwnerEmail, status: "ACTIVE" }]
          : [] };
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

function partnerStaffFinalizationMock(sql: string, values: unknown[] = []) {
  if (sql.includes("SELECT status FROM partner_profiles")) {
    return { rows: [{ status: "ACTIVE" }] };
  }
  if (sql.includes("a.metadata->>'attemptKind'=$6")) {
    return { rows: [{ id: Number(values[0]) }] };
  }
  if (sql.includes("upper(a.metadata->>'permission')=$5")) {
    return { rows: [{ id: Number(values[0]) }] };
  }
  if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'") &&
      sql.includes("RETURNING id")) {
    return { rows: [{ id: Number(values[0]) }] };
  }
  return null;
}

function installPartnerStaffDatabase(source?: {
  id: number;
  email: string;
  permission: string;
  clerkInvitationId: string;
}) {
  const fixture: {
    attempt: Record<string, any> | null;
    sourceStatus: string;
  } = { attempt: null, sourceStatus: "ACTIVE" };
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("FROM partner_profiles p")) {
      return { rows: [{ id: 4, status: "ACTIVE", isOwner: true, partnerRole: "PARTNER_OWNER" }] };
    }
    if (sql.includes("SELECT i.id,i.invited_email AS email") &&
        sql.includes("FROM partner_invitations i")) {
      const unresolved = fixture.attempt &&
        ["DISPATCHING", "UNKNOWN_PROVIDER_STATE"].includes(fixture.attempt.status);
      if (source && fixture.sourceStatus === "ACTIVE") {
        return { rows: [{
          id: source.id, email: source.email, recipient: source.email,
          role: source.permission === "FINANCE" ? "PARTNER_FINANCE" :
            source.permission === "ADMIN" ? "PARTNER_ADMIN" : "PARTNER_STAFF",
          permission: source.permission,
          status: unresolved ? fixture.attempt?.status : "PENDING",
          invitationAttemptId: unresolved ? fixture.attempt?.attemptId : null,
          selectedInvitationId: unresolved ? source.id : null,
          createdAt, expiresAt,
        }] };
      }
      if (!source && unresolved && fixture.attempt?.attemptKind === "CREATE") {
        return { rows: [{
          id: fixture.attempt.id, email: fixture.attempt.email, recipient: fixture.attempt.email,
          role: fixture.attempt.role, permission: fixture.attempt.permission,
          status: fixture.attempt.status, invitationAttemptId: fixture.attempt.attemptId,
          selectedInvitationId: null, createdAt: fixture.attempt.createdAt,
          expiresAt: fixture.attempt.expiresAt,
        }] };
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE partner_invitations SET status=$2")) {
      if (fixture.attempt) fixture.attempt.status = values[1];
    }
    return { rows: [] };
  });
  db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
      const attempt = fixture.attempt;
      return { rows: attempt && ["DISPATCHING", "UNKNOWN_PROVIDER_STATE"].includes(attempt.status)
        ? [{ ...attempt }]
        : [] };
    }
    if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
      if (source && Number(values[0]) === source.id && fixture.sourceStatus === "ACTIVE") {
        return { rows: [{
          id: source.id, partnerId: 4, email: source.email, status: fixture.sourceStatus,
          createdAt, expiresAt,
        }] };
      }
      if (!source && fixture.attempt && Number(values[0]) === fixture.attempt.id &&
          fixture.attempt.attemptKind === "CREATE" &&
          ["DISPATCHING", "UNKNOWN_PROVIDER_STATE"].includes(fixture.attempt.status)) {
        return { rows: [{
          id: fixture.attempt.id, partnerId: 4, email: fixture.attempt.email,
          status: fixture.attempt.status, createdAt: fixture.attempt.createdAt,
          expiresAt: fixture.attempt.expiresAt,
        }] };
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT metadata->>'permission' AS permission")) {
      return { rows: source ? [{ permission: source.permission }] : [] };
    }
    if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
      return { rows: source ? [{ clerkInvitationId: source.clerkInvitationId }] : [] };
    }
    if (sql.includes("FROM partner_profile_users")) return { rows: [] };
    if (sql.includes("FROM app_users")) return { rows: [] };
    if (sql.includes("INSERT INTO partner_invitations")) {
      const id = source ? source.id + 1 : 77;
      fixture.attempt = {
        id, partnerId: 4, email: normalizedTestEmail(String(values[1])),
        status: "DISPATCHING", tokenHash: values[2], createdAt, expiresAt,
        attemptId: "", attemptKind: source ? "RESEND" : "CREATE",
        selectedInvitationId: source?.id ?? null, permission: source?.permission ?? "STANDARD",
        role: source?.permission === "FINANCE" ? "PARTNER_FINANCE" :
          source?.permission === "ADMIN" ? "PARTNER_ADMIN" : "PARTNER_STAFF",
      };
      return { rows: [{ id, createdAt, expiresAt }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      const metadata = values.at(-1) as Record<string, any> | null;
      if (fixture.attempt && metadata?.attemptId === undefined) return { rows: [] };
      if (fixture.attempt && Number(values[6]) === fixture.attempt.id &&
          typeof metadata?.attemptId === "string") {
        Object.assign(fixture.attempt, {
          attemptId: metadata.attemptId,
          attemptKind: metadata.attemptKind,
          selectedInvitationId: metadata.selectedInvitationId,
          permission: metadata.permission,
          role: metadata.role,
        });
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'") &&
        !sql.includes("RETURNING id")) {
      fixture.sourceStatus = "REVOKED";
      return { rows: [] };
    }
    const finalization = partnerStaffFinalizationMock(sql, values);
    if (finalization) {
      if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'")) {
        fixture.sourceStatus = "REVOKED";
      }
      if (sql.includes("UPDATE partner_invitations SET status='ACTIVE'") && fixture.attempt) {
        fixture.attempt.status = "ACTIVE";
      }
      return finalization;
    }
    if (sql.includes("UPDATE partner_invitations SET status='ACTIVE'") && fixture.attempt) {
      fixture.attempt.status = "ACTIVE";
    }
    return { rows: [] };
  });
  return fixture;
}

const normalizedTestEmail = (value: string) => value.trim().toLowerCase();

async function patch(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
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
      if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
        return { rows: [{ action: "Created partner invitation", permission: null, role: null }] };
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

  it.each([
    ["CREATE", "STANDARD", "PARTNER_STAFF"],
    ["CREATE", "FINANCE", "PARTNER_FINANCE"],
    ["CREATE", "ADMIN", "PARTNER_ADMIN"],
    ["RESEND", "STANDARD", "PARTNER_STAFF"],
    ["RESEND", "FINANCE", "PARTNER_FINANCE"],
    ["RESEND", "ADMIN", "PARTNER_ADMIN"],
  ] as const)(
    "accepts recovered %s staff invitations with %s permission using the audited staff claim",
    async (attemptKind, permission, expectedRole) => {
      const invitationId = attemptKind === "CREATE" ? 901 : 902;
      const token = "r".repeat(48);
      const email = "staff@example.test";
      const role = expectedRole;
      state.context = {
        user: {
          id: 21, clerkUserId: "user_staff", email,
          firstName: "Staff", lastName: "User", status: "ACTIVE",
        },
        roles: [],
      };
      state.getUser.mockResolvedValue({
        primaryEmailAddress: { emailAddress: email, verification: { status: "verified" } },
      });
      const membershipWrites: unknown[][] = [];
      db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
        state.queries.push({ sql, values });
        if (sql.includes("SELECT i.id,i.partner_profile_id")) {
          return { rows: [{
            id: invitationId, partner_profile_id: 4, invited_email: email,
            expires_at: new Date(Date.now() + 7 * 86400000), partnerStatus: "ACTIVE",
          }] };
        }
        if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
          return { rows: [{
            action: "Recovered partner staff invitation",
            permission,
            role,
            attemptKind,
          }] };
        }
        if (sql.includes("INSERT INTO partner_profile_users")) {
          membershipWrites.push(values);
          return { rows: [] };
        }
        return { rows: [] };
      });
      db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
        state.queries.push({ sql, values });
        if (sql.includes("FROM partner_profiles p")) {
          return { rows: [{ id: 4, status: "ACTIVE", userId: 99 }] };
        }
        return { rows: [] };
      });

      const response = await post(`/partner/invitations/${token}/accept`, {});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ role: expectedRole, status: "ACTIVE" });
      expect(membershipWrites).toContainEqual([4, 21, expectedRole]);
      expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET user_id=$1"))).toBe(false);
      const claimQuery = state.queries.find(({ sql }) =>
        sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text"));
      expect(claimQuery?.values.slice(0, 3)).toEqual([invitationId, "4", email]);
      expect(claimQuery?.values[3]).toContain("Recovered partner staff invitation");
    },
  );

  it("rejects an unrecognized staff claim instead of falling back to owner attachment", async () => {
    const token = "u".repeat(48);
    const email = "staff@example.test";
    state.context = {
      user: {
        id: 21, clerkUserId: "user_staff", email,
        firstName: "Staff", lastName: "User", status: "ACTIVE",
      },
      roles: [],
    };
    state.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: email, verification: { status: "verified" } },
    });
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT i.id,i.partner_profile_id")) {
        return { rows: [{
          id: 903, partner_profile_id: 4, invited_email: email,
          expires_at: new Date(Date.now() + 7 * 86400000), partnerStatus: "ACTIVE",
        }] };
      }
      if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
        return { rows: [{
          action: "Started partner staff invitation",
          permission: "ADMIN",
          role: "PARTNER_ADMIN",
        }] };
      }
      return { rows: [] };
    });

    const response = await post(`/partner/invitations/${token}/accept`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "The staff invitation claim cannot be verified",
    });
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_profile_users"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET user_id=$1"))).toBe(false);
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
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
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
    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
    const selectedScope = state.queries.find(({ sql }) =>
      sql.includes("SELECT i.id,i.invited_email AS email,i.status"));
    expect(selectedScope?.values).toEqual([9, 4, "partner@example.test", expect.any(Array)]);
    const supersession = state.queries.find(({ sql }) =>
      sql.includes("WHERE partner_profile_id=$1 AND lower(trim(invited_email))=$2") &&
      sql.includes("FOR UPDATE"));
    expect(supersession?.sql).toContain("a.action=ANY($3::text[])");
    expect(supersession?.values?.[2]).not.toContain("Created partner staff invitation");
    const knownIds = state.queries.find(({ sql }) =>
      sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'"));
    expect(knownIds?.values?.[0]).toEqual([9]);
    expect(knownIds?.values?.[3]).not.toContain("Created partner staff invitation");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0].emailAddress).toBe("partner@example.test");
    expectPublicPartnerInvitationUrl(state.createInvitation.mock.calls[0][0].redirectUrl);
    expect(state.createInvitation.mock.calls[0][0].ignoreExisting).toBe(true);
    expect(state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation)
      .toMatchObject({ attemptId: expect.any(String), partnerInvitationId: 10 });
    const sourceLocks = state.queries
      .map(({ sql }, index) => sql.includes("SELECT i.id FROM partner_invitations i") &&
        sql.includes("i.status='ACTIVE'") && sql.includes("FOR UPDATE") ? index : -1)
      .filter((index) => index >= 0);
    const partnerLocks = state.queries
      .map(({ sql }, index) => sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE") ? index : -1)
      .filter((index) => index >= 0);
    expect(sourceLocks.at(-1)).toBeLessThan(partnerLocks.at(-1)!);
  });

  it("fails closed for missing or stale owner invitation ids before any provider dispatch", async () => {
    const missing = await post("/platform/partners/4/invitations/resend", {});
    expect(missing.status).toBe(400);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.getUserList).not.toHaveBeenCalled();

    state.selectedOwnerInvitation = false;
    const stale = await post("/platform/partners/4/invitations/resend", { invitationId: 99 });
    expect(stale.status).toBe(404);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.getUserList).not.toHaveBeenCalled();
    expect(state.revokeInvitation).not.toHaveBeenCalled();
  });

  it("does not use ignoreExisting when a Clerk account already exists for the partner email", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      return { rows: [] };
    });
    state.getUserList.mockResolvedValueOnce({ data: [{
      emailAddresses: [{ emailAddress: "Partner@Example.Test" }],
    }] });

    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
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

    const firstRequest = post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    await vi.waitFor(() => expect(state.createInvitation).toHaveBeenCalledTimes(1));
    const concurrent = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')") &&
          !sql.includes("metadata->>'oldEmail'")) {
        return { rows: [{ id: 10, status: "DISPATCHING", selectedInvitationId: 9,
          createdAt: new Date(), expiresAt: new Date() }] };
      }
      if (sql.includes("created_at>NOW()-INTERVAL '5 minutes'")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });

    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("metadata->>'selectedInvitationId'=$2") &&
          sql.includes("a.metadata->>'dispatchStatus' IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? { rows: [{
            id: 10, status: "UNKNOWN_PROVIDER_STATE",
            action: "Partner invitation resend requires provider recovery",
            attemptEmail: "partner@example.test", attemptOldEmail: null,
          }] }
          : { rows: [] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')") &&
          !sql.includes("metadata->>'oldEmail'")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9,
            createdAt: new Date(), expiresAt: new Date() }] : [] };
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
    const failed = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
    const emailCorrection = await patch("/platform/partners/4", {
      email: "corrected@example.test", invitationId: 9,
    });
    expect(emailCorrection.status).toBe(409);
    expect(await emailCorrection.json()).toMatchObject({
      error: expect.stringContaining("Recover that exact attempt through Resend"),
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.queries.filter(({ sql }) => sql.includes("INSERT INTO partner_invitations"))).toHaveLength(1);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET full_name"))).toBe(false);
    state.listInvitations.mockRejectedValueOnce(new Error("Clerk list temporarily unavailable"));
    const retry = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE','FAILED','RATE_LIMITED')")) {
        return { rows: [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9 }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')") &&
          !sql.includes("metadata->>'oldEmail'")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9,
            createdAt: new Date(), expiresAt: new Date() }] : [] };
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
    const uncertain = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(uncertain.status).toBe(503);
    const attemptId = state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation.attemptId;
    state.listInvitations.mockResolvedValueOnce({ data: [{
      id: "clerk_reconciled",
      emailAddress: "partner@example.test",
      status: "pending",
      revoked: false,
      publicMetadata: { edupulsePartnerInvitation: { attemptId, partnerInvitationId: 10 } },
    }], totalCount: 1 });

    state.selectedOwnerInvitation = false;
    state.selectedOwnerInvitationIds = [9];
    const recovered = await post("/platform/partners/4/invitations/resend", { invitationId: 10 });
    const recoveredBody = await recovered.json();
    expect(recoveredBody).toMatchObject({ reconciliationOnly: true });
    expect(recovered.status).toBe(200);
    expect(recoveredBody).toMatchObject({
      id: 10, invitationDispatchStatus: "REQUEST_ACCEPTED", status: "PENDING",
      reconciliationOnly: true,
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SELECT i.id,i.status") &&
      sql.includes("a.metadata->>'selectedInvitationId' AS \"selectedInvitationId\"") &&
      values[0] === 4 && values[1] === "partner@example.test")).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO audit_logs") && values[4] === "Started partner invitation resend" &&
      (values.at(-1) as any)?.selectedInvitationId === 9)).toBe(true);
    expect(state.listInvitations).toHaveBeenCalledWith({
      query: "partner@example.test", status: "pending", limit: 100, offset: 0,
    });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='ACTIVE'"))).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO audit_logs") && values[4] === "Recovered partner invitation resend" &&
      (values.at(-1) as any)?.recoveryStatus === "RECONCILED_FROM_CLERK_METADATA")).toBe(true);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old");
    const sourceLocks = state.queries
      .map(({ sql }, index) => sql.includes("SELECT i.id FROM partner_invitations i") &&
        sql.includes("i.status='ACTIVE'") && sql.includes("FOR UPDATE") ? index : -1)
      .filter((index) => index >= 0);
    const partnerLocks = state.queries
      .map(({ sql }, index) => sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE") ? index : -1)
      .filter((index) => index >= 0);
    expect(sourceLocks.at(-1)).toBeLessThan(partnerLocks.at(-1)!);
  });

  it("marks a definitively revoked Clerk attempt retryable without superseding the old invitation", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        const failed = state.queries.some(({ sql: seen }) => seen.includes("SET status='FAILED'"));
        return { rows: !failed && state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9,
            createdAt: new Date(), expiresAt: new Date() }] : [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        expect(sql).toContain("ORDER BY timestamp DESC");
        expect(sql).not.toContain("ORDER BY created_at");
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
      }
      if (sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE','FAILED','RATE_LIMITED')")) {
        return { rows: [{ id: 10, status: "FAILED", selectedInvitationId: 9 }] };
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
    const ambiguous = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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

    const resolved = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(resolved.status).toBe(409);
    expect(await resolved.json()).toMatchObject({ code: "INVITATION_PROVIDER_ABSENT" });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='FAILED',revoked_at=NOW()"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.listInvitations.mock.calls.map(([params]) => params.status)).toEqual([
      "pending", "accepted", "revoked", "expired",
    ]);

    state.selectedOwnerInvitation = false;
    state.selectedOwnerInvitationIds = [9];
    const safeRetry = await post("/platform/partners/4/invitations/resend", { invitationId: 10 });
    expect(safeRetry.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
  });

  it("does not conclude an attempt is absent until every invitation-list page is read", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) return { rows: [] };
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9,
            createdAt: new Date(), expiresAt: new Date() }] : [] };
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
    expect((await post("/platform/partners/4/invitations/resend", { invitationId: 9 })).status).toBe(503);
    state.listInvitations.mockImplementation(async ({ status, offset }: { status: string; offset: number }) => ({
      data: status === "pending" && offset === 0 ? Array.from({ length: 100 }, (_, index) => ({
        id: `other-${index}`, emailAddress: "partner@example.test", status: "pending",
        publicMetadata: {},
      })) : status === "pending" && offset === 100 ? [{
        id: "other-last", emailAddress: "partner@example.test", status: "pending", publicMetadata: {},
      }] : [],
      totalCount: status === "pending" ? 101 : 0,
    }));

    const unresolved = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(unresolved.status).toBe(409);
    expect(await unresolved.json()).toMatchObject({ code: "INVITATION_PROVIDER_ABSENT" });
    expect(state.listInvitations.mock.calls.map(([params]) => params.offset)).toEqual([0, 100, 0, 0, 0]);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='FAILED',revoked_at=NOW()"))).toBe(true);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
  });

  it("records a definitive Clerk 429 separately and returns Retry-After while keeping the old invite usable", async () => {
    let allowRateLimitedRetry = false;
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("status='RATE_LIMITED'")) {
        return { rows: !allowRateLimitedRetry && state.queries.some(({ sql: seen }) =>
          seen.includes("SET status='RATE_LIMITED'")) ? [{ retryAfterSeconds: 37 }] : [] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE','FAILED','RATE_LIMITED')")) {
        return { rows: [{ id: 10, status: "RATE_LIMITED", selectedInvitationId: 9 }] };
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
    state.createInvitation.mockRejectedValueOnce({ status: 429, headers: { get: () => "37" } });
    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(await response.json()).toMatchObject({
      code: "INVITATION_PROVIDER_RATE_LIMITED", retryAfterSeconds: 37,
    });
    expect(state.queries.some(({ sql }) => sql.includes("SET status='RATE_LIMITED'"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.revokeInvitation).not.toHaveBeenCalled();
    state.selectedOwnerInvitation = false;
    state.selectedOwnerInvitationIds = [9];
    const retry = await post("/platform/partners/4/invitations/resend", { invitationId: 10 });
    expect(retry.status).toBe(429);
    expect(retry.headers.get("retry-after")).toBe("37");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    allowRateLimitedRetry = true;
    const safeRetry = await post("/platform/partners/4/invitations/resend", { invitationId: 10 });
    expect(safeRetry.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
  });

  it("lists invitation lifecycle states through the Platform Owner directory endpoint", async () => {
    const response = await fetch(`${baseUrl}/platform/partners/invitations?status=PENDING`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain("FROM partner_invitations i");
    expect(sql).toContain("lower(trim(i.invited_email))=lower(trim(p.email))");
    expect(sql).toContain("owner_invitation.action=ANY($2::text[])");
    expect(values[0]).toBe("PENDING");
    expect(values[1]).toContain("Created partner invitation");
    expect(values[1]).not.toContain("Created partner staff invitation");
    expect(db.query.mock.calls[0][0]).toContain("EXISTS (");
    expect(db.query.mock.calls[0][0]).toContain("p.status='ACTIVE'");
    expect(db.query.mock.calls[0][0]).toContain("correction_recovery.id IS NOT NULL THEN 'UNKNOWN_PROVIDER_STATE'");
    expect(values[2]).toContain("Started partner invitation email correction");
  });

  it("reissues only the selected owner invitation during email correction and serializes against resend", async () => {
    let profileEmail = "partner@example.test";
    let nextInvitationId = 10;
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: profileEmail, status: "INVITED", userId: null }] };
      }
      if (sql.includes("SELECT id FROM partner_profiles") && sql.includes("lower(email)=lower($1)")) {
        return { rows: [] };
      }
      if (sql.includes("FROM partner_invitations i") &&
          sql.includes("a.action=ANY($4::text[])") &&
          sql.includes("lower(trim(a.metadata->>'invitedEmail'))=$3") &&
          sql.includes("i.status='ACTIVE'")) {
        const id = Number(values[0]);
        const email = String(values[2]);
        const isSelected = state.selectedOwnerInvitationIds.length
          ? state.selectedOwnerInvitationIds.includes(id)
          : state.selectedOwnerInvitation;
        return { rows: isSelected && email === profileEmail
          ? [{ id, email: profileEmail, status: "ACTIVE" }] : [] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: Array.isArray(values[0]) && (values[0] as number[]).includes(9)
          ? [{ clerkInvitationId: "clerk_old_owner" }] : [] };
      }
      if (sql.includes("UPDATE partner_profiles SET full_name")) {
        profileEmail = String(values[6]);
        state.selectedOwnerEmail = profileEmail;
        return { rows: [{ id: 4 }] };
      }
      if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'")) {
        state.selectedOwnerInvitationIds = [10];
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations i") &&
          sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        const id = nextInvitationId++;
        return { rows: [{ id, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("status='DISPATCHING' FOR UPDATE")) return { rows: [{ id: 11 }] };
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT 1 FROM partner_invitations") && sql.includes("status='ACTIVE'")) {
        return { rows: [{ "?column?": 1 }] };
      }
      return { rows: [] };
    });

    const corrected = await patch("/platform/partners/4", {
      email: "Corrected@Example.Test",
      invitationId: 9,
    });
    expect(corrected.status).toBe(200);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("pg_advisory_lock(hashtextextended($1,0))") &&
      values[0] === "partner-invitation-resend:4")).toBe(true);
    const lockIndex = state.queries.findIndex(({ sql }) =>
      sql.includes("pg_advisory_lock(hashtextextended($1,0))"));
    const selectedSourceLockIndex = state.queries.findIndex(({ sql }) =>
      sql.includes("FROM partner_invitations i") &&
      sql.includes("a.action=ANY($4::text[])") &&
      sql.includes("i.status='ACTIVE'"));
    const partnerRowLockIndex = state.queries.findIndex(({ sql }) =>
      sql.includes("FROM partner_profiles WHERE id=$1 FOR UPDATE"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(selectedSourceLockIndex).toBeGreaterThanOrEqual(0);
    expect(partnerRowLockIndex).toBeGreaterThan(selectedSourceLockIndex);
    expect(partnerRowLockIndex).toBeGreaterThan(lockIndex);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO audit_logs") &&
      values[4] === "Corrected pending partner invitation email" &&
      (values.at(-1) as any)?.invitedEmail === "corrected@example.test")).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") &&
      values[0] === 9 && values[1] === 4 && values[2] === "partner@example.test")).toBe(true);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old_owner");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0].emailAddress).toBe("corrected@example.test");

    const oldRecipientSource = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(oldRecipientSource.status).toBe(404);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    const resent = await post("/platform/partners/4/invitations/resend", { invitationId: 10 });
    expect(resent.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
    expect(state.createInvitation.mock.calls[1][0].emailAddress).toBe("corrected@example.test");
  });

  it("durably reconciles an uncertain Owner email correction without superseding or redispatching", async () => {
    let profileEmail = "partner@example.test";
    state.selectedOwnerInvitationIds = [9];
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: profileEmail, status: "INVITED", userId: null }] };
      }
      if (sql.includes("FROM partner_invitations i") &&
          sql.includes("a.action=ANY($4::text[])") &&
          sql.includes("i.status='ACTIVE'")) {
        return Number(values[0]) === 9 && values[2] === profileEmail
          ? { rows: [{ id: 9, email: profileEmail, status: "ACTIVE" }] } : { rows: [] };
      }
      if (sql.includes("metadata->>'selectedInvitationId'=$2") &&
          sql.includes("a.metadata->>'dispatchStatus' IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? { rows: [{
            id: 10, status: "UNKNOWN_PROVIDER_STATE",
            action: "Partner invitation email correction requires provider recovery",
            attemptEmail: "corrected@example.test", attemptOldEmail: "partner@example.test",
          }] }
          : { rows: [] };
      }
      if (sql.includes("SELECT i.id,i.status") &&
          sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return state.queries.some(({ sql: seen }) =>
          seen.includes("UPDATE partner_invitations SET status='UNKNOWN_PROVIDER_STATE'"))
          ? { rows: [{ id: 10, status: "UNKNOWN_PROVIDER_STATE", selectedInvitationId: 9,
            email: "corrected@example.test",
            createdAt: new Date(Date.now() - 6 * 60_000), expiresAt: new Date() }] }
          : { rows: [] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        return { rows: [{ attemptId: state.createInvitation.mock.calls[0][0]
          .publicMetadata.edupulsePartnerInvitation.attemptId }] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old_owner" }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations i") &&
          sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes("SELECT id FROM partner_profiles") && sql.includes("lower(email)=lower($1)")) {
        return { rows: [] };
      }
      if (sql.includes("FROM app_users")) return { rows: [] };
      if (sql.includes("UPDATE partner_profiles SET full_name")) {
        profileEmail = String(values[6]);
        return { rows: [{ id: 4 }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'")) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      return { rows: [] };
    });
    state.createInvitation.mockRejectedValueOnce(new Error("provider accepted then response was lost"));

    const uncertain = await patch("/platform/partners/4", {
      email: "corrected@example.test", invitationId: 9,
    });
    expect(uncertain.status).toBe(503);
    expect(await uncertain.json()).toMatchObject({ code: "INVITATION_RECOVERY_REQUIRED" });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    const rawToken = new URL(String(state.createInvitation.mock.calls[0][0].redirectUrl))
      .searchParams.get("partnerInvitation")!;
    const persistedTokenHash = createHash("sha256").update(rawToken).digest("hex");
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO partner_invitations") && sql.includes("'DISPATCHING'") &&
      values[2] === persistedTokenHash)).toBe(true);
    expect(state.queries.some(({ sql }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET full_name"))).toBe(false);
    const differentTarget = await patch("/platform/partners/4", {
      email: "other@example.test", invitationId: 9,
    });
    expect(differentTarget.status).toBe(409);
    expect(await differentTarget.json()).toMatchObject({
      error: expect.stringContaining("Recover that exact attempt through Resend"),
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.queries.filter(({ sql }) => sql.includes("INSERT INTO partner_invitations"))).toHaveLength(1);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET full_name"))).toBe(false);
    const marker = state.createInvitation.mock.calls[0][0].publicMetadata.edupulsePartnerInvitation;
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) => ({
      data: status === "pending" ? [{
        id: "clerk_email_correction",
        emailAddress: "corrected@example.test",
        status: "pending",
        revoked: false,
        publicMetadata: { edupulsePartnerInvitation: marker },
      }] : [],
      totalCount: status === "pending" ? 1 : 0,
    }));

    const recovered = await patch("/platform/partners/4", {
      email: "corrected@example.test", invitationId: 9,
    });
    expect(recovered.status).toBe(200);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.listInvitations.mock.calls.map(([params]) => params.status)).toEqual([
      "pending", "accepted", "revoked", "expired",
    ]);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") && values[0] === 9)).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("UPDATE partner_profiles SET full_name") &&
      values[6] === "corrected@example.test")).toBe(true);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old_owner");
    expect(JSON.stringify(state.queries)).not.toContain(rawToken);
    expect(JSON.stringify(state.queries)).not.toContain(String(state.createInvitation.mock.calls[0][0].redirectUrl));
  });

  it("reconciles an Owner email correction from the old selected ID without creating another invitation", async () => {
    const marker = { attemptId: "email-correction-attempt", partnerInvitationId: 10 };
    let profileEmail = "partner@example.test";
    state.selectedOwnerInvitationIds = [9];
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: profileEmail, status: "INVITED", userId: null }] };
      }
      if (sql.includes("metadata->>'oldEmail'") &&
          sql.includes("selectedInvitationId") &&
          sql.includes("(i.status='DISPATCHING' OR i.status='UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{
          id: 10, status: "UNKNOWN_PROVIDER_STATE", email: "corrected@example.test",
          attemptId: marker.attemptId, createdAt: new Date(), expiresAt: new Date(),
        }] };
      }
      if (sql.includes("SELECT metadata->>'attemptId'")) {
        return { rows: [{ attemptId: marker.attemptId }] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old_owner" }] };
      }
      if (sql.includes("SELECT id FROM partner_invitations i") &&
          sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'")) {
        return { rows: [{ id: 9 }] };
      }
      if (sql.includes("UPDATE partner_profiles SET full_name")) {
        profileEmail = String(values[6]);
        return { rows: [{ id: 4 }] };
      }
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT 1 FROM partner_invitations i JOIN partner_profiles")) {
        return { rows: [{ "?column?": 1 }] };
      }
      return { rows: [] };
    });
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) => ({
      data: status === "pending" ? [{
        id: "clerk_corrected_owner",
        emailAddress: "corrected@example.test",
        status: "pending",
        revoked: false,
        publicMetadata: { edupulsePartnerInvitation: marker },
      }] : [],
      totalCount: status === "pending" ? 1 : 0,
    }));

    const ownerList = await fetch(`${baseUrl}/platform/partners/invitations`);
    expect(ownerList.status).toBe(200);
    const listQuery = state.queries.find(({ sql }) => sql.includes("correction_recovery.id IS NOT NULL"));
    expect(listQuery?.values[2]).toContain("Started partner invitation email correction");

    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    const responseBody = await response.json();
    expect(state.listInvitations.mock.calls.map(([params]) => [params.query, params.status])).toEqual([
      ["corrected@example.test", "pending"],
      ["corrected@example.test", "accepted"],
      ["corrected@example.test", "revoked"],
      ["corrected@example.test", "expired"],
    ]);
    expect(responseBody).toMatchObject({ reconciliationOnly: true });
    expect(response.status).toBe(200);
    expect(responseBody).toMatchObject({
      id: 10, partnerId: 4, email: "corrected@example.test",
      status: "PENDING", reconciliationOnly: true,
    });
    expect(state.listInvitations.mock.calls.map(([params]) => params.status)).toEqual([
      "pending", "accepted", "revoked", "expired",
    ]);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") && values[0] === 9)).toBe(true);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("UPDATE partner_profiles SET full_name") && values[6] === "corrected@example.test")).toBe(true);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_old_owner");
  });

  it("does not finalize a corrected invite if partner activation completes during dispatch", async () => {
    let profileStatus = "INVITED";
    let profileUserId: number | null = null;
    state.selectedOwnerInvitationIds = [9];
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{
          id: 4, email: "partner@example.test", status: profileStatus, userId: profileUserId,
        }] };
      }
      if (sql.includes("FROM partner_invitations i") &&
          sql.includes("a.action=ANY($4::text[])") &&
          sql.includes("i.status='ACTIVE'")) {
        return Number(values[0]) === 9
          ? { rows: [{ id: 9, email: "partner@example.test", status: "ACTIVE" }] }
          : { rows: [] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_old_owner" }] };
      }
      if (sql.includes("SELECT id FROM partner_profiles") && sql.includes("lower(email)=lower($1)")) {
        return { rows: [] };
      }
      if (sql.includes("FROM app_users")) return { rows: [] };
      if (sql.includes("SELECT id FROM partner_invitations i") &&
          sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
        return { rows: [{ id: Number(values[0]) }] };
      }
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      return { rows: [] };
    });
    state.createInvitation.mockImplementationOnce(async () => {
      profileStatus = "ACTIVE";
      profileUserId = 21;
      return { id: "clerk_email_correction_after_acceptance" };
    });

    const response = await patch("/platform/partners/4", {
      email: "corrected@example.test", invitationId: 9,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("accepted or changed before this email correction could be finalized"),
    });
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_profiles SET full_name"))).toBe(false);
    expect(state.queries.some(({ sql }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_email_correction_after_acceptance");
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status=$2") && values[0] === 10 && values[1] === "FAILED")).toBe(true);
  });

  it("rejects stale Owner email-edit invitation IDs before changing profiles, invitations, or sending", async () => {
    state.selectedOwnerInvitation = false;
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{ id: 4, email: "partner@example.test", status: "INVITED", userId: null }] };
      }
      if (sql.includes("FROM partner_invitations i")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await patch("/platform/partners/4", {
      email: "replacement@example.test",
      invitationId: 999,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("selected partner invitation is stale"),
    });
    const selectedQuery = state.queries.find(({ sql }) =>
      sql.includes("FROM partner_invitations i") && sql.includes("a.action=ANY($4::text[])"));
    expect(selectedQuery?.values).toEqual([999, 4, "partner@example.test", expect.any(Array)]);
    expect(state.queries.some(({ sql }) =>
      sql.includes("UPDATE partner_profiles SET full_name") ||
      sql.includes("UPDATE partner_invitations") ||
      sql.includes("INSERT INTO partner_invitations"))).toBe(false);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.revokeInvitation).not.toHaveBeenCalled();
  });

  it("rejects a resend finalization if the owner email changes during provider dispatch", async () => {
    let emailChanged = false;
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles WHERE id=$1")) {
        return { rows: [{
          id: 4, email: emailChanged ? "changed@example.test" : "partner@example.test",
          status: "INVITED", userId: null,
        }] };
      }
      if (sql.includes("status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) return { rows: [] };
      if (sql.includes("SELECT id FROM partner_invitations")) return { rows: [{ id: 9 }] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    state.createInvitation.mockImplementationOnce(async () => {
      emailChanged = true;
      return { id: "clerk_during_email_race" };
    });

    const response = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("email changed"),
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_during_email_race");
    expect(state.queries.some(({ sql }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()"))).toBe(false);
  });

  it("revokes only the selected prior Clerk invitation before dispatch and keeps local replacement ordering safe", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      const finalization = partnerStaffFinalizationMock(sql, values);
      if (finalization) return finalization;
      if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
        return { rows: [{
          id: 9, partnerId: 4, email: "staff@example.test", status: "ACTIVE",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          expiresAt: new Date("2025-01-08T00:00:00.000Z"),
        }] };
      }
      if (sql.includes("SELECT metadata->>'permission' AS permission")) {
        return { rows: [{ permission: "FINANCE" }] };
      }
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) {
        return { rows: [{ clerkInvitationId: "clerk_staff_old" }] };
      }
      if (sql.includes("SELECT 1 FROM partner_profile_users")) return { rows: [] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 10, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });
    const clerkPendingAddresses = new Set(["staff@example.test"]);
    state.revokeInvitation.mockImplementationOnce(async (id: string) => {
      state.queries.push({ sql: "MOCK_REVOKE", values: [id] });
      if (id === "clerk_staff_old") clerkPendingAddresses.delete("staff@example.test");
    });
    state.createInvitation.mockImplementationOnce(async () => {
      if (clerkPendingAddresses.has("staff@example.test")) {
        throw Object.assign(new Error("A pending invitation already exists"), { status: 409 });
      }
      state.queries.push({ sql: "MOCK_CREATE", values: [] });
      clerkPendingAddresses.add("staff@example.test");
      return { id: "clerk_staff_new" };
    });
    const response = await post("/partner/staff-invitations/9/resend", {});
    expect(response.status).toBe(201);
    const initialCommitIndex = state.queries.findIndex(({ sql }) => sql === "COMMIT");
    const revokeIndex = state.queries.findIndex(({ sql }) => sql === "MOCK_REVOKE");
    const providerCreateIndex = state.queries.findIndex(({ sql }) => sql === "MOCK_CREATE");
    const localSourceInvalidationIndex = state.queries.findIndex(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") && values[0] === 9 && values[1] === 4);
    expect(initialCommitIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(initialCommitIndex);
    expect(providerCreateIndex).toBeGreaterThan(revokeIndex);
    expect(localSourceInvalidationIndex).toBeGreaterThan(providerCreateIndex);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SET status='REVOKED',revoked_at=NOW()") &&
      values[0] === 9 && values[1] === 4)).toBe(true);
    const selectedPermission = state.queries.find(({ sql }) =>
      sql.includes("SELECT metadata->>'permission' AS permission"));
    expect(selectedPermission?.sql).toContain("action=ANY($4::text[])");
    expect(selectedPermission?.sql).toContain("metadata->>'partnerId'=$2::text");
    expect(selectedPermission?.values).toEqual([9, 4, "staff@example.test", expect.arrayContaining([
      "Created partner staff invitation", "Resent partner staff invitation",
    ])]);
    const staffSupersessionUpdate = state.queries.find(({ sql }) =>
      sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED',revoked_at=NOW()"));
    expect(staffSupersessionUpdate?.sql).toContain("WHERE id=$1 AND partner_profile_id=$2");
    expect(staffSupersessionUpdate?.values).toEqual([9, 4, "staff@example.test"]);
    const staffKnownIds = state.queries.find(({ sql }) =>
      sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'"));
    expect(staffKnownIds?.values).toEqual([[9], "4", "staff@example.test", expect.arrayContaining([
      "Created partner staff invitation", "Resent partner staff invitation",
    ])]);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0].emailAddress).toBe("staff@example.test");
    expect(state.createInvitation.mock.calls[0][0].expiresInDays).toBe(7);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_staff_old");
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO audit_logs") &&
      (values.at(-1) as Record<string, unknown>)?.clerkInvitationId === "clerk_staff_new")).toBe(true);
  });

  it.each([
    ["STANDARD", "PARTNER_STAFF"],
    ["FINANCE", "PARTNER_FINANCE"],
    ["ADMIN", "PARTNER_ADMIN"],
  ])("resends the exact selected %s staff invitation with its original permission and expiry window", async (permission, role) => {
    const sourceCreatedAt = new Date("2025-01-01T00:00:00.000Z");
    const sourceExpiresAt = new Date("2025-01-08T00:00:00.000Z");
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      const finalization = partnerStaffFinalizationMock(sql, values);
      if (finalization) return finalization;
      if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
        return { rows: [{
          id: 202, partnerId: 4, email: "middle@example.test", status: "ACTIVE",
          createdAt: sourceCreatedAt, expiresAt: sourceExpiresAt,
        }] };
      }
      if (sql.includes("SELECT metadata->>'permission' AS permission")) return { rows: [{ permission }] };
      if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) return { rows: [{ clerkInvitationId: "clerk_middle_original" }] };
      if (sql.includes("SELECT 1 FROM partner_profile_users")) return { rows: [] };
      if (sql.includes("INSERT INTO partner_invitations")) {
        return { rows: [{ id: 204, expiresAt: new Date(Date.now() + 7 * 86400000), createdAt: new Date() }] };
      }
      return { rows: [] };
    });

    const response = await post("/partner/staff-invitations/202/resend", {});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 204, email: "middle@example.test", permission, role, status: "PENDING",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0]).toMatchObject({
      emailAddress: "middle@example.test",
      expiresInDays: 7,
      notify: true,
      publicMetadata: {
        edupulsePartnerInvitation: {
          partnerId: 4, partnerInvitationId: 204, permission, role,
          attemptId: expect.any(String),
        },
      },
    });
    expect(state.createInvitation.mock.calls[0][0]).not.toHaveProperty("ignoreExisting");
    const update = state.queries.find(({ sql }) =>
      sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'"));
    expect(update?.values).toEqual([202, 4, "middle@example.test"]);
    expect(update?.values).not.toContain(101);
    expect(update?.values).not.toContain(303);
    const selectedAudit = state.queries.find(({ sql }) => sql.includes("SELECT metadata->>'permission' AS permission"));
    expect(selectedAudit?.values[0]).toBe(202);
    expectPublicPartnerInvitationUrl(state.createInvitation.mock.calls[0][0].redirectUrl);
  });

  it("returns pending and expired staff invitations with exact role and timestamp metadata but excludes accepted accounts", async () => {
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles p")) {
        return { rows: [{ id: 4, status: "ACTIVE", isOwner: true, partnerRole: "PARTNER_OWNER" }] };
      }
      if (sql.includes("FROM partner_invitations i")) {
        return { rows: [
          { id: 101, email: "first@example.test", recipient: "first@example.test", permission: "STANDARD",
            role: "PARTNER_STAFF", status: "PENDING", createdAt: "2025-01-01", expiresAt: "2025-01-08" },
          { id: 202, email: "middle@example.test", recipient: "Middle", permission: "FINANCE",
            role: "PARTNER_FINANCE", status: "EXPIRED", createdAt: "2025-01-02", expiresAt: "2025-01-09" },
          { id: 303, email: "last@example.test", recipient: "last@example.test", permission: "ADMIN",
            role: "PARTNER_ADMIN", status: "PENDING", createdAt: "2025-01-03", expiresAt: "2025-01-10" },
        ] };
      }
      return { rows: [] };
    });
    const response = await fetch(`${baseUrl}/partner/staff/invitations`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { id: 101, email: "first@example.test", role: "PARTNER_STAFF", status: "PENDING", createdAt: "2025-01-01" },
      { id: 202, email: "middle@example.test", role: "PARTNER_FINANCE", status: "EXPIRED", permission: "FINANCE" },
      { id: 303, email: "last@example.test", role: "PARTNER_ADMIN", status: "PENDING" },
    ]);
    const query = state.queries.find(({ sql }) => sql.includes("FROM partner_invitations i"));
    expect(query?.sql).toContain("WHEN i.expires_at>NOW() THEN 'PENDING' ELSE 'EXPIRED' END AS status");
    expect(query?.sql).toContain("UNKNOWN_PROVIDER_STATE");
    expect(query?.sql).toContain("NOT EXISTS");
    expect(query?.sql).toContain("FROM partner_profile_users pu");
    expect(query?.values).toEqual([4, [
      "Created partner staff invitation", "Started partner staff invitation",
      "Started partner staff invitation resend", "Resent partner staff invitation",
      "Recovered partner staff invitation",
      "Partner staff invitation dispatch requires provider recovery",
      "Partner staff invitation finalization requires recovery",
      "Partner staff invitation dispatch rejected by provider",
      "Resolved partner staff invitation attempt",
    ]]);
  });

  it("rejects partner staff invitation list/resend/revoke for unauthorized partner roles", async () => {
    state.partnerIsOwner = false;
    state.partnerRole = "PARTNER_FINANCE";
    const listed = await fetch(`${baseUrl}/partner/staff/invitations`);
    const resent = await post("/partner/staff-invitations/202/resend", {});
    const revoked = await fetch(`${baseUrl}/partner/staff-invitations/202`, { method: "DELETE" });
    expect(listed.status).toBe(403);
    expect(resent.status).toBe(403);
    expect(revoked.status).toBe(403);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("FROM partner_invitations"))).toBe(false);
  });

  it("rejects wrong or stale staff invitation IDs without dispatching or changing any row", async () => {
    db.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const response = await post("/partner/staff-invitations/999/resend", {});
    expect(response.status).toBe(404);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_invitations"))).toBe(false);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_invitations"))).toBe(false);
  });

  it("serializes concurrent resends of one staff invitation so the duplicate sends no second link", async () => {
    let rowStatus = "ACTIVE";
    let rowLocked = false;
    let unresolvedAttempt: Record<string, unknown> | null = null;
    const waiters: Array<() => void> = [];
    const acquire = async () => {
      if (!rowLocked) {
        rowLocked = true;
        return;
      }
      await new Promise<void>(resolve => waiters.push(resolve));
    };
    const release = () => {
      const next = waiters.shift();
      if (next) next();
      else rowLocked = false;
    };
    db.connect.mockImplementation(async () => {
      let ownsInvitationLock = false;
      return {
        query: async (sql: string, values: unknown[] = []) => {
          state.queries.push({ sql, values });
          const finalization = partnerStaffFinalizationMock(sql, values);
          if (finalization && sql.includes("UPDATE partner_invitations") &&
              sql.includes("SET status='REVOKED'")) {
            rowStatus = "REVOKED";
            return finalization;
          }
          if (finalization) return finalization;
          if (sql.includes("i.status IN ('DISPATCHING','UNKNOWN_PROVIDER_STATE')")) {
            return { rows: unresolvedAttempt ? [{ ...unresolvedAttempt, status: "DISPATCHING" }] : [] };
          }
          if (sql.includes("FROM partner_invitations WHERE id=$1 AND partner_profile_id=$2 FOR UPDATE")) {
            await acquire();
            ownsInvitationLock = true;
            return { rows: [{
              id: 202, partnerId: 4, email: "middle@example.test", status: rowStatus,
              createdAt: new Date("2025-01-01T00:00:00.000Z"),
              expiresAt: new Date("2025-01-08T00:00:00.000Z"),
            }] };
          }
          if (sql.includes("SELECT metadata->>'permission' AS permission")) return { rows: [{ permission: "STANDARD" }] };
          if (sql.includes("SELECT DISTINCT metadata->>'clerkInvitationId'")) return { rows: [{ clerkInvitationId: "clerk_original" }] };
          if (sql.includes("SELECT 1 FROM partner_profile_users")) return { rows: [] };
          if (sql.includes("INSERT INTO partner_invitations")) {
            unresolvedAttempt = {
              id: 204, partnerId: 4, email: "middle@example.test",
              createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000),
              attemptId: "staff-concurrent-attempt", attemptKind: "RESEND",
              selectedInvitationId: 202, permission: "STANDARD", role: "PARTNER_STAFF",
            };
            return { rows: [{
              id: 204, expiresAt: unresolvedAttempt.expiresAt, createdAt: unresolvedAttempt.createdAt,
            }] };
          }
          return db.clientQuery(sql, values);
        },
        release: () => {
          if (ownsInvitationLock) release();
          db.release();
        },
      };
    });
    let providerStarted!: () => void;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    let completeProvider!: (value: { id: string }) => void;
    const providerResult = new Promise<{ id: string }>(resolve => { completeProvider = resolve; });
    state.createInvitation.mockImplementationOnce(async () => {
      providerStarted();
      return providerResult;
    });

    const firstRequest = post("/partner/staff-invitations/202/resend", {});
    await started;
    const secondRequest = post("/partner/staff-invitations/202/resend", {});
    completeProvider({ id: "clerk_first_only" });
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.queries.filter(({ sql }) => sql.includes("UPDATE partner_invitations") && sql.includes("SET status='REVOKED'")))
      .toHaveLength(1);
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
      if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
        return { rows: [{ action: "Created partner invitation", permission: null, role: null }] };
      }
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

  it("persists the hashed token and exact attempt marker before notify and recovers a lost accepted response without a second send", async () => {
    const fixture = installPartnerStaffDatabase();
    let providerRequest: Record<string, any> | undefined;
    state.createInvitation.mockImplementationOnce(async (input: Record<string, any>) => {
      providerRequest = input;
      state.queries.push({ sql: "MOCK_CREATE", values: [input] });
      throw new Error("connection dropped after provider accepted the invitation");
    });

    const first = await post("/partner/staff-invitations", { email: "staff@example.test", permission: "ADMIN" });
    expect(first.status).toBe(503);
    expect(fixture.attempt).toMatchObject({
      status: "UNKNOWN_PROVIDER_STATE", permission: "ADMIN", role: "PARTNER_ADMIN",
      attemptKind: "CREATE", selectedInvitationId: null,
    });
    expect(fixture.attempt?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(providerRequest?.publicMetadata.edupulsePartnerInvitation).toMatchObject({
      partnerId: 4, partnerInvitationId: fixture.attempt?.id,
      attemptId: fixture.attempt?.attemptId, permission: "ADMIN", role: "PARTNER_ADMIN",
    });
    const plaintextToken = new URL(providerRequest!.redirectUrl).searchParams.get("partnerInvitation");
    expect(plaintextToken).toBeTruthy();
    expect(fixture.attempt?.tokenHash).toBe(createHash("sha256").update(plaintextToken!).digest("hex"));
    const firstCommit = state.queries.findIndex(({ sql }) => sql === "COMMIT");
    const providerCall = state.queries.findIndex(({ sql }) => sql === "MOCK_CREATE");
    expect(firstCommit).toBeGreaterThanOrEqual(0);
    expect(providerCall).toBeGreaterThan(firstCommit);

    const providerInvitation = {
      id: "clerk_lost_response", emailAddress: "staff@example.test", status: "pending",
      publicMetadata: providerRequest!.publicMetadata,
    };
    const reconciledStatuses: string[] = [];
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) => {
      reconciledStatuses.push(status);
      return status === "pending"
        ? { data: [providerInvitation], totalCount: 1 }
        : { data: [], totalCount: 0 };
    });
    const listed = await fetch(`${baseUrl}/partner/staff/invitations`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([{
      id: fixture.attempt?.id, email: "staff@example.test", permission: "ADMIN",
      role: "PARTNER_ADMIN", status: "UNKNOWN_PROVIDER_STATE",
      invitationAttemptId: fixture.attempt?.attemptId, selectedInvitationId: null,
    }]);
    const recovered = await post(`/partner/staff-invitations/${fixture.attempt?.id}/resend`, {
      mode: "reconcile",
    });
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({
      id: fixture.attempt?.id, role: "PARTNER_ADMIN", permission: "ADMIN",
      invitationAttemptStatus: "RECOVERED",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(reconciledStatuses).toEqual(["pending", "accepted", "revoked", "expired"]);
    expect(fixture.attempt?.status).toBe("ACTIVE");
    expect(state.queries.some(({ sql }) => sql.includes("token_hash") &&
      sql.includes("'DISPATCHING'"))).toBe(true);
  });

  it("marks a default Clerk duplicate-address rejection retryable without losing the selected staff invitation", async () => {
    const fixture = installPartnerStaffDatabase({
      id: 202, email: "staff@example.test", permission: "FINANCE",
      clerkInvitationId: "clerk_existing_pending",
    });
    state.createInvitation.mockRejectedValueOnce(Object.assign(
      new Error("A pending invitation already exists"), { status: 409 },
    ));
    const response = await post("/partner/staff-invitations/202/resend", {});
    expect(response.status).toBe(409);
    expect(fixture.attempt).toMatchObject({
      status: "FAILED", attemptKind: "RESEND", selectedInvitationId: 202,
      permission: "FINANCE", role: "PARTNER_FINANCE",
    });
    expect(fixture.sourceStatus).toBe("ACTIVE");
    expect(state.revokeInvitation).toHaveBeenCalledWith("clerk_existing_pending");
    expect(state.createInvitation.mock.calls[0][0]).not.toHaveProperty("ignoreExisting");
    expect(state.queries.some(({ sql }) => sql.includes("SET status='REVOKED'") &&
      sql.includes("RETURNING id"))).toBe(false);
  });

  it("recovers only the selected source after a lost resend response and preserves FINANCE permission", async () => {
    const fixture = installPartnerStaffDatabase({
      id: 202, email: "staff@example.test", permission: "FINANCE",
      clerkInvitationId: "clerk_staff_source",
    });
    let providerRequest: Record<string, any> | undefined;
    state.createInvitation.mockImplementationOnce(async (input: Record<string, any>) => {
      providerRequest = input;
      state.queries.push({ sql: "MOCK_CREATE", values: [input] });
      throw new Error("connection dropped after provider acceptance");
    });
    const first = await post("/partner/staff-invitations/202/resend", {});
    expect(first.status).toBe(503);
    expect(fixture.sourceStatus).toBe("ACTIVE");
    expect(fixture.attempt).toMatchObject({
      status: "UNKNOWN_PROVIDER_STATE", attemptKind: "RESEND",
      selectedInvitationId: 202, permission: "FINANCE", role: "PARTNER_FINANCE",
    });
    const pending = {
      id: "clerk_staff_recovered", emailAddress: "staff@example.test", status: "pending",
      publicMetadata: providerRequest!.publicMetadata,
    };
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) =>
      status === "pending" ? { data: [pending], totalCount: 1 } : { data: [], totalCount: 0 });
    const listed = await fetch(`${baseUrl}/partner/staff/invitations`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([{
      id: 202, email: "staff@example.test", permission: "FINANCE",
      role: "PARTNER_FINANCE", status: "UNKNOWN_PROVIDER_STATE",
      invitationAttemptId: fixture.attempt?.attemptId, selectedInvitationId: 202,
    }]);
    const recovered = await post("/partner/staff-invitations/202/resend", { mode: "reconcile" });
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({
      id: fixture.attempt?.id, permission: "FINANCE", role: "PARTNER_FINANCE",
      invitationAttemptStatus: "RECOVERED",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(fixture.sourceStatus).toBe("REVOKED");
    expect(fixture.attempt?.status).toBe("ACTIVE");
    expect(pending.publicMetadata.edupulsePartnerInvitation).toMatchObject({
      partnerInvitationId: fixture.attempt?.id, attemptId: fixture.attempt?.attemptId,
      permission: "FINANCE", role: "PARTNER_FINANCE",
    });
  });

  it("blocks an accepted-account race found by the final pre-dispatch guard", async () => {
    const fixture = installPartnerStaffDatabase();
    const existingAccount = { emailAddresses: [{ emailAddress: "staff@example.test" }] };
    state.getUserList
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [existingAccount] });
    const response = await post("/partner/staff-invitations", { email: "staff@example.test" });
    expect(response.status).toBe(409);
    expect(fixture.attempt?.status).toBe("FAILED");
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it("blocks an account accepted during a lost provider response without dispatching again", async () => {
    const fixture = installPartnerStaffDatabase();
    const existingAccount = { emailAddresses: [{ emailAddress: "staff@example.test" }] };
    state.getUserList
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [existingAccount] });
    let providerRequest: Record<string, any> | undefined;
    state.createInvitation.mockImplementationOnce(async (input: Record<string, any>) => {
      providerRequest = input;
      return { id: "clerk_race_accepted" };
    });
    const first = await post("/partner/staff-invitations", { email: "staff@example.test" });
    expect(first.status).toBe(503);
    expect(fixture.attempt?.status).toBe("UNKNOWN_PROVIDER_STATE");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    const accepted = {
      id: "clerk_race_accepted", emailAddress: "staff@example.test", status: "accepted",
      publicMetadata: providerRequest!.publicMetadata,
    };
    state.listInvitations.mockImplementation(async ({ status }: { status: string }) =>
      status === "accepted" ? { data: [accepted], totalCount: 1 } : { data: [], totalCount: 0 });
    const retry = await post("/partner/staff-invitations", { email: "staff@example.test" });
    expect(retry.status).toBe(503);
    expect(await retry.json()).toMatchObject({
      code: "INVITATION_RECOVERY_REQUIRED",
      error: expect.stringContaining("was accepted"),
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(fixture.attempt?.status).toBe("UNKNOWN_PROVIDER_STATE");
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
      if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
        return { rows: [{
          action: "Recovered partner staff invitation", permission,
          role, attemptKind: "CREATE",
        }] };
      }
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
      if (sql.includes("FROM audit_logs") && sql.includes("metadata->>'partnerId'=$2::text")) {
        return { rows: [{
          action: "Recovered partner staff invitation",
          permission: "PLATFORM_OWNER",
          role: "PLATFORM_OWNER",
        }] };
      }
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
    const resent = await post("/platform/partners/4/invitations/resend", { invitationId: 9 });
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

  it("registers a directly attributed school through the partner owner route", async () => {
    state.context = {
      user: {
        id: 8,
        clerkUserId: "user_partner_owner",
        email: "partner.owner@example.test",
        firstName: "Partner",
        lastName: "Owner",
        status: "ACTIVE",
      },
      roles: [{ id: 2, role: "PARTNER", schoolId: null, status: "ACTIVE" }],
    };
    const response = await post("/partner/schools", {
      school: { name: "Direct Partner School", city: "Lagos", state: "Lagos" },
      administrator: {
        fullName: "First Administrator",
        email: "first.admin@direct-partner.test",
        phone: "+2348000000000",
      },
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      schoolId: 9,
      administratorInvitation: {
        email: "first.admin@direct-partner.test",
        role: "SCHOOL_ADMIN",
        status: "DISPATCH_REQUESTED",
        dispatchStatus: "REQUEST_ACCEPTED",
      },
    });
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO school_partner_attributions") && sql.includes("PARTNER_DIRECT")
    )).toBe(true);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO schools") && sql.includes("'pending'"))).toBe(true);
    const clerkClaim = state.createInvitation.mock.calls[0][0].publicMetadata.edupulseSchoolInvitation;
    expect(clerkClaim).toMatchObject({
      role: "SCHOOL_ADMIN",
      schoolId: 9,
      partnerRegistrationAttemptId: expect.any(String),
    });
    expect(JSON.stringify(state.createInvitation.mock.calls[0][0].publicMetadata))
      .not.toContain("+2348000000000");
  });

  it("rejects partner school ownership/password fields and uses scoped current-school registration summaries", async () => {
    state.context = {
      user: {
        id: 8,
        clerkUserId: "user_partner_owner",
        email: "partner.owner@example.test",
        firstName: "Partner",
        lastName: "Owner",
        status: "ACTIVE",
      },
      roles: [{ id: 2, role: "PARTNER", schoolId: null, status: "ACTIVE" }],
    };
    const forbidden = await post("/partner/schools", {
      school: { name: "Bad School", city: "Lagos", state: "Lagos", ownerId: 8 },
      administrator: {
        fullName: "First Administrator",
        email: "first.admin@direct-partner.test",
        phone: "+2348000000000",
        password: "not-allowed",
      },
    });
    expect(forbidden.status).toBe(400);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();

    const listed = await fetch(`${baseUrl}/partner/schools`);
    expect(listed.status).toBe(200);
    const summaryQuery = state.queries.find(({ sql }) =>
      sql.includes("FROM school_partner_attributions a JOIN schools s")
    );
    expect(summaryQuery?.sql).toContain("a.is_current=true");
    expect(summaryQuery?.sql).toContain("ua.metadata->>'claimId'=school_invite.metadata->>'claimId'");
    expect(summaryQuery?.sql).toContain("superseded.metadata->>'supersedesClaimId'");
    expect(summaryQuery?.sql).toContain("school_invite.metadata->>'invitationId'");
  });

  it("resends only the selected current partner-school administrator invitation", async () => {
    state.context = {
      user: {
        id: 8,
        clerkUserId: "user_partner_owner",
        email: "partner.owner@example.test",
        firstName: "Partner",
        lastName: "Owner",
        status: "ACTIVE",
      },
      roles: [{ id: 2, role: "PARTNER", schoolId: null, status: "ACTIVE" }],
    };
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles p")) {
        return { rows: [{
          id: 4, status: "ACTIVE", isOwner: true, partnerRole: "PARTNER_OWNER",
        }] };
      }
      if (sql.includes("SELECT i.metadata FROM audit_logs i")) {
        return { rows: [{
          metadata: {
            invitationId: "selected_admin_invite",
            claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            invitedEmail: "admin@partner-school.test",
            role: "SCHOOL_ADMIN",
            phone: "+2348000000000",
          },
        }] };
      }
      return { rows: [] };
    });
    const replace = vi.spyOn(schoolInvitationService, "replaceSchoolAdminInvitation")
      .mockResolvedValue({
        status: "PENDING",
        invitationId: "replacement_admin_invite",
        supersededInvitationId: "selected_admin_invite",
        previousInviteRevoked: true,
        email: "admin@partner-school.test",
        schoolId: 77,
        role: "SCHOOL_ADMIN",
        dispatchStatus: "REQUEST_ACCEPTED",
        deliveryStatus: "UNVERIFIED",
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        recoveryStatus: "COMPLETED",
      });
    try {
      const response = await post(
        "/partner/schools/77/invitations/selected_admin_invite/resend",
        {},
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        invitationId: "replacement_admin_invite",
        supersededInvitationId: "selected_admin_invite",
        schoolId: 77,
        role: "SCHOOL_ADMIN",
      });
      expect(replace).toHaveBeenCalledWith(
        { schoolId: 77, invitationId: "selected_admin_invite" },
        state.context,
      );
      expect(state.queries.some(({ sql, values }) =>
        sql.includes("a.partner_profile_id=$3 AND a.is_current=true") &&
        values[0] === 77 && values[1] === "selected_admin_invite"
      )).toBe(true);
    } finally {
      replace.mockRestore();
    }
  });

  it("preserves permanent direct attribution during conflict resolution while keeping REJECT available", async () => {
    let currentSource: string | null = "PARTNER_DIRECT";
    let conflictStatus = "OPEN";
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes("SELECT * FROM partner_attribution_conflicts")) {
        return conflictStatus === "OPEN"
          ? { rows: [{
            id: 5,
            school_id: 99,
            existing_partner_profile_id: 4,
            attempted_partner_profile_id: 8,
            referral_link_id: null,
            status: "OPEN",
          }] }
          : { rows: [] };
      }
      if (sql.includes("FROM school_partner_attributions") && sql.includes("FOR UPDATE")) {
        return {
          rows: currentSource
            ? [{ source: currentSource, partner_profile_id: 4, is_current: true }]
            : [],
        };
      }
      if (sql.includes("UPDATE school_partner_attributions")) {
        currentSource = null;
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO school_partner_attributions")) {
        currentSource = "PLATFORM_ASSIGNED";
        return { rows: [] };
      }
      if (sql.includes("UPDATE partner_attribution_conflicts")) {
        conflictStatus = String(values[0]);
        return { rows: [] };
      }
      return { rows: [] };
    });
    db.connect.mockResolvedValue({ query: clientQuery, release: db.release } as any);
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM partner_profiles p")) {
        return { rows: [{
          id: 4, status: "ACTIVE", isOwner: true, partnerRole: "PARTNER_OWNER",
        }] };
      }
      if (sql.includes("FROM school_partner_attributions a JOIN schools s")) {
        return { rows: currentSource === "PARTNER_DIRECT"
          ? [{
            schoolId: 99,
            schoolName: "Permanent Direct School",
            schoolCode: "P-DIRECT-99",
            attributionStatus: "ACTIVE",
            attributionSource: currentSource,
          }]
          : [] };
      }
      return { rows: [] };
    });

    const accept = await post("/platform/partner-attribution-conflicts/5/resolve", { decision: "ACCEPT" });
    expect(accept.status).toBe(409);
    expect(await accept.json()).toMatchObject({
      error: expect.stringContaining("permanent partner attribution"),
    });
    expect(currentSource).toBe("PARTNER_DIRECT");
    expect(conflictStatus).toBe("OPEN");
    expect(statements.some(({ sql }) => sql.includes("UPDATE school_partner_attributions"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("INSERT INTO school_partner_attributions"))).toBe(false);

    const reject = await post("/platform/partner-attribution-conflicts/5/resolve", { decision: "REJECT" });
    expect(reject.status).toBe(200);
    expect(await reject.json()).toMatchObject({ id: 5, status: "REJECTED" });
    expect(currentSource).toBe("PARTNER_DIRECT");

    const visibleSchools = await fetch(`${baseUrl}/partner/schools`);
    expect(visibleSchools.status).toBe(200);
    expect(await visibleSchools.json()).toMatchObject([
      expect.objectContaining({
        schoolId: 99,
        attributionSource: "PARTNER_DIRECT",
        attributionStatus: "ACTIVE",
      }),
    ]);
  });

  it("continues accepting attribution conflicts for historical non-direct sources", async () => {
    let currentSource: string | null = "REFERRAL";
    let conflictStatus = "OPEN";
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes("SELECT * FROM partner_attribution_conflicts")) {
        return conflictStatus === "OPEN"
          ? { rows: [{
            id: 6,
            school_id: 100,
            existing_partner_profile_id: 4,
            attempted_partner_profile_id: 8,
            referral_link_id: 12,
            status: "OPEN",
          }] }
          : { rows: [] };
      }
      if (sql.includes("FROM school_partner_attributions") && sql.includes("FOR UPDATE")) {
        return { rows: [{ source: currentSource, partner_profile_id: 4, is_current: true }] };
      }
      if (sql.includes("UPDATE school_partner_attributions")) {
        currentSource = null;
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO school_partner_attributions")) {
        currentSource = "PLATFORM_ASSIGNED";
        return { rows: [] };
      }
      if (sql.includes("UPDATE partner_attribution_conflicts")) {
        conflictStatus = String(values[0]);
        return { rows: [] };
      }
      return { rows: [] };
    });
    db.connect.mockResolvedValue({ query: clientQuery, release: db.release } as any);

    const accepted = await post("/platform/partner-attribution-conflicts/6/resolve", { decision: "ACCEPT" });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ id: 6, status: "ACCEPTED" });
    expect(statements.some(({ sql, values }) =>
      sql.includes("INSERT INTO school_partner_attributions") &&
      sql.includes("'PLATFORM_ASSIGNED'") &&
      values[1] === 8
    )).toBe(true);
    expect(currentSource).toBe("PLATFORM_ASSIGNED");
  });
});