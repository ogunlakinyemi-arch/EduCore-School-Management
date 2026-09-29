import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  roles: [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }],
  recipients: [{ userId: 101, role: "PARENT", studentName: null, parentName: "Parent", className: null }],
  campaignLimitReached: false,
  retryLimitReached: false,
  delivery: {
    id: 9, status: "FAILED", attempts: 4, errorCode: "NETWORK",
    schoolId: 1, category: "ANNOUNCEMENT", recipientUserId: 101,
  } as Record<string, any>,
  campaignId: 0,
}));
const mocks = vi.hoisted(() => ({
  queue: vi.fn(async () => 300),
  dispatch: vi.fn(async () => ({ claimed: 0, accepted: 0, simulated: 0, delivered: 0, failed: 0, skipped: 0 })),
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT COUNT(*)::int AS count") && sql.includes("FROM audit_logs")) {
      return { rows: [{ count: state.retryLimitReached ? 10 : 0 }] };
    }
    if (sql.includes("SELECT COUNT(*)::int AS count")) {
      return { rows: [{ count: state.campaignLimitReached ? 11 : 1 }] };
    }
    if (sql.includes("WITH candidates AS")) return { rows: state.recipients };
    if (sql.includes("SELECT name FROM schools")) return { rows: [{ name: "Rate Limit School" }] };
    if (sql.includes("INSERT INTO communication_campaigns")) {
      const campaign = {
        id: ++state.campaignId, schoolId: values[0], createdByUserId: values[1],
        templateId: values[2], title: values[4], subject: values[5], body: values[6],
        category: values[7], targetType: values[8], targetCriteria: JSON.parse(String(values[9])),
        channels: values[10], status: "QUEUED", recipientCount: values[11],
        createdAt: new Date("2026-01-01T00:00:00.000Z"), sentAt: null,
      };
      return { rows: [campaign] };
    }
    if (sql.includes("FROM communication_campaigns") && sql.includes("idempotency_key=$2")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO communication_campaign_recipients")) return { rows: [] };
    if (sql.includes("FROM communication_deliveries d") && sql.includes("FOR UPDATE OF d")) {
      return { rows: [{ ...state.delivery }] };
    }
    if (sql.includes("UPDATE communication_deliveries")) {
      return { rows: [{
        id: state.delivery.id, channel: "SMS", status: "QUEUED",
        provider: null,
        providerMessageId: null, providerAcknowledgedAt: null, sentAt: null, deliveredAt: null,
        failedAt: null, errorCode: state.delivery.errorCode, lastError: "previous failure",
        attempts: state.delivery.attempts, nextAttemptAt: new Date("2026-01-01T00:00:00.000Z"),
        lastAttemptAt: null,
      }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unhandled SQL in communication-campaigns-rate-limit test: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  }
  return {
    AuthError,
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      const context = (req as any).edupulseUser;
      if (!context.roles.some((role: any) =>
        role.status === "ACTIVE" && role.schoolId === schoolId && roles.includes(role.role))) {
        throw new AuthError(404, "Resource not found");
      }
      return context;
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).edupulseUser = {
        user: { id: 20, clerkUserId: "clerk-rate", email: "rate@example.com", firstName: "Rate", lastName: "Tester" },
        roles: state.roles,
      };
      next();
    },
  };
});
vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: mocks.queue,
  dispatchCommunicationDeliveries: mocks.dispatch,
  renderCommunicationTemplate: (template: { body: string; subject?: string | null }) => ({
    body: template.body, subject: template.subject ?? null,
  }),
}));

import communicationCampaignsRouter from "./communication-campaigns";

const app = express();
app.use(express.json());
app.use(communicationCampaignsRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close(error => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.calls.length = 0;
  state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.recipients = [{ userId: 101, role: "PARENT", studentName: null, parentName: "Parent", className: null }];
  state.campaignLimitReached = false;
  state.retryLimitReached = false;
  state.delivery = {
    id: 9, status: "FAILED", attempts: 4, errorCode: "NETWORK",
    schoolId: 1, category: "ANNOUNCEMENT", recipientUserId: 101,
  };
  state.campaignId = 0;
  mocks.queue.mockClear();
  mocks.dispatch.mockClear();
});

const campaignBody = {
  schoolId: 1,
  title: "Bulk update",
  body: "A general school update.",
  category: "ANNOUNCEMENT",
  targetType: "PARENTS",
  targetCriteria: {},
  channels: ["SMS"],
  idempotencyKey: "rate-limit-campaign",
};

async function postCampaign() {
  return fetch(`${baseUrl}/communication/announcements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(campaignBody),
  });
}

describe("communication campaign and retry rate limits", () => {
  it("serializes campaign creation and rejects an eleventh campaign in the ten-minute sender/school window", async () => {
    state.campaignLimitReached = true;
    const response = await postCampaign();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    const lock = state.calls.find(call => call.sql.includes("pg_advisory_xact_lock"));
    const count = state.calls.find(call => call.sql.includes("SELECT COUNT(*)::int AS count"));
    expect(lock?.values).toEqual([1, 20]);
    expect(count?.sql).toContain("FROM communication_campaigns");
    expect(count?.sql).toContain("INTERVAL '10 minutes'");
    expect(count?.values).toEqual([1, 20]);
  });

  it("caps a single send at 1000 resolved recipients", async () => {
    state.recipients = Array.from({ length: 1001 }, (_, index) => ({
      userId: index + 100, role: "PARENT", studentName: null, parentName: "Parent", className: null,
    }));
    const response = await postCampaign();
    expect(response.status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(state.calls.some(call => call.sql.includes("INSERT INTO communication_campaigns"))).toBe(false);
  });

  it("limits retries using persisted audit actions and preserves the attempts cap", async () => {
    state.retryLimitReached = true;
    const limited = await fetch(`${baseUrl}/communication/deliveries/9/retry`, { method: "POST" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    const retryLock = state.calls.find(call => call.sql.includes("pg_advisory_xact_lock"));
    const retryCount = state.calls.find(call => call.sql.includes("FROM audit_logs")
      && call.sql.includes("COMMUNICATION_DELIVERY_RETRY"));
    const retryUpdate = state.calls.find(call => call.sql.includes("UPDATE communication_deliveries"));
    expect(retryLock?.values).toEqual([1, 20]);
    expect(retryCount?.sql).toContain("INTERVAL '1 minute'");
    expect(retryCount?.values).toEqual([1, 20]);
    expect(retryUpdate).toBeUndefined();
    expect(state.calls.some(call => call.sql.includes("INSERT INTO audit_logs"))).toBe(false);

    state.calls.length = 0;
    state.retryLimitReached = false;
    const allowed = await fetch(`${baseUrl}/communication/deliveries/9/retry`, { method: "POST" });
    expect(allowed.status).toBe(200);
    const allowedUpdate = state.calls.find(call => call.sql.includes("UPDATE communication_deliveries"));
    expect(allowedUpdate?.sql).toContain("attempts<$2");
    expect(allowedUpdate?.values).toEqual([9, 5]);

    state.calls.length = 0;
    state.delivery.attempts = 5;
    const exhausted = await fetch(`${baseUrl}/communication/deliveries/9/retry`, { method: "POST" });
    expect(exhausted.status).toBe(409);
    expect(state.calls.some(call => call.sql.includes("UPDATE communication_deliveries"))).toBe(false);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });
});