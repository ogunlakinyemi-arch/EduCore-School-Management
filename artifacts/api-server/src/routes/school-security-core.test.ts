import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assertSecurityRead: vi.fn(),
  requireAnySecurityAccess: vi.fn(),
  listSecurityEvents: vi.fn(),
}));

vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  },
  requireAuthentication: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/school-security-core-service", async () => {
  const { z } = await import("zod");
  return {
    assertSecurityRead: state.assertSecurityRead,
    requireAnySecurityAccess: state.requireAnySecurityAccess,
    listSecurityEvents: state.listSecurityEvents,
    securityEventTypeSchema: z.enum(["ENTRY", "EXIT"]),
    grantInputSchema: z.any(),
    locationInputSchema: z.any(),
    presenceReviewInputSchema: z.any(),
    readerInputSchema: z.any(),
    securitySettingsInputSchema: z.any(),
    configureSecurityReader: vi.fn(),
    createSecurityLocation: vi.fn(),
    getSecurityDashboard: vi.fn(),
    getSchoolSecurityAccess: vi.fn(),
    getSecuritySettings: vi.fn(),
    getParentChildSecuritySummary: vi.fn(),
    grantSchoolSecurityStaff: vi.fn(),
    listCampusPresence: vi.fn(),
    listEligibleSecurityDevices: vi.fn(),
    listSecurityGrants: vi.fn(),
    listSecurityLocations: vi.fn(),
    listSecurityReaders: vi.fn(),
    markSecurityCardLost: vi.fn(),
    requireSecurityAccess: vi.fn(),
    reviewCampusPresence: vi.fn(),
    revokeSchoolSecurityGrant: vi.fn(),
    setSecurityLocationStatus: vi.fn(),
    setSecurityReaderStatus: vi.fn(),
    updateSecuritySettings: vi.fn(),
  };
});

import router from "./school-security-core";

const app = express();
app.use(express.json());
app.use(router);
app.use((error: { statusCode?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
  res.status(error.statusCode ?? 500).json({ error: error.message ?? "Internal error" }));

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

beforeEach(() => {
  vi.clearAllMocks();
  state.assertSecurityRead.mockResolvedValue(undefined);
  state.requireAnySecurityAccess.mockResolvedValue(undefined);
  state.listSecurityEvents.mockResolvedValue([]);
});

describe("security event query authorization", () => {
  it("allows a pickup approver to query only one student's confirmed EXIT events", async () => {
    const response = await fetch(
      `${baseUrl}/schools/22/security/events?studentId=44&eventType=EXIT&result=CONFIRMED`,
    );

    expect(response.status).toBe(200);
    expect(state.requireAnySecurityAccess).toHaveBeenCalledWith(
      expect.anything(), 22, ["SECURITY_READ", "PICKUP_APPROVE"],
    );
    expect(state.assertSecurityRead).not.toHaveBeenCalled();
    expect(state.listSecurityEvents).toHaveBeenCalledWith(22, expect.objectContaining({
      studentId: 44, eventType: "EXIT", result: "CONFIRMED",
    }));
  });

  it("keeps global or insufficiently scoped queries behind SECURITY_READ", async () => {
    state.assertSecurityRead.mockRejectedValue({ statusCode: 404, message: "Not found" });

    const response = await fetch(`${baseUrl}/schools/22/security/events`);

    expect(response.status).toBe(404);
    expect(state.assertSecurityRead).toHaveBeenCalledTimes(1);
    expect(state.requireAnySecurityAccess).not.toHaveBeenCalled();
    expect(state.listSecurityEvents).not.toHaveBeenCalled();
  });

  it("does not allow PICKUP_APPROVE to broaden a student filter to other event types", async () => {
    state.assertSecurityRead.mockRejectedValue({ statusCode: 404, message: "Not found" });

    const response = await fetch(
      `${baseUrl}/schools/22/security/events?studentId=44&eventType=ENTRY&result=CONFIRMED`,
    );

    expect(response.status).toBe(404);
    expect(state.assertSecurityRead).toHaveBeenCalledTimes(1);
    expect(state.requireAnySecurityAccess).not.toHaveBeenCalled();
    expect(state.listSecurityEvents).not.toHaveBeenCalled();
  });
});