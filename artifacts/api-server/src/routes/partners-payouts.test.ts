import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payoutStatus: "PAID",
  payableRows: [] as Array<{ id: number; amount: string }>,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}));

const dbMock = vi.hoisted(() => {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("SELECT id,status FROM partner_payouts")) {
      return { rows: [{ id: 7, status: state.payoutStatus }], rowCount: 1 };
    }
    if (sql.includes("SELECT id,amount FROM commission_ledger")) {
      return { rows: state.payableRows, rowCount: state.payableRows.length };
    }
    if (sql.includes("UPDATE partner_payouts")) {
      return {
        rows: [{
          id: 7, partnerId: 3, amount: 0.3, currency: "NGN", status: values[0],
          reversalReference: values[2], paymentReference: "payment-123",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO partner_payouts")) {
      return {
        rows: [{ id: 9, partnerId: values[0], amount: Number(values[1]), currency: values[2], status: "PENDING" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(async () => client), client };
});

vi.mock("@workspace/db", () => ({ pool: dbMock }));
vi.mock("@clerk/express", () => ({ clerkClient: { invitations: {} } }));
vi.mock("../middlewares/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
  },
  assertRoles: (_req: express.Request, roles: string[]) => {
    if (!roles.includes("PLATFORM_OWNER")) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    return {
      user: { id: 1, clerkUserId: "owner", email: "owner@example.test" },
      roles: [{ role: "PLATFORM_OWNER", schoolId: null }],
    };
  },
  getUserContext: () => ({
    user: { id: 1, clerkUserId: "owner", email: "owner@example.test" },
    roles: [{ role: "PLATFORM_OWNER", schoolId: null }],
  }),
  requireAuthentication: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import partnersRouter from "./partners";

const app = express();
app.use(express.json());
app.use(partnersRouter);
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
  state.payoutStatus = "PAID";
  state.payableRows = [];
  state.queries.length = 0;
  vi.clearAllMocks();
});

describe("partner payout safety", () => {
  it("requires a valid reversal reference and persists it to payout, commissions, and audit metadata", async () => {
    const response = await fetch(`${baseUrl}/platform/partner-payouts/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "REVERSED", paymentReference: "  bank-reversal-456  " }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "REVERSED", reversalReference: "bank-reversal-456" });
    const payoutUpdate = state.queries.find(({ sql }) => sql.includes("UPDATE partner_payouts"));
    expect(payoutUpdate?.sql).toContain("reversal_reference");
    expect(payoutUpdate?.values).toEqual(["REVERSED", "bank-reversal-456", "bank-reversal-456", 7]);
    const commissionUpdate = state.queries.find(({ sql }) => sql.includes("UPDATE commission_ledger SET payout_id=NULL"));
    expect(commissionUpdate?.values).toEqual([7, "bank-reversal-456"]);
    const auditInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
    expect(auditInsert?.values[7]).toEqual({ reversalReference: "bank-reversal-456" });
  });

  it.each(["", "   ", "bad\nreference", "r".repeat(201)])(
    "rejects an empty or malformed reversal reference (%j)",
    async (paymentReference) => {
      const response = await fetch(`${baseUrl}/platform/partner-payouts/7`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "REVERSED", paymentReference }),
      });
      expect(response.status).toBe(400);
      expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_payouts"))).toBe(false);
    },
  );

  it("rejects a repeated reversal transition", async () => {
    state.payoutStatus = "REVERSED";
    const response = await fetch(`${baseUrl}/platform/partner-payouts/7`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "REVERSED", paymentReference: "another-reversal" }),
    });
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE partner_payouts"))).toBe(false);
  });

  it("matches payable entries with exact decimal minor-unit arithmetic", async () => {
    state.payableRows = [{ id: 10, amount: "0.10" }, { id: 11, amount: "0.20" }];
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: 0.3 }),
    });
    expect(response.status).toBe(201);
    const insert = state.queries.find(({ sql }) => sql.includes("INSERT INTO partner_payouts"));
    expect(insert?.values[1]).toBe("0.30");
    const allocation = state.queries.find(({ sql }) => sql.includes("UPDATE commission_ledger SET payout_id=$1"));
    expect(allocation?.values).toEqual([9, [10, 11]]);
  });

  it("skips an oversized oldest entry to select a later exact match", async () => {
    state.payableRows = [{ id: 20, amount: "0.30" }, { id: 21, amount: "0.20" }];
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: "0.20" }),
    });
    expect(response.status).toBe(201);
    const allocation = state.queries.find(({ sql }) => sql.includes("UPDATE commission_ledger SET payout_id=$1"));
    expect(allocation?.values).toEqual([9, [21]]);
  });

  it("backtracks from the oldest entry when a non-greedy exact subset exists", async () => {
    state.payableRows = [{ id: 30, amount: "0.20" }, { id: 31, amount: "0.40" }];
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: "0.40" }),
    });
    expect(response.status).toBe(201);
    const allocation = state.queries.find(({ sql }) => sql.includes("UPDATE commission_ledger SET payout_id=$1"));
    expect(allocation?.values).toEqual([9, [31]]);
  });

  it("rejects a payout amount with no exact whole-entry subset", async () => {
    state.payableRows = [{ id: 40, amount: "0.30" }, { id: 41, amount: "0.50" }];
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: "0.40" }),
    });
    expect(response.status).toBe(409);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_payouts"))).toBe(false);
  });

  it("refuses subset searches that exceed the bounded search budget", async () => {
    state.payableRows = Array.from({ length: 256 }, (_, index) => ({ id: index + 1, amount: "0.02" }));
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: "2.55" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Payout selection exceeded the safe search limit; narrow the payable set and retry",
    });
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_payouts"))).toBe(false);
  });

  it("rejects fractions smaller than the database's two-decimal monetary scale", async () => {
    state.payableRows = [{ id: 10, amount: "0.10" }];
    const response = await fetch(`${baseUrl}/platform/partner-payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partnerId: 3, amount: "0.1009" }),
    });
    expect(response.status).toBe(400);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO partner_payouts"))).toBe(false);
  });
});