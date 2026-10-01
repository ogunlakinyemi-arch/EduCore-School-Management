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
  ownerRecords: [] as any[],
  attempts: new Map<string, any>(),
  providerInvitations: new Map<string, any>(),
  providerEvents: [] as string[],
  createdOptions: null as any,
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getInvitationList: vi.fn(),
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
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
    users: {
      getUser: state.getUser,
      updateUserMetadata: state.updateUserMetadata,
    },
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
import { activateAcceptedSchoolInvitation } from "./school-invitations";

const ownerInvitationRows = [
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
];

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
  state.ownerRecords = ownerInvitationRows.map((item) => ({ ...item, metadata: { ...item.metadata } }));
  state.attempts.clear();
  state.providerInvitations.clear();
  state.providerEvents.length = 0;
  for (const record of state.ownerRecords) {
    state.providerInvitations.set(record.metadata.invitationId, {
      id: record.metadata.invitationId,
      emailAddress: record.metadata.invitedEmail,
      status: record.metadata.invitationId === "inv_accepted_unlinked" ? "accepted" : "pending",
      publicMetadata: {
        edupulseSchoolInvitation: {
          schoolId: 3,
          role: "SCHOOL_ADMIN",
          claimId: record.metadata.claimId,
          firstName: record.metadata.firstName,
          lastName: record.metadata.lastName,
        },
      },
    });
  }
  state.context = {
    user: {
      id: 8, clerkUserId: "user_owner", email: "owner@example.test",
      firstName: "Platform", lastName: "Owner", status: "ACTIVE",
    },
    roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
  };
  state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
    if (sql.includes("SELECT") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      if (sql.includes("metadata->>'selectedInvitationId'=$2")) {
        const attempt = [...state.attempts.values()].find((item) => item.metadata.selectedInvitationId === values[1]);
        return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
      }
      if (sql.includes("FROM audit_logs attempt")) {
        return {
          rows: [...state.attempts.values()]
            .filter((item) => [
              "PREPARED", "REVOCATION_REJECTED", "REVOCATION_UNKNOWN", "DISPATCHING",
              "DISPATCH_REJECTED", "OUTCOME_UNKNOWN", "MULTIPLE_MATCHES",
            ].includes(item.metadata.attemptStatus))
            .map((item) => ({ id: item.id, metadata: item.metadata, createdAt: item.createdAt })),
        };
      }
      const attempt = state.attempts.get(String(values[1] ?? ""));
      return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("metadata->>'attemptId'=$2")) {
      const attempt = state.attempts.get(String(values[1] ?? ""));
      if (!attempt || attempt.metadata.attemptStatus !== "PREPARED") return { rows: [] };
      attempt.metadata = { ...attempt.metadata, attemptStatus: "DISPATCHING" };
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      const attempt = state.attempts.get(String(values[2] ?? ""));
      if (!attempt) return { rows: [] };
      attempt.metadata = { ...attempt.metadata, ...JSON.parse(String(values[0])) };
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("metadata->>'invitationId'=$2")) {
      const record = state.ownerRecords.find((item) => item.metadata.invitationId === values[1]);
      return record ? { rows: [{ id: record.id, metadata: record.metadata }] } : { rows: [] };
    }
    if (sql.includes("event_type='SCHOOL_ADMIN_INVITED'")) {
      return { rows: state.ownerRecords };
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
    if (sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("SELECT")) {
      const attempt = state.attempts.get(String(values[1] ?? ""));
      return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
    }
    if (
      sql.includes("UPDATE audit_logs") &&
      (sql.includes("RETURNING metadata") || sql.includes("CANCELLED"))
    ) {
      const attemptId = state.attempts.has(String(values[1] ?? ""))
        ? String(values[1])
        : String(values[0] ?? "");
      const attempt = state.attempts.get(attemptId);
      if (!attempt) return { rows: [] };
      if (sql.includes("$1::jsonb")) {
        attempt.metadata = { ...attempt.metadata, ...JSON.parse(String(values[0])) };
      } else if (sql.includes("DISPATCHING")) {
        attempt.metadata = { ...attempt.metadata, attemptStatus: "DISPATCHING" };
      } else if (sql.includes("CANCELLED")) {
        attempt.metadata = { ...attempt.metadata, attemptStatus: "CANCELLED" };
      }
      return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
    }
    if (sql.includes("metadata->>'invitationId'=$2")) {
      const record = state.ownerRecords.find((item) => item.metadata.invitationId === values[1]);
      return record ? { rows: [{ id: record.id, metadata: record.metadata }] } : { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("supersededByAttemptId")) {
      const record = state.ownerRecords.find((item) => item.id === values[2]);
      if (record) record.metadata = { ...record.metadata, superseded: true };
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
      const metadata = JSON.parse(String(values[5]));
      state.attempts.set(metadata.attemptId, { id: metadata.attemptId, metadata, createdAt: new Date().toISOString() });
      return { rows: [] };
    }
    if (sql.includes("UPDATE audit_logs") && sql.includes("providerInvitationId")) {
      const attempt = [...state.attempts.values()].find((item) => item.id === values[1]);
      if (attempt) attempt.metadata = { ...attempt.metadata, attemptStatus: "COMPLETED", providerInvitationId: values[0] };
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_logs") && values[7] === "SCHOOL_ADMIN_INVITED") {
      const metadata = JSON.parse(String(values[8]));
      const marker = state.createdOptions?.publicMetadata?.edupulseSchoolInvitation;
      const record = {
        id: metadata.invitationId,
        createdAt: new Date().toISOString(),
        metadata,
        publicMetadata: { edupulseSchoolInvitation: marker },
      };
      state.ownerRecords.unshift(record);
      return { rows: [] };
    }
    return { rows: [] };
  });
  state.connect.mockResolvedValue({ query: state.clientQuery, release: state.release });
  state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => {
    const provider = [...state.providerInvitations.values()].find((item) =>
      item.id === query || item.emailAddress === query
    );
    if (provider) return provider.status === status ? { data: [provider] } : { data: [] };
    const record = state.ownerRecords.find((item) => item.metadata.invitationId === query);
    if (!record) return { data: [] };
    const currentStatus = query === "inv_accepted_unlinked" ? "accepted" : "pending";
    return status === currentStatus
      ? {
          data: [{
            id: query,
            status,
            publicMetadata: {
              edupulseSchoolInvitation: {
                claimId: record.metadata.claimId,
                schoolId: 3,
                role: "SCHOOL_ADMIN",
                firstName: "Old",
                lastName: "Admin",
              },
            },
          }],
        }
      : { data: [] };
  });
  state.createInvitation.mockImplementation(async (options: any) => {
    state.providerEvents.push(`create:${options.emailAddress}`);
    if ([...state.providerInvitations.values()].some((item) =>
      item.emailAddress === options.emailAddress && item.status === "pending"
    )) {
      throw { status: 422, errors: [{ code: "form_identifier_exists" }] };
    }
    state.createdOptions = options;
    const invitation = { id: "inv_replacement", createdAt: Date.now(), status: "pending" };
    state.providerInvitations.set(invitation.id, {
      ...invitation,
      emailAddress: options.emailAddress,
      publicMetadata: options.publicMetadata,
    });
    return invitation;
  });
  state.revokeInvitation.mockImplementation(async (id: string) => {
    state.providerEvents.push(`revoke:${id}`);
    const current = state.providerInvitations.get(id);
    if (current) state.providerInvitations.set(id, { ...current, status: "revoked" });
    return {};
  });
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
          status: "ACCEPTED",
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
    const response = await request(
      "/schools/3/invitations/inv_pending",
      "PATCH",
      { email: "correct@example.test" },
    );
    expect(response.status, await response.clone().text()).toBe(201);
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
    expect(state.providerEvents).toEqual([
      "revoke:inv_pending",
      "create:correct@example.test",
    ]);
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
    state.ownerRecords = schoolAdminInvitations.map((item) => ({
      ...item,
      metadata: { role: "SCHOOL_ADMIN", ...item.metadata },
    }));
    state.providerInvitations.set("inv_pending", {
      ...state.providerInvitations.get("inv_pending"),
      status: "expired",
    });
    state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => ({
      data: status === "expired" && query === "inv_pending"
        ? [{
            id: query,
            status: "expired",
            publicMetadata: {
              edupulseSchoolInvitation: {
                claimId: "22222222-2222-4222-8222-222222222222",
                schoolId: 3,
                role: "SCHOOL_ADMIN",
              },
            },
          }]
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
    expect(state.revokeInvitation).not.toHaveBeenCalled();
    expect(state.providerEvents).toEqual(["create:pending@example.test"]);
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
      String(sql).includes("supersededByAttemptId")
    );
    expect(sourceMetadataUpdate?.[1]).toEqual([
      expect.any(String),
      expect.any(String),
      12,
      3,
    ]);
    expect(state.clientQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes("supersededByAttemptId") &&
      (values as unknown[])[2] === "inv_a"
    )).toBe(false);
    expect(state.clientQuery.mock.calls.some(([sql, values]) =>
      String(sql).includes("supersededByAttemptId") &&
      (values as unknown[])[2] === "inv_c"
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
    state.getInvitationList.mockImplementation(async ({ query, status }: { query: string; status: string }) => ({
      data: query === "inv_pending" && status === "accepted"
        ? [{ id: query, status: "accepted", publicMetadata: {} }]
        : [],
    }));

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});

    expect(response.status, await response.clone().text()).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.revokeInvitation).not.toHaveBeenCalled();
  });

  it("preserves the accepted source claim when Clerk acceptance wins during revocation", async () => {
    state.revokeInvitation.mockImplementationOnce(async (invitationId: string) => {
      state.providerEvents.push(`revoke:${invitationId}`);
      state.providerInvitations.set(invitationId, {
        ...state.providerInvitations.get(invitationId),
        status: "accepted",
      });
    });

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});
    expect(response.status, await response.clone().text()).toBe(409);
    expect(state.createInvitation).not.toHaveBeenCalled();
    expect(state.ownerRecords.find((item) => item.metadata.invitationId === "inv_pending").metadata.superseded)
      .not.toBe(true);
    expect([...state.attempts.values()][0].metadata.attemptStatus).toBe("CANCELLED");
    expect(state.providerEvents).toEqual(["revoke:inv_pending"]);

    const listing = await request("/schools/3/invitations");
    expect((await listing.json() as any).invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ invitationId: "inv_pending", status: "ACCEPTED", isCurrent: true }),
    ]));
  });

  it("safely retries a known Clerk rejection with the same staged Owner attempt", async () => {
    state.createInvitation.mockImplementationOnce(async (options: any) => {
      state.providerEvents.push(`create:${options.emailAddress}`);
      throw { status: 422, errors: [{ code: "form_identifier_exists" }] };
    });

    const rejected = await request("/schools/3/invitations/inv_pending/resend", "POST", {});
    expect(rejected.status).toBe(503);
    const attempt = [...state.attempts.values()][0];
    expect(attempt.metadata.attemptStatus).toBe("DISPATCH_REJECTED");
    expect(state.providerEvents).toEqual([
      "revoke:inv_pending",
      "create:pending@example.test",
    ]);

    const listing = await request("/schools/3/invitations");
    expect((await listing.json() as any).invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: "inv_pending",
        status: "RECOVERY_REQUIRED",
        recoveryState: "DISPATCH_REJECTED",
      }),
    ]));
    const recovered = await request("/schools/3/invitations/inv_pending/reconcile", "POST", {});
    expect(recovered.status).toBe(200);
    expect((await recovered.json() as any)).toMatchObject({
      status: "PENDING",
      invitationId: "inv_replacement",
      previousInviteRevoked: true,
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(2);
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.providerEvents).toEqual([
      "revoke:inv_pending",
      "create:pending@example.test",
      "create:pending@example.test",
    ]);
  });

  it("lists a partner-onboarded School Admin invitation and resends only its recorded invitation ID", async () => {
    const partnerOnboardedInvitation = {
      id: 17,
      createdAt: "2025-02-01T00:00:00.000Z",
      metadata: {
        invitationId: "partner_onboarded_admin",
        claimId: "77777777-7777-4777-8777-777777777777",
        invitedEmail: "partner-school-admin@example.test",
        role: "SCHOOL_ADMIN",
        firstName: "Partner",
        lastName: "Administrator",
      },
    };
    state.ownerRecords = [partnerOnboardedInvitation];
    state.providerInvitations.set("partner_onboarded_admin", {
      id: "partner_onboarded_admin",
      emailAddress: "partner-school-admin@example.test",
      status: "pending",
      publicMetadata: {
        edupulseSchoolInvitation: {
          schoolId: 3,
          role: "SCHOOL_ADMIN",
          claimId: partnerOnboardedInvitation.metadata.claimId,
        },
      },
    });
    state.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT")) {
        if (sql.includes("metadata->>'selectedInvitationId'=$2")) {
          const attempt = [...state.attempts.values()].find((item) =>
            item.metadata.selectedInvitationId === values[1]
          );
          return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
        }
        const attempt = state.attempts.get(String(values[1] ?? ""));
        return attempt ? { rows: [{ id: attempt.id, metadata: attempt.metadata }] } : { rows: [] };
      }
      if (sql.includes("UPDATE audit_logs") && sql.includes("SCHOOL_INVITATION_REPLACEMENT_ATTEMPT") && sql.includes("metadata->>'attemptId'=$2")) {
        const attempt = state.attempts.get(String(values[1] ?? ""));
        if (!attempt || attempt.metadata.attemptStatus !== "PREPARED") return { rows: [] };
        attempt.metadata = { ...attempt.metadata, attemptStatus: "DISPATCHING" };
        return { rows: [{ id: attempt.id, metadata: attempt.metadata }] };
      }
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM audit_logs") && sql.includes("event_type='SCHOOL_ADMIN_INVITED'")) {
        return values[1] === "partner_onboarded_admin"
          ? { rows: [partnerOnboardedInvitation] }
          : { rows: [partnerOnboardedInvitation] };
      }
      if (sql.includes("metadata->>'supersedesClaimId'")) return { rows: [] };
      if (sql.includes("JOIN school_memberships")) return { rows: [] };
      if (sql.includes("event_type='USER_ACTIVATED'")) return { rows: [] };
      if (sql.includes("metadata->>'invitationId'=$1")) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });

    const listing = await request("/schools/3/invitations");
    expect(listing.status).toBe(200);
    expect(await listing.json()).toMatchObject({
      invitations: [expect.objectContaining({
        invitationId: "partner_onboarded_admin",
        email: "partner-school-admin@example.test",
        role: "SCHOOL_ADMIN",
        status: "PENDING",
      })],
    });

    const resent = await request("/schools/3/invitations/partner_onboarded_admin/resend", "POST", {});
    expect(resent.status).toBe(201);
    expect(await resent.json()).toMatchObject({
      supersededInvitationId: "partner_onboarded_admin",
      email: "partner-school-admin@example.test",
      role: "SCHOOL_ADMIN",
    });
    expect(state.createInvitation).toHaveBeenCalledTimes(1);
    expect(state.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "partner-school-admin@example.test",
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
    }));
    expect(state.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(state.revokeInvitation).toHaveBeenCalledWith("partner_onboarded_admin");
  });

  it("preserves the private administrator phone through selected resend and accepted activation", async () => {
    const phone = "+2348035550199";
    const source = state.ownerRecords.find((item) => item.metadata.invitationId === "inv_pending");
    source.metadata.phone = phone;

    const response = await request("/schools/3/invitations/inv_pending/resend", "POST", {});
    expect(response.status).toBe(201);
    const replacementRecord = state.ownerRecords[0];
    expect(replacementRecord.metadata).toMatchObject({
      invitationId: "inv_replacement",
      phone,
    });
    expect(state.createdOptions.publicMetadata.edupulseSchoolInvitation).not.toHaveProperty("phone");

    state.getUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: "pending@example.test",
        verification: { status: "verified" },
      },
      publicMetadata: state.createdOptions.publicMetadata,
      firstName: "Pending",
      lastName: "Admin",
      phoneNumbers: [],
    });
    state.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "pending@example.test", status: "ACTIVE" }] };
      }
      if (sql.includes("current_invite.id")) return { rows: [{ id: 10, invitedPhone: phone }] };
      if (sql.includes("INSERT INTO school_memberships")) return { rows: [{ id: 72 }] };
      return { rows: [] };
    });

    await expect(activateAcceptedSchoolInvitation(21, "user_pending_admin")).resolves.toBe(true);
    const appUserPhoneUpdate = state.clientQuery.mock.calls.find(([sql]) =>
      sql.includes("UPDATE app_users SET first_name")
    );
    expect(appUserPhoneUpdate?.[1][2]).toBe(phone);
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