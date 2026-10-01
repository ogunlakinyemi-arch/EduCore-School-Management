import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptPayrollBankValue,
  payrollIdempotencyDigest,
} from "../lib/payroll-bank-encryption";

const db = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => db.query(...args),
    connect: (...args: unknown[]) => db.connect(...args),
  },
}));

vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = String(req.header("x-test-role") ?? "SCHOOL_ADMIN") as any;
      const schoolId = Number(req.header("x-test-school") ?? "7");
      const roles = [{ id: 1, role, schoolId, status: "ACTIVE" as const }];
      if (req.header("x-test-owner") === "true") {
        roles.push({
          id: 2,
          role: "PLATFORM_OWNER" as any,
          schoolId: null as any,
          status: "ACTIVE" as const,
        });
      }
      (req as any).edupulseUser = {
        user: {
          id: 99,
          clerkUserId: "settlement-payroll-test",
          email: "finance@example.test",
          firstName: "Finance",
          lastName: "Tester",
          phone: null,
          status: "ACTIVE",
        },
        roles,
      };
      next();
    },
  };
});

import settlementPayrollRouter from "./settlement-payroll";

const app = express();
app.use(express.json());
app.use(settlementPayrollRouter);
app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  const authError = error as { statusCode?: number; message?: string; eventType?: string };
  res.status(authError.statusCode ?? 500).json({
    error: {
      message: authError.message ?? "Unexpected error",
      code: authError.eventType ?? "INTERNAL_ERROR",
    },
  });
});

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
  db.queries.length = 0;
  db.query.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    db.queries.push({ sql, values });
    return { rows: [], rowCount: 0 };
  });
  db.connect.mockReset();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PAYROLL_TRANSFER_MODE", "");
  vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
  vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY", Buffer.from("a".repeat(64), "hex").toString("base64"));
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY_VERSION", "reload-test-key");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEYS", "");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION", "");
});

afterEach(() => vi.unstubAllEnvs());

async function request(
  path: string,
  headers: Record<string, string> = {},
  init: RequestInit = {},
) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...headers,
      ...init.headers,
    },
  });
}

describe("settlement and payroll router access boundaries", () => {
  it("hides school payroll periods across tenants without issuing a database query", async () => {
    const response = await request("/schools/8/finance/payroll/periods");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "CROSS_TENANT_ACCESS_ATTEMPT" },
    });
    expect(db.queries).toHaveLength(0);
  });

  it("rejects Platform Owner school operations, including mixed-role owners", async () => {
    const response = await request(
      "/schools/7/finance/payroll/periods",
      { "x-test-owner": "true" },
    );
    expect(response.status).toBe(404);
    expect(db.queries).toHaveLength(0);
  });

  it("requires an active Platform Owner for the company-payroll directory", async () => {
    const denied = await request(
      "/platform/finance/company-payroll/employees",
      { "x-test-role": "ACCOUNTANT" },
    );
    expect(denied.status).toBe(403);
    expect(db.queries).toHaveLength(0);

    const allowed = await request(
      "/platform/finance/company-payroll/employees",
      { "x-test-role": "ACCOUNTANT", "x-test-owner": "true" },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual([]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("FROM platform_company_employees");
    expect(db.queries[0].sql).not.toContain("FROM employees e");
  });

  it.each(["SCHOOL_ADMIN", "TEACHER", "PARENT", "PARTNER"])(
    "blocks %s from reading the company settlement profile before querying bank data",
    async (role) => {
      const denied = await request(
        "/platform/finance/payment-settlement",
        { "x-test-role": role },
      );
      expect(denied.status).toBe(403);
      expect(db.queries).toHaveLength(0);
    },
  );

  it("allows an active Platform Owner to read the company settlement profile", async () => {
    const allowed = await request(
      "/platform/finance/payment-settlement",
      { "x-test-role": "SCHOOL_ADMIN", "x-test-owner": "true" },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      scope: "YEMAIT_COMPANY",
      status: "NOT_CONFIGURED",
    });
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("scope='YEMAIT_COMPANY'");
  });

  it("uses exact school_id scoping and validates a payroll period before database writes", async () => {
    const list = await request(
      "/schools/7/finance/payroll/employees?status=all",
      { "x-test-role": "ACCOUNTANT" },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain("e.school_id=$1");
    expect(db.queries[0].values[0]).toBe(7);

    const invalid = await request(
      "/schools/7/finance/payroll/periods",
      { "x-test-role": "ACCOUNTANT" },
      {
        method: "POST",
        body: JSON.stringify({ periodMonth: "2025-99" }),
      },
    );
    expect(invalid.status).toBe(400);
    expect(db.queries).toHaveLength(1);
  });
});

function frozenBank() {
  return {
    bank_name_encrypted: encryptPayrollBankValue(
      "Example Bank",
      "payroll:school:7:employee:21:bankName",
    ).ciphertext,
    bank_code_encrypted: encryptPayrollBankValue(
      "044",
      "payroll:school:7:employee:21:bankCode",
    ).ciphertext,
    account_name_encrypted: encryptPayrollBankValue(
      "Teacher Example",
      "payroll:school:7:employee:21:accountName",
    ).ciphertext,
    account_number_encrypted: encryptPayrollBankValue(
      "1234567890",
      "payroll:school:7:employee:21:accountNumber",
    ).ciphertext,
    account_last4: "7890",
    encryption_key_version: "reload-test-key",
  };
}

function transferAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 51,
    scope: "SCHOOL",
    school_id: 7,
    period_id: 30,
    payroll_item_id: 44,
    employee_id: 21,
    attempt_number: 1,
    provider: "FLUTTERWAVE",
    provider_mode: "TEST",
    provider_reference: "YMTPAY-existing-reference",
    provider_transaction_id: null,
    amount_minor: 6500000,
    currency: "NGN",
    provider_fee_minor: 0,
    settlement_amount_minor: 0,
    status: "RECONCILIATION_REQUIRED",
    requires_reconciliation: true,
    external_transfer_verified: false,
    provider_status: "UNKNOWN",
    failure_message: "Flutterwave acceptance was ambiguous; query the existing reference before retry.",
    created_at: new Date("2025-04-01T09:00:00.000Z"),
    verified_at: null,
    ...overrides,
  };
}

describe("payroll transfer reload and retry continuity", () => {
  it("returns all durable pending/ambiguous provider attempts on a fresh period-detail read", async () => {
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      db.queries.push({ sql, values });
      if (sql.includes("FROM payroll_periods p")) {
        return {
          rows: [{
            periodId: 30,
            scope: "SCHOOL",
            schoolId: 7,
            periodMonth: "2025-03",
            status: "PROCESSING",
            employeeCount: 1,
            grossSalaryMinor: 6500000,
            allowanceMinor: 0,
            bonusMinor: 0,
            deductionMinor: 0,
            adjustmentMinor: 0,
            netSalaryMinor: 6500000,
            paidCount: 0,
            pendingCount: 1,
            failedCount: 0,
            currency: "NGN",
            createdBy: 90,
            submittedBy: 90,
            approvedBy: 91,
            createdAt: new Date("2025-04-01T08:00:00.000Z"),
            submittedAt: new Date("2025-04-01T08:10:00.000Z"),
            approvedAt: new Date("2025-04-01T08:30:00.000Z"),
          }],
        };
      }
      if (sql.includes("FROM payroll_items i") && sql.includes("employee_name_snapshot")) {
        return {
          rows: [{
            item_id: 44,
            period_id: 30,
            period_month: "2025-03",
            employee_name_snapshot: "Teacher Example",
            employee_number_snapshot: "T-021",
            role_snapshot: "TEACHER",
            base_salary_minor: 6500000,
            allowance_minor: 0,
            bonus_minor: 0,
            deduction_minor: 0,
            adjustment_minor: 0,
            adjustment_reason: null,
            net_salary_minor: 6500000,
            currency: "NGN",
            employee_profile_id: 31,
            employee_id: 21,
            school_employee_id: 21,
            employee_no: "T-021",
            first_name: "Teacher",
            last_name: "Example",
            middle_name: null,
            department: "Class Teacher",
            company_employee_id_join: null,
            full_name: null,
            job_title: null,
            ...frozenBank(),
            payment_status: "PENDING",
            transfer_reference: "YMTPAY-pending-reference",
            payslip_id: null,
          }],
        };
      }
      if (sql.includes("FROM payroll_transfers t")) {
        return {
          rows: [transferAttempt({
            provider_reference: "YMTPAY-pending-reference",
            provider_transaction_id: "3921",
            provider_status: "QUEUED",
            status: "PENDING",
            requires_reconciliation: false,
            failure_message: null,
          })],
        };
      }
      throw new Error(`Unexpected payroll period query: ${sql}`);
    });

    const response = await request(
      "/schools/7/finance/payroll/periods/30",
      { "x-test-role": "ACCOUNTANT" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json() as any;
    expect(result.items[0]).toMatchObject({
      employeeId: 21,
      paymentStatus: "PENDING",
      transferReference: "YMTPAY-pending-reference",
      transferAttempts: [{
        id: 51,
        providerReference: "YMTPAY-pending-reference",
        providerTransactionId: "3921",
        status: "PENDING",
        requiresReconciliation: false,
        externalTransferVerified: false,
      }],
    });
    expect(JSON.stringify(result)).not.toContain("1234567890");
    expect(JSON.stringify(result)).not.toContain("account_number_encrypted");
    expect(db.queries.map((query) => query.sql).join("\n")).toContain("ORDER BY t.payroll_item_id,t.attempt_number,t.id");
  });

  it("returns the already-created ambiguous attempt for the same idempotency key without posting a second transfer", async () => {
    const idempotencyKey = "reload-stable-payroll-key";
    const idempotencyHash = payrollIdempotencyDigest(
      `${idempotencyKey}:payroll-item:44`,
    );
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      db.queries.push({ sql, values });
      if (sql.includes("SELECT id,status,approved_by")) {
        return { rows: [{ id: 30, status: "PROCESSING", approved_by: 91 }] };
      }
      if (sql.includes("SELECT i.id AS payroll_item_id")) {
        return {
          rows: [{
            payroll_item_id: 44,
            employee_id: 21,
            latest_transfer_status: "RECONCILIATION_REQUIRED",
            latest_requires_reconciliation: true,
          }],
        };
      }
      if (sql.includes("idempotency_key_hash=ANY")) {
        expect(values[3]).toEqual([idempotencyHash]);
        return { rows: [transferAttempt({ idempotency_key_hash: idempotencyHash })] };
      }
      throw new Error(`Unexpected payroll transfer request: ${sql}`);
    });

    const response = await request(
      "/schools/7/finance/payroll/periods/30/transfers",
      {
        "x-test-role": "ACCOUNTANT",
        "Idempotency-Key": idempotencyKey,
      },
      {
        method: "POST",
        body: JSON.stringify({ employeeIds: [21] }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      periodId: 30,
      providerMode: "TEST",
      total: 1,
      paidCount: 0,
      uncertainCount: 1,
      items: [{
        id: 51,
        providerReference: "YMTPAY-existing-reference",
        status: "RECONCILIATION_REQUIRED",
        requiresReconciliation: true,
        externalTransferVerified: false,
      }],
    });
    expect(db.queries.map((query) => query.sql).join("\n")).not.toContain("INSERT INTO payroll_transfers");
    expect(db.connect).not.toHaveBeenCalled();
  });
});