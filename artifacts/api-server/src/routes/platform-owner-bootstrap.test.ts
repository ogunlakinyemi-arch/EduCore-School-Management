import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type TestUser = {
  id: number;
  clerkUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: "ACTIVE";
};

type TestMembership = {
  id: number;
  userId: number;
  schoolId: null;
  role: "PLATFORM_OWNER";
  status: "ACTIVE";
};

const testState = vi.hoisted(() => ({
  users: [] as TestUser[],
  memberships: [] as TestMembership[],
  nextUserId: 1,
  nextMembershipId: 1,
}));

const clerkUsers = vi.hoisted(() => ({
  createUser: vi.fn(),
  getUserList: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getUser: vi.fn(),
}));

const poolMock = vi.hoisted(() => {
  const ownerExists = () =>
    testState.memberships.some(
      (membership) =>
        membership.schoolId === null && membership.role === "PLATFORM_OWNER",
    );

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("SELECT EXISTS") && text.includes("school_memberships")) {
      if (text.includes("u.clerk_user_id")) {
        const clerkUserId = String(values[0]);
        const exists = testState.users.some(
          (user) =>
            user.clerkUserId === clerkUserId &&
            testState.memberships.some(
              (membership) =>
                membership.userId === user.id &&
                membership.schoolId === null &&
                membership.role === "PLATFORM_OWNER",
            ),
        );
        return { rows: [{ exists }], rowCount: 1 };
      }
      return { rows: [{ exists: ownerExists() }], rowCount: 1 };
    }

    if (text.includes("FROM app_users WHERE clerk_user_id")) {
      const user = testState.users.find(
        (candidate) => candidate.clerkUserId === values[0],
      );
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (text.includes("FROM school_memberships") && text.includes("WHERE user_id")) {
      const memberships = testState.memberships
        .filter(
          (membership) =>
            membership.userId === values[0] && membership.status === "ACTIVE",
        )
        .map((membership) => ({
          id: membership.id,
          role: membership.role,
          schoolId: membership.schoolId,
          status: membership.status,
        }));
      return { rows: memberships, rowCount: memberships.length };
    }

    if (text.includes("INSERT INTO app_users") && text.includes("ON CONFLICT")) {
      const [clerkUserId, email, firstName, lastName, phone] = values;
      let user = testState.users.find(
        (candidate) => candidate.clerkUserId === clerkUserId,
      );
      if (!user) {
        user = {
          id: testState.nextUserId++,
          clerkUserId: String(clerkUserId),
          email: String(email),
          firstName: firstName ? String(firstName) : null,
          lastName: lastName ? String(lastName) : null,
          phone: phone ? String(phone) : null,
          status: "ACTIVE",
        };
        testState.users.push(user);
      }
      return { rows: [user], rowCount: 1 };
    }

    throw new Error(`Unhandled pool query: ${text}`);
  });

  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (
        text === "BEGIN" ||
        text === "COMMIT" ||
        text === "ROLLBACK" ||
        text.includes("pg_advisory_xact_lock")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("SELECT EXISTS") && text.includes("school_memberships")) {
        return { rows: [{ exists: ownerExists() }], rowCount: 1 };
      }

      if (text.includes("SELECT id FROM app_users")) {
        const email = String(values[0]).toLowerCase();
        const user = testState.users.find(
          (candidate) => candidate.email.toLowerCase() === email,
        );
        return { rows: user ? [{ id: user.id }] : [], rowCount: user ? 1 : 0 };
      }

      if (text.includes("INSERT INTO app_users")) {
        const [clerkUserId, email, firstName, lastName, phone] = values;
        const user: TestUser = {
          id: testState.nextUserId++,
          clerkUserId: String(clerkUserId),
          email: String(email),
          firstName: firstName ? String(firstName) : null,
          lastName: lastName ? String(lastName) : null,
          phone: phone ? String(phone) : null,
          status: "ACTIVE",
        };
        testState.users.push(user);
        return { rows: [{ id: user.id }], rowCount: 1 };
      }

      if (text.includes("INSERT INTO school_memberships")) {
        const membership: TestMembership = {
          id: testState.nextMembershipId++,
          userId: Number(values[0]),
          schoolId: null,
          role: "PLATFORM_OWNER",
          status: "ACTIVE",
        };
        testState.memberships.push(membership);
        return { rows: [{ id: membership.id }], rowCount: 1 };
      }

      if (text.includes("INSERT INTO audit_logs")) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled transaction query: ${text}`);
    }),
    release: vi.fn(),
  };

  return {
    query,
    connect: vi.fn(async () => client),
    client,
  };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: clerkUsers },
  getAuth: vi.fn(() => ({ userId: null })),
}));

import bootstrapRouter from "./bootstrap";
import {
  AuthError,
  isPlatformOwner,
  loadUserContext,
  provisionCurrentUser,
} from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use("/api", bootstrapRouter);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof AuthError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.eventType,
      });
      return;
    }
    res.status(500).json({ error: "Internal Server Error" });
  },
);

describe("initial Platform Owner bootstrap lifecycle", () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.EDUPULSE_SETUP_KEY = "disposable-bootstrap-key-123";
    clerkUsers.createUser.mockResolvedValue({
      id: "clerk_owner",
      privateMetadata: { edupulseProvisioning: "platform-owner-bootstrap" },
    });
    clerkUsers.getUserList.mockResolvedValue({ data: [] });
    clerkUsers.getUser.mockImplementation(async (clerkUserId: string) => ({
      id: clerkUserId,
      firstName: "Normal",
      lastName: "User",
      primaryEmailAddress: { emailAddress: "normal@example.test" },
      emailAddresses: [{ emailAddress: "normal@example.test" }],
      phoneNumbers: [],
    }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Disposable bootstrap server did not start");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    delete process.env.EDUPULSE_SETUP_KEY;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates exactly one global owner and keeps normal signup unprivileged", async () => {
    const initialStatus = await fetch(
      `${baseUrl}/api/bootstrap/platform-owner/status`,
    );
    expect(initialStatus.status).toBe(200);
    expect(await initialStatus.json()).toEqual({
      available: true,
      configured: true,
    });

    const createResponse = await fetch(
      `${baseUrl}/api/bootstrap/platform-owner`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
        },
        body: JSON.stringify({
          setupKey: "disposable-bootstrap-key-123",
          fullName: "Disposable Platform Owner",
          email: "owner@example.test",
          phone: "+234 800 000 0000",
          password: "DisposableOwner1!",
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({
      created: true,
      signInPath: "/sign-in",
    });

    expect(testState.users).toHaveLength(1);
    expect(testState.memberships).toEqual([
      expect.objectContaining({
        userId: testState.users[0].id,
        schoolId: null,
        role: "PLATFORM_OWNER",
        status: "ACTIVE",
      }),
    ]);

    const ownerContext = await loadUserContext("clerk_owner");
    expect(isPlatformOwner(ownerContext)).toBe(true);
    expect(ownerContext.roles).toEqual([
      expect.objectContaining({
        schoolId: null,
        role: "PLATFORM_OWNER",
        status: "ACTIVE",
      }),
    ]);

    const lockedStatus = await fetch(
      `${baseUrl}/api/bootstrap/platform-owner/status`,
    );
    expect(await lockedStatus.json()).toEqual({
      available: false,
      configured: true,
    });

    const secondAttempt = await fetch(
      `${baseUrl}/api/bootstrap/platform-owner`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
        },
        body: JSON.stringify({
          setupKey: "disposable-bootstrap-key-123",
          fullName: "Second Platform Owner",
          email: "second-owner@example.test",
          phone: "+234 811 111 1111",
          password: "DisposableOwner2!",
        }),
      },
    );
    expect(secondAttempt.status).toBe(409);
    expect(await secondAttempt.json()).toMatchObject({
      code: "BOOTSTRAP_ALREADY_COMPLETED",
    });
    expect(clerkUsers.createUser).toHaveBeenCalledTimes(1);

    const normalUser = await provisionCurrentUser("clerk_normal");
    const normalContext = await loadUserContext("clerk_normal");
    expect(normalUser.email).toBe("normal@example.test");
    expect(normalContext.roles).toEqual([]);
    expect(isPlatformOwner(normalContext)).toBe(false);
  });
});