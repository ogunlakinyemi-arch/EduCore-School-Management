import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "DEVICE_ACTIVATION_OFFICER",
  allowedSchoolId: 4,
  employeeActive: true,
  clerkEmail: "officer@example.test",
  clerkEmailVerified: true,
  deviceAvailable: true,
  studentAvailable: true,
  activeCardExists: false,
  existingCard: null as null | { id: number; schoolId: number; studentId: number | null; status: string },
  schoolVerified: true,
  activationUserActive: true,
  conflictingRoles: false,
  emailUsers: [{ id: 22, email: "staff@example.test", status: "ACTIVE" }] as Array<{ id: number; email: string; status: string }>,
  grants: [{ id: 51, userId: 22, schoolId: 4, role: "DEVICE_ACTIVATION_OFFICER", status: "ACTIVE", email: "staff@example.test", fullName: "Activation Staff" }],
  historyRows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}));

const poolMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("FROM app_users au") && sql.includes("platform_company_employees")) {
      return { rows: state.employeeActive ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("SELECT id FROM schools WHERE id = $1")) {
      return { rows: Number(values[0]) === 4 ? [{ id: 4 }] : [] };
    }
    if (sql.includes('SELECT sm.id, sm.user_id AS "userId"') && sql.includes("DEVICE_ACTIVATION_OFFICER")) {
      return { rows: state.grants.filter((grant) => Number(values[0]) === grant.schoolId &&
        (values.length < 2 || grant.email.toLowerCase() === String(values[1]).toLowerCase())) };
    }
    if (sql.includes("FROM school_memberships sm") && sql.includes("platform_company_employees")) {
      return { rows: state.employeeActive && Number(values[1]) === state.allowedSchoolId ? [{ "?column?": 1 }] : [] };
    }
      if (sql.includes("FROM schools s") && sql.includes("LEFT JOIN LATERAL")) {
        return {
          rows: [{
            schoolId: 4, schoolName: "Test School", schoolCode: "T-1", schoolLogo: null, schoolAddress: null,
            studentId: 19, admissionNo: "ADM-19", firstName: "First", middleName: null,
            lastName: "Student", className: "Class 1", section: "A", photo: "/photo.jpg",
            cardId: 77, cardNumber: "CARD-77", activatedAt: new Date("2025-01-01T00:00:00.000Z"),
          }],
        };
      }
    if (sql.includes("FROM school_memberships sm") && sql.includes("JOIN schools s")) {
      return { rows: state.employeeActive ? [{ id: state.allowedSchoolId, name: "Test School", code: "T-1", city: "City", state: "State", logo: null }] : [] };
    }
    if (sql.includes("FROM nfc_card_history h")) {
      return { rows: state.historyRows };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("SELECT id FROM schools WHERE id = $1 FOR SHARE")) {
        return { rows: state.schoolVerified && Number(values[0]) === 4 ? [{ id: 4 }] : [] };
      }
      if (sql.includes("SELECT id, email, status FROM app_users WHERE lower(email)")) {
        return { rows: state.emailUsers };
      }
      if (sql.includes("SELECT id FROM platform_company_employees") && sql.includes("lower(email)")) {
        return { rows: state.employeeActive ? [{ id: 1 }] : [] };
      }
      if (sql.includes("SELECT au.id, au.email") && sql.includes("platform_company_employees")) {
        return { rows: state.activationUserActive && state.employeeActive && Number(values[0]) === 22
          ? [{ id: 22, email: "staff@example.test" }]
          : [] };
      }
      if (sql.includes("SELECT role FROM school_memberships")) {
        return { rows: state.conflictingRoles ? [{ role: "STAFF" }] : [] };
      }
      if (sql.includes("INSERT INTO school_memberships")) {
        return { rows: [{ id: 51, userId: 22, schoolId: 4, role: "DEVICE_ACTIVATION_OFFICER", status: "ACTIVE" }] };
      }
      if (sql.includes("UPDATE school_memberships SET status = 'INACTIVE'")) {
        return { rows: [{ id: 51, userId: 22, schoolId: 4, role: "DEVICE_ACTIVATION_OFFICER", status: "INACTIVE" }] };
      }
      if (sql.includes("FROM school_memberships sm") && sql.includes("platform_company_employees")) {
        return { rows: state.employeeActive && Number(values[1]) === state.allowedSchoolId ? [{ "?column?": 1 }] : [] };
      }
      if (sql.includes("LEFT JOIN LATERAL")) {
        return {
          rows: [{
            schoolId: 4, schoolName: "Test School", schoolCode: "T-1", schoolLogo: null, schoolAddress: null,
            studentId: 19, admissionNo: "ADM-19", firstName: "First", middleName: null,
            lastName: "Student", className: "Class 1", section: "A", photo: "/photo.jpg",
            cardId: 77, cardNumber: "CARD-77", activatedAt: new Date("2025-01-01T00:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM platform_devices d") && sql.includes("device_school_bindings")) {
        return {
          rows: state.deviceAvailable && Number(values[0]) === 8 && Number(values[1]) === state.allowedSchoolId
            ? [{ id: 8, serialNumber: "HW-8", name: "NFC Reader", deviceType: "NFC", status: "ACTIVE", location: "Front gate" }]
            : [],
        };
      }
      if (sql.includes("FROM students WHERE id = $1 AND school_id = $2")) {
        return { rows: state.studentAvailable && Number(values[0]) === 19 && Number(values[1]) === state.allowedSchoolId
          ? [{ id: 19, admissionNo: "ADM-19", firstName: "First", middleName: null, lastName: "Student", className: "Class 1", section: "A", photo: null }]
          : [] };
      }
      if (sql.includes("FROM nfc_cards") && sql.includes("lower(status) = 'active'")) {
        return { rows: state.activeCardExists ? [{ id: 99 }] : [] };
      }
      if (sql.includes("FROM nfc_cards WHERE lower(uid)")) {
        return { rows: state.existingCard ? [state.existingCard] : [] };
      }
      if (sql.includes("INSERT INTO nfc_cards")) {
        return {
          rows: [{
            id: 77, schoolId: state.allowedSchoolId, uid: String(values[1]),
            studentId: 19, status: "active", scans: 0, lastScan: null, activatedAt: new Date("2025-01-01T00:00:00.000Z"),
          }],
        };
      }
      if (sql.includes("UPDATE nfc_cards") && sql.includes("RETURNING")) {
        return {
          rows: [{
            id: 77, schoolId: state.allowedSchoolId, uid: "CARD-77",
            studentId: 19, status: "active", scans: 0, lastScan: null, activatedAt: new Date("2025-01-01T00:00:00.000Z"),
          }],
        };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  }));
  return { query, connect };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      getUser: vi.fn(async () => ({
        primaryEmailAddress: {
          emailAddress: state.clerkEmail,
          verification: { status: state.clerkEmailVerified ? "verified" : "unverified" },
        },
      })),
    },
  },
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = state.role as any;
      (req as any).edupulseUser = {
        user: {
          id: 12,
          clerkUserId: "clerk-user-12",
          email: "officer@example.test",
          firstName: "Activation",
          lastName: "Officer",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" ? null : 4, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import deviceActivationRouter from "./device-activation";

const app = express();
app.use(express.json());
app.use(deviceActivationRouter);

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
  state.historyRows = [];
  state.role = "DEVICE_ACTIVATION_OFFICER";
  state.allowedSchoolId = 4;
  state.employeeActive = true;
  state.clerkEmail = "officer@example.test";
  state.clerkEmailVerified = true;
  state.deviceAvailable = true;
  state.studentAvailable = true;
  state.activeCardExists = false;
  state.existingCard = null;
  state.schoolVerified = true;
  state.activationUserActive = true;
  state.conflictingRoles = false;
  state.emailUsers = [{ id: 22, email: "staff@example.test", status: "ACTIVE" }];
  state.grants = [{ id: 51, userId: 22, schoolId: 4, role: "DEVICE_ACTIVATION_OFFICER", status: "ACTIVE", email: "staff@example.test", fullName: "Activation Staff" }];
  state.queries.length = 0;
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

function assign(schoolId = 4, deviceId = 8, studentId = 19, cardNumber = "CARD-77") {
  return fetch(`${baseUrl}/activation/schools/${schoolId}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, studentId, cardNumber }),
  });
}

describe("restricted Device Activation Officer API", () => {
  it("allows only a Platform Owner to grant a school-scoped role to a matching active employee app user", async () => {
    state.role = "PLATFORM_OWNER";
    const response = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 22 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      userId: 22, schoolId: 4, role: "DEVICE_ACTIVATION_OFFICER", status: "ACTIVE",
    });
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO school_memberships") && sql.includes("'DEVICE_ACTIVATION_OFFICER'"),
    )).toBe(true);
  });

  it("rejects officer grants without an active matching employee and blocks non-owner grants", async () => {
    const forbidden = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 22 }),
    });
    expect(forbidden.status).toBe(403);
    const forbiddenByEmail = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "staff@example.test" }),
    });
    expect(forbiddenByEmail.status).toBe(403);
    state.role = "PLATFORM_OWNER";
    state.employeeActive = false;
    const employeeMissing = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 22 }),
    });
    expect(employeeMissing.status).toBe(409);
  });

  it("lets only an owner list school grants by employee email and revoke through the existing endpoint", async () => {
    const denied = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers?email=staff%40example.test`);
    expect(denied.status).toBe(403);

    state.role = "PLATFORM_OWNER";
    const response = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers?email=staff%40example.test`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ userId: 22, email: "staff@example.test", status: "ACTIVE" }]);

    const revoked = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers/22`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
    expect(state.queries.some(({ values }) => values.includes("DEVICE_ACTIVATION_ACCESS_REVOKED"))).toBe(true);
  });

  it("grants by normalized employee email only when one active app account exists with no other active roles", async () => {
    state.role = "PLATFORM_OWNER";
    const response = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Staff@Example.Test" }),
    });
    expect(response.status).toBe(201);
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("SELECT id, email, status FROM app_users") && values[0] === "staff@example.test",
    )).toBe(true);
    expect(state.queries.some(({ values }) => values.includes("DEVICE_ACTIVATION_ACCESS_GRANTED"))).toBe(true);

    state.emailUsers = [
      { id: 22, email: "staff@example.test", status: "ACTIVE" },
      { id: 23, email: "staff@example.test", status: "ACTIVE" },
    ];
    const duplicate = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "staff@example.test" }),
    });
    expect(duplicate.status).toBe(409);

    state.emailUsers = [{ id: 22, email: "staff@example.test", status: "INACTIVE" }];
    const accountMissing = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "staff@example.test" }),
    });
    expect(accountMissing.status).toBe(409);
    const accountMissingBody = await accountMissing.json() as { error: string };
    expect(accountMissingBody.error).toContain("sign in once");

    state.emailUsers = [{ id: 22, email: "staff@example.test", status: "ACTIVE" }];
    state.conflictingRoles = true;
    const roleConflict = await fetch(`${baseUrl}/platform/schools/4/device-activation-officers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "staff@example.test" }),
    });
    expect(roleConflict.status).toBe(409);
  });

  it("returns fresh E-ID data joined to the current active card", async () => {
    const response = await fetch(`${baseUrl}/activation/schools/4/students/19/e-id`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schoolLogo: null, studentId: 19, photo: "/photo.jpg", cardNumber: "CARD-77",
    });
    expect(state.queries.some(({ sql }) =>
      sql.includes("LEFT JOIN LATERAL") && sql.includes("lower(nc.status) = 'active'"),
    )).toBe(true);
  });

  it("requires the dedicated officer membership", async () => {
    state.role = "STAFF";
    const response = await fetch(`${baseUrl}/activation/schools/4/devices`);
    expect(response.status).toBe(403);
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it("requires an active matching platform company employee", async () => {
    state.employeeActive = false;
    const response = await fetch(`${baseUrl}/activation/schools/4/devices`);
    expect(response.status).toBe(403);
  });

  it("rejects a stale or unverified Clerk primary email for officer access", async () => {
    state.clerkEmail = "former@example.test";
    const staleEmail = await fetch(`${baseUrl}/activation/schools/4/devices`);
    expect(staleEmail.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("FROM platform_devices d"))).toBe(false);

    state.clerkEmail = "officer@example.test";
    state.clerkEmailVerified = false;
    const unverified = await fetch(`${baseUrl}/activation/schools`);
    expect(unverified.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("JOIN schools s"))).toBe(false);
  });

  it("does not query Clerk when the caller is not an activation officer", async () => {
    state.role = "STAFF";
    const { clerkClient } = await import("@clerk/express");
    const getUser = vi.mocked(clerkClient.users.getUser);
    getUser.mockClear();
    const response = await fetch(`${baseUrl}/activation/schools/4/devices`);
    expect(response.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("requires at least four characters for a card UID", async () => {
    const response = await assign(4, 8, 19, "123");
    expect(response.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("FROM platform_devices d"))).toBe(false);
  });

  it("does not list schools without an active matching employee record", async () => {
    state.employeeActive = false;
    const response = await fetch(`${baseUrl}/activation/schools`);
    expect(response.status).toBe(403);
  });

  it("rejects access to a different school", async () => {
    const response = await fetch(`${baseUrl}/activation/schools/5/devices`);
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("FROM platform_devices d"))).toBe(false);
  });

  it("rejects a device not bound to the requested school", async () => {
    state.deviceAvailable = false;
    const response = await assign();
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });

  it("rejects a student outside the requested school", async () => {
    state.studentAvailable = false;
    const response = await assign();
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });

  it("rejects a student who already has an active card", async () => {
    state.activeCardExists = true;
    const response = await assign();
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });

  it("rejects a globally registered card from another school", async () => {
    state.existingCard = { id: 9, schoolId: 5, studentId: null, status: "unassigned" };
    const response = await assign();
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO nfc_cards"))).toBe(false);
  });

  it("rejects a bound card instead of silently reassigning it", async () => {
    state.existingCard = { id: 9, schoolId: 4, studentId: 23, status: "active" };
    const response = await assign();
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE nfc_cards"))).toBe(false);
  });

  it("activates eligible cards transactionally and records device audit metadata", async () => {
    const response = await assign();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 77,
      schoolId: 4,
      uid: "CARD-77",
      student: { id: 19 },
      device: { id: 8, serialNumber: "HW-8" },
      eId: { schoolName: "Test School", photo: "/photo.jpg", cardNumber: "CARD-77" },
    });
    expect(state.queries.some(({ sql, values }) =>
      sql.includes("INSERT INTO nfc_card_history") &&
      values.includes(JSON.stringify({ deviceId: 8, deviceSerialNumber: "HW-8" })),
    )).toBe(true);
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO audit_logs") && sql.includes("NFC_CARD_ACTIVATED"),
    )).toBe(true);
  });

  it("reports the activation reader snapshot, not a later last-seen reader", async () => {
    state.historyRows = [
      { id: 1, action: "ACTIVATED", reason: '{"deviceId":8,"deviceSerialNumber":"HW-8"}' },
      { id: 2, action: "DEACTIVATED", reason: "Card replaced" },
    ];
    const response = await fetch(`${baseUrl}/activation/schools/4/history`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { id: 1, deviceId: 8, deviceSerialNumber: "HW-8" },
      { id: 2, deviceId: null, deviceSerialNumber: null },
    ]);
    expect(state.queries.find(({ sql }) => sql.includes("FROM nfc_card_history h"))?.sql)
      .not.toContain("last_device_id");
  });
});