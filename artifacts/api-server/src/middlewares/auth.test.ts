import { describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  roles: [] as Array<{ id: number; role: string; schoolId: number | null; status: string }>,
  archives: [] as any[],
  sessionUserId: null as string | null,
  ledgerUnavailable: false,
}));
const dbMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("test-account-access-archive-ledger")) {
      if (dbState.ledgerUnavailable) throw new Error("fictional ledger outage");
      return { rows: dbState.archives.map(metadata => ({ metadata })) };
    }
    if (sql.includes("FROM account_applications")) return { rows: [] };
    if (sql.includes("SELECT 1 WHERE")) return { rows: [] };
    if (sql.includes("role='PLATFORM_OWNER'")) return {
      rows: dbState.roles.some(r => r.role === "PLATFORM_OWNER" && r.schoolId === null && r.status === "ACTIVE") ? [{ exists: 1 }] : [],
    };
    if (sql.includes("FROM app_users WHERE clerk_user_id")) {
      return {
        rows: [{
          id: 10,
          clerkUserId: "user_test",
          email: "test@example.com",
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        }],
      };
    }
    return { rows: dbState.roles };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: dbMock }));
vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: dbState.sessionUserId })),
  clerkClient: { users: { getUser: vi.fn() } },
}));

const archive = () => ({
  version: 1, batchId: "a".repeat(64), operation: "BLOCK",
  schoolIds: [9], partnerIds: [3], userIds: [10], emails: ["test@example.com"],
});

import {
  AuthError,
  loadUserContext,
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  assertUserActive,
  hasRole,
  requireAuthentication,
  type Role,
  type UserContext,
} from "./auth";

function requestWith(
  roles: Array<{ role: Role; schoolId: number | null }>,
) {
  const context: UserContext = {
    user: {
      id: 10,
      clerkUserId: "user_test",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      phone: null,
      status: "ACTIVE",
    },
    roles: roles.map((role, index) => ({
      id: index + 1,
      status: "ACTIVE",
      ...role,
    })),
  };
  return { edupulseUser: context } as any;
}

describe("authentication and user status", () => {
  it("returns 401 when no Clerk session exists", () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    requireAuthentication()({} as any, { status, json } as any, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("denies inactive users", () => {
    expect(() => assertUserActive("INACTIVE")).toThrowError(AuthError);
    try {
      assertUserActive("INACTIVE");
    } catch (error) {
      expect((error as AuthError).statusCode).toBe(403);
    }
  });

  it("fails closed when an activation officer also has any other active role", async () => {
    dbState.roles = [
      { id: 1, role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4, status: "ACTIVE" },
      { id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
    ];
    await expect(loadUserContext("user_test")).rejects.toMatchObject({
      statusCode: 403,
    });

    dbState.roles = [
      { id: 1, role: "DEVICE_ACTIVATION_OFFICER", schoolId: 4, status: "ACTIVE" },
    ];
    await expect(loadUserContext("user_test")).resolves.toMatchObject({
      roles: [{ role: "DEVICE_ACTIVATION_OFFICER" }],
    });
  });
});

describe("archived test account sign-in and existing sessions", () => {
  it("denies sign-in even though the stored account and membership remain ACTIVE", async () => {
    dbState.roles = [{ id: 3, role: "TEACHER", schoolId: 9, status: "ACTIVE" }];
    dbState.archives = [archive()];
    try {
      await expect(loadUserContext("user_test")).rejects.toMatchObject({
        statusCode: 403, eventType: "ARCHIVED_TEST_ACCESS_BLOCKED",
      });
    } finally { dbState.archives = []; dbState.roles = []; }
  });
  it("denies a previously authenticated session/token on its next protected request", async () => {
    dbState.archives = [archive()]; dbState.roles = [];
    dbState.sessionUserId = "user_test";
    const status = vi.fn().mockReturnThis(), json = vi.fn(), next = vi.fn();
    try {
      requireAuthentication()({} as any, { status, json } as any, next);
      await vi.waitFor(() => expect(status).toHaveBeenCalledWith(403));
      expect(next).not.toHaveBeenCalled();
    } finally { dbState.archives = []; dbState.sessionUserId = null; }
  });
  it("preserves a live platform-scoped Owner even if an archive lists the same account", async () => {
    dbState.roles = [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    dbState.archives = [archive()];
    try {
      await expect(loadUserContext("user_test")).resolves.toMatchObject({
        roles: [{ role: "PLATFORM_OWNER" }],
      });
    } finally { dbState.archives = []; dbState.roles = []; }
  });
  it("continues sign-in for unrelated school accounts and immediately allows an Owner-restored batch", async () => {
    dbState.roles = [{ id: 4, role: "TEACHER", schoolId: 77, status: "ACTIVE" }];
    dbState.archives = [{ ...archive(), userIds: [99], emails: ["other@fictional.invalid"] }];
    try {
      await expect(loadUserContext("user_test")).resolves.toMatchObject({ roles: [{ schoolId: 77 }] });
      dbState.archives = [archive(), { ...archive(), operation: "RESTORE" }];
      await expect(loadUserContext("user_test")).resolves.toMatchObject({ roles: [{ schoolId: 77 }] });
    } finally { dbState.archives = []; dbState.roles = []; }
  });
  it("fails closed if archive evidence cannot be read, rather than ignoring a possible block", async () => {
    dbState.ledgerUnavailable = true;
    try {
      await expect(loadUserContext("user_test")).rejects.toMatchObject({ statusCode: 503 });
    } finally { dbState.ledgerUnavailable = false; }
  });
});

describe("role and tenant authorization", () => {
  it("allows a platform owner to access platform functions", () => {
    expect(() =>
      assertRoles(
        requestWith([{ role: "PLATFORM_OWNER", schoolId: null }]),
        ["PLATFORM_OWNER"],
      ),
    ).not.toThrow();
  });

  it("allows a school administrator to access their school", () => {
    expect(() =>
      assertSchoolAccess(
        requestWith([{ role: "SCHOOL_ADMIN", schoolId: 1 }]),
        1,
        ["SCHOOL_ADMIN"],
      ),
    ).not.toThrow();
  });

  it("hides another school from a school administrator", () => {
    expect(() =>
      assertSchoolAccess(
        requestWith([{ role: "SCHOOL_ADMIN", schoolId: 1 }]),
        2,
        ["SCHOOL_ADMIN"],
      ),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 404,
        eventType: "CROSS_TENANT_ACCESS_ATTEMPT",
      }),
    );
  });

  it("denies a teacher access to an unauthorized school", () => {
    expect(() =>
      assertSchoolAccess(
        requestWith([{ role: "TEACHER", schoolId: 1 }]),
        2,
        ["TEACHER"],
      ),
    ).toThrowError(AuthError);
  });

  it("does not allow parents or students into school directories", () => {
    for (const role of ["PARENT", "STUDENT"] as const) {
      expect(() =>
        assertSchoolAccess(
          requestWith([{ role, schoolId: 1 }]),
          1,
          ["SCHOOL_ADMIN", "TEACHER"],
        ),
      ).toThrowError(AuthError);
    }
  });

  it("does not treat a school administrator as a platform owner", () => {
    expect(() =>
      assertRoles(
        requestWith([{ role: "SCHOOL_ADMIN", schoolId: 1 }]),
        ["PLATFORM_OWNER"],
      ),
    ).toThrowError(AuthError);
  });

  it("does not treat null-scoped school roles as global or cross-school access", () => {
    for (const role of ["SCHOOL_ADMIN", "TEACHER", "PARENT"] as const) {
      const context = requestWith([{ role, schoolId: null }]).edupulseUser;
      expect(hasRole(context, role, 1)).toBe(false);
      expect(() => assertRoles(requestWith([{ role, schoolId: null }]), [role]))
        .toThrowError(AuthError);
    }
  });

  it("keeps platform-owner and partner null memberships global only without a school", () => {
    const context = requestWith([
      { role: "PLATFORM_OWNER", schoolId: null },
      { role: "PARTNER", schoolId: null },
    ]).edupulseUser;

    expect(hasRole(context, "PLATFORM_OWNER")).toBe(true);
    expect(hasRole(context, "PARTNER")).toBe(true);
    expect(hasRole(context, "PARTNER", 1)).toBe(false);
    expect(() => assertRoles(requestWith([{ role: "PARTNER", schoolId: null }]), ["PARTNER"]))
      .not.toThrow();
  });

  it("requires an active, school-scoped operational membership without an owner bypass", () => {
    const owner = requestWith([{ role: "PLATFORM_OWNER", schoolId: null }]);
    expect(() => assertSchoolOperationalAccess(owner, 1, ["SCHOOL_ADMIN"])).toThrowError(
      expect.objectContaining({ statusCode: 404, eventType: "CROSS_TENANT_ACCESS_ATTEMPT" }),
    );
    const dualRole = requestWith([
      { role: "PLATFORM_OWNER", schoolId: null },
      { role: "SCHOOL_ADMIN", schoolId: 1 },
      { role: "TEACHER", schoolId: 1 },
    ]);
    expect(() => assertSchoolOperationalAccess(dualRole, 1, ["SCHOOL_ADMIN", "TEACHER"]))
      .toThrowError(expect.objectContaining({ statusCode: 404 }));

    expect(() => assertSchoolOperationalAccess(
      requestWith([{ role: "SCHOOL_ADMIN", schoolId: 1 }]),
      1,
      ["SCHOOL_ADMIN"],
    )).not.toThrow();

    const inactiveMembership = requestWith([{ role: "SCHOOL_ADMIN", schoolId: 1 }]);
    (inactiveMembership.edupulseUser.roles[0] as any).status = "INACTIVE";
    expect(() => assertSchoolOperationalAccess(inactiveMembership, 1, ["SCHOOL_ADMIN"]))
      .toThrowError(AuthError);
  });
});