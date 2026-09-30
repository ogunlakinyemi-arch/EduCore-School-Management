import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  photo: null as string | null,
  photoStudentId: 10,
  photoSchoolId: 1,
  metadata: { size: "0", contentType: "image/png" } as Record<string, unknown>,
  bytes: Buffer.alloc(0),
  employeeMembership: true,
  officerChecks: 0,
  fileAccesses: [] as string[],
}));

const fileMock = vi.hoisted(() => ({
  getMetadata: vi.fn(async () => [state.metadata]),
  download: vi.fn(async () => [state.bytes]),
  delete: vi.fn(async () => [{}]),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(name: string) {
      return {
        name,
        file: (objectName: string) => {
          state.fileAccesses.push(`${name}/${objectName}`);
          return { ...fileMock, bucket: { name }, name: objectName };
        },
      };
    }
  },
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("FROM students") && sql.includes("SELECT id")) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes("SELECT photo FROM students WHERE id = $1 AND school_id = $2")) {
        return Number(values[0]) === state.photoStudentId && Number(values[1]) === state.photoSchoolId
          ? { rows: [{ photo: state.photo }] }
          : { rows: [] };
      }
      if (sql.includes("UPDATE students")) return { rows: [{ previousPhoto: null }] };
      if (sql.includes("FROM school_memberships")) {
        return { rows: state.employeeMembership ? [{ "?column?": 1 }] : [] };
      }
      return { rows: [] };
    }),
  },
}));

vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string, public readonly eventType = "ACCESS_DENIED") {
      super(message);
    }
  }
  return {
    AuthError,
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    assertDeviceActivationOfficer: vi.fn(async (req: express.Request) => {
      state.officerChecks += 1;
      const context = (req as any).edupulseUser;
      const hasActiveOfficerRole = context?.roles?.some((role: any) =>
        role.role === "DEVICE_ACTIVATION_OFFICER" &&
        role.schoolId !== null &&
        role.status === "ACTIVE"
      );
      if (!hasActiveOfficerRole || !state.employeeMembership) {
        throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
      }
    }),
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.eventType }),
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
        const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: { id: 42, clerkUserId: "clerk-user", email: "staff@example.test" },
          roles: [{ role, schoolId: role === "PLATFORM_OWNER" ? null : 1, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import studentPhotosRouter from "./student-photos";

const app = express();
app.use(express.json());
app.use(studentPhotosRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let validPngBytes: Buffer;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = "/student-photo-test-bucket/private";
  validPngBytes = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 80, b: 140 } },
  }).png({ compressionLevel: 0 }).toBuffer();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));

beforeEach(() => {
  state.queries = [];
  state.photo = null;
  state.photoStudentId = 10;
  state.photoSchoolId = 1;
  state.bytes = Buffer.from(validPngBytes);
  state.metadata = { size: String(state.bytes.length), contentType: "image/png" };
  state.employeeMembership = true;
  state.officerChecks = 0;
  state.fileAccesses = [];
  fileMock.getMetadata.mockClear();
  fileMock.download.mockClear();
});

describe("student photo endpoints", () => {
  it("rejects unsupported upload types and non-admin mutation roles", async () => {
    const unsupported = await fetch(`${baseUrl}/students/10/photo-upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: 1, contentType: "image/gif", size: 200 }),
    });
    expect(unsupported.status).toBe(400);

    const unauthorized = await fetch(`${baseUrl}/students/10/photo-upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-role": "TEACHER" },
      body: JSON.stringify({ schoolId: 1, contentType: "image/png", size: 8 }),
    });
    expect(unauthorized.status).toBe(404);
  });

  it("rejects a path outside the requested school/student scope before reading storage", async () => {
    const response = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/11/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    expect(response.status).toBe(400);
    expect(fileMock.getMetadata).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE students"))).toBe(false);
  });

  it("checks stored metadata and image magic bytes before persisting a photo", async () => {
    state.bytes = Buffer.from("not really a png");
    state.metadata = { size: String(state.bytes.length), contentType: "image/png" };
    const response = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE students"))).toBe(false);
  });

  it("rejects a truncated image with valid metadata and PNG signature before persisting", async () => {
    state.bytes = Buffer.from(validPngBytes.subarray(0, validPngBytes.length - 1_024));
    state.metadata = { size: String(state.bytes.length), contentType: "image/png" };
    const response = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE students"))).toBe(false);
  });

  it("rejects an image with decompression-bomb dimensions before persisting", async () => {
    state.bytes = Buffer.from(validPngBytes);
    state.bytes.writeUInt32BE(50_000, 16);
    state.bytes.writeUInt32BE(50_000, 20);
    state.metadata = { size: String(state.bytes.length), contentType: "image/png" };
    const response = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE students"))).toBe(false);
  });

  it("persists a completely decoded image within the photo limits", async () => {
    const response = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    expect(response.status).toBe(200);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE students"))).toBe(true);
  });

  it("does not serve external legacy photo values through the managed-photo route", async () => {
    state.photo = "https://legacy.example.test/student.png";
    const response = await fetch(`${baseUrl}/students/10/photo?schoolId=1`);
    expect(response.status).toBe(404);
    expect(fileMock.getMetadata).not.toHaveBeenCalled();
  });

  it("serves the persisted current photo only to a same-school officer with active company membership", async () => {
    state.photo = "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4";
    const response = await fetch(`${baseUrl}/students/10/photo?schoolId=1`, {
      headers: { "x-test-role": "DEVICE_ACTIVATION_OFFICER" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(state.bytes);
    expect(state.officerChecks).toBe(1);
    expect(state.fileAccesses).toEqual([
      "student-photo-test-bucket/private/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
    ]);
  });

  it("denies officer photo access without an active internal employee match", async () => {
    state.photo = "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4";
    state.employeeMembership = false;
    const response = await fetch(`${baseUrl}/students/10/photo?schoolId=1`, {
      headers: { "x-test-role": "DEVICE_ACTIVATION_OFFICER" },
    });
    expect(response.status).toBe(404);
    expect(fileMock.getMetadata).not.toHaveBeenCalled();
    expect(state.officerChecks).toBe(1);
  });

  it("allows an active global Platform Owner to read the persisted photo for the requested student and school", async () => {
    state.photo = "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4";
    const response = await fetch(`${baseUrl}/students/10/photo?schoolId=1`, {
      headers: { "x-test-role": "PLATFORM_OWNER" },
    });

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(state.bytes);
    expect(state.queries).toContainEqual(expect.objectContaining({
      sql: "SELECT photo FROM students WHERE id = $1 AND school_id = $2",
      values: [10, 1],
    }));
    expect(state.fileAccesses).toEqual([
      "student-photo-test-bucket/private/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
    ]);
    expect(state.officerChecks).toBe(0);
  });

  it("does not let Owner photo reads escape the exact school/student row scope", async () => {
    state.photo = "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4";
    const wrongStudent = await fetch(`${baseUrl}/students/11/photo?schoolId=1`, {
      headers: { "x-test-role": "PLATFORM_OWNER" },
    });
    expect(wrongStudent.status).toBe(404);
    const wrongSchool = await fetch(`${baseUrl}/students/10/photo?schoolId=2`, {
      headers: { "x-test-role": "PLATFORM_OWNER" },
    });
    expect(wrongSchool.status).toBe(404);
    expect(state.queries).toContainEqual(expect.objectContaining({
      sql: "SELECT photo FROM students WHERE id = $1 AND school_id = $2",
      values: [11, 1],
    }));
    expect(state.queries).toContainEqual(expect.objectContaining({
      sql: "SELECT photo FROM students WHERE id = $1 AND school_id = $2",
      values: [10, 2],
    }));
    expect(state.fileAccesses).toEqual([]);
  });

  it("does not allow Owner photo upload or mutation", async () => {
    const headers = { "Content-Type": "application/json", "x-test-role": "PLATFORM_OWNER" };
    const upload = await fetch(`${baseUrl}/students/10/photo-upload-request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ schoolId: 1, contentType: "image/png", size: 100 }),
    });
    const confirmation = await fetch(`${baseUrl}/students/10/photo-confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schoolId: 1,
        objectPath: "/objects/student-photos/1/10/44b6e0bf-4b47-4c1f-9f70-df7d0ad030b4",
      }),
    });
    const deletion = await fetch(`${baseUrl}/students/10/photo?schoolId=1`, {
      method: "DELETE",
      headers: { "x-test-role": "PLATFORM_OWNER" },
    });

    expect(upload.status).toBe(404);
    expect(confirmation.status).toBe(404);
    expect(deletion.status).toBe(404);
    expect(fileMock.getMetadata).not.toHaveBeenCalled();
    expect(state.fileAccesses).toEqual([]);
  });
});