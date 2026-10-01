import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  eligibility: { eligible: true, status: "PAID", subscriptionId: 701 } as {
    eligible: boolean;
    status: string;
    subscriptionId: number | null;
  },
  getEligibility: vi.fn(),
}));

const state = vi.hoisted(() => ({
  role: "SCHOOL_ADMIN",
  employeeType: "STAFF",
  noEmployeeCard: false,
  isStudentCard: false,
  duplicateEvent: null as Record<string, unknown> | null,
  nextEventId: 101,
  insertedEvents: 0,
  authHandlerCalls: 0,
}));

const mockPool = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const secretHash = "df27cbbd7c5753f117a59da867f5f48c3290561b5302fe08234ab3cf4fec1fed";
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (sql.includes("FROM device_credentials c")) {
      return result([{
        credentialId: 11,
        deviceId: 21,
        schoolId: 1,
        secretHash,
        deviceStatus: "ACTIVE",
      }]);
    }
    if (sql.includes("FROM platform_devices") && sql.includes("configuration_status")) {
      return result([{ id: 21 }]);
    }
    if (sql.startsWith("UPDATE device_credentials") || sql.startsWith("UPDATE platform_devices")) {
      return result();
    }
    return result();
  });

  const clientQuery = vi.fn(async (sql: string, values: any[] = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
    if (sql.includes("INSERT INTO attendance_events")) {
      state.insertedEvents += 1;
      return result([{
        id: state.nextEventId++,
        schoolId: 1,
        employeeId: 31,
        eventType: "SCHOOL_ENTRY",
        identificationMethod: "NFC",
        status: "PRESENT",
        result: "ACCEPTED",
        deviceId: 21,
        nfcCardId: 41,
        occurredAt: values[5],
      }]);
    }
    if (sql.includes("FROM platform_devices d") && sql.includes("FOR UPDATE OF d")) {
      return result([{ deviceId: 21, schoolId: 1 }]);
    }
    if (sql.includes("FROM employees") && sql.includes("FOR SHARE")) {
      return result(state.employeeType === "STUDENT"
        ? []
        : [{ id: 31, schoolId: 1, employeeType: state.employeeType }]);
    }
    if (sql.includes("FROM nfc_cards c") && sql.includes("FOR SHARE OF c,b,e")) {
      return state.noEmployeeCard
        ? result()
        : result([{ id: 31, employeeType: state.employeeType, cardId: 41, bindingId: 51 }]);
    }
    if (sql.includes("FROM nfc_cards") && sql.includes("student_id IS NOT NULL")) {
      return state.isStudentCard ? result([{ id: 77 }]) : result();
    }
    if (sql.includes("FROM attendance_settings")) {
      return result([{ suppressionSeconds: 30, entryWindowEnd: null, exitWindowStart: null }]);
    }
    if (sql.includes("FROM attendance_events") && sql.includes("ORDER BY occurred_at DESC,id DESC")) {
      return result(state.duplicateEvent ? [state.duplicateEvent] : []);
    }
    if (sql.includes("FROM academic_terms t")) {
      return result([{
        termId: 7,
        termName: "Term 2",
        sessionId: 4,
        sessionName: "2026/2027",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }]);
    }
    if (sql.includes("SELECT EXISTS(") && sql.includes("hasEarlierUnmatchedEntry")) {
      return result([{ hasUnmatchedEntry: true, hasEarlierUnmatchedEntry: false }]);
    }
    return result();
  });
  const client = {
    query: clientQuery,
    release: vi.fn(),
  };
  return {
    query,
    connect: vi.fn(async () => client),
    client,
    secretHash,
  };
});

vi.mock("@workspace/db", () => ({ pool: mockPool }));
vi.mock("./staff-nfc-billing-service", () => ({
  getStaffNfcEligibility: billing.getEligibility,
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      state.authHandlerCalls += 1;
      const roleName = req.header("x-test-role") ?? "SCHOOL_ADMIN:1";
      const roles = roleName.split(",").map((spec) => {
        const [role, school = "1"] = spec.split(":");
        return {
          id: 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : Number(school),
          status: "ACTIVE",
        };
      });
      const primaryRole = roles[0]?.role ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: {
          id: primaryRole === "TEACHER" ? 31 : 10,
          clerkUserId: `test-${primaryRole}`,
          email: `${primaryRole.toLowerCase()}@example.test`,
          firstName: primaryRole,
          lastName: "Tester",
          phone: null,
          status: "ACTIVE",
        },
        roles,
      };
      next();
    },
  };
});

import employeeNfcRouter from "./employee-nfc";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(employeeNfcRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message });
  return res.status(500).json({ error: String(error) });
});

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

afterAll(async () => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

beforeEach(() => {
  state.role = "SCHOOL_ADMIN";
  state.employeeType = "STAFF";
  state.noEmployeeCard = false;
  state.isStudentCard = false;
  state.duplicateEvent = null;
  state.nextEventId = 101;
  state.insertedEvents = 0;
  state.authHandlerCalls = 0;
  mockPool.query.mockClear();
  mockPool.client.query.mockClear();
  mockPool.connect.mockClear();
  billing.getEligibility.mockReset().mockResolvedValue({ ...billing.eligibility });
});

async function request(
  path: string,
  options: {
    method?: string;
    role?: string;
    deviceCredential?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.role ? { "x-test-role": options.role } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.deviceCredential ? { "X-Device-Credential": options.deviceCredential } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

const validDeviceCredential = "test-device.employee-device-secret";
const validNfcEvent = () => ({
  employeeId: 31,
  personType: "STAFF",
  nfcUid: "ABCDEF012345",
  eventType: "SCHOOL_ENTRY",
  occurredAt: new Date().toISOString(),
});

describe("employee NFC school and device routes", () => {
  it("keeps school card lists private to School Admins and platform owners", async () => {
    const teacher = await request("/schools/1/employee-nfc/cards", { role: "TEACHER:1" });
    expect(teacher.status).toBe(404);
    expect(mockPool.query).not.toHaveBeenCalled();

    const anotherSchool = await request("/schools/1/employee-nfc/cards", { role: "SCHOOL_ADMIN:2" });
    expect(anotherSchool.status).toBe(404);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("keeps a global Owner out of the employee self-service E-ID route", async () => {
    const response = await request("/me/employee-nfc", { role: "PLATFORM_OWNER" });
    expect(response.status).toBe(403);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("rejects ordinary user Bearer authentication for a device credential endpoint", async () => {
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      body: validNfcEvent(),
    });
    expect(response.status).toBe(401);
    expect(state.authHandlerCalls).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it("does not intercept authentication for unrelated public hooks or API routes", async () => {
    const response = await request("/payments/provider-webhook", { method: "POST" });
    expect(response.status).toBe(404);
    expect(state.authHandlerCalls).toBe(0);
  });

  it("rejects a student device identity before it can reach employee attendance", async () => {
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: { ...validNfcEvent(), personType: "STUDENT" },
    });
    expect(response.status).toBe(400);
    expect(state.insertedEvents).toBe(0);
    expect(billing.getEligibility).not.toHaveBeenCalled();
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it("rejects a mismatched teacher/staff claim before subscription checks or insertion", async () => {
    state.employeeType = "TEACHER";
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: validNfcEvent(),
    });
    expect(response.status).toBe(403);
    expect(billing.getEligibility).not.toHaveBeenCalled();
    expect(state.insertedEvents).toBe(0);
  });

  it("denies device attendance when the server billing service reports a pending term", async () => {
    billing.getEligibility.mockResolvedValue({ eligible: false, status: "PENDING", subscriptionId: 701 });
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: validNfcEvent(),
    });
    expect(response.status).toBe(403);
    expect(billing.getEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockPool.client.query }),
      31,
      1,
      7,
    );
    expect(state.insertedEvents).toBe(0);
    expect(mockPool.client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO attendance_events"))).toBe(false);
  });

  it("returns an explicit unavailable response rather than admitting NFC when billing cannot be checked", async () => {
    billing.getEligibility.mockRejectedValue(new Error("billing relation unavailable"));
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: validNfcEvent(),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Employee NFC subscription verification is not configured",
    });
    expect(state.insertedEvents).toBe(0);
  });

  it("records an active employee card only after the authoritative current-term entitlement succeeds", async () => {
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: validNfcEvent(),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      employeeId: 31,
      personType: "STAFF",
      eventType: "SCHOOL_ENTRY",
      identificationMethod: "NFC",
      status: "PRESENT",
      discrepancy: false,
    });
    expect(state.insertedEvents).toBe(1);
    const insert = mockPool.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO attendance_events"));
    expect(insert?.[0]).toContain("school_id,student_id,employee_id");
    expect(insert?.[0]).toContain("SELECT $1,NULL,$2");
  });

  it("returns an identical retried device event without inserting a duplicate or rechecking a past payment", async () => {
    const payload = validNfcEvent();
    state.duplicateEvent = {
      id: 99,
      schoolId: 1,
      employeeId: 31,
      eventType: "SCHOOL_ENTRY",
      identificationMethod: "NFC",
      status: "PRESENT",
      result: "ACCEPTED",
      deviceId: 21,
      nfcCardId: 41,
      occurredAt: payload.occurredAt,
    };
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 99, employeeId: 31, personType: "STAFF" });
    expect(state.insertedEvents).toBe(0);
    expect(billing.getEligibility).not.toHaveBeenCalled();
  });

  it("does not promote a student-bound physical card into an employee card", async () => {
    state.noEmployeeCard = true;
    state.isStudentCard = true;
    const response = await request("/devices/employee-nfc/attendance/events", {
      method: "POST",
      deviceCredential: validDeviceCredential,
      body: validNfcEvent(),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("student NFC card") });
    expect(billing.getEligibility).not.toHaveBeenCalled();
    expect(state.insertedEvents).toBe(0);
  });
});