import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
  row: {
    id: 101, schoolId: 1, paymentId: 11, invoiceId: 22, invoiceNumber: "INV-22",
    studentId: 31, studentName: "Example Student", className: "Year 4", section: "A",
    paymentReference: "PAY-11", paymentAmountMinor: 5000, paymentMethod: "BANK_TRANSFER",
    paymentStatus: "VERIFIED", transactionType: "REFUND", amountMinor: 2000, currency: "NGN", reason: "Approved credit correction",
    status: "PENDING", reference: "EDC-REF-101", evidenceReference: null, reviewerNotes: null,
    requestedAt: "2026-09-02T12:00:00.000Z", approvedAt: null,
  } as Record<string, any>,
}));
const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("FROM fee_refunds fr")) {
      return result(Number(values[0]) === 101 || (sql.includes("WHERE fr.school_id=$1") && Number(values[0]) === 1)
        ? [{ ...state.row }] : []);
    }
    throw new Error(`Unexpected refund list query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});

vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const assignmentsHeader = req.header("x-test-assignments");
      const roles = assignmentsHeader
        ? assignmentsHeader.split(",").map((item, index) => {
          const [role, schoolId] = item.split(":");
          return { id: index + 1, role, schoolId: Number(schoolId), status: "ACTIVE" };
        })
        : [{
          id: 1,
          role: req.header("x-test-role") ?? "SCHOOL_ADMIN",
          schoolId: Number(req.header("x-test-school") ?? 1),
          status: "ACTIVE",
        }];
      (req as any).edupulseUser = {
        user: { id: 20, clerkUserId: "refund-list-user", email: "finance@example.test" },
        roles,
      };
      next();
    },
  };
});

import financeRouter from "./finance";
const app = express();
app.use(financeRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));
beforeEach(() => {
  state.calls.length = 0;
  dbMock.query.mockClear();
  state.row.status = "PENDING";
  state.row.evidenceReference = null;
  state.row.reviewerNotes = null;
});

describe("school refund recovery reads", () => {
  it("defaults the school refund queue to pending and returns safe review fields", async () => {
    const response = await fetch(`${baseUrl}/school/finance/refunds?schoolId=1`);
    expect(response.status).toBe(200);
    const rows = await response.json() as Array<Record<string, any>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 101, invoiceNumber: "INV-22", studentName: "Example Student",
      paymentReference: "PAY-11", paymentAmountMinor: 5000, status: "PENDING",
      evidenceReference: null, reviewerNotes: null,
    });
    expect(state.calls[0].values).toEqual([1, "PENDING"]);
    expect(state.calls[0].sql).toContain("p.school_id=fr.school_id");
    expect(state.calls[0].sql).toContain("i.school_id=fr.school_id");
    expect(JSON.stringify(rows)).not.toContain("parentPhone");
  });

  it("supports the all-status filter and school-scoped detail lookup", async () => {
    const all = await fetch(`${baseUrl}/school/finance/refunds?schoolId=1&status=ALL`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "1" },
    });
    expect(all.status).toBe(200);
    expect(state.calls[0].values).toEqual([1, "ALL"]);
    state.row.status = "APPROVED";
    state.row.evidenceReference = "external-credit-22";
    state.row.reviewerNotes = "Confirmed external refund";
    state.row.approvedAt = "2026-09-03T10:00:00.000Z";
    const detail = await fetch(`${baseUrl}/school/finance/refunds/101?schoolId=1`, {
      headers: { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "1" },
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: 101, status: "APPROVED", evidenceReference: "external-credit-22",
      reviewerNotes: "Confirmed external refund",
    });
  });

  it("rejects wrong-school, partner-only, and cross-school mixed role access before querying", async () => {
    const wrongSchool = await fetch(`${baseUrl}/school/finance/refunds?schoolId=1`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "2" },
    });
    const partner = await fetch(`${baseUrl}/school/finance/refunds?schoolId=1`, {
      headers: { "x-test-role": "PARTNER", "x-test-school": "1" },
    });
    const mixed = await fetch(`${baseUrl}/school/finance/refunds?schoolId=1`, {
      headers: { "x-test-assignments": "ACCOUNTANT:2,PARTNER:1" },
    });
    expect(wrongSchool.status).toBe(404);
    expect(partner.status).toBe(404);
    expect(mixed.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
});