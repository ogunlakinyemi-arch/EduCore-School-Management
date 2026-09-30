import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    roles: [{
      id: 1,
      role: "PLATFORM_OWNER",
      schoolId: null as number | null,
      status: "ACTIVE",
    }],
  },
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  advisoryLocks: new Set<string>(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getInvitationList: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: state.query, connect: state.connect },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: {
      createInvitation: state.createInvitation,
      revokeInvitation: state.revokeInvitation,
      getInvitationList: state.getInvitationList,
    },
    users: { getUser: vi.fn() },
  },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getUserContext: () => state.context,
  };
});

import schoolInvitationManagementRouter from "./school-invitation-management";

const app = express();
app.use(express.json());
app.use(schoolInvitationManagementRouter);
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
  vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-server-key");
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  state.advisoryLocks.clear();
  state.context = {
    user: {
      id: 8, clerkUserId: "user_owner", email: "owner@example.test",
      firstName: "Platform", lastName: "Owner", status: "ACTIVE",
    },
    roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
  };
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
    if (sql.includes("event_type='SCHOOL_ADMIN_INVITED'")) {
      return {
        rows: [
          {
            id: 11,
            createdAt: "2025-01-01T00:00:00.000Z",
            metadata: {
              invitationId: "inv_active",
              claimId: "11111111-1111-4111-8111-111111111111",
              invitedEmail: "active@example.test",
              role: "SCHOOL_ADMIN",
              firstName: "Active",
              lastName: "Admin",
            },
          },
          {
            id: 10,
            createdAt: "2025-01-01T00:00:00.000Z",
            metadata: {
              invitationId: "inv_pending",
              claimId: "22222222-2222-4222-8222-222222222222",
              invitedEmail: "pending@example.test",
              role: "SCHOOL_ADMIN",
              firstName: "Pending",
              lastName: "Admin",
            },
          },
          {
            id: 9,
            createdAt: "2024-12-01T00:00:00.000Z",
            metadata: {
              invitationId: "inv_first_admin",
              claimId: "33333333-3333-4333-8333-333333333333",
              invitedEmail: "first@example.test",
              role: "SCHOOL_ADMIN",
              firstName: "First",
              lastName: "Admin",
            },
          },
          {
            id: 8,
            createdAt: "2024-11-01T00:00:00.000Z",
            metadata: {
              invitationId: "inv_accepted_unlinked",
              claimId: "44444444-4444-4444-8444-444444444444",
              invitedEmail: "accepted@example.test",
              role: "SCHOOL_ADMIN",
              firstName: "Accepted",
              lastName: "Unlinked",
            },
          },
          {
            id: 7,
            createdAt: "2024-10-01T00:00:00.000Z",
            metadata: {
              invitationId: "inv_historical_same_email",
              claimId: "55555555-5555-4555-8555-555555555555",
              invitedEmail: "active@example.test",
              role: "SCHOOL_ADMIN",
              firstName: "Historical",
              lastName: "Invite",
            },
          },
        ],
      };
    }
    if (sql.includes("supersedesClaimId")) return { rows: [] };
    if (sql.includes("FROM school_memberships sm")) {
      return {
        rows: [{
          email: "active@example.test",
          membershipStatus: "ACTIVE",
          membershipId: 71,
          userId: 21,
        }],
      };
    }
    if (sql.includes("event_type='USER_ACTIVATED'")) {
      return {
        rows: [{
          claimId: "11111111-1111-4111-8111-111111111111",
          membershipId: 71,
        }],
      };
    }
    if (sql.includes("metadata->>'invitationId'=$1")) return { rows: [{ "?column?": 1 }] };
    return { rows: [] };
  });
  state.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("pg_try_advisory_lock")) {
      const lockKey = String(values[0]);
      if (state.advisoryLocks.has(lockKey)) return { rows: [{ locked: false }] };
      state.advisoryLocks.add(lockKey);
      return { rows: [{ locked: true }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      const lockKey = String(values[0]);
      const unlocked = state.advisoryLocks.delete(lockKey);
      return { rows: [{ unlocked }] };
    }
    if (sql.includes("metadata->>'invitationId'=$2")) return { rows: [{ id: 11 }] };
    return { rows: [] };
  });
  state.connect.mockResolvedValue({ query: state.clientQuery, release: state.release });
  state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => ({
    data: query === "inv_accepted_unlinked"
      ? status === "accepted" ? [{ id: query, status: "accepted", publicMetadata: {} }] : []
      : status === "pending" ? [{
          id: query,
          status: "pending",
          publicMetadata: {
            edupulseSchoolInvitation: {
              claimId: "11111111-1111-4111-8111-111111111111",
              firstName: "Old",
              lastName: "Admin",
            },
          },
        }] : [],
  }));
  state.createInvitation.mockResolvedValue({
    id: "inv_replacement",
    createdAt: Date.now(),
    status: "pending",
  });
  state.revokeInvitation.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

function expectPublicInvitationUrl(value: string) {
  const url = new URL(value);
  expect(url.origin).toBe(PUBLIC_PRODUCTION_ORIGIN);
  expect(url.pathname).toBe("/accept-invitation");
  for (const forbidden of [
    "riker.replit.dev",
    ".replit.dev",
    "replit.com/silent-auth",
    "__replshield",
    "privateDevDomain=true",
  ]) {
    expect(value).not.toContain(forbidden);
  }
}

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Platform Owner school invitation management", () => {
  it("lists invitation lifecycle status separately from Clerk delivery confirmation", async () => {
    const response = await request("/schools/3/invitations");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schoolId: 3,
      role: "SCHOOL_ADMIN",
      invitations: [
        {
          invitationId: "inv_active",
          status: "ACTIVE",
          clerkStatus: null,
          membershipId: 71,
        },
        {
          invitationId: "inv_pending",
          status: "PENDING",
          clerkStatus: "pending",
          email: "pending@example.test",
        },
        {
          invitationId: "inv_first_admin",
          status: "PENDING",
          clerkStatus: "pending",
          email: "first@example.test",
        },
        {
          invitationId: "inv_accepted_unlinked",
          status: "PENDING",
          clerkStatus: "accepted",
          membershipId: null,
          userId: null,
        },
        {
          invitationId: "inv_historical_same_email",
          status: "PENDING",
          clerkStatus: "pending",
          membershipId: null,
          userId: null,
        },
      ],
    });
  });

  it("replaces an invitation and reports whether the prior Clerk invitation was revoked", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM audit_logs") && sql.includes("SCHOOL_ADMIN_INVITED")) {
        return {
          rows: [{
            id: 12,
            metadata: {
              invitationId: "inv_pending",
              claimId: "22222222-2222-4222-8222-222222222222",
              invitedEmail: "pending@example.test",
              firstName: "Pending",
              lastName: "Admin",
            },
          }],
        };
      }
      if (sql.includes("metadata->>'supersedesClaimId'")) return { rows: [] };
      if (sql.includes("JOIN school_memberships")) return { rows: [] };
      if (sql.includes("metadata->>'invitationId'=$1")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    const response = await request(
      "/schools/3/invitations/inv_pending",
      "PATCH",
      { email: "correct@example.test" },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "PENDING",
      invitationId: "inv_replacement",
      supersededInvitationId: "inv_pending",
      previousInviteRevoked: true,
      email: "correct@example.test",
    });
    expect(state.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "correct@example.test",
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
      ignoreExisting: false,
    }));
    const replacement = state.createInvitation.mock.calls[0][0];
    expectPublicInvitationUrl(replacement.redirectUrl);
    expect(replacement.publicMetadata.edupulseSchoolInvitation).toMatchObject({
      schoolId: 3,
      role: "SCHOOL_ADMIN",
      emailProof: expect.any(String),
    });
    expect(replacement.publicMetadata.edupulseSchoolInvitation.claimId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(replacement.publicMetadata.edupulseSchoolInvitation.emailProof).toMatch(/^[a-f0-9]{64}$/);
    expect(state.revokeInvitation).toHaveBeenCalledWith("inv_pending");
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SCHOOL_INVITATION_SUPERSEDED"),
      expect.any(Array),
    );
  });

  it("resends an expired invitation without treating it as confirmed email delivery", async () => {
    const schoolAdminInvitations = [
      {
        id: 13,
        metadata: {
          invitationId: "inv_a",
          claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          invitedEmail: "a@example.test",
          firstName: "Invitee",
          lastName: "A",
        },
      },
      {
        id: 12,
        metadata: {
          invitationId: "inv_pending",
          claimId: "22222222-2222-4222-8222-222222222222",
          invitedEmail: "pending@example.test",
          firstName: "Pending",
          lastName: "Admin",
        },
      },
      {
        id: 11,
        metadata: {
          invitationId: "inv_c",
          claimId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          invitedEmail: "c@example.test",
          firstName: "Invitee",
          lastName: "C",
        },
      },
    ];
    state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM audit_logs") && sql.includes("SCHOOL_ADMIN_INVITED")) {
        return {
          rows: schoolAdminInvitations.filter((row) =>
            row.metadata.invitationId === values[1]
          ),
        };
      }
      if (sql.includes("metadata->>'supersedesClaimId'")) return { rows: [] };
      if (sql.includes("JOIN school_memberships")) return { rows: [] };
      if (sql.includes("metadata->>'invitationId'=$1")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => ({
      data: status === "expired" && query === "inv_pending"
        ? [{ id: query, status: "expired", publicMetadata: {} }]
        : [],
    }));

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "PENDING",
      dispatchStatus: "REQUEST_ACCEPTED",
      deliveryStatus: "UNVERIFIED",
      email: "pending@example.test",
    });
    expect(state.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "pending@example.test",
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
    }));
    const resent = state.createInvitation.mock.calls[0][0];
    expectPublicInvitationUrl(resent.redirectUrl);
    expect(resent.publicMetadata.edupulseSchoolInvitation).toMatchObject({
      schoolId: 3,
      role: "SCHOOL_ADMIN",
      emailProof: expect.any(String),
    });
    expect(resent.publicMetadata.edupulseSchoolInvitation.claimId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.revokeInvitation).toHaveBeenCalledWith("inv_pending");
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation.mock.calls[0][0].emailAddress).not.toBe("inv_a@example.test");
    expect(state.createInvitation.mock.calls[0][0].emailAddress).not.toBe("inv_c@example.test");
    expect(state.getInvitationList.mock.calls.every(([query]) =>
      (query as { query: string }).query === "inv_pending"
    )).toBe(true);
    expect(state.query.mock.calls.filter(([sql]) =>
      String(sql).includes("event_type='SCHOOL_ADMIN_INVITED'")
    )).toEqual(expect.arrayContaining([
      [expect.any(String), [3, "inv_pending"]],
    ]));
    const sourceMetadataUpdate = state.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("supersededByInvitationId")
    );
    expect(sourceMetadataUpdate?.[1]).toEqual([
      expect.any(String),
      "inv_replacement",
      3,
      "inv_pending",
    ]);
    expect(state.clientQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes("supersededByInvitationId") &&
      (values as unknown[])[3] === "inv_a"
    )).toBe(false);
    expect(state.clientQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes("supersededByInvitationId") &&
      (values as unknown[])[3] === "inv_c"
    )).toBe(false);
  });

  it("serializes concurrent replacement requests for the same School Admin invitation", async () => {
    let releaseDispatch!: () => void;
    let signalDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      signalDispatch = resolve;
    });
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    state.createInvitation.mockImplementationOnce(async () => {
      signalDispatch();
      await dispatchGate;
      return { id: "inv_replacement", createdAt: Date.now(), status: "pending" };
    });

    const firstRequest = request("/schools/3/invitations/inv_pending/resend", "POST", {});
    await dispatchStarted;
    const concurrentResponse = await request(
      "/schools/3/invitations/inv_pending/resend",
      "POST",
      {},
    );
    expect(concurrentResponse.status).toBe(409);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);

    releaseDispatch();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(201);
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.advisoryLocks.size).toBe(0);
  });

  it("does not allow an invitation from another school to be replaced or resent", async () => {
    state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM audit_logs") && sql.includes("SCHOOL_ADMIN_INVITED")) {
        return values[0] === 4 ? { rows: [] } : { rows: [] };
      }
      return { rows: [] };
    });

    const replaced = await request("/schools/4/invitations/inv_pending", "PATCH", {
      email: "replacement@example.test",
    });
    const resent = await request("/schools/4/invitations/inv_pending/resend", "POST", {});

    expect(replaced.status).toBe(404);
    expect(resent.status).toBe(404);
    expect(state.getInvitationList).not.toHaveBeenCalled();
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.query.mock.calls.filter(([sql]) =>
      String(sql).includes("SCHOOL_ADMIN_INVITED")
    )).toEqual(expect.arrayContaining([
      [expect.any(String), [4, "inv_pending"]],
    ]));
  });

  it("does not resend a Clerk invitation that is already accepted", async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM audit_logs") && sql.includes("SCHOOL_ADMIN_INVITED")) {
        return {
          rows: [{
            id: 12,
            metadata: {
              invitationId: "inv_pending",
              claimId: "22222222-2222-4222-8222-222222222222",
              invitedEmail: "pending@example.test",
              firstName: "Pending",
              lastName: "Admin",
            },
          }],
        };
      }
      return { rows: [] };
    });
    state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => ({
      data: query === "inv_pending" && status === "accepted"
        ? [{ id: query, status: "accepted", publicMetadata: {} }]
        : [],
    }));

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});

    expect(response.status).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.revokeInvitation).not.toHaveBeenCalled();
  });

  it.each([
    { role: "SCHOOL_ADMIN", schoolId: 3, status: "ACTIVE" },
    { role: "PLATFORM_OWNER", schoolId: 3, status: "ACTIVE" },
    { role: "PLATFORM_OWNER", schoolId: null, status: "INACTIVE" },
  ])("rejects non-global/active owner authorization for list, replace, and resend ($role, $schoolId, $status)", async (assignment) => {
    state.context.roles = [{ id: 2, ...assignment }];
    const endpoints = [
      ["/schools/3/invitations", "GET", undefined],
      ["/schools/3/invitations/inv_pending", "PATCH", { email: "replacement@example.test" }],
      ["/schools/3/invitations/inv_pending/resend", "POST", {}],
    ] as const;

    for (const [path, method, body] of endpoints) {
      expect((await request(path, method, body)).status).toBe(403);
    }
    expect(state.query).toHaveBeenCalledTimes(endpoints.length);
    expect(state.query.mock.calls.every(([sql]) =>
      String(sql).includes("INSERT INTO audit_logs") && String(sql).includes("'DENIED'")
    )).toBe(true);
    expect(state.clientQuery).not.toHaveBeenCalled();
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it("does not permit a School Admin to resend a School Admin invitation", async () => {
    state.context.roles = [{
      id: 2,
      role: "SCHOOL_ADMIN",
      schoolId: 3,
      status: "ACTIVE",
    }];

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});

    expect(response.status).toBe(403);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls.every(([sql]) =>
      String(sql).includes("INSERT INTO audit_logs") && String(sql).includes("'DENIED'")
    )).toBe(true);
    expect(state.getInvitationList).not.toHaveBeenCalled();
    expect(state.createInvitation).not.toHaveBeenCalled();
  });
});