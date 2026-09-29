import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationQueryClient, QueueCommunicationNotificationInput } from "../services/communication-service";

const state = vi.hoisted(() => ({
  sourceRecipients: [] as Array<{
    schoolId: number;
    studentId: number;
    recipientUserId: number;
    recipientRole: "PARENT" | "STUDENT";
  }>,
  queued: [] as QueueCommunicationNotificationInput[],
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  failRecipientLookup: false,
  failQueue: false,
}));

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {},
  assertSchoolAccess: vi.fn(),
  assertSchoolOperationalAccess: vi.fn(),
  getUserContext: vi.fn(),
  isPlatformOwner: vi.fn(() => false),
  requireAuthentication: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/communication-service", () => ({
  queueCommunicationNotification: vi.fn(async (_client: unknown, input: QueueCommunicationNotificationInput) => {
    if (state.failQueue) throw new Error("queue unavailable");
    state.queued.push(input);
    return state.queued.length;
  }),
}));

import {
  queueAttendanceCommunicationBestEffort,
  queueSchoolEntryExitCommunication,
  queueStudentAttendanceCommunication,
} from "./attendance";

function transactionClient(): CommunicationQueryClient {
  return {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/.test(sql)) return { rows: [] as any[] };
      if (state.failRecipientLookup && sql.includes("parent_student_relationships")) {
        throw new Error("recipient lookup unavailable");
      }
      const [schoolId, studentId] = values.map(Number);
      return { rows: state.sourceRecipients
          .filter(recipient => recipient.schoolId === schoolId && recipient.studentId === studentId)
          .map(({ recipientUserId, recipientRole }) => ({ recipientUserId, recipientRole })),
      };
    }) as CommunicationQueryClient["query"],
  };
}

describe("attendance communication queueing", () => {
  beforeEach(() => {
    state.sourceRecipients = [
      { schoolId: 1, studentId: 11, recipientUserId: 101, recipientRole: "PARENT" },
      { schoolId: 1, studentId: 11, recipientUserId: 102, recipientRole: "PARENT" },
      { schoolId: 1, studentId: 11, recipientUserId: 111, recipientRole: "STUDENT" },
      { schoolId: 1, studentId: 12, recipientUserId: 112, recipientRole: "STUDENT" },
      { schoolId: 2, studentId: 11, recipientUserId: 201, recipientRole: "PARENT" },
    ];
    state.queued = [];
    state.queries = [];
    state.failRecipientLookup = false;
    state.failQueue = false;
  });

  it("derives only active linked recipients from the same school and child", async () => {
    const client = transactionClient();
    await queueStudentAttendanceCommunication(client, {
      schoolId: 1,
      studentId: 11,
      subjectClassId: 31,
      eventKey: "attendance:1:301:SCHOOL_ENTRY",
      subject: "School entry recorded",
      body: "A student entry into school has been recorded.",
    });

    expect(state.queued.map(item => item.recipientUserId).sort((a, b) => a - b)).toEqual([101, 102, 111]);
    expect(state.queued.find(item => item.recipientUserId === 101)?.channels).toEqual(["IN_APP", "SMS"]);
    expect(state.queued.find(item => item.recipientUserId === 111)?.channels).toEqual(["IN_APP"]);
    expect(state.queued.every(item => item.subjectStudentId === 11)).toBe(true);
    expect(state.queued.every(item => item.subjectClassId === 31)).toBe(true);
    const recipientQuery = state.queries[0];
    expect(recipientQuery.values).toEqual([1, 11]);
    expect(recipientQuery.sql).toContain("JOIN parent_student_relationships psr");
    expect(recipientQuery.sql).toContain("p.school_id=st.school_id");
    expect(recipientQuery.sql).toContain("st.school_id=$1 AND st.id=$2");
    expect(recipientQuery.sql).toContain("UPPER(psr.status)='ACTIVE'");
    expect(recipientQuery.sql).toContain("UPPER(p.status)='ACTIVE'");
    expect(state.queued.some(item => item.recipientUserId === 201 || item.recipientUserId === 112)).toBe(false);
  });

  it("reuses a deterministic key for retries of the same persisted attendance event", async () => {
    const client = transactionClient();
    const event = {
      id: 301,
      schoolId: 1,
      studentId: 11,
      schoolClassId: 21,
      eventType: "SCHOOL_ENTRY",
      status: "PRESENT",
    };
    await queueSchoolEntryExitCommunication(client, event);
    const firstAttemptKeys = state.queued.map(item => item.eventKey);
    expect(state.queued.every(item => item.subjectStudentId === 11)).toBe(true);
    expect(state.queued.every(item => item.subjectClassId === 21)).toBe(true);

    await queueSchoolEntryExitCommunication(client, event);
    expect(state.queued.map(item => item.eventKey)).toEqual([...firstAttemptKeys, ...firstAttemptKeys]);
    expect(new Set(state.queued.map(item => item.eventKey))).toEqual(
      new Set(["attendance:1:301:SCHOOL_ENTRY"]),
    );
  });

  it("does not announce an entry or exit for an absent or otherwise non-arrival status", async () => {
    const client = transactionClient();
    await queueSchoolEntryExitCommunication(client, {
      id: 302,
      schoolId: 1,
      studentId: 11,
      eventType: "SCHOOL_ENTRY",
      status: "ABSENT",
    });
    await queueSchoolEntryExitCommunication(client, {
      id: 303,
      schoolId: 1,
      studentId: 11,
      eventType: "SCHOOL_EXIT",
      status: "UNKNOWN",
    });

    expect(state.queries).toHaveLength(0);
    expect(state.queued).toHaveLength(0);
  });

  it("rolls back only the notification savepoint and logs a recipient lookup failure", async () => {
    const client = transactionClient();
    state.failRecipientLookup = true;
    const warn = vi.fn();
    await queueAttendanceCommunicationBestEffort(
      client,
      { log: { warn } } as any,
      () => queueStudentAttendanceCommunication(client, {
        schoolId: 1,
        studentId: 11,
        eventKey: "attendance:1:304:SCHOOL_ENTRY",
        subject: "School entry recorded",
        body: "A student entry into school has been recorded.",
      }),
      { schoolId: 1, eventType: "SCHOOL_ENTRY" },
    );

    expect(state.queries.map(query => query.sql)).toEqual([
      "SAVEPOINT attendance_communication_queue",
      expect.stringContaining("JOIN parent_student_relationships psr"),
      "ROLLBACK TO SAVEPOINT attendance_communication_queue",
      "RELEASE SAVEPOINT attendance_communication_queue",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1, eventType: "SCHOOL_ENTRY", error: "recipient lookup unavailable" }),
      "Could not queue attendance communication",
    );
    expect(state.queued).toHaveLength(0);
  });

  it("contains queue write failures and leaves the parent attendance transaction usable", async () => {
    const client = transactionClient();
    state.failQueue = true;
    const warn = vi.fn();
    await queueAttendanceCommunicationBestEffort(
      client,
      { log: { warn } } as any,
      () => queueStudentAttendanceCommunication(client, {
        schoolId: 1,
        studentId: 11,
        eventKey: "attendance:1:305:SCHOOL_ENTRY",
        subject: "School entry recorded",
        body: "A student entry into school has been recorded.",
      }),
      { schoolId: 1, eventType: "SCHOOL_ENTRY" },
    );

    expect(state.queries.map(query => query.sql)).toContain(
      "ROLLBACK TO SAVEPOINT attendance_communication_queue",
    );
    expect(state.queries.map(query => query.sql)).toContain(
      "RELEASE SAVEPOINT attendance_communication_queue",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1, eventType: "SCHOOL_ENTRY", error: "queue unavailable" }),
      "Could not queue attendance communication",
    );
  });
});