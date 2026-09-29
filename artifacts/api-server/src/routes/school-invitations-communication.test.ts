import { beforeEach, describe, expect, it, vi } from "vitest";
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
  queueCommunicationNotification: vi.fn(),
  steps: [] as string[],
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

vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: mocks.queueCommunicationNotification,
}));

import {
  activateAcceptedSchoolInvitation,
  createSchoolInvitation,
} from "./school-invitations";
import type { UserContext } from "../middlewares/auth";

const key = "test-clerk-server-key";
const claimId = "f8b933d3-9144-48ca-996a-30af76c10a22";
const actor = {
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

describe("school invitation account notifications", () => {
  beforeEach(() => {
    vi.stubEnv("CLERK_SECRET_KEY", key);
    vi.clearAllMocks();
    mocks.steps.length = 0;
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) {
        return { rows: [{ id: 21, clerkUserId: "user_existing", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") mocks.steps.push("COMMIT");
      if (sql.includes("INSERT INTO school_memberships")) {
        return {
          rows: [{ id: 42, userId: 21, schoolId: 3, role: "SCHOOL_ADMIN", status: "ACTIVE" }],
        };
      }
      if (sql.includes("SELECT id,email,status FROM app_users")) {
        return { rows: [{ id: 21, email: "admin@example.test", status: "ACTIVE" }] };
      }
      return { rows: [] };
    });
    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
    mocks.createInvitation.mockResolvedValue({
      id: "inv_communication",
      createdAt: Date.now(),
      status: "pending",
    });
    mocks.revokeInvitation.mockResolvedValue({});
    mocks.queueCommunicationNotification.mockImplementation(async () => {
      mocks.steps.push("QUEUE_ACCOUNT_NOTIFICATION");
      return 1;
    });
    mocks.getUser.mockResolvedValue({
      id: "user_accepted",
      primaryEmailAddress: { emailAddress: "admin@example.test" },
      emailAddresses: [{ emailAddress: "admin@example.test" }],
      firstName: "School",
      lastName: "Admin",
      phoneNumbers: [],
      publicMetadata: {
        edupulseSchoolInvitation: {
          version: 1,
          claimId,
          emailProof: proof("admin@example.test"),
          schoolId: 3,
          role: "SCHOOL_ADMIN",
          employeeNo: null,
          firstName: "School",
          lastName: "Admin",
        },
      },
    });
    mocks.updateUserMetadata.mockResolvedValue({});
  });

  it("notifies an existing account only after its role grant has committed", async () => {
    await createSchoolInvitation(
      {
        schoolId: 3,
        email: "admin@example.test",
        fullName: "School Admin",
        phone: null,
        role: "SCHOOL_ADMIN",
      },
      actor,
    );

    expect(mocks.steps).toEqual(["COMMIT", "QUEUE_ACCOUNT_NOTIFICATION"]);
    expect(mocks.queueCommunicationNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientUserId: 21,
        schoolId: 3,
        category: "ACCOUNT",
        eventKey: "school-invitation:3:role-granted:SCHOOL_ADMIN:21",
        channels: ["IN_APP"],
      }),
    );
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it("does not attempt an in-app invite notification for a guest without a local user", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      if (sql.includes("FROM app_users")) return { rows: [] };
      return { rows: [] };
    });

    const result = await createSchoolInvitation(
      {
        schoolId: 3,
        email: "new.admin@example.test",
        fullName: "New Admin",
        phone: null,
        role: "SCHOOL_ADMIN",
      },
      actor,
    );

    expect(result.status).toBe("INVITATION_SENT");
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mocks.queueCommunicationNotification).not.toHaveBeenCalled();
    expect(mocks.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ notify: true }));
  });

  it("queues a deterministic account notification only after accepted access commits", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      return { rows: [] };
    });

    const activated = await activateAcceptedSchoolInvitation(21, "user_accepted");

    expect(activated).toBe(true);
    expect(mocks.steps).toEqual(["COMMIT", "QUEUE_ACCOUNT_NOTIFICATION"]);
    expect(mocks.queueCommunicationNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientUserId: 21,
        schoolId: 3,
        category: "ACCOUNT",
        eventKey: `school-invitation:${claimId}:activated`,
        channels: ["IN_APP"],
      }),
    );
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith("user_accepted", {
      publicMetadata: { edupulseSchoolInvitation: null },
    });
  });

  it("does not queue anything when Clerk refuses to send an invite", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 3 }] };
      return { rows: [] };
    });
    mocks.createInvitation.mockRejectedValue({ status: 503 });

    await expect(createSchoolInvitation(
      {
        schoolId: 3,
        email: "new.admin@example.test",
        fullName: "New Admin",
        phone: null,
        role: "SCHOOL_ADMIN",
      },
      actor,
    )).rejects.toMatchObject({ statusCode: 503 });

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.queueCommunicationNotification).not.toHaveBeenCalled();
  });
});