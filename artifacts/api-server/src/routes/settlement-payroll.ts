import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import * as PayrollContract from "@workspace/api-zod";
import { pool } from "@workspace/db";
import {
  assertResourceId,
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  requireAuthentication,
  type Role,
  type UserContext,
} from "../middlewares/auth";
import {
  decryptPayrollBankValue,
  encryptPayrollBankValue,
  getActivePayrollEncryptionKey,
  normalizeResolvedAccountName,
  payrollIdempotencyDigest,
  PayrollEncryptionConfigurationError,
} from "../lib/payroll-bank-encryption";
import {
  configuredPayrollProviderCapability,
  FlutterwavePayrollAmbiguousError,
  FlutterwavePayrollPayrollIntegrityError,
  FlutterwavePayrollUnavailableError,
  FlutterwavePayrollV3Client,
} from "../lib/flutterwave-payroll-v3";

type Scope = "SCHOOL" | "YEMAIT_COMPANY";
type PoolClient = {
  query: (...arguments_: any[]) => Promise<{ rows: AnyRow[]; rowCount: number | null }>;
  release: () => void;
};
type RequestHandler = (req: Request, res: Response) => Promise<unknown>;
type SchemaLike = { parse(value: unknown): unknown; safeParse(value: unknown): {
  success: boolean;
  data?: unknown;
} };
type PayrollSchema<T> = SchemaLike & { parse(value: unknown): T };
type AnyRow = Record<string, unknown>;
type Actor = UserContext["user"];

const router: IRouter = Router();
router.use(requireAuthentication());

const SCHOOL_PAYROLL_ROLES: Role[] = ["SCHOOL_ADMIN", "ACCOUNTANT"];
const SCHOOL_FINANCE_ROLES: Role[] = ["SCHOOL_ADMIN", "ACCOUNTANT"];
const SCHOOL_ADMIN_ROLE: Role[] = ["SCHOOL_ADMIN"];
const flw = new FlutterwavePayrollV3Client();

const SCHOOL_SETTLEMENT_AD = (schoolId: number, field: string) =>
  `settlement:school:${schoolId}:${field}`;
const COMPANY_SETTLEMENT_AD = (field: string) => `settlement:yemait-company:${field}`;
const SCHOOL_SALARY_AD = (schoolId: number, employeeId: number, field: string) =>
  `payroll:school:${schoolId}:employee:${employeeId}:${field}`;
const COMPANY_SALARY_AD = (employeeId: number, field: string) =>
  `payroll:yemait-company:employee:${employeeId}:${field}`;
const EMPTY_COMPANY_NAME = "Yemait Technologies Limited";

function run(handler: RequestHandler) {
  return (req: Request, res: Response, next: (error?: unknown) => void) =>
    void handler(req, res).catch((error: unknown) => next(translateFailure(error)));
}

function translateFailure(error: unknown): unknown {
  if (error instanceof AuthError) return error;
  if (error instanceof PayrollEncryptionConfigurationError) {
    return new AuthError(
      503,
      "Secure bank-information encryption is unavailable; no payroll or settlement information was saved",
      "PAYROLL_ENCRYPTION_UNAVAILABLE",
    );
  }
  if (error instanceof FlutterwavePayrollUnavailableError) {
    return new AuthError(503, error.message, "PAYROLL_PROVIDER_UNAVAILABLE");
  }
  if (error instanceof FlutterwavePayrollAmbiguousError) {
    return new AuthError(503, error.message, "PAYROLL_PROVIDER_RECONCILIATION_REQUIRED");
  }
  if (error instanceof FlutterwavePayrollPayrollIntegrityError) {
    return new AuthError(503, error.message, "PAYROLL_PROVIDER_INTEGRITY_FAILURE");
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    return new AuthError(
      409,
      "A payroll or settlement record with that school, employee, month, or idempotency key already exists",
      "PAYROLL_UNIQUE_CONFLICT",
    );
  }
  return error;
}

function body<S extends SchemaLike>(schema: S, value: unknown, label: string): ReturnType<S["parse"]> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AuthError(400, label, "INVALID_PAYROLL_REQUEST");
  }
  return parsed.data as ReturnType<S["parse"]>;
}

function respond<S extends PayrollSchema<unknown>>(
  res: Response,
  schema: S,
  value: unknown,
  status = 200,
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Payroll response did not satisfy the generated OpenAPI response schema");
  }
  const output = parsed.data as unknown;
  // PayrollPeriod gains a backward-compatible transferAttempts field in its
  // OpenAPI item model. Preserve it for this router during the short interval
  // before api-zod regeneration; once generated, Zod validates and preserves
  // the same field itself. Never copy bank or provider payloads here.
  if (
    output !== null &&
    typeof output === "object" &&
    value !== null &&
    typeof value === "object" &&
    "items" in output &&
    "items" in value &&
    Array.isArray(output.items) &&
    Array.isArray(value.items)
  ) {
    const outputItems = (output as { items: unknown[] }).items;
    const sourceItems = (value as { items: unknown[] }).items;
    outputItems.forEach((item, index) => {
      const sourceItem = sourceItems[index];
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        sourceItem !== null &&
        typeof sourceItem === "object" &&
        !Array.isArray(sourceItem) &&
        "transferAttempts" in sourceItem &&
        !("transferAttempts" in item)
      ) {
        Object.assign(item, {
          transferAttempts: sourceItem.transferAttempts,
        });
      }
    });
  }
  return res.status(status).json(output);
}

function actor(req: Request): Actor {
  return getUserContext(req).user;
}

function requirePlatformOwner(req: Request) {
  const context = getUserContext(req);
  if (!context.roles.some(
    (item) =>
      item.role === "PLATFORM_OWNER" &&
      item.schoolId === null &&
      item.status === "ACTIVE",
  )) {
    throw new AuthError(403, "Active Platform Owner access is required");
  }
  return context;
}

function requireSchoolRole(
  req: Request,
  schoolIdValue: unknown,
  roles: Role[],
) {
  const schoolId = assertResourceId(schoolIdValue, "School");
  return {
    schoolId,
    context: assertSchoolOperationalAccess(req, schoolId, roles),
  };
}

function requireUniqueIds(ids: number[], label: string) {
  if (
    ids.length < 1 ||
    ids.length > 1000 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  ) {
    throw new AuthError(400, `${label} must contain 1–1,000 unique positive employee IDs`);
  }
}

function validateBankInput(input: {
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
}) {
  if (
    input.bankName.trim().length < 2 ||
    input.bankName.trim().length > 100 ||
    input.bankCode.trim().length < 2 ||
    input.bankCode.trim().length > 20 ||
    !/^[A-Za-z0-9_-]+$/.test(input.bankCode.trim()) ||
    input.accountName.trim().length < 2 ||
    input.accountName.trim().length > 150 ||
    !/^[0-9]{10}$/.test(input.accountNumber)
  ) {
    throw new AuthError(400, "Provide a Nigerian bank, supported bank code, account-holder name, and ten-digit account number");
  }
}

function encryptedBankRecord(
  bank: {
    bankName: string;
    bankCode: string;
    accountName: string;
    accountNumber: string;
  },
  associatedData: {
    bankName: string;
    bankCode: string;
    accountName: string;
    accountNumber: string;
  },
) {
  validateBankInput(bank);
  const bankName = encryptPayrollBankValue(bank.bankName, associatedData.bankName);
  const bankCode = encryptPayrollBankValue(bank.bankCode, associatedData.bankCode);
  const accountName = encryptPayrollBankValue(bank.accountName, associatedData.accountName);
  const accountNumber = encryptPayrollBankValue(bank.accountNumber, associatedData.accountNumber);
  if (new Set([
    bankName.keyVersion,
    bankCode.keyVersion,
    accountName.keyVersion,
    accountNumber.keyVersion,
  ]).size !== 1) {
    throw new PayrollEncryptionConfigurationError(
      "Payroll bank-encryption key version changed during a bank-information operation",
    );
  }
  return {
    bankNameEncrypted: bankName.ciphertext,
    bankCodeEncrypted: bankCode.ciphertext,
    accountNameEncrypted: accountName.ciphertext,
    accountNumberEncrypted: accountNumber.ciphertext,
    accountLast4: bank.accountNumber.slice(-4),
    encryptionKeyVersion: accountNumber.keyVersion,
  };
}

function decryptBankRecord(
  row: AnyRow,
  associatedData: {
    bankName: string;
    bankCode: string;
    accountName: string;
    accountNumber: string;
  },
) {
  const version = String(row.encryption_key_version);
  return {
    bankName: decryptPayrollBankValue(
      String(row.bank_name_encrypted),
      version,
      associatedData.bankName,
    ),
    bankCode: decryptPayrollBankValue(
      String(row.bank_code_encrypted),
      version,
      associatedData.bankCode,
    ),
    accountName: decryptPayrollBankValue(
      String(row.account_name_encrypted),
      version,
      associatedData.accountName,
    ),
    accountNumber: decryptPayrollBankValue(
      String(row.account_number_encrypted),
      version,
      associatedData.accountNumber,
    ),
  };
}

function maskedAccount(last4: unknown): string | null {
  const digits = typeof last4 === "string" ? last4 : "";
  return /^[0-9]{4}$/.test(digits) ? `******${digits}` : null;
}

function providerModeForResponse(): "TEST" | "LIVE" | "MOCK" | "NOT_CONFIGURED" {
  return configuredPayrollProviderCapability().mode;
}

function providerSafeMetadata(
  providerStatus: unknown,
  amountMinor: number,
): Record<string, unknown> {
  const status =
    typeof providerStatus === "string" && /^[A-Za-z_ -]{1,40}$/.test(providerStatus)
      ? providerStatus.toUpperCase()
      : "UNKNOWN";
  return { providerStatus: status, amountMinor };
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

interface AuditInput {
  actor: Actor;
  actorRole: string;
  scope: Scope | "PLATFORM";
  schoolId: number | null;
  recordType:
    | "SETTLEMENT_PROFILE"
    | "PAYROLL_PROFILE"
    | "PAYROLL_PERIOD"
    | "PAYROLL_ITEM"
    | "PAYROLL_TRANSFER"
    | "PAYSLIP";
  recordId: number | null;
  action: string;
  amountMinor?: number | null;
  providerReference?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  metadata?: Record<string, unknown>;
}

async function audit(client: PoolClient, input: AuditInput) {
  const metadata = input.metadata ?? {};
  // The structured audit whitelist cannot hold an account number/name, bank
  // ciphertext, access token, customer/employee bank details, or raw provider
  // body. Bank-account suffixes are the only permitted bank-field projections.
  await client.query(
    `INSERT INTO settlement_payroll_audit_events
      (scope,school_id,actor_user_id,actor_role,record_type,record_id,action,
       amount_minor,currency,provider_reference,previous_status,new_status,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      input.scope,
      input.schoolId,
      input.actor.id,
      input.actorRole,
      input.recordType,
      input.recordId,
      input.action,
      input.amountMinor ?? null,
      input.amountMinor == null ? null : "NGN",
      input.providerReference ?? null,
      input.previousStatus ?? null,
      input.newStatus ?? null,
      JSON.stringify(metadata),
    ],
  );
  const displayName = [input.actor.firstName, input.actor.lastName].filter(Boolean).join(" ")
    || input.actor.email;
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,severity,
       event_type,result,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Finance','high',$7,'SUCCESS',$8::jsonb)`,
    [
      displayName,
      input.actorRole,
      input.actor.id,
      input.actor.clerkUserId,
      input.schoolId,
      `Payroll/settlement ${input.action.toLowerCase().replaceAll("_", " ")}`,
      input.recordType,
      JSON.stringify({
        scope: input.scope,
        recordType: input.recordType,
        recordId: input.recordId,
        statusBefore: input.previousStatus ?? null,
        statusAfter: input.newStatus ?? null,
        ...(input.providerReference ? { providerReference: input.providerReference } : {}),
        ...metadata,
      }),
    ],
  );
}

function settlementCapability() {
  return flw.capability();
}

function settlementProfileProjection(row: AnyRow | undefined, scope: "SCHOOL" | "YEMAIT_COMPANY", schoolId?: number) {
  const company = scope === "YEMAIT_COMPANY";
  if (!row) {
    return company
      ? {
          scope,
          businessName: EMPTY_COMPANY_NAME,
          businessRegistrationNumber: null,
          settlementContactEmail: null,
          settlementContactPhone: null,
          bankName: null,
          bankCode: null,
          accountName: null,
          accountLast4: null,
          currency: "NGN",
          status: "NOT_CONFIGURED",
          provider: "FLUTTERWAVE",
          providerBusinessId: process.env.FLUTTERWAVE_BUSINESS_ID ?? null,
          providerSubaccountId: null,
          capability: settlementCapability(),
          updatedAt: null,
        }
      : {
          schoolId,
          businessName: null,
          businessRegistrationNumber: null,
          settlementContactEmail: null,
          settlementContactPhone: null,
          bankName: null,
          bankCode: null,
          accountName: null,
          accountLast4: null,
          currency: "NGN",
          status: "NOT_CONFIGURED",
          provider: "FLUTTERWAVE",
          providerSubaccountId: null,
          capability: settlementCapability(),
          lastSettlementAt: null,
          lastSettlementStatus: "NOT_SETTLED",
          updatedAt: null,
        };
  }
  return {
    ...(company ? { scope } : { schoolId }),
    businessName: row.business_name,
    businessRegistrationNumber: row.business_registration_number ?? null,
    settlementContactEmail: row.settlement_contact_email ?? null,
    settlementContactPhone: row.settlement_contact_phone ?? null,
    bankName: decryptPayrollBankValue(
      String(row.bank_name_encrypted),
      String(row.encryption_key_version),
      company ? COMPANY_SETTLEMENT_AD("bankName") : SCHOOL_SETTLEMENT_AD(schoolId as number, "bankName"),
    ),
    bankCode: decryptPayrollBankValue(
      String(row.bank_code_encrypted),
      String(row.encryption_key_version),
      company ? COMPANY_SETTLEMENT_AD("bankCode") : SCHOOL_SETTLEMENT_AD(schoolId as number, "bankCode"),
    ),
    accountName: decryptPayrollBankValue(
      String(row.account_name_encrypted),
      String(row.encryption_key_version),
      company ? COMPANY_SETTLEMENT_AD("accountName") : SCHOOL_SETTLEMENT_AD(schoolId as number, "accountName"),
    ),
    accountLast4: row.account_last4,
    currency: "NGN",
    status: row.verification_status,
    provider: "FLUTTERWAVE",
    ...(company
      ? { providerBusinessId: row.provider_business_id ?? process.env.FLUTTERWAVE_BUSINESS_ID ?? null }
      : {}),
    providerSubaccountId: row.provider_subaccount_id ?? null,
    capability: settlementCapability(),
    ...(company
      ? {}
      : {
          lastSettlementAt: null,
          lastSettlementStatus: "NOT_SETTLED",
        }),
    updatedAt: row.updated_at,
  };
}

function poolRows(result: { rows: AnyRow[] }) {
  return result.rows;
}

function resolveBoundaryText(value: unknown, label: string, maximum = 160) {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > maximum) {
    throw new AuthError(400, `${label} is invalid`);
  }
  return value.trim();
}

function parseSettlementHistoryQueryDates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const query = { ...(value as Record<string, unknown>) };
  for (const name of ["from", "to"] as const) {
    const raw = query[name];
    if (typeof raw === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) {
      const date = new Date(`${raw}T00:00:00.000Z`);
      if (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === raw
      ) {
        query[name] = date;
      }
    }
  }
  return query;
}

function parseOptionalDateRange(from: unknown, to: unknown) {
  if (from != null && !(
    (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)) ||
    (typeof from === "object" && from !== null && from instanceof Date && Number.isFinite(from.getTime()))
  )) {
    throw new AuthError(400, "The start date must use YYYY-MM-DD format");
  }
  if (to != null && !(
    (typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to)) ||
    (typeof to === "object" && to !== null && to instanceof Date && Number.isFinite(to.getTime()))
  )) {
    throw new AuthError(400, "The end date must use YYYY-MM-DD format");
  }
  const fromText = typeof from === "object" && from !== null && from instanceof Date
    ? from.toISOString().slice(0, 10)
    : from;
  const toText = typeof to === "object" && to !== null && to instanceof Date
    ? to.toISOString().slice(0, 10)
    : to;
  if (typeof fromText === "string" && typeof toText === "string" && fromText > toText) {
    throw new AuthError(400, "The start date must not be after the end date");
  }
  if (
    (typeof from === "object" && from !== null && from instanceof Date && !Number.isFinite(from.getTime())) ||
    (typeof to === "object" && to !== null && to instanceof Date && !Number.isFinite(to.getTime()))
  ) {
    throw new AuthError(400, "Settlement-history dates must be valid calendar dates");
  }
  return {
    from: (from ?? null) as Date | string | null,
    to: (to ?? null) as Date | string | null,
  };
}

function parsePayrollMonthRange(fromMonth: unknown, toMonth: unknown) {
  const matchesMonth = (value: unknown) =>
    typeof value === "string" && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
  if (
    typeof fromMonth !== "string" ||
    typeof toMonth !== "string" ||
    !matchesMonth(fromMonth) ||
    !matchesMonth(toMonth) ||
    fromMonth > toMonth
  ) {
    throw new AuthError(400, "Provide a valid fromMonth and toMonth in ascending YYYY-MM order");
  }
  return { fromMonth, toMonth };
}

// ---------------------------------------------------------------------------
// Settlement profiles and provider-backed account ownership verification.
// Entering or resolving a bank account never generates collection splits,
// returns a transfer recipient ID, or asserts actual monetary settlement.
// ---------------------------------------------------------------------------

router.get("/platform/finance/payment-settlement", run(async (req, res) => {
  requirePlatformOwner(req);
  const response = poolRows(await pool.query(
    `SELECT * FROM settlement_payroll_profiles WHERE scope='YEMAIT_COMPANY'`,
  ))[0];
  return respond(
    res,
    PayrollContract.GetPlatformPaymentSettlementResponse,
    settlementProfileProjection(response, "YEMAIT_COMPANY"),
  );
}));

router.put("/platform/finance/payment-settlement", run(async (req, res) => {
  const context = requirePlatformOwner(req);
  const input = body(
    PayrollContract.UpdatePlatformPaymentSettlementBody,
    req.body,
    "Invalid company settlement bank information",
  );
  validateBankInput(input);
  const bank = encryptedBankRecord(input, {
    bankName: COMPANY_SETTLEMENT_AD("bankName"),
    bankCode: COMPANY_SETTLEMENT_AD("bankCode"),
    accountName: COMPANY_SETTLEMENT_AD("accountName"),
    accountNumber: COMPANY_SETTLEMENT_AD("accountNumber"),
  });
  const capability = settlementCapability();
  const saved = await withTransaction(async (client) => {
    const old = poolRows(await client.query(
      `SELECT id, verification_status FROM settlement_payroll_profiles
       WHERE scope='YEMAIT_COMPANY' FOR UPDATE`,
    ))[0];
    const result = await client.query(
      `INSERT INTO settlement_payroll_profiles (
         scope,school_id,business_name,business_registration_number,settlement_contact_email,
         settlement_contact_phone,bank_name_encrypted,bank_code_encrypted,
         account_name_encrypted,account_number_encrypted,account_last4,
         encryption_key_version,currency,provider,provider_business_id,
         provider_subaccount_id,verification_status,verified_at,verified_by,
         created_by,updated_by,updated_at
       ) VALUES ('YEMAIT_COMPANY',NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NGN',
         'FLUTTERWAVE',$11,NULL,'PENDING_VERIFICATION',NULL,NULL,$12,$12,NOW())
       ON CONFLICT (scope) WHERE scope='YEMAIT_COMPANY'
       DO UPDATE SET business_name=EXCLUDED.business_name,
         business_registration_number=EXCLUDED.business_registration_number,
         settlement_contact_email=EXCLUDED.settlement_contact_email,
         settlement_contact_phone=EXCLUDED.settlement_contact_phone,
         bank_name_encrypted=EXCLUDED.bank_name_encrypted,
         bank_code_encrypted=EXCLUDED.bank_code_encrypted,
         account_name_encrypted=EXCLUDED.account_name_encrypted,
         account_number_encrypted=EXCLUDED.account_number_encrypted,
         account_last4=EXCLUDED.account_last4,
         encryption_key_version=EXCLUDED.encryption_key_version,
         provider_business_id=EXCLUDED.provider_business_id,
         provider_subaccount_id=NULL,verification_status='PENDING_VERIFICATION',
         verified_at=NULL,verified_by=NULL,updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING *`,
      [
        resolveBoundaryText(input.businessName, "Company name"),
        input.businessRegistrationNumber ?? null,
        input.settlementContactEmail ?? context.user.email,
        input.settlementContactPhone ?? null,
        bank.bankNameEncrypted,
        bank.bankCodeEncrypted,
        bank.accountNameEncrypted,
        bank.accountNumberEncrypted,
        bank.accountLast4,
        bank.encryptionKeyVersion,
        process.env.FLUTTERWAVE_BUSINESS_ID ?? null,
        context.user.id,
      ],
    );
    const row = poolRows(result)[0];
    await audit(client, {
      actor: context.user,
      actorRole: "PLATFORM_OWNER",
      scope: "PLATFORM",
      schoolId: null,
      recordType: "SETTLEMENT_PROFILE",
      recordId: row.id as number,
      action: "COMPANY_SETTLEMENT_PROFILE_UPDATED",
      previousStatus: old?.verification_status as string | null ?? null,
      newStatus: "PENDING_VERIFICATION",
      metadata: {
        accountLast4: bank.accountLast4,
        encryptionKeyVersion: bank.encryptionKeyVersion,
        providerMode: capability.mode,
        externalSettlementVerified: false,
      },
    });
    return row;
  });
  return respond(
    res,
    PayrollContract.UpdatePlatformPaymentSettlementResponse,
    settlementProfileProjection(saved, "YEMAIT_COMPANY"),
  );
}));

async function schoolSettlementProjection(schoolId: number) {
  const result = await pool.query(
    `SELECT s.id AS oversight_school_id,s.name AS school_name,p.*
     FROM schools s
     LEFT JOIN settlement_payroll_profiles p
       ON p.school_id=s.id AND p.scope='SCHOOL'
     WHERE s.id=$1`,
    [schoolId],
  );
  const row = poolRows(result)[0];
  if (!row) throw new AuthError(404, "School not found");
  const settled = settlementProfileProjection(row.id ? row : undefined, "SCHOOL", schoolId) as AnyRow;
  return { schoolName: row.school_name, ...settled };
}

router.get("/platform/finance/payment-settlement/schools", run(async (req, res) => {
  requirePlatformOwner(req);
  const query = body(
    PayrollContract.ListPlatformSchoolSettlementsQueryParams,
    req.query,
    "Invalid school-settlement filter",
  );
  const status = query.status === "all" ? null : query.status;
  const limit = query.limit;
  const cursor = query.cursor;
  const search = query.search ? `%${query.search.replace(/[%_]/g, "\\$&")}%` : null;
  const result = await pool.query(
    // p.* contains a nullable school_id. Never let it overwrite the school
    // directory's identity when the LEFT JOIN has no configured profile.
    `SELECT s.id AS oversight_school_id,s.name AS school_name,p.*
     FROM schools s
     LEFT JOIN settlement_payroll_profiles p
       ON p.school_id=s.id AND p.scope='SCHOOL'
     WHERE ($1::text IS NULL OR COALESCE(p.verification_status,'NOT_CONFIGURED')=$1)
       AND ($2::text IS NULL OR s.name ILIKE $2 OR s.code ILIKE $2)
       AND s.id>$3
     ORDER BY s.id LIMIT $4`,
    [status, search, cursor, limit],
  );
  const records = poolRows(result).map((row) => {
    const projection = settlementProfileProjection(row.id ? row : undefined, "SCHOOL", row.oversight_school_id as number) as AnyRow;
    return { schoolName: row.school_name, ...projection };
  });
  return respond(res, PayrollContract.ListPlatformSchoolSettlementsResponse, records);
}));

router.get("/platform/finance/payment-settlement/schools/:schoolId", run(async (req, res) => {
  requirePlatformOwner(req);
  const schoolId = assertResourceId(req.params.schoolId, "School");
  const result = await schoolSettlementProjection(schoolId);
  return respond(res, PayrollContract.GetPlatformSchoolSettlementResponse, result);
}));

async function verifySettlementBankAccount(input: {
  row: AnyRow;
  scope: "SCHOOL" | "YEMAIT_COMPANY";
  schoolId?: number;
  actor: Actor;
  actorRole: string;
  accountResolutionIdempotencyKey?: string;
}) {
  const encryptionContext = input.scope === "SCHOOL"
    ? {
        bankName: SCHOOL_SETTLEMENT_AD(input.schoolId as number, "bankName"),
        bankCode: SCHOOL_SETTLEMENT_AD(input.schoolId as number, "bankCode"),
        accountName: SCHOOL_SETTLEMENT_AD(input.schoolId as number, "accountName"),
        accountNumber: SCHOOL_SETTLEMENT_AD(input.schoolId as number, "accountNumber"),
      }
    : {
        bankName: COMPANY_SETTLEMENT_AD("bankName"),
        bankCode: COMPANY_SETTLEMENT_AD("bankCode"),
        accountName: COMPANY_SETTLEMENT_AD("accountName"),
        accountNumber: COMPANY_SETTLEMENT_AD("accountNumber"),
      };
  const bank = decryptBankRecord(input.row, encryptionContext);
  const resolved = await flw.resolveNigerianAccount({
    bankCode: bank.bankCode,
    accountNumber: bank.accountNumber,
  });
  const matchedName = normalizeResolvedAccountName(bank.accountName) ===
    normalizeResolvedAccountName(resolved.resolvedAccountName);
  if (!matchedName) {
    await withTransaction(async (client) => {
      const tableId = input.row.id as number;
      const updated = await client.query(
        `UPDATE settlement_payroll_profiles
         SET verification_status='ACTION_REQUIRED',verified_at=NULL,verified_by=NULL,
             updated_by=$1,updated_at=NOW()
         WHERE id=$2 AND scope=$3 AND ${input.scope === "SCHOOL" ? "school_id=$4" : "school_id IS NULL"}
         RETURNING id`,
        input.scope === "SCHOOL"
          ? [input.actor.id, tableId, input.scope, input.schoolId]
          : [input.actor.id, tableId, input.scope],
      );
      if (!updated.rows[0]) throw new AuthError(404, "Settlement profile not found");
      await audit(client, {
        actor: input.actor,
        actorRole: input.actorRole,
        scope: input.scope === "SCHOOL" ? "SCHOOL" : "PLATFORM",
        schoolId: input.schoolId ?? null,
        recordType: "SETTLEMENT_PROFILE",
        recordId: tableId,
        action: "SETTLEMENT_ACCOUNT_NAME_MISMATCH",
        previousStatus: "PENDING_VERIFICATION",
        newStatus: "ACTION_REQUIRED",
        metadata: {
          accountLast4: input.row.account_last4,
          providerMode: flw.capability().mode,
          ...(input.accountResolutionIdempotencyKey
            ? { verificationKeyDigest: payrollIdempotencyDigest(input.accountResolutionIdempotencyKey) }
            : {}),
          providerAccountNameMatched: false,
        },
      });
    });
    throw new AuthError(
      409,
      "The name returned by Flutterwave does not match the configured account holder; no settlement recipient was verified",
      "SETTLEMENT_BENEFICIARY_MISMATCH",
    );
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE settlement_payroll_profiles
       SET verification_status='VERIFIED',verified_at=NOW(),verified_by=$1,
           provider_business_id=$2,updated_by=$1,updated_at=NOW()
       WHERE id=$3 AND scope=$4 AND ${input.scope === "SCHOOL" ? "school_id=$5" : "school_id IS NULL"}
         AND verification_status IN ('PENDING_VERIFICATION','ACTION_REQUIRED')
         AND account_last4=$6
       RETURNING *`,
      input.scope === "SCHOOL"
        ? [
            input.actor.id,
            process.env.FLUTTERWAVE_BUSINESS_ID ?? null,
            input.row.id,
            input.scope,
            input.schoolId,
            input.row.account_last4,
          ]
        : [
            input.actor.id,
            process.env.FLUTTERWAVE_BUSINESS_ID ?? null,
            input.row.id,
            input.scope,
            input.row.account_last4,
          ],
    );
    const row = poolRows(result)[0];
    if (!row) {
      throw new AuthError(409, "Settlement bank details changed during verification; reload and retry explicitly");
    }
    await audit(client, {
      actor: input.actor,
      actorRole: input.actorRole,
      scope: input.scope === "SCHOOL" ? "SCHOOL" : "PLATFORM",
      schoolId: input.schoolId ?? null,
      recordType: "SETTLEMENT_PROFILE",
      recordId: row.id as number,
      action: "FLUTTERWAVE_BANK_ACCOUNT_RESOLVED",
      previousStatus: String(input.row.verification_status),
      newStatus: "VERIFIED",
      metadata: {
        accountLast4: row.account_last4,
        providerMode: flw.capability().mode,
        accountNameMatched: true,
        subaccountCreated: false,
        settlementPerformed: false,
        ...(input.accountResolutionIdempotencyKey
          ? { verificationKeyDigest: payrollIdempotencyDigest(input.accountResolutionIdempotencyKey) }
          : {}),
      },
    });
    return row;
  });
}

router.post("/platform/finance/payment-settlement/schools/:schoolId", run(async (req, res) => {
  const context = requirePlatformOwner(req);
  const schoolId = assertResourceId(req.params.schoolId, "School");
  const keyInput = body(
    PayrollContract.VerifyPlatformSchoolSettlementHeader,
    { "Idempotency-Key": req.header("Idempotency-Key") },
    "An explicit settlement-verification idempotency key is required",
  );
  const existing = poolRows(await pool.query(
    `SELECT * FROM settlement_payroll_profiles
     WHERE scope='SCHOOL' AND school_id=$1`,
    [schoolId],
  ))[0];
  if (!existing) throw new AuthError(404, "School settlement bank details are not configured");
  const row = await verifySettlementBankAccount({
    row: existing,
    scope: "SCHOOL",
    schoolId,
    actor: context.user,
    actorRole: "PLATFORM_OWNER",
    accountResolutionIdempotencyKey: keyInput["Idempotency-Key"],
  });
  return respond(
    res,
    PayrollContract.VerifyPlatformSchoolSettlementResponse,
    await schoolSettlementProjection(schoolId).then((value) => ({
      ...value,
      status: row.verification_status,
      updatedAt: row.updated_at,
    })),
  );
}));

router.get("/schools/:schoolId/finance/payment-settlement", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_ADMIN_ROLE);
  const response = await schoolSettlementProjection(schoolId);
  return respond(res, PayrollContract.GetSchoolPaymentSettlementResponse, response);
}));

router.put("/schools/:schoolId/finance/payment-settlement", run(async (req, res) => {
  const { schoolId, context } = requireSchoolRole(
    req,
    req.params.schoolId,
    SCHOOL_ADMIN_ROLE,
  );
  const input = body(
    PayrollContract.UpdateSchoolPaymentSettlementBody,
    req.body,
    "Invalid school settlement bank information",
  );
  validateBankInput(input);
  getActivePayrollEncryptionKey();
  const bank = encryptedBankRecord(input, {
    bankName: SCHOOL_SETTLEMENT_AD(schoolId, "bankName"),
    bankCode: SCHOOL_SETTLEMENT_AD(schoolId, "bankCode"),
    accountName: SCHOOL_SETTLEMENT_AD(schoolId, "accountName"),
    accountNumber: SCHOOL_SETTLEMENT_AD(schoolId, "accountNumber"),
  });
  const saved = await withTransaction(async (client) => {
    const existing = poolRows(await client.query(
      `SELECT id,verification_status FROM settlement_payroll_profiles
       WHERE scope='SCHOOL' AND school_id=$1 FOR UPDATE`,
      [schoolId],
    ))[0];
    const result = await client.query(
      `INSERT INTO settlement_payroll_profiles (
         scope,school_id,business_name,business_registration_number,
         settlement_contact_email,settlement_contact_phone,
         bank_name_encrypted,bank_code_encrypted,account_name_encrypted,
         account_number_encrypted,account_last4,encryption_key_version,currency,
         provider,provider_business_id,provider_subaccount_id,
         verification_status,verified_at,verified_by,created_by,updated_by,updated_at
       ) VALUES ('SCHOOL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'NGN',
         'FLUTTERWAVE',NULL,NULL,'PENDING_VERIFICATION',NULL,NULL,$12,$12,NOW())
       ON CONFLICT (school_id) WHERE scope='SCHOOL'
       DO UPDATE SET business_name=EXCLUDED.business_name,
         business_registration_number=EXCLUDED.business_registration_number,
         settlement_contact_email=EXCLUDED.settlement_contact_email,
         settlement_contact_phone=EXCLUDED.settlement_contact_phone,
         bank_name_encrypted=EXCLUDED.bank_name_encrypted,
         bank_code_encrypted=EXCLUDED.bank_code_encrypted,
         account_name_encrypted=EXCLUDED.account_name_encrypted,
         account_number_encrypted=EXCLUDED.account_number_encrypted,
         account_last4=EXCLUDED.account_last4,
         encryption_key_version=EXCLUDED.encryption_key_version,
         provider_business_id=NULL,provider_subaccount_id=NULL,
         verification_status='PENDING_VERIFICATION',verified_at=NULL,verified_by=NULL,
         updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING *`,
      [
        schoolId,
        resolveBoundaryText(input.businessName, "School name"),
        input.businessRegistrationNumber ?? null,
        input.settlementContactEmail,
        input.settlementContactPhone ?? null,
        bank.bankNameEncrypted,
        bank.bankCodeEncrypted,
        bank.accountNameEncrypted,
        bank.accountNumberEncrypted,
        bank.accountLast4,
        bank.encryptionKeyVersion,
        context.user.id,
      ],
    );
    const row = poolRows(result)[0];
    await audit(client, {
      actor: context.user,
      actorRole: "SCHOOL_ADMIN",
      scope: "SCHOOL",
      schoolId,
      recordType: "SETTLEMENT_PROFILE",
      recordId: row.id as number,
      action: "SCHOOL_SETTLEMENT_PROFILE_UPDATED",
      previousStatus: existing?.verification_status as string | null ?? null,
      newStatus: "PENDING_VERIFICATION",
      metadata: {
        accountLast4: bank.accountLast4,
        encryptionKeyVersion: bank.encryptionKeyVersion,
        providerMode: settlementCapability().mode,
        externalSettlementVerified: false,
      },
    });
    return row;
  });
  const projection = settlementProfileProjection(saved, "SCHOOL", schoolId);
  return respond(
    res,
    PayrollContract.UpdateSchoolPaymentSettlementResponse,
    { schoolName: input.businessName, ...projection },
  );
}));

router.get("/schools/:schoolId/finance/payment-settlement/history", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(
    req,
    req.params.schoolId,
    SCHOOL_FINANCE_ROLES,
  );
  const query = body(
    PayrollContract.ListSchoolSettlementHistoryQueryParams,
    parseSettlementHistoryQueryDates(req.query),
    "Invalid settlement-history filter",
  );
  const { from, to } = parseOptionalDateRange(query.from, query.to);
  const result = await settlementHistory({
    scope: "SCHOOL",
    schoolId,
    filters: {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: query.limit,
      cursor: query.cursor,
    },
  });
  return respond(res, PayrollContract.ListSchoolSettlementHistoryResponse, result);
}));

router.get("/platform/finance/payment-settlement/history", run(async (req, res) => {
  requirePlatformOwner(req);
  const query = body(
    PayrollContract.ListPlatformSettlementHistoryQueryParams,
    parseSettlementHistoryQueryDates(req.query),
    "Invalid settlement-history filter",
  );
  const { from, to } = parseOptionalDateRange(query.from, query.to);
  const status = query.status ?? null;
  const schoolId = query.schoolId ?? null;
  const result = await settlementHistory({
    scope: "PLATFORM",
    schoolId: schoolId as number | null,
    filters: {
      schoolId: schoolId as number | null,
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: query.limit,
      cursor: query.cursor,
    },
  });
  return respond(res, PayrollContract.ListPlatformSettlementHistoryResponse, result);
}));

// ---------------------------------------------------------------------------
// Tenant-owned compensation profiles. School records and Company directory
// entries are read and written in disjoint queries and distinct tenant scopes.
// ---------------------------------------------------------------------------

function payrollBankAAD(scope: Scope, schoolId: number | null, employeeId: number) {
  return scope === "SCHOOL"
    ? {
        bankName: SCHOOL_SALARY_AD(schoolId as number, employeeId, "bankName"),
        bankCode: SCHOOL_SALARY_AD(schoolId as number, employeeId, "bankCode"),
        accountName: SCHOOL_SALARY_AD(schoolId as number, employeeId, "accountName"),
        accountNumber: SCHOOL_SALARY_AD(schoolId as number, employeeId, "accountNumber"),
      }
    : {
        bankName: COMPANY_SALARY_AD(employeeId, "bankName"),
        bankCode: COMPANY_SALARY_AD(employeeId, "bankCode"),
        accountName: COMPANY_SALARY_AD(employeeId, "accountName"),
        accountNumber: COMPANY_SALARY_AD(employeeId, "accountNumber"),
      };
}

function displayPayrollProfile(row: AnyRow, scope: Scope, schoolId: number | null) {
  const employeeId = Number(
    scope === "SCHOOL" ? row.employee_id : row.company_employee_id,
  );
  const bank = decryptBankRecord(row, payrollBankAAD(scope, schoolId, employeeId));
  return {
    employeeId,
    companyEmployeeId: scope === "YEMAIT_COMPANY" ? employeeId : null,
    employeeType: scope === "SCHOOL" ? row.employee_type : "COMPANY_EMPLOYEE",
    employeeNumber: scope === "SCHOOL" ? row.employee_no ?? null : null,
    fullName: scope === "SCHOOL"
      ? [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(" ")
      : row.full_name,
    email: row.email ?? null,
    jobTitle: scope === "SCHOOL" ? row.department ?? null : row.job_title ?? null,
    status: row.profile_status ?? row.employee_status ?? row.status ?? "ACTIVE",
    monthlySalaryMinor: Number(row.monthly_salary_minor),
    allowanceMinor: Number(row.allowance_minor),
    deductionMinor: Number(row.deduction_minor),
    currency: "NGN",
    bankConfigured: true,
    bankName: bank.bankName,
    bankCode: bank.bankCode,
    accountName: bank.accountName,
    maskedAccountNumber: maskedAccount(row.account_last4),
    encryptionKeyVersion: row.encryption_key_version,
    updatedAt: row.updated_at,
  };
}

function schoolPayrollEmployeeRowsQuery(search: string | null, status: string | null, schoolId: number) {
  return pool.query(
    `SELECT e.id AS employee_id,e.employee_no,e.first_name,e.middle_name,e.last_name,
       e.email,e.department,e.employee_type,e.employment_status AS employee_status,
       pp.id,pp.monthly_salary_minor,pp.allowance_minor,pp.deduction_minor,pp.currency,
       pp.bank_name_encrypted,pp.bank_code_encrypted,pp.account_name_encrypted,
       pp.account_number_encrypted,pp.account_last4,pp.encryption_key_version,
       pp.status AS profile_status,pp.updated_at
     FROM employees e
     JOIN payroll_employee_profiles pp ON pp.scope='SCHOOL'
       AND pp.employee_id=e.id AND pp.school_id=e.school_id
     WHERE e.school_id=$1 AND e.employee_type IN ('TEACHER','STAFF')
       AND ($2::text IS NULL OR concat_ws(' ',e.first_name,e.middle_name,e.last_name) ILIKE $2
            OR e.employee_no ILIKE $2 OR e.email ILIKE $2)
       AND ($3::text='all' OR (CASE WHEN e.employment_status='ACTIVE' AND pp.status='ACTIVE'
                                  THEN 'ACTIVE' ELSE 'INACTIVE' END)=$3)
     ORDER BY e.last_name,e.first_name,e.id`,
    [schoolId, search ? `%${search.replace(/[%_]/g, "\\$&")}%` : null, status],
  );
}

router.get("/schools/:schoolId/finance/payroll/employees", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(
    req,
    req.params.schoolId,
    SCHOOL_PAYROLL_ROLES,
  );
  const query = body(
    PayrollContract.ListSchoolPayrollEmployeesQueryParams,
    req.query,
    "Invalid school payroll-employee filter",
  );
  const result = await schoolPayrollEmployeeRowsQuery(
    query.search ?? null,
    query.status,
    schoolId,
  );
  const records = poolRows(result).map((row) => displayPayrollProfile(row, "SCHOOL", schoolId));
  return respond(res, PayrollContract.ListSchoolPayrollEmployeesResponse, records);
}));

router.put("/schools/:schoolId/finance/payroll/employees", run(async (req, res) => {
  const { schoolId, context } = requireSchoolRole(
    req,
    req.params.schoolId,
    SCHOOL_PAYROLL_ROLES,
  );
  const input = body(
    PayrollContract.UpdateSchoolPayrollEmployeeBody,
    req.body,
    "Invalid school employee salary or bank information",
  );
  getActivePayrollEncryptionKey();
  if (
    !Number.isSafeInteger(input.monthlySalaryMinor) ||
    !Number.isSafeInteger(input.allowanceMinor) ||
    !Number.isSafeInteger(input.deductionMinor) ||
    input.monthlySalaryMinor < 0 ||
    input.allowanceMinor < 0 ||
    input.deductionMinor < 0 ||
    input.deductionMinor > input.monthlySalaryMinor + input.allowanceMinor
  ) {
    throw new AuthError(400, "Salary and allowance must be valid NGN minor-unit amounts with a nonnegative net salary");
  }
  validateBankInput(input);
  const aad = payrollBankAAD("SCHOOL", schoolId, input.employeeId);
  const bank = encryptedBankRecord(input, aad);
  const saved = await withTransaction(async (client) => {
    const employee = poolRows(await client.query(
      `SELECT id FROM employees WHERE id=$1 AND school_id=$2
       AND employee_type IN ('TEACHER','STAFF') AND employment_status='ACTIVE'
       FOR UPDATE`,
      [input.employeeId, schoolId],
    ))[0];
    if (!employee) throw new AuthError(404, "Active teacher or staff employee was not found in this school");
    const existing = poolRows(await client.query(
      `SELECT id,monthly_salary_minor,allowance_minor,deduction_minor,status
       FROM payroll_employee_profiles
       WHERE scope='SCHOOL' AND school_id=$1 AND employee_id=$2 FOR UPDATE`,
      [schoolId, input.employeeId],
    ))[0];
    const result = await client.query(
      `INSERT INTO payroll_employee_profiles (
         scope,school_id,employee_id,company_employee_id,monthly_salary_minor,
         allowance_minor,deduction_minor,currency,bank_name_encrypted,
         bank_code_encrypted,account_name_encrypted,account_number_encrypted,
         account_last4,encryption_key_version,status,created_by,updated_by,updated_at
       ) VALUES ('SCHOOL',$1,$2,NULL,$3,$4,$5,'NGN',$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$12,NOW())
       ON CONFLICT (school_id,employee_id) WHERE scope='SCHOOL'
       DO UPDATE SET monthly_salary_minor=EXCLUDED.monthly_salary_minor,
         allowance_minor=EXCLUDED.allowance_minor,deduction_minor=EXCLUDED.deduction_minor,
         bank_name_encrypted=EXCLUDED.bank_name_encrypted,
         bank_code_encrypted=EXCLUDED.bank_code_encrypted,
         account_name_encrypted=EXCLUDED.account_name_encrypted,
         account_number_encrypted=EXCLUDED.account_number_encrypted,
         account_last4=EXCLUDED.account_last4,
         encryption_key_version=EXCLUDED.encryption_key_version,status='ACTIVE',
         updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING *`,
      [
        schoolId,
        input.employeeId,
        input.monthlySalaryMinor,
        input.allowanceMinor,
        input.deductionMinor,
        bank.bankNameEncrypted,
        bank.bankCodeEncrypted,
        bank.accountNameEncrypted,
        bank.accountNumberEncrypted,
        bank.accountLast4,
        bank.encryptionKeyVersion,
        context.user.id,
      ],
    );
    const row = poolRows(result)[0];
    await audit(client, {
      actor: context.user,
      actorRole: context.roles.find((role) => role.schoolId === schoolId && SCHOOL_PAYROLL_ROLES.includes(role.role))?.role ?? "SCHOOL_ADMIN",
      scope: "SCHOOL",
      schoolId,
      recordType: "PAYROLL_PROFILE",
      recordId: row.id as number,
      action: existing ? "SCHOOL_SALARY_PROFILE_UPDATED" : "SCHOOL_SALARY_PROFILE_CREATED",
      amountMinor: input.monthlySalaryMinor + input.allowanceMinor - input.deductionMinor,
      previousStatus: existing?.status as string | null ?? null,
      newStatus: "ACTIVE",
      metadata: {
        employeeId: input.employeeId,
        previousMonthlySalaryMinor: existing?.monthly_salary_minor ?? null,
        monthlySalaryMinor: input.monthlySalaryMinor,
        accountLast4: bank.accountLast4,
        encryptionKeyVersion: bank.encryptionKeyVersion,
      },
    });
    return row;
  });
  const employee = poolRows(await pool.query(
    `SELECT e.id AS employee_id,e.employee_no,e.first_name,e.middle_name,e.last_name,
       e.email,e.department,e.employee_type,e.employment_status AS employee_status,
       p.*,p.status AS profile_status
     FROM employees e JOIN payroll_employee_profiles p
       ON p.scope='SCHOOL' AND p.employee_id=e.id AND p.school_id=e.school_id
     WHERE e.id=$1 AND e.school_id=$2 AND p.id=$3`,
    [input.employeeId, schoolId, saved.id],
  ))[0];
  return respond(
    res,
    PayrollContract.UpdateSchoolPayrollEmployeeResponse,
    displayPayrollProfile(employee, "SCHOOL", schoolId),
  );
}));

router.get("/platform/finance/company-payroll/employees", run(async (req, res) => {
  requirePlatformOwner(req);
  const query = body(
    PayrollContract.ListCompanyPayrollEmployeesQueryParams,
    req.query,
    "Invalid Company Payroll-employee filter",
  );
  const result = await pool.query(
    `SELECT e.id AS company_employee_id,e.full_name,e.email,e.job_title,
       e.status AS employee_status,p.id,p.monthly_salary_minor,p.allowance_minor,
       p.deduction_minor,p.currency,p.bank_name_encrypted,p.bank_code_encrypted,
       p.account_name_encrypted,p.account_number_encrypted,p.account_last4,
       p.encryption_key_version,p.status AS profile_status,p.updated_at
     FROM platform_company_employees e
     JOIN payroll_employee_profiles p ON p.scope='YEMAIT_COMPANY'
       AND p.company_employee_id=e.id AND p.school_id IS NULL
     WHERE ($1::text IS NULL OR concat_ws(' ',e.full_name,e.email,e.job_title) ILIKE $1)
       AND ($2::text='all' OR (CASE WHEN e.status='ACTIVE' AND p.status='ACTIVE'
                                  THEN 'ACTIVE' ELSE 'INACTIVE' END)=$2)
     ORDER BY e.full_name,e.id`,
    [query.search ? `%${query.search.replace(/[%_]/g, "\\$&")}%` : null, query.status],
  );
  const records = poolRows(result).map((row) =>
    displayPayrollProfile(row, "YEMAIT_COMPANY", null),
  );
  return respond(res, PayrollContract.ListCompanyPayrollEmployeesResponse, records);
}));

router.put("/platform/finance/company-payroll/employees", run(async (req, res) => {
  const context = requirePlatformOwner(req);
  const input = body(
    PayrollContract.UpsertCompanyPayrollEmployeeBody,
    req.body,
    "Invalid Company Payroll salary or bank information",
  );
  getActivePayrollEncryptionKey();
  if (
    !Number.isSafeInteger(input.monthlySalaryMinor) ||
    !Number.isSafeInteger(input.allowanceMinor) ||
    !Number.isSafeInteger(input.deductionMinor) ||
    input.monthlySalaryMinor < 0 ||
    input.allowanceMinor < 0 ||
    input.deductionMinor < 0 ||
    input.deductionMinor > input.monthlySalaryMinor + input.allowanceMinor
  ) {
    throw new AuthError(400, "Company employee salary must be NGN minor-unit amounts with a nonnegative net");
  }
  validateBankInput(input);
  const aad = payrollBankAAD("YEMAIT_COMPANY", null, input.employeeId);
  const bank = encryptedBankRecord(input, aad);
  const saved = await withTransaction(async (client) => {
    const employee = poolRows(await client.query(
      `SELECT id FROM platform_company_employees
       WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
      [input.employeeId],
    ))[0];
    if (!employee) throw new AuthError(404, "Active Yemait Technologies company employee not found");
    const existing = poolRows(await client.query(
      `SELECT id,monthly_salary_minor,allowance_minor,deduction_minor,status
       FROM payroll_employee_profiles
       WHERE scope='YEMAIT_COMPANY' AND company_employee_id=$1 FOR UPDATE`,
      [input.employeeId],
    ))[0];
    const result = await client.query(
      `INSERT INTO payroll_employee_profiles (
         scope,school_id,employee_id,company_employee_id,monthly_salary_minor,
         allowance_minor,deduction_minor,currency,bank_name_encrypted,
         bank_code_encrypted,account_name_encrypted,account_number_encrypted,
         account_last4,encryption_key_version,status,created_by,updated_by,updated_at
       ) VALUES ('YEMAIT_COMPANY',NULL,NULL,$1,$2,$3,$4,'NGN',$5,$6,$7,$8,$9,$10,
         'ACTIVE',$11,$11,NOW())
       ON CONFLICT (company_employee_id) WHERE scope='YEMAIT_COMPANY'
       DO UPDATE SET monthly_salary_minor=EXCLUDED.monthly_salary_minor,
         allowance_minor=EXCLUDED.allowance_minor,deduction_minor=EXCLUDED.deduction_minor,
         bank_name_encrypted=EXCLUDED.bank_name_encrypted,
         bank_code_encrypted=EXCLUDED.bank_code_encrypted,
         account_name_encrypted=EXCLUDED.account_name_encrypted,
         account_number_encrypted=EXCLUDED.account_number_encrypted,
         account_last4=EXCLUDED.account_last4,
         encryption_key_version=EXCLUDED.encryption_key_version,status='ACTIVE',
         updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING *`,
      [
        input.employeeId,
        input.monthlySalaryMinor,
        input.allowanceMinor,
        input.deductionMinor,
        bank.bankNameEncrypted,
        bank.bankCodeEncrypted,
        bank.accountNameEncrypted,
        bank.accountNumberEncrypted,
        bank.accountLast4,
        bank.encryptionKeyVersion,
        context.user.id,
      ],
    );
    const row = poolRows(result)[0];
    await audit(client, {
      actor: context.user,
      actorRole: "PLATFORM_OWNER",
      scope: "YEMAIT_COMPANY",
      schoolId: null,
      recordType: "PAYROLL_PROFILE",
      recordId: row.id as number,
      action: existing ? "COMPANY_SALARY_PROFILE_UPDATED" : "COMPANY_SALARY_PROFILE_CREATED",
      amountMinor: input.monthlySalaryMinor + input.allowanceMinor - input.deductionMinor,
      previousStatus: existing?.status as string | null ?? null,
      newStatus: "ACTIVE",
      metadata: {
        employeeId: input.employeeId,
        previousMonthlySalaryMinor: existing?.monthly_salary_minor ?? null,
        monthlySalaryMinor: input.monthlySalaryMinor,
        accountLast4: bank.accountLast4,
        encryptionKeyVersion: bank.encryptionKeyVersion,
      },
    });
    return row;
  });
  const employee = poolRows(await pool.query(
    `SELECT e.id AS company_employee_id,e.full_name,e.email,e.job_title,e.status AS employee_status,
       p.*,p.status AS profile_status FROM platform_company_employees e
     JOIN payroll_employee_profiles p ON p.scope='YEMAIT_COMPANY'
       AND p.company_employee_id=e.id AND p.school_id IS NULL
     WHERE e.id=$1 AND p.id=$2`,
    [input.employeeId, saved.id],
  ))[0];
  return respond(
    res,
    PayrollContract.UpsertCompanyPayrollEmployeeResponse,
    displayPayrollProfile(employee, "YEMAIT_COMPANY", null),
  );
}));

// ---------------------------------------------------------------------------
// Frozen monthly payroll runs, maker-checker review and financial reporting.
// All company rows are sourced only from platform_company_employees; all
// school rows are selected and joined by the active, exact school_id.
// ---------------------------------------------------------------------------

function safeTotal(values: number[], message: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) {
      throw new AuthError(400, message);
    }
    total += value;
  }
  return total;
}

function validateMonth(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) ||
    Number(value.slice(0, 4)) < 2000 ||
    Number(value.slice(0, 4)) > 2200
  ) {
    throw new AuthError(400, "Payroll periods must use a valid YYYY-MM month from 2000 through 2200");
  }
  return value;
}

async function readEligiblePayrollEmployees(input: {
  client: PoolClient;
  scope: Scope;
  schoolId: number | null;
  requestedIds?: number[];
}) {
  if (input.scope === "SCHOOL") {
    const employees = poolRows(await input.client.query(
      `SELECT p.id AS profile_id,p.employee_id,e.employee_no,e.first_name,e.middle_name,e.last_name,
         e.employee_type,e.department,p.monthly_salary_minor,p.allowance_minor,p.deduction_minor
         ,p.bank_name_encrypted,p.bank_code_encrypted,p.account_name_encrypted,
         p.account_number_encrypted,p.account_last4,p.encryption_key_version
       FROM payroll_employee_profiles p
       JOIN employees e ON e.id=p.employee_id AND e.school_id=p.school_id
       WHERE p.scope='SCHOOL' AND p.school_id=$1 AND p.status='ACTIVE'
         AND e.employment_status='ACTIVE' AND e.employee_type IN ('TEACHER','STAFF')
         AND ($2::int[] IS NULL OR e.id=ANY($2::int[]))
       ORDER BY e.last_name,e.first_name,e.id
       FOR SHARE OF p,e`,
      [input.schoolId, input.requestedIds ?? null],
    ));
    return employees.map((row) => ({
      profileId: Number(row.profile_id),
      employeeId: Number(row.employee_id),
      employeeNumber: row.employee_no as string,
      fullName: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(" "),
      employeeType: row.employee_type as "TEACHER" | "STAFF",
      jobTitle: row.department as string | null,
      baseSalaryMinor: Number(row.monthly_salary_minor),
      allowanceMinor: Number(row.allowance_minor),
      deductionMinor: Number(row.deduction_minor),
      bank_name_encrypted: String(row.bank_name_encrypted),
      bank_code_encrypted: String(row.bank_code_encrypted),
      account_name_encrypted: String(row.account_name_encrypted),
      account_number_encrypted: String(row.account_number_encrypted),
      account_last4: String(row.account_last4),
      encryption_key_version: String(row.encryption_key_version),
    }));
  }
  const employees = poolRows(await input.client.query(
    `SELECT p.id AS profile_id,p.company_employee_id,e.full_name,e.job_title,
       p.monthly_salary_minor,p.allowance_minor,p.deduction_minor,
       p.bank_name_encrypted,p.bank_code_encrypted,p.account_name_encrypted,
       p.account_number_encrypted,p.account_last4,p.encryption_key_version
     FROM payroll_employee_profiles p
     JOIN platform_company_employees e ON e.id=p.company_employee_id
     WHERE p.scope='YEMAIT_COMPANY' AND p.school_id IS NULL AND p.status='ACTIVE'
       AND e.status='ACTIVE' AND ($1::int[] IS NULL OR e.id=ANY($1::int[]))
     ORDER BY e.full_name,e.id
     FOR SHARE OF p,e`,
    [input.requestedIds ?? null],
  ));
  return employees.map((row) => ({
    profileId: Number(row.profile_id),
    employeeId: Number(row.company_employee_id),
    employeeNumber: null,
    fullName: String(row.full_name),
    employeeType: "COMPANY_EMPLOYEE" as const,
    jobTitle: row.job_title as string | null,
    baseSalaryMinor: Number(row.monthly_salary_minor),
    allowanceMinor: Number(row.allowance_minor),
    deductionMinor: Number(row.deduction_minor),
    bank_name_encrypted: String(row.bank_name_encrypted),
    bank_code_encrypted: String(row.bank_code_encrypted),
    account_name_encrypted: String(row.account_name_encrypted),
    account_number_encrypted: String(row.account_number_encrypted),
    account_last4: String(row.account_last4),
    encryption_key_version: String(row.encryption_key_version),
  }));
}

async function createPayrollPeriod(input: {
  scope: Scope;
  schoolId: number | null;
  req: Request;
  body: { periodMonth: string; employeeIds?: number[] };
}) {
  const who = actor(input.req);
  const month = validateMonth(input.body.periodMonth);
  if (input.body.employeeIds) requireUniqueIds(input.body.employeeIds, "Payroll employees");
  return withTransaction(async (client) => {
    const employees = await readEligiblePayrollEmployees({
      client,
      scope: input.scope,
      schoolId: input.schoolId,
      requestedIds: input.body.employeeIds,
    });
    if (
      input.body.employeeIds &&
      employees.length !== input.body.employeeIds.length
    ) {
      throw new AuthError(
        400,
        "Every requested active payroll employee must have a configured salary profile in this tenant",
      );
    }
    if (!employees.length) {
      throw new AuthError(
        400,
        "No active payroll employee with a configured salary and encrypted bank account is available for this month",
      );
    }
    if (employees.length > 1000) {
      throw new AuthError(400, "A single monthly payroll period cannot contain more than 1,000 employees");
    }
    const gross = safeTotal(
      employees.map((employee) => employee.baseSalaryMinor),
      "Payroll gross salary exceeds the safe NGN minor-unit range",
    );
    const allowances = safeTotal(
      employees.map((employee) => employee.allowanceMinor),
      "Payroll allowance total exceeds the safe NGN minor-unit range",
    );
    const deductions = safeTotal(
      employees.map((employee) => employee.deductionMinor),
      "Payroll deduction total exceeds the safe NGN minor-unit range",
    );
    if (deductions > gross + allowances) {
      throw new AuthError(400, "Payroll deductions cannot result in a negative net salary");
    }
    const net = gross + allowances - deductions;
    if (!Number.isSafeInteger(net)) {
      throw new AuthError(400, "Payroll net salary exceeds the safe NGN minor-unit range");
    }
    const inserted = poolRows(await client.query(
      `INSERT INTO payroll_periods
        (scope,school_id,period_month,status,employee_count,gross_salary_minor,
         allowance_minor,deduction_minor,net_salary_minor,created_by)
       VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        input.scope,
        input.schoolId,
        month,
        employees.length,
        gross,
        allowances,
        deductions,
        net,
        who.id,
      ],
    ))[0];
    const periodId = Number(inserted.id);
    const values: unknown[] = [];
    const tuples = employees.map((employee, index) => {
      const base = index * 21;
      values.push(
        input.scope,
        input.schoolId,
        periodId,
        employee.profileId,
        month,
        employee.fullName,
        employee.employeeNumber,
        employee.employeeType,
        employee.baseSalaryMinor,
        employee.allowanceMinor,
        0,
        employee.deductionMinor,
        0,
        null,
        employee.baseSalaryMinor + employee.allowanceMinor - employee.deductionMinor,
        employees[index].bank_name_encrypted,
        employees[index].bank_code_encrypted,
        employees[index].account_name_encrypted,
        employees[index].account_number_encrypted,
        employees[index].account_last4,
        employees[index].encryption_key_version,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},
        $${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},
        $${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15},
        $${base + 16},$${base + 17},$${base + 18},$${base + 19},$${base + 20},
        $${base + 21})`;
    });
    await client.query(
      `INSERT INTO payroll_items
        (scope,school_id,period_id,employee_profile_id,period_month,
         employee_name_snapshot,employee_number_snapshot,role_snapshot,
         base_salary_minor,allowance_minor,bonus_minor,deduction_minor,
         adjustment_minor,adjustment_reason,net_salary_minor,bank_name_encrypted,
         bank_code_encrypted,account_name_encrypted,account_number_encrypted,
         account_last4,encryption_key_version)
       VALUES ${tuples.join(",")}`,
      values,
    );
    await audit(client, {
      actor: who,
      actorRole: input.scope === "SCHOOL" ? "SCHOOL_FINANCE" : "PLATFORM_OWNER",
      scope: input.scope,
      schoolId: input.schoolId,
      recordType: "PAYROLL_PERIOD",
      recordId: periodId,
      action: `${input.scope}_PAYROLL_PERIOD_CREATED`,
      amountMinor: net,
      newStatus: "DRAFT",
      metadata: { periodMonth: month, employeeCount: employees.length },
    });
    return periodId;
  });
}

const periodSummaryQuery = `
 SELECT p.id AS "periodId",p.scope,p.school_id AS "schoolId",p.period_month AS "periodMonth",
   p.status,p.employee_count AS "employeeCount",p.gross_salary_minor AS "grossSalaryMinor",
   p.allowance_minor AS "allowanceMinor",p.bonus_minor AS "bonusMinor",
   p.deduction_minor AS "deductionMinor",p.adjustment_minor AS "adjustmentMinor",
   p.net_salary_minor AS "netSalaryMinor",
   COALESCE(x.paid_count,0)::int AS "paidCount",
   COALESCE(x.pending_count,0)::int AS "pendingCount",
   COALESCE(x.failed_count,0)::int AS "failedCount",'NGN'::text AS currency,
   p.created_by AS "createdBy",p.submitted_by AS "submittedBy",
   p.approved_by AS "approvedBy",p.created_at AS "createdAt",
   p.submitted_at AS "submittedAt",p.approved_at AS "approvedAt"
 FROM payroll_periods p
 LEFT JOIN LATERAL (
   SELECT COUNT(*) FILTER (WHERE latest.status='PAID')::int AS paid_count,
     COUNT(*) FILTER (WHERE latest.status IN (
       'CLAIMED','PROCESSING','PENDING','MOCK_PENDING','UNCERTAIN','RECONCILIATION_REQUIRED'
     ))::int AS pending_count,
     COUNT(*) FILTER (WHERE latest.status='FAILED')::int AS failed_count
   FROM (
     SELECT DISTINCT ON (pt.payroll_item_id) pt.status
     FROM payroll_transfers pt
     WHERE pt.period_id=p.id
     ORDER BY pt.payroll_item_id,pt.attempt_number DESC,pt.id DESC
   ) latest
 ) x ON TRUE `;

async function readPeriodSummaries(input: {
  scope: Scope;
  schoolId: number | null;
  status?: string | null;
  year?: number | null;
}) {
  return poolRows(await pool.query(
    `${periodSummaryQuery}
     WHERE p.scope=$1 AND p.school_id IS NOT DISTINCT FROM $2
       AND ($3::text IS NULL OR p.status=$3)
       AND ($4::int IS NULL OR left(p.period_month,4)::int=$4)
     ORDER BY p.period_month DESC,p.id DESC`,
    [input.scope, input.schoolId, input.status ?? null, input.year ?? null],
  ));
}

async function createPeriodHandler(
  req: Request,
  res: Response,
  input: { scope: Scope; schoolId: number | null; owner?: boolean },
  contractBodySchema: SchemaLike,
  contractResponseSchema: SchemaLike,
) {
  if (input.owner) requirePlatformOwner(req);
  const requestBody = body(contractBodySchema, req.body, "Invalid monthly payroll-period request") as {
    periodMonth: string;
    employeeIds?: number[];
  };
  const periodId = await createPayrollPeriod({ ...input, req, body: requestBody });
  const result = await readPayrollPeriod(input.scope, input.schoolId, periodId);
  return respond(res, contractResponseSchema as PayrollSchema<unknown>, result, 201);
}

router.get("/schools/:schoolId/finance/payroll/periods", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  const query = body(
    PayrollContract.ListSchoolPayrollPeriodsQueryParams,
    req.query,
    "Invalid school payroll-period filter",
  );
  const result = await readPeriodSummaries({
    scope: "SCHOOL",
    schoolId,
    status: query.status ?? null,
    year: query.year ?? null,
  });
  return respond(res, PayrollContract.ListSchoolPayrollPeriodsResponse, result);
}));

router.post("/schools/:schoolId/finance/payroll/periods", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  return createPeriodHandler(
    req,
    res,
    { scope: "SCHOOL", schoolId },
    PayrollContract.CreateSchoolPayrollPeriodBody,
    PayrollContract.CreateSchoolPayrollPeriodResponse,
  );
}));

router.get("/platform/finance/company-payroll/periods", run(async (req, res) => {
  requirePlatformOwner(req);
  const query = body(
    PayrollContract.ListCompanyPayrollPeriodsQueryParams,
    req.query,
    "Invalid Company Payroll-period filter",
  );
  const result = await readPeriodSummaries({
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    status: query.status ?? null,
    year: query.year ?? null,
  });
  return respond(res, PayrollContract.ListCompanyPayrollPeriodsResponse, result);
}));

router.post("/platform/finance/company-payroll/periods", run(async (req, res) =>
  createPeriodHandler(
    req,
    res,
    { scope: "YEMAIT_COMPANY", schoolId: null, owner: true },
    PayrollContract.CreateCompanyPayrollPeriodBody,
    PayrollContract.CreateCompanyPayrollPeriodResponse,
  ),
));

async function readPayrollPeriod(scope: Scope, schoolId: number | null, periodId: number) {
  const period = poolRows(await pool.query(
    `${periodSummaryQuery}
     WHERE p.scope=$1 AND p.school_id IS NOT DISTINCT FROM $2 AND p.id=$3`,
    [scope, schoolId, periodId],
  ))[0];
  if (!period) throw new AuthError(404, "Payroll period not found in this tenant");
  const itemRows = poolRows(await pool.query(
    `SELECT i.id AS item_id,i.period_id,i.period_month,i.employee_name_snapshot,
       i.employee_number_snapshot,i.role_snapshot,i.base_salary_minor,i.allowance_minor,
       i.bonus_minor,i.deduction_minor,i.adjustment_minor,i.adjustment_reason,
       i.net_salary_minor,i.currency,i.employee_profile_id,i.updated_at,
       ep.employee_id,ep.company_employee_id,e.id AS school_employee_id,
       e.employee_no,e.first_name,e.last_name,e.middle_name,e.department,
       c.id AS company_employee_id_join,c.full_name,c.job_title,
       i.bank_name_encrypted,i.bank_code_encrypted,i.account_name_encrypted,
       i.account_number_encrypted,i.account_last4,i.encryption_key_version,
       COALESCE(pay.status,'UNPAID') AS payment_status,
       pay.provider_reference AS transfer_reference,payslip.id AS payslip_id
     FROM payroll_items i
     JOIN payroll_employee_profiles ep ON ep.id=i.employee_profile_id
       AND ep.scope=i.scope AND ep.school_id IS NOT DISTINCT FROM i.school_id
     LEFT JOIN employees e ON e.id=ep.employee_id AND e.school_id=i.school_id
       AND i.scope='SCHOOL'
     LEFT JOIN platform_company_employees c
       ON c.id=ep.company_employee_id AND i.scope='YEMAIT_COMPANY'
     LEFT JOIN LATERAL (
       SELECT pt.status,pt.provider_reference
       FROM payroll_transfers pt
       WHERE pt.payroll_item_id=i.id
       ORDER BY pt.attempt_number DESC,pt.id DESC LIMIT 1
     ) pay ON TRUE
     LEFT JOIN payroll_payslips payslip ON payslip.payroll_item_id=i.id
     WHERE i.scope=$1 AND i.school_id IS NOT DISTINCT FROM $2 AND i.period_id=$3
     ORDER BY i.employee_name_snapshot,i.id`,
    [scope, schoolId, periodId],
  ));
  const transferRows = poolRows(await pool.query(
    `SELECT t.id,t.payroll_item_id,t.attempt_number,t.amount_minor,t.currency,
       t.provider,t.provider_mode,t.provider_reference,t.provider_transaction_id,
       t.provider_status,t.status,t.requires_reconciliation,
       t.external_transfer_verified,t.provider_fee_minor,t.settlement_amount_minor,
       t.failure_message,t.created_at,t.verified_at
     FROM payroll_transfers t
     JOIN payroll_items i ON i.id=t.payroll_item_id AND i.period_id=t.period_id
       AND i.scope=t.scope AND i.school_id IS NOT DISTINCT FROM t.school_id
     WHERE t.scope=$1 AND t.school_id IS NOT DISTINCT FROM $2 AND t.period_id=$3
     ORDER BY t.payroll_item_id,t.attempt_number,t.id`,
    [scope, schoolId, periodId],
  ));
  const attemptsByItem = new Map<number, AnyRow[]>();
  for (const row of transferRows) {
    const payrollItemId = Number(row.payroll_item_id);
    const attempts = attemptsByItem.get(payrollItemId) ?? [];
    attempts.push({
      id: Number(row.id),
      attempt: Number(row.attempt_number),
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      provider: row.provider,
      providerMode: row.provider_mode,
      providerReference: row.provider_reference,
      providerTransactionId: row.provider_transaction_id ?? null,
      providerStatus: row.provider_status ?? null,
      status: row.status,
      requiresReconciliation: Boolean(row.requires_reconciliation),
      externalTransferVerified: Boolean(row.external_transfer_verified),
      providerFeeMinor: Number(row.provider_fee_minor),
      settlementAmountMinor: Number(row.settlement_amount_minor),
      failureMessage: row.failure_message ?? null,
      createdAt: row.created_at,
      verifiedAt: row.verified_at ?? null,
    });
    attemptsByItem.set(payrollItemId, attempts);
  }
  const items = itemRows.map((item) => {
    const employeeId = Number(scope === "SCHOOL" ? item.school_employee_id : item.company_employee_id_join);
    const aad = payrollBankAAD(scope, schoolId, Number(scope === "SCHOOL" ? item.employee_id : item.company_employee_id));
    const bank = decryptBankRecord(item, aad);
    return {
      employeeId,
      employeeType: item.role_snapshot,
      employeeNumber: scope === "SCHOOL" ? item.employee_no : null,
      fullName: item.employee_name_snapshot,
      jobTitle: scope === "SCHOOL" ? item.department ?? null : item.job_title ?? null,
      baseSalaryMinor: Number(item.base_salary_minor),
      allowanceMinor: Number(item.allowance_minor),
      bonusMinor: Number(item.bonus_minor),
      deductionMinor: Number(item.deduction_minor),
      adjustmentMinor: Number(item.adjustment_minor),
      adjustmentReason: item.adjustment_reason,
      netSalaryMinor: Number(item.net_salary_minor),
      currency: "NGN",
      paymentStatus: item.payment_status === "MOCK_PENDING"
        ? "MOCK_PENDING"
        : item.payment_status === "PAID"
          ? "PAID"
          : item.payment_status === "FAILED"
            ? "FAILED"
            : item.payment_status === "CANCELLED"
              ? "CANCELLED"
              : item.payment_status === "UNPAID"
                ? "UNPAID"
                : "PENDING",
      transferReference: item.transfer_reference ?? null,
      transferAttempts: attemptsByItem.get(Number(item.item_id)) ?? [],
      bankName: bank.bankName,
      maskedAccountNumber: maskedAccount(item.account_last4),
      payslipId: item.payslip_id ?? null,
    };
  });
  return {
    ...period,
    items,
    providerMode: providerModeForResponse(),
  };
}

async function getPeriodHandler(
  req: Request,
  res: Response,
  input: { scope: Scope; schoolId: number | null; owner?: boolean },
  paramsSchema: SchemaLike,
  responseSchema: SchemaLike,
) {
  if (input.owner) requirePlatformOwner(req);
  const params = body(paramsSchema, req.params, "Invalid payroll-period identifier") as { periodId: number };
  const result = await readPayrollPeriod(input.scope, input.schoolId, params.periodId);
  return respond(res, responseSchema as PayrollSchema<unknown>, result);
}

router.get("/schools/:schoolId/finance/payroll/periods/:periodId", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  return getPeriodHandler(
    req,
    res,
    { scope: "SCHOOL", schoolId },
    PayrollContract.GetSchoolPayrollPeriodParams,
    PayrollContract.GetSchoolPayrollPeriodResponse,
  );
}));

router.get("/platform/finance/company-payroll/periods/:periodId", run(async (req, res) =>
  getPeriodHandler(
    req,
    res,
    { scope: "YEMAIT_COMPANY", schoolId: null, owner: true },
    PayrollContract.GetCompanyPayrollPeriodParams,
    PayrollContract.GetCompanyPayrollPeriodResponse,
  ),
));

async function updatePayrollItems(
  req: Request,
  input: {
    scope: Scope;
    schoolId: number | null;
    bodySchema: SchemaLike;
  },
) {
  const context = input.scope === "YEMAIT_COMPANY"
    ? requirePlatformOwner(req)
    : (() => {
        requireSchoolRole(req, input.schoolId, SCHOOL_PAYROLL_ROLES);
        return getUserContext(req);
      })();
  const actorUser = context.user;
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  const requestBody = body(
    input.bodySchema,
    req.body,
    "Invalid payroll adjustments",
  ) as { items: Array<{
    employeeId: number;
    allowanceMinor: number;
    deductionMinor: number;
    bonusMinor: number;
    adjustmentMinor: number;
    adjustmentReason: string;
  }> };
  if (
    requestBody.items.length > 1000 ||
    new Set(requestBody.items.map((item) => item.employeeId)).size !== requestBody.items.length
  ) {
    throw new AuthError(400, "Each adjusted employee must be included exactly once");
  }
  return withTransaction(async (client) => {
    const period = poolRows(await client.query(
      `SELECT id,status FROM payroll_periods
       WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3
       FOR UPDATE`,
      [periodId, input.scope, input.schoolId],
    ))[0];
    if (!period) throw new AuthError(404, "Payroll period not found in this tenant");
    if (period.status !== "DRAFT") {
      throw new AuthError(409, "Only draft payroll periods can be changed; submitted and approved runs are immutable");
    }
    const employeeIds = requestBody.items.map((item) => item.employeeId);
    const lockedItems = poolRows(await client.query(
      `SELECT i.*,COALESCE(e.id,c.id) AS employee_id
       FROM payroll_items i
       JOIN payroll_employee_profiles pp ON pp.id=i.employee_profile_id
         AND pp.scope=i.scope AND pp.school_id IS NOT DISTINCT FROM i.school_id
       LEFT JOIN employees e ON i.scope='SCHOOL'
         AND e.id=pp.employee_id AND e.school_id=i.school_id
       LEFT JOIN platform_company_employees c
         ON i.scope='YEMAIT_COMPANY' AND c.id=pp.company_employee_id
       WHERE i.period_id=$1 AND i.scope=$2 AND i.school_id IS NOT DISTINCT FROM $3
         AND COALESCE(e.id,c.id)=ANY($4::int[])
       FOR UPDATE OF i`,
      [periodId, input.scope, input.schoolId, employeeIds],
    ));
    if (lockedItems.length !== requestBody.items.length) {
      throw new AuthError(404, "Every updated employee must be an item in this draft payroll period");
    }
    const itemByEmployeeId = new Map(
      lockedItems.map((item) => [Number(item.employee_id), item]),
    );
    for (const update of requestBody.items) {
      const old = itemByEmployeeId.get(update.employeeId);
      if (!old) throw new AuthError(404, "Payroll employee not found in this draft period");
      for (const amount of [
        update.allowanceMinor,
        update.deductionMinor,
        update.bonusMinor,
      ]) {
        if (!Number.isSafeInteger(amount) || amount < 0) {
          throw new AuthError(400, "Payroll allowances, deductions, and bonuses must be nonnegative minor-unit integers");
        }
      }
      if (
        !Number.isSafeInteger(update.adjustmentMinor) ||
        typeof update.adjustmentReason !== "string" ||
        update.adjustmentReason.trim().length < 3 ||
        update.adjustmentReason.trim().length > 500
      ) {
        throw new AuthError(400, "Payroll adjustments require an integer amount and an explanatory audit reason");
      }
      const net =
        Number(old.base_salary_minor) +
        update.allowanceMinor +
        update.bonusMinor +
        update.adjustmentMinor -
        update.deductionMinor;
      if (!Number.isSafeInteger(net) || net < 0) {
        throw new AuthError(400, "Payroll adjustments cannot produce a negative or unsafe net salary");
      }
      const result = await client.query(
        `UPDATE payroll_items SET allowance_minor=$1,bonus_minor=$2,deduction_minor=$3,
          adjustment_minor=$4,adjustment_reason=$5,net_salary_minor=$6,updated_at=NOW()
         WHERE id=$7 AND period_id=$8 AND scope=$9 AND school_id IS NOT DISTINCT FROM $10
         RETURNING id`,
        [
          update.allowanceMinor,
          update.bonusMinor,
          update.deductionMinor,
          update.adjustmentMinor,
          update.adjustmentMinor === 0 ? null : update.adjustmentReason.trim(),
          net,
          old.id,
          periodId,
          input.scope,
          input.schoolId,
        ],
      );
      if (!result.rows[0]) throw new AuthError(404, "A same-tenant draft payroll item disappeared");
      await audit(client, {
        actor: actorUser,
        actorRole: input.scope === "SCHOOL" ? "SCHOOL_FINANCE" : "PLATFORM_OWNER",
        scope: input.scope,
        schoolId: input.schoolId,
        recordType: "PAYROLL_ITEM",
        recordId: old.id as number,
        action: "PAYROLL_DRAFT_ADJUSTMENT",
        amountMinor: net,
        previousStatus: "DRAFT",
        newStatus: "DRAFT",
        metadata: {
          employeeId: update.employeeId,
          previousNetSalaryMinor: old.net_salary_minor,
          updatedNetSalaryMinor: net,
          reason: update.adjustmentReason.trim(),
          adjustmentMinor: update.adjustmentMinor,
          allowanceMinor: update.allowanceMinor,
          bonusMinor: update.bonusMinor,
          deductionMinor: update.deductionMinor,
        },
      });
    }
    const totals = poolRows(await client.query(
      `SELECT COUNT(*)::int AS employee_count,
         COALESCE(SUM(base_salary_minor),0)::bigint AS gross,
         COALESCE(SUM(allowance_minor),0)::bigint AS allowance,
         COALESCE(SUM(bonus_minor),0)::bigint AS bonus,
         COALESCE(SUM(deduction_minor),0)::bigint AS deduction,
         COALESCE(SUM(adjustment_minor),0)::bigint AS adjustment,
         COALESCE(SUM(net_salary_minor),0)::bigint AS net
       FROM payroll_items WHERE period_id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3`,
      [periodId, input.scope, input.schoolId],
    ))[0];
    const numeric = [
      Number(totals.employee_count),
      Number(totals.gross),
      Number(totals.allowance),
      Number(totals.bonus),
      Number(totals.deduction),
      Number(totals.adjustment),
      Number(totals.net),
    ];
    if (numeric.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new AuthError(400, "Payroll totals exceed the safe NGN minor-unit range");
    }
    await client.query(
      `UPDATE payroll_periods SET employee_count=$1,gross_salary_minor=$2,
        allowance_minor=$3,bonus_minor=$4,deduction_minor=$5,adjustment_minor=$6,
        net_salary_minor=$7,updated_at=NOW()
       WHERE id=$8 AND scope=$9 AND school_id IS NOT DISTINCT FROM $10 AND status='DRAFT'`,
      [...numeric, periodId, input.scope, input.schoolId],
    );
  });
}

router.put("/schools/:schoolId/finance/payroll/periods/:periodId", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  await updatePayrollItems(req, {
    scope: "SCHOOL",
    schoolId,
    bodySchema: PayrollContract.UpdateSchoolPayrollPeriodItemsBody,
  });
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  return respond(
    res,
    PayrollContract.UpdateSchoolPayrollPeriodItemsResponse,
    await readPayrollPeriod("SCHOOL", schoolId, periodId),
  );
}));

router.put("/platform/finance/company-payroll/periods/:periodId", run(async (req, res) => {
  requirePlatformOwner(req);
  await updatePayrollItems(req, {
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    bodySchema: PayrollContract.UpdateCompanyPayrollPeriodItemsBody,
  });
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  return respond(
    res,
    PayrollContract.UpdateCompanyPayrollPeriodItemsResponse,
    await readPayrollPeriod("YEMAIT_COMPANY", null, periodId),
  );
}));

async function transitionPayroll(
  req: Request,
  input: {
    scope: Scope;
    schoolId: number | null;
    action: "SUBMIT" | "APPROVE";
    owner?: boolean;
  },
) {
  const context = input.owner
    ? requirePlatformOwner(req)
    : (() => {
        requireSchoolRole(req, input.schoolId, SCHOOL_PAYROLL_ROLES);
        return getUserContext(req);
      })();
  const currentActor = context.user;
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  return withTransaction(async (client) => {
    const period = poolRows(await client.query(
      `SELECT id,status,submitted_by,approved_by FROM payroll_periods
       WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [periodId, input.scope, input.schoolId],
    ))[0];
    if (!period) throw new AuthError(404, "Payroll period not found in this tenant");
    const itemCount = Number(poolRows(await client.query(
      `SELECT COUNT(*)::int AS count FROM payroll_items
       WHERE period_id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3`,
      [periodId, input.scope, input.schoolId],
    ))[0].count);
    if (input.action === "SUBMIT") {
      if (period.status !== "DRAFT" || itemCount < 1) {
        throw new AuthError(409, "Only a complete, employee-populated draft can be submitted for independent approval");
      }
      const changed = await client.query(
        `UPDATE payroll_periods SET status='PENDING_APPROVAL',submitted_by=$1,
           submitted_at=NOW(),updated_at=NOW()
         WHERE id=$2 AND scope=$3 AND school_id IS NOT DISTINCT FROM $4
           AND status='DRAFT'`,
        [currentActor.id, periodId, input.scope, input.schoolId],
      );
      if (changed.rowCount !== 1) {
        throw new AuthError(409, "Payroll draft changed during submission; reload it before retrying");
      }
      await audit(client, {
        actor: currentActor,
        actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
        scope: input.scope,
        schoolId: input.schoolId,
        recordType: "PAYROLL_PERIOD",
        recordId: periodId,
        action: `${input.scope}_PAYROLL_PERIOD_SUBMITTED`,
        previousStatus: "DRAFT",
        newStatus: "PENDING_APPROVAL",
        metadata: { employeeCount: itemCount },
      });
    } else {
      if (period.status !== "PENDING_APPROVAL") {
        throw new AuthError(409, "Only a submitted payroll period can receive approval");
      }
      if (Number(period.submitted_by) === currentActor.id) {
        throw new AuthError(409, "The payroll preparer cannot approve their own submitted salary run");
      }
      const changed = await client.query(
        `UPDATE payroll_periods SET status='APPROVED',approved_by=$1,
           approved_at=NOW(),updated_at=NOW()
         WHERE id=$2 AND scope=$3 AND school_id IS NOT DISTINCT FROM $4
           AND status='PENDING_APPROVAL' AND submitted_by<>$1`,
        [currentActor.id, periodId, input.scope, input.schoolId],
      );
      if (changed.rowCount !== 1) {
        throw new AuthError(409, "An independent approver must review the unchanged payroll period");
      }
      await audit(client, {
        actor: currentActor,
        actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
        scope: input.scope,
        schoolId: input.schoolId,
        recordType: "PAYROLL_PERIOD",
        recordId: periodId,
        action: `${input.scope}_PAYROLL_PERIOD_APPROVED`,
        previousStatus: "PENDING_APPROVAL",
        newStatus: "APPROVED",
        metadata: { submittedBy: period.submitted_by },
      });
    }
  });
}

router.post("/schools/:schoolId/finance/payroll/periods/:periodId/submit", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  await transitionPayroll(req, { scope: "SCHOOL", schoolId, action: "SUBMIT" });
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  return respond(
    res,
    PayrollContract.SubmitSchoolPayrollPeriodResponse,
    await readPayrollPeriod("SCHOOL", schoolId, periodId),
  );
}));

router.post("/schools/:schoolId/finance/payroll/periods/:periodId/approve", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_FINANCE_ROLES);
  await transitionPayroll(req, { scope: "SCHOOL", schoolId, action: "APPROVE" });
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  return respond(
    res,
    PayrollContract.ApproveSchoolPayrollPeriodResponse,
    await readPayrollPeriod("SCHOOL", schoolId, periodId),
  );
}));

router.post("/platform/finance/company-payroll/periods/:periodId/submit", run(async (req, res) => {
  requirePlatformOwner(req);
  await transitionPayroll(req, {
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    action: "SUBMIT",
    owner: true,
  });
  const periodId = assertResourceId(req.params.periodId, "Company payroll period");
  return respond(
    res,
    PayrollContract.SubmitCompanyPayrollPeriodResponse,
    await readPayrollPeriod("YEMAIT_COMPANY", null, periodId),
  );
}));

router.post("/platform/finance/company-payroll/periods/:periodId/approve", run(async (req, res) => {
  requirePlatformOwner(req);
  await transitionPayroll(req, {
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    action: "APPROVE",
    owner: true,
  });
  const periodId = assertResourceId(req.params.periodId, "Company payroll period");
  return respond(
    res,
    PayrollContract.ApproveCompanyPayrollPeriodResponse,
    await readPayrollPeriod("YEMAIT_COMPANY", null, periodId),
  );
}));

// ---------------------------------------------------------------------------
// Salary disbursement and server-side reconciliation. Only one attempt per
// employee/item may be in flight; a network timeout is frozen and reconciled
// by its pre-stored Flutterwave merchant reference without another POST.
// ---------------------------------------------------------------------------

function transferRowProjection(row: AnyRow) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    employeeId: Number(row.employee_id),
    amountMinor: Number(row.amount_minor),
    currency: "NGN",
    provider: row.provider,
    providerMode: row.provider_mode,
    providerReference: row.provider_reference,
    providerTransactionId: row.provider_transaction_id ?? null,
    providerStatus: row.provider_status ?? null,
    status: row.status,
    requiresReconciliation: row.requires_reconciliation,
    externalTransferVerified: row.external_transfer_verified,
    providerFeeMinor: Number(row.provider_fee_minor),
    settlementAmountMinor: Number(row.settlement_amount_minor),
    failureMessage: row.failure_message ?? null,
    attempt: Number(row.attempt_number),
    createdAt: row.created_at,
    verifiedAt: row.verified_at ?? null,
  };
}

const TRANSFER_SELECT = `
 SELECT t.id,t.scope,t.school_id,t.period_id,t.payroll_item_id,t.attempt_number,
   t.provider,t.provider_mode,t.provider_reference,t.provider_transaction_id,
   t.amount_minor,t.provider_fee_minor,t.settlement_amount_minor,t.status,
   t.requires_reconciliation,t.external_transfer_verified,t.provider_status,
   t.failure_message,t.created_at,t.verified_at,COALESCE(e.id,c.id) AS employee_id
 FROM payroll_transfers t
 JOIN payroll_items i ON i.id=t.payroll_item_id AND i.period_id=t.period_id
   AND i.scope=t.scope AND i.school_id IS NOT DISTINCT FROM t.school_id
 LEFT JOIN employees e ON i.scope='SCHOOL'
   AND e.id=(SELECT pp.employee_id FROM payroll_employee_profiles pp
     WHERE pp.id=i.employee_profile_id AND pp.scope='SCHOOL' AND pp.school_id=i.school_id)
   AND e.school_id=i.school_id
 LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY'
   AND c.id=(SELECT pp.company_employee_id FROM payroll_employee_profiles pp
     WHERE pp.id=i.employee_profile_id AND pp.scope='YEMAIT_COMPANY' AND pp.school_id IS NULL) `;

async function recalculatePeriodProviderStatus(client: PoolClient, input: {
  periodId: number;
  scope: Scope;
  schoolId: number | null;
}) {
  const aggregate = poolRows(await client.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE latest.status='PAID')::int AS paid,
       COUNT(*) FILTER (WHERE latest.status IN (
         'CLAIMED','PROCESSING','PENDING','MOCK_PENDING','UNCERTAIN','RECONCILIATION_REQUIRED'
       ))::int AS pending
     FROM payroll_items i
     LEFT JOIN LATERAL (
       SELECT t.status FROM payroll_transfers t
       WHERE t.payroll_item_id=i.id
       ORDER BY t.attempt_number DESC,t.id DESC LIMIT 1
     ) latest ON TRUE
     WHERE i.period_id=$1 AND i.scope=$2 AND i.school_id IS NOT DISTINCT FROM $3`,
    [input.periodId, input.scope, input.schoolId],
  ))[0];
  const total = Number(aggregate.total);
  const paid = Number(aggregate.paid);
  const pending = Number(aggregate.pending);
  const periodStatus =
    total > 0 && paid === total
      ? "COMPLETED"
      : pending > 0
        ? "PROCESSING"
        : paid > 0
          ? "PARTIALLY_COMPLETED"
          : "APPROVED";
  await client.query(
    `UPDATE payroll_periods SET status=$1,updated_at=NOW()
     WHERE id=$2 AND scope=$3 AND school_id IS NOT DISTINCT FROM $4
       AND status IN ('APPROVED','PROCESSING','PARTIALLY_COMPLETED')`,
    [periodStatus, input.periodId, input.scope, input.schoolId],
  );
  return periodStatus;
}

async function createPayrollTransfers(
  req: Request,
  input: { scope: Scope; schoolId: number | null; owner?: boolean },
) {
  const context = input.owner
    ? requirePlatformOwner(req)
    : (() => {
        requireSchoolRole(req, input.schoolId, SCHOOL_FINANCE_ROLES);
        return getUserContext(req);
      })();
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  const requestBody = body(
    input.owner
      ? PayrollContract.CreateCompanyPayrollTransfersBody
      : PayrollContract.CreateSchoolPayrollTransfersBody,
    req.body,
    "Provide one or more approved payroll employee IDs",
  ) as { employeeIds: number[] };
  const headers = body(
    input.owner
      ? PayrollContract.CreateCompanyPayrollTransfersHeader
      : PayrollContract.CreateSchoolPayrollTransfersHeader,
    { "Idempotency-Key": req.header("Idempotency-Key") },
    "A valid, unique payroll-transfer idempotency key is required",
  ) as { "Idempotency-Key": string };
  requireUniqueIds(requestBody.employeeIds, "Salary-transfer employees");
  if (requestBody.employeeIds.length > 100) {
    throw new AuthError(400, "A single salary transfer request is limited to 100 employees");
  }
  const authorizedPeriod = poolRows(await pool.query(
    `SELECT id,status,approved_by
     FROM payroll_periods
     WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3`,
    [periodId, input.scope, input.schoolId],
  ))[0];
  if (!authorizedPeriod) {
    throw new AuthError(404, "Payroll period not found in this tenant");
  }
  if (
    !["APPROVED", "PROCESSING", "PARTIALLY_COMPLETED"].includes(String(authorizedPeriod.status)) ||
    !authorizedPeriod.approved_by
  ) {
    throw new AuthError(409, "A different authorized user must submit and independently approve this payroll run before payout");
  }
  const quickItems = poolRows(await pool.query(
    `SELECT i.id AS payroll_item_id,COALESCE(e.id,c.id) AS employee_id,
       latest.status AS latest_transfer_status,
       latest.requires_reconciliation AS latest_requires_reconciliation
     FROM payroll_items i
     JOIN payroll_periods p ON p.id=i.period_id AND p.scope=i.scope
       AND p.school_id IS NOT DISTINCT FROM i.school_id
     JOIN payroll_employee_profiles ep ON ep.id=i.employee_profile_id
       AND ep.scope=i.scope AND ep.school_id IS NOT DISTINCT FROM i.school_id
     LEFT JOIN employees e ON i.scope='SCHOOL' AND e.id=ep.employee_id AND e.school_id=i.school_id
     LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY'
       AND c.id=ep.company_employee_id
     LEFT JOIN LATERAL (
       SELECT t.status,t.requires_reconciliation
       FROM payroll_transfers t WHERE t.payroll_item_id=i.id
       ORDER BY t.attempt_number DESC,t.id DESC LIMIT 1
     ) latest ON TRUE
     WHERE i.period_id=$1 AND i.scope=$2 AND i.school_id IS NOT DISTINCT FROM $3
       AND COALESCE(e.id,c.id)=ANY($4::int[])`,
    [periodId, input.scope, input.schoolId, requestBody.employeeIds],
  ));
  if (quickItems.length !== requestBody.employeeIds.length) {
    throw new AuthError(404, "Every requested employee must have an item in this approved tenant payroll");
  }
  const itemIdByEmployeeId = new Map(
    quickItems.map((item) => [Number(item.employee_id), Number(item.payroll_item_id)]),
  );
  const requestedDigests = requestBody.employeeIds.map((employeeId) => {
    const payrollItemId = itemIdByEmployeeId.get(employeeId);
    if (!payrollItemId) throw new AuthError(404, "A selected payroll employee was not found");
    return payrollIdempotencyDigest(
      `${headers["Idempotency-Key"]}:payroll-item:${payrollItemId}`,
    );
  });
  const previouslyClaimed = await findTransfersByDigests(
    periodId,
    requestedDigests,
    input.scope,
    input.schoolId,
  );
  if (previouslyClaimed.length === requestedDigests.length) {
    return summarizePayrollTransfers(
      periodId,
      String(previouslyClaimed[0].provider_mode),
      previouslyClaimed,
    );
  }
  if (previouslyClaimed.length > 0) {
    throw new AuthError(
      409,
      "The payroll transfer idempotency key was already used for another employee selection",
      "PAYROLL_IDEMPOTENCY_CONFLICT",
    );
  }
  for (const item of quickItems) {
    if (!item.latest_transfer_status) continue;
    if (item.latest_requires_reconciliation) {
      throw new AuthError(
        409,
        "An earlier salary request has an ambiguous provider result. Reconcile its existing reference before any retry",
        "PAYROLL_TRANSFER_RECONCILIATION_REQUIRED",
      );
    }
    if (["PENDING", "PROCESSING", "CLAIMED", "MOCK_PENDING", "PAID"].includes(String(item.latest_transfer_status))) {
      throw new AuthError(
        409,
        "A salary transfer is already pending, mocked, or paid for this payroll item; a duplicate payout is blocked",
        "PAYROLL_DUPLICATE_TRANSFER",
      );
    }
    if (item.latest_transfer_status !== "FAILED") {
      throw new AuthError(409, "The existing payroll transfer state does not allow a second attempt");
    }
  }
  const capability = configuredPayrollProviderCapability();
  if (capability.mode !== "MOCK" && capability.mode !== "TEST" && capability.mode !== "LIVE") {
    throw new AuthError(
      503,
      capability.transferCapability === "BLOCKED_IN_DEVELOPMENT"
        ? "Real payout calls are blocked in Development; explicitly select the isolated mock mode or a Flutterwave test transfer"
        : "Payouts require an explicitly configured Flutterwave transfer API capability; collection credentials alone do not enable payouts",
      "PAYROLL_TRANSFER_CAPABILITY_UNAVAILABLE",
    );
  }

  if (capability.mode === "TEST" || capability.mode === "LIVE") {
    // Resolve every frozen employee bank account (read-only) before creating
    // even one outgoing transfer. A bad/mismatched beneficiary aborts the
    // entire request; Flutterwave queued transfer responses never imply PAID.
    const preflightRows = poolRows(await pool.query(
      `SELECT i.*,COALESCE(e.id,c.id) AS employee_id
       FROM payroll_items i
       JOIN payroll_periods p ON p.id=i.period_id AND p.scope=i.scope
         AND p.school_id IS NOT DISTINCT FROM i.school_id
       LEFT JOIN employees e ON i.scope='SCHOOL'
         AND e.school_id=i.school_id AND e.id=(
           SELECT ep.employee_id FROM payroll_employee_profiles ep
           WHERE ep.id=i.employee_profile_id AND ep.scope='SCHOOL' AND ep.school_id=i.school_id)
       LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY' AND c.id=(
           SELECT ep.company_employee_id FROM payroll_employee_profiles ep
           WHERE ep.id=i.employee_profile_id AND ep.scope='YEMAIT_COMPANY' AND ep.school_id IS NULL)
       WHERE i.period_id=$1 AND i.scope=$2 AND i.school_id IS NOT DISTINCT FROM $3
         AND COALESCE(e.id,c.id)=ANY($4::int[])`,
      [periodId, input.scope, input.schoolId, requestBody.employeeIds],
    ));
    if (preflightRows.length !== requestBody.employeeIds.length) {
      throw new AuthError(404, "Every requested employee must have an item in this approved tenant payroll");
    }
    for (const employee of preflightRows) {
      const amountMinor = Number(employee.net_salary_minor);
      if (
        !Number.isSafeInteger(amountMinor) ||
        amountMinor <= 0 ||
        amountMinor % 100 !== 0
      ) {
        throw new AuthError(
          400,
          "Each salary transfer must be a positive, whole-naira NGN amount supported by the documented Flutterwave v3 transfer API",
        );
      }
    }
    const bankAccounts = await resolvePayrollBeneficiaries(
      preflightRows,
      input.scope,
      input.schoolId,
    );
    for (let index = 0; index < preflightRows.length; index += 5) {
      await Promise.all(
        bankAccounts.slice(index, index + 5).map(async (bank) => {
          const result = await flw.resolveNigerianAccount({
            bankCode: bank.bankCode,
            accountNumber: bank.accountNumber,
          });
          if (
            normalizeResolvedAccountName(result.resolvedAccountName) !==
            normalizeResolvedAccountName(bank.accountName)
          ) {
            throw new AuthError(
              409,
              "The provider-verified beneficiary name did not match this frozen payroll employee; no salary transfer was submitted",
              "PAYROLL_BENEFICIARY_MISMATCH",
            );
          }
        }),
      );
    }
  }

  const claimed = await withTransaction(async (client) => {
    const period = poolRows(await client.query(
      `SELECT id,status,approved_by,submitted_by,period_month
       FROM payroll_periods WHERE id=$1 AND scope=$2
         AND school_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [periodId, input.scope, input.schoolId],
    ))[0];
    if (!period) throw new AuthError(404, "Approved payroll period not found in this tenant");
    if (
      !["APPROVED", "PROCESSING", "PARTIALLY_COMPLETED"].includes(
        String(period.status),
      ) ||
      !period.approved_by
    ) {
      throw new AuthError(409, "A different authorized user must submit and independently approve this payroll run before payout");
    }
    const items = poolRows(await client.query(
      `SELECT i.*,COALESCE(e.id,c.id) AS employee_id,
          latest.status AS latest_transfer_status,
          latest.attempt_number AS latest_attempt_number,
          latest.requires_reconciliation AS latest_requires_reconciliation
       FROM payroll_items i
       JOIN payroll_employee_profiles ep ON ep.id=i.employee_profile_id
          AND ep.scope=i.scope AND ep.school_id IS NOT DISTINCT FROM i.school_id
       LEFT JOIN employees e ON i.scope='SCHOOL' AND e.id=ep.employee_id AND e.school_id=i.school_id
       LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY'
          AND c.id=ep.company_employee_id
       LEFT JOIN LATERAL (
         SELECT pt.status,pt.attempt_number,pt.requires_reconciliation
         FROM payroll_transfers pt WHERE pt.payroll_item_id=i.id
         ORDER BY pt.attempt_number DESC,pt.id DESC LIMIT 1
       ) latest ON TRUE
       WHERE i.period_id=$1 AND i.scope=$2 AND i.school_id IS NOT DISTINCT FROM $3
         AND COALESCE(e.id,c.id)=ANY($4::int[])
       ORDER BY i.id FOR UPDATE OF i`,
      [periodId, input.scope, input.schoolId, requestBody.employeeIds],
    ));
    if (items.length !== requestBody.employeeIds.length) {
      throw new AuthError(404, "Every employee must have a same-tenant frozen item in this approved period");
    }
    const byEmployee = new Map(items.map((item) => [Number(item.employee_id), item]));
    const ordered = requestBody.employeeIds.map((employeeId) => byEmployee.get(employeeId));
    if (ordered.some((item) => !item)) {
      throw new AuthError(404, "A requested employee is not in this payroll period");
    }
    const digests = ordered.map((item) => payrollIdempotencyDigest(
      `${headers["Idempotency-Key"]}:payroll-item:${item?.id}`,
    ));
    const existingRows = poolRows(await client.query(
      `SELECT idempotency_key_hash FROM payroll_transfers
       WHERE period_id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3
         AND idempotency_key_hash=ANY($4::text[])`,
      [periodId, input.scope, input.schoolId, digests],
    ));
    if (existingRows.length === digests.length) {
      const prior = poolRows(await client.query(
        `${TRANSFER_SELECT}
         WHERE t.period_id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3
           AND t.idempotency_key_hash=ANY($4::text[])
         ORDER BY t.payroll_item_id`,
        [periodId, input.scope, input.schoolId, digests],
      ));
      return { idempotent: true, rows: prior };
    }
    if (existingRows.length !== 0) {
      throw new AuthError(
        409,
        "The payroll transfer idempotency key was already used for another employee selection",
        "PAYROLL_IDEMPOTENCY_CONFLICT",
      );
    }
    for (const item of ordered) {
      if (!item) throw new AuthError(404, "Payroll employee item not found");
      if (item.latest_transfer_status) {
        if (item.latest_requires_reconciliation) {
          throw new AuthError(
            409,
            "An earlier salary request has an ambiguous provider result. Reconcile its existing reference before any retry",
            "PAYROLL_TRANSFER_RECONCILIATION_REQUIRED",
          );
        }
        if (["PENDING", "PROCESSING", "CLAIMED", "MOCK_PENDING", "PAID"].includes(String(item.latest_transfer_status))) {
          throw new AuthError(
            409,
            "A salary transfer is already pending, mocked, or paid for this payroll item; a duplicate payout is blocked",
            "PAYROLL_DUPLICATE_TRANSFER",
          );
        }
        if (item.latest_transfer_status !== "FAILED") {
          throw new AuthError(409, "The existing payroll transfer state does not allow a second attempt");
        }
      }
    }

    const rows: AnyRow[] = [];
    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index] as AnyRow;
      const amountMinor = Number(item.net_salary_minor);
      if (amountMinor <= 0 || !Number.isSafeInteger(amountMinor) || amountMinor % 100 !== 0) {
        throw new AuthError(
          400,
          "Each salary transfer must be a positive, whole-naira NGN amount supported by Flutterwave v3",
        );
      }
      const attemptNumber = Number(item.latest_attempt_number ?? 0) + 1;
      const providerReference = `YMTPAY-${randomUUID().replaceAll("-", "")}`;
      const initialStatus = capability.mode === "MOCK" ? "MOCK_PENDING" : "CLAIMED";
      const provider = capability.mode === "MOCK" ? "MOCK" : "FLUTTERWAVE";
      const row = poolRows(await client.query(
        `INSERT INTO payroll_transfers
           (scope,school_id,period_id,payroll_item_id,attempt_number,
            idempotency_key_hash,provider,provider_mode,provider_reference,
            amount_minor,status,requires_reconciliation,requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)
         RETURNING id,scope,school_id,period_id,payroll_item_id,attempt_number,
           idempotency_key_hash,provider,provider_mode,provider_reference,
           provider_transaction_id,amount_minor,provider_fee_minor,
           settlement_amount_minor,currency,status,requires_reconciliation,
           external_transfer_verified,provider_status,failure_message,
           requested_by,verified_by,verified_at,created_at`,
        [
          input.scope,
          input.schoolId,
          periodId,
          item.id,
          attemptNumber,
          digests[index],
          provider,
          capability.mode,
          providerReference,
          amountMinor,
          initialStatus,
          context.user.id,
        ],
      ))[0];
      const recipientDirectoryId = Number(item.employee_id);
      rows.push({ ...row, employee_id: recipientDirectoryId });
      await audit(client, {
        actor: context.user,
        actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
        scope: input.scope,
        schoolId: input.schoolId,
        recordType: "PAYROLL_TRANSFER",
        recordId: row.id as number,
        action: capability.mode === "MOCK"
          ? "DEVELOPMENT_PAYROLL_MOCK_REQUESTED"
          : "PAYROLL_TRANSFER_SUBMITTED",
        amountMinor,
        providerReference,
        newStatus: initialStatus,
        metadata: {
          payrollItemId: item.id,
          employeeId: recipientDirectoryId,
          providerMode: capability.mode,
          attempt: attemptNumber,
          externalTransferVerified: false,
          mockIsNotPayment: capability.mode === "MOCK",
        },
      });
    }
    if (capability.mode !== "MOCK") {
      await client.query(
        `UPDATE payroll_periods SET status='PROCESSING',updated_at=NOW()
         WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3`,
        [periodId, input.scope, input.schoolId],
      );
    } else {
      await client.query(
        `UPDATE payroll_periods SET status='PROCESSING',updated_at=NOW()
         WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3`,
        [periodId, input.scope, input.schoolId],
      );
    }
    return { idempotent: false, rows };
  });

  let rows = claimed.rows;
  if (!claimed.idempotent && capability.mode !== "MOCK") {
    for (const claimedRow of rows) {
      const item = poolRows(await pool.query(
        `SELECT i.bank_name_encrypted,i.bank_code_encrypted,
           i.account_name_encrypted,i.account_number_encrypted,
           i.account_last4,i.encryption_key_version,i.period_month
         FROM payroll_items i
         WHERE i.id=$1 AND i.period_id=$2 AND i.scope=$3
           AND i.school_id IS NOT DISTINCT FROM $4`,
        [claimedRow.payroll_item_id, periodId, input.scope, input.schoolId],
      ))[0];
      if (!item) {
        throw new AuthError(503, "Frozen employee banking details are unavailable; reconcile the durable payout attempt");
      }
      const employeeId = Number(claimedRow.employee_id);
      const bank = decryptBankRecord(
        item,
        payrollBankAAD(input.scope, input.schoolId, employeeId),
      );
      try {
        const accepted = await flw.createNgnTransfer({
          reference: String(claimedRow.provider_reference),
          bankCode: bank.bankCode,
          accountNumber: bank.accountNumber,
          amountNaira: Number(claimedRow.amount_minor) / 100,
          periodMonth: String(item.period_month),
        });
        const newStatus = accepted.providerTransferId ? "PENDING" : "RECONCILIATION_REQUIRED";
        const requiresReconciliation = !accepted.providerTransferId;
        await withTransaction(async (client) => {
          const updated = await client.query(
            `UPDATE payroll_transfers SET status=$1,provider_transaction_id=$2,
               provider_status='QUEUED',requires_reconciliation=$3,updated_at=NOW()
             WHERE id=$4 AND status='CLAIMED' AND provider_reference=$5
             RETURNING status`,
            [
              newStatus,
              accepted.providerTransferId,
              requiresReconciliation,
              claimedRow.id,
              claimedRow.provider_reference,
            ],
          );
          if (updated.rowCount !== 1) {
            throw new AuthError(503, "The durable salary-transfer claim changed; review and reconcile before further action");
          }
          claimedRow.status = newStatus;
          claimedRow.provider_transaction_id = accepted.providerTransferId;
          claimedRow.provider_status = "QUEUED";
          claimedRow.requires_reconciliation = requiresReconciliation;
          await audit(client, {
            actor: context.user,
            actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
            scope: input.scope,
            schoolId: input.schoolId,
            recordType: "PAYROLL_TRANSFER",
            recordId: Number(claimedRow.id),
            action: "FLUTTERWAVE_TRANSFER_QUEUED",
            amountMinor: Number(claimedRow.amount_minor),
            providerReference: String(claimedRow.provider_reference),
            previousStatus: "CLAIMED",
            newStatus,
            metadata: {
              providerMode: capability.mode,
              externalTransferVerified: false,
              transferIdReceived: accepted.providerTransferId !== null,
            },
          });
        });
      } catch (error) {
        if (!(error instanceof FlutterwavePayrollAmbiguousError)) throw error;
        await withTransaction(async (client) => {
          const updated = await client.query(
            `UPDATE payroll_transfers SET status='RECONCILIATION_REQUIRED',
               requires_reconciliation=true,provider_status='UNKNOWN',
               failure_message='Flutterwave acceptance was ambiguous; query the existing reference before retry.',
               updated_at=NOW()
             WHERE id=$1 AND scope=$2 AND school_id IS NOT DISTINCT FROM $3
               AND status IN ('CLAIMED','PROCESSING','PENDING')
             RETURNING id`,
            [claimedRow.id, input.scope, input.schoolId],
          );
          if (updated.rowCount !== 1) {
            throw new AuthError(503, "An uncertain payout must be reconciled using its existing provider reference");
          }
          claimedRow.status = "RECONCILIATION_REQUIRED";
          claimedRow.requires_reconciliation = true;
          claimedRow.provider_status = "UNKNOWN";
          await audit(client, {
            actor: context.user,
            actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
            scope: input.scope,
            schoolId: input.schoolId,
            recordType: "PAYROLL_TRANSFER",
            recordId: Number(claimedRow.id),
            action: "FLUTTERWAVE_TRANSFER_OUTCOME_AMBIGUOUS",
            amountMinor: Number(claimedRow.amount_minor),
            providerReference: String(claimedRow.provider_reference),
            previousStatus: "CLAIMED",
            newStatus: "RECONCILIATION_REQUIRED",
            metadata: {
              providerMode: capability.mode,
              retryBlocked: true,
              providerResponseStored: false,
            },
          });
        });
      }
    }
  }
  if (claimed.idempotent) {
    const expectedDigests = requestBody.employeeIds.map((employeeId) => {
      const match = claimed.rows.find((row) => Number(row.employee_id) === employeeId);
      if (!match) throw new AuthError(409, "Idempotent payout request did not match its original employee set");
      const query = match as AnyRow;
      return payrollIdempotencyDigest(`${headers["Idempotency-Key"]}:payroll-item:${query.payroll_item_id}`);
    });
    rows = await findTransfersByDigests(periodId, expectedDigests, input.scope, input.schoolId);
  } else if (capability.mode === "MOCK") {
    rows = claimed.rows;
  } else {
    // Re-read by the durable transfer IDs so every field shown to the client is
    // the persisted, scoped provider state rather than an optimistic response.
    rows = await findTransfersForPayrollItems(
      periodId,
      claimed.rows.map((row) => Number(row.payroll_item_id)),
      input.scope,
      input.schoolId,
    );
  }
  const items = rows.map(transferRowProjection);
  const summarized = {
    ...summarizePayrollTransfers(periodId, capability.mode, rows),
  };
  return summarized;
}

function summarizePayrollTransfers(periodId: number, providerMode: string, rows: AnyRow[]) {
  const items = rows.map(transferRowProjection);
  return {
    periodId,
    providerMode,
    items,
    total: items.length,
    paidCount: items.filter((item) => item.status === "PAID").length,
    pendingCount: items.filter((item) =>
      ["CLAIMED", "PROCESSING", "PENDING", "MOCK_PENDING"].includes(item.status as string),
    ).length,
    failedCount: items.filter((item) => item.status === "FAILED").length,
    uncertainCount: items.filter((item) =>
      ["UNCERTAIN", "RECONCILIATION_REQUIRED"].includes(item.status as string),
    ).length,
  };
}

async function findTransfersByDigests(
  periodId: number,
  digests: string[],
  scope: Scope,
  schoolId: number | null,
) {
  return poolRows(await pool.query(
    `${TRANSFER_SELECT}
     WHERE t.period_id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3
       AND t.idempotency_key_hash=ANY($4::text[])
     ORDER BY t.payroll_item_id,t.attempt_number`,
    [periodId, scope, schoolId, digests],
  ));
}

async function resolvePayrollBeneficiaries(
  items: AnyRow[],
  scope: Scope,
  schoolId: number | null,
) {
  return items.map((item) => {
    const employeeId = Number(item.employee_id);
    const bank = decryptBankRecord(
      item,
      payrollBankAAD(scope, schoolId, employeeId),
    );
    return { employeeId, ...bank };
  });
}

async function findTransfersForPayrollItems(
  periodId: number,
  payrollItemIds: number[],
  scope: Scope,
  schoolId: number | null,
) {
  return poolRows(await pool.query(
    `${TRANSFER_SELECT}
     WHERE t.period_id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3
       AND t.payroll_item_id=ANY($4::int[])
     ORDER BY t.id DESC`,
    [periodId, scope, schoolId, payrollItemIds],
  ));
}

router.post("/schools/:schoolId/finance/payroll/periods/:periodId/transfers", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_FINANCE_ROLES);
  const periodId = assertResourceId(req.params.periodId, "Payroll period");
  const result = await createPayrollTransfers(req, { scope: "SCHOOL", schoolId });
  return respond(
    res,
    PayrollContract.CreateSchoolPayrollTransfersResponse,
    result,
    202,
  );
}));

router.post("/platform/finance/company-payroll/periods/:periodId/transfers", run(async (req, res) => {
  requirePlatformOwner(req);
  const result = await createPayrollTransfers(req, {
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    owner: true,
  });
  return respond(
    res,
    PayrollContract.CreateCompanyPayrollTransfersResponse,
    result,
    202,
  );
}));

async function reconcilePayrollTransfer(
  req: Request,
  input: { scope: Scope; schoolId: number | null; owner?: boolean },
) {
  const context = input.owner
    ? requirePlatformOwner(req)
    : (() => {
        requireSchoolRole(req, input.schoolId, SCHOOL_FINANCE_ROLES);
        return getUserContext(req);
      })();
  const transferId = assertResourceId(req.params.transferId, "Payroll transfer");
  const current = poolRows(await pool.query(
    `SELECT t.id,t.scope,t.school_id,t.period_id,t.payroll_item_id,t.attempt_number,
       t.idempotency_key_hash,t.provider,t.provider_mode,t.provider_reference,
       t.provider_transaction_id,t.amount_minor,t.provider_fee_minor,
       t.settlement_amount_minor,t.currency,t.status,t.requires_reconciliation,
       t.external_transfer_verified,t.provider_status,t.failure_message,
       t.requested_by,t.verified_by,t.verified_at,t.created_at,
       i.employee_name_snapshot,i.period_month,i.bank_name_encrypted,
       i.bank_code_encrypted,i.account_name_encrypted,i.account_number_encrypted,
       i.account_last4,i.encryption_key_version,
       COALESCE(e.id,c.id) AS employee_id
     FROM payroll_transfers t
     JOIN payroll_items i ON i.id=t.payroll_item_id AND i.period_id=t.period_id
       AND i.scope=t.scope AND i.school_id IS NOT DISTINCT FROM t.school_id
     JOIN payroll_periods p ON p.id=t.period_id AND p.scope=t.scope
       AND p.school_id IS NOT DISTINCT FROM t.school_id
     JOIN payroll_employee_profiles ep ON ep.id=i.employee_profile_id
       AND ep.scope=i.scope AND ep.school_id IS NOT DISTINCT FROM i.school_id
     LEFT JOIN employees e ON i.scope='SCHOOL' AND e.id=ep.employee_id AND e.school_id=i.school_id
     LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY' AND c.id=ep.company_employee_id
     WHERE t.id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3`,
    [transferId, input.scope, input.schoolId],
  ))[0];
  if (!current) throw new AuthError(404, "Payroll transfer not found in this tenant");
  if (current.provider_mode === "MOCK") {
    return transferRowProjection(current);
  }
  if (
    current.status === "PAID" ||
    (current.status === "FAILED" && current.external_transfer_verified)
  ) {
    return transferRowProjection(current);
  }
  if (
    !["CLAIMED", "PROCESSING", "PENDING", "UNCERTAIN", "RECONCILIATION_REQUIRED"].includes(
      String(current.status),
    )
  ) {
    throw new AuthError(409, "This transfer is not awaiting safe provider reconciliation");
  }
  const employeeId = Number(current.employee_id);
  const bank = decryptBankRecord(
    current,
    payrollBankAAD(input.scope, input.schoolId, employeeId),
  );
  const amountMinor = Number(current.amount_minor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor % 100 !== 0) {
    throw new AuthError(503, "The stored salary amount cannot be verified safely against a Flutterwave v3 transfer");
  }

  const verified = current.provider_transaction_id
    ? await flw.verifyNgnTransferById({
        transferId: String(current.provider_transaction_id),
        expectedReference: String(current.provider_reference),
        expectedBankCode: bank.bankCode,
        expectedAccountNumber: bank.accountNumber,
        expectedAmountNaira: amountMinor / 100,
      })
    : await flw.verifyNgnTransferByReference({
        reference: String(current.provider_reference),
        expectedBankCode: bank.bankCode,
        expectedAccountNumber: bank.accountNumber,
        expectedAmountNaira: amountMinor / 100,
      });
  if (!verified) {
    // An empty/lagging provider index does not prove failure: persist and return
    // the prior state, leaving the item frozen for the same-reference retry.
    return transferRowProjection(current);
  }
  const verifiedProviderFeeMinor = Math.round(verified.providerFeeNaira * 100);
  if (
    !Number.isSafeInteger(verifiedProviderFeeMinor) ||
    verifiedProviderFeeMinor < 0
  ) {
    throw new AuthError(503, "Flutterwave returned an invalid NGN provider fee for this salary transfer");
  }
  const status =
    verified.status === "SUCCESSFUL"
      ? "PAID"
      : verified.status === "FAILED"
        ? "FAILED"
        : "PENDING";
  const saved = await withTransaction(async (client) => {
    const locked = poolRows(await client.query(
      `SELECT id,status,requires_reconciliation,provider_reference
       FROM payroll_transfers WHERE id=$1 AND scope=$2
         AND school_id IS NOT DISTINCT FROM $3 FOR UPDATE`,
      [transferId, input.scope, input.schoolId],
    ))[0];
    if (!locked) throw new AuthError(404, "Payroll transfer not found");
    if (locked.status === "PAID" || (locked.status === "FAILED" && !locked.requires_reconciliation)) {
      return false;
    }
    if (locked.provider_reference !== current.provider_reference) {
      throw new AuthError(409, "The stored Flutterwave reference changed while reconciling this salary item");
    }
    const settledAmountMinor = status === "PAID" ? amountMinor : 0;
    await client.query(
      `UPDATE payroll_transfers SET status=$1,provider_transaction_id=$2,
         provider_status=$3,provider_fee_minor=$4,settlement_amount_minor=$5,
         requires_reconciliation=false,external_transfer_verified=true,
         failure_message=NULL,verified_by=$6,verified_at=NOW(),updated_at=NOW()
       WHERE id=$7 AND scope=$8 AND school_id IS NOT DISTINCT FROM $9`,
      [
        status,
        verified.transferId,
        verified.status,
        verifiedProviderFeeMinor,
        settledAmountMinor,
        context.user.id,
        transferId,
        input.scope,
        input.schoolId,
      ],
    );
    if (status === "PAID") {
      await client.query(
        `INSERT INTO payroll_payslips (
           scope,school_id,period_id,payroll_item_id,transfer_id,payslip_number,
           employee_name_snapshot,employee_role_snapshot,period_month,
           base_salary_minor,allowance_minor,bonus_minor,deduction_minor,
           adjustment_minor,net_salary_minor,currency
         )
         SELECT i.scope,i.school_id,i.period_id,i.id,$1,$2,i.employee_name_snapshot,
           i.role_snapshot,i.period_month,i.base_salary_minor,i.allowance_minor,
           i.bonus_minor,i.deduction_minor,i.adjustment_minor,i.net_salary_minor,'NGN'
         FROM payroll_items i
         WHERE i.id=$3 AND i.period_id=$4 AND i.scope=$5
           AND i.school_id IS NOT DISTINCT FROM $6
         ON CONFLICT (payroll_item_id) DO NOTHING`,
        [
          transferId,
          `YMT-${String(current.period_month).replace("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 20)}`,
          current.payroll_item_id,
          current.period_id,
          input.scope,
          input.schoolId,
        ],
      );
    }
    await recalculatePeriodProviderStatus(client, {
      periodId: Number(current.period_id),
      scope: input.scope,
      schoolId: input.schoolId,
    });
    await audit(client, {
      actor: context.user,
      actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
      scope: input.scope,
      schoolId: input.schoolId,
      recordType: "PAYROLL_TRANSFER",
      recordId: transferId,
      action: status === "PAID"
        ? "FLUTTERWAVE_TRANSFER_SUCCESS_VERIFIED"
        : status === "FAILED"
          ? "FLUTTERWAVE_TRANSFER_FAILURE_VERIFIED"
          : "FLUTTERWAVE_TRANSFER_PENDING_VERIFIED",
      amountMinor,
      providerReference: String(current.provider_reference),
      previousStatus: String(current.status),
      newStatus: status,
      metadata: providerSafeMetadata(verified.status, amountMinor),
    });
    if (status === "PAID") {
      await audit(client, {
        actor: context.user,
        actorRole: input.owner ? "PLATFORM_OWNER" : "SCHOOL_FINANCE",
        scope: input.scope,
        schoolId: input.schoolId,
        recordType: "PAYSLIP",
        recordId: Number(current.payroll_item_id),
        action: "PROVIDER_VERIFIED_PAYSLIP_ISSUED",
        amountMinor,
        providerReference: String(current.provider_reference),
        previousStatus: "PENDING",
        newStatus: "PAID",
        metadata: {
          payrollItemId: current.payroll_item_id,
          employeeId,
          accountLast4: current.account_last4,
          providerTransactionId: verified.transferId,
        },
      });
    }
    return true;
  });
  if (!saved) {
    const unchanged = poolRows(await pool.query(
      `${TRANSFER_SELECT}
       WHERE t.id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3`,
      [transferId, input.scope, input.schoolId],
    ))[0];
    return transferRowProjection(unchanged);
  }
  const updated = poolRows(await pool.query(
    `${TRANSFER_SELECT}
     WHERE t.id=$1 AND t.scope=$2 AND t.school_id IS NOT DISTINCT FROM $3`,
    [transferId, input.scope, input.schoolId],
  ))[0];
  return transferRowProjection(updated);
}

router.post("/schools/:schoolId/finance/payroll/transfers/:transferId/reconcile", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_FINANCE_ROLES);
  const response = await reconcilePayrollTransfer(req, { scope: "SCHOOL", schoolId });
  return respond(res, PayrollContract.ReconcileSchoolPayrollTransferResponse, response);
}));

router.post("/platform/finance/company-payroll/transfers/:transferId/reconcile", run(async (req, res) => {
  requirePlatformOwner(req);
  const response = await reconcilePayrollTransfer(req, {
    scope: "YEMAIT_COMPANY",
    schoolId: null,
    owner: true,
  });
  return respond(res, PayrollContract.ReconcileCompanyPayrollTransferResponse, response);
}));

// ---------------------------------------------------------------------------
// Tenant-filtered money movement history and month-by-month payroll reports.
// Incoming provider collection rows are deliberately NOT called settled:
// merchant collection evidence alone does not prove the provider paid a
// configured school account or allocate collection revenue to that account.
// ---------------------------------------------------------------------------

async function settlementHistory(input: {
  scope: "SCHOOL" | "PLATFORM";
  schoolId?: number | null;
  filters: {
    schoolId?: number | null;
    status?: string;
    from?: Date | string;
    to?: Date | string;
    limit: number;
    cursor: number;
  };
}) {
  const dateRange = parseOptionalDateRange(input.filters.from, input.filters.to);
  const filterParameters: unknown[] = [
    input.scope,
    input.schoolId ?? null,
    input.filters.status ?? null,
    dateRange.from,
    dateRange.to,
    input.filters.limit,
    input.filters.cursor,
    input.filters.schoolId ?? null,
  ];
  const rows = poolRows(await pool.query(
    `WITH entries AS (
       SELECT
         'PAYROLL_TRANSFER'::text AS kind,t.id AS source_id,t.scope,t.school_id,
         s.name AS school_name,t.provider_reference AS source_reference,
         t.provider_transaction_id AS provider_reference,t.amount_minor AS gross,
         t.provider_fee_minor AS provider_fee,
         t.settlement_amount_minor AS amount_settled,'NGN'::text AS currency,
         CASE
           WHEN t.status='PAID' THEN 'SUCCESS'
           WHEN t.status='FAILED' THEN 'FAILED'
           WHEN t.status='MOCK_PENDING' THEN 'MOCK_PENDING'
           WHEN t.status IN ('UNCERTAIN','RECONCILIATION_REQUIRED') THEN 'RECONCILIATION_REQUIRED'
           ELSE 'PENDING'
         END AS status,
         CASE
           WHEN t.provider_mode='MOCK' THEN 'NOT_APPLICABLE'
           WHEN t.requires_reconciliation THEN 'UNRECONCILED'
           WHEN t.external_transfer_verified THEN 'RECONCILED'
           ELSE 'PENDING'
         END AS reconciliation_status,
         (t.status IN ('PAID','FAILED') AND t.external_transfer_verified) AS external_verified,
         COALESCE(t.verified_at,t.created_at) AS occurred_at
       FROM payroll_transfers t
       LEFT JOIN schools s ON s.id=t.school_id AND t.scope='SCHOOL'
       WHERE ($1::text='PLATFORM' OR (t.scope='SCHOOL' AND t.school_id=$2))
         AND ($8::int IS NULL OR t.school_id=$8)
         AND ($3::text IS NULL OR
           CASE
             WHEN t.status='PAID' THEN 'SUCCESS'
             WHEN t.status='FAILED' THEN 'FAILED'
             WHEN t.status='MOCK_PENDING' THEN 'MOCK_PENDING'
             WHEN t.status IN ('UNCERTAIN','RECONCILIATION_REQUIRED') THEN 'RECONCILIATION_REQUIRED'
             ELSE 'PENDING'
           END=$3)
       UNION ALL
       SELECT
         'COLLECTION'::text AS kind,fp.id AS source_id,'SCHOOL'::text AS scope,
         fp.school_id,s.name AS school_name,fp.reference AS source_reference,
         fp.provider_transaction_id AS provider_reference,fp.amount_minor AS gross,
         NULL::bigint AS provider_fee,
         CASE WHEN fp.method='BANK_TRANSFER' AND fp.status='VERIFIED'
           THEN fp.amount_minor ELSE 0 END AS amount_settled,
         fp.currency,
         CASE
           WHEN fp.method='BANK_TRANSFER' AND fp.status='VERIFIED' THEN 'SUCCESS'
           WHEN fp.status IN ('FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED') THEN 'FAILED'
           WHEN fp.status='VERIFIED' THEN 'NOT_SETTLED'
           ELSE 'PENDING'
         END AS status,
         CASE
           WHEN fp.method='BANK_TRANSFER' AND fp.status='VERIFIED' THEN 'RECONCILED'
           WHEN fp.status IN ('FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED') THEN 'RECONCILED'
           ELSE 'PENDING'
         END AS reconciliation_status,
         (fp.method='BANK_TRANSFER' AND fp.status='VERIFIED') AS external_verified,
         COALESCE(fp.verified_at,fp.created_at) AS occurred_at
       FROM fee_payments fp
       JOIN fee_invoices i ON i.id=fp.invoice_id AND i.school_id=fp.school_id
       JOIN schools s ON s.id=fp.school_id
       WHERE ($1::text='PLATFORM' OR fp.school_id=$2)
         AND ($8::int IS NULL OR fp.school_id=$8)
         AND ($3::text IS NULL OR
           CASE
             WHEN fp.method='BANK_TRANSFER' AND fp.status='VERIFIED' THEN 'SUCCESS'
             WHEN fp.status IN ('FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED') THEN 'FAILED'
             WHEN fp.status='VERIFIED' THEN 'NOT_SETTLED'
             ELSE 'PENDING'
           END=$3)
     ), filtered AS (
       SELECT * FROM entries
       WHERE ($4::date IS NULL OR occurred_at::date >= $4::date)
         AND ($5::date IS NULL OR occurred_at::date <= $5::date)
     ), numbered AS (
       SELECT ROW_NUMBER() OVER (
           ORDER BY occurred_at DESC,kind,source_id DESC
         )::int AS id,* FROM filtered
     )
     SELECT id,scope,school_id AS school_id,school_name,source_reference,
       provider_reference,gross,provider_fee,amount_settled,currency,status,
       reconciliation_status,external_verified,occurred_at
     FROM numbered
     ORDER BY occurred_at DESC,kind,source_id DESC
     OFFSET $7 LIMIT $6`,
    filterParameters,
  ));
  return rows.map((row) => ({
    id: Number(row.id),
    scope: row.scope,
    schoolId: row.school_id == null ? null : Number(row.school_id),
    schoolName: row.school_name ?? null,
    sourceTransactionReference: row.source_reference ?? null,
    providerReference: row.provider_reference ?? null,
    grossAmountMinor: Number(row.gross),
    ...(row.provider_fee == null ? {} : { providerFeeMinor: Number(row.provider_fee) }),
    amountSettledMinor: Number(row.amount_settled),
    currency: row.currency,
    status: row.status,
    reconciliationStatus: row.reconciliation_status,
    externalSettlementVerified: Boolean(row.external_verified),
    occurredAt: row.occurred_at,
  }));
}

router.get("/schools/:schoolId/finance/settlement/history", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  const params = body(
    PayrollContract.ListSchoolSettlementHistoryParams,
    req.params,
    "Invalid settlement history school",
  );
  const filters = body(
    PayrollContract.ListSchoolSettlementHistoryQueryParams,
    parseSettlementHistoryQueryDates(req.query),
    "Invalid school settlement history filter",
  );
  const result = await settlementHistory({
    scope: "SCHOOL",
    schoolId: params.schoolId,
    filters: {
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      cursor: filters.cursor,
    },
  });
  return respond(res, PayrollContract.ListSchoolSettlementHistoryResponse, result);
}));

router.get("/platform/finance/settlement-history", run(async (req, res) => {
  requirePlatformOwner(req);
  const filters = body(
    PayrollContract.ListPlatformSettlementHistoryQueryParams,
    parseSettlementHistoryQueryDates(req.query),
    "Invalid platform settlement history filter",
  );
  if (filters.status && !["PENDING", "SUCCESS", "FAILED", "MOCK_PENDING", "RECONCILIATION_REQUIRED", "NOT_SETTLED"].includes(filters.status)) {
    throw new AuthError(400, "Settlement-history status must use a supported payroll/payment status");
  }
  return respond(
    res,
    PayrollContract.ListPlatformSettlementHistoryResponse,
    await settlementHistory({
      scope: "PLATFORM",
      filters: {
        schoolId: filters.schoolId,
        status: filters.status,
        from: filters.from,
        to: filters.to,
        limit: filters.limit,
        cursor: filters.cursor,
      },
    }),
  );
}));

async function readPayrollReport(input: {
  scope: Scope;
  schoolId: number | null;
  fromMonth: string;
  toMonth: string;
}) {
  const rows = poolRows(await pool.query(
    `SELECT i.period_month AS period_month,COUNT(*)::int AS employee_count,
       SUM(i.base_salary_minor)::bigint AS gross,
       SUM(i.allowance_minor)::bigint AS allowance,
       SUM(i.bonus_minor)::bigint AS bonus,
       SUM(i.deduction_minor)::bigint AS deduction,
       SUM(i.net_salary_minor)::bigint AS net,
       SUM(CASE WHEN latest.status='PAID' AND latest.external_transfer_verified
         THEN i.net_salary_minor ELSE 0 END)::bigint AS paid_amount,
       SUM(CASE
         WHEN latest.status IS NULL OR latest.status IN (
           'CLAIMED','PROCESSING','PENDING','MOCK_PENDING','UNCERTAIN','RECONCILIATION_REQUIRED'
         ) THEN i.net_salary_minor ELSE 0 END)::bigint AS pending_amount,
       COUNT(*) FILTER (WHERE latest.status='FAILED')::int AS failed_count
     FROM payroll_items i
     JOIN payroll_periods p ON p.id=i.period_id AND p.scope=i.scope
       AND p.school_id IS NOT DISTINCT FROM i.school_id
     LEFT JOIN LATERAL (
       SELECT t.status,t.external_transfer_verified
       FROM payroll_transfers t WHERE t.payroll_item_id=i.id
       ORDER BY t.attempt_number DESC,t.id DESC LIMIT 1
     ) latest ON TRUE
     WHERE i.scope=$1 AND i.school_id IS NOT DISTINCT FROM $2
       AND i.period_month BETWEEN $3 AND $4
     GROUP BY i.period_month ORDER BY i.period_month`,
    [input.scope, input.schoolId, input.fromMonth, input.toMonth],
  ));
  return rows.map((row) => {
    const values = [
      Number(row.employee_count),
      Number(row.gross),
      Number(row.allowance),
      Number(row.bonus),
      Number(row.deduction),
      Number(row.net),
      Number(row.paid_amount),
      Number(row.pending_amount),
      Number(row.failed_count),
    ];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new AuthError(503, "A payroll report contains unsafe NGN minor-unit totals");
    }
    return {
      periodMonth: row.period_month,
      employeeCount: values[0],
      grossSalaryMinor: values[1],
      allowanceMinor: values[2],
      bonusMinor: values[3],
      deductionMinor: values[4],
      netSalaryMinor: values[5],
      paidAmountMinor: values[6],
      pendingAmountMinor: values[7],
      failedCount: values[8],
      currency: "NGN",
    };
  });
}

router.get("/schools/:schoolId/finance/payroll/report", run(async (req, res) => {
  const { schoolId } = requireSchoolRole(req, req.params.schoolId, SCHOOL_PAYROLL_ROLES);
  const params = body(
    PayrollContract.GetSchoolPayrollReportParams,
    req.params,
    "Invalid school payroll-report path",
  );
  const query = body(
    PayrollContract.GetSchoolPayrollReportQueryParams,
    req.query,
    "Invalid school payroll-report range",
  );
  const { fromMonth, toMonth } = parsePayrollMonthRange(query.fromMonth, query.toMonth);
  return respond(
    res,
    PayrollContract.GetSchoolPayrollReportResponse,
    await readPayrollReport({ scope: "SCHOOL", schoolId: params.schoolId, fromMonth, toMonth }),
  );
}));

router.get("/platform/finance/company-payroll/report", run(async (req, res) => {
  requirePlatformOwner(req);
  const query = body(
    PayrollContract.GetCompanyPayrollReportQueryParams,
    req.query,
    "Invalid company payroll-report range",
  );
  const { fromMonth, toMonth } = parsePayrollMonthRange(query.fromMonth, query.toMonth);
  return respond(
    res,
    PayrollContract.GetCompanyPayrollReportResponse,
    await readPayrollReport({
      scope: "YEMAIT_COMPANY",
      schoolId: null,
      fromMonth,
      toMonth,
    }),
  );
}));

// Employees receive only provider-verified payslips associated with their own
// active school/company directory record. No salary-query route accepts an
// employee ID from the caller.
const MY_PAYSLIPS_SELECT = `
 SELECT s.id,s.scope,s.school_id,s.period_month,s.employee_name_snapshot,
   s.employee_role_snapshot,s.base_salary_minor,s.allowance_minor,s.bonus_minor,
   s.deduction_minor,s.adjustment_minor,i.adjustment_reason,s.net_salary_minor,
   s.currency,s.issued_at AS created_at,i.account_last4,t.provider_reference,
   t.provider_transaction_id,school.name AS school_name
 FROM payroll_payslips s
 JOIN payroll_items i ON i.id=s.payroll_item_id AND i.period_id=s.period_id
   AND i.scope=s.scope AND i.school_id IS NOT DISTINCT FROM s.school_id
 JOIN payroll_transfers t ON t.id=s.transfer_id AND t.scope=s.scope
   AND t.school_id IS NOT DISTINCT FROM s.school_id
   AND t.status='PAID' AND t.external_transfer_verified=true
 LEFT JOIN schools school ON school.id=s.school_id AND s.scope='SCHOOL'
 JOIN payroll_employee_profiles ep ON ep.id=i.employee_profile_id
   AND ep.scope=i.scope AND ep.school_id IS NOT DISTINCT FROM i.school_id
 LEFT JOIN employees e ON i.scope='SCHOOL' AND e.id=ep.employee_id
   AND e.school_id=i.school_id AND e.employment_status='ACTIVE'
 LEFT JOIN platform_company_employees c ON i.scope='YEMAIT_COMPANY'
   AND c.id=ep.company_employee_id AND c.status='ACTIVE' `;

function myPayslipMap(row: AnyRow) {
  return {
    id: Number(row.id),
    periodMonth: row.period_month,
    employeeName: row.employee_name_snapshot,
    employeeType: row.employee_role_snapshot,
    schoolName: row.school_name ?? null,
    baseSalaryMinor: Number(row.base_salary_minor),
    allowanceMinor: Number(row.allowance_minor),
    bonusMinor: Number(row.bonus_minor),
    deductionMinor: Number(row.deduction_minor),
    adjustmentMinor: Number(row.adjustment_minor),
    adjustmentReason: row.adjustment_reason ?? null,
    netSalaryMinor: Number(row.net_salary_minor),
    currency: "NGN",
    paymentStatus: "PAID",
    maskedAccountNumber: maskedAccount(row.account_last4),
    transferReference: row.provider_reference,
    providerTransactionId: row.provider_transaction_id,
    createdAt: row.created_at,
  };
}

router.get("/payroll/my/payslips", run(async (req, res) => {
  const user = getUserContext(req).user;
  const query = body(
    PayrollContract.ListMyPayrollPayslipsQueryParams,
    req.query,
    "Invalid own-payslip month filter",
  );
  if (
    query.fromMonth &&
    query.toMonth &&
    query.fromMonth > query.toMonth
  ) {
    throw new AuthError(400, "The own-payslip start month must not be after the end month");
  }
  const rows = poolRows(await pool.query(
    `${MY_PAYSLIPS_SELECT}
     WHERE ((s.scope='SCHOOL' AND e.id IS NOT NULL AND
         (e.user_id=$1 OR LOWER(e.email)=LOWER($2)))
       OR (s.scope='YEMAIT_COMPANY' AND c.id IS NOT NULL AND LOWER(c.email)=LOWER($2)))
       AND ($3::text IS NULL OR s.period_month >= $3)
       AND ($4::text IS NULL OR s.period_month <= $4)
     ORDER BY s.period_month DESC,s.id DESC`,
    [user.id, user.email, query.fromMonth ?? null, query.toMonth ?? null],
  ));
  if (rows.length) {
    await withTransaction(async (client) => {
      for (const row of rows) {
        await audit(client, {
          actor: user,
          actorRole: "EMPLOYEE",
          scope: row.scope as Scope,
          schoolId: row.school_id == null ? null : Number(row.school_id),
          recordType: "PAYSLIP",
          recordId: Number(row.id),
          action: "EMPLOYEE_OWN_PAYSLIP_VIEWED",
          amountMinor: null,
          metadata: {
            periodMonth: row.period_month,
            selfService: true,
            employeeId: row.scope === "SCHOOL" ? null : null,
          },
        });
      }
    });
  }
  return respond(
    res,
    PayrollContract.ListMyPayrollPayslipsResponse,
    rows.map(myPayslipMap),
  );
}));

router.get("/payroll/my/payslips/:payslipId", run(async (req, res) => {
  const user = getUserContext(req).user;
  const params = body(
    PayrollContract.GetMyPayrollPayslipParams,
    req.params,
    "Invalid own-payslip identifier",
  );
  const row = poolRows(await pool.query(
    `${MY_PAYSLIPS_SELECT}
     WHERE s.id=$1
       AND ((s.scope='SCHOOL' AND e.id IS NOT NULL AND
           (e.user_id=$2 OR LOWER(e.email)=LOWER($3)))
         OR (s.scope='YEMAIT_COMPANY' AND c.id IS NOT NULL AND LOWER(c.email)=LOWER($3)))`,
    [params.payslipId, user.id, user.email],
  ))[0];
  if (!row) throw new AuthError(404, "Payslip not found for this authenticated employee");
  await withTransaction((client) => audit(client, {
    actor: user,
    actorRole: "EMPLOYEE",
    scope: row.scope as Scope,
    schoolId: row.school_id == null ? null : Number(row.school_id),
    recordType: "PAYSLIP",
    recordId: Number(row.id),
    action: "EMPLOYEE_OWN_PAYSLIP_VIEWED",
    metadata: { periodMonth: row.period_month, selfService: true },
  }));
  return respond(res, PayrollContract.GetMyPayrollPayslipResponse, myPayslipMap(row));
}));

export default router;