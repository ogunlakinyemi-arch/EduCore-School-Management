import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "COMPANY_ACCOUNTANT",
  eligible: true,
  clerkEmail: "finance@example.test",
  clerkEmailVerified: true,
  clerkUnavailable: false,
  calls: [] as string[],
  clerkCalls: [] as string[],
}));
const getClerkUser = vi.hoisted(() => vi.fn(async (clerkUserId: string) => {
  state.clerkCalls.push(clerkUserId);
  if (state.clerkUnavailable) throw new Error("Clerk unavailable");
  return {
    primaryEmailAddress: {
      emailAddress: state.clerkEmail,
      verification: { status: state.clerkEmailVerified ? "verified" : "unverified" },
    },
  };
}));
const query = vi.hoisted(() => vi.fn(async (sql: string) => {
  state.calls.push(sql);
  if (sql.includes("FROM app_users au")) return { rows: state.eligible ? [{ eligible: 1 }] : [] };
  if (sql.includes("FROM subscriptions") && sql.includes("GROUP BY")) {
    return { rows: [{ status: "PAID", currency: "NGN", count: 2, amount: "12000.00" }] };
  }
  if (sql.includes("FROM subscriptions")) {
    return { rows: [{ id: 1, term: "2026", amount: "6000", status: "active", verificationStatus: "verified" }] };
  }
  if (sql.includes("FROM commission_ledger")) {
    return { rows: [{ id: 3, partnerName: "Partner Co", amount: "900.00", currency: "NGN", status: "PAID" }] };
  }
  if (sql.includes("FROM partner_payouts")) {
    return { rows: [{ id: 4, partnerName: "Partner Co", amount: "900.00", currency: "NGN", status: "PAID" }] };
  }
  return { rows: [] };
}));

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: getClerkUser } } }));
vi.mock("@workspace/db", () => ({ pool: { query } }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  getUserContext: () => ({
    user: { id: 42, clerkUserId: "clerk-accountant", email: "finance@example.test" },
    roles: [{ role: state.role, schoolId: null, status: "ACTIVE" }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import companyAccountantRouter from "./company-accountant";

const app = express();
app.use(companyAccountantRouter);
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
  state.role = "COMPANY_ACCOUNTANT";
  state.eligible = true;
  state.clerkEmail = "finance@example.test";
  state.clerkEmailVerified = true;
  state.clerkUnavailable = false;
  state.calls.length = 0;
  state.clerkCalls.length = 0;
  vi.clearAllMocks();
});

describe("restricted Company Accountant finance API", () => {
  it("rejects school accountants, officers and inactive company profiles", async () => {
    state.role = "ACCOUNTANT";
    expect((await fetch(`${baseUrl}/company/accountant/overview`)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();

    state.role = "COMPANY_ACCOUNTANT";
    state.eligible = false;
    expect((await fetch(`${baseUrl}/company/accountant/overview`)).status).toBe(403);
    expect(state.calls.some((sql) => sql.includes("platform_company_employees"))).toBe(true);
  });

  it("rejects a stale or unverified Clerk primary email and fails closed when Clerk is unavailable", async () => {
    state.clerkEmail = "old-finance@example.test";
    expect((await fetch(`${baseUrl}/company/accountant/overview`)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();

    state.clerkEmail = "finance@example.test";
    state.clerkEmailVerified = false;
    expect((await fetch(`${baseUrl}/company/accountant/subscriptions`)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();

    state.clerkEmailVerified = true;
    state.clerkUnavailable = true;
    expect((await fetch(`${baseUrl}/company/accountant/payouts`)).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("serves only company subscriptions, reconciliation, commission and payout records", async () => {
    for (const path of [
      "overview", "subscriptions", "reconciliation", "commissions", "payouts",
    ]) {
      const response = await fetch(`${baseUrl}/company/accountant/${path}`);
      expect(response.status).toBe(200);
    }
    const financialQueries = state.calls.filter((sql) =>
      !sql.includes("FROM app_users au"),
    );
    expect(financialQueries.some((sql) => sql.includes("FROM subscriptions"))).toBe(true);
    expect(financialQueries.some((sql) => sql.includes("FROM commission_ledger"))).toBe(true);
    expect(financialQueries.some((sql) => sql.includes("FROM partner_payouts"))).toBe(true);
    expect(financialQueries.some((sql) => /fee_invoices|fee_payments|fee_receipts|school_finance/i.test(sql))).toBe(false);
    expect(financialQueries.some((sql) => /\bschool_id\b|\bstudent_id\b/.test(sql))).toBe(false);
    expect(state.clerkCalls).toHaveLength(5);
  });

  it("counts only verified subscriptions in the verified subscription total", async () => {
    expect((await fetch(`${baseUrl}/company/accountant/overview`)).status).toBe(200);
    const overviewQuery = state.calls.find((sql) =>
      sql.includes('AS "verifiedSubscriptionCount"'),
    );
    expect(overviewQuery).toBeDefined();
    expect(overviewQuery).toMatch(
      /COUNT\(\*\) FILTER \(WHERE lower\(verification_status\)='verified'\)::int AS "verifiedSubscriptionCount"/,
    );
    expect(overviewQuery).toContain(
      `COUNT(*) FILTER (WHERE lower(verification_status)<>'verified')::int AS "unverifiedSubscriptionCount"`,
    );
  });

  it("keeps the accountant role global and does not return school identities", async () => {
    const response = await fetch(`${baseUrl}/company/accountant/commissions`);
    const records = await response.json();
    expect(records).toEqual([{ id: 3, partnerName: "Partner Co", amount: "900.00", currency: "NGN", status: "PAID" }]);
    expect(JSON.stringify(records)).not.toMatch(/schoolId|studentId|schoolName/i);
    expect(state.calls[0]).toContain("role.school_id IS NULL");
  });

  it("does not query Clerk for users without the global accountant role", async () => {
    state.role = "ACCOUNTANT";
    expect((await fetch(`${baseUrl}/company/accountant/overview`)).status).toBe(403);
    expect(getClerkUser).not.toHaveBeenCalled();
  });
});