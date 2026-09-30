import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  connect: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.connect,
  },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    invitations: {
      createInvitation: mocks.createInvitation,
      revokeInvitation: mocks.revokeInvitation,
    },
    users: {
      getUser: mocks.getUser,
      updateUserMetadata: mocks.updateUserMetadata,
    },
  },
}));

import {
  activateAcceptedSchoolInvitation,
  createSchoolInvitation,
  createSchoolWithAdministrator,
} from "./school-invitations";
import type { UserContext } from "../middlewares/auth";

const key = "test-clerk-server-key";
const inviteId = "inv_123";
const owner = {
  user: {
    id: 8,
    clerkUserId: "user_platform_owner",
    email: "owner@example.test",
    firstName: "Platform",
    lastName: "Owner",
    status: "ACTIVE",
  },
  roles: [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }],
} as UserContext;

function proof(email: string) {
  return createHmac("sha256", key).update(email.trim().toLowerCase()).digest("hex");
}

function sqlResult(sql: string) {
  if (sql.includes("current_invite.id")) {
    return { rows: [{ id: 501 }] };
  }
  if (sql.includes("INSERT INTO school_memberships")) {
    return { rows: [{ id: 42, userId: 21, schoolId: 3, role: "SCHOOL_ADMIN", status: "ACTIVE" }] };
  }
  if (sql.includes("SELECT id,status FROM school_memberships")) return { rows: [] };
  if (sql.includes("SELECT id,email,status FROM app_users")) {
    return { rows: [{ id: 21, email: "admin@example.test", status: "ACTIVE" }] };
  }
  return { rows: [] };
}

describe("school invitations", () => {
  beforeEach(() => {
    vi.stubEnv("CLERK_SECRET_KEY", key);
    vi.clearAllMocks();
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) return { rows: [] };
      return { rows: [] };
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => sqlResult(sql));
    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
    mocks.createInvitation.mockResolvedValue({
      id: inviteId,
      createdAt: Date.now(),
      status: "pending",
    });
    mocks.revokeInvitation.mockResolvedValue({});
    mocks.getUser.mockResolvedValue({
      id: "user_accepted",
      primaryEmailAddress: {
        emailAddress: "admin@example.test",
        verification: { status: "verified" },
      },
      emailAddresses: [{ emailAddress: "admin@example.test" }],
      firstName: "School",
      lastName: "Admin",
      phoneNumbers: [],
      publicMetadata: {
        edupulseSchoolInvitation: {
          version: 1,
          claimId: "f8b933d3-9144-48ca-996a-30af76c10a22",
          emailProof: proof("admin@example.test"),
          schoolId: 3,
          role: "SCHOOL_ADMIN",
          employeeNo: null,
        },
      },
    });
    mocks.updateUserMetadata.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a seven-day Clerk invitation without setting a password", async () => {
    const result = await createSchoolInvitation(
      {
        schoolId: 3,
        email: " New.Admin@Example.Test ",
        fullName: "New Administrator",
        phone: null,
        role: "SCHOOL_ADMIN",
      },
      owner,
    );

    expect(result.status).toBe("DISPATCH_REQUESTED");
    expect(result).toMatchObject({
      dispatchStatus: "REQUEST_ACCEPTED",
      deliveryStatus: "UNVERIFIED",
    });
    expect(mocks.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "new.admin@example.test",
      expiresInDays: 7,
      ignoreExisting: false,
      notify: true,
      redirectUrl: "/accept-invitation",
    }));
    const metadata = mocks.createInvitation.mock.calls[0][0].publicMetadata;
    expect(metadata.edupulseSchoolInvitation).toEqual(expect.objectContaining({
      schoolId: 3,
      role: "SCHOOL_ADMIN",
      emailProof: proof("new.admin@example.test"),
    }));
    expect(JSON.stringify(metadata)).not.toContain("new.admin@example.test");
    expect(JSON.stringify(mocks.createInvitation.mock.calls[0][0])).not.toContain("password");
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("revokes the Clerk invitation if local profile/audit persistence fails", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw new Error("database unavailable");
      return { rows: [] };
    });

    await expect(createSchoolInvitation(
      {
        schoolId: 3,
        email: "parent@example.test",
        fullName: "Parent User",
        phone: "+15551234567",
        role: "PARENT",
      },
      owner,
    )).rejects.toMatchObject({ statusCode: 503 });

    expect(mocks.revokeInvitation).toHaveBeenCalledWith(inviteId);
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("activates only the role bound to the accepting account email", async () => {
    const activated = await activateAcceptedSchoolInvitation(21, "user_accepted");

    expect(activated).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      [21, 3, "SCHOOL_ADMIN"],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("USER_ACTIVATED"),
      expect.any(Array),
    );
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith("user_accepted", {
      publicMetadata: { edupulseSchoolInvitation: null },
    });
  });

  it("does not activate invitation metadata for a different email address", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_accepted",
      primaryEmailAddress: {
        emailAddress: "other@example.test",
        verification: { status: "verified" },
      },
      emailAddresses: [{ emailAddress: "other@example.test" }],
      publicMetadata: {
        edupulseSchoolInvitation: {
          version: 1,
          claimId: "f8b933d3-9144-48ca-996a-30af76c10a22",
          emailProof: proof("admin@example.test"),
          schoolId: 3,
          role: "SCHOOL_ADMIN",
          employeeNo: null,
        },
      },
    });

    await expect(activateAcceptedSchoolInvitation(21, "user_accepted"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not reactivate a previously inactive membership from an invitation request", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) {
        return { rows: [{ id: 21, clerkUserId: "user_existing", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id,status FROM school_memberships")) {
        return { rows: [{ id: 99, status: "INACTIVE" }] };
      }
      return { rows: [] };
    });

    await expect(createSchoolInvitation(
      {
        schoolId: 3,
        email: "admin@example.test",
        fullName: "Existing Account",
        phone: null,
        role: "ACCOUNTANT",
      },
      owner,
    )).rejects.toMatchObject({ statusCode: 409 });

    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      expect.anything(),
    );
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("binds a Student invitation to an existing school-scoped profile without adding an email column", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM students") && sql.includes("FOR UPDATE")) {
        return { rows: values[0] === 55 && values[1] === 3 ? [{ id: 55, userId: null }] : [] };
      }
      if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
      return { rows: [] };
    });
    const result = await createSchoolInvitation(
      {
        schoolId: 3,
        fullName: "Student Example",
        email: "student@example.test",
        phone: null,
        role: "STUDENT",
        studentId: 55,
      },
      owner,
    );
    expect(result).toMatchObject({ deliveryStatus: "UNVERIFIED" });
    const marker = mocks.createInvitation.mock.calls[0][0].publicMetadata.edupulseSchoolInvitation;
    expect(marker).toEqual(expect.objectContaining({ schoolId: 3, role: "STUDENT", studentId: 55 }));
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id=$1 AND school_id=$2 FOR UPDATE"),
      [55, 3],
    );
  });

  it("activates a Student invitation only for the exact verified primary Clerk email and keeps STUDENT role", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_student",
      primaryEmailAddress: {
        emailAddress: "student@example.test",
        verification: { status: "verified" },
      },
      emailAddresses: [],
      phoneNumbers: [],
      publicMetadata: {
        edupulseSchoolInvitation: {
          version: 1,
          claimId: "f8b933d3-9144-48ca-996a-30af76c10a22",
          emailProof: proof("student@example.test"),
          schoolId: 3,
          role: "STUDENT",
          studentId: 55,
        },
      },
    });
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("current_invite.id")) return { rows: [{ id: 501 }] };
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "student@example.test", status: "ACTIVE" }] };
      }
      if (sql.includes("SELECT id,status FROM school_memberships")) return { rows: [] };
      if (sql.includes("FROM students") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 55, userId: null }] };
      }
      if (sql.includes("INSERT INTO school_memberships")) {
        return { rows: [{ id: 42 }] };
      }
      return { rows: [] };
    });
    expect(await activateAcceptedSchoolInvitation(21, "user_student")).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE students SET user_id=$1"),
      [21, 55, 3],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      [21, 3, "STUDENT"],
    );
  });

  it("does not activate school access when the Clerk primary email is unverified", async () => {
    mocks.getUser.mockResolvedValue({
      id: "user_unverified",
      primaryEmailAddress: {
        emailAddress: "admin@example.test",
        verification: { status: "unverified" },
      },
      emailAddresses: [],
    });
    expect(await activateAcceptedSchoolInvitation(21, "user_unverified")).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects a replaced claim even when its signed Clerk metadata remains", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "admin@example.test", status: "ACTIVE" }] };
      }
      if (sql.includes("current_invite.id")) return { rows: [] };
      return { rows: [] };
    });

    await expect(activateAcceptedSchoolInvitation(21, "user_accepted"))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      expect.anything(),
    );
  });

  it("creates a school and its first administrator invitation in one transaction", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO schools")) return { rows: [{ id: 77 }] };
      return { rows: [] };
    });
    const result = await createSchoolWithAdministrator({
      school: { code: "NEW01", name: "New School", city: "Lagos", state: "Lagos" },
      administrator: { fullName: "First Admin", email: "first.admin@example.test" },
    }, owner);
    expect(result.schoolId).toBe(77);
    expect(result.administratorInvitation).toMatchObject({
      status: "DISPATCH_REQUESTED",
      dispatchStatus: "REQUEST_ACCEPTED",
      deliveryStatus: "UNVERIFIED",
    });
    expect(mocks.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      emailAddress: "first.admin@example.test",
      notify: true,
      redirectUrl: "/accept-invitation",
    }));
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(JSON.stringify(mocks.createInvitation.mock.calls[0][0].publicMetadata))
      .not.toContain("first.admin@example.test");
  });

  it("rolls back school creation when Clerk refuses the first administrator invitation", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO schools")) return { rows: [{ id: 77 }] };
      return { rows: [] };
    });
    mocks.createInvitation.mockRejectedValue({ status: 503 });
    await expect(createSchoolWithAdministrator({
      school: { code: "NEW01", name: "New School", city: "Lagos", state: "Lagos" },
      administrator: { fullName: "First Admin", email: "first.admin@example.test" },
    }, owner)).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith("COMMIT");
  });
});