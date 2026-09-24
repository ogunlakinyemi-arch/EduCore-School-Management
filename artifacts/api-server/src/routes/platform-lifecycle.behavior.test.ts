import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  device: {
    id: 100,
    serialNumber: "GATE-100",
    name: "Main gate",
    deviceType: "NFC",
    status: "ACTIVE",
    schoolId: 10 as number | null,
    schoolName: "Test School",
    location: "Front gate" as string | null,
    classId: 200 as number | null,
    configurationStatus: "CONFIGURED",
    lastSeenAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  credentials: [] as Array<{ identifier: string; status: string; hash: string }>,
}));

const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("SELECT id,school_id AS \"schoolId\",location,school_class_id AS \"classId\"")) {
        return result([{
          id: state.device.id, schoolId: state.device.schoolId,
          location: state.device.location, classId: state.device.classId,
        }]);
      }
      if (sql.includes("SELECT id,school_id AS \"schoolId\" FROM platform_devices")) {
        return result(state.device.schoolId === null ? [] : [{ id: state.device.id, schoolId: state.device.schoolId }]);
      }
      if (sql.includes("UPDATE platform_devices SET status=")) {
        state.device.status = "SUSPENDED";
        return result();
      }
      if (sql.includes("UPDATE platform_devices SET")) {
        const [changeSchool, schoolId, changeClass, classId, location, status] = values;
        if (changeSchool) state.device.schoolId = schoolId as number | null;
        if (changeClass) {
          state.device.classId = classId as number | null;
          state.device.location = location as string | null;
          state.device.configurationStatus = values[7] ? "PENDING" : "CONFIGURED";
        }
        if (status) state.device.status = String(status);
        return result([{ id: state.device.id }]);
      }
      if (sql.includes("UPDATE device_credentials SET status='REVOKED'")) {
        state.credentials.forEach((credential) => {
          if (credential.status === "ACTIVE") credential.status = "REVOKED";
        });
        return result();
      }
      if (sql.includes("INSERT INTO device_credentials")) {
        state.credentials.push({
          identifier: String(values[2]),
          hash: String(values[3]),
          status: "ACTIVE",
        });
        return result();
      }
      if (sql.includes("SELECT d.id,d.serial_number")) {
        return result([{ ...state.device }]);
      }
      if (sql.includes("INSERT INTO audit_logs") || sql.includes("INSERT INTO device_assignment_history")) {
        return result();
      }
      throw new Error(`Unhandled platform lifecycle query: ${sql}`);
    }),
    release: vi.fn(),
  };
  return { client, connect: vi.fn(async () => client), query: vi.fn(async () => result()) };
});

vi.mock("@workspace/db", () => ({ pool: dbMock }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: () => ({
    user: { id: 1, clerkUserId: "platform-owner", email: "owner@example.test", firstName: "Platform", lastName: "Owner" },
    roles: [{ role: "PLATFORM_OWNER", schoolId: null }],
  }),
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "platform-owner", email: "owner@example.test", firstName: "Platform", lastName: "Owner" },
    roles: [{ role: "PLATFORM_OWNER", schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import platformRouter from "./platform";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(platformRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message });
  return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function post(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  Object.assign(state.device, {
    status: "ACTIVE", schoolId: 10, location: "Front gate", classId: 200,
    configurationStatus: "CONFIGURED",
  });
  state.credentials.length = 0;
  vi.clearAllMocks();
});

describe("platform device lifecycle behavior", () => {
  it("issues credentials once and revokes active credentials when suspending a device", async () => {
    const created = await post("/platform/devices/100/credentials");
    expect(created.status).toBe(201);
    const body = await created.json() as { credential: string; credentialIdentifier: string };
    expect(body.credential).toContain(".");
    expect(body.credentialIdentifier).toBe(state.credentials[0].identifier);
    expect(state.credentials[0].status).toBe("ACTIVE");

    const suspended = await post("/platform/devices/100/suspend");
    expect(suspended.status).toBe(200);
    const suspendedDevice = await suspended.json() as { status: string };
    expect(suspendedDevice.status).toBe("SUSPENDED");
    expect(state.credentials[0].status).toBe("REVOKED");
  });

  it("clears the class and marks the device unconfigured when unassigning", async () => {
    const response = await patch("/platform/devices/100", { schoolId: null });
    expect(response.status).toBe(200);
    const device = await response.json() as {
      schoolId: number | null;
      classId: number | null;
      configurationStatus: string;
    };
    expect(device.schoolId).toBeNull();
    expect(device.classId).toBeNull();
    expect(device.configurationStatus).not.toBe("CONFIGURED");
  });
});