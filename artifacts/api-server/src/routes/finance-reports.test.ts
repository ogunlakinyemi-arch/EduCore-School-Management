import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: any[] }>,
}));
const dbMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes('"totalBilledMinor"')) {
      return result([{
        totalBilledMinor: "12000", totalCollectedMinor: "7000", totalOutstandingMinor: "5000",
        totalDiscountMinor: "500", totalWaiverMinor: "0", totalRefundedMinor: "1000",
      }]);
    }
    if (sql.includes("SELECT 'TOTAL'::text AS label")) {
      return result([{ label: "TOTAL", count: 3, amountMinor: "12000", secondaryAmountMinor: "5000" }]);
    }
    throw new Error(`Unhandled finance report test query: ${sql}`);
  });
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
});
vi.mock("@workspace/db", () => ({ pool: { connect: dbMock.connect, query: dbMock.query } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      const schoolId = Number(req.header("x-test-school") ?? 5);
      (req as any).edupulseUser = {
        user: { id: 30, clerkUserId: "report-user", email: "report@example.test" },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
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
});

describe("school finance reports", () => {
  it("returns school-filtered aggregate totals and summary rows without student data", async () => {
    const response = await fetch(
      `${baseUrl}/school/finance/reports?schoolId=5&sessionId=7&termId=8&classId=9&reportType=summary`,
      { headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "5" } },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body).toMatchObject({
      schoolId: 5, reportType: "summary", totalBilledMinor: 12000, totalCollectedMinor: 7000,
      totalOutstandingMinor: 5000, totalDiscountMinor: 500, totalWaiverMinor: 0, totalRefundedMinor: 1000,
      rows: [{ label: "TOTAL", count: 3, amountMinor: 12000, secondaryAmountMinor: 5000 }],
    });
    expect(JSON.stringify(body)).not.toContain("studentName");
    expect(state.calls[0].sql).toContain("i.school_id=$1");
    expect(state.calls[0].sql).toContain("i.academic_session_id=$2");
    expect(state.calls[0].sql).toContain("i.academic_term_id=$3");
    expect(state.calls[0].sql).toContain("school_classes");
    expect(state.calls[0].values).toEqual([5, 7, 8, 9]);
  });

  it("does not allow report reads from another school", async () => {
    const response = await fetch(`${baseUrl}/school/finance/reports?schoolId=5`, {
      headers: { "x-test-role": "ACCOUNTANT", "x-test-school": "6" },
    });
    expect(response.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
});