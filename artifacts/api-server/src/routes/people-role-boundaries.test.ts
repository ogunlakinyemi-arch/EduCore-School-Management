import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  employeeRow: {
    id: 50,
    schoolId: 1,
    employeeId: "EMP-50",
    firstName: "School",
    middleName: null,
    lastName: "Teacher",
    type: "TEACHER",
    phone: null,
    email: null,
    address: null,
    photoUrl: null,
    gender: null,
    status: "ACTIVE",
    dateEmployed: null,
    department: null,
    qualification: null,
    userId: 99,
  },
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("FROM employees e WHERE e.id = $1")) return { rows: [state.employeeRow] };
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
      const role = req.header("x-test-role") ?? "TEACHER";
      const roles = role === "OWNER"
        ? [{ id: 1, role: "PLATFORM_OWNER", schoolId: null, status: "ACTIVE" }]
        : role === "MIXED"
          ? [
              { id: 2, role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" },
              { id: 3, role: "TEACHER", schoolId: 1, status: "ACTIVE" },
            ]
          : role === "ADMIN"
            ? [{ id: 4, role: "SCHOOL_ADMIN", schoolId: 1, status: "ACTIVE" }]
            : [{ id: 5, role: "TEACHER", schoolId: 1, status: "ACTIVE" }];
      (req as any).edupulseUser = {
        user: {
          id: 42,
          clerkUserId: `clerk-${role}`,
          email: `${role.toLowerCase()}@example.test`,
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        },
        roles,
      };
      next();
    },
  };
});

import peopleRouter from "./people";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(peopleRouter);
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

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.queries.length = 0;
  poolMock.query.mockClear();
});

async function call(path: string, role: string) {
  return fetch(`${baseUrl}${path}`, { headers: { "x-test-role": role } });
}

describe("employee read scope follows the requested school's membership", () => {
  it("limits a teacher with an administrator role at another school to their own employee row", async () => {
    expect((await call("/employees?schoolId=1", "MIXED")).status).toBe(200);
    const directoryQuery = state.queries.find(({ sql }) => sql.includes("SELECT") && sql.includes("FROM employees e WHERE e.school_id"));
    expect(directoryQuery?.sql).toContain("e.user_id = $2");
    expect(directoryQuery?.values).toEqual([1, 42]);

    expect((await call("/employees/50?schoolId=1", "MIXED")).status).toBe(404);
  });

  it("keeps broad employee reads for a same-school School Admin and Platform Owner", async () => {
    expect((await call("/employees?schoolId=1", "ADMIN")).status).toBe(200);
    const adminQuery = state.queries.at(-1);
    expect(adminQuery?.sql).not.toContain("e.user_id =");

    expect((await call("/employees?schoolId=1", "OWNER")).status).toBe(200);
    const ownerQuery = state.queries.at(-1);
    expect(ownerQuery?.sql).not.toContain("e.user_id =");
    expect(ownerQuery?.values).toEqual([1]);
  });
});