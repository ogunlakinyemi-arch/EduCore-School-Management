import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sql: [] as string[],
  roles: [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }],
  recipients: [{
    userId: 101, role: "PARENT", studentName: "Student One", parentName: "Parent One",
    className: "Grade 4", subjectStudentId: 501, subjectClassId: 4,
  }] as Array<Record<string, unknown>>,
  queued: [] as Array<Record<string, unknown>>,
  history: [] as Array<Record<string, unknown>>,
  details: [] as Array<Record<string, unknown>>,
  nextId: 1,
  securityPermissions: [] as Array<{ permission: string; schoolId: number }>,
}));

const mocks = vi.hoisted(() => ({
  queue: vi.fn(async (_client: unknown, input: Record<string, unknown>) => {
    state.queued.push(input);
    return 900;
  }),
  dispatch: vi.fn(async () => ({ claimed: 0, accepted: 0, simulated: 0, delivered: 0, failed: 0, skipped: 0 })),
  requireSecurityAccess: vi.fn(async (_req: unknown, schoolId: number, permission: string) => {
    state.securityPermissions.push({ schoolId, permission });
  }),
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.sql.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM teacher_class_assignments tca")) return { rows: [{ id: 1 }] };
    if (sql.includes("WITH candidates AS")) return { rows: state.recipients };
    if (sql.includes("SELECT COUNT(*)::int AS count")) return { rows: [{ count: 1 }] };
    if (sql.includes("SELECT name FROM schools")) return { rows: [{ name: "North School" }] };
    if (sql.includes("INSERT INTO communication_campaigns")) {
      const campaign = {
        id: state.nextId++, schoolId: values[0], createdByUserId: values[1], templateId: values[2],
        title: values[4], subject: values[5], body: values[6], category: values[7],
        targetType: values[8], targetCriteria: JSON.parse(String(values[9])), channels: values[10],
        status: "QUEUED", recipientCount: values[11], isEmergency: values[12], expiresAt: values[13] ?? null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        sentAt: null,
      };
      return { rows: [campaign] };
    }
    if (sql.includes("INSERT INTO communication_campaign_recipients")) return { rows: [] };
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("FROM communication_campaigns c")) return { rows: state.history };
    if (sql.includes("FROM communication_campaign_recipients cr")) return { rows: state.details };
    throw new Error(`Unhandled SQL in communication-campaigns-security test: ${sql}`);
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
      if (context.roles.some((role: any) =>
        role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE")) {
        throw new AuthError(404, "Resource not found");
      }
      if (!context.roles.some((role: any) =>
        role.schoolId === schoolId && role.status === "ACTIVE" && roles.includes(role.role))) {
        throw new AuthError(404, "Resource not found");
      }
      return context;
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as any).edupulseUser = {
        user: { id: 5, clerkUserId: "clerk", email: "test@example.com", firstName: "Test", lastName: "User" },
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

import { createCommunicationCampaignsRouter } from "./communication-campaigns";

const app = express();
app.use(express.json());
app.use(createCommunicationCampaignsRouter(mocks.requireSecurityAccess));
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
  state.sql.length = 0;
  state.roles = [{ role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }];
  state.recipients = [{
    userId: 101, role: "PARENT", studentName: "Student One", parentName: "Parent One",
    className: "Grade 4", subjectStudentId: 501, subjectClassId: 4,
  }];
  state.queued.length = 0;
  state.history = [];
  state.details = [];
  state.nextId = 1;
  mocks.queue.mockClear();
  mocks.dispatch.mockClear();
  state.securityPermissions.length = 0;
  mocks.requireSecurityAccess.mockClear();
});

async function post(body: unknown) {
  return fetch(`${baseUrl}/communication/announcements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function preview(body: unknown) {
  return fetch(`${baseUrl}/communication/announcements/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const campaign = (category: string, targetType = "PARENTS") => ({
  schoolId: 1,
  title: "School message",
  body: "Please see this update.",
  category,
  targetType,
  targetCriteria: targetType === "CLASS" ? { classId: 4 } : {},
  channels: ["IN_APP"],
  idempotencyKey: `safe-key-${category.toLowerCase()}`,
});

describe("manual communication security", () => {
  it("rejects manual campaigns that impersonate authoritative event categories", async () => {
    for (const category of ["PAYMENT", "ATTENDANCE", "SECURITY", "ACCOUNT"]) {
      const response = await post(campaign(category));
      expect(response.status, category).toBe(400);
    }
    expect(state.sql.some(sql => sql.includes("WITH candidates AS"))).toBe(false);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("requires a School Admin, core emergency grant, audience count confirmation, and campaign audit", async () => {
    const body = {
      ...campaign("SECURITY"),
      isEmergency: true,
      emergencyConfirmation: "I CONFIRM EMERGENCY BROADCAST",
      confirmedRecipientCount: 1,
    };
    const response = await post(body);
    expect(response.status).toBe(201);
    expect(state.securityPermissions).toEqual([{ schoolId: 1, permission: "EMERGENCY_BROADCAST" }]);
    expect(state.queued[0]).toMatchObject({ category: "SECURITY", subject: expect.stringContaining("EMERGENCY") });
    expect(state.queued[0]?.body).toContain("EMERGENCY BROADCAST");
    expect(state.sql.some(sql => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(await response.json()).toMatchObject({ isEmergency: true, expiresAt: null });
  });

  it("provides a permission-checked emergency audience count before confirmation", async () => {
    const response = await preview({
      schoolId: 1, targetType: "PARENTS", targetCriteria: {}, channels: ["IN_APP"],
      category: "SECURITY", isEmergency: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schoolId: 1, recipientCount: 1, channelCounts: [{ channel: "IN_APP", eligibleRecipientCount: 1 }],
    });
    expect(state.securityPermissions).toEqual([{ schoolId: 1, permission: "EMERGENCY_BROADCAST" }]);
  });

  it("rejects emergency broadcasts when the resolved audience differs from the confirmed count", async () => {
    const response = await post({
      ...campaign("SECURITY"),
      isEmergency: true,
      emergencyConfirmation: "I CONFIRM EMERGENCY BROADCAST",
      confirmedRecipientCount: 2,
    });
    expect(response.status).toBe(409);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("does not allow a Teacher to send emergency broadcasts", async () => {
    state.roles = [{ role: "TEACHER", schoolId: 1, status: "ACTIVE" }];
    const response = await post({
      ...campaign("SECURITY"),
      isEmergency: true,
      emergencyConfirmation: "I CONFIRM EMERGENCY BROADCAST",
      confirmedRecipientCount: 1,
    });
    expect(response.status).toBe(403);
    expect(state.securityPermissions).toHaveLength(0);
  });

  it("labels accountant finance messages and passes scoped subject links to the queue", async () => {
    state.roles = [{ role: "ACCOUNTANT", schoolId: 1, status: "ACTIVE" }];
    const response = await post(campaign("FINANCE"));
    expect(response.status).toBe(201);
    expect(mocks.queue).toHaveBeenCalledTimes(1);

    const input = state.queued[0];
    expect(input.category).toBe("FINANCE");
    expect(input.subjectStudentId).toBe(501);
    expect(input.subjectClassId).toBe(4);
    expect(input.subject).toContain("School finance announcement");
    expect(input.body).toContain("not a payment confirmation");
    expect(input.body).toContain("Manually authored by North School");
  });

  it("does not queue an audience whose current class/parent relationship has gone stale", async () => {
    state.roles = [{ role: "TEACHER", schoolId: 1, status: "ACTIVE" }];
    state.recipients = [];
    const response = await post(campaign("ANNOUNCEMENT", "CLASS"));
    expect(response.status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
    const recipientSql = state.sql.find(sql => sql.includes("WITH candidates AS"));
    expect(recipientSql).toContain("sca.is_current=true");
    expect(recipientSql).toContain("UPPER(psr.status)='ACTIVE'");
  });

  it("returns delivery-derived campaign history status", async () => {
    state.history = [{
      id: 7, schoolId: 1, createdByUserId: 5, templateId: null, title: "Completed",
      subject: null, body: "Manually authored school message.", category: "ANNOUNCEMENT",
      targetType: "PARENTS", targetCriteria: {}, channels: ["IN_APP"], status: "SENT",
      recipientCount: 1, createdAt: new Date("2026-01-01T00:00:00.000Z"), sentAt: null,
    }];
    const response = await fetch(`${baseUrl}/communication/announcements?schoolId=1`);
    expect(response.status).toBe(200);
    const history = await response.json() as { items: Array<{ status: string }> };
    expect(history.items[0]?.status).toBe("SENT");
    const historySql = state.sql.find(sql => sql.includes("FROM communication_campaigns c"));
    expect(historySql).toContain("communication_deliveries");
    expect(historySql).toContain("BOOL_OR(d.status='QUEUED')");
  });

  it("labels simulated channel outcomes as development-only and not delivered", async () => {
    state.history = [{
      id: 7, schoolId: 1, createdByUserId: 5, templateId: null, title: "Completed",
      subject: "Manual school message", body: "Manually authored school message.", category: "ANNOUNCEMENT",
      targetType: "PARENTS", targetCriteria: {}, channels: ["SMS"], status: "SENT",
      recipientCount: 1, createdAt: new Date("2026-01-01T00:00:00.000Z"), sentAt: null,
    }];
    state.details = [{
      recipientUserId: 101, recipientRole: "PARENT", status: "SENT",
      deliveries: [{
        id: 901, channel: "SMS", status: "SENT", provider: "dev-test",
        providerMessageId: null, providerAcknowledgedAt: null, sentAt: new Date("2026-01-01T00:00:00.000Z"),
        deliveredAt: null, failedAt: null, errorCode: "SIMULATED",
        lastError: "dev-test: simulated delivery; no external message was sent.",
        attempts: 1, nextAttemptAt: new Date("2026-01-01T00:00:00.000Z"), lastAttemptAt: null,
        simulated: true, label: "Development simulation — no message was sent.",
      }],
    }];
    const response = await fetch(`${baseUrl}/communication/announcements/7`);
    expect(response.status).toBe(200);
    const detail = await response.json() as {
      recipients: Array<{ deliveries: Array<{ simulated: boolean; label: string }> }>;
    };
    expect(detail.recipients[0]?.deliveries[0]?.simulated).toBe(true);
    expect(detail.recipients[0]?.deliveries[0]?.label).toContain("no message was sent");
  });
});