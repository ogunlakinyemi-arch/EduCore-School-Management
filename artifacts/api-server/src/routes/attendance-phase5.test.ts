import express from "express";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type AttendanceEvent = {
  id: number;
  schoolId: number;
  studentId: number;
  deviceId: number;
  eventType: string;
  occurredAt: string;
};

const state = vi.hoisted(() => ({
  events: [] as AttendanceEvent[],
  nextEventId: 1,
  credential: {
    identifier: "gate-a",
    secret: "correct-secret",
    schoolId: 10,
    deviceId: 100,
    status: "ACTIVE",
    configured: true,
  },
  student: { id: 501, schoolId: 10, status: "ACTIVE" },
  cards: [{ id: 700, uid: "CARD-A", schoolId: 10, studentId: 501, status: "ACTIVE" }],
  policy: "NFC_ONLY",
  biometricEnrollments: [] as Array<Record<string, unknown>>,
  duplicateSeconds: 60,
}));

const poolMock = vi.hoisted(() => {
  const result = (rows: any[]) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("FROM device_credentials")) {
      const identifier = String(values[0]);
      const c = state.credential;
      if (identifier !== c.identifier || c.status !== "ACTIVE") return result([]);
      return result([{
        credentialId: 1,
        deviceId: c.deviceId,
        schoolId: c.schoolId,
        secretHash: createHash("sha256").update(c.secret).digest("hex"),
        deviceStatus: c.status,
      }]);
    }
    if (text.includes("FROM platform_devices WHERE id")) {
      return result(state.credential.configured ? [{ "?column?": 1 }] : []);
    }
    if (text.includes("UPDATE device_credentials") || text.includes("UPDATE platform_devices")) return result([]);
    if (text.includes("FROM students WHERE id=$1 AND school_id=$2")) {
      return result(state.student.id === Number(values[0]) && state.student.schoolId === Number(values[1]) &&
        state.student.status === "ACTIVE" ? [{ id: state.student.id }] : []);
    }
    if (text.includes("FROM student_identification_policies")) {
      return result(state.policy === "NFC_ONLY" ? [] : [{ policy: state.policy }]);
    }
    if (text.includes("FROM nfc_cards")) {
      const card = state.cards.find((candidate) =>
        candidate.uid === String(values[0]) && candidate.schoolId === Number(values[1]) &&
        candidate.studentId === Number(values[2]) && candidate.status === "ACTIVE");
      return result(card ? [{ id: card.id }] : []);
    }
    if (text.includes("FROM biometric_enrollments")) {
      const enrollment = state.biometricEnrollments.find((candidate) =>
        candidate.schoolId === Number(values[0]) && candidate.studentId === Number(values[1]) &&
        candidate.provider === values[2] && candidate.providerReference === values[3]);
      return result(enrollment ? [{ id: enrollment.id }] : []);
    }
    if (text.includes("FROM attendance_settings")) return result([{ seconds: state.duplicateSeconds }]);
    throw new Error(`Unhandled pool query: ${text}`);
  });

  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text) || text.includes("pg_advisory_xact_lock")) {
        return result([]);
      }
      if (text.includes("FROM attendance_events")) {
        const [schoolId, studentId, deviceId, eventType, occurredAt, seconds] = values;
        const center = new Date(String(occurredAt)).getTime();
        const windowMs = Number(seconds) * 1000;
        return result(state.events.filter((event) =>
          event.schoolId === Number(schoolId) && event.studentId === Number(studentId) &&
          event.deviceId === Number(deviceId) && event.eventType === eventType &&
          Math.abs(new Date(event.occurredAt).getTime() - center) <= windowMs
        ).map((event) => ({ id: event.id })));
      }
      if (text.includes("INSERT INTO attendance_events")) {
        const [schoolId, studentId, deviceId, _cardId, _classId, _method, eventType, _date, occurredAt] = values;
        const event: AttendanceEvent = {
          id: state.nextEventId++,
          schoolId: Number(schoolId),
          studentId: Number(studentId),
          deviceId: Number(deviceId),
          eventType: String(eventType),
          occurredAt: String(occurredAt),
        };
        state.events.push(event);
        return result([{
          id: event.id, schoolId: event.schoolId, studentId: event.studentId,
          deviceId: event.deviceId, eventType: event.eventType,
          identificationMethod: "NFC", status: "PRESENT", result: "ACCEPTED",
          occurredAt: event.occurredAt, createdAt: event.occurredAt,
        }]);
      }
      if (text.includes("INSERT INTO attendance_notification_events")) return result([]);
      throw new Error(`Unhandled client query: ${text}`);
    }),
    release: vi.fn(),
  };
  return { query, connect: vi.fn(async () => client), client };
});

vi.mock("@workspace/db", () => ({ pool: poolMock }));

import attendanceRouter from "./attendance";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(attendanceRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message });
  return res.status(500).json({ error: "Internal Server Error" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

async function request(body: Record<string, unknown>, credential = "gate-a.correct-secret") {
  return fetch(`${baseUrl}/device/attendance/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-credential": credential },
    body: JSON.stringify(body),
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 501,
    eventType: "SCHOOL_ENTRY",
    identificationMethod: "NFC",
    nfcUid: "CARD-A",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
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
  state.events.length = 0;
  state.nextEventId = 1;
  state.credential.status = "ACTIVE";
  state.credential.configured = true;
  state.student = { id: 501, schoolId: 10, status: "ACTIVE" };
  state.cards = [{ id: 700, uid: "CARD-A", schoolId: 10, studentId: 501, status: "ACTIVE" }];
  state.policy = "NFC_ONLY";
  state.biometricEnrollments.length = 0;
  state.duplicateSeconds = 60;
});

describe("Phase 5 device attendance behavior", () => {
  it("rejects missing and invalid device credentials", async () => {
    const missing = await fetch(`${baseUrl}/device/attendance/events`, { method: "POST" });
    expect(missing.status).toBe(401);
    expect((await request(event(), "gate-a.wrong-secret")).status).toBe(401);
  });

  it("rejects an inactive or unconfigured device credential", async () => {
    state.credential.status = "INACTIVE";
    expect((await request(event())).status).toBe(401);
    state.credential.status = "ACTIVE";
    state.credential.configured = false;
    expect((await request(event())).status).toBe(401);
  });

  it("rejects students and cards from another school, including inactive cards", async () => {
    state.student.schoolId = 11;
    expect((await request(event())).status).toBe(404);
    state.student.schoolId = 10;
    state.cards[0].schoolId = 11;
    expect((await request(event())).status).toBe(403);
    state.cards[0].schoolId = 10;
    state.cards[0].status = "INACTIVE";
    expect((await request(event())).status).toBe(403);
  });

  it("accepts an entry, suppresses a rolling-window duplicate, then accepts after the window", async () => {
    const firstTime = new Date(Date.now() - 30_000);
    expect((await request(event({ occurredAt: firstTime.toISOString() }))).status).toBe(201);
    expect((await request(event({ occurredAt: new Date(firstTime.getTime() + 30_000).toISOString() }))).status).toBe(409);
    expect((await request(event({ occurredAt: new Date(firstTime.getTime() + 61_000).toISOString() }))).status).toBe(201);
    expect(state.events).toHaveLength(2);
  });

  it("rejects biometric attendance without a valid enrollment", async () => {
    state.policy = "NFC_AND_BIOMETRIC";
    const response = await request(event({
      identificationMethod: "FINGERPRINT",
      matchResult: "MATCH",
      provider: "device-vendor",
      providerReference: "missing-enrollment",
      nfcUid: undefined,
    }));
    expect(response.status).toBe(403);
    expect(state.events).toHaveLength(0);
  });
});