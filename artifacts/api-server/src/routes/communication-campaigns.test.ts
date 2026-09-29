import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  roles: [] as Array<{ role: string; schoolId: number | null; status: string }>,
  userId: 20,
  teacherAssigned: true,
  recipients: [
    { userId: 101, role: "PARENT", studentName: "A Student", parentName: "A Parent", className: "Grade 4" },
    { userId: 102, role: "STUDENT", studentName: "B Student", parentName: "B Parent", className: "Grade 4" },
  ] as Array<Record<string, unknown>>,
  campaigns: new Map<string, Record<string, any>>(),
  nextCampaignId: 40,
  delivery: {
    id: 9, status: "FAILED", attempts: 4, errorCode: "NETWORK",
    schoolId: 1, category: "ANNOUNCEMENT", recipientUserId: 101,
  } as Record<string, any>,
}));

const serviceMock = vi.hoisted(() => ({
  queue: vi.fn(async () => 301),
  dispatch: vi.fn(async () => ({ claimed: 0, accepted: 0, simulated: 0, delivered: 0, failed: 0, skipped: 0 })),
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM teacher_class_assignments tca")) {
      return { rows: state.teacherAssigned ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("WITH candidates AS") && Array.isArray(values[1])) {
      const selected = new Set(values[1] as number[]);
      return { rows: state.recipients.filter(row => selected.has(Number(row.userId))) };
    }
    if (sql.includes("WITH candidates AS")) return { rows: state.recipients };
    if (sql.includes("SELECT COUNT(*)::int AS count")) return { rows: [{ count: 2 }] };
    if (sql.includes("SELECT name FROM schools")) return { rows: [{ name: "Example School" }] };
    if (sql.includes("INSERT INTO communication_templates")) {
      return { rows: [{
        id: 80, schoolId: values[0], templateKey: values[1], name: values[2], category: values[3],
        channel: values[4], subject: values[5], body: values[6], allowedVariables: values[7],
        isActive: values[8], createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }] };
    }
    if (sql.includes("FROM communication_templates") && sql.includes("WHERE id=$1 AND school_id=$2")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO communication_campaigns")) {
      const key = `${values[0]}:${values[3]}`;
      if (state.campaigns.has(key)) return { rows: [] };
      const campaign = {
        id: ++state.nextCampaignId,
        schoolId: values[0],
        createdByUserId: values[1],
        templateId: values[2],
        title: values[4],
        subject: values[5],
        body: values[6],
        category: values[7],
        targetType: values[8],
        targetCriteria: JSON.parse(String(values[9])),
        channels: values[10],
        status: "QUEUED",
        recipientCount: values[11],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        sentAt: null,
      };
      state.campaigns.set(key, campaign);
      return { rows: [campaign] };
    }
    if (sql.includes("FROM communication_campaigns") && sql.includes("idempotency_key=$2")) {
      return { rows: [state.campaigns.get(`${values[0]}:${values[1]}`)].filter(Boolean) };
    }
    if (sql.includes("FROM communication_campaigns c")) {
      return { rows: [...state.campaigns.values()] };
    }
    if (sql.includes("INSERT INTO communication_campaign_recipients")) return { rows: [] };
    if (sql.includes("FROM communication_deliveries d") && sql.includes("FOR UPDATE OF d")) {
      return { rows: [{ ...state.delivery }] };
    }
    if (sql.includes("UPDATE communication_deliveries") && sql.includes("RETURNING id,channel,status")) {
      return { rows: [{
        id: state.delivery.id, channel: "SMS", status: "QUEUED", provider: null,
        providerMessageId: null, providerAcknowledgedAt: null, sentAt: null, deliveredAt: null,
        failedAt: null, errorCode: state.delivery.errorCode, lastError: "previous failure",
        attempts: state.delivery.attempts, nextAttemptAt: new Date("2026-01-01T00:00:00.000Z"),
        lastAttemptAt: null,
      }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    throw new Error(`Unhandled SQL in communication-campaigns test: ${sql}`);
  });
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
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
      if (context.roles.some((item: any) =>
        item.role === "PLATFORM_OWNER" && item.schoolId === null && item.status === "ACTIVE")) {
        throw new AuthError(404, "Resource not found");
      }
      const allowed = context.roles.some((item: any) =>
        item.status === "ACTIVE" && item.schoolId === schoolId && roles.includes(item.role));
      if (!allowed) throw new AuthError(404, "Resource not found");
      return context;
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as any).edupulseUser = {
        user: {
          id: state.userId, clerkUserId: "clerk-test", email: "test@example.com",
          firstName: "Test", lastName: "User",
        },
        roles: state.roles,
      };
      next();
    },
  };
});
vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: serviceMock.queue,
  dispatchCommunicationDeliveries: serviceMock.dispatch,
  renderCommunicationTemplate: (source: { body: string; subject?: string | null }) => ({
    body: source.body,
    subject: source.subject ?? null,
  }),
}));

import communicationCampaignsRouter from "./communication-campaigns";

const app = express();
app.use(express.json());
app.use(communicationCampaignsRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.calls.length = 0;
  state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.userId = 20;
  state.teacherAssigned = true;
  state.recipients = [
    { userId: 101, role: "PARENT", studentName: "A Student", parentName: "A Parent", className: "Grade 4" },
    { userId: 102, role: "STUDENT", studentName: "B Student", parentName: "B Parent", className: "Grade 4" },
  ];
  state.campaigns.clear();
  state.nextCampaignId = 40;
  state.delivery = {
    id: 9, status: "FAILED", attempts: 4, errorCode: "NETWORK",
    schoolId: 1, category: "ANNOUNCEMENT", recipientUserId: 101,
  };
  serviceMock.queue.mockClear();
  serviceMock.dispatch.mockClear();
});

async function call(path: string, options: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? {} : { "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

const previewBody = {
  schoolId: 1,
  targetType: "CLASS",
  targetCriteria: { classId: 4 },
  channels: ["IN_APP", "SMS"],
};

const announcementBody = {
  schoolId: 1,
  title: "School update",
  subject: "Important",
  body: "Please read the school update.",
  category: "ANNOUNCEMENT",
  targetType: "CLASS",
  targetCriteria: { classId: 4 },
  channels: ["IN_APP"],
  idempotencyKey: "announcement-key-01",
};

describe("school communication campaigns", () => {
  it("previews server-resolved recipients and limits teachers to their assigned class", async () => {
    state.roles = [{ role: "TEACHER", schoolId: 1, status: "ACTIVE" }];
    const response = await call("/communication/announcements/preview", {
      method: "POST",
      body: previewBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schoolId: 1,
      recipientCount: 2,
      channelCounts: [
        { channel: "IN_APP", eligibleRecipientCount: 2 },
        { channel: "SMS", eligibleRecipientCount: 2 },
      ],
    });
    expect(state.calls.find(call => call.sql.includes("teacher_class_assignments tca"))?.values)
      .toEqual([1, 4, 20, null]);

    state.teacherAssigned = false;
    const denied = await call("/communication/announcements/preview", {
      method: "POST",
      body: previewBody,
    });
    expect(denied.status).toBe(404);
  });

  it("rejects platform owners even when they also have an active school role", async () => {
    state.roles = [
      { role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
      { role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" },
    ];
    const response = await call("/communication/announcements/preview", {
      method: "POST",
      body: { ...previewBody, targetType: "SCHOOL", targetCriteria: {} },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toHaveProperty("error");
    expect(state.calls.some(call => call.sql.includes("WITH candidates AS"))).toBe(false);
  });

  it("rejects injected recipient IDs and unknown criteria fields", async () => {
    const response = await call("/communication/announcements/preview", {
      method: "POST",
      body: { ...previewBody, targetType: "USERS", targetCriteria: { userIds: [101, 9001] } },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toHaveProperty("error");

    const invalid = await call("/communication/announcements/preview", {
      method: "POST",
      body: { ...previewBody, targetCriteria: { classId: 4, userId: 9001 } },
    });
    expect(invalid.status).toBe(400);
  });

  it("limits accountants to finance-related announcements", async () => {
    state.roles = [{ role: "ACCOUNTANT", schoolId: 1, status: "ACTIVE" }];
    const response = await call("/communication/announcements", {
      method: "POST",
      body: { ...announcementBody, targetType: "PARENTS", targetCriteria: {} },
    });
    expect(response.status).toBe(403);
    expect(state.calls.some(call => call.sql.includes("INSERT INTO communication_campaigns"))).toBe(false);
  });

  it("creates a campaign once for an idempotency key and queues no duplicate notifications", async () => {
    const first = await call("/communication/announcements", {
      method: "POST",
      body: announcementBody,
    });
    expect(first.status).toBe(201);
    expect((await first.json() as { recipientCount: number }).recipientCount).toBe(2);
    expect(serviceMock.queue).toHaveBeenCalledTimes(2);

    const repeated = await call("/communication/announcements", {
      method: "POST",
      body: announcementBody,
    });
    expect(repeated.status).toBe(200);
    expect((await repeated.json() as { id: number }).id).toBe(41);
    expect(serviceMock.queue).toHaveBeenCalledTimes(2);
    expect(state.calls.filter(call => call.sql.includes("INSERT INTO communication_campaigns"))).toHaveLength(2);
  });

  it("lists school-scoped campaign history and refuses cross-school queries", async () => {
    state.campaigns.set("1:history-key", {
      id: 12, schoolId: 1, createdByUserId: 20, templateId: null, title: "History item",
      subject: null, body: "A previously sent message.", category: "ANNOUNCEMENT",
      targetType: "CLASS", targetCriteria: { classId: 4 }, channels: ["IN_APP"],
      status: "QUEUED", recipientCount: 2, createdAt: new Date("2026-01-01T00:00:00.000Z"),
      sentAt: null,
    });
    const response = await call("/communication/announcements?schoolId=1");
    expect(response.status).toBe(200);
    const history = await response.json() as { items: Array<{ id: number }>; hasMore: boolean };
    expect(history.items.map(item => item.id)).toEqual([12]);
    expect(history.hasMore).toBe(false);

    const crossSchool = await call("/communication/announcements?schoolId=2");
    expect(crossSchool.status).toBe(404);
  });

  it("creates templates only for the authorized school and validates placeholders", async () => {
    const template = {
      schoolId: 1,
      templateKey: "weekly-update",
      name: "Weekly update",
      category: "ANNOUNCEMENT",
      channel: "IN_APP",
      subject: "From {{school_name}}",
      body: "A note from {{school_name}}.",
      allowedVariables: ["school_name"],
    };
    const created = await call("/communication/templates", { method: "POST", body: template });
    expect(created.status).toBe(201);
    expect((await created.json() as { templateKey: string }).templateKey).toBe("weekly-update");

    const crossSchool = await call("/communication/templates", {
      method: "POST",
      body: { ...template, schoolId: 2 },
    });
    expect(crossSchool.status).toBe(404);

    const unapprovedPlaceholder = await call("/communication/templates", {
      method: "POST",
      body: { ...template, templateKey: "unsafe", body: "Hello {{user_id}}" },
    });
    expect(unapprovedPlaceholder.status).toBe(400);
  });

  it("retries only eligible failed deliveries and enforces the retry cap", async () => {
    const response = await call("/communication/deliveries/9/retry", { method: "POST" });
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("QUEUED");
    expect(serviceMock.dispatch).toHaveBeenCalledTimes(1);

    state.delivery.attempts = 5;
    const exhausted = await call("/communication/deliveries/9/retry", { method: "POST" });
    expect(exhausted.status).toBe(409);
    expect(serviceMock.dispatch).toHaveBeenCalledTimes(1);
  });
});