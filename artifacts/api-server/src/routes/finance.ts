import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  ApproveFeeAdjustmentParams,
  ApproveFeeAdjustmentResponse,
  ApproveFeeAdjustmentQueryParams,
  AssignFeeStructureBody,
  AssignFeeStructureResponse,
  AssignFeeStructureQueryParams,
  BulkAssignFeeStructureBody,
  BulkAssignFeeStructureResponse,
  BulkAssignFeeStructureQueryParams,
  RequestFeeRefundParams,
  RequestFeeRefundQueryParams,
  RequestFeeRefundBody,
  RequestFeeRefundHeader,
  RequestFeeRefundResponse,
  ApproveFeeRefundParams,
  ApproveFeeRefundQueryParams,
  ApproveFeeRefundBody,
  ApproveFeeRefundResponse,
  GetSchoolFinanceReportQueryParams,
  GetSchoolFinanceReportResponse,
  ListSchoolFeeRefundsQueryParams,
  ListSchoolFeeRefundsResponse,
  GetSchoolFeeRefundParams,
  GetSchoolFeeRefundQueryParams,
  GetSchoolFeeRefundResponse,
  CreateFeeCategoryBody,
  CreateFeeCategoryResponse,
  CreateFeeCategoryQueryParams,
  CreateFeeStructureBody,
  CreateFeeStructureResponse,
  CreateFeeStructureQueryParams,
  GetSchoolFinanceSummaryResponse,
  GetSchoolFinanceSummaryQueryParams,
  GetFinanceSettingsQueryParams,
  GetFinanceSettingsResponse,
  GetSchoolFinancePaymentParams,
  GetSchoolFinancePaymentQueryParams,
  GetSchoolFinancePaymentResponse,
  GetFeePaymentReceiptParams,
  GetFeePaymentReceiptQueryParams,
  GetFeePaymentReceiptResponse,
  GetParentFeeInvoiceBankDetailsParams,
  GetParentFeeInvoiceBankDetailsResponse,
  GetParentFeeInvoiceCheckoutPolicyParams,
  GetParentFeeInvoiceCheckoutPolicyResponse,
  GetParentFeeInvoicePaymentMethodsParams,
  GetParentFeeInvoicePaymentMethodsResponse,
  ReconcileFeeProviderCheckoutParams,
  ReconcileFeeProviderCheckoutQueryParams,
  ReconcileFeeProviderCheckoutResponse,
  InitializeFeeProviderPaymentParams,
  InitializeFeeProviderPaymentHeader,
  InitializeFeeProviderPaymentBody,
  InitializeFeeProviderPaymentResponse,
  ListFeeProviderReconciliationEventsQueryParams,
  ListFeeProviderReconciliationEventsResponse,
  ListFeeCategoriesResponse,
  ListFeeCategoriesQueryParams,
  ListFeeInvoicesResponse,
  ListFeeInvoicesQueryParams,
  ListSchoolFinancePaymentsQueryParams,
  ListSchoolFinancePaymentsResponse,
  ListParentFeePaymentsResponse,
  ListStudentFeePaymentsResponse,
  ListPendingFeeAdjustmentsQueryParams,
  ListPendingFeeAdjustmentsResponse,
  ListFeeStructuresResponse,
  ListFeeStructuresQueryParams,
  ListParentFeeInvoicesResponse,
  ListStudentFeeInvoicesResponse,
  PublishFeeStructureResponse,
  PublishFeeStructureParams,
  PublishFeeStructureQueryParams,
  RejectManualBankTransferBody,
  RejectManualBankTransferResponse,
  RejectManualBankTransferParams,
  RejectManualBankTransferQueryParams,
  RetryFeeProviderReconciliationEventParams,
  RetryFeeProviderReconciliationEventQueryParams,
  RetryFeeProviderReconciliationEventResponse,
  RequestFeeAdjustmentBody,
  RequestFeeAdjustmentResponse,
  RequestFeeAdjustmentParams,
  RequestFeeAdjustmentQueryParams,
  SubmitManualBankTransferBody,
  SubmitManualBankTransferHeader,
  SubmitManualBankTransferParams,
  SubmitManualBankTransferResponse,
  VerifyManualBankTransferResponse,
  UpdateFeeCategoryBody,
  UpdateFeeCategoryResponse,
  UpdateFeeCategoryParams,
  UpdateFeeCategoryQueryParams,
  UpdateFinanceSettingsBody,
  UpdateFinanceSettingsQueryParams,
  UpdateFinanceSettingsResponse,
  VerifyManualBankTransferParams,
  VerifyManualBankTransferBody,
  VerifyManualBankTransferQueryParams,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import {
  configuredCheckoutReturnUrl,
  configuredTestAdapter,
} from "../lib/fee-providers/factory";
import { PaymentProviderError, type VerifiedPayment } from "../lib/fee-providers";
import { retryReconciliationEvent, settleVerifiedPayment } from "./fee-provider-webhooks";
import {
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";
import { invoiceStatus, payableAmount } from "./finance-money";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import { enqueueFinancePaymentNotificationsSafely } from "./finance-notifications-service";
import { enqueueFinanceInvoiceCommunicationsSafely } from "./finance-communication-service";
import { enqueueInvoiceGeneratedNotificationsSafely } from "./invoice-notifications-service";

const router: IRouter = Router();
router.use(requireAuthentication());

const schoolRoles = ["SCHOOL_ADMIN", "ACCOUNTANT"] as const;
const number = (value: unknown) => Number(value);
const invoiceShape = `
  i.id, i.school_id AS "schoolId", i.student_id AS "studentId", i.invoice_number AS "invoiceNumber",
  i.student_name_snapshot AS "studentName", i.academic_session_id AS "sessionId",
  i.academic_term_id AS "termId", i.currency, i.subtotal_minor AS "subtotalMinor",
  i.discount_minor AS "discountMinor", i.waiver_minor AS "waiverMinor", i.total_minor AS "totalMinor",
  i.paid_minor AS "paidMinor", i.outstanding_minor AS "outstandingMinor", i.status`;
const paymentShape = `
  id, school_id AS "schoolId", invoice_id AS "invoiceId", reference,
  amount_minor AS "amountMinor", currency, method, status`;
const paymentHistoryShape = (includeReviewFields: boolean) => `
  p.id,p.school_id AS "schoolId",p.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",
  p.student_id AS "studentId",i.student_name_snapshot AS "studentName",s.name AS "schoolName",
  p.reference,p.amount_minor AS "amountMinor",p.currency,p.method,p.status,
  p.transfer_bank AS "transferBank",p.transfer_reference AS "transferReference",
  p.transfer_date::text AS "transferDate",p.proof_url AS "proofUrl",p.rejection_reason AS "rejectionReason",
  ${includeReviewFields
    ? `p.verification_evidence_ref AS "verificationEvidenceReference",p.reviewer_notes AS "reviewerNotes"`
    : `NULL::text AS "verificationEvidenceReference",NULL::text AS "reviewerNotes"`},
  to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  CASE WHEN p.verified_at IS NULL THEN NULL
    ELSE to_char(p.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "verifiedAt",
  r.receipt_number AS "receiptNumber"`;
const feeAdjustmentShape = `id,school_id AS "schoolId",invoice_id AS "invoiceId",kind,
  amount_minor AS "amountMinor",requested_percentage::float AS percentage,
  approved_amount_minor AS "approvedAmountMinor",original_balance_minor AS "originalBalanceMinor",
  resulting_balance_minor AS "resultingBalanceMinor",reason,status,requested_by AS "requestedBy",
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "requestedAt",
  approved_by AS "approvedBy",
  CASE WHEN approved_at IS NULL THEN NULL
    ELSE to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "approvedAt"`;

router.get("/school/finance/settings", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, GetFinanceSettingsQueryParams);
    const result = await pool.query(
      `SELECT school_id AS "schoolId",partial_payments_enabled AS "partialPaymentsEnabled",
          bank_transfer_enabled AS "bankTransferEnabled",paystack_enabled AS "paystackEnabled",
          flutterwave_enabled AS "flutterwaveEnabled",bank_name AS "bankName",
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1`,
      [schoolId],
    );
    res.json(GetFinanceSettingsResponse.parse(result.rows[0] ?? {
      schoolId, partialPaymentsEnabled: false, bankTransferEnabled: false,
      paystackEnabled: false, flutterwaveEnabled: false,
      bankName: null, accountName: null, accountNumber: null,
    }));
  } catch (error) { fail(res, error); }
});

router.patch("/school/finance/settings", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const schoolId = schoolIdForMutation(req, UpdateFinanceSettingsQueryParams, ["SCHOOL_ADMIN"]);
    const body = parsed(UpdateFinanceSettingsBody, req.body);
    if (Object.keys(body).length === 0) throw new AuthError(400, "At least one finance setting must be provided");
    const context = getUserContext(req);
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO fee_school_settings (school_id) VALUES ($1) ON CONFLICT (school_id) DO NOTHING`,
      [schoolId],
    );
    const currentResult = await client.query(
      `SELECT partial_payments_enabled AS "partialPaymentsEnabled",
         bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
         paystack_enabled AS "paystackEnabled",flutterwave_enabled AS "flutterwaveEnabled",
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1 FOR UPDATE`,
      [schoolId],
    );
    const current = currentResult.rows[0] ?? {
      partialPaymentsEnabled: false, bankTransferEnabled: false,
      paystackEnabled: false, flutterwaveEnabled: false,
      bankName: null, accountName: null, accountNumber: null,
    };
    const normalizeSetting = (input: unknown, previous: string | null) => {
      if (input === undefined) return previous;
      if (input === null) return null;
      return typeof input === "string" ? input.trim() || null : null;
    };
    const bankName = normalizeSetting(body.bankName, current.bankName);
    const accountName = normalizeSetting(body.accountName, current.accountName);
    const accountNumber = normalizeSetting(body.accountNumber, current.accountNumber);
    const bankTransferEnabled = body.bankTransferEnabled ?? current.bankTransferEnabled;
    const partialPaymentsEnabled = body.partialPaymentsEnabled ?? current.partialPaymentsEnabled;
    const paystackEnabled = body.paystackEnabled ?? current.paystackEnabled;
    const flutterwaveEnabled = body.flutterwaveEnabled ?? current.flutterwaveEnabled;
    if ((bankName !== null && (bankName.length < 2 || bankName.length > 100))
        || (accountName !== null && (accountName.length < 2 || accountName.length > 150))
        || (accountNumber !== null && !/^\d{10}$/.test(accountNumber))) {
      throw new AuthError(400, "Bank details are invalid; account numbers must be exactly 10 digits");
    }
    if (bankTransferEnabled && (!bankName || !accountName || !accountNumber)) {
      throw new AuthError(400, "Complete valid bank details are required before enabling manual bank transfers");
    }
    const result = await client.query(
      `INSERT INTO fee_school_settings
        (school_id,partial_payments_enabled,bank_transfer_enabled,paystack_enabled,flutterwave_enabled,
         bank_name,bank_account_name,bank_account_number,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (school_id) DO UPDATE SET
        partial_payments_enabled=EXCLUDED.partial_payments_enabled,
        bank_transfer_enabled=EXCLUDED.bank_transfer_enabled,
        paystack_enabled=EXCLUDED.paystack_enabled,flutterwave_enabled=EXCLUDED.flutterwave_enabled,
        bank_name=EXCLUDED.bank_name,
        bank_account_name=EXCLUDED.bank_account_name,bank_account_number=EXCLUDED.bank_account_number,
        updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING school_id AS "schoolId",partial_payments_enabled AS "partialPaymentsEnabled",
         bank_transfer_enabled AS "bankTransferEnabled",paystack_enabled AS "paystackEnabled",
         flutterwave_enabled AS "flutterwaveEnabled",bank_name AS "bankName",
        bank_account_name AS "accountName",bank_account_number AS "accountNumber"`,
      [schoolId, partialPaymentsEnabled, bankTransferEnabled, paystackEnabled, flutterwaveEnabled,
        bankName, accountName, accountNumber, context.user.id],
    );
    await audit(req, client, schoolId, "updated", "finance settings", schoolId,
      {
        changedFields: Object.keys(body), partialPaymentsEnabled, bankTransferEnabled,
        paystackEnabled, flutterwaveEnabled,
        bankName, accountName, accountNumberLast4: accountNumber?.slice(-4) ?? null,
      });
    await client.query("COMMIT");
    res.json(UpdateFinanceSettingsResponse.parse(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

function parsed<T>(schema: { parse: (input: unknown) => T }, input: unknown): T {
  try { return schema.parse(input); }
  catch (error) { throw new AuthError(400, error instanceof Error ? error.message : "Invalid request"); }
}

function schoolIdFromQuery(req: Request, schema: { parse: (input: unknown) => { schoolId: number } }) {
  const { schoolId } = parsed(schema, req.query);
  assertSchoolAccess(req, schoolId, [...schoolRoles]);
  return schoolId;
}

function schoolIdForMutation(
  req: Request,
  schema: { parse: (input: unknown) => { schoolId: number } },
  allowedRoles: readonly ("SCHOOL_ADMIN" | "ACCOUNTANT")[],
) {
  const { schoolId } = parsed(schema, req.query);
  const context = getUserContext(req);
  if (!context.roles.some((assignment) =>
    assignment.status === "ACTIVE" &&
    assignment.schoolId === schoolId && allowedRoles.includes(assignment.role as "SCHOOL_ADMIN" | "ACCOUNTANT"))) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  assertSchoolOperationalAccess(req, schoolId, allowedRoles as any);
  return schoolId;
}

async function audit(
  req: Request, db: { query: (text: string, values?: unknown[]) => Promise<any> },
  schoolId: number, action: string, entity: string, entityId: number, metadata: unknown = {},
) {
  const context = getUserContext(req);
  await db.query(
    `INSERT INTO audit_logs ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
      record_id, severity, event_type, result, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Finance',$7,'info','FINANCE_EVENT','SUCCESS',$8)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      context.roles.find((role) => role.status === "ACTIVE" && role.schoolId === schoolId)?.role ?? "AUTHENTICATED",
      context.user.id, context.user.clerkUserId, schoolId, `${entity}: ${action}`, entityId, metadata,
    ],
  );
}

function fail(res: any, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ error: error.message, code: error.eventType });
    return;
  }
  const message = error instanceof Error ? error.message : "Finance operation failed";
  if (message.includes("duplicate key")) res.status(409).json({ error: "The operation already exists" });
  else if (message.includes("violates foreign key")) res.status(404).json({ error: "Referenced school resource not found" });
  else if (message === "Verified payment receipt integrity failure") res.status(500).json({ error: message });
  else if (message === "Finance amount exceeds safe integer precision") res.status(500).json({ error: message });
  else res.status(500).json({ error: "Finance operation failed" });
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

function dateTime(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function queryCalendarDates(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const query = { ...input as Record<string, unknown> };
  for (const key of ["from", "to"]) {
    const value = query[key];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsedDate = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value) {
        query[key] = parsedDate;
      }
    }
  }
  return query;
}

function exactInteger(value: unknown): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new Error("Finance amount exceeds safe integer precision");
  return converted;
}

function percentageOfOriginalSubtotal(subtotalMinor: unknown, percentage: unknown): number {
  const subtotal = exactInteger(subtotalMinor);
  const basisPoints = Math.round(Number(percentage) * 100);
  if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10_000) {
    throw new AuthError(400, "Discount percentage must be between 0.01 and 100");
  }
  return Math.floor((subtotal * basisPoints + 5_000) / 10_000);
}

function safeProviderReason(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(api[-_ ]?key|secret|token|password|authorization|signature)\b(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/https?:\/\/[^\s)]+/gi, "[provider URL]")
    .slice(0, 300)
    .trim();
}

function configuredBankDetails(settings: any) {
  if (!settings?.bankTransferEnabled) return null;
  const bankName = typeof settings.bankName === "string" ? settings.bankName.trim() : "";
  const accountName = typeof settings.accountName === "string" ? settings.accountName.trim() : "";
  const accountNumber = typeof settings.accountNumber === "string" ? settings.accountNumber : "";
  if (bankName.length < 2 || bankName.length > 100
      || accountName.length < 2 || accountName.length > 150
      || !/^\d{10}$/.test(accountNumber)) return null;
  return { bankName, accountName, accountNumber };
}

async function createStructureLines(client: any, schoolId: number, structureId: number, lines: any[]) {
  for (const line of lines) {
    const category = await client.query(
      `SELECT name FROM fee_categories WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`,
      [line.categoryId, schoolId],
    );
    if (!category.rows[0]) throw new AuthError(404, "Fee category not found");
    await client.query(
      `INSERT INTO fee_structure_lines (school_id,structure_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [schoolId, structureId, line.categoryId, category.rows[0].name, line.description ?? category.rows[0].name, line.amountMinor],
    );
  }
}

async function getStructure(client: any, schoolId: number, id: number) {
  const result = await client.query(
    `SELECT fs.id, fs.school_id AS "schoolId", fs.academic_session_id AS "sessionId",
      fs.academic_term_id AS "termId", fs.school_class_id AS "classId", fs.section, fs.version, fs.status,
      COALESCE(json_agg(json_build_object('categoryId',fl.category_id,'categoryName',fl.category_name_snapshot,
       'description',fl.description_snapshot,'amountMinor',fl.amount_minor)) FILTER (WHERE fl.id IS NOT NULL),'[]'::json) AS lines
     FROM fee_structures fs LEFT JOIN fee_structure_lines fl ON fl.structure_id=fs.id AND fl.school_id=fs.school_id
     WHERE fs.school_id=$1 AND fs.id=$2 GROUP BY fs.id`,
    [schoolId, id],
  );
  return result.rows[0];
}

async function createInvoiceForStudent(
  client: any,
  req: Request,
  schoolId: number,
  structure: any,
  student: any,
  lines: any[],
  issueDate: string,
  dueDate: string,
  createdBy: number,
  bulk = false,
) {
  const subtotal = lines.reduce((total: number, line: any) => total + Number(line.amount_minor), 0);
  const invoiceNumber = `EDC-${schoolId}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const inserted = await client.query(
    `INSERT INTO fee_invoices (school_id,student_id,structure_id,academic_session_id,academic_term_id,invoice_number,
     student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,
     subtotal_minor,total_minor,outstanding_minor,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13,$14) RETURNING id`,
    [schoolId, student.id, structure.id, structure.academic_session_id, structure.academic_term_id,
      invoiceNumber, `${student.first_name} ${student.last_name}`, student.admission_no,
      student.class_name, student.section, issueDate, dueDate, subtotal, createdBy],
  );
  const invoiceId = inserted.rows[0].id;
  for (const line of lines) {
    await client.query(
      `INSERT INTO fee_invoice_lines (school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [schoolId, invoiceId, line.category_id, line.category_name_snapshot, line.description_snapshot, line.amount_minor],
    );
  }
  await audit(req, client, schoolId, "assigned", "invoice", invoiceId, {
    studentId: student.id, ...(bulk ? { structureId: structure.id, bulk: true } : {}),
  });
  await enqueueInvoiceGeneratedNotificationsSafely(client, Number(invoiceId), schoolId);
  await enqueueFinanceInvoiceCommunicationsSafely(client, Number(invoiceId), schoolId);
  return invoiceId;
}

function assignmentList(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsedAssignments: unknown = JSON.parse(value);
      return Array.isArray(parsedAssignments) ? parsedAssignments : [];
    } catch { return []; }
  }
  return [];
}

function bulkAssignmentForStructure(
  student: any,
  structure: any,
  section: string | null,
): { assignment: any | null; reason: string | null } {
  const assignments = assignmentList(student.classAssignments);
  const inSession = assignments.filter((assignment) =>
    Number(assignment.sessionId) === Number(structure.academic_session_id));
  if (!inSession.length) return { assignment: null, reason: "NO_MATCHING_SESSION" };
  const inTerm = inSession.filter((assignment) =>
    Number(assignment.termId) === Number(structure.academic_term_id));
  if (!inTerm.length) return { assignment: null, reason: "NO_MATCHING_TERM" };
  const inClass = inTerm.filter((assignment) =>
    Number(assignment.classId) === Number(structure.school_class_id));
  if (!inClass.length) return { assignment: null, reason: "WRONG_CLASS" };
  const inSection = section === null
    ? inClass
    : inClass.filter((assignment) => assignment.section === section);
  if (!inSection.length) return { assignment: null, reason: "WRONG_SECTION" };
  const validStatus = inSection.filter((assignment) =>
    assignment.status === "ACTIVE" || assignment.status === "INACTIVE");
  if (!validStatus.length) return { assignment: null, reason: "INVALID_ASSIGNMENT_STATUS" };
  const overlapsTerm = validStatus.filter((assignment) =>
    (assignment.startDate === null || assignment.startDate === undefined
      || String(assignment.startDate).slice(0, 10) <= structure.term_end_date)
    && (assignment.endDate === null || assignment.endDate === undefined
      || String(assignment.endDate).slice(0, 10) >= structure.term_start_date));
  if (!overlapsTerm.length) return { assignment: null, reason: "ASSIGNMENT_OUTSIDE_TERM" };
  return { assignment: overlapsTerm[0], reason: null };
}

router.get("/school/finance/categories", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, ListFeeCategoriesQueryParams);
    const result = await pool.query(
      `SELECT id,school_id AS "schoolId",name,description,compulsory,status FROM fee_categories WHERE school_id=$1 ORDER BY name`,
      [schoolId],
    );
    res.json(ListFeeCategoriesResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/categories", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const schoolId = schoolIdForMutation(req, CreateFeeCategoryQueryParams, ["SCHOOL_ADMIN"]);
    const body = parsed(CreateFeeCategoryBody, req.body);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO fee_categories (school_id,name,description,compulsory,created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,school_id AS "schoolId",name,description,compulsory,status`,
      [schoolId, body.name, body.description ?? null, body.compulsory ?? false, context.user.id],
    );
    await audit(req, client, schoolId, "created", "fee category", result.rows[0].id);
    await client.query("COMMIT");
    res.status(201).json(CreateFeeCategoryResponse.parse(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.patch("/school/finance/categories/:categoryId", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { categoryId } = parsed(UpdateFeeCategoryParams, req.params);
    const schoolId = schoolIdForMutation(req, UpdateFeeCategoryQueryParams, ["SCHOOL_ADMIN"]);
    const body = parsed(UpdateFeeCategoryBody, req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column}=$${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.description !== undefined) add("description", body.description);
    if (body.compulsory !== undefined) add("compulsory", body.compulsory);
    if (body.status !== undefined) add("status", body.status);
    if (fields.length === 0) throw new AuthError(400, "At least one category field is required");
    fields.push("updated_at=NOW()");
    values.push(categoryId, schoolId);
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE fee_categories SET ${fields.join(",")}
       WHERE id=$${values.length - 1} AND school_id=$${values.length}
       RETURNING id,school_id AS "schoolId",name,description,compulsory,status`,
      values,
    );
    if (!updated.rows[0]) throw new AuthError(404, "Fee category not found");
    await audit(req, client, schoolId, "updated", "fee category", categoryId, { changedFields: Object.keys(body) });
    await client.query("COMMIT");
    res.json(UpdateFeeCategoryResponse.parse(updated.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.get("/school/finance/structures", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, ListFeeStructuresQueryParams);
    const result = await pool.query(`SELECT id FROM fee_structures WHERE school_id=$1 ORDER BY created_at DESC`, [schoolId]);
    const structures = await Promise.all(result.rows.map((row) => getStructure(pool, schoolId, row.id)));
    res.json(ListFeeStructuresResponse.parse(structures));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/structures", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const schoolId = schoolIdForMutation(req, CreateFeeStructureQueryParams, ["SCHOOL_ADMIN"]);
    const body = parsed(CreateFeeStructureBody, req.body);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version),0)+1 AS version FROM fee_structures
       WHERE school_id=$1 AND academic_session_id=$2 AND academic_term_id=$3 AND school_class_id=$4
         AND section IS NOT DISTINCT FROM $5`,
      [schoolId, body.sessionId, body.termId, body.classId, body.section ?? null],
    );
    const created = await client.query(
      `INSERT INTO fee_structures (school_id,academic_session_id,academic_term_id,school_class_id,section,version,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [schoolId, body.sessionId, body.termId, body.classId, body.section ?? null, versionResult.rows[0].version, context.user.id],
    );
    await createStructureLines(client, schoolId, created.rows[0].id, body.lines);
    await audit(req, client, schoolId, "created", "fee structure", created.rows[0].id);
    const response = await getStructure(client, schoolId, created.rows[0].id);
    await client.query("COMMIT");
    res.status(201).json(CreateFeeStructureResponse.parse(response));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.post("/school/finance/structures/:structureId/publish", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { structureId } = parsed(PublishFeeStructureParams, req.params);
    const schoolId = schoolIdForMutation(req, PublishFeeStructureQueryParams, ["SCHOOL_ADMIN"]);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id,status FROM fee_structures WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [structureId, schoolId],
    );
    if (!current.rows[0]) throw new AuthError(404, "Fee structure not found");
    if (current.rows[0].status === "PUBLISHED") {
      const response = await getStructure(client, schoolId, structureId);
      await client.query("COMMIT");
      res.json(PublishFeeStructureResponse.parse(response));
      return;
    }
    if (current.rows[0].status !== "DRAFT") throw new AuthError(409, "Only a draft fee structure can be published");
    const result = await client.query(
      `UPDATE fee_structures SET status='PUBLISHED',published_by=$1,published_at=NOW()
       WHERE id=$2 AND school_id=$3 AND status='DRAFT' RETURNING id`,
      [context.user.id, structureId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(409, "Structure publication did not complete");
    await audit(req, client, schoolId, "published", "fee structure", structureId);
    const response = await getStructure(client, schoolId, structureId);
    await client.query("COMMIT");
    res.json(PublishFeeStructureResponse.parse(response));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.post("/school/finance/assignments", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const schoolId = schoolIdForMutation(req, AssignFeeStructureQueryParams, schoolRoles);
    const body = parsed(AssignFeeStructureBody, req.body);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id=$2 AND structure_id=$3`,
      [schoolId, body.studentId, body.structureId],
    );
    if (found.rows[0]) {
      const existing = await client.query(`SELECT ${invoiceShape} FROM fee_invoices i WHERE i.id=$1 AND i.school_id=$2`, [found.rows[0].id, schoolId]);
      await client.query("COMMIT");
      res.status(201).json(AssignFeeStructureResponse.parse(existing.rows[0]));
      return;
    }
    const structure = await client.query(
      `SELECT * FROM fee_structures WHERE id=$1 AND school_id=$2 AND status='PUBLISHED' FOR SHARE`,
      [body.structureId, schoolId],
    );
    if (!structure.rows[0]) throw new AuthError(404, "Published fee structure not found");
    const student = await client.query(
      `SELECT st.id,st.first_name,st.last_name,st.admission_no,st.class_name,st.section
       FROM students st WHERE st.id=$1 AND st.school_id=$2 AND EXISTS (
         SELECT 1 FROM school_classes sc WHERE sc.id=$3 AND sc.school_id=st.school_id
           AND sc.name=st.class_name AND ($4::text IS NULL OR st.section=$4))`,
      [body.studentId, schoolId, structure.rows[0].school_class_id, structure.rows[0].section],
    );
    if (!student.rows[0]) throw new AuthError(404, "Student not found");
    const lines = await client.query(
      `SELECT * FROM fee_structure_lines WHERE structure_id=$1 AND school_id=$2 ORDER BY id`,
      [body.structureId, schoolId],
    );
    if (!lines.rows.length) throw new AuthError(409, "Published fee structure has no fee lines");
    const invoiceId = await createInvoiceForStudent(
      client, req, schoolId, structure.rows[0], student.rows[0], lines.rows,
      body.issueDate.toISOString().slice(0, 10), body.dueDate.toISOString().slice(0, 10), context.user.id,
    );
    const invoice = await client.query(`SELECT ${invoiceShape} FROM fee_invoices i WHERE i.id=$1 AND i.school_id=$2`, [invoiceId, schoolId]);
    await client.query("COMMIT");
    res.status(201).json(AssignFeeStructureResponse.parse(invoice.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.post("/school/finance/bulk-assignments", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const schoolId = schoolIdForMutation(req, BulkAssignFeeStructureQueryParams, schoolRoles);
    const body = parsed(BulkAssignFeeStructureBody, req.body);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const structureResult = await client.query(
      `SELECT fs.*,t.start_date::text AS term_start_date,t.end_date::text AS term_end_date
       FROM fee_structures fs
       JOIN academic_terms t ON t.id=fs.academic_term_id AND t.school_id=fs.school_id
         AND t.academic_session_id=fs.academic_session_id
       WHERE fs.id=$1 AND fs.school_id=$2 AND fs.status='PUBLISHED' FOR SHARE OF fs`,
      [body.structureId, schoolId],
    );
    const structure = structureResult.rows[0];
    if (!structure) throw new AuthError(404, "Published fee structure not found");
    if (body.classId !== undefined && body.classId !== structure.school_class_id) {
      throw new AuthError(400, "Bulk assignment class must match the published structure");
    }
    if (body.section !== undefined && structure.section !== null && body.section !== structure.section) {
      throw new AuthError(400, "Bulk assignment section must match the published structure");
    }
    const effectiveSection = body.section ?? structure.section;
    const candidates = await client.query(
      `SELECT st.id,st.first_name,st.last_name,st.admission_no,
          COALESCE(json_agg(json_build_object(
            'sessionId',a.academic_session_id,'termId',a.academic_term_id,
            'classId',a.school_class_id,'className',sc.name,'section',a.section,
            'status',a.status,'startDate',a.start_date::text,'endDate',a.end_date::text
          ) ORDER BY a.start_date DESC NULLS LAST,a.id DESC)
            FILTER (WHERE a.id IS NOT NULL),'[]'::json) AS "classAssignments"
       FROM students st
       LEFT JOIN student_class_assignments a ON a.student_id=st.id AND a.school_id=st.school_id
       LEFT JOIN school_classes sc ON sc.id=a.school_class_id AND sc.school_id=a.school_id
       WHERE st.school_id=$1 AND LOWER(st.status)='active'
         AND UPPER(st.admission_status)='ADMITTED'
       GROUP BY st.id
       ORDER BY st.id`,
      [schoolId],
    );
    const lines = await client.query(
      `SELECT * FROM fee_structure_lines WHERE structure_id=$1 AND school_id=$2 ORDER BY id`,
      [body.structureId, schoolId],
    );
    if (!lines.rows.length) throw new AuthError(409, "Published fee structure has no fee lines");
    const results: Array<{ studentId: number; invoiceId: number | null; status: "CREATED" | "SKIPPED"; reason: string | null }> = [];
    const issueDate = body.issueDate.toISOString().slice(0, 10);
    const dueDate = body.dueDate.toISOString().slice(0, 10);
    if (issueDate < String(structure.term_start_date).slice(0, 10)
        || issueDate > String(structure.term_end_date).slice(0, 10)
        || dueDate < issueDate || dueDate > String(structure.term_end_date).slice(0, 10)) {
      throw new AuthError(400, "Issue and due dates must be within the selected term, with due date on or after issue date");
    }
    for (const student of candidates.rows) {
      const duplicate = await client.query(
        `SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id=$2 AND structure_id=$3`,
        [schoolId, student.id, body.structureId],
      );
      if (duplicate.rows[0]) {
        results.push({ studentId: student.id, invoiceId: duplicate.rows[0].id, status: "SKIPPED", reason: "EXISTING_INVOICE" });
        continue;
      }
      const { assignment, reason } = bulkAssignmentForStructure(student, structure, effectiveSection);
      if (!assignment) {
        results.push({ studentId: student.id, invoiceId: null, status: "SKIPPED", reason });
        continue;
      }
      const invoiceStudent = {
        ...student,
        class_name: assignment.className,
        section: assignment.section,
      };
      await client.query("SAVEPOINT fee_bulk_student");
      try {
        const invoiceId = await createInvoiceForStudent(
          client, req, schoolId, structure, invoiceStudent, lines.rows, issueDate, dueDate, context.user.id, true,
        );
        await client.query("RELEASE SAVEPOINT fee_bulk_student");
        results.push({ studentId: student.id, invoiceId, status: "CREATED", reason: null });
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT fee_bulk_student");
        await client.query("RELEASE SAVEPOINT fee_bulk_student");
        const racedDuplicate = await client.query(
          `SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id=$2 AND structure_id=$3`,
          [schoolId, student.id, body.structureId],
        );
        results.push({
          studentId: student.id, invoiceId: racedDuplicate.rows[0]?.id ?? null,
          status: "SKIPPED", reason: racedDuplicate.rows[0] ? "EXISTING_INVOICE" : "ASSIGNMENT_FAILED",
        });
      }
    }
    await audit(req, client, schoolId, "completed bulk assignment", "fee structure", body.structureId, {
      createdCount: results.filter((result) => result.status === "CREATED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length,
    });
    await client.query("COMMIT");
    res.json(BulkAssignFeeStructureResponse.parse({
      createdCount: results.filter((result) => result.status === "CREATED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length,
      results,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.get("/school/finance/invoices", async (req, res): Promise<void> => {
  try {
    const filters = parsed(ListFeeInvoicesQueryParams, req.query);
    assertSchoolAccess(req, filters.schoolId, [...schoolRoles]);
    const result = await pool.query(
      `SELECT ${invoiceShape} FROM fee_invoices i WHERE i.school_id=$1
       AND ($2::text IS NULL OR i.status=$2) AND ($3::integer IS NULL OR i.student_id=$3) ORDER BY i.created_at DESC`,
      [filters.schoolId, filters.status ?? null, filters.studentId ?? null],
    );
    res.json(ListFeeInvoicesResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/parent/fees/invoices", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["PARENT"]);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT ${invoiceShape} FROM fee_invoices i
       WHERE EXISTS (SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
        WHERE p.user_id=$1 AND p.status='ACTIVE' AND p.school_id=i.school_id AND r.student_id=i.student_id AND r.status='ACTIVE')
       ORDER BY i.created_at DESC`,
      [context.user.id],
    );
    res.json(ListParentFeeInvoicesResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/student/fees/invoices", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["STUDENT"]);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT ${invoiceShape} FROM fee_invoices i
       JOIN students st ON st.id=i.student_id AND st.school_id=i.school_id
       WHERE st.user_id=$1 ORDER BY i.created_at DESC`,
      [context.user.id],
    );
    res.json(ListStudentFeeInvoicesResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/school/finance/payments", async (req, res): Promise<void> => {
  try {
    const filters = parsed(ListSchoolFinancePaymentsQueryParams, queryCalendarDates(req.query));
    assertSchoolAccess(req, filters.schoolId, [...schoolRoles]);
    const result = await pool.query(
      `SELECT ${paymentHistoryShape(true)}
       FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
       LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
       WHERE p.school_id=$1 AND ($2::text IS NULL OR p.status=$2)
         AND ($3::integer IS NULL OR p.student_id=$3)
         AND ($4::date IS NULL OR p.created_at >= $4::date)
         AND ($5::date IS NULL OR p.created_at < $5::date + INTERVAL '1 day')
       ORDER BY p.created_at DESC,p.id DESC`,
      [filters.schoolId, filters.status ?? null, filters.studentId ?? null,
        filters.from ? dateOnly(filters.from) : null, filters.to ? dateOnly(filters.to) : null],
    );
    res.json(ListSchoolFinancePaymentsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/school/finance/payments/:paymentId", async (req, res): Promise<void> => {
  try {
    const { paymentId } = parsed(GetSchoolFinancePaymentParams, req.params);
    const schoolId = schoolIdFromQuery(req, GetSchoolFinancePaymentQueryParams);
    const result = await pool.query(
      `SELECT ${paymentHistoryShape(true)}
       FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
       LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
       WHERE p.id=$1 AND p.school_id=$2`,
      [paymentId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Payment not found");
    res.json(GetSchoolFinancePaymentResponse.parse(result.rows[0]));
  } catch (error) { fail(res, error); }
});

router.get("/parent/fees/payments", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["PARENT"]);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT ${paymentHistoryShape(false)}
       FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
       LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
       WHERE EXISTS (
         SELECT 1 FROM parents pa JOIN parent_student_relationships rel ON rel.parent_id=pa.id
         WHERE pa.user_id=$1 AND pa.status='ACTIVE' AND pa.school_id=p.school_id
           AND rel.student_id=p.student_id AND rel.status='ACTIVE'
       )
       ORDER BY p.created_at DESC,p.id DESC`,
      [context.user.id],
    );
    res.json(ListParentFeePaymentsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/student/fees/payments", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["STUDENT"]);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT ${paymentHistoryShape(false)}
       FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
       JOIN students st ON st.id=p.student_id AND st.school_id=p.school_id
       LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
       WHERE st.user_id=$1 ORDER BY p.created_at DESC,p.id DESC`,
      [context.user.id],
    );
    res.json(ListStudentFeePaymentsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/parent/fees/invoices/:invoiceId/bank-details", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["PARENT"]);
    const { invoiceId } = parsed(GetParentFeeInvoiceBankDetailsParams, req.params);
    const context = getUserContext(req);
    const invoice = await pool.query(
      `SELECT i.id,i.school_id AS "schoolId",i.status,i.outstanding_minor AS "outstandingMinor"
       FROM fee_invoices i
       WHERE i.id=$1 AND EXISTS (
         SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
         WHERE p.user_id=$2 AND p.school_id=i.school_id AND p.status='ACTIVE'
           AND r.student_id=i.student_id AND r.status='ACTIVE'
       )`,
      [invoiceId, context.user.id],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    if (invoice.rows[0].status === "CANCELLED" || invoice.rows[0].status === "PAID"
        || Number(invoice.rows[0].outstandingMinor) <= 0) {
      throw new AuthError(409, "Invoice is not payable");
    }
    const settings = await pool.query(
      `SELECT bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1`,
      [invoice.rows[0].schoolId],
    );
    const bankDetails = configuredBankDetails(settings.rows[0]);
    if (!bankDetails) {
      res.json(GetParentFeeInvoiceBankDetailsResponse.parse({
        invoiceId, schoolId: invoice.rows[0].schoolId, available: false,
        reason: "BANK_DETAILS_UNAVAILABLE",
      }));
      return;
    }
    res.json(GetParentFeeInvoiceBankDetailsResponse.parse({
      invoiceId, schoolId: invoice.rows[0].schoolId, available: true, ...bankDetails,
    }));
  } catch (error) { fail(res, error); }
});

router.get("/parent/fees/invoices/:invoiceId/payment-methods", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["PARENT"]);
    const { invoiceId } = parsed(GetParentFeeInvoicePaymentMethodsParams, req.params);
    const context = getUserContext(req);
    const invoice = await pool.query(
      `SELECT i.id,i.school_id AS "schoolId",i.status,i.outstanding_minor AS "outstandingMinor",i.currency
       FROM fee_invoices i
       WHERE i.id=$1 AND EXISTS (
         SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
         WHERE p.user_id=$2 AND p.school_id=i.school_id AND p.status='ACTIVE'
           AND r.student_id=i.student_id AND r.status='ACTIVE'
       )`,
      [invoiceId, context.user.id],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    if (invoice.rows[0].status === "CANCELLED" || invoice.rows[0].status === "PAID"
        || Number(invoice.rows[0].outstandingMinor) <= 0) {
      throw new AuthError(409, "Invoice is not payable");
    }

    const settings = await pool.query(
      `SELECT bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
          bank_account_name AS "accountName",bank_account_number AS "accountNumber",
          paystack_enabled AS "paystackEnabled",flutterwave_enabled AS "flutterwaveEnabled"
       FROM fee_school_settings WHERE school_id=$1`,
      [invoice.rows[0].schoolId],
    );
    const schoolSettings = settings.rows[0];
    const methods: Array<"BANK_TRANSFER" | "PAYSTACK" | "FLUTTERWAVE"> = [];
    if (configuredBankDetails(schoolSettings)) methods.push("BANK_TRANSFER");

    const returnUrlAvailable = configuredCheckoutReturnUrl() !== null;
    const amountMinor = Number(invoice.rows[0].outstandingMinor);
    const currency = String(invoice.rows[0].currency).toUpperCase();
    for (const provider of ["PAYSTACK", "FLUTTERWAVE"] as const) {
      const enabled = provider === "PAYSTACK"
        ? schoolSettings?.paystackEnabled
        : schoolSettings?.flutterwaveEnabled;
      if (!enabled || !returnUrlAvailable) continue;
      try {
        const adapter = configuredTestAdapter(provider);
        if (adapter?.validateAmount(amountMinor, currency)) methods.push(provider);
      } catch {
        // Malformed or live credentials make this provider unavailable; never expose configuration details.
      }
    }
    res.json(GetParentFeeInvoicePaymentMethodsResponse.parse(methods));
  } catch (error) { fail(res, error); }
});

router.get("/parent/fees/invoices/:invoiceId/checkout-policy", async (req, res): Promise<void> => {
  try {
    assertRoles(req, ["PARENT"]);
    const { invoiceId } = parsed(GetParentFeeInvoiceCheckoutPolicyParams, req.params);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT i.id AS "invoiceId",i.school_id AS "schoolId",
          i.outstanding_minor AS "outstandingMinor",
          COALESCE(fs.partial_payments_enabled,false) AS "partialPaymentsEnabled"
       FROM fee_invoices i
       LEFT JOIN fee_school_settings fs ON fs.school_id=i.school_id
       WHERE i.id=$1 AND EXISTS (
         SELECT 1 FROM parents p JOIN parent_student_relationships r ON r.parent_id=p.id
         WHERE p.user_id=$2 AND p.school_id=i.school_id AND p.status='ACTIVE'
           AND r.student_id=i.student_id AND r.status='ACTIVE'
       )`,
      [invoiceId, context.user.id],
    );
    const row = result.rows[0];
    if (!row) throw new AuthError(404, "Invoice not found");
    res.json(GetParentFeeInvoiceCheckoutPolicyResponse.parse({
      ...row,
      invoiceId: Number(row.invoiceId),
      schoolId: Number(row.schoolId),
      outstandingMinor: Number(row.outstandingMinor),
      partialPaymentsEnabled: Boolean(row.partialPaymentsEnabled),
    }));
  } catch (error) { fail(res, error); }
});

router.post("/parent/fees/invoices/:invoiceId/bank-transfer", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    assertRoles(req, ["PARENT"]);
    const { invoiceId } = parsed(SubmitManualBankTransferParams, req.params);
    const headers = parsed(SubmitManualBankTransferHeader, { "Idempotency-Key": req.get("Idempotency-Key") });
    const body = parsed(SubmitManualBankTransferBody, req.body);
    const context = getUserContext(req);
    const bank = body.bank.trim();
    const transferReference = body.transferReference.trim();
    if (bank.length < 2 || transferReference.length < 2) {
      throw new AuthError(400, "Bank and transfer reference must contain at least two non-whitespace characters");
    }
    const transferDate = body.transferDate.toISOString().slice(0, 10);
    const storedIdempotencyKey = `BANK_TRANSFER:${context.user.id}:${headers["Idempotency-Key"]}`;
    await client.query("BEGIN");
    const invoice = await client.query(
      `SELECT i.* FROM fee_invoices i JOIN parents p ON p.school_id=i.school_id AND p.status='ACTIVE'
       JOIN parent_student_relationships r ON r.parent_id=p.id AND r.student_id=i.student_id AND r.status='ACTIVE'
       WHERE i.id=$1 AND p.user_id=$2 FOR UPDATE OF i`,
      [invoiceId, context.user.id],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    const existing = await client.query(
      `SELECT ${paymentShape},parent_id AS "parentId",transfer_reference AS "transferReference",transfer_bank AS bank
        ,transfer_date AS "transferDate",proof_url AS "proofUrl",submitted_by AS "submittedBy"
        FROM fee_payments WHERE school_id=$1 AND idempotency_key=$2`,
      [invoice.rows[0].school_id, storedIdempotencyKey],
    );
    if (existing.rows[0]) {
      const parent = await client.query(`SELECT id FROM parents WHERE user_id=$1 AND school_id=$2`, [context.user.id, invoice.rows[0].school_id]);
      if (existing.rows[0].invoiceId !== invoiceId || existing.rows[0].parentId !== parent.rows[0]?.id
          || existing.rows[0].submittedBy !== context.user.id
          || existing.rows[0].amountMinor !== body.amountMinor
          || existing.rows[0].transferReference !== transferReference
          || existing.rows[0].bank !== bank
          || dateOnly(existing.rows[0].transferDate) !== transferDate
          || existing.rows[0].proofUrl !== (body.proofUrl ?? null)) {
        throw new AuthError(409, "Idempotency key was already used for a different transfer");
      }
      await client.query("COMMIT");
      res.status(201).json(SubmitManualBankTransferResponse.parse(existing.rows[0]));
      return;
    }
    if (invoice.rows[0].status === "CANCELLED" || invoice.rows[0].status === "PAID") throw new AuthError(409, "Invoice is not payable");
    payableAmount(body.amountMinor, invoice.rows[0].outstanding_minor);
    const settings = await client.query(
      `SELECT partial_payments_enabled AS "partialPaymentsEnabled",
         bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1`,
      [invoice.rows[0].school_id],
    );
    if (!configuredBankDetails(settings.rows[0])) {
      throw new AuthError(409, "Manual bank transfers are not enabled or configured for this school");
    }
    const partialPaymentsEnabled = settings.rows[0]?.partialPaymentsEnabled ?? false;
    if (!partialPaymentsEnabled && body.amountMinor !== invoice.rows[0].outstanding_minor) {
      throw new AuthError(400, "Partial payments are disabled by this school's finance settings");
    }
    const parent = await client.query(`SELECT id FROM parents WHERE user_id=$1 AND school_id=$2`, [context.user.id, invoice.rows[0].school_id]);
    if (!parent.rows[0]) throw new AuthError(404, "Linked parent profile not found");
    const reference = `EDC-PAY-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO fee_payments (school_id,invoice_id,student_id,parent_id,reference,idempotency_key,amount_minor,
       method,transfer_bank,transfer_reference,transfer_date,proof_url,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'BANK_TRANSFER',$8,$9,$10,$11,$12)
       RETURNING ${paymentShape}`,
      [invoice.rows[0].school_id, invoiceId, invoice.rows[0].student_id, parent.rows[0].id, reference,
          storedIdempotencyKey, body.amountMinor, bank, transferReference,
         transferDate, body.proofUrl ?? null, context.user.id],
    );
    await audit(req, client, invoice.rows[0].school_id, "submitted manual bank transfer", "payment", inserted.rows[0].id);
    await enqueueFinancePaymentNotificationsSafely(
      client, Number(inserted.rows[0].id), Number(invoice.rows[0].school_id), "MANUAL_TRANSFER_SUBMITTED",
    );
    await client.query("COMMIT");
    res.status(201).json(SubmitManualBankTransferResponse.parse(inserted.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.post("/school/finance/payments/:paymentId/verify", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { paymentId } = parsed(VerifyManualBankTransferParams, req.params);
    const schoolId = schoolIdForMutation(req, VerifyManualBankTransferQueryParams, schoolRoles);
    const body = parsed(VerifyManualBankTransferBody, req.body);
    const evidenceReference = body.evidenceReference.trim();
    const reviewerNotes = body.reviewerNotes.trim();
    if (evidenceReference.length < 3 || reviewerNotes.length < 3) {
      throw new AuthError(400, "Evidence reference and reviewer notes must contain at least three non-whitespace characters");
    }
    const context = getUserContext(req);
    await client.query("BEGIN");
    const payment = await client.query(`SELECT * FROM fee_payments WHERE id=$1 AND school_id=$2 FOR UPDATE`, [paymentId, schoolId]);
    if (!payment.rows[0]) throw new AuthError(404, "Payment not found");
    const invoice = await client.query(`SELECT * FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`, [payment.rows[0].invoice_id, schoolId]);
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    if (payment.rows[0].status === "VERIFIED") {
      const metadata = payment.rows[0].verification_metadata;
      if (payment.rows[0].verified_by !== context.user.id
          || metadata?.evidenceReference !== evidenceReference
          || metadata?.reviewerNotes !== reviewerNotes) {
        throw new AuthError(409, "Payment was already verified with different reviewer evidence");
      }
      const receipt = await client.query(
        `SELECT receipt_number FROM fee_receipts WHERE payment_id=$1 AND school_id=$2 AND invoice_id=$3`,
        [paymentId, schoolId, invoice.rows[0].id],
      );
      if (!receipt.rows[0]?.receipt_number) throw new Error("Verified payment receipt integrity failure");
      await client.query("COMMIT");
      res.json(VerifyManualBankTransferResponse.parse({ ...mapPayment(payment.rows[0]), receiptNumber: receipt.rows[0].receipt_number }));
      return;
    }
    if (payment.rows[0].status !== "PENDING") throw new AuthError(409, "Only a pending bank transfer can be verified");
    if (payment.rows[0].method !== "BANK_TRANSFER") {
      throw new AuthError(409, "Only a submitted manual bank transfer can be verified here");
    }
    const bankName = String(payment.rows[0].transfer_bank ?? "").trim();
    const transferReference = String(payment.rows[0].transfer_reference ?? "").trim();
    if (!bankName || !transferReference) throw new AuthError(409, "Bank transfer details are incomplete");
    const duplicateReference = await client.query(
      `SELECT id FROM fee_payments
       WHERE school_id=$1 AND id<>$2 AND method='BANK_TRANSFER'
         AND LOWER(BTRIM(transfer_bank))=LOWER(BTRIM($3))
         AND LOWER(BTRIM(transfer_reference))=LOWER(BTRIM($4))
       FOR UPDATE`,
      [schoolId, paymentId, bankName, transferReference],
    );
    if (duplicateReference.rows[0]) throw new AuthError(409, "This bank transfer reference has already been submitted");
    const duplicateEvidence = await client.query(
      `SELECT id FROM fee_payments
       WHERE school_id=$1 AND id<>$2 AND method='BANK_TRANSFER' AND status='VERIFIED'
         AND LOWER(BTRIM(verification_evidence_ref))=LOWER(BTRIM($3))
       FOR UPDATE`,
      [schoolId, paymentId, evidenceReference],
    );
    if (duplicateEvidence.rows[0]) throw new AuthError(409, "This verification evidence reference was already used");
    payableAmount(payment.rows[0].amount_minor, invoice.rows[0].outstanding_minor);
    const updated = await client.query(
      `UPDATE fee_payments SET status='VERIFIED',verified_by=$1,verified_at=NOW(),
         verification_evidence_ref=$2,reviewer_notes=$3,verification_metadata=$4
       WHERE id=$5 AND school_id=$6 AND status='PENDING' RETURNING *`,
      [context.user.id, evidenceReference, reviewerNotes, {
        evidenceReference, reviewerNotes, reviewerUserId: context.user.id,
        reviewerRole: context.roles.find((role) => role.schoolId === schoolId)?.role,
        reviewedAt: new Date().toISOString(), paymentReference: payment.rows[0].reference,
        invoiceId: payment.rows[0].invoice_id, amountMinor: payment.rows[0].amount_minor,
        currency: payment.rows[0].currency, method: payment.rows[0].method,
      }, paymentId, schoolId],
    );
    const nextPaid = invoice.rows[0].paid_minor + payment.rows[0].amount_minor;
    const nextOutstanding = invoice.rows[0].total_minor - nextPaid;
    await client.query(
      `UPDATE fee_invoices SET paid_minor=$1,outstanding_minor=$2,status=$3 WHERE id=$4 AND school_id=$5`,
      [nextPaid, nextOutstanding, invoiceStatus(nextPaid, invoice.rows[0].total_minor), invoice.rows[0].id, schoolId],
    );
    const receiptNumber = `RCP-${schoolId}-${paymentId.toString().padStart(8, "0")}`;
    const schoolInfo = await client.query(
      `SELECT s.name,s.logo,l.id AS logo_version_id FROM schools s
        LEFT JOIN school_branding_logos l ON l.school_id=s.id AND l.is_current=true
       WHERE s.id=$1`,
      [schoolId],
    );
    const payer = payment.rows[0].parent_id
      ? await client.query(`SELECT name FROM parents WHERE id=$1 AND school_id=$2`, [payment.rows[0].parent_id, schoolId])
      : { rows: [] };
    const receiptSnapshot = {
      invoiceId: invoice.rows[0].id,
      schoolId,
      schoolName: schoolInfo.rows[0]?.name ?? null,
      schoolLogo: schoolInfo.rows[0]?.logo_version_id
        ? canonicalSchoolLogoVersionUrl(schoolId, Number(schoolInfo.rows[0].logo_version_id))
        : schoolInfo.rows[0]?.logo ?? null,
      schoolLogoVersionId: schoolInfo.rows[0]?.logo_version_id ?? null,
      invoiceNumber: invoice.rows[0].invoice_number, studentName: invoice.rows[0].student_name_snapshot,
      admissionNo: invoice.rows[0].admission_no_snapshot, className: invoice.rows[0].class_name_snapshot,
      sessionId: invoice.rows[0].academic_session_id, termId: invoice.rows[0].academic_term_id,
      payerName: payer.rows[0]?.name ?? null,
      paymentReference: payment.rows[0].reference, amountMinor: payment.rows[0].amount_minor,
      previousBalanceMinor: invoice.rows[0].outstanding_minor, remainingBalanceMinor: nextOutstanding,
      status: "VERIFIED", method: payment.rows[0].method, provider: payment.rows[0].provider,
    };
    await client.query(
      `INSERT INTO fee_receipts (school_id,payment_id,invoice_id,receipt_number,snapshot)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payment_id) DO NOTHING`,
      [schoolId, paymentId, invoice.rows[0].id, receiptNumber, receiptSnapshot],
    );
    const persistedReceipt = await client.query(
      `SELECT receipt_number,payment_id,invoice_id,school_id,(snapshot=$4::jsonb) AS snapshot_matches
       FROM fee_receipts WHERE payment_id=$1 AND school_id=$2 AND invoice_id=$3`,
      [paymentId, schoolId, invoice.rows[0].id, JSON.stringify(receiptSnapshot)],
    );
    if (persistedReceipt.rows[0]?.receipt_number !== receiptNumber
        || Number(persistedReceipt.rows[0]?.payment_id) !== paymentId
        || Number(persistedReceipt.rows[0]?.invoice_id) !== Number(invoice.rows[0].id)
        || Number(persistedReceipt.rows[0]?.school_id) !== schoolId
        || persistedReceipt.rows[0]?.snapshot_matches !== true) {
      throw new Error("Verified payment receipt integrity failure");
    }
    await enqueueFinancePaymentNotificationsSafely(client, paymentId, schoolId, "MANUAL_TRANSFER_APPROVED");
    await audit(req, client, schoolId, "verified manual bank transfer", "payment", paymentId, {
      amountMinor: payment.rows[0].amount_minor, evidenceReference, reviewerNotes,
    });
    await audit(req, client, schoolId, "generated receipt", "receipt", paymentId, { receiptNumber });
    await client.query("COMMIT");
    res.json(VerifyManualBankTransferResponse.parse({ ...mapPayment(updated.rows[0]), receiptNumber }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

function mapPayment(row: any) {
  return { id: row.id, schoolId: row.school_id, invoiceId: row.invoice_id, reference: row.reference,
    amountMinor: row.amount_minor, currency: row.currency, method: row.method, status: row.status };
}

router.post("/school/finance/payments/:paymentId/reject", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { paymentId } = parsed(RejectManualBankTransferParams, req.params);
    const schoolId = schoolIdForMutation(req, RejectManualBankTransferQueryParams, schoolRoles);
    const body = parsed(RejectManualBankTransferBody, req.body);
    const reason = body.reason.trim();
    if (!reason) throw new AuthError(400, "A rejection reason is required");
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT status,rejection_reason FROM fee_payments WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [paymentId, schoolId],
    );
    if (!current.rows[0]) throw new AuthError(404, "Payment not found");
    if (current.rows[0].status === "REJECTED" && current.rows[0].rejection_reason === reason) {
      const prior = await client.query(`SELECT ${paymentShape} FROM fee_payments WHERE id=$1 AND school_id=$2`, [paymentId, schoolId]);
      await client.query("COMMIT");
      res.json(RejectManualBankTransferResponse.parse(prior.rows[0]));
      return;
    }
    if (current.rows[0].status !== "PENDING") throw new AuthError(409, "Only a pending transfer can be rejected");
    const result = await client.query(
      `UPDATE fee_payments SET status='REJECTED',rejection_reason=$1
       WHERE id=$2 AND school_id=$3 AND status='PENDING' RETURNING ${paymentShape}`,
      [reason, paymentId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Pending payment not found");
    await audit(req, client, schoolId, "rejected manual bank transfer", "payment", paymentId, { reason });
    await enqueueFinancePaymentNotificationsSafely(client, paymentId, schoolId, "MANUAL_TRANSFER_REJECTED", { reason });
    await client.query("COMMIT");
    res.json(RejectManualBankTransferResponse.parse(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

const refundShape = `id,school_id AS "schoolId",payment_id AS "paymentId",invoice_id AS "invoiceId",
  transaction_type AS "transactionType",amount_minor AS "amountMinor",currency,reason,status,reference,
  evidence_reference AS "evidenceReference",reviewer_notes AS "reviewerNotes"`;

router.post("/school/finance/payments/:paymentId/refunds", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { paymentId } = parsed(RequestFeeRefundParams, req.params);
    const schoolId = schoolIdForMutation(req, RequestFeeRefundQueryParams, schoolRoles);
    const body = parsed(RequestFeeRefundBody, req.body);
    const headers = parsed(RequestFeeRefundHeader, { "Idempotency-Key": req.get("Idempotency-Key") });
    const context = getUserContext(req);
    const reason = body.reason.trim();
    const idempotencyKey = headers["Idempotency-Key"];
    await client.query("BEGIN");
    const paymentIdentity = await client.query(
      `SELECT invoice_id FROM fee_payments WHERE id=$1 AND school_id=$2`,
      [paymentId, schoolId],
    );
    if (!paymentIdentity.rows[0]) throw new AuthError(404, "Payment not found");
    const payment = await client.query(
      `SELECT * FROM fee_payments WHERE id=$1 AND school_id=$2 AND invoice_id=$3 FOR UPDATE`,
      [paymentId, schoolId, paymentIdentity.rows[0].invoice_id],
    );
    if (!payment.rows[0]) throw new AuthError(404, "Payment not found");
    const invoice = await client.query(
      `SELECT * FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [paymentIdentity.rows[0].invoice_id, schoolId],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    const replay = await client.query(
      `SELECT ${refundShape} FROM fee_refunds WHERE school_id=$1 AND idempotency_key=$2`,
      [schoolId, idempotencyKey],
    );
    const matchesRequest = (refund: any) =>
      Number(refund.paymentId) === paymentId && Number(refund.amountMinor) === body.amountMinor
      && refund.transactionType === body.transactionType && refund.reason === reason;
    if (replay.rows[0]) {
      if (!matchesRequest(replay.rows[0])) {
        throw new AuthError(409, "Idempotency key was already used for a different refund or reversal request");
      }
      await client.query("COMMIT");
      res.status(201).json(RequestFeeRefundResponse.parse(replay.rows[0]));
      return;
    }
    if (payment.rows[0].status !== "VERIFIED") {
      throw new AuthError(409, "Only a verified payment may have an internal refund or reversal recorded");
    }
    const refunded = await client.query(
      `SELECT COALESCE(SUM(amount_minor),0)::int AS total_minor
       FROM fee_refunds WHERE school_id=$1 AND payment_id=$2 AND status IN ('PENDING','APPROVED')`,
      [schoolId, paymentId],
    );
    const refundableMinor = Number(payment.rows[0].amount_minor) - Number(refunded.rows[0].total_minor);
    if (!Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0) {
      throw new AuthError(400, "Refund amount must be a positive integer number of minor currency units");
    }
    if (body.amountMinor > refundableMinor) {
      throw new AuthError(409, "Refund amount exceeds the remaining refundable payment balance");
    }
    const reference = `EDC-REF-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    const created = await client.query(
      `INSERT INTO fee_refunds
        (school_id,payment_id,invoice_id,reference,idempotency_key,transaction_type,amount_minor,currency,reason,requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (school_id,idempotency_key) DO NOTHING RETURNING ${refundShape}`,
      [schoolId, paymentId, invoice.rows[0].id, reference, idempotencyKey, body.transactionType,
        body.amountMinor, payment.rows[0].currency, reason, context.user.id],
    );
    if (!created.rows[0]) {
      const concurrentReplay = await client.query(
        `SELECT ${refundShape} FROM fee_refunds WHERE school_id=$1 AND idempotency_key=$2`,
        [schoolId, idempotencyKey],
      );
      if (!concurrentReplay.rows[0] || !matchesRequest(concurrentReplay.rows[0])) {
        throw new AuthError(409, "Idempotency key was already used for a different refund or reversal request");
      }
      await client.query("COMMIT");
      res.status(201).json(RequestFeeRefundResponse.parse(concurrentReplay.rows[0]));
      return;
    }
    await audit(req, client, schoolId, `requested internal ${body.transactionType.toLowerCase()} ledger entry`, "fee refund", created.rows[0].id, {
      paymentId, transactionType: body.transactionType, amountMinor: body.amountMinor, reference,
    });
    await client.query("COMMIT");
    res.status(201).json(RequestFeeRefundResponse.parse(created.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

const schoolRefundHistoryShape = `fr.id,fr.school_id AS "schoolId",fr.payment_id AS "paymentId",
  fr.invoice_id AS "invoiceId",fr.transaction_type AS "transactionType",i.invoice_number AS "invoiceNumber",p.student_id AS "studentId",
  i.student_name_snapshot AS "studentName",i.class_name_snapshot AS "className",
  i.section_snapshot AS section,p.reference AS "paymentReference",p.amount_minor AS "paymentAmountMinor",
  p.method AS "paymentMethod",p.status AS "paymentStatus",fr.amount_minor AS "amountMinor",
  fr.currency,fr.reason,fr.status,fr.reference,fr.evidence_reference AS "evidenceReference",
  fr.reviewer_notes AS "reviewerNotes",
  to_char(fr.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "requestedAt",
  CASE WHEN fr.approved_at IS NULL THEN NULL
    ELSE to_char(fr.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "approvedAt"`;

function schoolRefundJoinWhere() {
  return `FROM fee_refunds fr
    JOIN fee_payments p ON p.id=fr.payment_id AND p.school_id=fr.school_id AND p.invoice_id=fr.invoice_id
    JOIN fee_invoices i ON i.id=fr.invoice_id AND i.school_id=fr.school_id`;
}

router.get("/school/finance/refunds", async (req, res): Promise<void> => {
  try {
    const filters = parsed(ListSchoolFeeRefundsQueryParams, req.query);
    const schoolId = schoolIdForMutation(req, { parse: () => filters }, schoolRoles);
    const result = await pool.query(
      `SELECT ${schoolRefundHistoryShape} ${schoolRefundJoinWhere()}
       WHERE fr.school_id=$1 AND ($2::text='ALL' OR fr.status=$2)
       ORDER BY fr.created_at DESC,fr.id DESC`,
      [schoolId, filters.status],
    );
    res.json(ListSchoolFeeRefundsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.get("/school/finance/refunds/:refundId", async (req, res): Promise<void> => {
  try {
    const { refundId } = parsed(GetSchoolFeeRefundParams, req.params);
    const { schoolId } = parsed(GetSchoolFeeRefundQueryParams, req.query);
    schoolIdForMutation(req, { parse: () => ({ schoolId }) }, schoolRoles);
    const result = await pool.query(
      `SELECT ${schoolRefundHistoryShape} ${schoolRefundJoinWhere()}
       WHERE fr.id=$1 AND fr.school_id=$2`,
      [refundId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Refund not found");
    res.json(GetSchoolFeeRefundResponse.parse(result.rows[0]));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/refunds/:refundId/approve", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { refundId } = parsed(ApproveFeeRefundParams, req.params);
    const schoolId = schoolIdForMutation(req, ApproveFeeRefundQueryParams, ["SCHOOL_ADMIN"]);
    const body = parsed(ApproveFeeRefundBody, req.body);
    const evidenceReference = body.evidenceReference.trim();
    const reviewerNotes = body.reviewerNotes.trim();
    if (evidenceReference.length < 3 || reviewerNotes.length < 3) {
      throw new AuthError(400, "Refund ledger evidence reference and reviewer notes are required");
    }
    const context = getUserContext(req);
    await client.query("BEGIN");
    const refundIdentity = await client.query(
      `SELECT payment_id,invoice_id FROM fee_refunds WHERE id=$1 AND school_id=$2`,
      [refundId, schoolId],
    );
    if (!refundIdentity.rows[0]) throw new AuthError(404, "Refund not found");
    const payment = await client.query(
      `SELECT * FROM fee_payments WHERE id=$1 AND school_id=$2 AND invoice_id=$3 FOR UPDATE`,
      [refundIdentity.rows[0].payment_id, schoolId, refundIdentity.rows[0].invoice_id],
    );
    if (!payment.rows[0]) throw new AuthError(404, "Payment not found");
    const invoice = await client.query(
      `SELECT * FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [refundIdentity.rows[0].invoice_id, schoolId],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    const current = await client.query(
      `SELECT * FROM fee_refunds WHERE id=$1 AND school_id=$2 AND payment_id=$3 AND invoice_id=$4 FOR UPDATE`,
      [refundId, schoolId, refundIdentity.rows[0].payment_id, invoice.rows[0].id],
    );
    if (!current.rows[0]) throw new AuthError(404, "Refund not found");
    if (current.rows[0].status === "APPROVED") {
      if (current.rows[0].approved_by !== context.user.id
          || current.rows[0].evidence_reference !== evidenceReference
          || current.rows[0].reviewer_notes !== reviewerNotes) {
        throw new AuthError(409, "Refund was already approved with different evidence");
      }
      await client.query("COMMIT");
      res.json(ApproveFeeRefundResponse.parse({
        id: current.rows[0].id, schoolId, paymentId: current.rows[0].payment_id, invoiceId: current.rows[0].invoice_id,
        transactionType: current.rows[0].transaction_type,
        amountMinor: current.rows[0].amount_minor, currency: current.rows[0].currency, reason: current.rows[0].reason,
        status: current.rows[0].status, reference: current.rows[0].reference,
        evidenceReference: current.rows[0].evidence_reference, reviewerNotes: current.rows[0].reviewer_notes,
      }));
      return;
    }
    if (current.rows[0].status !== "PENDING") throw new AuthError(409, "Only pending refunds can be approved");
    if (payment.rows[0].status !== "VERIFIED") {
      throw new AuthError(409, "Refund requires its original verified payment");
    }
    const priorRefunds = await client.query(
      `SELECT COALESCE(SUM(amount_minor),0)::int AS total_minor
       FROM fee_refunds WHERE school_id=$1 AND payment_id=$2 AND status='APPROVED'`,
      [schoolId, payment.rows[0].id],
    );
    if (Number(priorRefunds.rows[0].total_minor) + Number(current.rows[0].amount_minor) > Number(payment.rows[0].amount_minor)
        || Number(invoice.rows[0].paid_minor) < Number(current.rows[0].amount_minor)) {
      throw new AuthError(409, "Refund exceeds the verified payment or invoice paid balance");
    }
    const duplicateEvidence = await client.query(
      `SELECT id FROM fee_refunds WHERE school_id=$1 AND id<>$2 AND status='APPROVED'
       AND LOWER(BTRIM(evidence_reference))=LOWER(BTRIM($3)) FOR UPDATE`,
      [schoolId, refundId, evidenceReference],
    );
    if (duplicateEvidence.rows[0]) throw new AuthError(409, "This external refund evidence reference was already used");
    const nextPaid = Number(invoice.rows[0].paid_minor) - Number(current.rows[0].amount_minor);
    const nextOutstanding = Number(invoice.rows[0].total_minor) - nextPaid;
    const fullRefund = Number(priorRefunds.rows[0].total_minor) + Number(current.rows[0].amount_minor)
      >= Number(payment.rows[0].amount_minor);
    const updated = await client.query(
      `UPDATE fee_refunds SET status='APPROVED',approved_by=$1,approved_at=NOW(),
         evidence_reference=$2,reviewer_notes=$3
       WHERE id=$4 AND school_id=$5 AND status='PENDING' RETURNING ${refundShape}`,
      [context.user.id, evidenceReference, reviewerNotes, refundId, schoolId],
    );
    if (!updated.rows[0]) throw new AuthError(409, "Refund approval did not complete");
    await client.query(
      `UPDATE fee_invoices SET paid_minor=$1,outstanding_minor=$2,status=$3 WHERE id=$4 AND school_id=$5`,
      [nextPaid, nextOutstanding, invoiceStatus(nextPaid, invoice.rows[0].total_minor), invoice.rows[0].id, schoolId],
    );
    if (fullRefund) {
      const paymentTerminalStatus = current.rows[0].transaction_type === "REVERSAL" ? "REVERSED" : "REFUNDED";
      await client.query(
        `UPDATE fee_payments SET status=$1 WHERE id=$2 AND school_id=$3 AND status='VERIFIED'`,
        [paymentTerminalStatus, payment.rows[0].id, schoolId],
      );
    }
    await audit(req, client, schoolId, `approved internal ${current.rows[0].transaction_type.toLowerCase()} ledger entry`, "fee refund", refundId, {
      paymentId: payment.rows[0].id, reference: current.rows[0].reference,
      transactionType: current.rows[0].transaction_type,
      amountMinor: current.rows[0].amount_minor, evidenceReference, reviewerNotes,
    });
    await enqueueFinancePaymentNotificationsSafely(
      client,
      payment.rows[0].id,
      schoolId,
      current.rows[0].transaction_type === "REVERSAL" ? "REVERSAL_APPROVED" : "REFUND_APPROVED",
      {
        refundId,
        transactionType: current.rows[0].transaction_type,
        amountMinor: current.rows[0].amount_minor,
      },
      refundId,
    );
    await client.query("COMMIT");
    res.json(ApproveFeeRefundResponse.parse(updated.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.get("/finance/payments/:paymentId/receipt", async (req, res): Promise<void> => {
  try {
    const { paymentId } = parsed(GetFeePaymentReceiptParams, req.params);
    const query = parsed(GetFeePaymentReceiptQueryParams, req.query);
    const context = getUserContext(req);
    const roles = context.roles.map((assignment) => assignment.role);
    const values: unknown[] = [paymentId];
    let authorization = "";
    if (roles.includes("SCHOOL_ADMIN") || roles.includes("ACCOUNTANT") || roles.includes("PLATFORM_OWNER")) {
      if (!query.schoolId) throw new AuthError(400, "schoolId is required for school receipt access");
      assertSchoolAccess(req, query.schoolId, [...schoolRoles]);
      values.push(query.schoolId);
      authorization = `AND p.school_id=$2`;
    } else if (roles.includes("PARENT")) {
      values.push(context.user.id);
      authorization = `AND EXISTS (SELECT 1 FROM parents pa JOIN parent_student_relationships r ON r.parent_id=pa.id
        WHERE pa.user_id=$2 AND pa.status='ACTIVE' AND pa.school_id=p.school_id AND r.student_id=p.student_id AND r.status='ACTIVE')`;
    } else if (roles.includes("STUDENT")) {
      values.push(context.user.id);
      authorization = `AND EXISTS (SELECT 1 FROM students st WHERE st.id=p.student_id AND st.school_id=p.school_id AND st.user_id=$2)`;
    } else {
      throw new AuthError(403, "You are not authorized to view this receipt");
    }
    const result = await pool.query(
      `SELECT r.receipt_number AS "receiptNumber",r.payment_id AS "paymentId",r.school_id AS "schoolId",
          r.invoice_id AS "invoiceId",r.snapshot
       FROM fee_receipts r JOIN fee_payments p
         ON p.id=r.payment_id AND p.school_id=r.school_id AND p.invoice_id=r.invoice_id
       WHERE p.id=$1 AND p.status IN ('VERIFIED','REFUNDED','REVERSED') ${authorization}`,
      values,
    );
    if (!result.rows[0]) throw new AuthError(404, "Verified payment receipt not found");
    const receipt = GetFeePaymentReceiptResponse.parse(result.rows[0]);
    if (receipt.snapshot.invoiceId !== result.rows[0].invoiceId
        || receipt.snapshot.schoolId !== result.rows[0].schoolId) {
      throw new Error("Verified payment receipt integrity failure");
    }
    res.json({ ...receipt, snapshot: result.rows[0].snapshot });
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/invoices/:invoiceId/adjustments", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { invoiceId } = parsed(RequestFeeAdjustmentParams, req.params);
    const schoolId = schoolIdForMutation(req, RequestFeeAdjustmentQueryParams, schoolRoles);
    const body = parsed(RequestFeeAdjustmentBody, req.body);
    const context = getUserContext(req);
    const hasFixedAmount = body.amountMinor !== undefined;
    const hasPercentage = body.percentage !== undefined;
    if (hasFixedAmount === hasPercentage
        || (hasPercentage && body.kind !== "DISCOUNT")) {
      throw new AuthError(400, "Provide exactly one fixed amount or percentage; percentages are supported for discounts only");
    }
    await client.query("BEGIN");
    const invoice = await client.query(
      `SELECT id,subtotal_minor,paid_minor,total_minor,outstanding_minor
       FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR SHARE`,
      [invoiceId, schoolId],
    );
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    const originalBalance = Number(invoice.rows[0].outstanding_minor);
    const percentage = body.percentage ?? null;
    const amountMinor = percentage === null
      ? body.amountMinor!
      : percentageOfOriginalSubtotal(invoice.rows[0].subtotal_minor, percentage);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > originalBalance) {
      throw new AuthError(409, "Adjustment amount must be positive and cannot exceed the current outstanding balance");
    }
    const result = await client.query(
      `INSERT INTO fee_adjustments
        (school_id,invoice_id,kind,amount_minor,requested_percentage,original_balance_minor,reason,requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${feeAdjustmentShape}`,
      [schoolId, invoiceId, body.kind, amountMinor, percentage, originalBalance, body.reason, context.user.id],
    );
    await audit(req, client, schoolId, "requested adjustment", "fee adjustment", result.rows[0].id, {
      kind: body.kind, amountMinor, percentage, originalBalanceMinor: originalBalance,
    });
    await client.query("COMMIT");
    res.status(201).json(RequestFeeAdjustmentResponse.parse(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.get("/school/finance/adjustments/pending", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, ListPendingFeeAdjustmentsQueryParams);
    const result = await pool.query(
      `SELECT a.id,a.school_id AS "schoolId",a.invoice_id AS "invoiceId",
        i.invoice_number AS "invoiceNumber",i.student_id AS "studentId",
        i.student_name_snapshot AS "studentName",a.kind,a.amount_minor AS "amountMinor",
        a.requested_percentage::float AS percentage,a.original_balance_minor AS "originalBalanceMinor",
        a.requested_by AS "requestedBy",a.reason,a.status,
        to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "requestedAt"
       FROM fee_adjustments a JOIN fee_invoices i ON i.id=a.invoice_id AND i.school_id=a.school_id
       WHERE a.school_id=$1 AND a.status='PENDING'
       ORDER BY a.created_at ASC,a.id ASC`,
      [schoolId],
    );
    res.json(ListPendingFeeAdjustmentsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/adjustments/:adjustmentId/approve", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const { adjustmentId } = parsed(ApproveFeeAdjustmentParams, req.params);
    const schoolId = schoolIdForMutation(req, ApproveFeeAdjustmentQueryParams, ["SCHOOL_ADMIN"]);
    const context = getUserContext(req);
    await client.query("BEGIN");
    const adjustment = await client.query(`SELECT * FROM fee_adjustments WHERE id=$1 AND school_id=$2 FOR UPDATE`, [adjustmentId, schoolId]);
    if (!adjustment.rows[0]) throw new AuthError(404, "Adjustment not found");
    if (adjustment.rows[0].status === "APPROVED") {
      await client.query("COMMIT");
      res.json(ApproveFeeAdjustmentResponse.parse({
        id: adjustmentId, schoolId, invoiceId: adjustment.rows[0].invoice_id, kind: adjustment.rows[0].kind,
        amountMinor: adjustment.rows[0].amount_minor,
        percentage: adjustment.rows[0].requested_percentage === null ? null : Number(adjustment.rows[0].requested_percentage),
        approvedAmountMinor: adjustment.rows[0].approved_amount_minor,
        originalBalanceMinor: adjustment.rows[0].original_balance_minor,
        resultingBalanceMinor: adjustment.rows[0].resulting_balance_minor,
        reason: adjustment.rows[0].reason, status: "APPROVED", requestedBy: adjustment.rows[0].requested_by,
        requestedAt: dateTime(adjustment.rows[0].created_at),
        approvedBy: adjustment.rows[0].approved_by,
        approvedAt: dateTime(adjustment.rows[0].approved_at),
      }));
      return;
    }
    if (adjustment.rows[0].status !== "PENDING") throw new AuthError(409, "Only pending adjustments can be approved");
    const invoice = await client.query(`SELECT * FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`, [adjustment.rows[0].invoice_id, schoolId]);
    const invoiceRow = invoice.rows[0];
    if (!invoiceRow) throw new AuthError(404, "Invoice not found");
    const approvedAmount = adjustment.rows[0].requested_percentage === null
      ? Number(adjustment.rows[0].amount_minor)
      : percentageOfOriginalSubtotal(invoiceRow.subtotal_minor, adjustment.rows[0].requested_percentage);
    const originalBalance = Number(invoiceRow.outstanding_minor);
    const discount = Number(invoiceRow.discount_minor) + (adjustment.rows[0].kind === "WAIVER" ? 0 : approvedAmount);
    const waiver = Number(invoiceRow.waiver_minor) + (adjustment.rows[0].kind === "WAIVER" ? approvedAmount : 0);
    const total = invoiceRow.subtotal_minor - discount - waiver;
    if (!Number.isSafeInteger(approvedAmount) || approvedAmount <= 0
        || total < 0 || total < invoiceRow.paid_minor || approvedAmount > originalBalance) {
      throw new AuthError(409, "Adjustment would create a negative balance or reduce the invoice below verified payments");
    }
    const resultingBalance = total - Number(invoiceRow.paid_minor);
    await client.query(
      `UPDATE fee_invoices SET discount_minor=$1,waiver_minor=$2,total_minor=$3,outstanding_minor=$4,
       status=$5 WHERE id=$6 AND school_id=$7`,
      [discount, waiver, total, total - invoiceRow.paid_minor, invoiceStatus(invoiceRow.paid_minor, total), invoiceRow.id, schoolId],
    );
    const updated = await client.query(
      `UPDATE fee_adjustments SET status='APPROVED',approved_by=$1,approved_at=NOW(),
         approved_amount_minor=$2,resulting_balance_minor=$3
       WHERE id=$4 AND school_id=$5 RETURNING ${feeAdjustmentShape}`,
      [context.user.id, approvedAmount, resultingBalance, adjustmentId, schoolId],
    );
    await audit(req, client, schoolId, "approved adjustment", "fee adjustment", adjustmentId, {
      kind: adjustment.rows[0].kind, requestedPercentage: adjustment.rows[0].requested_percentage,
      approvedAmountMinor: approvedAmount, originalBalanceMinor: originalBalance,
      resultingBalanceMinor: resultingBalance,
    });
    await client.query("COMMIT");
    res.json(ApproveFeeAdjustmentResponse.parse(updated.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

router.get("/school/finance/summary", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, GetSchoolFinanceSummaryQueryParams);
    const result = await pool.query(
       `SELECT COALESCE(SUM(total_minor),0)::int AS "totalBilledMinor",
        COALESCE((SELECT SUM(GREATEST(p.amount_minor-COALESCE((
          SELECT SUM(fr.amount_minor) FROM fee_refunds fr
          WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
        ),0),0)) FROM fee_payments p
          JOIN fee_invoices paid_invoice ON paid_invoice.id=p.invoice_id AND paid_invoice.school_id=p.school_id
          WHERE p.school_id=$1 AND paid_invoice.status <> 'CANCELLED'
            AND p.status IN ('VERIFIED','REFUNDED','REVERSED')),0)::int AS "totalCollectedMinor",
       COALESCE(SUM(outstanding_minor),0)::int AS "totalOutstandingMinor",
       (SELECT COALESCE(SUM(COALESCE(a.approved_amount_minor,a.amount_minor)),0)::bigint
          FROM fee_adjustments a WHERE a.school_id=$1 AND a.status='APPROVED') AS "totalAdjustmentsMinor",
       (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint
          FROM fee_refunds fr WHERE fr.school_id=$1 AND fr.status='APPROVED'
            AND fr.transaction_type='REFUND') AS "totalRefundedMinor",
       (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint
          FROM fee_refunds fr WHERE fr.school_id=$1 AND fr.status='APPROVED'
            AND fr.transaction_type='REVERSAL') AS "totalReversedMinor",
       (SELECT COUNT(*)::int FROM fee_payments WHERE school_id=$1 AND status='PENDING') AS "pendingPayments"
       FROM fee_invoices WHERE school_id=$1 AND status <> 'CANCELLED'`,
      [schoolId],
    );
    res.json(GetSchoolFinanceSummaryResponse.parse({
      ...result.rows[0],
      totalBilledMinor: exactInteger(result.rows[0].totalBilledMinor),
      totalCollectedMinor: exactInteger(result.rows[0].totalCollectedMinor),
      totalOutstandingMinor: exactInteger(result.rows[0].totalOutstandingMinor),
      totalAdjustmentsMinor: exactInteger(result.rows[0].totalAdjustmentsMinor),
      totalRefundedMinor: exactInteger(result.rows[0].totalRefundedMinor),
      totalReversedMinor: exactInteger(result.rows[0].totalReversedMinor),
      pendingPayments: exactInteger(result.rows[0].pendingPayments),
    }));
  } catch (error) { fail(res, error); }
});

router.get("/school/finance/reports", async (req, res): Promise<void> => {
  try {
    const filters = parsed(GetSchoolFinanceReportQueryParams, queryCalendarDates(req.query));
    assertSchoolAccess(req, filters.schoolId, [...schoolRoles]);
    const values: unknown[] = [filters.schoolId];
    const predicates = ["i.school_id=$1", "i.status <> 'CANCELLED'"];
    let studentIdFilterIndex: number | null = null;
    let paymentMethodFilterIndex: number | null = null;
    const add = (sql: (index: number) => string, value: unknown) => {
      values.push(value);
      predicates.push(sql(values.length));
    };
    if (filters.sessionId !== undefined) add((n) => `i.academic_session_id=$${n}`, filters.sessionId);
    if (filters.termId !== undefined) add((n) => `i.academic_term_id=$${n}`, filters.termId);
    if (filters.classId !== undefined) {
      add((n) => `EXISTS (SELECT 1 FROM fee_structures fs WHERE fs.id=i.structure_id
        AND fs.school_id=i.school_id AND fs.school_class_id=$${n})`, filters.classId);
    }
    if (filters.section !== undefined) add((n) => `i.section_snapshot=$${n}`, filters.section);
    if (filters.categoryId !== undefined) {
      add((n) => `EXISTS (SELECT 1 FROM fee_invoice_lines fil WHERE fil.invoice_id=i.id AND fil.school_id=i.school_id AND fil.category_id=$${n})`, filters.categoryId);
    }
    if (filters.studentId !== undefined) {
      studentIdFilterIndex = values.length + 1;
      add((n) => `i.student_id=$${n}`, filters.studentId);
    }
    if (filters.method !== undefined) {
      paymentMethodFilterIndex = values.length + 1;
      add((n) => `EXISTS (SELECT 1 FROM fee_payments fp WHERE fp.invoice_id=i.id
        AND fp.school_id=i.school_id AND fp.method=$${n})`, filters.method);
    }
    const reportType = filters.reportType;
    if (reportType !== "payments" && reportType !== "provider-reconciliation") {
      if (filters.from) add((n) => `i.issue_date >= $${n}::date`, dateOnly(filters.from));
      if (filters.to) add((n) => `i.issue_date <= $${n}::date`, dateOnly(filters.to));
    }
    const invoiceWhere = predicates.join(" AND ");
    const commonCte = `WITH invoice_scope AS (SELECT i.* FROM fee_invoices i WHERE ${invoiceWhere})`;
    const totals = await pool.query(
      `WITH invoice_scope AS (SELECT i.* FROM fee_invoices i WHERE ${invoiceWhere})
       SELECT COALESCE(SUM(total_minor),0)::bigint AS "totalBilledMinor",
          COALESCE((SELECT SUM(GREATEST(p.amount_minor-COALESCE((
            SELECT SUM(fr.amount_minor) FROM fee_refunds fr
            WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
          ),0),0)) FROM fee_payments p
            JOIN invoice_scope si ON si.id=p.invoice_id AND si.school_id=p.school_id
            WHERE p.status IN ('VERIFIED','REFUNDED','REVERSED')),0)::bigint AS "totalCollectedMinor",
         COALESCE(SUM(outstanding_minor),0)::bigint AS "totalOutstandingMinor",
         COALESCE(SUM(discount_minor),0)::bigint AS "totalDiscountMinor",
         COALESCE(SUM(waiver_minor),0)::bigint AS "totalWaiverMinor",
         (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint FROM fee_refunds fr
           JOIN invoice_scope si ON si.id=fr.invoice_id AND si.school_id=fr.school_id
           WHERE fr.status='APPROVED' AND fr.transaction_type='REFUND') AS "totalRefundedMinor",
         (SELECT COALESCE(SUM(fr.amount_minor),0)::bigint FROM fee_refunds fr
           JOIN invoice_scope si ON si.id=fr.invoice_id AND si.school_id=fr.school_id
           WHERE fr.status='APPROVED' AND fr.transaction_type='REVERSAL') AS "totalReversedMinor"
       FROM invoice_scope`,
      values,
    );
    if (reportType === "payments" || reportType === "provider-reconciliation") {
      const collectionValues = [...values];
      const paymentDatePredicates: string[] = [];
      const paymentTimestamp = "COALESCE(p.verified_at,p.created_at)";
      if (filters.from) {
        collectionValues.push(dateOnly(filters.from));
        paymentDatePredicates.push(`${paymentTimestamp} >= $${collectionValues.length}::date`);
      }
      if (filters.to) {
        collectionValues.push(dateOnly(filters.to));
        paymentDatePredicates.push(`${paymentTimestamp} < $${collectionValues.length}::date + INTERVAL '1 day'`);
      }
      if (filters.status && reportType === "payments") {
        collectionValues.push(filters.status);
        paymentDatePredicates.push(`p.status=$${collectionValues.length}`);
      }
      if (filters.provider) {
        collectionValues.push(filters.provider);
        paymentDatePredicates.push(`p.provider=$${collectionValues.length}`);
      }
      if (filters.method) {
        collectionValues.push(filters.method);
        paymentDatePredicates.push(`p.method=$${collectionValues.length}`);
      }
      if (filters.status && reportType === "provider-reconciliation") {
        collectionValues.push(filters.status);
        paymentDatePredicates.push(`(
          EXISTS (SELECT 1 FROM fee_provider_webhook_events e
            WHERE e.school_id=p.school_id AND e.payment_id=p.id AND e.status=$${collectionValues.length})
          OR EXISTS (SELECT 1 FROM fee_provider_checkout_sessions cs
            WHERE cs.school_id=p.school_id AND cs.payment_id=p.id AND cs.state=$${collectionValues.length})
        )`);
      }
      const collected = await pool.query(
        `${commonCte}
         SELECT COALESCE(SUM(GREATEST(p.amount_minor-COALESCE((
           SELECT SUM(fr.amount_minor) FROM fee_refunds fr
           WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
         ),0),0)),0)::bigint AS "totalCollectedMinor"
         FROM fee_payments p JOIN invoice_scope si ON si.id=p.invoice_id AND si.school_id=p.school_id
         WHERE p.school_id=$1 AND p.status IN ('VERIFIED','REFUNDED','REVERSED')
           ${paymentDatePredicates.length ? ` AND ${paymentDatePredicates.join(" AND ")}` : ""}`,
        collectionValues,
      );
      totals.rows[0].totalCollectedMinor = collected.rows[0].totalCollectedMinor;
    }
    const additional: unknown[] = [...values];
    let grouped: any;
    switch (reportType) {
      case "payments":
      {
        const pWhere = ["p.school_id=$1", "EXISTS (SELECT 1 FROM invoice_scope si WHERE si.id=p.invoice_id AND si.school_id=p.school_id)"];
        const paymentTimestamp = "COALESCE(p.verified_at,p.created_at)";
        if (filters.status) {
          if (reportType === "payments") {
            additional.push(filters.status);
            pWhere.push(`p.status=$${additional.length}`);
          }
        }
        if (filters.provider) {
          additional.push(filters.provider);
          pWhere.push(`p.provider=$${additional.length}`);
        }
        if (filters.method) {
          additional.push(filters.method);
          pWhere.push(`p.method=$${additional.length}`);
        }
        if (filters.from) {
          additional.push(dateOnly(filters.from));
          pWhere.push(`${paymentTimestamp} >= $${additional.length}::date`);
        }
        if (filters.to) {
          additional.push(dateOnly(filters.to));
          pWhere.push(`${paymentTimestamp} < $${additional.length}::date + INTERVAL '1 day'`);
        }
        grouped = await pool.query(
          `${commonCte}
           SELECT p.method || ':' || p.status AS label,1::int AS count,
              CASE WHEN p.status IN ('VERIFIED','REFUNDED','REVERSED')
                THEN GREATEST(p.amount_minor-COALESCE((
                  SELECT SUM(fr.amount_minor) FROM fee_refunds fr
                  WHERE fr.school_id=p.school_id AND fr.payment_id=p.id AND fr.status='APPROVED'
                ),0),0) ELSE 0 END::bigint AS "amountMinor",
              CASE WHEN p.status NOT IN ('VERIFIED','REFUNDED','REVERSED')
                THEN p.amount_minor ELSE 0 END::bigint AS "secondaryAmountMinor",
             p.student_id AS "studentId",i.student_name_snapshot AS "studentName",
             i.id AS "invoiceId",i.invoice_number AS "invoiceNumber",p.reference,
              to_char(${paymentTimestamp} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "paymentDate",
             NULL::bigint AS "paidMinor",NULL::bigint AS "outstandingMinor",NULL::boolean AS overdue
           FROM fee_payments p JOIN invoice_scope i ON i.id=p.invoice_id AND i.school_id=p.school_id
           WHERE ${pWhere.join(" AND ")}
            ORDER BY ${paymentTimestamp} DESC,p.id DESC`,
          additional,
        );
        break;
      }
      case "provider-reconciliation": {
        const eventValues: unknown[] = [...values];
        const checkoutPredicates = ["cs.school_id=$1",
          "EXISTS (SELECT 1 FROM invoice_scope si WHERE si.id=cs.invoice_id AND si.school_id=cs.school_id)"];
        const webhookPredicates = ["e.school_id=$1"];
        const linkedPaymentPredicates = [
          studentIdFilterIndex === null ? null : `p.student_id=$${studentIdFilterIndex}`,
          paymentMethodFilterIndex === null ? null : `p.method=$${paymentMethodFilterIndex}`,
        ].filter((predicate): predicate is string => predicate !== null);
        checkoutPredicates.push(...linkedPaymentPredicates);
        if (linkedPaymentPredicates.length) {
          webhookPredicates.push(`p.id IS NOT NULL AND ${linkedPaymentPredicates.join(" AND ")}`);
        }
        if (filters.provider) {
          eventValues.push(filters.provider);
          checkoutPredicates.push(`cs.provider=$${eventValues.length}`);
          webhookPredicates.push(`e.provider=$${eventValues.length}`);
        }
        if (filters.status) {
          eventValues.push(filters.status);
          checkoutPredicates.push(`cs.state=$${eventValues.length}`);
          webhookPredicates.push(`e.status=$${eventValues.length}`);
        }
        if (filters.from) {
          eventValues.push(dateOnly(filters.from));
          checkoutPredicates.push(`cs.created_at >= $${eventValues.length}::date`);
          webhookPredicates.push(`e.received_at >= $${eventValues.length}::date`);
        }
        if (filters.to) {
          eventValues.push(dateOnly(filters.to));
          checkoutPredicates.push(`cs.created_at < $${eventValues.length}::date + INTERVAL '1 day'`);
          webhookPredicates.push(`e.received_at < $${eventValues.length}::date + INTERVAL '1 day'`);
        }
        grouped = await pool.query(
          `${commonCte}
           SELECT 'CHECKOUT'::text AS "sourceType",cs.school_id AS "schoolId",cs.provider,
             cs.state AS "checkoutState",NULL::text AS "reconciliationStatus",NULL::boolean AS "signatureVerified",
             NULL::text AS "eventId",NULL::text AS "webhookTransactionId",NULL::text AS "verifiedTransactionId",
             cs.reference AS reference,cs.reference AS "providerReference",
             CASE WHEN cs.state='FAILED' THEN cs.last_error ELSE NULL END AS reason,
             p.student_id AS "studentId",i.student_name_snapshot AS "studentName",
             i.id AS "invoiceId",i.invoice_number AS "invoiceNumber",p.status AS "paymentStatus",
             to_char(cs.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "eventDate",
              'CHECKOUT:' || cs.state AS label,1::int AS count,p.amount_minor::bigint AS "amountMinor",
             0::bigint AS "secondaryAmountMinor"
           FROM fee_provider_checkout_sessions cs
           JOIN fee_payments p ON p.id=cs.payment_id AND p.school_id=cs.school_id
           JOIN invoice_scope i ON i.id=cs.invoice_id AND i.school_id=cs.school_id
           WHERE ${checkoutPredicates.join(" AND ")}
           UNION ALL
           SELECT 'WEBHOOK'::text AS "sourceType",e.school_id AS "schoolId",e.provider,
              (SELECT checkout.state FROM fee_provider_checkout_sessions checkout
                WHERE checkout.payment_id=p.id AND checkout.school_id=e.school_id
                ORDER BY checkout.created_at DESC LIMIT 1) AS "checkoutState",
              e.status AS "reconciliationStatus",e.signature_verified AS "signatureVerified",
             e.event_id AS "eventId",e.webhook_transaction_id AS "webhookTransactionId",
             e.verified_transaction_id AS "verifiedTransactionId",
              COALESCE(e.provider_reference,p.reference) AS reference,
             e.provider_reference AS "providerReference",e.error_message AS reason,
             p.student_id AS "studentId",i.student_name_snapshot AS "studentName",
             i.id AS "invoiceId",i.invoice_number AS "invoiceNumber",p.status AS "paymentStatus",
             to_char(e.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "eventDate",
              'WEBHOOK:' || e.status AS label,1::int AS count,COALESCE(p.amount_minor,0)::bigint AS "amountMinor",
             0::bigint AS "secondaryAmountMinor"
           FROM fee_provider_webhook_events e
           LEFT JOIN fee_payments p ON p.id=e.payment_id AND p.school_id=e.school_id
           LEFT JOIN invoice_scope i ON i.id=p.invoice_id AND i.school_id=p.school_id
           WHERE ${webhookPredicates.join(" AND ")}
           ORDER BY "eventDate" DESC,"sourceType"`,
          eventValues,
        );
        break;
      }
      case "outstanding":
        {
        const outstandingValues = [...values];
        const statusPredicate = filters.status
          ? (outstandingValues.push(filters.status), ` AND CASE WHEN status='OVERDUE' OR due_date<CURRENT_DATE THEN 'OVERDUE' ELSE status END=$${outstandingValues.length}`)
          : "";
        grouped = await pool.query(
          `${commonCte} SELECT CASE WHEN status='OVERDUE' OR due_date < CURRENT_DATE THEN 'OVERDUE' ELSE status END AS label,
             1::int AS count,outstanding_minor::bigint AS "amountMinor",total_minor::bigint AS "secondaryAmountMinor",
             subtotal_minor::bigint AS "originalAmountMinor",
             student_id AS "studentId",student_name_snapshot AS "studentName",id AS "invoiceId",
             invoice_number AS "invoiceNumber",NULL::text AS reference,paid_minor::bigint AS "paidMinor",
             outstanding_minor::bigint AS "outstandingMinor",(status='OVERDUE' OR due_date < CURRENT_DATE) AS overdue
           FROM invoice_scope WHERE outstanding_minor>0${statusPredicate} ORDER BY due_date,id`,
          outstandingValues,
        );
        break;
        }
      case "category": {
        const lineValues = [...values];
        let categoryFilter = "";
        if (filters.categoryId !== undefined) {
          lineValues.push(filters.categoryId);
          categoryFilter = ` AND fil.category_id=$${lineValues.length}`;
        }
        grouped = await pool.query(
          `${commonCte} SELECT fil.category_name_snapshot AS label,COUNT(DISTINCT fil.invoice_id)::int AS count,
             COALESCE(SUM(fil.amount_minor),0)::bigint AS "amountMinor",
             COALESCE(SUM(si.outstanding_minor),0)::bigint AS "secondaryAmountMinor"
           FROM fee_invoice_lines fil JOIN invoice_scope si ON si.id=fil.invoice_id AND si.school_id=fil.school_id
           WHERE fil.school_id=$1${categoryFilter}
           GROUP BY fil.category_name_snapshot ORDER BY fil.category_name_snapshot`,
          lineValues,
        );
        break;
      }
      case "class":
        grouped = await pool.query(
          `${commonCte} SELECT class_name_snapshot || COALESCE(' / ' || NULLIF(section_snapshot,''),'') AS label,
             COUNT(*)::int AS count,COALESCE(SUM(total_minor),0)::bigint AS "amountMinor",
             COALESCE(SUM(outstanding_minor),0)::bigint AS "secondaryAmountMinor"
           FROM invoice_scope GROUP BY class_name_snapshot,section_snapshot ORDER BY class_name_snapshot,section_snapshot`,
          values,
        );
        break;
      case "term":
        grouped = await pool.query(
          `${commonCte} SELECT academic_session_id::text || ':' || academic_term_id::text AS label,
             COUNT(*)::int AS count,COALESCE(SUM(total_minor),0)::bigint AS "amountMinor",
             COALESCE(SUM(outstanding_minor),0)::bigint AS "secondaryAmountMinor"
           FROM invoice_scope GROUP BY academic_session_id,academic_term_id ORDER BY academic_session_id,academic_term_id`,
          values,
        );
        break;
      case "adjustment":
        {
        const adjustmentValues = [...values];
        const statusPredicate = filters.status
          ? (adjustmentValues.push(filters.status), ` AND a.status=$${adjustmentValues.length}`)
          : "";
        grouped = await pool.query(
          `${commonCte} SELECT a.kind || ':' || a.status AS label,COUNT(*)::int AS count,
             COALESCE(SUM(CASE WHEN a.status='APPROVED' THEN COALESCE(a.approved_amount_minor,a.amount_minor) ELSE a.amount_minor END),0)::bigint AS "amountMinor",
             COALESCE(SUM(CASE WHEN a.status='PENDING' THEN a.amount_minor ELSE 0 END),0)::bigint AS "secondaryAmountMinor"
           FROM fee_adjustments a JOIN invoice_scope si ON si.id=a.invoice_id AND si.school_id=a.school_id
           WHERE a.school_id=$1${statusPredicate} GROUP BY a.kind,a.status ORDER BY a.kind,a.status`,
          adjustmentValues,
        );
        break;
        }
      case "refund":
        {
        const refundValues = [...values];
        const statusPredicate = filters.status
          ? (refundValues.push(filters.status), ` AND fr.status=$${refundValues.length}`)
          : "";
        grouped = await pool.query(
          `${commonCte} SELECT fr.transaction_type || ':' || fr.status AS label,COUNT(*)::int AS count,
             COALESCE(SUM(CASE WHEN fr.status='APPROVED' THEN fr.amount_minor ELSE 0 END),0)::bigint AS "amountMinor",
             COALESCE(SUM(CASE WHEN fr.status='PENDING' THEN fr.amount_minor ELSE 0 END),0)::bigint AS "secondaryAmountMinor"
           FROM fee_refunds fr JOIN invoice_scope si ON si.id=fr.invoice_id AND si.school_id=fr.school_id
           WHERE fr.school_id=$1${statusPredicate} GROUP BY fr.transaction_type,fr.status ORDER BY fr.transaction_type,fr.status`,
          refundValues,
        );
        break;
        }
      default:
        grouped = await pool.query(
          `${commonCte} SELECT 'TOTAL'::text AS label,COUNT(*)::int AS count,
             COALESCE(SUM(total_minor),0)::bigint AS "amountMinor",
             COALESCE(SUM(outstanding_minor),0)::bigint AS "secondaryAmountMinor"
           FROM invoice_scope`,
          values,
        );
    }
    res.json(GetSchoolFinanceReportResponse.parse({
      schoolId: filters.schoolId,
      reportType,
      ...Object.fromEntries(Object.entries(totals.rows[0]).map(([key, value]) => [key, exactInteger(value)])),
      rows: grouped.rows.map((row: any) => ({
        label: row.label, count: exactInteger(row.count), amountMinor: exactInteger(row.amountMinor),
        secondaryAmountMinor: exactInteger(row.secondaryAmountMinor),
        ...(row.studentId !== undefined ? { studentId: row.studentId } : {}),
        ...(row.studentName !== undefined ? { studentName: row.studentName } : {}),
        ...(row.invoiceId !== undefined ? { invoiceId: row.invoiceId } : {}),
        ...(row.invoiceNumber !== undefined ? { invoiceNumber: row.invoiceNumber } : {}),
        ...(row.reference !== undefined ? { reference: row.reference } : {}),
        ...(row.paymentDate !== undefined ? { paymentDate: row.paymentDate } : {}),
        ...(row.schoolId !== undefined ? { schoolId: row.schoolId } : {}),
        ...(row.sourceType !== undefined ? { sourceType: row.sourceType } : {}),
        ...(row.provider !== undefined ? { provider: row.provider } : {}),
        ...(row.checkoutState !== undefined ? { checkoutState: row.checkoutState } : {}),
        ...(row.reconciliationStatus !== undefined ? { reconciliationStatus: row.reconciliationStatus } : {}),
        ...(row.signatureVerified !== undefined ? { signatureVerified: row.signatureVerified } : {}),
        ...(row.eventId !== undefined ? { eventId: row.eventId } : {}),
        ...(row.webhookTransactionId !== undefined ? { webhookTransactionId: row.webhookTransactionId } : {}),
        ...(row.verifiedTransactionId !== undefined ? { verifiedTransactionId: row.verifiedTransactionId } : {}),
        ...(row.providerReference !== undefined ? { providerReference: row.providerReference } : {}),
        ...(row.eventDate !== undefined ? { eventDate: row.eventDate } : {}),
        ...(row.paymentStatus !== undefined ? { paymentStatus: row.paymentStatus } : {}),
        ...(row.reason !== undefined ? { reason: safeProviderReason(row.reason) } : {}),
        ...(row.originalAmountMinor !== undefined
          ? { originalAmountMinor: row.originalAmountMinor === null ? null : exactInteger(row.originalAmountMinor) }
          : {}),
        ...(row.paidMinor !== undefined ? { paidMinor: row.paidMinor === null ? null : exactInteger(row.paidMinor) } : {}),
        ...(row.outstandingMinor !== undefined ? { outstandingMinor: row.outstandingMinor === null ? null : exactInteger(row.outstandingMinor) } : {}),
        ...(row.overdue !== undefined ? { overdue: row.overdue } : {}),
      })),
    }));
  } catch (error) { fail(res, error); }
});

router.get("/school/finance/provider-reconciliation", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdForMutation(req, ListFeeProviderReconciliationEventsQueryParams, schoolRoles);
    const result = await pool.query(
      `SELECT id,provider,event_id AS "eventId",payment_id AS "paymentId",school_id AS "schoolId",
          provider_reference AS "providerReference",webhook_transaction_id AS "webhookTransactionId",
          verified_transaction_id AS "verifiedTransactionId",status,error_message AS "errorMessage",
          signature_verified AS "signatureVerified",received_at AS "receivedAt",updated_at AS "updatedAt"
       FROM fee_provider_webhook_events
       WHERE school_id=$1 AND status='RECONCILIATION_REQUIRED'
       ORDER BY received_at DESC,id DESC LIMIT 200`,
      [schoolId],
    );
    res.json(ListFeeProviderReconciliationEventsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/provider-reconciliation/:eventId/retry", async (req, res): Promise<void> => {
  try {
    const { eventId } = parsed(RetryFeeProviderReconciliationEventParams, req.params);
    const schoolId = schoolIdForMutation(req, RetryFeeProviderReconciliationEventQueryParams, schoolRoles);
    const outcome = await retryReconciliationEvent(schoolId, eventId);
    res.json(RetryFeeProviderReconciliationEventResponse.parse({ eventId, outcome }));
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      res.status(409).json({ error: "Provider verification did not resolve this reconciliation event" });
      return;
    }
    if (error instanceof Error && error.message === "Provider test credentials are unavailable") {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message === "Reconciliation event cannot be safely retried") {
      res.status(409).json({ error: error.message });
      return;
    }
    fail(res, error);
  }
});

router.post("/school/finance/provider-checkouts/:paymentId/reconcile", async (req, res): Promise<void> => {
  const client = await pool.connect();
  let schoolId = 0;
  let paymentId = 0;
  let claimToken = "";
  let checkout: any;
  try {
    ({ paymentId } = parsed(ReconcileFeeProviderCheckoutParams, req.params));
    schoolId = schoolIdForMutation(req, ReconcileFeeProviderCheckoutQueryParams, schoolRoles);
    claimToken = randomUUID();
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT p.id,p.school_id,p.invoice_id,p.reference,p.amount_minor,p.currency,p.provider,
          p.provider_transaction_id,p.status,i.student_id AS invoice_student_id,i.currency AS invoice_currency,
          i.status AS invoice_status,i.outstanding_minor,cs.state AS session_state,
          cs.claim_token,cs.claim_expires_at
       FROM fee_payments p
       JOIN fee_provider_checkout_sessions cs ON cs.payment_id=p.id AND cs.school_id=p.school_id
       JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       WHERE p.id=$1 AND p.school_id=$2
       FOR UPDATE OF p,cs,i`,
      [paymentId, schoolId],
    );
    checkout = found.rows[0];
    if (!checkout) throw new AuthError(404, "Provider checkout not found");
    if (checkout.session_state === "SETTLED" || checkout.status === "VERIFIED") {
      await audit(req, client, schoolId, "provider checkout reconciliation: already settled",
        "provider checkout", paymentId, { provider: checkout.provider, reference: checkout.reference });
      await client.query("COMMIT");
      res.json(ReconcileFeeProviderCheckoutResponse.parse({ paymentId, outcome: "duplicate" }));
      return;
    }
    if (!["INITIALIZING", "READY", "FAILED", "RELEASED"].includes(checkout.session_state)) {
      throw new AuthError(409, "Provider checkout is not eligible for reconciliation");
    }
    const claimExpiresAt = checkout.claim_expires_at instanceof Date
      ? checkout.claim_expires_at.valueOf()
      : new Date(checkout.claim_expires_at ?? "").valueOf();
    if (checkout.claim_token && Number.isFinite(claimExpiresAt) && claimExpiresAt > Date.now()) {
      throw new AuthError(409, "Provider checkout reconciliation is already processing");
    }
    const claimed = await client.query(
      `UPDATE fee_provider_checkout_sessions SET claim_token=$1,claim_expires_at=NOW()+INTERVAL '30 seconds',
          updated_at=NOW()
       WHERE payment_id=$2 AND school_id=$3 AND state IN ('INITIALIZING','READY','FAILED','RELEASED')
         AND (claim_token IS NULL OR claim_expires_at<=NOW())
       RETURNING payment_id`,
      [claimToken, paymentId, schoolId],
    );
    if (!claimed.rows[0]) throw new AuthError(409, "Provider checkout reconciliation could not be claimed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
    return;
  } finally {
    client.release();
  }

  if (!checkout || !claimToken) {
    res.status(500).json({ error: "Provider checkout reconciliation failed" });
    return;
  }
  let adapter: ReturnType<typeof configuredTestAdapter>;
  try {
    adapter = configuredTestAdapter(checkout.provider);
  } catch {
    await recordCheckoutReconciliationDecision(
      req, schoolId, paymentId, claimToken, "reconciliation_required", "Provider status credentials are unavailable",
    );
    res.status(503).json({ error: "Provider status credentials are unavailable" });
    return;
  }
  if (!adapter) {
    await recordCheckoutReconciliationDecision(
      req, schoolId, paymentId, claimToken, "reconciliation_required", "Provider status credentials are unavailable",
    );
    res.status(503).json({ error: "Provider status credentials are unavailable" });
    return;
  }

  let verified;
  try {
    verified = await adapter.verifyCheckoutStatus({
      reference: checkout.reference,
      amountMinor: Number(checkout.amount_minor),
      currency: checkout.currency,
    });
  } catch {
    await recordCheckoutReconciliationDecision(
      req, schoolId, paymentId, claimToken, "reconciliation_required",
      "Provider status was not independently established; reservation remains active",
    );
    res.status(202).json(ReconcileFeeProviderCheckoutResponse.parse({
      paymentId, outcome: "reconciliation_required",
    }));
    return;
  }

  if (verified.status === "succeeded") {
    try {
      const outcome = await settleVerifiedPayment(
        checkout.provider, `reconcile:${String(checkout.provider).toLowerCase()}:${verified.providerTransactionId}`,
        verified, Buffer.alloc(0), "ADMIN_RECONCILIATION",
      );
      await recordCheckoutReconciliationDecision(
        req, schoolId, paymentId, claimToken, outcome, "Provider independently verified checkout success",
      );
      res.json(ReconcileFeeProviderCheckoutResponse.parse({ paymentId, outcome }));
    } catch {
      await recordCheckoutReconciliationDecision(
        req, schoolId, paymentId, claimToken, "reconciliation_required",
        "Provider success was verified but settlement requires reconciliation",
      );
      res.status(202).json(ReconcileFeeProviderCheckoutResponse.parse({
        paymentId, outcome: "reconciliation_required",
      }));
    }
    return;
  }
  if (verified.status === "failed") {
    const released = await releaseVerifiedFailedCheckout(
      req, schoolId, paymentId, claimToken, checkout, verified,
    );
    if (released) {
      res.json(ReconcileFeeProviderCheckoutResponse.parse({ paymentId, outcome: "released" }));
    } else {
      res.status(202).json(ReconcileFeeProviderCheckoutResponse.parse({
        paymentId, outcome: "reconciliation_required",
      }));
    }
    return;
  }

  await recordCheckoutReconciliationDecision(
    req, schoolId, paymentId, claimToken, "pending", "Provider reports pending; reservation remains active",
  );
  res.status(202).json(ReconcileFeeProviderCheckoutResponse.parse({ paymentId, outcome: "pending" }));
});

async function recordCheckoutReconciliationDecision(
  req: Request,
  schoolId: number,
  paymentId: number,
  claimToken: string,
  outcome: string,
  detail: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE fee_provider_checkout_sessions
       SET claim_token=NULL,claim_expires_at=NULL,last_error=$4,updated_at=NOW()
       WHERE payment_id=$1 AND school_id=$2 AND claim_token=$3`,
      [paymentId, schoolId, claimToken, detail.slice(0, 300)],
    );
    await audit(req, client, schoolId, `provider checkout reconciliation: ${outcome}`, "provider checkout", paymentId, {
      outcome, detail: detail.slice(0, 300),
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function releaseVerifiedFailedCheckout(
  req: Request,
  schoolId: number,
  paymentId: number,
  claimToken: string,
  claimedCheckout: Record<string, any>,
  verified: VerifiedPayment,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT p.reference,p.amount_minor,p.currency,p.provider,p.provider_transaction_id,p.status,
          i.currency AS invoice_currency,cs.state AS session_state,cs.claim_token
       FROM fee_payments p
       JOIN fee_provider_checkout_sessions cs ON cs.payment_id=p.id AND cs.school_id=p.school_id
       JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       WHERE p.id=$1 AND p.school_id=$2
       FOR UPDATE OF p,cs,i`,
      [paymentId, schoolId],
    );
    const current = locked.rows[0];
    if (!current) throw new AuthError(404, "Provider checkout not found");
    const exact = current.claim_token === claimToken
      && ["INITIALIZING", "READY", "FAILED", "RELEASED"].includes(current.session_state)
      && current.provider === claimedCheckout.provider
      && current.reference === verified.reference
      && Number(current.amount_minor) === verified.amountMinor
      && current.currency === verified.currency
      && current.invoice_currency === verified.currency
      && (!current.provider_transaction_id || current.provider_transaction_id === verified.providerTransactionId)
      && current.status !== "VERIFIED";
    if (!exact) {
      await client.query(
        `UPDATE fee_provider_checkout_sessions SET claim_token=NULL,claim_expires_at=NULL,updated_at=NOW()
         WHERE payment_id=$1 AND school_id=$2 AND claim_token=$3`,
        [paymentId, schoolId, claimToken],
      );
      await audit(req, client, schoolId, "provider checkout release withheld", "provider checkout", paymentId, {
        provider: claimedCheckout.provider, reference: claimedCheckout.reference,
        reason: "Checkout state or persisted payment tuple changed during provider verification",
      });
      await client.query("COMMIT");
      return false;
    }
    if (current.session_state === "RELEASED") {
      await client.query(
        `UPDATE fee_provider_checkout_sessions SET claim_token=NULL,claim_expires_at=NULL,updated_at=NOW()
         WHERE payment_id=$1 AND school_id=$2 AND claim_token=$3`,
        [paymentId, schoolId, claimToken],
      );
      await audit(req, client, schoolId, "provider checkout remains released after terminal failure verification",
        "provider checkout", paymentId, {
          provider: claimedCheckout.provider, reference: verified.reference,
          providerTransactionId: verified.providerTransactionId, status: verified.status,
        });
      await client.query("COMMIT");
      return true;
    }
    const owner = await client.query(
      `SELECT id FROM fee_payments
       WHERE provider=$1 AND provider_transaction_id=$2 AND id<>$3`,
      [current.provider, verified.providerTransactionId, paymentId],
    );
    if (owner.rows[0]) {
      await client.query(
        `UPDATE fee_provider_checkout_sessions SET claim_token=NULL,claim_expires_at=NULL,updated_at=NOW()
         WHERE payment_id=$1 AND school_id=$2 AND claim_token=$3`,
        [paymentId, schoolId, claimToken],
      );
      await audit(req, client, schoolId, "provider checkout release withheld", "provider checkout", paymentId, {
        provider: claimedCheckout.provider, reference: claimedCheckout.reference,
        providerTransactionId: verified.providerTransactionId,
        reason: "Provider transaction is already assigned to another payment",
      });
      await client.query("COMMIT");
      return false;
    }
    const paymentUpdate = await client.query(
      `UPDATE fee_payments SET status='FAILED',provider_transaction_id=$1
       WHERE id=$2 AND school_id=$3 AND status IN ('PENDING','PROCESSING','FAILED')
         AND (provider_transaction_id IS NULL OR provider_transaction_id=$1)
       RETURNING id`,
      [verified.providerTransactionId, paymentId, schoolId],
    );
    const sessionUpdate = await client.query(
      `UPDATE fee_provider_checkout_sessions SET state='RELEASED',claim_token=NULL,claim_expires_at=NULL,
          last_error='Provider independently confirmed terminal failure',updated_at=NOW()
       WHERE payment_id=$1 AND school_id=$2 AND state IN ('INITIALIZING','READY','FAILED')
         AND claim_token=$3
       RETURNING payment_id`,
      [paymentId, schoolId, claimToken],
    );
    if (!paymentUpdate.rows[0] || !sessionUpdate.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await enqueueFinancePaymentNotificationsSafely(
      client, paymentId, schoolId, "PROVIDER_PAYMENT_FAILED", { provider: claimedCheckout.provider },
    );
    await audit(req, client, schoolId, "released terminally failed provider checkout", "provider checkout", paymentId, {
      provider: claimedCheckout.provider, reference: verified.reference,
      providerTransactionId: verified.providerTransactionId, status: verified.status,
    });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

router.post("/parent/fees/invoices/:invoiceId/providers/:provider/initialize", async (req, res): Promise<void> => {
  const client = await pool.connect();
  let paymentId: number | null = null;
  let schoolId: number | null = null;
  let provider: "PAYSTACK" | "FLUTTERWAVE" | null = null;
  let invoiceId = 0;
  let reference = "";
  let amountMinor = 0;
  let currency = "";
  let email = "";
  let returnUrl = "";
  let claimToken = "";
  let adapter: ReturnType<typeof configuredTestAdapter> = null;
  try {
    const params = parsed(InitializeFeeProviderPaymentParams, req.params);
    invoiceId = params.invoiceId;
    const requestedProvider = params.provider;
    if (requestedProvider === "REMITA") {
      throw new AuthError(503, "Remita payments are disabled until its official integration contract and sandbox are verified");
    }
    provider = requestedProvider;
    assertRoles(req, ["PARENT"]);
    const headers = parsed(InitializeFeeProviderPaymentHeader, { "Idempotency-Key": req.get("Idempotency-Key") });
    const body = parsed(InitializeFeeProviderPaymentBody, req.body ?? {});
    const idempotencyHeader = headers["Idempotency-Key"];
    const context = getUserContext(req);
    email = context.user.email;
    returnUrl = configuredCheckoutReturnUrl() ?? "";
    if (!returnUrl) throw new AuthError(503, "Online payment return URL is not configured");
    try {
      adapter = configuredTestAdapter(provider);
    } catch (error) {
      if (error instanceof PaymentProviderError) throw new AuthError(503, "Online payment provider test credentials are not configured correctly");
      throw error;
    }
    if (!adapter) throw new AuthError(503, "Online payment provider test credentials are not configured");

    const storedIdempotencyKey = `ONLINE:${provider}:${context.user.id}:${idempotencyHeader}`;
    await client.query("BEGIN");
    const invoiceResult = await client.query(
      `SELECT i.*,p.id AS parent_id FROM fee_invoices i
       JOIN parents p ON p.school_id=i.school_id AND p.user_id=$2 AND p.status='ACTIVE'
       JOIN parent_student_relationships r ON r.parent_id=p.id AND r.student_id=i.student_id AND r.status='ACTIVE'
       WHERE i.id=$1 FOR UPDATE OF i`,
      [invoiceId, context.user.id],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new AuthError(404, "Invoice not found");
    schoolId = invoice.school_id;
    const invoiceSchoolId: number = invoice.school_id;
    const settingsResult = await client.query(
      `SELECT paystack_enabled AS "paystackEnabled",flutterwave_enabled AS "flutterwaveEnabled",
          partial_payments_enabled AS "partialPaymentsEnabled"
       FROM fee_school_settings WHERE school_id=$1`,
      [invoiceSchoolId],
    );
    const enabled = provider === "PAYSTACK"
      ? settingsResult.rows[0]?.paystackEnabled
      : settingsResult.rows[0]?.flutterwaveEnabled;
    if (!enabled) throw new AuthError(409, "This online payment method is not enabled for the school");
    if (invoice.status === "CANCELLED" || invoice.status === "PAID" || Number(invoice.outstanding_minor) <= 0) {
      throw new AuthError(409, "Invoice is not payable");
    }
    const outstandingMinor = Number(invoice.outstanding_minor);
    amountMinor = payableAmount(body.amountMinor ?? outstandingMinor, outstandingMinor);
    const partialPaymentsEnabled = settingsResult.rows[0]?.partialPaymentsEnabled ?? false;
    if (amountMinor < outstandingMinor && !partialPaymentsEnabled) {
      throw new AuthError(400, "Partial payments are disabled by this school's finance settings");
    }
    currency = String(invoice.currency).toUpperCase();
    if (!adapter.validateAmount(amountMinor, currency)) {
      throw new AuthError(409, "Invoice currency or outstanding amount is not supported by this provider");
    }
    claimToken = randomUUID();
    const existing = await client.query(
      `SELECT p.id,p.invoice_id,p.student_id,p.parent_id,p.reference,p.amount_minor,p.currency,p.provider,p.status,
          s.state AS session_state,s.checkout_url AS "checkoutUrl",s.claim_expires_at AS "claimExpiresAt"
       FROM fee_payments p JOIN fee_provider_checkout_sessions s ON s.payment_id=p.id AND s.school_id=p.school_id
       WHERE p.school_id=$1 AND s.idempotency_key=$2 FOR UPDATE OF p,s`,
      [invoiceSchoolId, storedIdempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.invoice_id !== invoiceId || row.student_id !== invoice.student_id || row.parent_id !== invoice.parent_id
          || row.provider !== provider || row.amount_minor !== amountMinor || row.currency !== currency) {
        throw new AuthError(409, "Idempotency key was already used for a different checkout");
      }
      if (row.status !== "PENDING" && row.status !== "PROCESSING" && row.status !== "FAILED") {
        throw new AuthError(409, "This idempotent checkout is no longer recoverable");
      }
      paymentId = row.id;
      reference = row.reference;
      if ((row.status === "PENDING" || row.status === "PROCESSING")
          && row.session_state === "READY" && row.checkoutUrl) {
        await client.query("COMMIT");
        res.status(200).json(InitializeFeeProviderPaymentResponse.parse({
          paymentId, invoiceId, reference, provider, amountMinor, currency, status: "PENDING",
          checkoutUrl: row.checkoutUrl,
        }));
        return;
      }
      if (row.session_state === "INITIALIZING") {
        const leaseUntil = row.claimExpiresAt instanceof Date
          ? row.claimExpiresAt.valueOf()
          : new Date(row.claimExpiresAt ?? "").valueOf();
        await client.query("COMMIT");
        const active = Number.isFinite(leaseUntil) && leaseUntil > Date.now();
        res.status(202).json({
          outcome: active ? "processing" : "reconciliation_required",
          error: active
            ? "Checkout initialization is still processing"
            : "Checkout initialization may have completed; independently reconcile provider status before retrying",
        });
        return;
      }
      if (row.session_state === "FAILED") {
        await client.query("COMMIT");
        res.status(202).json({
          outcome: "reconciliation_required",
          error: "Provider initialization outcome is uncertain; independently reconcile provider status before retrying",
        });
        return;
      }
      if (row.session_state === "RELEASED") {
        throw new AuthError(409, "This checkout reservation was released; use a new idempotency key for another attempt");
      }
      throw new AuthError(409, "This checkout is not recoverable");
    } else {
      const invoiceCheckout = await client.query(
        `SELECT p.id FROM fee_provider_checkout_sessions s
         JOIN fee_payments p ON p.id=s.payment_id AND p.school_id=s.school_id
         WHERE s.school_id=$1 AND s.invoice_id=$2
           AND s.state IN ('INITIALIZING','READY','FAILED')
         FOR UPDATE OF p,s`,
        [invoiceSchoolId, invoiceId],
      );
      if (invoiceCheckout.rows[0]) {
        throw new AuthError(409, "An online checkout already reserves this invoice; retry it with its original idempotency key");
      }
      reference = adapter.generateReference();
      const inserted = await client.query(
        `INSERT INTO fee_payments (school_id,invoice_id,student_id,parent_id,reference,idempotency_key,
           amount_minor,currency,method,provider,status,submitted_by,provider_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'PENDING',$10,'{}'::jsonb) RETURNING id`,
        [schoolId, invoiceId, invoice.student_id, invoice.parent_id, reference, storedIdempotencyKey,
          amountMinor, currency, provider, context.user.id],
      );
      paymentId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO fee_provider_checkout_sessions
           (payment_id,school_id,invoice_id,provider,reference,idempotency_key,state,claim_token,claim_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'INITIALIZING',$7,NOW()+INTERVAL '30 seconds')`,
        [paymentId, schoolId, invoiceId, provider, reference, storedIdempotencyKey, claimToken],
      );
      await audit(req, client, invoiceSchoolId, "initialized provider checkout", "payment", paymentId!, {
        provider, invoiceId, amountMinor, currency,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
    return;
  } finally {
    client.release();
  }

  if (!adapter || !paymentId || !schoolId || !provider) {
    res.status(503).json({ error: "Online payment provider is unavailable" });
    return;
  }
  try {
    const initialized = await adapter.initializePayment({
      reference, amountMinor, currency, email, returnUrl,
    });
    let readyPersisted = false;
    const readyClient = await pool.connect();
    try {
      await readyClient.query("BEGIN");
      const update = await readyClient.query(
        `UPDATE fee_provider_checkout_sessions SET state='READY',checkout_url=$1,
            provider_session_metadata=$2,updated_at=NOW(),last_error=NULL,
            claim_token=NULL,claim_expires_at=NULL
         WHERE payment_id=$3 AND school_id=$4 AND reference=$5
           AND state='INITIALIZING' AND claim_token=$6
         RETURNING payment_id`,
        [initialized.checkoutUrl, { provider, reference }, paymentId, schoolId, reference, claimToken],
      );
      readyPersisted = !!update.rows[0];
      if (update.rows[0]) {
        await enqueueFinancePaymentNotificationsSafely(
          readyClient, paymentId, schoolId, "PROVIDER_CHECKOUT_INITIATED", { provider },
        );
      }
      await readyClient.query("COMMIT");
    } catch (error) {
      await readyClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      readyClient.release();
    }
    const authoritativeResult = await pool.query(
      `SELECT p.status AS "paymentStatus",p.provider_transaction_id AS "providerTransactionId",
          cs.state AS "sessionState",cs.checkout_url AS "checkoutUrl",
          EXISTS (
            SELECT 1 FROM fee_receipts r
            WHERE r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
          ) AS "hasReceipt"
       FROM fee_payments p
       JOIN fee_provider_checkout_sessions cs
         ON cs.payment_id=p.id AND cs.school_id=p.school_id AND cs.invoice_id=p.invoice_id
       WHERE p.id=$1 AND p.school_id=$2 AND p.reference=$3 AND p.provider=$4
         AND cs.reference=$3 AND cs.provider=$4`,
      [paymentId, schoolId, reference, provider],
    );
    const authoritative = authoritativeResult.rows[0];
    if (!authoritative) throw new Error("Authoritative checkout state could not be confirmed");
    if (authoritative.paymentStatus === "VERIFIED" && authoritative.sessionState === "SETTLED"
        && authoritative.providerTransactionId && authoritative.hasReceipt === true) {
      // The existing OpenAPI checkout response has no settled state. Use its
      // documented conflict response rather than redirecting to a chargeable
      // hosted URL after authoritative settlement.
      res.status(409).json({
        error: "Payment was verified and settled while checkout was initializing. Check payment history; do not start another checkout.",
      });
      return;
    }
    if (authoritative.paymentStatus === "PROCESSING") {
      res.status(202).json({
        outcome: "processing",
        error: "Provider payment is processing. Check payment history before attempting another checkout.",
      });
      return;
    }
    if (authoritative.paymentStatus === "FAILED" && authoritative.sessionState === "FAILED") {
      res.status(202).json({
        outcome: "reconciliation_required",
        error: "The provider reported a terminal failure. Check payment history or contact the school before trying again.",
      });
      return;
    }
    if (authoritative.paymentStatus !== "PENDING" || authoritative.sessionState !== "READY"
        || !authoritative.checkoutUrl) {
      throw new Error("Checkout state changed before it could be safely returned");
    }
    const persistedCheckoutUrl = String(authoritative.checkoutUrl);
    res.status(readyPersisted ? 201 : 200).json(InitializeFeeProviderPaymentResponse.parse({
      paymentId, invoiceId, reference, provider, amountMinor, currency,
      status: "PENDING", checkoutUrl: persistedCheckoutUrl,
    }));
  } catch {
    await pool.query(
      `UPDATE fee_provider_checkout_sessions SET state='FAILED',last_error='Provider checkout initialization outcome is uncertain; reconciliation required',
          updated_at=NOW(),claim_token=NULL,claim_expires_at=NULL
       WHERE payment_id=$1 AND school_id=$2 AND state='INITIALIZING' AND claim_token=$3
       RETURNING payment_id`,
      [paymentId, schoolId, claimToken],
    ).catch(() => undefined);
    res.status(503).json({ error: "Online payment provider could not initialize checkout" });
  }
});

export default router;