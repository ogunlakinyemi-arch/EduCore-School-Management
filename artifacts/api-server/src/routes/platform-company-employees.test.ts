import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  rows: [] as Array<Record<string, any>>,
  calls: [] as Array<{ sql: string; values: unknown[] }>,
}));

const query = vi.hoisted(() => vi.fn(async (sql: string, values: unknown[] = []) => {
  state.calls.push({ sql, values });
  if (sql.includes("INSERT INTO platform_company_employees")) {
    return { rows: [{ ...state.rows[0], id: 42, fullName: values[0], email: values[1], phone: values[2], jobTitle: values[3], status: "ACTIVE" }] };
  }
  if (sql.includes("UPDATE platform_company_employees")) {
    return { rows: [{ ...state.rows[0], fullName: values[0], email: values[1], phone: values[2], jobTitle: values[3], status: values[4] }] };
  }
  if (sql.includes("WHERE id=$1")) return { rows: state.rows.filter((row) => row.id === values[0]) };
  if (sql.includes("FROM platform_company_employees")) return { rows: state.rows };
  return { rows: [] };
}));

const client = vi.hoisted(() => ({
  query,
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query, connect: vi.fn(async () => client) },
}));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: (_req: express.Request, roles: string[]) => {
    if (!roles.includes(state.role)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  },
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "owner", email: "owner@example.test", firstName: "Yemait", lastName: "Owner" },
    roles: [{ role: state.role, schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import companyEmployeesRouter from "./platform-company-employees";

const app = express();
app.use(express.json());
app.use(companyEmployeesRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(Number((error as { statusCode?: number })?.statusCode) || 500)
    .json({ error: error instanceof Error ? error.message : "Internal Server Error" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

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
  state.role = "PLATFORM_OWNER";
  state.rows = [{
    id: 7, fullName: "Ada Staff", email: "ada@example.test", phone: null, jobTitle: "Operations",
    status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }];
  state.calls.length = 0;
  vi.clearAllMocks();
});

describe("platform company employee profiles", () => {
  it("allows only Platform Owners to list and read company profiles", async () => {
    const list = await fetch(`${baseUrl}/platform/company-employees`);
    expect(list.status).toBe(200);
    expect(await list.json()).toHaveLength(1);

    const detail = await fetch(`${baseUrl}/platform/company-employees/7`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: 7, fullName: "Ada Staff" });

    state.role = "SCHOOL_ADMIN";
    const denied = await fetch(`${baseUrl}/platform/company-employees`);
    expect(denied.status).toBe(403);
    const deniedCreate = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Not allowed", email: "denied@example.test" }),
    });
    expect(deniedCreate.status).toBe(403);
    const deniedUpdate = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    expect(deniedUpdate.status).toBe(403);
  });

  it("creates basic profiles and writes an owner audit record without creating auth users", async () => {
    const response = await fetch(`${baseUrl}/platform/company-employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Grace Employee", email: "GRACE@example.test", jobTitle: "Support" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 42, fullName: "Grace Employee", email: "grace@example.test" });
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.calls.some(({ sql }) => /INSERT INTO (app_users|school_memberships|employees)/.test(sql))).toBe(false);
    expect(state.calls.some(({ sql }) => sql === "COMMIT")).toBe(true);
  });

  it("updates profile fields with an audit event and rejects account or school fields", async () => {
    const response = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "inactive", phone: "+2348000000000" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 7, status: "INACTIVE" });
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);

    const invalid = await fetch(`${baseUrl}/platform/company-employees/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 20, schoolId: 1 }),
    });
    expect(invalid.status).toBe(400);
  });
});