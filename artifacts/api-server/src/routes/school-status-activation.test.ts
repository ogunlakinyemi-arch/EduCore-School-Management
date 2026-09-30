import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  schoolExists: true,
  activeAdmin: false,
  storedSchoolStatus: "pending",
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("UPDATE schools s SET status")) {
      const status = values[0];
      state.storedSchoolStatus = status as string;
      return {
        rows: status !== "active" || state.activeAdmin ? [{ id: values[1] }] : [],
      };
    }
    if (sql.includes("UPDATE schools s SET code=")) {
      const status = values[12];
      if (status === "active" && !state.activeAdmin) return { rows: [] };
      state.storedSchoolStatus = status as string;
      return { rows: [{ id: values[13] }] };
    }
    if (sql.includes("INSERT INTO schools")) {
      state.storedSchoolStatus = values[12] as string;
      return { rows: [{ id: 1 }] };
    }
    if (sql.includes("SELECT * FROM schools WHERE id = $1")) {
      return {
        rows: state.schoolExists
          ? [{
              id: 1,
              code: "SCHOOL1",
              name: "Example School",
              city: "Lagos",
              state: "Lagos",
              registration_number: null,
              address: null,
              lga: null,
              phone: null,
              email: null,
              website: null,
              logo: null,
              school_type: null,
              status: state.storedSchoolStatus,
            }]
          : [],
      };
    }
    if (sql.includes("SELECT id FROM schools WHERE id = $1")) {
      return { rows: state.schoolExists ? [{ id: values[0] }] : [] };
    }
    if (sql.includes("FROM schools s WHERE s.id = $1")) {
      return { rows: [{ id: values[0], createdAt: null, status: state.storedSchoolStatus }] };
    }
    return { rows: [] };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
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
          clerkUserId: "clerk-test-owner",
          email: "owner@example.test",
          firstName: "Test",
          lastName: "Owner",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" ? null : 1, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import edupulseRouter from "./edupulse";

const app = express();
app.use(express.json());
app.use(edupulseRouter);

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
  state.role = "PLATFORM_OWNER";
  state.schoolExists = true;
  state.activeAdmin = false;
  state.storedSchoolStatus = "pending";
  state.queries.length = 0;
  poolMock.query.mockClear();
});

async function changeStatus(status: string) {
  return fetch(`${baseUrl}/schools/1/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

async function patchSchool(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/schools/1`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSchool(status?: string) {
  return fetch(`${baseUrl}/schools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "SCHOOL1",
      name: "Example School",
      city: "Lagos",
      state: "Lagos",
      ...(status ? { status } : {}),
    }),
  });
}

describe("Platform Owner school status activation invariant", () => {
  it("rejects activation with 409 when a school has no active linked School Admin", async () => {
    const response = await changeStatus("active");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("active School Admin"),
    });
    const update = state.queries.find(({ sql }) => sql.includes("UPDATE schools s SET status"));
    expect(update?.sql).toContain("JOIN app_users au ON au.id = sm.user_id");
    expect(update?.sql).toContain("sm.role = 'SCHOOL_ADMIN'");
    expect(update?.sql).toContain("sm.status = 'ACTIVE'");
    expect(update?.sql).toContain("au.status = 'ACTIVE'");
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(false);
  });

  it("returns 404 rather than the pending-activation conflict for a missing school", async () => {
    state.schoolExists = false;
    const response = await changeStatus("active");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "School not found" });
  });

  it("allows activation and reactivation when an active linked School Admin exists", async () => {
    state.activeAdmin = true;
    const response = await changeStatus("active");
    expect(response.status).toBe(200);
    expect(state.queries.find(({ sql }) => sql.includes("UPDATE schools s SET status"))?.values)
      .toEqual(["active", 1]);
  });

  it("blocks the general school PATCH route from activating without an active linked admin", async () => {
    const response = await patchSchool({ name: "Updated School", status: "active" });
    expect(response.status).toBe(409);
    expect(state.queries.find(({ sql }) => sql.includes("UPDATE schools s SET code="))?.sql)
      .toContain("sm.status = 'ACTIVE'");
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE schools s SET code="))).toBe(true);
  });

  it("allows the general school PATCH route to activate with an active linked admin", async () => {
    state.activeAdmin = true;
    const response = await patchSchool({ name: "Updated School", status: "active" });
    expect(response.status).toBe(200);
    expect(state.queries.find(({ sql }) => sql.includes("UPDATE schools s SET code="))?.values)
      .toEqual(["SCHOOL1", "Updated School", "Lagos", "Lagos", null, null, null, null, null, null,
        null, null, "active", 1]);
  });

  it.each([undefined, "active"])("creates standalone schools pending instead of active (requested status: %s)", async (status) => {
    const response = await createSchool(status);
    expect(response.status).toBe(201);
    expect(state.queries.find(({ sql }) => sql.includes("INSERT INTO schools"))?.values[12])
      .toBe("pending");
  });

  it.each(["suspended", "inactive"])("allows an Owner to transition a school to %s without an admin", async (status) => {
    const response = await changeStatus(status);
    expect(response.status).toBe(200);
    expect(state.queries.find(({ sql }) => sql.includes("UPDATE schools s SET status"))?.values)
      .toEqual([status, 1]);
  });

  it("preserves the Platform Owner-only permission on manual status changes", async () => {
    state.role = "SCHOOL_ADMIN";
    const response = await changeStatus("suspended");
    expect(response.status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE schools s SET status"))).toBe(false);
  });
});