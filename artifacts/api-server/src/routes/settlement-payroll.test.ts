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
           status: (req.header("x-test-owner-status") ?? "ACTIVE") as "ACTIVE",
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

describe("contract-first employee payslip reads", () => {
  it("serves an empty list at the generated client's endpoint", async () => {
    const response = await request("/me/payroll/payslips", { "x-test-role": "TEACHER" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].values).toEqual([99, "finance@example.test", null, null]);
  });

  it("ignores caller-supplied identities and binds month filters to the authenticated employee", async () => {
    const response = await request(
      "/me/payroll/payslips?employeeId=123&userId=456&schoolId=8&fromMonth=2026-01&toMonth=2026-10",
      { "x-test-role": "TEACHER" },
    );
    expect(response.status).toBe(200);
    expect(db.queries[0].values).toEqual([99, "finance@example.test", "2026-01", "2026-10"]);
  });

  it("masks another employee's detail at the documented endpoint", async () => {
    const response = await request("/me/payroll/payslips/123", { "x-test-role": "TEACHER" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: "Payslip not found for this authenticated employee" } });
    expect(db.queries[0].values).toEqual([123, 99, "finance@example.test"]);
  });

  it("rejects invalid or reversed month ranges before querying payroll", async () => {
    for (const query of ["fromMonth=2026-13", "fromMonth=2026-10&toMonth=2026-01"]) {
      const response = await request(`/me/payroll/payslips?${query}`, { "x-test-role": "TEACHER" });
      expect(response.status).toBe(400);
    }
    expect(db.queries).toHaveLength(0);
  });

  it("retains the original self-service path as a compatibility alias", async () => {
    const response = await request("/payroll/my/payslips", { "x-test-role": "TEACHER" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("returns the frozen own-payslip response and records a read-only audit", async () => {
    db.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      db.queries.push({ sql, values });
      return { rows: [{
        id: 7, scope: "SCHOOL", school_id: 7, period_month: "2026-10",
        employee_name_snapshot: "Own Teacher", employee_role_snapshot: "TEACHER",
        school_name: "Own school", base_salary_minor: 100000, allowance_minor: 1000,
        bonus_minor: 2000, deduction_minor: 500, adjustment_minor: -100,
        adjustment_reason: "Own adjustment", net_salary_minor: 102400, currency: "NGN",
        account_last4: "1234", provider_reference: "own-reference", provider_transaction_id: "7",
        created_at: new Date("2026-10-01T00:00:00Z"),
      }], rowCount: 1 };
    });
    const auditQuery = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
    db.connect.mockResolvedValue({ query: auditQuery, release: vi.fn() });
    const response = await request("/me/payroll/payslips/7", { "x-test-role": "TEACHER" });
    expect(response.status).toBe(200);
    const slip = await response.json();
    expect(slip).toMatchObject({ id: 7, employeeName: "Own Teacher", netSalaryMinor: 102400, adjustmentReason: "Own adjustment" });
    expect(JSON.stringify(slip)).not.toContain("bank_name_encrypted");
    expect(auditQuery.mock.calls.some(call => String(call[0]).includes("INSERT INTO settlement_payroll_audit_events"))).toBe(true);
  });
});

describe("settlement and payroll router access boundaries", () => {
  it.each(["SCHOOL_ADMIN", "ACCOUNTANT"])("preserves %s access to same-school payroll periods", async (role) => {
    const response = await request("/schools/7/finance/payroll/periods", { "x-test-role": role });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(db.queries.length).toBeGreaterThan(0);
  });

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

  it("preserves directory IDs when school LEFT JOINs have no settlement profile", async () => {
    db.query.mockImplementation(async (sql: string, values: unknown[]) => {
      db.queries.push({ sql, values });
      return { rows: [
        { oversight_school_id: 7, school_name: "School Seven", school_id: null, id: null },
        { oversight_school_id: 8, school_name: "School Eight", school_id: null, id: null },
      ] };
    });
    const response = await request("/platform/finance/payment-settlement/schools?status=all&limit=100", { "x-test-owner": "true" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { schoolId: 7, schoolName: "School Seven", status: "NOT_CONFIGURED", bankName: null, accountLast4: null },
      { schoolId: 8, schoolName: "School Eight", status: "NOT_CONFIGURED", bankName: null, accountLast4: null },
    ]);
    expect(db.queries[0].sql).toContain("s.id AS oversight_school_id");
    expect(db.queries[0].sql).toContain("p.school_id=s.id AND p.scope='SCHOOL'");
    expect(db.queries[0].values).toEqual([null, null, 0, 100]);
  });

  it("keeps configured school recipients masked and bound to their own encryption scope", async () => {
    const profile = (id: number) => {
      const encrypted = (field: string, value: string) => encryptPayrollBankValue(value, `settlement:school:${id}:${field}`);
      const bank = encrypted("bankName", `Bank ${id}`);
      return {
        id: id + 100, oversight_school_id: id, school_id: id, school_name: `School ${id}`,
        business_name: `School ${id}`, bank_name_encrypted: bank.ciphertext,
        bank_code_encrypted: encrypted("bankCode", "001").ciphertext,
        account_name_encrypted: encrypted("accountName", `Recipient ${id}`).ciphertext,
        account_number_encrypted: encrypted("accountNumber", "1234567890").ciphertext,
        account_last4: "7890", encryption_key_version: bank.keyVersion,
        verification_status: "PENDING_VERIFICATION", last_settlement_status: "NOT_SETTLED",
        updated_at: new Date("2026-10-01T00:00:00Z"),
      };
    };
    const rows = [profile(7), profile(8)];
    db.query.mockImplementation(async (sql: string, values: unknown[]) => {
      db.queries.push({ sql, values });
      return { rows: sql.includes("WHERE s.id=$1") ? rows.filter(r => r.school_id === values[0]) : rows };
    });
    const list = await request("/platform/finance/payment-settlement/schools", { "x-test-owner": "true" });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject([
      { schoolId: 7, bankName: "Bank 7", accountName: "Recipient 7", accountLast4: "7890" },
      { schoolId: 8, bankName: "Bank 8", accountName: "Recipient 8", accountLast4: "7890" },
    ]);
    const detail = await request("/platform/finance/payment-settlement/schools/7", { "x-test-owner": "true" });
    expect(detail.status).toBe(200);
    const text = await detail.text();
    expect(JSON.parse(text)).toMatchObject({ schoolId: 7, bankName: "Bank 7" });
    expect(text).not.toContain("Recipient 8");
    expect(text).not.toContain("1234567890");
    expect(text).not.toContain("encrypted");
    expect(db.queries.at(-1)?.values).toEqual([7]);
    // Even an incorrectly supplied row must not decrypt another tenant's
    // bank details using this school's authenticated-data scope.
    db.query.mockResolvedValueOnce({ rows: [rows[1]] });
    const wrongScope = await request("/platform/finance/payment-settlement/schools/7", { "x-test-owner": "true" });
    expect(wrongScope.status).toBe(500);
    expect(await wrongScope.text()).not.toContain("Recipient 8");
  });

  it("returns real empty results and unconfigured detail without disguising query failures", async () => {
    const headers = { "x-test-owner": "true" };
    const empty = await request("/platform/finance/payment-settlement/schools?status=VERIFIED&search=missing&cursor=8&limit=10", headers);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
    expect(db.queries[0].values).toEqual(["VERIFIED", "%missing%", 8, 10]);
    db.query.mockResolvedValueOnce({ rows: [{ oversight_school_id: 7, school_name: "School Seven", school_id: null, id: null }] });
    const detail = await request("/platform/finance/payment-settlement/schools/7", headers);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ schoolId: 7, status: "NOT_CONFIGURED" });
    db.query.mockRejectedValueOnce(new Error("Database failure"));
    const broken = await request("/platform/finance/payment-settlement/schools", headers);
    expect(broken.status).toBe(500);
  });

  it.each(["SCHOOL_ADMIN", "ACCOUNTANT", "TEACHER", "PARENT", "STUDENT", "PARTNER"])(
    "denies %s access to both Owner oversight endpoints before reading finance data",
    async (role) => {
      for (const path of ["/platform/finance/payment-settlement/schools", "/platform/finance/payment-settlement/schools/8"]) {
        const response = await request(path, { "x-test-role": role });
        expect(response.status).toBe(403);
      }
      expect(db.queries).toHaveLength(0);
    },
  );

  it("denies an inactive Owner and does not turn an unknown school into another school's profile", async () => {
    const denied = await request("/platform/finance/payment-settlement/schools", { "x-test-owner": "true", "x-test-owner-status": "INACTIVE" });
    expect(denied.status).toBe(403);
    expect(db.queries).toHaveLength(0);
    const missing = await request("/platform/finance/payment-settlement/schools/9999", { "x-test-owner": "true" });
    expect(missing.status).toBe(404);
    expect(db.queries[0].values).toEqual([9999]);
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