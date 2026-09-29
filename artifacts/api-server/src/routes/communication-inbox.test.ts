import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
  entitled: true,
  notification: {
    id: 8, schoolId: 4, category: "ANNOUNCEMENT", subject: "School update",
    body: "A notice", link: "/students", origin: "CAMPAIGN", isRead: false,
    createdAt: "2026-09-01T10:00:00.000Z", readAt: null,
  } as Record<string, any>,
  notificationRows: null as Record<string, any>[] | null,
  authorizedSubjectStudentIds: null as number[] | null,
  preference: {
    id: 9, schoolId: 4, category: "FINANCE", channel: "SMS", enabled: false,
    mandatory: false,
    updatedAt: "2026-09-01T10:00:00.000Z",
  } as Record<string, any>,
  device: {
    id: 11, schoolId: 4, provider: "WEB_PUSH", status: "ACTIVE",
    opaqueDeviceReference: "must-not-leak-reference",
    createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: null, revokedAt: null,
  } as Record<string, any>,
  existingPushDevice: false,
  activePushDeviceCount: 0,
  recentPushRegistrationCount: 0,
  notificationExists: true,
}));

const dbMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes(" AS allowed")) return { rows: [{ allowed: state.entitled }], rowCount: 1 };
    if (sql.includes("FROM communication_notifications n") && sql.includes("COUNT(*)")) {
      return { rows: [{ count: 3 }], rowCount: 1 };
    }
    if (sql.includes("WITH changed AS") && sql.includes("UPDATE communication_notifications")) {
      return { rows: [{ count: 2 }], rowCount: 1 };
    }
    if (sql.includes("FROM communication_notifications n")) {
      let rows = state.notificationRows ?? [{ ...state.notification }];
      if (state.authorizedSubjectStudentIds !== null) {
        rows = rows.filter((row) =>
          row.subjectStudentId == null || state.authorizedSubjectStudentIds!.includes(row.subjectStudentId),
        );
      }
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM communication_preferences")) return { rows: [{ ...state.preference }], rowCount: 1 };
    if (sql.includes("FROM communication_push_devices")) {
      return { rows: [{ ...state.device }], rowCount: 1 };
    }
    throw new Error(`Unexpected communication pool query: ${sql}`);
  });

  const clientQuery = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes(" AS allowed")) return { rows: [{ allowed: state.entitled }], rowCount: 1 };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (sql.includes("FROM communication_push_devices") && sql.includes("opaque_device_reference=$3")) {
      return {
        rows: state.existingPushDevice ? [{ ...state.device }] : [],
        rowCount: state.existingPushDevice ? 1 : 0,
      };
    }
    if (sql.includes("SELECT COUNT(*)::int AS count") && sql.includes("communication_push_devices")) {
      const count = sql.includes("created_at >=")
        ? state.recentPushRegistrationCount
        : state.activePushDeviceCount;
      return { rows: [{ count }], rowCount: 1 };
    }
    if (sql.includes("UPDATE communication_push_devices SET last_used_at")) {
      return { rows: [{ ...state.device }], rowCount: 1 };
    }
    if (sql.includes("WITH target AS") && sql.includes("communication_notifications")) {
      return {
        rows: state.notificationExists
          ? [{ id: 8, schoolId: 4, wasRead: false }]
          : [],
        rowCount: state.notificationExists ? 1 : 0,
      };
    }
    if (sql.includes("FROM communication_notifications n")) {
      return {
        rows: state.notificationExists
          ? [{ ...state.notification, isRead: true, readAt: "2026-09-01T10:05:00.000Z", deliveries: [] }]
          : [],
        rowCount: state.notificationExists ? 1 : 0,
      };
    }
    if (sql.includes("UPDATE communication_deliveries")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO communication_preferences")) {
      return { rows: [{ ...state.preference, enabled: values[values.length - 1] }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO communication_push_devices")) {
      return { rows: [{ ...state.device }], rowCount: 1 };
    }
    if (sql.includes("UPDATE communication_push_devices")) {
      return {
        rows: state.notificationExists ? [{ id: 11, schoolId: 4 }] : [],
        rowCount: state.notificationExists ? 1 : 0,
      };
    }
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected communication client query: ${sql}`);
  });

  return {
    query,
    clientQuery,
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  };
});

vi.mock("@workspace/db", () => ({
  pool: { query: dbMock.query, connect: dbMock.connect },
}));

vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    requireAuthentication: () =>
      (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        const mode = req.header("x-test-role") ?? "PARENT";
        const roles = mode === "OWNER_DUAL"
          ? [
              { id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" },
              { id: 2, role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" },
            ]
          : mode === "PARTNER"
            ? [{ id: 1, role: "PARTNER", schoolId: null, status: "ACTIVE" }]
            : mode === "MEMBER"
              ? [{ id: 1, role: "SCHOOL_ADMIN", schoolId: 4, status: "ACTIVE" }]
              : [{ id: 1, role: "PARENT", schoolId: null, status: "ACTIVE" }];
        (req as any).edupulseUser = {
          user: {
            id: 73, clerkUserId: "communication-inbox-user", email: "person@example.test",
            firstName: "Test", lastName: "User",
          },
          roles,
        };
        next();
      },
  };
});

import communicationInboxRouter from "./communication-inbox";

const app = express();
app.use(express.json());
app.use(communicationInboxRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.calls.length = 0;
  state.entitled = true;
  state.notificationExists = true;
  state.notification = {
    id: 8, schoolId: 4, category: "ANNOUNCEMENT", subject: "School update",
    body: "A notice", link: "/students", origin: "CAMPAIGN", isRead: false,
    createdAt: "2026-09-01T10:00:00.000Z", readAt: null,
  };
  state.notificationRows = null;
  state.authorizedSubjectStudentIds = null;
  state.preference = {
    id: 9, schoolId: 4, category: "FINANCE", channel: "SMS", enabled: false,
    mandatory: false,
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  state.device = {
    id: 11, schoolId: 4, provider: "WEB_PUSH", status: "ACTIVE",
    opaqueDeviceReference: "must-not-leak-reference",
    createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: null, revokedAt: null,
  };
  state.existingPushDevice = false;
  state.activePushDeviceCount = 0;
  state.recentPushRegistrationCount = 0;
  dbMock.query.mockClear();
  dbMock.clientQuery.mockClear();
});

describe("communication inbox recipient, tenant, and push privacy", () => {
  it("returns the generated paginated inbox shape scoped to the authenticated recipient", async () => {
    const response = await fetch(`${baseUrl}/communication/notifications`);
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(Object.keys(body).sort()).toEqual(["hasMore", "items", "nextBeforeId", "unreadCount"]);
    expect(body).toMatchObject({
      unreadCount: 3,
      hasMore: false,
      nextBeforeId: null,
      items: [{
        id: 8, schoolId: 4, category: "ANNOUNCEMENT", subject: "School update",
        body: "A notice", origin: "CAMPAIGN", isRead: false,
      }],
    });
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "body", "category", "createdAt", "deliveries", "id", "isRead", "link", "origin", "readAt", "schoolId", "subject",
    ]);
    const listQuery = state.calls.find(({ sql }) => sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"))!;
    expect(listQuery.values).toEqual([73, 51]);
    expect(listQuery.sql).toContain("n.recipient_user_id=$1");
    expect(listQuery.sql).toContain("communication_campaign_recipients cr");
    expect(listQuery.sql).toContain("THEN 'CAMPAIGN' ELSE 'SYSTEM'");
    expect(listQuery.sql).toContain("parent_student_relationships");
    expect(listQuery.sql).toContain("rel.status='ACTIVE'");
    expect(listQuery.sql).toContain("partner_profile_users");
  });

  it("marks manual finance campaign notices as campaign-origin", async () => {
    state.notification.category = "FINANCE";
    state.notification.origin = "CAMPAIGN";
    const response = await fetch(`${baseUrl}/communication/notifications`);
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.items[0]).toMatchObject({ category: "FINANCE", origin: "CAMPAIGN" });
    const listQuery = state.calls.find(({ sql }) =>
      sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"),
    )!;
    expect(listQuery.sql).toContain("EXISTS (");
    expect(listQuery.sql).toContain("cr.notification_id=n.id");
  });

  it("marks backend finance notices without a campaign recipient as system-origin", async () => {
    state.notification.category = "FINANCE";
    state.notification.origin = "SYSTEM";
    const response = await fetch(`${baseUrl}/communication/notifications`);
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.items[0]).toMatchObject({ category: "FINANCE", origin: "SYSTEM" });
    const listQuery = state.calls.find(({ sql }) =>
      sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"),
    )!;
    expect(listQuery.sql).toContain("WHEN EXISTS");
    expect(listQuery.sql).toContain("ELSE 'SYSTEM' END AS origin");
  });

  it("keeps a mixed-role Platform Owner in global-only notification scope", async () => {
    const schoolResponse = await fetch(`${baseUrl}/communication/notifications?schoolId=4`, {
      headers: { "x-test-role": "OWNER_DUAL" },
    });
    expect(schoolResponse.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO communication_preferences"))).toBe(false);

    const response = await fetch(`${baseUrl}/communication/notifications`, {
      headers: { "x-test-role": "OWNER_DUAL" },
    });
    expect(response.status).toBe(200);
    const listQuery = state.calls.find(({ sql }) => sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"))!;
    expect(listQuery.sql).toContain("n.school_id IS NULL");
    expect(listQuery.sql).not.toContain("school_memberships");
  });

  it("keeps a mixed-role Platform Owner global-only across preferences and push devices", async () => {
    const ownerHeaders = { "x-test-role": "OWNER_DUAL" };
    const scopedRequests: Array<[string, RequestInit]> = [
      [`${baseUrl}/communication/preferences?schoolId=4`, { headers: ownerHeaders }],
      [`${baseUrl}/communication/preferences`, {
        method: "PUT",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ schoolId: 4, category: "FINANCE", channel: "EMAIL", enabled: true }),
      }],
      [`${baseUrl}/communication/push-devices?schoolId=4`, { headers: ownerHeaders }],
      [`${baseUrl}/communication/push-devices`, {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ schoolId: 4, opaqueDeviceReference: "opaque-reference" }),
      }],
      [`${baseUrl}/communication/push-devices/11?schoolId=4`, {
        method: "DELETE",
        headers: ownerHeaders,
      }],
    ];
    for (const [url, init] of scopedRequests) {
      expect((await fetch(url, init)).status).toBe(404);
    }
    expect(state.calls.some(({ sql }) =>
      sql.includes("communication_preferences") || sql.includes("communication_push_devices"),
    )).toBe(false);
  });

  it("denies an unrelated school's notification scope before reading rows", async () => {
    state.entitled = false;
    const response = await fetch(`${baseUrl}/communication/notifications?schoolId=99`);
    expect(response.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("FROM communication_notifications n"))).toBe(false);
    const entitlement = state.calls.find(({ sql }) => sql.includes(" AS allowed"))!;
    expect(entitlement.values).toEqual([73, 99]);
    expect(entitlement.sql).toContain("parent_student_relationships");
    expect(entitlement.sql).toContain("school_partner_attributions");
  });

  it("hides a revoked child's student/class alert while retaining the linked sibling's alert", async () => {
    const revokedChildNotice = {
      id: 101, schoolId: 4, subjectStudentId: 501, subjectClassId: 40,
      category: "FINANCE", subject: "Child A invoice", body: "A-only notice",
      link: null, origin: "SYSTEM", isRead: false,
      createdAt: "2026-09-01T10:00:00.000Z", readAt: null, deliveries: [],
    };
    const linkedChildNotice = {
      id: 102, schoolId: 4, subjectStudentId: 502, subjectClassId: 40,
      category: "FINANCE", subject: "Child B invoice", body: "B-only notice",
      link: null, origin: "SYSTEM", isRead: false,
      createdAt: "2026-09-01T10:01:00.000Z", readAt: null, deliveries: [],
    };
    state.notificationRows = [revokedChildNotice, linkedChildNotice];
    state.authorizedSubjectStudentIds = [502];

    const response = await fetch(`${baseUrl}/communication/notifications?schoolId=4`);
    expect(response.status).toBe(200);
    const inbox: any = await response.json();
    expect(inbox.items.map((item: any) => item.id)).toEqual([102]);
    expect(inbox.items[0].body).toBe("B-only notice");
    const listQuery = state.calls.find(({ sql }) =>
      sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"),
    )!;
    expect(listQuery.sql).toContain("self_student.id=n.subject_student_id");
    expect(listQuery.sql).toContain("linked_student.id=n.subject_student_id");
    expect(listQuery.sql).toContain("rel.status='ACTIVE'");
    expect(listQuery.sql).toContain("enrollment.status='ACTIVE'");
    expect(listQuery.sql).toContain("enrollment.is_current=true");
    expect(listQuery.sql).toContain("subject_class.section=enrollment.section");

    state.notificationExists = false;
    state.calls.length = 0;
    const readResponse = await fetch(`${baseUrl}/communication/notifications/101/read`, { method: "PATCH" });
    expect(readResponse.status).toBe(404);
    const readQuery = state.calls.find(({ sql }) => sql.includes("WITH target AS"))!;
    expect(readQuery.sql).toContain("n.subject_student_id");
    expect(readQuery.sql).toContain("student_class_assignments enrollment");
    expect(readQuery.sql).toContain("rel.status='ACTIVE'");
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(false);
  });

  it("restricts Partner-only inbox entries to partner category and active attribution", async () => {
    const response = await fetch(`${baseUrl}/communication/notifications?schoolId=4`, {
      headers: { "x-test-role": "PARTNER" },
    });
    expect(response.status).toBe(200);
    const listQuery = state.calls.find(({ sql }) => sql.includes("FROM communication_notifications n") && !sql.includes("COUNT(*)"))!;
    expect(listQuery.sql).toContain("n.category='PARTNER'");
    expect(listQuery.sql).toContain("school_partner_attributions");
    expect(listQuery.sql).toContain("spa.is_current=true");
    expect(listQuery.sql).toContain("spa.status='ACTIVE'");
  });

  it("marks only the authenticated user's visible notification read", async () => {
    const response = await fetch(`${baseUrl}/communication/notifications/8/read`, { method: "PATCH" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 8, isRead: true, category: "ANNOUNCEMENT" });
    const update = state.calls.find(({ sql }) => sql.includes("WITH target AS") && sql.includes("communication_notifications"))!;
    expect(update.values).toEqual([73, 8]);
    expect(update.sql).toContain("n.recipient_user_id=$1");
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("marks all only the recipient's currently entitled school notifications read", async () => {
    const response = await fetch(`${baseUrl}/communication/notifications/read-all`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 2 });
    const update = state.calls.find(({ sql }) => sql.includes("WITH changed AS") && sql.includes("UPDATE communication_notifications"))!;
    expect(update.values).toEqual([73]);
    expect(update.sql).toContain("n.recipient_user_id=$1");
    expect(update.sql).toContain("parent_student_relationships");
  });

  it("does not allow account or security preferences to be disabled", async () => {
    for (const category of ["ACCOUNT", "SECURITY"]) {
      const response = await fetch(`${baseUrl}/communication/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schoolId: 4, category, channel: "EMAIL", enabled: false }),
      });
      expect(response.status).toBe(400);
    }
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO communication_preferences"))).toBe(false);
  });

  it("stores a preference for the authenticated user and requested school only", async () => {
    const response = await fetch(`${baseUrl}/communication/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 4, category: "FINANCE", channel: "SMS", enabled: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schoolId: 4, category: "FINANCE", channel: "SMS", enabled: false, mandatory: false,
    });
    const upsert = state.calls.find(({ sql }) => sql.includes("INSERT INTO communication_preferences"))!;
    expect(upsert.values).toEqual([73, 4, "FINANCE", "SMS", false]);
    expect(upsert.sql).toContain("ON CONFLICT (user_id,school_id,category,channel)");
  });

  it("never returns an opaque push device reference", async () => {
    const response = await fetch(`${baseUrl}/communication/push-devices?schoolId=4`);
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: 11, schoolId: 4, provider: "WEB_PUSH", status: "ACTIVE" });
    expect(Object.keys(body[0]).sort()).toEqual([
      "createdAt", "id", "lastUsedAt", "provider", "revokedAt", "schoolId", "status",
    ]);
    expect(JSON.stringify(body)).not.toContain("opaqueDeviceReference");
    expect(JSON.stringify(body)).not.toContain("must-not-leak-reference");
  });

  it("registers an opaque push reference without returning it", async () => {
    const response = await fetch(`${baseUrl}/communication/push-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 4, opaqueDeviceReference: "private-device-reference" }),
    });
    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body).toMatchObject({ id: 11, schoolId: 4, provider: "WEB_PUSH", status: "ACTIVE" });
    expect(JSON.stringify(body)).not.toContain("private-device-reference");
    expect(JSON.stringify(body)).not.toContain("opaqueDeviceReference");
    const insert = state.calls.find(({ sql }) => sql.includes("INSERT INTO communication_push_devices"))!;
    expect(insert.values).toEqual([73, 4, "private-device-reference"]);
  });

  it("returns 429 when the active-device cap or persisted one-minute registration rate is exceeded", async () => {
    state.activePushDeviceCount = 10;
    const activeLimitResponse = await fetch(`${baseUrl}/communication/push-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 4, opaqueDeviceReference: "eleventh-device" }),
    });
    expect(activeLimitResponse.status).toBe(429);
    const activeError: any = await activeLimitResponse.json();
    expect(activeError.error).toContain("Maximum active push devices");
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO communication_push_devices"))).toBe(false);
    const activeCountQuery = state.calls.find(({ sql }) =>
      sql.includes("SELECT COUNT(*)::int AS count") && sql.includes("status='ACTIVE'"),
    )!;
    expect(activeCountQuery.values).toEqual([73, 4]);

    state.calls.length = 0;
    state.activePushDeviceCount = 0;
    state.recentPushRegistrationCount = 5;
    const rateLimitResponse = await fetch(`${baseUrl}/communication/push-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 4, opaqueDeviceReference: "sixth-device-this-minute" }),
    });
    expect(rateLimitResponse.status).toBe(429);
    const rateError: any = await rateLimitResponse.json();
    expect(rateError.error).toContain("Too many push device registrations");
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO communication_push_devices"))).toBe(false);
    const rateCountQuery = state.calls.find(({ sql }) => sql.includes("created_at >= NOW() - INTERVAL '1 minute'"))!;
    expect(rateCountQuery.values).toEqual([73, 4]);
  });

  it("allows an idempotent active-device registration at both limits without consuming quota", async () => {
    state.existingPushDevice = true;
    state.activePushDeviceCount = 10;
    state.recentPushRegistrationCount = 5;
    const response = await fetch(`${baseUrl}/communication/push-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schoolId: 4, opaqueDeviceReference: "already-registered-device" }),
    });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body).toMatchObject({ id: 11, schoolId: 4, status: "ACTIVE" });
    expect(JSON.stringify(body)).not.toContain("opaqueDeviceReference");
    expect(state.calls.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("COUNT(*)::int AS count"))).toBe(false);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO communication_push_devices"))).toBe(false);
    expect(state.calls.some(({ sql }) => sql.includes("UPDATE communication_push_devices SET last_used_at"))).toBe(true);
  });

  it("revokes only an active device owned by the current recipient and scope", async () => {
    const response = await fetch(`${baseUrl}/communication/push-devices/11?schoolId=4`, { method: "DELETE" });
    expect(response.status).toBe(204);
    const update = state.calls.find(({ sql }) => sql.includes("UPDATE communication_push_devices"))!;
    expect(update.values).toEqual([11, 73, 4]);
    expect(update.sql).toContain("user_id=$2");
    expect(update.sql).toContain("status='ACTIVE'");
  });
});