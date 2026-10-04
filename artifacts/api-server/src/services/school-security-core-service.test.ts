import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("./communication-service", () => ({
  emitDomainParentEvent: vi.fn().mockResolvedValue([]),
}));

import { pool } from "@workspace/db";
import { emitDomainParentEvent } from "./communication-service";
import {
  recordSecurityEventFromAttendance,
  getSchoolSecurityAccess,
  getSecurityDashboard,
  getParentChildSecuritySummary,
  listEligibleSecurityDevices,
  listSecurityEvents,
  markSecurityCardLost,
  requireSecurityAccess,
  securityAccessPermissionSchema,
  securityTestInternals,
} from "./school-security-core-service";
import type { UserContext } from "../middlewares/auth";

const context = (role: UserContext["roles"][number]["role"], schoolId: number | null): UserContext => ({
  user: {
    id: 101,
    clerkUserId: "clerk_test",
    email: "staff@example.test",
    firstName: "Test",
    lastName: "User",
    phone: null,
    status: "ACTIVE",
  },
  roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
});

const request = (ctx: UserContext) => ({ edupulseUser: ctx }) as any;
const dbQuery = vi.mocked(pool.query);

describe("school security authorization contract", () => {
  beforeEach(() => {
    dbQuery.mockReset();
  });

  it("accepts every shared operations expansion permission", () => {
    for (const permission of [
      "SECURITY_READ", "SECURITY_MANAGE", "VISITOR_MANAGE", "PICKUP_APPROVE",
      "INCIDENT_MANAGE", "EMERGENCY_BROADCAST", "COMMUNICATION_SEND",
      "MANAGE_READERS", "MANAGE_CARDS", "REVIEW_PRESENCE",
    ]) {
      expect(securityAccessPermissionSchema.parse(permission)).toBe(permission);
    }
  });

  it("allows read-only Platform Owner oversight only when explicitly requested", async () => {
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: true, school_admin: false, eligible_staff: false, restricted_internal: false }] } as any;
      }
      return { rows: [] } as any;
    });
    const ownerRequest = request(context("PLATFORM_OWNER", null));
    await expect(requireSecurityAccess(ownerRequest, 22, "SECURITY_READ", { ownerReadOnly: true }))
      .resolves.toBe(ownerRequest.edupulseUser);

    await expect(requireSecurityAccess(ownerRequest, 22, "SECURITY_READ"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("denies cross-school delegated grants and permits only the exact school-scoped grant", async () => {
    const staffRequest = request(context("STAFF", 22));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: false, eligible_staff: true, restricted_internal: false }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(requireSecurityAccess(staffRequest, 22, "INCIDENT_MANAGE"))
      .rejects.toMatchObject({ statusCode: 404 });

    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: false, eligible_staff: true, restricted_internal: false }] } as any;
      }
      if (sql.includes("FROM security_staff_grants")) {
        return { rows: [{ permission: "INCIDENT_MANAGE" }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(requireSecurityAccess(staffRequest, 22, "INCIDENT_MANAGE"))
      .resolves.toBe(staffRequest.edupulseUser);
  });

  it("keeps active School Admin permissions tenant-scoped without querying a delegated grant", async () => {
    const adminRequest = request(context("SCHOOL_ADMIN", 22));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: true, eligible_staff: false, restricted_internal: false }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(requireSecurityAccess(adminRequest, 22, "PICKUP_APPROVE"))
      .resolves.toBe(adminRequest.edupulseUser);
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it("keeps read/manage scopes granular and never infers SECURITY_MANAGE from a child grant", async () => {
    const staffRequest = request(context("STAFF", 22));
    dbQuery.mockImplementation(async (_sql: string, values?: unknown[]) => {
      if (_sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (_sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: false, eligible_staff: true, restricted_internal: false }] } as any;
      }
      if (_sql.includes("FROM security_staff_grants")) {
        return { rows: [{ permission: "MANAGE_READERS" }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(requireSecurityAccess(staffRequest, 22, "MANAGE_READERS"))
      .resolves.toBe(staffRequest.edupulseUser);
    await expect(requireSecurityAccess(staffRequest, 22, "SECURITY_MANAGE"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(requireSecurityAccess(staffRequest, 22, "MANAGE_CARDS"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("uses current database memberships and excludes internal roles even when a cached admin role exists", async () => {
    const staleAdmin = request(context("SCHOOL_ADMIN", 22));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: false, eligible_staff: false, restricted_internal: true }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(requireSecurityAccess(staleAdmin, 22, "SECURITY_READ"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(getSchoolSecurityAccess(staleAdmin, 22)).resolves.toMatchObject({
      actorRole: null, canView: false, permissions: [], grantedPermissions: [],
    });
  });

  it("returns live access snapshots without throwing for actors with no effective permission", async () => {
    const staffRequest = request(context("STAFF", 22));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: false, eligible_staff: true, restricted_internal: false }] } as any;
      }
      if (sql.includes("FROM security_staff_grants")) {
        return { rows: [{ permission: "MANAGE_READERS" }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(getSchoolSecurityAccess(staffRequest, 22)).resolves.toMatchObject({
      schoolId: 22, actorRole: "STAFF", canView: false, readOnly: false,
      permissions: ["MANAGE_READERS"], grantedPermissions: ["MANAGE_READERS"],
    });
  });

  it("exposes read-only owner and full active School Admin effective permission snapshots", async () => {
    const ownerRequest = request(context("PLATFORM_OWNER", null));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: true, school_admin: false, eligible_staff: false, restricted_internal: false }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(getSchoolSecurityAccess(ownerRequest, 22)).resolves.toMatchObject({
      actorRole: "PLATFORM_OWNER", canView: true, readOnly: true,
      permissions: ["SECURITY_READ"], grantedPermissions: [],
    });

    const adminRequest = request(context("SCHOOL_ADMIN", 22));
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM schools")) return { rows: [{ id: 22 }] } as any;
      if (sql.includes("FROM app_users u")) {
        return { rows: [{ owner: false, school_admin: true, eligible_staff: false, restricted_internal: false }] } as any;
      }
      return { rows: [] } as any;
    });
    await expect(getSchoolSecurityAccess(adminRequest, 22)).resolves.toMatchObject({
      actorRole: "SCHOOL_ADMIN", canView: true, readOnly: false,
      permissions: expect.arrayContaining([
        "SECURITY_READ", "SECURITY_MANAGE", "VISITOR_MANAGE", "PICKUP_APPROVE",
        "INCIDENT_MANAGE", "EMERGENCY_BROADCAST", "COMMUNICATION_SEND",
      ]),
    });
  });
});

describe("campus presence event ordering", () => {
  const next = securityTestInternals.nextPresence;
  const at = (value: string) => new Date(value);

  it("starts on-campus presence from an ordered entry and exits only from confirmed presence", () => {
    expect(next(null, null, "ENTRY", at("2025-01-01T08:00:00Z")))
      .toEqual({ state: "ON_CAMPUS", reason: null });
    expect(next("ON_CAMPUS", at("2025-01-01T08:00:00Z"), "EXIT", at("2025-01-01T15:00:00Z")))
      .toEqual({ state: "OFF_CAMPUS", reason: null });
  });

  it("marks initial exits, duplicate transitions, and repeated entries for review", () => {
    expect(next(null, null, "EXIT", at("2025-01-01T08:00:00Z")).state).toBe("REQUIRES_REVIEW");
    expect(next("ON_CAMPUS", at("2025-01-01T08:00:00Z"), "ENTRY", at("2025-01-01T09:00:00Z")))
      .toEqual({ state: "REQUIRES_REVIEW", reason: "ENTRY_WHILE_ALREADY_ON_CAMPUS" });
  });

  it("marks equal and out-of-order offline timestamps as review and does not auto-clear prior review", () => {
    const last = at("2025-01-01T10:00:00Z");
    expect(next("ON_CAMPUS", last, "EXIT", at("2025-01-01T09:00:00Z")))
      .toEqual({ state: "REQUIRES_REVIEW", reason: "OUT_OF_ORDER_OR_DUPLICATE_EVENT" });
    expect(next("REQUIRES_REVIEW", last, "ENTRY", at("2025-01-01T11:00:00Z")))
      .toEqual({ state: "REQUIRES_REVIEW", reason: "PRIOR_AMBIGUOUS_SEQUENCE" });
  });
});

describe("attendance-to-security transaction hook", () => {
  const at = new Date("2025-04-07T08:01:02.123Z");
  const attendanceRow = {
    id: 51,
    schoolId: 22,
    studentId: 44,
    employeeId: null,
    deviceId: 91,
    cardId: 61,
    eventType: "SCHOOL_ENTRY",
    result: "ACCEPTED",
    eventDate: "2025-04-07",
    occurredAt: at,
    attendanceStatus: "PRESENT",
    termId: null,
    dedupeKey: "attendance-key",
    uid: "SECRET-NFC-UID",
    cardStudentId: 44,
    cardStatus: "active",
    cardExpiresAt: null,
    deviceName: "South gate tablet",
    readerId: null,
    readerName: null,
    readerStatus: null,
    permissions: null,
    locationId: null,
    locationName: null,
    studentStatus: "ACTIVE",
    studentFirstName: "Mina",
    studentMiddleName: null,
    studentLastName: "Example",
    admissionNumber: "A-44",
    employmentStatus: null,
    employeeType: null,
    employeeFirstName: null,
    employeeMiddleName: null,
    employeeLastName: null,
    employeeNumber: null,
  };

  beforeEach(() => {
    vi.mocked(emitDomainParentEvent).mockClear();
  });

  it("records the original accepted timestamp, updates presence, and emits an idempotent parent event in the caller transaction", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("FROM attendance_events a")) return { rows: [attendanceRow] };
        if (sql.includes("FROM students s")) {
          return { rows: [{ className: "Primary 2", section: "Blue", personName: "Mina Example", admissionNumber: "A-44" }] };
        }
        if (sql.includes("FROM security_school_settings")) {
          return { rows: [{ enabled: true, entryAlerts: true, exitAlerts: true }] };
        }
        if (sql.includes("INSERT INTO security_events")) return { rows: [{ id: 701 }] };
        if (sql.includes("FROM campus_presence")) return { rows: [] };
        return { rows: [] };
      }),
    };

    await expect(recordSecurityEventFromAttendance(client as any, 51)).resolves.toMatchObject({
      securityEventId: 701,
      identityResult: "CONFIRMED",
      reasonCode: null,
    });
    const eventInsert = calls.find((call) => call.sql.includes("INSERT INTO security_events"));
    expect(eventInsert?.values?.some((value) =>
      value instanceof Date && value.getTime() === at.getTime())).toBe(true);
    expect(eventInsert?.values).not.toContain("SECRET-NFC-UID");
    expect(eventInsert?.values?.some((value) =>
      typeof value === "string" && /^[0-9a-f]{64}$/.test(value))).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO campus_presence"))).toBe(true);
    expect(emitDomainParentEvent).toHaveBeenCalledWith(client, expect.objectContaining({
      schoolId: 22,
      studentId: 44,
      eventType: "SECURITY_ENTRY",
      eventId: 701,
      category: "SECURITY",
      channels: ["IN_APP"],
    }));
    expect(calls.some((call) => /^(BEGIN|COMMIT|ROLLBACK)/.test(call.sql))).toBe(false);
  });

  it("records a lost-card rejection without updating presence or notifying parents", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("FROM attendance_events a")) return { rows: [{ ...attendanceRow, cardStatus: "lost" }] };
        if (sql.includes("FROM students s")) {
          return { rows: [{ className: "Primary 2", section: "Blue", personName: "Mina Example", admissionNumber: "A-44" }] };
        }
        if (sql.includes("INSERT INTO security_events")) return { rows: [{ id: 702 }] };
        return { rows: [] };
      }),
    };
    await expect(recordSecurityEventFromAttendance(client as any, 51)).resolves.toMatchObject({
      identityResult: "REJECTED",
      reasonCode: "LOST_CARD",
    });
    expect(calls.some((call) => call.sql.includes("INSERT INTO campus_presence"))).toBe(false);
    expect(emitDomainParentEvent).not.toHaveBeenCalled();
  });
});

describe("school and parent security read contracts", () => {
  beforeEach(() => dbQuery.mockReset());

  it("returns real visitor, incident and pending-pickup dashboard counts", async () => {
    dbQuery.mockImplementation(async (sql: string) => {
      const statement = String(sql ?? "");
      if (statement.includes("FROM campus_presence")) {
        return { rows: [{ studentsOnCampus: 2, staffOnCampus: 1, offCampusPeople: 8, presenceReview: 1 }] } as any;
      }
      if (statement.includes("FROM security_events e")) {
        return { rows: [{ rejectedAttempts: 3, acceptedEntryEvents: 7, acceptedExitEvents: 4 }] } as any;
      }
      if (statement.includes("FROM school_security_visitors")) {
        return { rows: [{ visitorsCurrentlyOnCampus: 2, todayVisitorCheckIns: 6 }] } as any;
      }
      if (statement.includes("FROM school_security_incidents")) return { rows: [{ openIncidents: 5 }] } as any;
      if (statement.includes("FROM school_pickup_requests")) return { rows: [{ pendingPickupRequests: 3 }] } as any;
      return { rows: [] } as any;
    });
    await expect(getSecurityDashboard(22, "2025-04-07T00:00:00.000Z", "2025-04-07T23:59:59.999Z"))
      .resolves.toMatchObject({
        visitorsCurrentlyOnCampus: 2,
        todayVisitorCheckIns: 6,
        openIncidents: 5,
        pendingPickupRequests: 3,
        visitorCountsAvailable: true,
      });
    expect(dbQuery.mock.calls.some(([sql]) => String(sql ?? "").includes("status IN ('OPEN','INVESTIGATING')"))).toBe(true);
    expect(dbQuery.mock.calls.some(([sql]) => String(sql ?? "").includes("status='PENDING'"))).toBe(true);
  });

  it("returns only a live parent’s linked child’s presence/NFC summary, never a UID", async () => {
    const parentRequest = request(context("PARENT", 22));
    const calls: string[] = [];
    dbQuery.mockImplementation(async (sql: string) => {
      calls.push(sql);
      return {
        rows: [{
          studentId: 44, schoolId: 22, nfcStatus: "ACTIVE", presenceState: "ON_CAMPUS",
          lastOccurredAt: new Date("2025-04-07T08:01:00.000Z"),
          recentEvents: [{ eventType: "ENTRY", occurredAt: "2025-04-07T08:01:00.000Z" }],
        }],
      } as any;
    });
    await expect(getParentChildSecuritySummary(parentRequest, 44)).resolves.toMatchObject({
      studentId: 44, schoolId: 22, nfcStatus: "ACTIVE",
      currentPresence: { state: "ON_CAMPUS" },
      recentEvents: [{ eventType: "ENTRY" }],
    });
    expect(calls[0]).toContain("relationship.parent_id=parent.id AND UPPER(relationship.status)='ACTIVE'");
    expect(calls[0]).toContain("actor.clerk_user_id=$1 AND UPPER(actor.status)='ACTIVE'");
    expect(calls[0]).toContain("e.school_id=st.school_id AND e.student_id=st.id");
    expect(calls[0]).not.toMatch(/\\.uid\\b|card\\.uid/i);

    dbQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(getParentChildSecuritySummary(parentRequest, 45)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists only currently credentialed configured devices bound to the requested school", async () => {
    dbQuery.mockResolvedValue({ rows: [{
      id: 91, name: "South gate tablet", serialNumber: "DEV-91", deviceType: "NFC",
      readerId: 7, readerName: "South gate", locationId: 4,
    }] } as any);
    await expect(listEligibleSecurityDevices(22)).resolves.toMatchObject([
      { id: 91, name: "South gate tablet", readerId: 7, locationId: 4 },
    ]);
  });

  it("keeps pickup EXIT history filtered to both the requested school and student", async () => {
    dbQuery.mockResolvedValue({ rows: [] } as any);
    await expect(listSecurityEvents(22, {
      limit: 50,
      studentId: 44,
      eventType: "EXIT",
      result: "CONFIRMED",
    })).resolves.toEqual([]);
    const [sql, values] = dbQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("WHERE e.school_id=$1");
    expect(sql).toContain("e.student_id=$7");
    expect(values).toEqual([22, null, null, null, "EXIT", "CONFIRMED", 44, 50]);
    expect(sql).not.toMatch(/school_id\\s*=\\s*\\$7/i);
  });
});

describe("student card-loss parent event", () => {
  it("emits one idempotent parent-safe event inside the loss transaction and none on retry", async () => {
    vi.mocked(emitDomainParentEvent).mockClear();
    const cardRequest = request(context("SCHOOL_ADMIN", 22));
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    let cardStatus = "active";
    const transaction = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("FROM nfc_cards")) return { rows: [{ id: 61, uid: "PRIVATE-UID", status: cardStatus, studentId: 44 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(transaction as any);
    await expect(markSecurityCardLost(cardRequest, 22, 61, "Reported missing"))
      .resolves.toMatchObject({ cardId: 61, schoolId: 22, status: "LOST" });
    expect(emitDomainParentEvent).toHaveBeenCalledTimes(1);
    expect(emitDomainParentEvent).toHaveBeenCalledWith(transaction, expect.objectContaining({
      eventType: "SECURITY_CARD_LOST",
      eventId: "cardlost:22:61",
      studentId: 44,
      category: "SECURITY",
      channels: ["IN_APP"],
    }));
    const audit = calls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(audit?.values).not.toContain("PRIVATE-UID");
    const ownerNotice = calls.find(({ sql }) => sql.includes("INSERT INTO platform_notifications"));
    expect(ownerNotice?.sql).toContain("sm.role='PLATFORM_OWNER'");
    expect(ownerNotice?.values?.join(" ")).not.toContain("PRIVATE-UID");

    cardStatus = "lost";
    await expect(markSecurityCardLost(cardRequest, 22, 61, "Reported missing"))
      .resolves.toMatchObject({ status: "LOST" });
    expect(emitDomainParentEvent).toHaveBeenCalledTimes(1);
    expect(calls.filter(({ sql }) => sql.includes("INSERT INTO platform_notifications"))).toHaveLength(1);
  });
});