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
      revokeInvitation: vi.fn(),
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

import partnersRouter from "./partners";

const app = express();
app.use(express.json());
app.use(partnersRouter);
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
    if (sql.includes("FROM partner_profiles p")) return { rows: [{ id: 4, status: "ACTIVE" }] };
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
    expect(state.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "partner@example.test",
      notify: true,
      ignoreExisting: false,
    }));
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
});