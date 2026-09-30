import { createHmac } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  employee: { id: 11, email: "person@example.test", fullName: "Internal Person" },
  user: { id: 77, email: "person@example.test", status: "ACTIVE" },
  activeRoles: [] as Array<{ id: number; role: string; schoolId: number | null }>,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  metadata: {} as Record<string, unknown>,
}));

const invitationCreate = vi.hoisted(() => vi.fn(async (input: any) => {
  state.metadata = input.publicMetadata as Record<string, unknown>;
  return { id: "clerk-internal-invitation", createdAt: Date.now() };
}));
const invitationRevoke = vi.hoisted(() => vi.fn(async () => undefined));
const clerkGetUser = vi.hoisted(() => vi.fn(async () => ({
  primaryEmailAddress: {
    emailAddress: "person@example.test",
    verification: { status: "verified" },
  },
  emailAddresses: [{ emailAddress: "person@example.test" }],
  firstName: "Internal",
  lastName: "Person",
  publicMetadata: state.metadata,
})));
const clerkUpdateMetadata = vi.hoisted(() => vi.fn(async () => undefined));

const clientQuery = vi.hoisted(() => vi.fn(async (sql: string, values: unknown[] = []) => {
  state.calls.push({ sql, values });
  if (sql.includes("FROM app_users") && sql.includes("FOR UPDATE")) return { rows: [state.user] };
  if (sql.includes("FROM platform_company_employees") && sql.includes("FOR SHARE")) {
    return state.employee.email === values[1]
      ? { rows: [{ id: state.employee.id }] }
      : { rows: [] };
  }
  if (sql.includes("FROM platform_company_employees") && sql.includes("status='ACTIVE' FOR UPDATE")) {
    return { rows: [{ ...state.employee }] };
  }
  if (sql.includes("FROM schools WHERE id=$1")) return { rows: [{ id: values[0] }] };
  if (sql.includes("SELECT id,role,school_id AS")) return { rows: state.activeRoles };
  if (sql.includes("SELECT id FROM school_memberships")) return { rows: [] };
  if (sql.includes("INSERT INTO school_memberships")) {
    state.activeRoles.push({ id: 81, userId: values[0], schoolId: values[1], role: String(values[2]) } as any);
    return { rows: [{ id: 81 }] };
  }
  return { rows: [] };
}));
const client = vi.hoisted(() => ({ query: clientQuery, release: vi.fn() }));
const poolQuery = vi.hoisted(() => vi.fn(async (sql: string, values: unknown[] = []) => {
  state.calls.push({ sql, values });
  if (sql.includes("FROM platform_company_employees") && sql.includes("WHERE id=$1 AND status='ACTIVE'")) {
    return { rows: [{ ...state.employee, email: state.employee.email }] };
  }
  return { rows: [] };
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: { createInvitation: invitationCreate, revokeInvitation: invitationRevoke },
    users: { getUser: clerkGetUser, updateUserMetadata: clerkUpdateMetadata },
  },
}));
vi.mock("@workspace/db", () => ({
  pool: { query: poolQuery, connect: vi.fn(async () => client) },
}));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: (_req: express.Request, roles: string[]) => {
    if (!roles.includes(state.role)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  },
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "owner", email: "owner@example.test" },
    roles: [{ role: state.role, schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import internalEmployeeRouter, {
  activateAcceptedInternalEmployeeInvitation,
} from "./internal-employee-invitations";

const app = express();
app.use(express.json());
app.use(internalEmployeeRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(Number((error as { statusCode?: number })?.statusCode) || 500)
    .json({ error: error instanceof Error ? error.message : "Internal Server Error" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  process.env.CLERK_SECRET_KEY = "test-clerk-signing-key";
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
  state.activeRoles = [];
  state.calls.length = 0;
  state.metadata = {};
  state.user = { id: 77, email: "person@example.test", status: "ACTIVE" };
  state.employee = { id: 11, email: "person@example.test", fullName: "Internal Person" };
  vi.clearAllMocks();
});

function metadataFor(role: "COMPANY_ACCOUNTANT" | "DEVICE_ACTIVATION_OFFICER", schoolId: number | null) {
  const claimId = "2bf3d0d0-07db-40ae-9e57-d905c69e9545";
  const content = ["v1", claimId, 11, "person@example.test", role, schoolId ?? "company"].join("|");
  return {
    edupulseInternalEmployeeInvitation: {
      version: 1,
      claimId,
      employeeId: 11,
      role,
      schoolId,
      signature: createHmac("sha256", process.env.CLERK_SECRET_KEY!).update(content).digest("hex"),
    },
  };
}

describe("internal employee invitation and activation", () => {
  it("creates a Clerk-notified, signed, school-scoped officer invitation", async () => {
    const response = await fetch(`${baseUrl}/platform/company-employees/11/invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4,
      invitation: { status: "DISPATCH_REQUEST_ACCEPTED", deliveryConfirmed: false },
    });
    expect(invitationCreate).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "person@example.test",
      notify: true,
      publicMetadata: expect.objectContaining({
        edupulseInternalEmployeeInvitation: expect.objectContaining({
          employeeId: 11, role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4,
        }),
      }),
    }));
  });

  it("activates the exact signed accountant role globally, never as school staff", async () => {
    state.metadata = metadataFor("COMPANY_ACCOUNTANT", null);
    expect(await activateAcceptedInternalEmployeeInvitation(77, "clerk-person")).toBe(true);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships(user_id,school_id,role,status)"),
      [77, null, "COMPANY_ACCOUNTANT"],
    );
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("'STAFF'"), expect.anything());
    expect(clerkUpdateMetadata).toHaveBeenCalledWith("clerk-person", {
      publicMetadata: { edupulseInternalEmployeeInvitation: null },
    });
  });

  it("activates the officer only at its signed school and rejects role tampering", async () => {
    state.metadata = metadataFor("DEVICE_ACTIVATION_OFFICER", 4);
    await activateAcceptedInternalEmployeeInvitation(77, "clerk-person");
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships(user_id,school_id,role,status)"),
      [77, 4, "DEVICE_ACTIVATION_OFFICER"],
    );

    state.metadata = metadataFor("COMPANY_ACCOUNTANT", null);
    (state.metadata.edupulseInternalEmployeeInvitation as any).role = "SCHOOL_ADMIN";
    await expect(activateAcceptedInternalEmployeeInvitation(77, "clerk-person"))
      .rejects.toThrow("invalid or does not match");
  });

  it("rejects inactive employee profiles and accounts already carrying unrelated roles", async () => {
    state.metadata = metadataFor("COMPANY_ACCOUNTANT", null);
    state.employee = { ...state.employee, email: "other@example.test" };
    await expect(activateAcceptedInternalEmployeeInvitation(77, "clerk-person"))
      .rejects.toThrow("active company employee profile");

    state.employee = { id: 11, email: "person@example.test", fullName: "Internal Person" };
    state.activeRoles = [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 8 }];
    await expect(activateAcceptedInternalEmployeeInvitation(77, "clerk-person"))
      .rejects.toThrow("cannot be combined");
  });
});