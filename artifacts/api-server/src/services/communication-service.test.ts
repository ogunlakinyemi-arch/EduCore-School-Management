import { describe, expect, it, vi } from "vitest";
import type {
  CommunicationProviderAdapters,
  ProviderSendResult,
} from "./communication-providers";
import {
  dispatchCommunicationDeliveries,
  emitDomainParentEvent,
  queueCommunicationNotification,
  renderCommunicationTemplate,
  type CommunicationDispatchPool,
  type DomainParentEventInput,
  type CommunicationQueryClient,
  type QueueCommunicationNotificationInput,
} from "./communication-service";

function notificationInput(
  overrides: Partial<QueueCommunicationNotificationInput> = {},
): QueueCommunicationNotificationInput {
  return {
    recipientUserId: 17,
    schoolId: 9,
    category: "ANNOUNCEMENT",
    eventKey: "announcement-9-1-user-17",
    subject: "School update",
    body: "School closes early today.",
    link: "/announcements/1",
    channels: ["IN_APP", "SMS", "EMAIL"],
    ...overrides,
  };
}

function queueClient(options: {
  recipient?: boolean;
  insertedId?: number | null;
  duplicateId?: number;
  duplicateSubjectStudentId?: number | null;
  duplicateSubjectClassId?: number | null;
  preferences?: Array<{ channel: string; enabled: boolean }>;
  subjectAuthorized?: boolean;
  classAuthorized?: boolean;
  parents?: Array<{ parentUserId: number; studentName: string; subjectClassId: number | null }>;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async <Row,>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT DISTINCT ON (p.user_id)")) {
        return { rows: (options.parents ?? []) as Row[] };
      }
      if (sql.includes("SELECT u.id") && sql.includes("FROM app_users u")) {
        return { rows: (options.recipient === false ? [] : [{ id: 17 }]) as Row[] };
      }
      if (sql.includes("FROM students subject")) {
        return { rows: (options.subjectAuthorized === false ? [] : [{ id: 321 }]) as Row[] };
      }
      if (sql.includes("FROM school_classes sc")) {
        return { rows: (options.classAuthorized === false ? [] : [{ id: 654 }]) as Row[] };
      }
      if (sql.includes("INSERT INTO communication_notifications")) {
        return { rows: options.insertedId === null ? [] : [{ id: options.insertedId ?? 51 }] as Row[] };
      }
      if (sql.includes('subject_student_id AS "subjectStudentId"') && sql.includes("FROM communication_notifications")) {
        return {
          rows: (options.duplicateId === undefined ? [] : [{
            id: options.duplicateId,
            subjectStudentId: options.duplicateSubjectStudentId ?? null,
            subjectClassId: options.duplicateSubjectClassId ?? null,
          }]) as Row[],
        };
      }
      if (sql.includes("FROM communication_preferences")) {
        return { rows: (options.preferences ?? []).map(row => ({ ...row })) as Row[] };
      }
      return { rows: [] as Row[] };
    }),
  } as unknown as CommunicationQueryClient;
  return { client, calls };
}

function dispatchPool(options: {
  claimed?: Array<{ id: number; channel: "SMS" | "EMAIL"; attempts: number }>;
  record?: Record<string, unknown> | null;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let committed = false;
  const claimClient = {
    query: vi.fn(async <Row,>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql === "COMMIT") committed = true;
      if (sql.includes("RETURNING d.id, d.channel, d.attempts")) {
        return { rows: (options.claimed ?? [{ id: 42, channel: "SMS", attempts: 1 }]) as Row[] };
      }
      return { rows: [] as Row[] };
    }),
    release: vi.fn(),
  } as unknown as CommunicationQueryClient & { release(): void };
  const pool = {
    connect: vi.fn(async () => claimClient),
    query: vi.fn(async <Row,>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("FROM communication_deliveries d")) {
        return {
          rows: (options.record === null
            ? []
            : [options.record ?? {
              id: 42,
              channel: "SMS",
              notificationId: 33,
              recipientUserId: 17,
              schoolId: 9,
              subjectStudentId: null,
              subjectClassId: null,
              category: "ANNOUNCEMENT",
              eventKey: "campaign-9-1-user-17",
              subject: "School update",
              body: "School closes early today.",
              email: "parent@example.test",
              phone: "+2348012345678",
              schoolAuthorized: true,
              userStatus: "ACTIVE",
            }]) as Row[],
        };
      }
      return { rows: [] as Row[] };
    }),
  } as unknown as CommunicationDispatchPool;
  return { pool, calls, committed: () => committed };
}

function testProviders(
  sendSms: () => Promise<ProviderSendResult>,
  sendEmail: () => Promise<ProviderSendResult> = async () => ({
    provider: "test-email",
    channel: "email",
    status: "SIMULATED",
    accepted: false,
    delivered: false,
  }),
): CommunicationProviderAdapters {
  return {
    sms: { provider: "test-sms", channel: "sms", send: vi.fn(sendSms) },
    email: { provider: "test-email", channel: "email", send: vi.fn(sendEmail) },
  };
}

describe("communication queue", () => {
  it("validates active tenant membership, uses idempotent parameterized SQL, and queues only enabled channels", async () => {
    const { client, calls } = queueClient({
      preferences: [{ channel: "SMS", enabled: false }],
    });

    const id = await queueCommunicationNotification(client, notificationInput({
      body: "Body with $1 still remains data.",
    }));

    expect(id).toBe(51);
    const authorization = calls[0];
    expect(authorization.sql).toContain("school_memberships");
    expect(authorization.sql).toContain("students");
    expect(authorization.sql).toContain("parents");
    expect(authorization.values).toEqual([17, 9]);
    const insert = calls.find(call => call.sql.includes("INSERT INTO communication_notifications"));
    expect(insert?.sql).toContain("ON CONFLICT");
    expect(insert?.values).toEqual([
      17, 9, null, null, "ANNOUNCEMENT", "announcement-9-1-user-17", "School update",
      "Body with $1 still remains data.", "/announcements/1",
    ]);
    const deliveryInserts = calls.filter(call => call.sql.includes("INSERT INTO communication_deliveries"));
    expect([
      deliveryInserts[0].sql.includes("'IN_APP'") ? "IN_APP" : deliveryInserts[0].values?.[1],
      deliveryInserts[1].values?.[1],
    ]).toEqual(["IN_APP", "EMAIL"]);
    expect(deliveryInserts[0].sql).toContain("'SENT'");
    expect(deliveryInserts[0].sql).not.toContain("delivered_at");
    expect(deliveryInserts[1].sql).toContain("'QUEUED'");
  });

  it("returns null and does not create records for an inactive or cross-school recipient", async () => {
    const { client, calls } = queueClient({ recipient: false });
    const id = await queueCommunicationNotification(client, notificationInput());

    expect(id).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain("INSERT INTO communication_notifications");
  });

  it("validates student scope and active parent-child relation before queuing a student-subject notice", async () => {
    const { client, calls } = queueClient({ subjectAuthorized: false });

    const id = await queueCommunicationNotification(client, notificationInput({
      subjectStudentId: 321,
      channels: ["EMAIL"],
    }));

    expect(id).toBeNull();
    const relationshipCheck = calls.find(call => call.sql.includes("FROM students subject"));
    expect(relationshipCheck?.sql).toContain("parent_student_relationships");
    expect(relationshipCheck?.sql).toContain("UPPER(psr.status) = 'ACTIVE'");
    expect(relationshipCheck?.values).toEqual([321, 9, 17]);
    expect(calls.some(call => call.sql.includes("INSERT INTO communication_notifications"))).toBe(false);
  });

  it("validates the class and optional student enrollment against the selected school", async () => {
    const { client, calls } = queueClient({ classAuthorized: false });

    const id = await queueCommunicationNotification(client, notificationInput({
      subjectClassId: 654,
      channels: ["EMAIL"],
    }));

    expect(id).toBeNull();
    const classCheck = calls.find(call => call.sql.includes("FROM school_classes sc"));
    expect(classCheck?.sql).toContain("sc.school_id = $2");
    expect(classCheck?.values).toEqual([654, 9, null]);
    expect(calls.some(call => call.sql.includes("INSERT INTO communication_notifications"))).toBe(false);
  });

  it("persists validated student and class subject IDs with the notification", async () => {
    const { client, calls } = queueClient();

    const id = await queueCommunicationNotification(client, notificationInput({
      subjectStudentId: 321,
      subjectClassId: 654,
      channels: ["EMAIL"],
    }));

    expect(id).toBe(51);
    const insert = calls.find(call => call.sql.includes("INSERT INTO communication_notifications"));
    expect(insert?.values?.slice(0, 5)).toEqual([17, 9, 321, 654, "ANNOUNCEMENT"]);
    expect(insert?.sql).toContain("subject_student_id, subject_class_id");
  });

  it("reuses an existing school event notification without duplicating channel rows", async () => {
    const { client, calls } = queueClient({
      insertedId: null,
      duplicateId: 89,
      preferences: [],
    });

    const id = await queueCommunicationNotification(client, notificationInput({ channels: ["IN_APP"] }));

    expect(id).toBe(89);
    expect(calls.some(call => call.sql.includes('subject_student_id AS "subjectStudentId"'))).toBe(true);
  });

  it("does not attach new channel intents to an idempotent event with different student scope", async () => {
    const { client, calls } = queueClient({
      insertedId: null,
      duplicateId: 89,
      duplicateSubjectStudentId: 321,
    });

    const id = await queueCommunicationNotification(client, notificationInput({
      subjectStudentId: 654,
      channels: ["EMAIL"],
    }));

    expect(id).toBeNull();
    expect(calls.some(call => call.sql.includes("INSERT INTO communication_deliveries"))).toBe(false);
  });

  it("does not let preferences suppress mandatory account/security communication", async () => {
    const { client, calls } = queueClient({
      preferences: [
        { channel: "IN_APP", enabled: false },
        { channel: "EMAIL", enabled: false },
      ],
    });

    const id = await queueCommunicationNotification(client, notificationInput({
      category: "SECURITY",
      channels: ["IN_APP", "EMAIL"],
    }));

    expect(id).toBe(51);
    expect(calls.some(call => call.sql.includes("FROM communication_preferences"))).toBe(false);
    expect(calls.filter(call => call.sql.includes("INSERT INTO communication_deliveries"))).toHaveLength(2);
  });

  it("rejects unsafe external links and invalid channel values", async () => {
    const { client } = queueClient();
    await expect(queueCommunicationNotification(
      client,
      notificationInput({ link: "https://example.test/phishing" }),
    )).rejects.toThrow("safe, relative");
    await expect(queueCommunicationNotification(
      client,
      notificationInput({ channels: ["SMS", "WHATSAPP"] as QueueCommunicationNotificationInput["channels"] }),
    )).rejects.toThrow("unsupported communication channel");
  });
});

describe("domain parent event bridge", () => {
  it("emits one linked-parent notification through the caller transaction and suppresses private details", async () => {
    const { client, calls } = queueClient({
      parents: [{ parentUserId: 17, studentName: "Ayo Example", subjectClassId: null }],
    });
    const result = await emitDomainParentEvent(client, {
      schoolId: 9,
      studentId: 321,
      eventType: "PICKUP_REQUEST",
      eventId: "pickup-84",
      category: "SECURITY",
      subject: "Pickup status",
      body: "Internal approval notes and staff-only details.",
      privacy: "GENERIC",
      channels: ["IN_APP"],
    });

    expect(result).toEqual([{ parentUserId: 17, notificationId: 51 }]);
    const relationQuery = calls.find(call => call.sql.includes("SELECT DISTINCT ON (p.user_id)"));
    expect(relationQuery?.sql).toContain("parent_student_relationships");
    expect(relationQuery?.sql).toContain("rel.status='ACTIVE'");
    expect(relationQuery?.sql).toContain("st.school_id=$2");
    expect(relationQuery?.sql).toContain("p.status='ACTIVE'");
    expect(relationQuery?.sql).toContain("p.user_id IS NOT NULL");
    expect(relationQuery?.sql).toContain("u.status='ACTIVE'");
    const notification = calls.find(call => call.sql.includes("INSERT INTO communication_notifications"));
    expect(notification?.values).toContain("PARENT_EVENT:PICKUP_REQUEST:pickup-84:321:17");
    expect(notification?.values).toContain("Ayo Example — Your child's school has an important update");
    expect(notification?.values).toContain(
      "Ayo Example — Please contact the school through the Communication Centre for more information.",
    );
    expect(notification?.values).not.toContain("Internal approval notes and staff-only details.");
  });

  it("reuses a stable school, student, and linked-parent idempotency key for admission conversion", async () => {
    const { client, calls } = queueClient({
      parents: [{ parentUserId: 17, studentName: "Ayo Example", subjectClassId: null }],
      insertedId: null,
      duplicateId: 88,
      duplicateSubjectStudentId: 321,
    });
    const event: DomainParentEventInput = {
      schoolId: 9,
      studentId: 321,
      eventType: "ADMISSION_CONVERTED",
      eventId: 7,
      category: "SYSTEM",
      subject: "Admission completed",
      body: "Your child has been enrolled. Sign in to view their school information.",
      privacy: "PARENT_SAFE",
      link: "/parent/dashboard",
      channels: ["IN_APP"],
    };

    const first = await emitDomainParentEvent(client, event);
    const retry = await emitDomainParentEvent(client, event);

    expect(first).toEqual([{ parentUserId: 17, notificationId: 88 }]);
    expect(retry).toEqual(first);
    const inserts = calls.filter(call => call.sql.includes("INSERT INTO communication_notifications"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].sql).toContain("ON CONFLICT (school_id, event_key, recipient_user_id)");
    expect(inserts.map(call => call.values?.[5])).toEqual([
      "PARENT_EVENT:ADMISSION_CONVERTED:7:321:17",
      "PARENT_EVENT:ADMISSION_CONVERTED:7:321:17",
    ]);
  });

  it("does not resolve or notify an unlinked guardian from admission contact details", async () => {
    const { client, calls } = queueClient({ parents: [] });
    const result = await emitDomainParentEvent(client, {
      schoolId: 9,
      studentId: 321,
      eventType: "ADMISSION_CONVERTED",
      eventId: 7,
      category: "SYSTEM",
      subject: "Admission completed",
      body: "Your child has been enrolled.",
      privacy: "PARENT_SAFE",
    });

    expect(result).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("parent_student_relationships");
    expect(calls[0].sql).toContain("u.status='ACTIVE'");
    expect(calls.some(call => call.sql.includes("INSERT INTO communication_notifications"))).toBe(false);
  });
});

describe("communication template rendering", () => {
  it("substitutes only explicit allowlisted variables without evaluating message content", () => {
    const rendered = renderCommunicationTemplate(
      "Hello {{ student_name }}. {{assignment_title}}",
      { student_name: "Ayo", assignment_title: "{{literal}}" },
      ["student_name", "assignment_title"],
    );

    expect(rendered).toBe("Hello Ayo. {{literal}}");
    expect(() => renderCommunicationTemplate("{{process.env.SECRET}}", {})).toThrow("not allowed");
    expect(() => renderCommunicationTemplate("{{unknown}}", {})).toThrow("not allowed");
  });

  it("rejects missing and malformed placeholders and can HTML-escape inserted values", () => {
    expect(() => renderCommunicationTemplate("Hi {{parent_name}}", {})).toThrow("has no value");
    expect(() => renderCommunicationTemplate("Hi {{student_name", { student_name: "Ayo" })).toThrow("invalid placeholder");
    expect(renderCommunicationTemplate(
      { body: "<p>{{student_name}}</p>", allowedVariables: ["student_name"] },
      { student_name: "<script>alert(1)</script>" },
      { escapeHtml: true },
    )).toEqual({ subject: null, body: "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>" });
  });
});

describe("communication delivery dispatcher", () => {
  it("commits delivery claims before invoking the no-network development provider", async () => {
    const { pool, calls, committed } = dispatchPool();
    const send = vi.fn(async () => {
      expect(committed()).toBe(true);
      return {
        provider: "development-sms",
        channel: "sms" as const,
        status: "SIMULATED" as const,
        accepted: false,
        delivered: false,
      };
    });
    const providers = testProviders(send);
    const summary = await dispatchCommunicationDeliveries(pool, 20, {
      providers,
      now: () => new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(committed()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(pool.connect).mock.invocationCallOrder[0],
    );
    expect(summary).toEqual({
      claimed: 1, accepted: 0, simulated: 1, delivered: 0, failed: 0, skipped: 0,
    });
    const update = calls.find(call => call.sql.includes("UPDATE communication_deliveries") && call.sql.includes("provider_message_id"));
    expect(update?.values?.[1]).toBe("SENT");
    expect(update?.values?.[8]).toBe("SIMULATED");
    expect(update?.values?.[9]).toContain("development-sms");
    expect(update?.values?.[9]).toContain("no external message");
    expect(update?.values?.[3]).toBe(false);
    expect(update?.values?.[6]).toBe(false);
    expect(update?.sql).not.toContain("delivered_at = NOW()");
  });

  it("records provider acknowledgement as sent, never as delivered", async () => {
    const { pool, calls } = dispatchPool();
    const providers = testProviders(async () => ({
      provider: "termii",
      channel: "sms",
      status: "ACCEPTED",
      accepted: true,
      delivered: false,
      providerMessageId: "safe-id-1",
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers });

    expect(summary.accepted).toBe(1);
    const update = calls.find(call => call.sql.includes("provider_message_id"));
    expect(update?.values?.[1]).toBe("SENT");
    expect(update?.values?.[2]).toBe("safe-id-1");
    expect(update?.values?.[3]).toBe(true);
    expect(update?.values?.[6]).toBe(false);
  });

  it("rechecks school authorization before delivery and cancels stale cross-school recipients", async () => {
    const { pool, calls } = dispatchPool({
      record: {
        id: 42, channel: "SMS", notificationId: 33, recipientUserId: 17, schoolId: 9,
        category: "ANNOUNCEMENT", eventKey: null, subject: "Update", body: "Message",
        email: "parent@example.test", phone: "+2348012345678", schoolAuthorized: false,
        userStatus: "ACTIVE",
      },
    });
    const send = vi.fn(async () => ({
      provider: "test-sms", channel: "sms" as const, status: "ACCEPTED" as const,
      accepted: true, delivered: false,
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers: testProviders(send) });

    expect(send).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    const cancel = calls.find(call => call.sql.includes("RECIPIENT_UNAUTHORIZED"));
    expect(cancel).toBeDefined();
  });

  it("rejects platform owners from unscoped delivery during final authorization", async () => {
    const { pool, calls } = dispatchPool({
      record: {
        id: 42, channel: "SMS", notificationId: 33, recipientUserId: 17, schoolId: null,
        subjectStudentId: null, subjectClassId: null, category: "SYSTEM", eventKey: null,
        subject: "System update", body: "Message", email: null, phone: "+2348012345678",
        schoolAuthorized: false, userStatus: "ACTIVE",
      },
    });
    const send = vi.fn(async () => ({
      provider: "test-sms", channel: "sms" as const, status: "ACCEPTED" as const,
      accepted: true, delivered: false,
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers: testProviders(send) });

    expect(send).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    const authorization = calls.find(call => call.sql.includes('AS "schoolAuthorized"'));
    expect(authorization?.sql).toContain("owner_role.role = 'PLATFORM_OWNER'");
    expect(authorization?.sql.indexOf("owner_role.role")).toBeLessThan(
      authorization?.sql.indexOf("n.school_id IS NULL") ?? -1,
    );
    expect(calls.some(call => call.sql.includes("RECIPIENT_UNAUTHORIZED"))).toBe(true);
  });

  it("cancels subject-student deliveries when the recipient's active parent-child link was revoked", async () => {
    const { pool, calls } = dispatchPool({
      record: {
        id: 42, channel: "SMS", notificationId: 33, recipientUserId: 17, schoolId: 9,
        subjectStudentId: 321, subjectClassId: null, category: "ACADEMIC",
        eventKey: null, subject: "Result", body: "A result is available.",
        email: "parent@example.test", phone: "+2348012345678", schoolAuthorized: false,
        userStatus: "ACTIVE",
      },
    });
    const send = vi.fn(async () => ({
      provider: "test-sms", channel: "sms" as const, status: "ACCEPTED" as const,
      accepted: true, delivered: false,
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers: testProviders(send) });

    expect(send).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    const authorization = calls.find(call => call.sql.includes("subject_student_id"));
    expect(authorization?.sql).toContain("parent_student_relationships");
    expect(authorization?.sql).toContain("subject_rel.status");
    expect(calls.some(call => call.sql.includes("RECIPIENT_UNAUTHORIZED"))).toBe(true);
  });

  it("cancels class deliveries when the recipient is no longer enrolled in that class", async () => {
    const { pool, calls } = dispatchPool({
      record: {
        id: 42, channel: "EMAIL", notificationId: 33, recipientUserId: 17, schoolId: 9,
        subjectStudentId: null, subjectClassId: 654, category: "ANNOUNCEMENT",
        eventKey: null, subject: "Class update", body: "Class message.",
        email: "parent@example.test", phone: "+2348012345678", schoolAuthorized: false,
        userStatus: "ACTIVE",
      },
      claimed: [{ id: 42, channel: "EMAIL", attempts: 1 }],
    });
    const send = vi.fn(async () => ({
      provider: "test-email", channel: "email" as const, status: "ACCEPTED" as const,
      accepted: true, delivered: false,
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers: testProviders(async () => ({
      provider: "unused", channel: "sms", status: "SIMULATED", accepted: false, delivered: false,
    }), send) });

    expect(send).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    const authorization = calls.find(call => call.sql.includes("target_class.id = n.subject_class_id"));
    expect(authorization?.sql).toContain("enrolled.class_name = target_class.name");
    expect(authorization?.sql).toContain("parent_student_relationships class_rel");
  });

  it("applies exponential retry backoff without exposing provider error details", async () => {
    const { pool, calls } = dispatchPool();
    const send = vi.fn(async () => ({
      provider: "termii",
      channel: "sms" as const,
      status: "FAILED" as const,
      accepted: false,
      delivered: false,
      failure: { category: "RATE_LIMITED" as const, retryable: true },
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, {
      providers: testProviders(send),
      now: () => new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(summary.failed).toBe(1);
    const update = calls.find(call => call.sql.includes("provider_message_id"));
    expect(update?.values?.[1]).toBe("FAILED");
    expect(update?.values?.[8]).toBe("RATE_LIMITED");
    expect(update?.values?.[9]).toBe("Provider delivery failed (rate limited).");
    expect(update?.values?.[10]).toBeNull();
    expect(update?.values?.[11]).toBe("2026-08-01T10:00:30.000Z");
  });

  it("does not schedule retries for an invalid Termii recipient", async () => {
    const { pool, calls } = dispatchPool({
      record: {
        id: 42, channel: "SMS", notificationId: 33, recipientUserId: 17, schoolId: 9,
        subjectStudentId: null, subjectClassId: null, category: "ANNOUNCEMENT",
        eventKey: "campaign-9-1-user-17", subject: "Update", body: "Message",
        email: null, phone: "not-a-phone", schoolAuthorized: true, userStatus: "ACTIVE",
      },
    });
    const send = vi.fn(async () => ({
      provider: "termii",
      channel: "sms" as const,
      status: "FAILED" as const,
      accepted: false,
      delivered: false,
      failure: { category: "INVALID_REQUEST" as const, retryable: false },
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, {
      providers: testProviders(send),
      now: () => new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(send).toHaveBeenCalledWith({
      to: "not-a-phone",
      body: "Message",
      idempotencyKey: "communication-33-sms",
    });
    expect(summary.failed).toBe(1);
    const update = calls.find(call => call.sql.includes("provider_message_id"));
    expect(update?.values?.[8]).toBe("INVALID_REQUEST");
    expect(update?.values?.[9]).toBe("Provider delivery failed (invalid request).");
    expect(update?.values?.[10]).toBe(5);
    expect(update?.values?.[11]).toBe("2026-08-01T10:00:00.000Z");
  });

  it("does not retry ambiguous network outcomes that may have been accepted", async () => {
    const { pool, calls } = dispatchPool();
    const providers = testProviders(async () => ({
      provider: "http-email",
      channel: "sms",
      status: "FAILED",
      accepted: false,
      delivered: false,
      failure: { category: "TIMEOUT", retryable: true },
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, {
      providers,
      now: () => new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(summary.failed).toBe(1);
    const update = calls.find(call => call.sql.includes("provider_message_id"));
    expect(update?.values?.[8]).toBe("PROVIDER_OUTCOME_UNKNOWN");
    expect(update?.values?.[9]).toContain("manual reconciliation");
    expect(update?.values?.[10]).toBe(5);
    expect(update?.values?.[11]).toBe("2026-08-01T10:00:00.000Z");
  });

  it("terminally fails an interrupted PROCESSING attempt without reclaiming it", async () => {
    const { pool, calls } = dispatchPool({ claimed: [] });
    const send = vi.fn(async () => ({
      provider: "test-sms", channel: "sms" as const, status: "ACCEPTED" as const,
      accepted: true, delivered: false,
    }));

    const summary = await dispatchCommunicationDeliveries(pool, 5, { providers: testProviders(send) });

    expect(summary.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
    const stale = calls.find(call => call.sql.includes("status = 'PROCESSING'"));
    expect(stale?.sql).toContain("error_code = 'PROVIDER_OUTCOME_UNKNOWN'");
    expect(stale?.sql).toContain("manual reconciliation");
    const claim = calls.find(call => call.sql.includes("WITH due AS"));
    expect(claim?.sql).toContain("status IN ('QUEUED','FAILED')");
    expect(claim?.sql).toContain("error_code IS DISTINCT FROM 'PROVIDER_OUTCOME_UNKNOWN'");
    expect(claim?.sql?.split("ORDER BY")[0]).not.toContain("status = 'PROCESSING'");
  });

  it("uses only safe no-network adapters unless configured providers are explicitly enabled", async () => {
    const { pool } = dispatchPool();
    const send = vi.fn(async () => ({
      provider: "never-called",
      channel: "sms" as const,
      status: "ACCEPTED" as const,
      accepted: true,
      delivered: false,
    }));

    await dispatchCommunicationDeliveries(pool, 5, {
      now: () => new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(send).not.toHaveBeenCalled();
  });
});