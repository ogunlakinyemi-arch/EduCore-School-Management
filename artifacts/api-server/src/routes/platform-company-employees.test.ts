import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  rows: [] as Array<Record<string, any>>,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  invitation: { id: "inv_company_1", createdAt: Date.now() },
  latestInvite: null as Record<string, any> | null,
  activeMembership: false,
}));

const query = vi.hoisted(() => vi.fn(async (sql: string, values: unknown[] = []) => {
  state.calls.push({ sql, values });
  if (sql.includes("FROM (\n         SELECT metadata FROM audit_logs")) {
    return { rows: state.latestInvite ? [{ metadata: state.latestInvite, invalidated: false }] : [] };
  }
  if (sql.includes("FROM (SELECT 1) seed")) {
    return { rows: [{
      role: state.latestInvite?.role ?? null,
      schoolId: state.latestInvite?.schoolId ?? null,
      claimId: state.latestInvite?.claimId ?? null,
      invitationId: state.latestInvite?.invitationId ?? null,
      expiresAt: state.latestInvite?.expiresAt ?? null,
      hasActiveMembership: state.activeMembership,
      invalidated: false,
    }] };
  }
  if (sql.includes("JOIN school_memberships sm") && sql.includes("FROM app_users au")) {
    return { rows: state.activeMembership ? [{ id: 1 }] : [] };
  }
  if (sql.includes("INSERT INTO audit_logs")) {
    const metadataIndex = sql.includes("'INTERNAL_EMPLOYEE_INVITED'") ? 4 : 6;
    if (typeof values[metadataIndex] === "string") {
      const metadata = JSON.parse(String(values[metadataIndex]));
      if (metadata.claimId) state.latestInvite = metadata;
    }
    return { rows: [] };
  }
  if (sql.includes("UPDATE platform_company_employees SET email=")) {
    return {
      rows: [{
        ...state.rows[0],
        email: values[0],
      }],
    };
  }
  if (sql.includes("INSERT INTO platform_company_employees")) {
    return { rows: [{ ...state.rows[0], id: 42, fullName: values[0], email: values[1], phone: values[2], jobTitle: values[3], status: "ACTIVE" }] };
  }
  if (sql.includes("FROM schools WHERE id=$1")) return { rows: [{ id: values[0] }] };
  if (sql.includes("UPDATE platform_company_employees")) {
    return { rows: [{ ...state.rows[0], fullName: values[0], email: values[1], phone: values[2], jobTitle: values[3], status: values[4] }] };
  }
  if (sql.includes("WHERE id=$1")) return { rows: state.rows.filter((row) => row.id === values[0]) };
  if (sql.includes("FROM platform_company_employees")) return { rows: state.rows };
  return { rows: [] };
}));

const client = vi.hoisted(() => ({
  query,
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query, connect: vi.fn(async () => client) },
}));
const createInvitation = vi.hoisted(() => vi.fn(async (_input: { redirectUrl: string; [key: string]: any }) =>
  state.invitation));
const revokeInvitation = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: { createInvitation, revokeInvitation },
  },
}));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: (_req: express.Request, roles: string[]) => {
    if (!roles.includes(state.role)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  },
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "owner", email: "owner@example.test", firstName: "Yemait", lastName: "Owner" },
    roles: [{ role: state.role, schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import companyEmployeesRouter from "./platform-company-employees";

const app = express();
app.use(express.json());
app.use(companyEmployeesRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(Number((error as { statusCode?: number })?.statusCode) || 500)
    .json({ error: error instanceof Error ? error.message : "Internal Server Error" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  state.role = "PLATFORM_OWNER";
  state.rows = [{
    id: 7, fullName: "Ada Staff", email: "ada@example.test", phone: null, jobTitle: "Operations",
    status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }];
  state.calls.length = 0;
  state.latestInvite = null;
  state.activeMembership = false;
  vi.clearAllMocks();
});

function expectPublicInternalInvitationUrl(value: string) {
  const url = new URL(value);
  expect(url.origin).toBe(PUBLIC_PRODUCTION_ORIGIN);
  expect(url.pathname).toBe("/accept-invitation");
  expect(url.search).toBe("");
  for (const prohibited of [
    "riker.replit.dev", ".replit.dev", "replit.com/silent-auth",
    "__replshield", "privateDevDomain=true", "__clerk_ticket",
  ]) {
    expect(value).not.toContain(prohibited);
  }
}

afterEach(() => {
  for (const [request] of createInvitation.mock.calls) {
    expectPublicInternalInvitationUrl(String(request.redirectUrl));
  }
});

describe("platform company employee profiles", () => {
  it("allows only Platform Owners to list and read company profiles", async () => {
    const list = await fetch(`${baseUrl}/platform/company-employees`);
    expect(list.status).toBe(200);
    expect(await list.json()).toHaveLength(1);

    const detail = await fetch(`${baseUrl}/platform/company-employees/7`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: 7, fullName: "Ada Staff" });

    state.role = "SCHOOL_ADMIN";
    const denied = await fetch(`${baseUrl}/platform/company-employees`);
    expect(denied.status).toBe(403);
    const deniedCreate = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Not allowed", email: "denied@example.test" }),
    });
    expect(deniedCreate.status).toBe(403);
    const deniedUpdate = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    expect(deniedUpdate.status).toBe(403);
  });

  it("creates the company profile and dispatches the selected role invitation without creating a school account", async () => {
    process.env.CLERK_SECRET_KEY = "test-clerk-secret";
    const response = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Grace Employee", email: "GRACE@example.test", jobTitle: "Support",
        role: "COMPANY_ACCOUNTANT",
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 42, fullName: "Grace Employee", email: "grace@example.test",
      role: "COMPANY_ACCOUNTANT", schoolId: null,
      invitation: { status: "DISPATCH_REQUEST_ACCEPTED", deliveryConfirmed: false },
    });
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "grace@example.test",
      notify: true,
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
      publicMetadata: expect.objectContaining({
        edupulseInternalEmployeeInvitation: expect.objectContaining({
          employeeId: 42, role: "COMPANY_ACCOUNTANT", schoolId: null,
        }),
      }),
    }));
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.calls.some(({ sql }) => /INSERT INTO (app_users|school_memberships|employees)/.test(sql))).toBe(false);
    expect(state.calls.some(({ sql }) => sql === "COMMIT")).toBe(true);
  });

  it("requires an authorized school when creating an activation officer invitation", async () => {
    const response = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Activation Officer", email: "officer@example.test",
        role: "DEVICE_ACTIVATION_OFFICER",
      }),
    });
    expect(response.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("denies internal invitation creation and resend to non-Platform-Owners", async () => {
    state.role = "SCHOOL_ADMIN";
    const created = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Unauthorized Employee",
        email: "unauthorized@example.test",
        role: "COMPANY_ACCOUNTANT",
      }),
    });
    const resent = await fetch(`${baseUrl}/platform/company-employees/7/invitation/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(403);
    expect(resent.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("updates profile fields with an audit event and rejects account or school fields", async () => {
    const response = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "inactive", phone: "+2348000000000" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 7, status: "INACTIVE" });
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);

    const invalid = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 20, schoolId: 1 }),
    });
    expect(invalid.status).toBe(400);
  });

  it("reports ACTIVE only from an active internal membership, not employee profile status", async () => {
    state.rows[0].status = "INACTIVE";
    state.activeMembership = true;
    const response = await fetch(`${baseUrl}/platform/company-employees/7/invitation`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ employeeId: 7, status: "ACTIVE" });
  });

  it("reports PENDING from an unexpired invitation and keeps invitation status owner-only", async () => {
    state.latestInvite = {
      role: "COMPANY_ACCOUNTANT",
      schoolId: null,
      claimId: "pending-claim",
      invitationId: "pending-invitation",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const response = await fetch(`${baseUrl}/platform/company-employees/7/invitation`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "PENDING" });

    state.role = "SCHOOL_ADMIN";
    const denied = await fetch(`${baseUrl}/platform/company-employees/7/invitation`);
    expect(denied.status).toBe(403);
  });

  it("edits a pending email, records the claim transition, and safely revokes the old Clerk invitation", async () => {
    process.env.CLERK_SECRET_KEY = "test-clerk-secret";
    state.latestInvite = {
      role: "DEVICE_ACTIVATION_OFFICER",
      schoolId: 4,
      claimId: "old-claim",
      invitationId: "old-invitation",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const response = await fetch(`${baseUrl}/platform/company-employees/7/invitation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: "new@example.test",
      role: "DEVICE_ACTIVATION_OFFICER",
      schoolId: 4,
      invitation: { status: "DISPATCH_REQUEST_ACCEPTED" },
    });
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "new@example.test",
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
      publicMetadata: expect.objectContaining({
        edupulseInternalEmployeeInvitation: expect.objectContaining({
          role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4,
        }),
      }),
    }));
    expect(revokeInvitation).toHaveBeenCalledWith("old-invitation");
    expect(state.calls.some(({ values }) => values.includes("INTERNAL_EMPLOYEE_INVITATION_INVALIDATED"))).toBe(true);
    expect(state.calls.some(({ values }) => values.includes("INTERNAL_EMPLOYEE_INVITATION_EDITED"))).toBe(true);
  });

  it("resends an expired invitation with the same signed role and school", async () => {
    process.env.CLERK_SECRET_KEY = "test-clerk-secret";
    state.latestInvite = {
      role: "DEVICE_ACTIVATION_OFFICER",
      schoolId: 9,
      claimId: "expired-claim",
      invitationId: "expired-invitation",
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const response = await fetch(`${baseUrl}/platform/company-employees/7/invitation/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "ada@example.test",
      publicMetadata: expect.objectContaining({
        edupulseInternalEmployeeInvitation: expect.objectContaining({
          role: "DEVICE_ACTIVATION_OFFICER", schoolId: 9,
        }),
      }),
    }));
    expect(revokeInvitation).toHaveBeenCalledWith("expired-invitation");
  });

  it("resends a company accountant invitation without adding a school scope", async () => {
    process.env.CLERK_SECRET_KEY = "test-clerk-secret";
    state.latestInvite = {
      role: "COMPANY_ACCOUNTANT",
      schoolId: null,
      claimId: "expired-accountant-claim",
      invitationId: "expired-accountant-invitation",
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const response = await fetch(`${baseUrl}/platform/company-employees/7/invitation/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    expect(createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "ada@example.test",
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
      publicMetadata: expect.objectContaining({
        edupulseInternalEmployeeInvitation: expect.objectContaining({
          role: "COMPANY_ACCOUNTANT", schoolId: null,
        }),
      }),
    }));
    expect(revokeInvitation).toHaveBeenCalledWith("expired-accountant-invitation");
  });
});