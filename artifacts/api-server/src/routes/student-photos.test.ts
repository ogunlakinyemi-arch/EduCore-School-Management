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
      if (sql.includes("SELECT id FROM employees")) {
        return { rows: Number(values[0]) === 10 && Number(values[1]) === 1 &&
          (values.length < 3 || state.employeeMembership) ? [{ id: 10 }] : [] };
      }
      if (sql.includes("SELECT photo FROM employees WHERE id = $1 AND school_id = $2")) {
        return { rows: Number(values[0]) === 10 && Number(values[1]) === 1 ? [{ photo: state.photo }] : [] };
      }
      if (sql.includes("UPDATE employees")) return { rows: [{ previousPhoto: null }] };
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

import studentPhotosRouter, { createPersonPhotosRouter } from "./student-photos";

const app = express();
app.use(express.json());
app.use(studentPhotosRouter);
app.use(createPersonPhotosRouter("employee"));
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

describe("employee passport photo endpoints reuse the student security boundary", () => {
  const path = "/objects/employee-photos/1/10/11111111-1111-4111-8111-111111111111";
  const confirm = (role = "SCHOOL_ADMIN", objectPath = path) =>
    fetch(`${baseUrl}/employees/10/photo-confirm`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-role": role },
      body: JSON.stringify({ schoolId: 1, objectPath }),
    });
  it("validates image bytes and persists the existing employee photo field with school scope", async () => {
    const response = await confirm();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photoUrl: "/api/employees/10/photo?schoolId=1" });
    const update = state.queries.find(({ sql }) => sql.includes("UPDATE employees"));
    expect(update?.values).toEqual([path, 10, 1]);
    expect(update?.sql).toContain("WHERE id = $2 AND school_id = $3");
    expect(fileMock.download).toHaveBeenCalled();
  });
  it.each(["PLATFORM_OWNER", "TEACHER", "STAFF", "PARENT"])("denies %s upload confirmation without storage or database writes", async role => {
    expect((await confirm(role)).status).toBe(404);
    expect(fileMock.download).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE employees"))).toBe(false);
  });
  it.each([path.replace("/1/10/", "/2/10/"), path.replace("/1/10/", "/1/11/"), path.replace("employee-photos", "student-photos"), "https://example.test/photo.png"])("rejects mismatched or public object paths: %s", async objectPath => {
    expect((await confirm("SCHOOL_ADMIN", objectPath)).status).toBe(400);
    expect(fileMock.download).not.toHaveBeenCalled();
  });
  it("rejects corrupt bytes without replacing the saved photo", async () => {
    state.bytes = Buffer.from("not an image");
    state.metadata.size = String(state.bytes.length);
    expect((await confirm()).status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE employees"))).toBe(false);
  });
  it("serves a private image to Owner and same-school Admin, but not another-school request", async () => {
    state.photo = path;
    for (const role of ["PLATFORM_OWNER", "SCHOOL_ADMIN"]) {
      const response = await fetch(`${baseUrl}/employees/10/photo?schoolId=1`, { headers: { "x-test-role": role } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-type")).toContain("image/png");
    }
    expect((await fetch(`${baseUrl}/employees/10/photo?schoolId=2`)).status).toBe(404);
  });
  it("does not allow another employee or Parent to retrieve the photo", async () => {
    state.photo = path;
    state.employeeMembership = false;
    for (const role of ["TEACHER", "STAFF", "PARENT"]) {
      expect((await fetch(`${baseUrl}/employees/10/photo?schoolId=1`, { headers: { "x-test-role": role } })).status).toBe(404);
    }
    expect(fileMock.download).not.toHaveBeenCalled();
  });
  it("validates request type and size before issuing a signed URL", async () => {
    for (const [contentType, size] of [["image/gif", 200], ["image/png", 3145729]]) {
      expect((await fetch(`${baseUrl}/employees/10/photo-upload-request`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schoolId: 1, contentType, size }),
      })).status).toBe(400);
    }
    expect(state.fileAccesses).toHaveLength(0);
  });
  it("issues only a short-lived, privately scoped upload target for an existing employee", async () => {
    const originalFetch = globalThis.fetch;
    let signedBody: Record<string, unknown> | undefined;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "http://127.0.0.1:1106/object-storage/signed-object-url") {
        signedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ signed_url: "https://signed-upload.example/unit" }), { status: 200 });
      }
      return originalFetch(input, init);
    });
    try {
      const response = await originalFetch(`${baseUrl}/employees/10/photo-upload-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: 1, contentType: "image/png", size: 100 }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        uploadURL: "https://signed-upload.example/unit",
        objectPath: expect.stringMatching(/^\/objects\/employee-photos\/1\/10\/[0-9a-f-]+$/),
      });
      expect(signedBody).toMatchObject({ method: "PUT", object_name: expect.stringMatching(/^private\/employee-photos\/1\/10\//) });
      expect(Date.parse(String(signedBody?.expires_at)) - Date.now()).toBeLessThanOrEqual(180000);
      expect(Date.parse(String(signedBody?.expires_at)) - Date.now()).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
  });
});