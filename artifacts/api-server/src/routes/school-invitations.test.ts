import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PUBLIC_PRODUCTION_ORIGIN } from "./invitation-redirect";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  connect: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  getInvitationList: vi.fn(),
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
      getInvitationList: mocks.getInvitationList,
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

const schoolAdmin = {
  user: {
    id: 21,
    clerkUserId: "user_school_admin",
    email: "admin@example.test",
    firstName: "School",
    lastName: "Admin",
    status: "ACTIVE",
  },
  roles: [{ id: 2, role: "SCHOOL_ADMIN", schoolId: 3, status: "ACTIVE" }],
} as UserContext;

const partnerOwner = {
  user: {
    id: 31,
    clerkUserId: "user_partner_owner",
    email: "partner.owner@example.test",
    firstName: "Partner",
    lastName: "Owner",
    phone: null,
    status: "ACTIVE",
  },
  roles: [{ id: 3, role: "PARTNER", schoolId: null, status: "ACTIVE" }],
} as UserContext;

function proof(email: string) {
  return createHmac("sha256", key).update(email.trim().toLowerCase()).digest("hex");
}

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

function sqlResult(sql: string) {
  if (sql.includes("current_invite.id")) {
    return { rows: [{ id: 501 }] };
  }
  if (sql.includes("UPDATE schools SET status='active'")) {
    return { rows: [{ id: 3 }] };
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
    vi.stubEnv("NODE_ENV", "test");
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
    mocks.getInvitationList.mockResolvedValue({ data: [], totalCount: 0 });
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
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
    }));
    expectPublicInvitationUrl(mocks.createInvitation.mock.calls[0][0].redirectUrl);
    const metadata = mocks.createInvitation.mock.calls[0][0].publicMetadata;
    expect(metadata.edupulseSchoolInvitation).toEqual(expect.objectContaining({
      schoolId: 3,
      role: "SCHOOL_ADMIN",
      emailProof: proof("new.admin@example.test"),
    }));
    expect(JSON.stringify(metadata)).not.toContain("new.admin@example.test");
    expect(JSON.stringify(mocks.createInvitation.mock.calls[0][0])).not.toContain("password");
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schools SET status='active'"),
      expect.anything(),
    );
  });

  it.each([
    { role: "SCHOOL_ADMIN" as const, actor: owner, email: "new-admin@example.test" },
    { role: "TEACHER" as const, actor: schoolAdmin, email: "teacher@example.test" },
    { role: "ACCOUNTANT" as const, actor: schoolAdmin, email: "accountant@example.test" },
    { role: "PARENT" as const, actor: schoolAdmin, email: "parent@example.test", phone: "+15551234567" },
    { role: "STUDENT" as const, actor: schoolAdmin, email: "student@example.test", studentId: 55 },
    { role: "STAFF" as const, actor: schoolAdmin, email: "staff@example.test" },
  ])("binds the $role invitation to its verified-email claim and correct school", async (flow) => {
    if (flow.role === "STUDENT") {
      mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM students") && sql.includes("FOR UPDATE")) {
          return { rows: values[0] === 55 && values[1] === 3 ? [{ id: 55, userId: null }] : [] };
        }
        return sqlResult(sql);
      });
    }

    await createSchoolInvitation({
      schoolId: 3,
      email: flow.email,
      fullName: `${flow.role} Invitee`,
      phone: "phone" in flow ? flow.phone ?? null : null,
      role: flow.role,
      studentId: "studentId" in flow ? flow.studentId ?? null : null,
    }, flow.actor);

    const clerkRequest = mocks.createInvitation.mock.calls[0][0];
    expectPublicInvitationUrl(clerkRequest.redirectUrl);
    expect(clerkRequest).toMatchObject({
      emailAddress: flow.email,
      expiresInDays: 7,
      ignoreExisting: false,
      notify: true,
    });
    const claim = clerkRequest.publicMetadata.edupulseSchoolInvitation;
    expect(claim).toMatchObject({
      version: 1,
      schoolId: 3,
      role: flow.role,
      emailProof: proof(flow.email),
    });
    expect(claim.claimId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(claim)).not.toContain(flow.email);
    if (flow.role === "STUDENT") expect(claim.studentId).toBe(55);
    else expect(claim.studentId).toBeNull();
    if (flow.role === "TEACHER" || flow.role === "STAFF") {
      expect(claim.employeeNo).toMatch(/^INV-[A-F0-9]{16}$/);
    }
    const invitationAudit = mocks.clientQuery.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO audit_logs") &&
      !sql.includes("SCHOOL_ACTIVATED")
    );
    expect(invitationAudit).toBeDefined();
    expect(invitationAudit?.[1]).toContain(flow.role === "SCHOOL_ADMIN" ? "PLATFORM_OWNER" : "SCHOOL_ADMIN");
  });

  it.each([
    { role: "SCHOOL_ADMIN" as const, studentId: null, employeeNo: null },
    { role: "TEACHER" as const, studentId: null, employeeNo: "INV-ABCDEF0123456789" },
    { role: "ACCOUNTANT" as const, studentId: null, employeeNo: null },
    { role: "PARENT" as const, studentId: null, employeeNo: null },
    { role: "STUDENT" as const, studentId: 55, employeeNo: null },
    { role: "STAFF" as const, studentId: null, employeeNo: "INV-ABCDEF0123456789" },
  ])("activates $role membership only for the invitation school", async ({ role, studentId, employeeNo }) => {
    mocks.getUser.mockResolvedValue({
      id: "user_accepted",
      primaryEmailAddress: {
        emailAddress: "admin@example.test",
        verification: { status: "verified" },
      },
      phoneNumbers: [],
      publicMetadata: {
        edupulseSchoolInvitation: {
          version: 1,
          claimId: "f8b933d3-9144-48ca-996a-30af76c10a22",
          emailProof: proof("admin@example.test"),
          schoolId: 3,
          role,
          employeeNo,
          studentId,
        },
      },
    });
    if (role === "STUDENT") {
      mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM students") && sql.includes("FOR UPDATE")) {
          return { rows: values[0] === 55 && values[1] === 3 ? [{ id: 55, userId: null }] : [] };
        }
        return sqlResult(sql);
      });
    } else if (role === "PARENT") {
      mocks.clientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM parents") && sql.includes("school_id=$1")) {
          return { rows: [{ id: 76, userId: null }] };
        }
        return sqlResult(sql);
      });
    }

    expect(await activateAcceptedSchoolInvitation(21, "user_accepted")).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      [21, 3, role],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("current_invite.id"),
      [3, "f8b933d3-9144-48ca-996a-30af76c10a22", "admin@example.test", role],
    );
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
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schools SET status='active'"),
      [3],
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SCHOOL_ACTIVATED"),
      expect.arrayContaining([3, 42]),
    );
    const activationUpdate = mocks.clientQuery.mock.calls.findIndex(([sql]) =>
      typeof sql === "string" && sql.includes("UPDATE schools SET status='active'")
    );
    const commit = mocks.clientQuery.mock.calls.findIndex(([sql]) => sql === "COMMIT");
    expect(activationUpdate).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(activationUpdate);
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith("user_accepted", {
      publicMetadata: { edupulseSchoolInvitation: null },
    });
  });

  it("preserves an owner-changed school status instead of overriding it during admin acceptance", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("current_invite.id")) return { rows: [{ id: 501 }] };
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "admin@example.test", status: "ACTIVE" }] };
      }
      if (sql.includes("INSERT INTO school_memberships")) {
        return { rows: [{ id: 42 }] };
      }
      // An owner changed the school to inactive/suspended before the invite was accepted.
      if (sql.includes("UPDATE schools SET status='active'")) return { rows: [] };
      return { rows: [] };
    });

    expect(await activateAcceptedSchoolInvitation(21, "user_accepted")).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id=$1 AND status='pending'"),
      [3],
    );
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("SCHOOL_ACTIVATED"),
      expect.anything(),
    );
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
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

  it("activates a pending school once when granting its verified existing School Admin account", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) {
        return { rows: [{ id: 21, clerkUserId: "user_existing", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });

    const result = await createSchoolInvitation({
      schoolId: 3,
      email: "admin@example.test",
      fullName: "School Admin",
      phone: null,
      role: "SCHOOL_ADMIN",
    }, owner);

    expect(result).toMatchObject({ status: "ACTIVE", role: "SCHOOL_ADMIN", schoolId: 3 });
    expect(mocks.getUser).toHaveBeenCalledWith("user_existing");
    expect(mocks.createInvitation).not.toHaveBeenCalled();
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO school_memberships"),
      [21, 3, "SCHOOL_ADMIN"],
    );
    const schoolActivationAudits = mocks.clientQuery.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("SCHOOL_ACTIVATED")
    );
    expect(schoolActivationAudits).toHaveLength(1);
    const activationAuditValues = schoolActivationAudits[0][1] as unknown[];
    expect(JSON.parse(String(activationAuditValues[6]))).toMatchObject({
      role: "SCHOOL_ADMIN",
      activationSource: "VERIFIED_EXISTING_ACCOUNT",
    });
    expect(JSON.parse(String(activationAuditValues[6])).claimId).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    const activationUpdate = mocks.clientQuery.mock.calls.findIndex(([sql]) =>
      typeof sql === "string" && sql.includes("UPDATE schools SET status='active'")
    );
    const commit = mocks.clientQuery.mock.calls.findIndex(([sql]) => sql === "COMMIT");
    expect(activationUpdate).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(activationUpdate);
  });

  it("does not provision an existing School Admin without a verified primary email", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) {
        return { rows: [{ id: 21, clerkUserId: "user_existing", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });
    mocks.getUser.mockResolvedValue({
      id: "user_existing",
      primaryEmailAddress: {
        emailAddress: "admin@example.test",
        verification: { status: "unverified" },
      },
    });

    await expect(createSchoolInvitation({
      schoolId: 3,
      email: "admin@example.test",
      fullName: "School Admin",
      phone: null,
      role: "SCHOOL_ADMIN",
    }, owner)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schools SET status='active'"),
      expect.anything(),
    );
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
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schools SET status='active'"),
      expect.anything(),
    );
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("SCHOOL_ACTIVATED"),
      expect.anything(),
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
      school: {
        code: "NEW01",
        name: "New School",
        city: "Lagos",
        state: "Lagos",
        status: "suspended",
      },
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
      redirectUrl: `${PUBLIC_PRODUCTION_ORIGIN}/accept-invitation`,
    }));
    const invitation = mocks.createInvitation.mock.calls[0][0];
    expectPublicInvitationUrl(invitation.redirectUrl);
    expect(invitation.publicMetadata.edupulseSchoolInvitation).toMatchObject({
      schoolId: 77,
      role: "SCHOOL_ADMIN",
      emailProof: proof("first.admin@example.test"),
    });
    expect(invitation.publicMetadata.edupulseSchoolInvitation.claimId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("VALUES($1,$2,$3,$4,'pending')"),
      ["NEW01", "New School", "Lagos", "Lagos"],
    );
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schools SET status='active'"),
      expect.anything(),
    );
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

  it("commits the pending school, permanent attribution, and exact dispatch claim before Clerk is notified", async () => {
    const events: string[] = [];
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      events.push(sql === "COMMIT" ? "COMMIT" : sql);
      if (sql.includes("INSERT INTO schools")) return { rows: [{ id: 77 }] };
      if (sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT") && sql.includes("RETURNING id")) {
        return { rows: [{ id: 901 }] };
      }
      return { rows: [] };
    });
    mocks.createInvitation.mockImplementation(async (options: any) => {
      events.push("CLERK_CREATE_INVITATION");
      return { id: inviteId, createdAt: Date.now(), status: "pending", publicMetadata: options.publicMetadata };
    });

    const result = await createSchoolWithAdministrator({
      school: {
        name: "Partner School",
        city: "Lagos",
        state: "Lagos",
        email: "office@partner-school.test",
      },
      administrator: {
        fullName: "First Admin",
        email: "first.admin@partner-school.test",
        phone: "+2348000000000",
      },
      partnerId: 55,
    }, partnerOwner);

    expect(result.schoolId).toBe(77);
    expect(result.administratorInvitation.invitationId).toBe(inviteId);
    expect(events.indexOf("COMMIT")).toBeGreaterThan(-1);
    expect(events.indexOf("COMMIT")).toBeLessThan(events.indexOf("CLERK_CREATE_INVITATION"));
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("PARTNER_DIRECT"),
      expect.arrayContaining([77, 55]),
    );
    const inviteAudit = mocks.clientQuery.mock.calls.find(([sql, values]) =>
      sql.includes("INSERT INTO audit_logs") &&
      JSON.stringify(values).includes("DISPATCHING")
    );
    expect(JSON.stringify(inviteAudit?.[1])).toContain("DISPATCHING");
    const invitation = mocks.createInvitation.mock.calls[0][0];
    expect(invitation.publicMetadata.edupulseSchoolInvitation).toMatchObject({
      schoolId: 77,
      role: "SCHOOL_ADMIN",
      partnerRegistrationAttemptId: expect.any(String),
    });
    expect(JSON.stringify(invitation.publicMetadata)).not.toContain("+2348000000000");
  });

  it("persists a confirmed provider registered/pending rejection and blocks school recreation", async () => {
    let schoolExists = false;
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM schools") && sql.includes("lower(trim(name))")) {
        return { rows: schoolExists ? [{ id: 77 }] : [] };
      }
      if (sql.includes("INSERT INTO schools")) {
        schoolExists = true;
        return { rows: [{ id: 77 }] };
      }
      if (sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT") && sql.includes("RETURNING id")) {
        return { rows: [{ id: 902 }] };
      }
      return { rows: [] };
    });
    mocks.createInvitation.mockRejectedValue({
      status: 422,
      errors: [{ code: "form_identifier_exists" }],
    });
    const input = {
      school: { name: "Registered Partner School", city: "Lagos", state: "Lagos" },
      administrator: {
        fullName: "Registered Admin",
        email: "registered.admin@partner-school.test",
        phone: "+2348111111111",
      },
      partnerId: 55,
    };

    await expect(createSchoolWithAdministrator(input, partnerOwner))
      .rejects.toMatchObject({ statusCode: 409, eventType: "INVITATION_ALREADY_EXISTS" });
    await expect(createSchoolWithAdministrator(input, partnerOwner))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.createInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.clientQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO schools"))).toHaveLength(1);
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it("activates the committed claim after a lost provider response and finalization failure, then blocks retry", async () => {
    let marker: any;
    let attemptIsUnknown = false;
    let schoolExists = false;
    let failFinalization = true;
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM audit_logs") && sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT")) {
        return { rows: attemptIsUnknown ? [{ id: 903 }] : [] };
      }
      if (sql.includes("INSERT INTO schools")) {
        schoolExists = true;
        return { rows: [{ id: 77 }] };
      }
      if (sql.includes("SELECT id FROM schools") && sql.includes("lower(trim(name))")) {
        return { rows: schoolExists ? [{ id: 77 }] : [] };
      }
      if (sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT") && sql.includes("RETURNING id")) {
        return { rows: [{ id: 903 }] };
      }
      if (
        failFinalization &&
        sql.includes("UPDATE audit_logs") &&
        sql.includes("WHERE school_id=$2") &&
        sql.includes("SCHOOL_ADMIN_INVITED")
      ) {
        failFinalization = false;
        throw new Error("simulated invitation audit finalization failure");
      }
      if (sql.includes("current_invite.id")) {
        return { rows: [{ id: 504, invitedPhone: "+2348222222222" }] };
      }
      return sqlResult(sql);
    });
    mocks.poolQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("UPDATE audit_logs") && JSON.stringify(values).includes("OUTCOME_UNKNOWN")) {
        attemptIsUnknown = true;
      }
      if (sql.includes("FROM schools")) return { rows: [{ id: 77 }] };
      return { rows: [] };
    });
    mocks.createInvitation.mockImplementation(async (options: any) => {
      marker = options.publicMetadata.edupulseSchoolInvitation;
      throw { status: 503 };
    });
    mocks.getInvitationList.mockImplementation(async (options: any) => ({
      data: options.status === "pending" ? [{
        id: inviteId,
        emailAddress: "lost.admin@partner-school.test",
        publicMetadata: { edupulseSchoolInvitation: marker },
      }] : [],
      totalCount: options.status === "pending" ? 1 : 0,
    }));

    const input = {
      school: { name: "Lost Response School", city: "Lagos", state: "Lagos" },
      administrator: {
        fullName: "Lost Admin",
        email: "lost.admin@partner-school.test",
        phone: "+2348222222222",
      },
      partnerId: 55,
    };
    await expect(createSchoolWithAdministrator(input, partnerOwner))
      .rejects.toMatchObject({ statusCode: 503, eventType: "INVITATION_RECOVERY_REQUIRED" });
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(mocks.clientQuery.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
    expect(attemptIsUnknown).toBe(true);

    mocks.getUser.mockResolvedValue({
      id: "user_accepted",
      primaryEmailAddress: {
        emailAddress: input.administrator.email,
        verification: { status: "verified" },
      },
      emailAddresses: [{ emailAddress: input.administrator.email }],
      firstName: "Lost",
      lastName: "Admin",
      phoneNumbers: [],
      publicMetadata: { edupulseSchoolInvitation: marker },
    });
    mocks.clientQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "lost.admin@partner-school.test", status: "ACTIVE" }] };
      }
      if (sql.includes("current_invite.id")) {
        return { rows: [{ id: 504, invitedPhone: "+2348222222222" }] };
      }
      if (sql.includes("UPDATE app_users SET first_name")) {
        expect(values?.[2]).toBe("+2348222222222");
      }
      return sqlResult(sql);
    });
    await expect(activateAcceptedSchoolInvitation(21, "user_accepted")).resolves.toBe(true);

    mocks.clientQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT id FROM audit_logs") && sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT")) {
        return { rows: attemptIsUnknown ? [{ id: 903 }] : [] };
      }
      if (sql.includes("SELECT id FROM schools") && sql.includes("lower(trim(name))")) {
        return { rows: schoolExists ? [{ id: 77 }] : [] };
      }
      if (sql.includes("PARTNER_SCHOOL_REGISTRATION_ATTEMPT") && sql.includes("RETURNING id")) {
        return { rows: [{ id: 904 }] };
      }
      return sqlResult(sql);
    });
    await expect(createSchoolWithAdministrator(input, partnerOwner))
      .rejects.toMatchObject({ statusCode: 409, eventType: "INVITATION_RECOVERY_REQUIRED" });
    expect(mocks.createInvitation).toHaveBeenCalledTimes(1);
  });
});