import express from "express";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), archived: false }));
vi.mock("@workspace/db", () => ({ pool: { query: state.query } }));
vi.mock("../services/test-account-archive-access", () => ({
  assertTestArchiveAccess: async () => { if (state.archived) throw new Error("archived"); },
}));
vi.mock("../middlewares/auth", async original => ({
  ...await original<typeof import("../middlewares/auth")>(),
  requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-role") ?? "PARTNER";
    (req as any).edupulseUser = { user: { id: Number(req.header("x-user") ?? "1"),
      status: req.header("x-status") ?? "ACTIVE", clerkUserId: "fixture" },
      roles: [{ role, status: req.header("x-membership") ?? "ACTIVE", schoolId: null }] };
    next();
  },
}));
import router from "./bro-own-entitlements";
import privacy from "../middlewares/owner-commission-privacy";
import { assertRoles, requireAuthentication } from "../middlewares/auth";
const app = express();
app.use(requireAuthentication()); app.use(privacy); app.use(router);
app.get("/platform/commission-records", (req, res) => {
  try { assertRoles(req, ["PLATFORM_OWNER"]); res.json({ commissionAmountMinor: 30000,
    policy: "Owner-only approval evidence", platformRevenue: 640000 }); }
  catch { res.sendStatus(403); }
});
let server: ReturnType<typeof app.listen>, base = "";
beforeAll(async () => new Promise<void>(resolve => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") base = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
  state.archived = false; state.query.mockReset();
  state.query.mockImplementation(async (sql: string, values: number[]) => {
    if (sql.includes("FROM partner_profiles")) return { rows: values[0] <= 2 ? [{ id: values[0] * 10 }] : [] };
    if (sql.includes("FROM bro_term_commission_entitlements")) {
      expect(sql).toContain("WHERE partner_profile_id=$1");
      return { rows: [{ id: values[0], studentId: values[0] + 100, termId: 4, amountMinor: 15000,
        currency: "NGN", status: "PENDING_OWNER_APPROVAL", earnedAt: "2027-01-18T10:00:00Z",
        // Even unexpected surplus DB fields cannot be reflected by the DTO.
        schoolPaymentMinor: 320000, platformRevenue: 320000, policyId: 9, evidence: { secret: "private" } }] };
    }
    throw new Error(`Unexpected fixture query: ${sql}`);
  });
});
const get = (path = "/partner/commission-entitlements", headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers });
describe("private BRO own-entitlement endpoint", () => {
  it("uses only authenticated principal scope and strips school amounts, revenue and policy evidence", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({ earnedMinor: 15000, currency: "NGN", items: [
      { id: 10, studentId: 110, termId: 4, amountMinor: 15000, currency: "NGN",
        status: "PENDING_OWNER_APPROVAL", earnedAt: "2027-01-18T10:00:00.000Z" },
    ] });
    expect(JSON.stringify(body)).not.toMatch(/320000|payment|revenue|evidence|policy|secret/i);
    expect(state.query.mock.calls[0][1]).toEqual([1]);
    expect(state.query.mock.calls[1][1]).toEqual([10]);
  });
  it("isolates two BROs and refuses caller-selected cross-BRO or school scopes", async () => {
    const first = await (await get()).json() as any;
    const second = await (await get(undefined, { "x-user": "2" })).json() as any;
    expect(first.items[0].id).toBe(10); expect(second.items[0].id).toBe(20);
    expect(second.items).not.toContainEqual(first.items[0]);
    for (const query of ["partnerId=20", "schoolId=2", "studentId=120"]) {
      state.query.mockClear();
      expect((await get(`/partner/commission-entitlements?${query}`)).status).toBe(400);
      expect(state.query).not.toHaveBeenCalled();
    }
    expect((await get(undefined, { "x-user": "3" })).status).toBe(404);
  });
  it.each(["SCHOOL_ADMIN", "ACCOUNTANT", "TEACHER", "STUDENT", "PARENT", "STAFF"])(
    "denies %s without reading financial data", async role => {
      expect((await get(undefined, { "x-role": role })).status).toBe(403);
      expect(state.query).not.toHaveBeenCalled();
    });
  it("denies inactive identities, memberships and archived profiles", async () => {
    expect((await get(undefined, { "x-status": "INACTIVE" })).status).toBe(404);
    expect((await get(undefined, { "x-membership": "INACTIVE" })).status).toBe(404);
    state.archived = true;
    expect((await get()).status).toBe(503);
    expect(state.query.mock.calls.some(([sql]) => sql.includes("bro_term_commission_entitlements"))).toBe(false);
  });
  it("preserves authorized Owner records but never grants them to a BRO", async () => {
    const owner = await get("/platform/commission-records", { "x-role": "PLATFORM_OWNER" });
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({ commissionAmountMinor: 30000, platformRevenue: 640000 });
    expect((await get("/platform/commission-records")).status).toBe(403);
  });
});
