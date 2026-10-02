import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  context: {
    user: {
      id: 7,
      clerkUserId: "security-test",
      email: "security-test@example.test",
      firstName: "Security",
      lastName: "Tester",
      phone: null,
      status: "ACTIVE",
    },
    roles: [{ id: 1, role: "STAFF", schoolId: 3 as number | null, status: "ACTIVE" }],
  },
  query: vi.fn(),
  connect: vi.fn(),
  requireSecurityAccess: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: state.query, connect: state.connect },
}));

vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  },
  getUserContext: () => state.context,
  handleAuthError: (error: { statusCode?: number; message?: string }, _req: unknown, res: express.Response) =>
    res.status(error.statusCode ?? 500).json({ error: error.message ?? "Internal error" }),
  requireAuthentication: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/school-security-core-service", () => ({
  requireSecurityAccess: state.requireSecurityAccess,
}));

vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: vi.fn(async () => null),
}));

import { createSchoolSecurityOperationsRouter } from "./school-security-operations";

const app = express();
app.use(express.json());
app.use(createSchoolSecurityOperationsRouter());

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));

beforeEach(() => vi.resetAllMocks());

describe("school security operation authorization boundaries", () => {
  it("delegates visitor-management list reads to the exact VISITOR_MANAGE core permission", async () => {
    state.context.roles = [{ id: 1, role: "STAFF", schoolId: 3, status: "ACTIVE" }];
    state.requireSecurityAccess.mockResolvedValueOnce(state.context);
    state.query.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/schools/3/security/visitors`);

    expect(response.status).toBe(200);
    expect(state.requireSecurityAccess).toHaveBeenCalledWith(
      expect.anything(),
      3,
      "VISITOR_MANAGE",
      { ownerReadOnly: false },
    );
  });

  it("does not expose visitor-management screens to a read-only Platform Owner", async () => {
    state.context.roles = [{ id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.requireSecurityAccess.mockClear();

    const response = await fetch(`${baseUrl}/schools/3/security/visitors`);

    expect(response.status).toBe(403);
    expect(state.requireSecurityAccess).not.toHaveBeenCalled();
  });

  it("does not delegate Platform Owner mutation access", async () => {
    state.context.roles = [{ id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.requireSecurityAccess.mockClear();

    const response = await fetch(`${baseUrl}/schools/3/security/visitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorName: "Visitor", purpose: "Meeting" }),
    });

    expect(response.status).toBe(403);
    expect(state.requireSecurityAccess).not.toHaveBeenCalled();
  });

  it("hides a parent's child data when the live relationship lookup is empty", async () => {
    state.context.roles = [{ id: 3, role: "PARENT", schoolId: 3, status: "ACTIVE" }];
    state.query.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/parent/children/10/security/pickup-requests`);

    expect(response.status).toBe(404);
    expect(state.requireSecurityAccess).not.toHaveBeenCalled();
  });

  it("uses PICKUP_APPROVE for school pickup-person and request list reads", async () => {
    state.context.roles = [{ id: 1, role: "STAFF", schoolId: 3, status: "ACTIVE" }];
    state.requireSecurityAccess.mockResolvedValue(state.context);
    state.query
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rows: [] });

    const persons = await fetch(`${baseUrl}/schools/3/students/10/security/pickup-persons`);
    const requests = await fetch(`${baseUrl}/schools/3/students/10/security/pickup-requests`);

    expect(persons.status).toBe(200);
    expect(requests.status).toBe(200);
    expect(state.requireSecurityAccess).toHaveBeenNthCalledWith(
      1, expect.anything(), 3, "PICKUP_APPROVE", { ownerReadOnly: false },
    );
    expect(state.requireSecurityAccess).toHaveBeenNthCalledWith(
      2, expect.anything(), 3, "PICKUP_APPROVE", { ownerReadOnly: false },
    );
  });

  it("uses INCIDENT_MANAGE for incident-list reads instead of broad SECURITY_READ", async () => {
    state.context.roles = [{ id: 1, role: "STAFF", schoolId: 3, status: "ACTIVE" }];
    state.requireSecurityAccess.mockResolvedValueOnce(state.context);
    state.query.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${baseUrl}/schools/3/security/incidents`);

    expect(response.status).toBe(200);
    expect(state.requireSecurityAccess).toHaveBeenCalledWith(
      expect.anything(), 3, "INCIDENT_MANAGE", { ownerReadOnly: false },
    );
  });

  it("requires the documented idempotency header for typed pickup completion", async () => {
    state.context.roles = [{ id: 1, role: "STAFF", schoolId: 3, status: "ACTIVE" }];
    state.requireSecurityAccess.mockResolvedValueOnce(state.context);
    state.query.mockResolvedValueOnce({ rows: [{ id: 10 }] });

    const response = await fetch(
      `${baseUrl}/schools/3/students/10/security/pickup-requests/20/completion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 2,
          pickupPersonId: 30,
          recordedSecurityEventId: 40,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("does not expose incident attachment details to read-only Owner sessions", async () => {
    state.context.roles = [{ id: 2, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }];
    state.requireSecurityAccess.mockClear();

    const response = await fetch(`${baseUrl}/schools/3/security/incidents/40/attachments`);

    expect(response.status).toBe(403);
    expect(state.requireSecurityAccess).not.toHaveBeenCalled();
  });

  it("requires the core INCIDENT_MANAGE detail permission before serving parent-requested attachment details", async () => {
    state.context.roles = [{ id: 3, role: "PARENT", schoolId: 3, status: "ACTIVE" }];
    state.requireSecurityAccess.mockRejectedValueOnce(
      Object.assign(new Error("School security operation not found"), { statusCode: 404 }),
    );

    const response = await fetch(`${baseUrl}/schools/3/security/incidents/40/attachments`);

    expect(response.status).toBe(404);
    expect(state.requireSecurityAccess).toHaveBeenLastCalledWith(
      expect.anything(),
      3,
      "INCIDENT_MANAGE",
      { ownerReadOnly: false },
    );
  });
});