import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  invoice: {
    id: 22, school_id: 1, subtotal_minor: 10000, discount_minor: 0, waiver_minor: 0,
    total_minor: 10000, paid_minor: 2000, outstanding_minor: 8000,
  } as Record<string, any>,
  adjustments: [] as Array<Record<string, any>>,
}));

const view = vi.hoisted(() => (row: Record<string, any>) => ({
  id: row.id,
  schoolId: row.school_id,
  invoiceId: row.invoice_id,
  kind: row.kind,
  amountMinor: row.amount_minor,
  percentage: row.requested_percentage,
  approvedAmountMinor: row.approved_amount_minor ?? null,
  originalBalanceMinor: row.original_balance_minor,
  resultingBalanceMinor: row.resulting_balance_minor ?? null,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by,
  requestedAt: "2026-10-01T10:00:00.000Z",
  approvedBy: row.approved_by ?? null,
  approvedAt: row.approved_at ? "2026-10-02T10:00:00.000Z" : null,
}));

const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
    if (sql.includes("SELECT id,subtotal_minor,paid_minor,total_minor,outstanding_minor")) {
      return result(state.invoice.id === Number(values[0]) && state.invoice.school_id === Number(values[1])
        ? [{ ...state.invoice }] : []);
    }
    if (sql.includes("INSERT INTO fee_adjustments")) {
      const row = {
        id: state.adjustments.length + 101, school_id: values[0], invoice_id: values[1],
        kind: values[2], amount_minor: values[3], requested_percentage: values[4],
        original_balance_minor: values[5], reason: values[6], requested_by: values[7],
        status: "PENDING",
      };
      state.adjustments.push(row);
      return result([view(row)]);
    }
    if (sql.includes("SELECT * FROM fee_adjustments")) {
      const row = state.adjustments.find((item) => item.id === Number(values[0]) && item.school_id === Number(values[1]));
      return result(row ? [{ ...row }] : []);
    }
    if (sql.includes("SELECT * FROM fee_invoices")) {
      return result(state.invoice.id === Number(values[0]) && state.invoice.school_id === Number(values[1])
        ? [{ ...state.invoice }] : []);
    }
    if (sql.includes("UPDATE fee_invoices SET discount_minor")) {
      state.invoice.discount_minor = values[0];
      state.invoice.waiver_minor = values[1];
      state.invoice.total_minor = values[2];
      state.invoice.outstanding_minor = values[3];
      return result();
    }
    if (sql.includes("UPDATE fee_adjustments SET status='APPROVED'")) {
      const row = state.adjustments.find((item) => item.id === Number(values[3]));
      if (!row) return result();
      row.status = "APPROVED";
      row.approved_by = values[0];
      row.approved_amount_minor = values[1];
      row.resulting_balance_minor = values[2];
      row.approved_at = new Date("2026-10-02T10:00:00.000Z");
      return result([view(row)]);
    }
    if (sql.includes("INSERT INTO audit_logs")) return result();
    throw new Error(`Unhandled adjustment test query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});

vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const schoolId = Number(req.header("x-test-school") ?? 1);
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: { id: 20, clerkUserId: "adjustment-user", email: "adjustment@example.test" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import financeRouter from "./finance";
const app = express();
app.use(express.json());
app.use(financeRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.invoice = {
    id: 22, school_id: 1, subtotal_minor: 10000, discount_minor: 0, waiver_minor: 0,
    total_minor: 10000, paid_minor: 2000, outstanding_minor: 8000,
  };
  state.adjustments.length = 0;
  dbMock.query.mockClear();
});

const requestAdjustment = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/school/finance/invoices/22/adjustments?schoolId=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("school fee adjustments", () => {
  it("preserves the requested percentage and records the approved amount and balances", async () => {
    const requested = await requestAdjustment({ kind: "DISCOUNT", percentage: 12.5, reason: "Merit discount" });
    expect(requested.status).toBe(201);
    const request = await requested.json() as Record<string, any>;
    expect(request).toMatchObject({
      amountMinor: 1250, percentage: 12.5, originalBalanceMinor: 8000,
      resultingBalanceMinor: null, requestedBy: 20, status: "PENDING",
    });
    const approved = await fetch(`${baseUrl}/school/finance/adjustments/${request.id}/approve?schoolId=1`, {
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      percentage: 12.5, approvedAmountMinor: 1250, originalBalanceMinor: 8000,
      resultingBalanceMinor: 6750, requestedBy: 20, approvedBy: 20, status: "APPROVED",
    });
    expect(state.invoice).toMatchObject({ total_minor: 8750, outstanding_minor: 6750 });
  });

  it("rounds percentage adjustments in integer basis points against the original subtotal", async () => {
    state.invoice = {
      id: 22, school_id: 1, subtotal_minor: 250, discount_minor: 0, waiver_minor: 0,
      total_minor: 250, paid_minor: 0, outstanding_minor: 250,
    };
    const requested = await requestAdjustment({ kind: "DISCOUNT", percentage: 64.6, reason: "Basis-point rounding test" });
    expect(requested.status).toBe(201);
    const request = await requested.json() as Record<string, any>;
    expect(request.amountMinor).toBe(162);
    const approved = await fetch(`${baseUrl}/school/finance/adjustments/${request.id}/approve?schoolId=1`, {
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ approvedAmountMinor: 162, resultingBalanceMinor: 88 });
  });

  it("rejects percentage calculations that would exceed the outstanding balance", async () => {
    const response = await requestAdjustment({ kind: "DISCOUNT", percentage: 100, reason: "Full discount request" });
    expect(response.status).toBe(409);
    expect(state.adjustments).toHaveLength(0);
  });

  it("rejects percentage amounts for non-discount adjustment kinds", async () => {
    const response = await requestAdjustment({ kind: "WAIVER", percentage: 10, reason: "Incorrect percentage waiver" });
    expect(response.status).toBe(400);
    expect(state.adjustments).toHaveLength(0);
  });
});