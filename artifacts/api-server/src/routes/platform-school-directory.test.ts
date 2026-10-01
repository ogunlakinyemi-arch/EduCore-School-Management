import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  rows: [] as Record<string, unknown>[],
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}));

const dbMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    return { rows: state.rows, rowCount: state.rows.length };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: dbMock }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: (_req: express.Request, roles: string[]) => {
    if (!roles.includes(state.role)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  },
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "owner", email: "owner@example.test", firstName: "Platform", lastName: "Owner" },
    roles: [{ role: state.role, schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import platformRouter from "./platform";

const app = express();
app.use(platformRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = Number((error as { statusCode?: number })?.statusCode) || 500;
  res.status(statusCode).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
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
  state.queries.length = 0;
  state.rows = [];
  vi.clearAllMocks();
});

describe("owner school directory", () => {
  it("returns school-scoped people counts, admins and current referral source with cross-school totals", async () => {
    state.rows = [
      {
        id: 11, code: "NORTH", name: "North School", studentCount: 30, activeStudentCount: 28,
        teacherCount: 3, staffCount: 2, parentCount: 24, administrators: [{ email: "admin@north.test" }],
        partnerReferral: { partnerId: 5, partnerName: "Referral Partner", source: "REFERRAL_LINK" },
      },
      {
        id: 12, code: "SOUTH", name: "South School", studentCount: 20, activeStudentCount: 18,
        teacherCount: 2, staffCount: 1, parentCount: 16, administrators: [],
        partnerReferral: null,
      },
    ];
    const response = await fetch(`${baseUrl}/platform/schools/directory`);
    expect(response.status).toBe(200);
    const body = await response.json() as { schools: Array<Record<string, any>>; totals: Record<string, number> };
    expect(body.schools).toHaveLength(2);
    expect(body.schools[0].administrators[0].email).toBe("admin@north.test");
    expect(body.schools[0].partnerReferral.partnerName).toBe("Referral Partner");
    expect(body.schools[1].partnerReferral).toBeNull();
    expect(body.totals).toMatchObject({
      schoolCount: 2, studentCount: 50, activeStudentCount: 46,
      teacherCount: 5, staffCount: 3, parentCount: 40,
    });
    expect(state.queries[0].sql).toContain("LEFT JOIN school_partner_attributions");
    expect(state.queries[0].sql).toContain("WHERE sm.school_id=s.id AND sm.role='SCHOOL_ADMIN'");
    expect(state.queries[0].sql).toContain("ua.metadata->>'claimId'=school_invite.metadata->>'claimId'");
    expect(state.queries[0].sql).toContain("superseded.metadata->>'supersedesClaimId'");
    expect(state.queries[0].sql).toContain("school_invite.metadata->>'invitationId'");
  });

  it("parameterizes search and validates status filters", async () => {
    const response = await fetch(`${baseUrl}/platform/schools/directory?status=active&search=Oak%25%27`);
    expect(response.status).toBe(200);
    expect(state.queries[0].values).toEqual(["active", "%Oak%'%"]);
    expect(state.queries[0].sql).toContain("LOWER(s.status)=$1");

    const invalid = await fetch(`${baseUrl}/platform/schools/directory?status=removed`);
    expect(invalid.status).toBe(400);
    expect(state.queries).toHaveLength(1);
  });

  it("denies partner access before querying school operational records", async () => {
    state.role = "PARTNER";
    const response = await fetch(`${baseUrl}/platform/schools/directory`);
    expect(response.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it("exposes a detailed owner-only school overview and hides unknown school ids", async () => {
    state.rows = [{ id: 11, deviceCount: 1, cardCount: 8, recentActivity: [] }];
    const response = await fetch(`${baseUrl}/platform/schools/11/overview`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 11, deviceCount: 1, cardCount: 8 });
    expect(state.queries[0].sql).toContain("FROM attendance_events");
    expect(state.queries[0].sql).toContain("FROM academic_results");
    expect(state.queries[0].sql).toContain("FROM audit_logs WHERE school_id=s.id");

    state.rows = [];
    const missing = await fetch(`${baseUrl}/platform/schools/999/overview`);
    expect(missing.status).toBe(404);
  });

  it("denies partners access to per-school overview details", async () => {
    state.role = "PARTNER";
    const response = await fetch(`${baseUrl}/platform/schools/11/overview`);
    expect(response.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });
});