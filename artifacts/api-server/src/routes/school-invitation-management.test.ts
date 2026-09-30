import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.clearAllMocks();
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
  state.clientQuery.mockImplementation(async (sql: string) => {
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
      redirectUrl: "/accept-invitation",
      ignoreExisting: false,
    }));
    expect(state.revokeInvitation).toHaveBeenCalledWith("inv_pending");
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SCHOOL_INVITATION_SUPERSEDED"),
      expect.any(Array),
    );
  });

  it("resends an expired invitation without treating it as confirmed email delivery", async () => {
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
      redirectUrl: "/accept-invitation",
    }));
    expect(state.revokeInvitation).toHaveBeenCalledWith("inv_pending");
  });

  it("does not allow a School Admin to manage school administrator invitations", async () => {
    state.context.roles = [{
      id: 2,
      role: "SCHOOL_ADMIN",
      schoolId: 3,
      status: "ACTIVE",
    }];
    const response = await request("/schools/3/invitations");
    expect(response.status).toBe(403);
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("FROM schools"))).toBe(false);
  });
});