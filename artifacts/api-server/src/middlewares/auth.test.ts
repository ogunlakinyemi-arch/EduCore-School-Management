import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  assertUserActive,
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