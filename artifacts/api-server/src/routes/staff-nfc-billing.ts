import { createHash } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import {
  PaymentProviderError,
  type FlutterwaveRefundResult,
  type VerifiedPayment,
} from "../lib/fee-providers";
import {
  configuredCheckoutReturnUrl,
  configuredTestAdapter,
} from "../lib/fee-providers/factory";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  hasRole,
  isPlatformOwner,
  requireAuthentication,
} from "../middlewares/auth";
import {
  calculateStaffNfcAllocations,
  calculateStaffNfcRefundReversals,
  createStaffNfcPaymentReference,
  generateStaffNfcTermSubscriptions,
  getStaffNfcEligibility,
  makeStaffNfcProviderAdapter,
  normalizeVerifiedProviderPayment,
  STAFF_NFC_CURRENCY,
  STAFF_NFC_PRODUCT,
  staffNfcPaymentActivatesSubscription,
  staffNfcWebhookDigest,
  staffNfcWebhookSigningSecret,
  StaffNfcDomainError,
  type StaffNfcAllocationSnapshot,
  type StaffNfcEligibility,
  type StaffNfcSqlExecutor,
  verifyFlutterwaveStaffWebhookSignature,
} from "./staff-nfc-billing-service";

const router: IRouter = Router();
router.use(requireAuthentication());

const safeId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const schoolQuery = z.object({ schoolId: safeId }).passthrough();
const ruleInput = z.object({
  product: z.literal(STAFF_NFC_PRODUCT),
  billingFrequency: z.literal("ACADEMIC_TERM"),
  priceMinor: z.number().int().positive().max(1_000_000_000),
  schoolShareMinor: z.number().int().nonnegative().max(1_000_000_000),
  platformShareMinor: z.number().int().nonnegative().max(1_000_000_000),
  partnerCommissionMinor: z.number().int().nonnegative().max(1_000_000_000),
  noPartnerPlatformShareMinor: z.number().int().nonnegative().max(1_000_000_000),
  currency: z.literal(STAFF_NFC_CURRENCY),
  effectiveAt: z.string().datetime({ offset: true }),
}).strict();
const verificationInput = z.object({
  reference: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  providerTransactionId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const refundInput = z.object({
  reason: z.string().trim().min(5).max(500),
  amountMinor: z.number().int().positive().max(1_000_000_000).nullable().optional(),
}).strict();

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, label = "Request is invalid"): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AuthError(400, label);
  return parsed.data;
}

function positiveId(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new AuthError(400, `${label} must be a positive integer`);
  return result;
}

function idempotencyKey(req: Request) {
  const value = req.header("Idempotency-Key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(value)) {
    throw new AuthError(400, "A valid Idempotency-Key header is required");
  }
  return value;
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
      if (error instanceof StaffNfcDomainError) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          retryable: error.retryable,
        });
      }
      return next(error);
    });
  };
}

function requester(req: Request) {
  return getUserContext(req);
}

function scopedFinanceRead(req: Request, schoolId?: number) {
  const context = requester(req);
  if (isPlatformOwner(context)) return { context, platformOwner: true };
  if (!schoolId) throw new AuthError(400, "A valid schoolId is required");
  assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
  return { context, platformOwner: false };
}

function ownerFinance(req: Request) {
  return assertRoles(req, ["PLATFORM_OWNER"]);
}

function partnerContext(req: Request) {
  const context = requester(req);
  if (!context.roles.some((assignment) =>
    assignment.role === "PARTNER" && assignment.schoolId === null && assignment.status === "ACTIVE")) {
    throw new AuthError(403, "Partner access is required");
  }
  return context;
}

function activeStaffMembership(req: Request, schoolId: number) {
  const context = requester(req);
  if (isPlatformOwner(context)) throw new AuthError(403, "Platform Owner accounts cannot use a school staff account");
  const isStaff = context.roles.some((assignment) =>
    assignment.schoolId === schoolId
      && assignment.status === "ACTIVE"
      && (assignment.role === "TEACHER" || assignment.role === "STAFF"));
  if (!isStaff) throw new AuthError(404, "Staff subscription not found");
  return context;
}

async function findOwnStaffEmployee(
  client: StaffNfcSqlExecutor,
  req: Request,
  schoolId: number,
) {
  const context = activeStaffMembership(req, schoolId);
  const result = await client.query<{
    id: number;
    schoolId: number;
    employeeNo: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    email: string | null;
    schoolName: string;
  }>(
    `SELECT e.id, e.school_id AS "schoolId", e.employee_no AS "employeeNo",
            e.first_name AS "firstName", e.middle_name AS "middleName",
            e.last_name AS "lastName", COALESCE(NULLIF(e.email,''), u.email) AS email,
            sc.name AS "schoolName"
       FROM employees e
       JOIN schools sc ON sc.id=e.school_id
       LEFT JOIN app_users u ON u.id=e.user_id
      WHERE e.user_id=$1 AND e.school_id=$2
        AND UPPER(e.employment_status)='ACTIVE'
        AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
      LIMIT 1`,
    [context.user.id, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Staff subscription not found");
  return { context, employee: result.rows[0] };
}

async function requireReceiptScope(
  client: StaffNfcSqlExecutor,
  req: Request,
  row: { schoolId: number; employeeId: number },
) {
  const context = requester(req);
  if (isPlatformOwner(context)) return;
  if (hasRole(context, "SCHOOL_ADMIN", row.schoolId) || hasRole(context, "ACCOUNTANT", row.schoolId)) {
    assertSchoolAccess(req, row.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    return;
  }
  const owner = await client.query(
    `SELECT id FROM employees
      WHERE id=$1 AND school_id=$2 AND user_id=$3
        AND UPPER(employee_type) IN ('TEACHER','STAFF')`,
    [row.employeeId, row.schoolId, context.user.id],
  );
  if (!owner.rows[0]) throw new AuthError(404, "Staff NFC receipt not found");
}

function actorId(req: Request) {
  return requester(req).user.id;
}

async function auditFinancial(
  client: StaffNfcSqlExecutor,
  req: Request | null,
  input: {
    schoolId: number | null;
    action: string;
    module: string;
    recordId: number;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
) {
  const context = req ? requester(req) : null;
  const actor = context
    ? [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email
    : "Flutterwave webhook";
  const role = context
    ? context.roles.find((assignment) => assignment.schoolId === input.schoolId || assignment.schoolId === null)?.role ?? "AUTHENTICATED"
    : "PAYMENT_PROVIDER";
  await client.query(
    `INSERT INTO audit_logs (
       "user", role, actor_user_id, clerk_user_id, school_id,
       action, module, record_id, severity, event_type, result, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'info',$9,'SUCCESS',$10::jsonb)`,
    [
      actor,
      role,
      context?.user.id ?? null,
      context?.user.clerkUserId ?? null,
      input.schoolId,
      input.action,
      input.module,
      input.recordId,
      input.eventType,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

function developmentMockEnabled() {
  return process.env.NODE_ENV === "development"
    && process.env.STAFF_NFC_PAYMENT_MODE === "DEVELOPMENT_MOCK";
}

function mockProviderTransactionId(reference: string) {
  return String(Number.parseInt(createHash("sha256").update(reference).digest("hex").slice(0, 12), 16));
}

export async function listStaffNfcSubscriptionsForEmployee(
  client: StaffNfcSqlExecutor,
  employeeId: number,
  schoolId: number,
  options: { limit?: number } = {},
) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const result = await client.query<any>(
    `SELECT s.id, s.employee_id AS "employeeId", s.school_id AS "schoolId",
            sc.name AS "schoolName", e.first_name AS "firstName", e.middle_name AS "middleName",
            e.last_name AS "lastName", e.employee_no AS "employeeNo",
            s.partner_profile_id AS "partnerId", pp.full_name AS "partnerName",
            s.academic_session_id AS "sessionId", ses.name AS "sessionName",
            s.academic_term_id AS "termId", t.name AS "termName",
            s.billing_rule_id AS "billingRuleId", s.billing_rule_version AS "billingRuleVersion",
            s.price_minor AS "priceMinor", s.school_share_minor AS "schoolShareMinor",
            s.platform_share_minor AS "platformShareMinor", s.partner_share_minor AS "partnerShareMinor",
            s.status, s.currency, s.due_date AS "dueDate", s.paid_at AS "paidAt",
            s.created_at AS "createdAt",
            latest.id AS "paymentId", latest.provider AS "paymentProvider",
            latest.provider_mode AS "providerMode", latest.status AS "paymentStatus",
            latest.gross_amount_minor AS "grossAmountMinor",
            latest.provider_fee_minor AS "providerFeeMinor",
            latest.settlement_amount_minor AS "settlementAmountMinor",
            latest.currency AS "paymentCurrency", latest.reference AS "providerReference",
            latest.provider_transaction_id AS "providerTransactionId",
            latest.paid_at AS "paymentPaidAt", latest.settlement_status AS "settlementStatus",
            latest.reconciliation_status AS "reconciliationStatus", latest.refund_status AS "refundStatus",
            COALESCE(alloc.items,'[]'::jsonb) AS allocations
       FROM staff_nfc_subscriptions s
       JOIN employees e ON e.id=s.employee_id AND e.school_id=s.school_id
       JOIN schools sc ON sc.id=s.school_id
       JOIN academic_sessions ses ON ses.id=s.academic_session_id AND ses.school_id=s.school_id
       JOIN academic_terms t ON t.id=s.academic_term_id AND t.school_id=s.school_id
       LEFT JOIN partner_profiles pp ON pp.id=s.partner_profile_id
       LEFT JOIN LATERAL (
         SELECT p.*
           FROM staff_nfc_payments p
          WHERE p.subscription_id=s.id
          ORDER BY p.created_at DESC,p.id DESC
          LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'recipientType', a.recipient_type, 'recipientId', a.recipient_id,
           'amountMinor', a.amount_minor, 'currency', a.currency, 'entryType', a.entry_type
         ) ORDER BY a.id) AS items
           FROM staff_nfc_allocations a
          WHERE a.payment_id=latest.id
       ) alloc ON true
      WHERE s.employee_id=$1 AND s.school_id=$2
      ORDER BY ses.start_date DESC,t.start_date DESC,s.id DESC
      LIMIT $3`,
    [employeeId, schoolId, limit],
  );
  return result.rows;
}

function allocationSummary(rows: any[]) {
  return rows.map((row) => ({
    recipientType: row.recipientType,
    recipientId: row.recipientId == null ? null : Number(row.recipientId),
    amountMinor: Number(row.amountMinor),
    currency: row.currency ?? STAFF_NFC_CURRENCY,
    ...(row.entryType ? { entryType: row.entryType } : {}),
  }));
}

function paymentSummary(row: any) {
  if (!row.paymentId) return null;
  return {
    id: Number(row.paymentId),
    provider: row.paymentProvider === "MOCK" ? "MOCK" : "FLUTTERWAVE",
    providerMode: row.providerMode,
    status: row.paymentStatus,
    grossAmountMinor: Number(row.grossAmountMinor),
    providerFeeMinor: row.providerFeeMinor == null ? null : Number(row.providerFeeMinor),
    settlementAmountMinor: row.settlementAmountMinor == null ? null : Number(row.settlementAmountMinor),
    currency: row.paymentCurrency,
    providerTransactionId: row.providerTransactionId ?? null,
    providerReference: row.providerReference,
    paidAt: row.paymentPaidAt ?? null,
    settledAt: null,
    reconciliationStatus: row.reconciliationStatus ?? "PENDING",
    refundStatus: row.refundStatus ?? "NONE",
    allocations: allocationSummary(row.allocations ?? []),
  };
}

function subscriptionProjection(row: any, eligibility?: StaffNfcEligibility) {
  const eligibilityStatus = eligibility?.status;
  return {
    id: Number(row.id),
    employeeId: Number(row.employeeId),
    employeeName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
    employeeNumber: row.employeeNo,
    schoolId: Number(row.schoolId),
    schoolName: row.schoolName,
    partnerId: row.partnerId == null ? null : Number(row.partnerId),
    partnerName: row.partnerName ?? null,
    sessionId: Number(row.sessionId),
    sessionName: row.sessionName,
    termId: Number(row.termId),
    termName: row.termName,
    billingRuleId: Number(row.billingRuleId),
    billingRuleVersion: Number(row.billingRuleVersion),
    priceMinor: Number(row.priceMinor),
    schoolShareMinor: Number(row.schoolShareMinor),
    platformShareMinor: Number(row.platformShareMinor),
    partnerShareMinor: Number(row.partnerShareMinor),
    status: eligibilityStatus === "EXPIRED" && row.status !== "PAID" ? "UNPAID" : row.status,
    currency: row.currency,
    dueDate: row.dueDate,
    paidAt: row.paidAt ?? null,
    nextTerm: null,
    cardStatus: "NONE",
    isEligibleForNfc: eligibility?.eligible ?? row.status === "PAID",
    latestPayment: paymentSummary(row),
    createdAt: row.createdAt,
  };
}

router.get("/staff-nfc/subscriptions/me", wrap(async (req, res) => {
  const query = parse(schoolQuery, req.query);
  const { employee } = await findOwnStaffEmployee(pool, req, query.schoolId);
  const [rows, current] = await Promise.all([
    listStaffNfcSubscriptionsForEmployee(pool, Number(employee.id), query.schoolId),
    pool.query<any>(
      `SELECT t.id AS "termId",t.name AS "termName",t.academic_session_id AS "sessionId",
              s.name AS "sessionName",t.end_date AS "dueDate",s.id AS "validSession"
         FROM academic_terms t
         JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
        WHERE t.school_id=$1 AND t.is_current=true AND UPPER(t.status)='ACTIVE'
          AND s.is_current=true AND UPPER(s.status)='ACTIVE'
          AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
        ORDER BY t.start_date DESC,t.id DESC LIMIT 1`,
      [query.schoolId],
    ),
  ]);
  const projected = await Promise.all(rows.map(async (row) => {
    const eligibility = await getStaffNfcEligibility(pool, Number(employee.id), query.schoolId, Number(row.termId));
    return subscriptionProjection(row, eligibility);
  }));
  const currentTermRow = current.rows[0] ?? null;
  const currentSubscription = currentTermRow
    ? projected.find((row) => row.termId === Number(currentTermRow.termId)) ?? null
    : null;
  const currentSession = currentTermRow
    ? {
        schoolId: query.schoolId,
        schoolName: employee.schoolName,
        academicSessionId: Number(currentTermRow.sessionId),
        academicSessionName: currentTermRow.sessionName,
        academicTermId: Number(currentTermRow.termId),
        academicTermName: currentTermRow.termName,
        dueDate: currentTermRow.dueDate,
      }
    : null;
  const card = await pool.query<{ status: string }>(
    `SELECT b.status
       FROM employee_nfc_card_bindings b
      WHERE b.employee_id=$1 AND b.school_id=$2
        AND b.status IN ('ACTIVE','LOCKED','ASSIGNED')
      ORDER BY CASE b.status WHEN 'ACTIVE' THEN 1 WHEN 'LOCKED' THEN 2 ELSE 3 END,b.id DESC
      LIMIT 1`,
    [employee.id, query.schoolId],
  );
  const physicalCard = String(card.rows[0]?.status ?? "NONE").toUpperCase();
  const cardStatus = physicalCard === "ACTIVE" || physicalCard === "LOCKED" ? physicalCard : "NONE";
  res.json({
    employee: {
      id: Number(employee.id),
      name: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" "),
      employeeNumber: employee.employeeNo,
      schoolId: query.schoolId,
      schoolName: employee.schoolName,
    },
    currentSession,
    currentTerm: currentSession,
    currentSubscription,
    nextSubscription: null,
    cardStatus,
    subscriptions: projected,
  });
}));

router.post("/staff-nfc/subscriptions/generate", wrap(async (req, res) => {
  const query = parse(z.object({
    schoolId: safeId,
    academicSessionId: safeId,
    academicTermId: safeId,
  }), req.query);
  assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
  const client = await pool.connect();
  let generation: Awaited<ReturnType<typeof generateStaffNfcTermSubscriptions>>;
  try {
    await client.query("BEGIN");
    generation = await generateStaffNfcTermSubscriptions(
      client,
      query.schoolId,
      query.academicSessionId,
      query.academicTermId,
      actorId(req),
    );
    await auditFinancial(client, req, {
      schoolId: query.schoolId,
      action: "Generated staff NFC term subscriptions",
      module: "Staff NFC Billing",
      recordId: query.academicTermId,
      eventType: "STAFF_NFC_TERM_SUBSCRIPTIONS_GENERATED",
      metadata: { generatedCount: generation.generatedCount, unchangedCount: generation.unchangedCount },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const current = await pool.query<{ termName: string }>(
    `SELECT name AS "termName" FROM academic_terms WHERE id=$1 AND school_id=$2`,
    [query.academicTermId, query.schoolId],
  );
  const termName = current.rows[0]?.termName ?? "";
  const rows = await pool.query<any>(
    `SELECT s.id,s.employee_id AS "employeeId",s.school_id AS "schoolId",sc.name AS "schoolName",
            e.first_name AS "firstName",e.middle_name AS "middleName",e.last_name AS "lastName",
            e.employee_no AS "employeeNo",s.partner_profile_id AS "partnerId",p.full_name AS "partnerName",
            s.academic_session_id AS "sessionId",ses.name AS "sessionName",
            s.academic_term_id AS "termId",t.name AS "termName",
            s.billing_rule_id AS "billingRuleId",s.billing_rule_version AS "billingRuleVersion",
            s.price_minor AS "priceMinor",s.school_share_minor AS "schoolShareMinor",
            s.platform_share_minor AS "platformShareMinor",s.partner_share_minor AS "partnerShareMinor",
            s.status,s.currency,s.due_date AS "dueDate",s.paid_at AS "paidAt",s.created_at AS "createdAt"
       FROM staff_nfc_subscriptions s
       JOIN employees e ON e.id=s.employee_id AND e.school_id=s.school_id
       JOIN schools sc ON sc.id=s.school_id
       JOIN academic_sessions ses ON ses.id=s.academic_session_id AND ses.school_id=s.school_id
       JOIN academic_terms t ON t.id=s.academic_term_id AND t.school_id=s.school_id
       LEFT JOIN partner_profiles p ON p.id=s.partner_profile_id
      WHERE s.school_id=$1 AND s.academic_session_id=$2 AND s.academic_term_id=$3
      ORDER BY e.employee_no,s.id`,
    [query.schoolId, query.academicSessionId, query.academicTermId],
  );
  const subscriptions = await Promise.all(rows.rows.map(async (row) => {
    const eligibility = await getStaffNfcEligibility(pool, Number(row.employeeId), query.schoolId, query.academicTermId);
    return subscriptionProjection(row, eligibility);
  }));
  res.json({
    schoolId: query.schoolId,
    sessionId: query.academicSessionId,
    termId: query.academicTermId,
    termName,
    generatedCount: generation.generatedCount,
    unchangedCount: generation.unchangedCount,
    subscriptions,
  });
}));

router.post("/finance/staff-nfc/billing-rules", wrap(async (req, res) => {
  ownerFinance(req);
  const rule = parse(ruleInput, req.body, "Billing rule is invalid");
  if (rule.schoolShareMinor + rule.platformShareMinor + rule.partnerCommissionMinor !== rule.priceMinor
      || rule.schoolShareMinor + rule.noPartnerPlatformShareMinor !== rule.priceMinor) {
    throw new AuthError(400, "School, platform, and eligible Partner allocations must exactly balance each branch");
  }
  const effectiveAt = new Date(rule.effectiveAt);
  if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt.getTime() <= Date.now()) {
    throw new AuthError(400, "A new billing rule must have a valid future effectiveAt");
  }
  const client = await pool.connect();
  let created: any;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(310031,1)");
    const latest = await client.query<{ version: number; effectiveAt: string }>(
      `SELECT COALESCE(MAX(version),0)::int AS version,MAX(effective_at) AS "effectiveAt"
         FROM staff_nfc_billing_rules WHERE product=$1`,
      [STAFF_NFC_PRODUCT],
    );
    if (latest.rows[0]?.effectiveAt && effectiveAt <= new Date(latest.rows[0].effectiveAt)) {
      throw new AuthError(409, "Billing rule effective dates must follow all existing versions");
    }
    const inserted = await client.query<any>(
      `INSERT INTO staff_nfc_billing_rules (
         version,product,billing_frequency,price_minor,school_share_minor,platform_share_minor,
         partner_commission_minor,no_partner_platform_share_minor,currency,effective_at,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,version,product,billing_frequency AS "billingFrequency",price_minor AS "priceMinor",
         school_share_minor AS "schoolShareMinor",platform_share_minor AS "platformShareMinor",
         partner_commission_minor AS "partnerCommissionMinor",
         no_partner_platform_share_minor AS "noPartnerPlatformShareMinor",currency,status,
         effective_at AS "effectiveAt",created_at AS "createdAt"`,
      [
        Number(latest.rows[0]?.version ?? 0) + 1,
        rule.product,
        rule.billingFrequency,
        rule.priceMinor,
        rule.schoolShareMinor,
        rule.platformShareMinor,
        rule.partnerCommissionMinor,
        rule.noPartnerPlatformShareMinor,
        rule.currency,
        effectiveAt,
        actorId(req),
      ],
    );
    created = inserted.rows[0];
    await auditFinancial(client, req, {
      schoolId: null,
      action: "Created staff NFC billing rule version",
      module: "Staff NFC Billing",
      recordId: created.id,
      eventType: "STAFF_NFC_BILLING_RULE_CREATED",
      metadata: { version: created.version, effectiveAt: created.effectiveAt },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json(created);
}));

router.get("/finance/staff-nfc/billing-rules", wrap(async (req, res) => {
  ownerFinance(req);
  const rules = await pool.query(
    `SELECT id,version,product,billing_frequency AS "billingFrequency",
            price_minor AS "priceMinor",school_share_minor AS "schoolShareMinor",
            platform_share_minor AS "platformShareMinor",partner_commission_minor AS "partnerCommissionMinor",
            no_partner_platform_share_minor AS "noPartnerPlatformShareMinor",currency,status,
            effective_at AS "effectiveAt",created_at AS "createdAt"
       FROM staff_nfc_billing_rules WHERE product=$1 ORDER BY version DESC`,
    [STAFF_NFC_PRODUCT],
  );
  res.json(rules.rows);
}));

export { router as staffNfcBillingRouter };

function transactionToPaymentSummary(row: any, allocations: any[]) {
  return {
    id: Number(row.id),
    provider: row.provider === "MOCK" ? "MOCK" : "FLUTTERWAVE",
    providerMode: row.providerMode,
    status: row.status,
    grossAmountMinor: Number(row.grossAmountMinor),
    providerFeeMinor: row.providerFeeMinor == null ? null : Number(row.providerFeeMinor),
    settlementAmountMinor: row.settlementAmountMinor == null ? null : Number(row.settlementAmountMinor),
    currency: row.currency,
    providerTransactionId: row.providerTransactionId ?? null,
    providerReference: row.reference,
    paidAt: row.paidAt ?? null,
    settledAt: null,
    reconciliationStatus: row.reconciliationStatus,
    refundStatus: row.refundStatus,
    allocations: allocationSummary(allocations),
  };
}

export async function completeVerifiedPayment(
  paymentId: number,
  verified: VerifiedPayment,
  req: Request | null,
  database: typeof pool = pool,
) {
  const client = await database.connect();
  let settledSubscriptionId = 0;
  let activated = false;
  try {
    await client.query("BEGIN");
    const locked = await client.query<any>(
      `SELECT p.id,p.subscription_id AS "subscriptionId",p.employee_id AS "employeeId",
              p.school_id AS "schoolId",p.academic_session_id AS "sessionId",
              p.academic_term_id AS "termId",p.provider,p.provider_mode AS "providerMode",
              p.reference,p.gross_amount_minor AS "grossAmountMinor",
              p.provider_transaction_id AS "providerTransactionId",p.status,p.refunded_amount_minor AS "refundedAmountMinor",
              s.billing_rule_id AS "billingRuleId",s.billing_rule_version AS "billingRuleVersion",
              s.price_minor AS "priceMinor",s.school_share_minor AS "schoolShareMinor",
              s.platform_share_minor AS "platformShareMinor",s.partner_share_minor AS "partnerShareMinor",
              s.partner_profile_id AS "partnerProfileId",s.attribution_id AS "attributionId",
              r.price_minor AS "rulePriceMinor",r.school_share_minor AS "ruleSchoolShareMinor",
              r.platform_share_minor AS "rulePlatformShareMinor",
              r.partner_commission_minor AS "rulePartnerCommissionMinor",
              r.no_partner_platform_share_minor AS "ruleNoPartnerPlatformShareMinor",
              s.currency,s.status AS "subscriptionStatus"
         FROM staff_nfc_payments p
         JOIN staff_nfc_subscriptions s ON s.id=p.subscription_id AND s.school_id=p.school_id
          JOIN staff_nfc_billing_rules r
            ON r.id=s.billing_rule_id AND r.version=s.billing_rule_version
        WHERE p.id=$1
        FOR UPDATE OF p,s`,
      [paymentId],
    );
    const payment = locked.rows[0];
    if (!payment) throw new StaffNfcDomainError(404, "Staff NFC payment not found");
    settledSubscriptionId = Number(payment.subscriptionId);
    const expected = {
      reference: payment.reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: payment.currency,
    };
    const result = normalizeVerifiedProviderPayment(expected, verified);
    if (result.providerFeeMinor !== null && result.providerFeeMinor > expected.amountMinor) {
      throw new StaffNfcDomainError(409, "Verified provider fee exceeds the gross payment", "PAYMENT_MISMATCH");
    }
    if (result.providerSettlementAmountMinor !== null
        && result.providerSettlementAmountMinor > expected.amountMinor) {
      throw new StaffNfcDomainError(409, "Verified settlement snapshot exceeds the gross payment", "PAYMENT_MISMATCH");
    }
    if (payment.providerTransactionId && payment.providerTransactionId !== result.providerTransactionId) {
      throw new StaffNfcDomainError(409, "Payment already references a different verified provider transaction", "TRANSACTION_CONFLICT");
    }
    const duplicate = await client.query(
      `SELECT id FROM staff_nfc_payments
        WHERE provider=$1 AND provider_transaction_id=$2 AND id<>$3
        LIMIT 1`,
      [payment.provider, result.providerTransactionId, paymentId],
    );
    if (duplicate.rows[0]) {
      throw new StaffNfcDomainError(409, "Provider transaction is already linked to another payment", "TRANSACTION_CONFLICT");
    }
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(String(payment.status))) {
      if (payment.providerTransactionId === result.providerTransactionId) {
        await client.query("COMMIT");
        return { paymentId, subscriptionId: settledSubscriptionId, activated: false };
      }
      throw new StaffNfcDomainError(409, "Refunded payment cannot be verified again", "PAYMENT_TERMINAL");
    }
    if (payment.status === "PAID") {
      if (payment.providerTransactionId !== result.providerTransactionId) {
        throw new StaffNfcDomainError(409, "Payment was already verified with a different transaction", "TRANSACTION_CONFLICT");
      }
      await client.query("COMMIT");
      return { paymentId, subscriptionId: settledSubscriptionId, activated: true };
    }
    if (payment.status === "FAILED" || payment.status === "CANCELLED") {
      if (payment.providerTransactionId && payment.providerTransactionId !== result.providerTransactionId) {
        throw new StaffNfcDomainError(409, "A failed attempt cannot be replaced by a different provider transaction", "TRANSACTION_CONFLICT");
      }
      if (result.status === "PAID") {
        throw new StaffNfcDomainError(409, "Provider result conflicts with the recorded terminal payment state", "PAYMENT_STATE_CONFLICT");
      }
    }

    await client.query(
      `UPDATE staff_nfc_payments
          SET provider_transaction_id=$1,provider_paid_at=$2,
              provider_fee_minor=COALESCE($3,provider_fee_minor),
              settlement_amount_minor=COALESCE($4,settlement_amount_minor),
              status=$5,
              reconciliation_status=CASE WHEN $5 IN ('PAID','FAILED') THEN 'RECONCILED' ELSE 'PENDING' END,
              failure_code=CASE WHEN $5='FAILED' THEN 'PROVIDER_VERIFIED_FAILED' ELSE NULL END,
              paid_at=CASE WHEN $5='PAID' THEN COALESCE(paid_at,$2,NOW()) ELSE paid_at END,
              updated_at=NOW()
        WHERE id=$6`,
      [
        result.providerTransactionId,
        result.providerPaidAt,
        result.providerFeeMinor,
        result.providerSettlementAmountMinor,
        result.status,
        paymentId,
      ],
    );
    if (result.status === "PAID") {
      await client.query(
        `UPDATE staff_nfc_subscriptions
            SET status='PAID',paid_at=COALESCE(paid_at,$2),updated_at=NOW()
          WHERE id=$1 AND status<>'REFUNDED'`,
        [settledSubscriptionId, result.providerPaidAt],
      );
      const frozenRule = {
        priceMinor: Number(payment.rulePriceMinor),
        schoolShareMinor: Number(payment.ruleSchoolShareMinor),
        platformShareMinor: Number(payment.rulePlatformShareMinor),
        partnerCommissionMinor: Number(payment.rulePartnerCommissionMinor),
        noPartnerPlatformShareMinor: Number(payment.ruleNoPartnerPlatformShareMinor),
      };
      const subscriptionPartnerId = payment.partnerProfileId == null ? null : Number(payment.partnerProfileId);
      const snapshotsMatchRule = Number(payment.priceMinor) === frozenRule.priceMinor
        && Number(payment.schoolShareMinor) === frozenRule.schoolShareMinor
        && Number(payment.partnerShareMinor) === (subscriptionPartnerId === null ? 0 : frozenRule.partnerCommissionMinor)
        && Number(payment.platformShareMinor) === (
          subscriptionPartnerId === null ? frozenRule.noPartnerPlatformShareMinor : frozenRule.platformShareMinor
        );
      if (!snapshotsMatchRule) {
        throw new StaffNfcDomainError(409, "Frozen staff subscription allocation does not match its billing-rule snapshot");
      }
      const financialAllocations = calculateStaffNfcAllocations(
        frozenRule,
        subscriptionPartnerId,
      );
      const insertedAllocations: Array<{ recipientType: string; recipientId: number | null; amountMinor: number; id: number }> = [];
      for (const allocation of financialAllocations) {
        if (allocation.amountMinor <= 0) continue;
        const resultRow = await client.query<{ id: number }>(
          `INSERT INTO staff_nfc_allocations (
             idempotency_key,entry_type,product,recipient_type,recipient_id,
             school_id,employee_id,academic_session_id,academic_term_id,
             subscription_id,payment_id,attribution_id,allocation_rule_id,
             billing_rule_version,amount_minor,currency
           ) VALUES ($1,'CREDIT',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            `staff-nfc:payment:${paymentId}:credit:${allocation.recipientType}`,
            STAFF_NFC_PRODUCT,
            allocation.recipientType,
            allocation.recipientId,
            payment.schoolId,
            payment.employeeId,
            payment.sessionId,
            payment.termId,
            payment.subscriptionId,
            paymentId,
            payment.attributionId,
            payment.billingRuleId,
            payment.billingRuleVersion,
            allocation.amountMinor,
            STAFF_NFC_CURRENCY,
          ],
        );
        let allocationId = resultRow.rows[0]?.id;
        if (!allocationId) {
          const existing = await client.query<{ id: number }>(
            `SELECT id FROM staff_nfc_allocations WHERE idempotency_key=$1`,
            [`staff-nfc:payment:${paymentId}:credit:${allocation.recipientType}`],
          );
          allocationId = existing.rows[0]?.id;
        }
        if (allocationId) insertedAllocations.push({ ...allocation, id: Number(allocationId) });
        if (allocation.recipientType === "PARTNER" && allocation.amountMinor > 0 && allocationId) {
          await client.query(
            `INSERT INTO staff_nfc_partner_commissions (
               allocation_id,partner_profile_id,school_id,employee_id,academic_session_id,
               academic_term_id,subscription_id,payment_id,recipient_type,commission_minor,currency,status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PARTNER',$9,'NGN','PENDING')
             ON CONFLICT (subscription_id) DO NOTHING`,
            [
              allocationId,
              payment.partnerProfileId,
              payment.schoolId,
              payment.employeeId,
              payment.sessionId,
              payment.termId,
              payment.subscriptionId,
              paymentId,
              allocation.amountMinor,
            ],
          );
        }
      }
      if (result.providerFeeMinor !== null && result.providerFeeMinor > 0) {
        await client.query(
          `INSERT INTO staff_nfc_allocations (
             idempotency_key,entry_type,product,recipient_type,recipient_id,
             school_id,employee_id,academic_session_id,academic_term_id,
             subscription_id,payment_id,attribution_id,allocation_rule_id,
             billing_rule_version,amount_minor,currency
           ) VALUES ($1,'EXPENSE',$2,'PLATFORM_PROVIDER_FEE',NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NGN')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            `staff-nfc:payment:${paymentId}:provider-fee`,
            STAFF_NFC_PRODUCT,
            payment.schoolId,
            payment.employeeId,
            payment.sessionId,
            payment.termId,
            payment.subscriptionId,
            paymentId,
            payment.attributionId,
            payment.billingRuleId,
            payment.billingRuleVersion,
            result.providerFeeMinor,
          ],
        );
      }
      const receiptSnapshotResult = await client.query<any>(
        `SELECT e.employee_no AS "employeeNo",
                trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
                sc.name AS "schoolName",ses.name AS "sessionName",t.name AS "termName",
                p.reference,p.gross_amount_minor AS "grossAmountMinor",p.currency,p.paid_at AS "paidAt",
                p.provider,p.provider_mode AS "providerMode",p.provider_fee_minor AS "providerFeeMinor",
                p.settlement_amount_minor AS "settlementAmountMinor"
           FROM staff_nfc_payments p
           JOIN employees e ON e.id=p.employee_id AND e.school_id=p.school_id
           JOIN schools sc ON sc.id=p.school_id
           JOIN academic_sessions ses ON ses.id=p.academic_session_id AND ses.school_id=p.school_id
           JOIN academic_terms t ON t.id=p.academic_term_id AND t.school_id=p.school_id
          WHERE p.id=$1`,
        [paymentId],
      );
      const receiptSnapshot = receiptSnapshotResult.rows[0];
      const receiptAllocations = await client.query<any>(
        `SELECT recipient_type AS "recipientType",recipient_id AS "recipientId",amount_minor AS "amountMinor",currency
           FROM staff_nfc_allocations
          WHERE payment_id=$1 ORDER BY id`,
        [paymentId],
      );
      const logoVersion = await client.query<{ id: number }>(
        `SELECT id FROM school_branding_logos
          WHERE school_id=$1 AND is_current=true
          ORDER BY id DESC LIMIT 1`,
        [payment.schoolId],
      );
      const receiptNumber = `SNFC-${payment.reference}`;
      const snapshot = {
        ...receiptSnapshot,
        paymentId,
        subscriptionId: settledSubscriptionId,
        schoolId: Number(payment.schoolId),
        allocations: receiptAllocations.rows.map((allocation) => ({
          recipientType: allocation.recipientType,
          recipientId: allocation.recipientId == null ? null : Number(allocation.recipientId),
          amountMinor: Number(allocation.amountMinor),
          currency: allocation.currency,
        })),
        schoolLogoVersionUrl: logoVersion.rows[0]
          ? canonicalSchoolLogoVersionUrl(Number(payment.schoolId), Number(logoVersion.rows[0].id))
          : null,
      };
      await client.query(
        `INSERT INTO staff_nfc_receipts (payment_id,subscription_id,school_id,receipt_number,snapshot)
         VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (payment_id) DO NOTHING`,
        [paymentId, settledSubscriptionId, payment.schoolId, receiptNumber, JSON.stringify(snapshot)],
      );
      await auditFinancial(client, req, {
        schoolId: Number(payment.schoolId),
        action: "Verified staff NFC payment",
        module: "Staff NFC Billing",
        recordId: paymentId,
        eventType: "STAFF_NFC_PAYMENT_VERIFIED",
        metadata: {
          provider: payment.provider,
          providerTransactionId: result.providerTransactionId,
          grossAmountMinor: expected.amountMinor,
          providerFeeMinor: result.providerFeeMinor,
          providerSettlementAmountMinor: result.providerSettlementAmountMinor,
        },
      });
      activated = true;
    } else if (result.status === "FAILED") {
      await client.query(
        `UPDATE staff_nfc_subscriptions SET status='FAILED',updated_at=NOW()
          WHERE id=$1 AND status<>'PAID'`,
        [settledSubscriptionId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { paymentId, subscriptionId: settledSubscriptionId, activated };
}

async function currentPaymentResponse(paymentId: number, subscriptionId: number, activated: boolean) {
  const result = await pool.query<any>(
    `SELECT p.id,p.provider,p.provider_mode AS "providerMode",p.status,
            p.gross_amount_minor AS "grossAmountMinor",p.provider_fee_minor AS "providerFeeMinor",
            p.settlement_amount_minor AS "settlementAmountMinor",p.currency,p.provider_transaction_id AS "providerTransactionId",
            p.reference,p.paid_at AS "paidAt",p.settlement_status AS "settlementStatus",
            p.reconciliation_status AS "reconciliationStatus",p.refund_status AS "refundStatus",
            p.employee_id AS "employeeId",p.school_id AS "schoolId",
            s.academic_session_id AS "sessionId",s.academic_term_id AS "termId",
            s.billing_rule_id AS "billingRuleId",s.billing_rule_version AS "billingRuleVersion",
            s.price_minor AS "priceMinor",s.school_share_minor AS "schoolShareMinor",
            s.platform_share_minor AS "platformShareMinor",s.partner_share_minor AS "partnerShareMinor",
            s.partner_profile_id AS "partnerId",s.status AS "subscriptionStatus",s.due_date AS "dueDate",
            e.employee_no AS "employeeNo",e.first_name AS "firstName",e.middle_name AS "middleName",e.last_name AS "lastName",
            sc.name AS "schoolName",ses.name AS "sessionName",t.name AS "termName",
            pp.full_name AS "partnerName",s.currency AS "subscriptionCurrency",s.created_at AS "subscriptionCreatedAt"
       FROM staff_nfc_payments p
       JOIN staff_nfc_subscriptions s ON s.id=p.subscription_id AND s.school_id=p.school_id
       JOIN employees e ON e.id=s.employee_id AND e.school_id=s.school_id
       JOIN schools sc ON sc.id=s.school_id
       JOIN academic_sessions ses ON ses.id=s.academic_session_id AND ses.school_id=s.school_id
       JOIN academic_terms t ON t.id=s.academic_term_id AND t.school_id=s.school_id
       LEFT JOIN partner_profiles pp ON pp.id=s.partner_profile_id
      WHERE p.id=$1 AND s.id=$2`,
    [paymentId, subscriptionId],
  );
  if (!result.rows[0]) throw new StaffNfcDomainError(404, "Staff NFC payment not found");
  const row = result.rows[0];
  const allocationRows = await pool.query<any>(
    `SELECT recipient_type AS "recipientType",recipient_id AS "recipientId",amount_minor AS "amountMinor",
            currency,entry_type AS "entryType"
       FROM staff_nfc_allocations WHERE payment_id=$1 ORDER BY id`,
    [paymentId],
  );
  const payment = transactionToPaymentSummary(row, allocationRows.rows);
  const subscription = {
    id: Number(subscriptionId),
    employeeId: Number(row.employeeId),
    employeeName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
    employeeNumber: row.employeeNo,
    schoolId: Number(row.schoolId),
    schoolName: row.schoolName,
    partnerId: row.partnerId == null ? null : Number(row.partnerId),
    partnerName: row.partnerName ?? null,
    sessionId: Number(row.sessionId),
    sessionName: row.sessionName,
    termId: Number(row.termId),
    termName: row.termName,
    billingRuleId: Number(row.billingRuleId),
    billingRuleVersion: Number(row.billingRuleVersion),
    priceMinor: Number(row.priceMinor),
    schoolShareMinor: Number(row.schoolShareMinor),
    platformShareMinor: Number(row.platformShareMinor),
    partnerShareMinor: Number(row.partnerShareMinor),
    status: row.subscriptionStatus,
    currency: row.subscriptionCurrency,
    dueDate: row.dueDate,
    paidAt: row.paidAt ?? null,
    nextTerm: null,
    cardStatus: "NONE",
    isEligibleForNfc: false,
    latestPayment: payment,
    createdAt: row.subscriptionCreatedAt,
  };
  const eligibility = await getStaffNfcEligibility(pool, Number(row.employeeId), Number(row.schoolId), Number(row.termId));
  return {
    payment,
    subscription: { ...subscription, isEligibleForNfc: eligibility.eligible },
    allocations: allocationSummary(allocationRows.rows),
    activated,
  };
}

router.post("/staff-nfc/subscriptions/:subscriptionId/checkout", wrap(async (req, res) => {
  const subscriptionId = positiveId(req.params.subscriptionId, "subscriptionId");
  const query = parse(schoolQuery, req.query);
  const key = idempotencyKey(req);
  const { context } = await findOwnStaffEmployee(pool, req, query.schoolId);
  const mock = developmentMockEnabled();
  let adapter: ReturnType<typeof configuredTestAdapter> | null = null;
  if (!mock) {
    try {
      adapter = configuredTestAdapter("FLUTTERWAVE");
    } catch {
      adapter = null;
    }
  }
  const returnUrl = configuredCheckoutReturnUrl();
  if (!mock && (!adapter || !returnUrl)) {
    throw new AuthError(503, "Flutterwave test checkout is unavailable", "STAFF_NFC_PROVIDER_UNAVAILABLE");
  }
  const client = await pool.connect();
  let reservation: any;
  try {
    await client.query("BEGIN");
    const subscriptionResult = await client.query<any>(
      `SELECT s.id,s.employee_id AS "employeeId",s.school_id AS "schoolId",
              s.academic_session_id AS "sessionId",s.academic_term_id AS "termId",
              s.price_minor AS "priceMinor",s.currency,s.status,s.due_date AS "dueDate",
              e.email,COALESCE(NULLIF(e.email,''),u.email) AS "customerEmail",
              trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "customerName"
         FROM staff_nfc_subscriptions s
         JOIN employees e ON e.id=s.employee_id AND e.school_id=s.school_id
         LEFT JOIN app_users u ON u.id=e.user_id
        WHERE s.id=$1 AND s.school_id=$2 AND e.user_id=$3
        FOR UPDATE OF s`,
      [subscriptionId, query.schoolId, context.user.id],
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) throw new AuthError(404, "Staff NFC subscription not found");
    if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(String(subscription.status))) {
      throw new AuthError(409, "This staff NFC term subscription is not payable");
    }
    const term = await client.query(
      `SELECT t.id FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
        WHERE t.id=$1 AND t.school_id=$2 AND t.is_current=true AND t.status='ACTIVE'
          AND s.is_current=true AND s.status='ACTIVE'
          AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE`,
      [subscription.termId, query.schoolId],
    );
    if (!term.rows[0]) throw new AuthError(409, "The staff NFC academic term is not currently payable");
    const existing = await client.query<any>(
      `SELECT id,subscription_id AS "subscriptionId",reference,provider,provider_mode AS "providerMode",status,
              gross_amount_minor AS "grossAmountMinor",currency,checkout_url AS "checkoutUrl"
         FROM staff_nfc_payments
        WHERE employee_id=$1 AND idempotency_key=$2
        FOR UPDATE`,
      [subscription.employeeId, key],
    );
    if (existing.rows[0]) {
      const saved = existing.rows[0];
      if (Number(saved.id) < 1
          || Number(saved.subscriptionId) !== subscriptionId
          || Number(saved.grossAmountMinor) !== Number(subscription.priceMinor)) {
        throw new AuthError(409, "Idempotency key is already bound to a different request");
      }
      if (saved.status === "RECONCILIATION_REQUIRED") {
        throw new AuthError(409, "Previous checkout outcome needs server reconciliation before another checkout");
      }
      if (saved.status !== "PENDING" || (!saved.checkoutUrl && saved.provider !== "MOCK")) {
        throw new AuthError(409, "A checkout attempt already exists for this idempotency key");
      }
      reservation = saved;
    } else {
      const pending = await client.query(
        `SELECT id FROM staff_nfc_payments
          WHERE subscription_id=$1 AND status IN ('PENDING','RECONCILIATION_REQUIRED')
          FOR UPDATE`,
        [subscriptionId],
      );
      if (pending.rows[0]) {
        throw new AuthError(409, "An existing provider checkout is still pending or needs reconciliation");
      }
      if (!mock && (typeof subscription.customerEmail !== "string" || !subscription.customerEmail.includes("@"))) {
        throw new AuthError(400, "A valid staff email address is required for provider checkout");
      }
      const reference = createStaffNfcPaymentReference();
      const inserted = await client.query<any>(
        `INSERT INTO staff_nfc_payments (
           subscription_id,employee_id,school_id,academic_session_id,academic_term_id,
           provider,provider_mode,reference,idempotency_key,gross_amount_minor,currency,
           status,settlement_status,reconciliation_status,created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING','PENDING','PENDING',$12)
         RETURNING id,reference,provider,provider_mode AS "providerMode",status,
                   gross_amount_minor AS "grossAmountMinor",currency,checkout_url AS "checkoutUrl"`,
        [
          subscription.id,
          subscription.employeeId,
          query.schoolId,
          subscription.sessionId,
          subscription.termId,
          mock ? "MOCK" : "FLUTTERWAVE",
          mock ? "DEVELOPMENT_MOCK" : "SANDBOX",
          reference,
          key,
          subscription.priceMinor,
          subscription.currency,
          context.user.id,
        ],
      );
      reservation = {
        ...inserted.rows[0],
        subscriptionId,
        employeeId: Number(subscription.employeeId),
        customerEmail: subscription.customerEmail,
        customerName: subscription.customerName,
        amountMinor: Number(subscription.priceMinor),
      };
      await client.query(
        `UPDATE staff_nfc_subscriptions SET status='PENDING',updated_at=NOW()
          WHERE id=$1 AND status IN ('UNPAID','FAILED','CANCELLED')`,
        [subscriptionId],
      );
      await auditFinancial(client, req, {
        schoolId: query.schoolId,
        action: "Reserved staff NFC term checkout",
        module: "Staff NFC Billing",
        recordId: Number(reservation.id),
        eventType: "STAFF_NFC_CHECKOUT_RESERVED",
        metadata: { subscriptionId, provider: reservation.provider, amountMinor: Number(reservation.grossAmountMinor) },
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (reservation.checkoutUrl || reservation.provider === "MOCK") {
    res.status(201).json({
      paymentId: Number(reservation.id),
      subscriptionId,
      reference: reservation.reference,
      provider: reservation.provider,
      providerMode: reservation.providerMode,
      status: reservation.status,
      grossAmountMinor: Number(reservation.grossAmountMinor),
      currency: reservation.currency,
      checkoutUrl: reservation.checkoutUrl ?? null,
    });
    return;
  }
  try {
    const initialized = await adapter!.initializePayment({
      reference: reservation.reference,
      amountMinor: Number(reservation.grossAmountMinor),
      currency: reservation.currency,
      email: reservation.customerEmail,
      customerName: reservation.customerName || undefined,
      returnUrl: returnUrl!,
    });
    await pool.query(
      `UPDATE staff_nfc_payments
          SET checkout_url=$1,updated_at=NOW()
        WHERE id=$2 AND reference=$3 AND status='PENDING'`,
      [initialized.checkoutUrl, reservation.id, reservation.reference],
    );
    res.status(201).json({
      paymentId: Number(reservation.id),
      subscriptionId,
      reference: reservation.reference,
      provider: "FLUTTERWAVE",
      providerMode: "SANDBOX",
      status: "PENDING",
      grossAmountMinor: Number(reservation.grossAmountMinor),
      currency: reservation.currency,
      checkoutUrl: initialized.checkoutUrl,
    });
  } catch {
    await pool.query(
      `UPDATE staff_nfc_payments
          SET status='RECONCILIATION_REQUIRED',reconciliation_status='RECONCILIATION_REQUIRED',
              failure_code='CHECKOUT_INITIALIZATION_OUTCOME_UNKNOWN',updated_at=NOW()
        WHERE id=$1 AND status='PENDING'`,
      [reservation.id],
    ).catch(() => undefined);
    throw new AuthError(503, "Provider checkout outcome needs reconciliation; do not create a second checkout", "CHECKOUT_RECONCILIATION_REQUIRED");
  }
}));

async function lookupPaymentForStaffVerification(req: Request, schoolId: number, reference: string) {
  const { employee } = await findOwnStaffEmployee(pool, req, schoolId);
  const result = await pool.query<any>(
    `SELECT id,subscription_id AS "subscriptionId",employee_id AS "employeeId",school_id AS "schoolId",
            provider,provider_mode AS "providerMode",reference,gross_amount_minor AS "grossAmountMinor",
            currency,status,provider_transaction_id AS "providerTransactionId"
       FROM staff_nfc_payments
      WHERE reference=$1 AND employee_id=$2 AND school_id=$3`,
    [reference, employee.id, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Staff NFC payment not found");
  return result.rows[0];
}

async function verifyPaymentById(
  payment: {
    id: number;
    subscriptionId: number;
    provider: string;
    providerMode: string;
    reference: string;
    grossAmountMinor: number | string;
    currency: string;
    status: string;
    providerTransactionId: string | null;
  },
  submittedTransactionId?: string,
  req?: Request,
) {
  if (payment.status === "PAID" && payment.providerTransactionId) {
    if (submittedTransactionId && submittedTransactionId !== payment.providerTransactionId
        && submittedTransactionId !== "DEVELOPMENT_MOCK") {
      throw new StaffNfcDomainError(409, "Payment already has a different verified provider transaction", "TRANSACTION_CONFLICT");
    }
    return completeVerifiedPayment(payment.id, {
      reference: payment.reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: payment.currency,
      status: "succeeded",
      providerTransactionId: payment.providerTransactionId,
    }, req ?? null);
  }
  let verified: VerifiedPayment;
  if (payment.provider === "MOCK"
      && payment.providerMode === "DEVELOPMENT_MOCK"
      && developmentMockEnabled()) {
    if (submittedTransactionId !== "DEVELOPMENT_MOCK") {
      throw new StaffNfcDomainError(400, "Use the explicit Development Mock verification marker");
    }
    const outcome = process.env.STAFF_NFC_MOCK_OUTCOME ?? "PENDING";
    verified = {
      reference: payment.reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: payment.currency,
      status: outcome === "SUCCEEDED" ? "succeeded" : outcome === "FAILED" ? "failed" : "pending",
      providerTransactionId: mockProviderTransactionId(payment.reference),
    };
  } else {
    if (payment.provider !== "FLUTTERWAVE" || payment.providerMode !== "SANDBOX") {
      throw new StaffNfcDomainError(409, "A trusted test provider is not available for this payment");
    }
    const adapter = makeStaffNfcProviderAdapter();
    if (!adapter) throw new StaffNfcDomainError(503, "Flutterwave test credentials are unavailable", "PROVIDER_UNAVAILABLE");
    const providerTransactionId = submittedTransactionId ?? payment.providerTransactionId ?? undefined;
    if (!providerTransactionId) throw new StaffNfcDomainError(400, "A Flutterwave transaction ID is required");
    verified = await adapter.verifyPayment({
      reference: payment.reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: payment.currency,
      providerTransactionId,
    });
  }
  return completeVerifiedPayment(payment.id, verified, req ?? null);
}

router.post("/staff-nfc/payments/verify", wrap(async (req, res) => {
  const query = parse(schoolQuery, req.query);
  const input = parse(verificationInput, req.body, "Payment verification request is invalid");
  const payment = await lookupPaymentForStaffVerification(req, query.schoolId, input.reference);
  const result = await verifyPaymentById(payment, input.providerTransactionId, req);
  res.json(await currentPaymentResponse(result.paymentId, result.subscriptionId, result.activated));
}));

router.post("/finance/staff-nfc/payments/:paymentId/reconcile", wrap(async (req, res) => {
  const paymentId = positiveId(req.params.paymentId, "paymentId");
  const query = parse(schoolQuery, req.query);
  idempotencyKey(req);
  const { context, platformOwner } = scopedFinanceRead(req, query.schoolId);
  const result = await pool.query<any>(
    `SELECT id,subscription_id AS "subscriptionId",employee_id AS "employeeId",school_id AS "schoolId",
            provider,provider_mode AS "providerMode",reference,gross_amount_minor AS "grossAmountMinor",
            currency,status,provider_transaction_id AS "providerTransactionId"
       FROM staff_nfc_payments WHERE id=$1 AND school_id=$2`,
    [paymentId, query.schoolId],
  );
  const payment = result.rows[0];
  if (!payment) throw new AuthError(404, "Staff NFC payment not found");
  if (!platformOwner && hasRole(context, "SCHOOL_ADMIN", query.schoolId) === false
      && hasRole(context, "ACCOUNTANT", query.schoolId) === false) {
    throw new AuthError(403, "Finance payment reconciliation is not available");
  }
  if (payment.provider === "MOCK" && !developmentMockEnabled()) {
    throw new AuthError(409, "A Development Mock payment cannot be reconciled in this environment");
  }
  const verified = await verifyPaymentById(
    payment,
    payment.provider === "MOCK" ? "DEVELOPMENT_MOCK" : payment.providerTransactionId ?? undefined,
    req,
  );
  res.json(await currentPaymentResponse(verified.paymentId, verified.subscriptionId, verified.activated));
}));

async function refundProjection(refundId: number) {
  const result = await pool.query<any>(
    `SELECT r.id AS "requestId",r.payment_id AS "paymentId",r.amount_minor AS "requestedAmountMinor",
            r.status,r.provider_refund_id AS "providerRefundId",r.failure_code AS "failureCode",
            p.refunded_amount_minor AS "refundedAmountMinor",p.refund_status AS "paymentRefundStatus",
            p.provider_mode AS "providerMode",p.school_id AS "schoolId",r.created_at AS "createdAt"
       FROM staff_nfc_refunds r
       JOIN staff_nfc_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
      WHERE r.id=$1`,
    [refundId],
  );
  if (!result.rows[0]) throw new StaffNfcDomainError(404, "Staff NFC refund not found");
  const row = result.rows[0];
  const status =
    row.status === "SUCCEEDED"
      ? Number(row.refundedAmountMinor) >= Number(row.requestedAmountMinor) && row.paymentRefundStatus === "REFUNDED"
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED"
      : row.status === "FAILED"
        ? "RECONCILIATION_REQUIRED"
        : row.status === "RECONCILIATION_REQUIRED"
          ? "RECONCILIATION_REQUIRED"
          : "PENDING";
  return {
    paymentId: Number(row.paymentId),
    requestId: Number(row.requestId),
    refundStatus: status,
    requestedAmountMinor: Number(row.requestedAmountMinor),
    refundedAmountMinor: row.status === "SUCCEEDED"
      ? Number(row.refundedAmountMinor)
      : 0,
    allocationsReversed: row.status === "SUCCEEDED",
    providerMode: row.providerMode,
  };
}

export async function finalizeVerifiedRefund(
  refundId: number,
  verified: FlutterwaveRefundResult,
  req: Request | null,
  database: typeof pool = pool,
): Promise<"pending" | "failed" | "reconciliation_required" | "refunded" | "partial_refund" | "duplicate"> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<any>(
      `SELECT r.id,r.payment_id AS "paymentId",r.school_id AS "schoolId",
              r.amount_minor AS "amountMinor",r.status AS "refundStatus",
              r.provider_refund_id AS "providerRefundId",
              p.provider,p.provider_mode AS "providerMode",p.provider_transaction_id AS "providerTransactionId",
              p.gross_amount_minor AS "grossAmountMinor",p.refunded_amount_minor AS "refundedAmountMinor",
              p.status AS "paymentStatus",p.subscription_id AS "subscriptionId",
              p.employee_id AS "employeeId",p.academic_session_id AS "sessionId",
              p.academic_term_id AS "termId",p.reference,
              s.billing_rule_id AS "billingRuleId",s.billing_rule_version AS "billingRuleVersion",
              s.attribution_id AS "attributionId"
         FROM staff_nfc_refunds r
         JOIN staff_nfc_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
         JOIN staff_nfc_subscriptions s ON s.id=p.subscription_id AND s.school_id=p.school_id
        WHERE r.id=$1
        FOR UPDATE OF r,p,s`,
      [refundId],
    );
    const refund = found.rows[0];
    if (!refund) throw new StaffNfcDomainError(404, "Staff NFC refund not found");
    if (refund.refundStatus === "SUCCEEDED") {
      await client.query("COMMIT");
      return "duplicate";
    }
    if (refund.providerRefundId && String(refund.providerRefundId) !== verified.providerRefundId) {
      await client.query(
        `UPDATE staff_nfc_refunds SET status='RECONCILIATION_REQUIRED',
                failure_code='PROVIDER_REFUND_ID_MISMATCH',updated_at=NOW() WHERE id=$1`,
        [refundId],
      );
      await client.query(
        `UPDATE staff_nfc_payments SET refund_status='RECONCILIATION_REQUIRED',updated_at=NOW()
          WHERE id=$1`,
        [refund.paymentId],
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    if (refund.providerTransactionId !== verified.providerTransactionId
        || Number(refund.amountMinor) !== verified.amountMinor) {
      await client.query(
        `UPDATE staff_nfc_refunds SET status='RECONCILIATION_REQUIRED',
                failure_code='PROVIDER_REFUND_DETAILS_MISMATCH',updated_at=NOW() WHERE id=$1`,
        [refundId],
      );
      await client.query(
        `UPDATE staff_nfc_payments SET refund_status='RECONCILIATION_REQUIRED',updated_at=NOW()
          WHERE id=$1`,
        [refund.paymentId],
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    if (verified.status === "pending" || verified.status === "unknown") {
      const outcome = verified.status === "pending" ? "PENDING" : "RECONCILIATION_REQUIRED";
      await client.query(
        `UPDATE staff_nfc_refunds SET status=$1,provider_refund_id=$2,updated_at=NOW()
          WHERE id=$3`,
        [outcome, verified.providerRefundId, refundId],
      );
      await client.query(
        `UPDATE staff_nfc_payments SET refund_status=$1,updated_at=NOW()
          WHERE id=$2`,
        [outcome, refund.paymentId],
      );
      await client.query("COMMIT");
      return verified.status === "pending" ? "pending" : "reconciliation_required";
    }
    if (verified.status === "failed") {
      await client.query(
        `UPDATE staff_nfc_refunds SET status='FAILED',provider_refund_id=$1,
                failure_code='PROVIDER_REFUND_FAILED',provider_verified_at=NOW(),updated_at=NOW()
          WHERE id=$2`,
        [verified.providerRefundId, refundId],
      );
      await client.query(
        `UPDATE staff_nfc_payments
            SET refund_status=CASE WHEN refunded_amount_minor=0 THEN 'NONE' ELSE 'PARTIALLY_REFUNDED' END,
                updated_at=NOW()
          WHERE id=$1`,
        [refund.paymentId],
      );
      await auditFinancial(client, req, {
        schoolId: Number(refund.schoolId),
        action: "Flutterwave verified staff NFC refund failure",
        module: "Staff NFC Refunds",
        recordId: refundId,
        eventType: "STAFF_NFC_REFUND_FAILED",
      });
      await client.query("COMMIT");
      return "failed";
    }
    const amountAfterRefund = Number(refund.refundedAmountMinor) + Number(refund.amountMinor);
    if (amountAfterRefund > Number(refund.grossAmountMinor)) {
      throw new StaffNfcDomainError(409, "Verified refunds exceed the original gross payment");
    }
    const originalAllocationResult = await client.query<any>(
      `SELECT recipient_type AS "recipientType",recipient_id AS "recipientId",
              amount_minor AS "amountMinor"
         FROM staff_nfc_allocations
        WHERE payment_id=$1 AND entry_type='CREDIT'
          AND recipient_type IN ('SCHOOL','PLATFORM','PARTNER')
        ORDER BY id`,
      [refund.paymentId],
    );
    const originalAllocations: StaffNfcAllocationSnapshot[] = originalAllocationResult.rows.map((allocation) => ({
      recipientType: allocation.recipientType,
      recipientId: allocation.recipientId == null ? null : Number(allocation.recipientId),
      amountMinor: Number(allocation.amountMinor),
    }));
    const reversals = calculateStaffNfcRefundReversals(
      originalAllocations,
      Number(refund.grossAmountMinor),
      Number(refund.refundedAmountMinor),
      Number(refund.amountMinor),
    );
    for (const reversal of reversals) {
      await client.query(
        `INSERT INTO staff_nfc_allocations (
           idempotency_key,entry_type,product,recipient_type,recipient_id,
           school_id,employee_id,academic_session_id,academic_term_id,
           subscription_id,payment_id,attribution_id,refund_id,allocation_rule_id,
           billing_rule_version,amount_minor,currency
         ) VALUES ($1,'REVERSAL',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'NGN')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          `staff-nfc:refund:${refundId}:reversal:${reversal.recipientType}`,
          STAFF_NFC_PRODUCT,
          reversal.recipientType,
          reversal.recipientId,
          refund.schoolId,
          refund.employeeId,
          refund.sessionId,
          refund.termId,
          refund.subscriptionId,
          refund.paymentId,
          refund.attributionId,
          refundId,
          refund.billingRuleId,
          refund.billingRuleVersion,
          reversal.amountMinor,
        ],
      );
    }
    const fullyRefunded = amountAfterRefund === Number(refund.grossAmountMinor);
    await client.query(
      `UPDATE staff_nfc_refunds
          SET status='SUCCEEDED',provider_refund_id=$1,provider_verified_at=NOW(),
              completed_at=NOW(),failure_code=NULL,updated_at=NOW()
        WHERE id=$2`,
      [verified.providerRefundId, refundId],
    );
    await client.query(
      `UPDATE staff_nfc_payments
          SET refunded_amount_minor=$1,status=$2,
              refund_status=$3,reconciliation_status='RECONCILED',updated_at=NOW()
        WHERE id=$4`,
      [
        amountAfterRefund,
        fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
        fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
        refund.paymentId,
      ],
    );
    await client.query(
      `UPDATE staff_nfc_subscriptions
          SET status=$1,refunded_at=CASE WHEN $2 THEN NOW() ELSE refunded_at END,updated_at=NOW()
        WHERE id=$3`,
      [fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED", fullyRefunded, refund.subscriptionId],
    );
    if (fullyRefunded) {
      await client.query(
        `UPDATE staff_nfc_partner_commissions SET status='REVERSED'
          WHERE subscription_id=$1 AND status<>'REVERSED'`,
        [refund.subscriptionId],
      );
    }
    await auditFinancial(client, req, {
      schoolId: Number(refund.schoolId),
      action: "Independently verified staff NFC refund",
      module: "Staff NFC Refunds",
      recordId: refundId,
      eventType: fullyRefunded ? "STAFF_NFC_REFUND_VERIFIED" : "STAFF_NFC_PARTIAL_REFUND_VERIFIED",
      metadata: {
        providerRefundId: verified.providerRefundId,
        providerTransactionId: verified.providerTransactionId,
        amountMinor: Number(refund.amountMinor),
        allocationsReversed: reversals.map((reversal) => ({
          recipientType: reversal.recipientType,
          amountMinor: reversal.amountMinor,
        })),
      },
    });
    await client.query("COMMIT");
    return fullyRefunded ? "refunded" : "partial_refund";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistRefundProviderResult(
  refundId: number,
  providerResult: FlutterwaveRefundResult,
  req: Request | null,
) {
  if (providerResult.status === "succeeded") {
    await finalizeVerifiedRefund(refundId, providerResult, req);
    return;
  }
  await finalizeVerifiedRefund(refundId, providerResult, req);
}

router.post("/finance/staff-nfc/subscriptions/:subscriptionId/refunds", wrap(async (req, res) => {
  const subscriptionId = positiveId(req.params.subscriptionId, "subscriptionId");
  const query = parse(schoolQuery, req.query);
  const input = parse(refundInput, req.body, "Refund request is invalid");
  const key = idempotencyKey(req);
  const context = requester(req);
  if (!isPlatformOwner(context)) assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
  const adapter = makeStaffNfcProviderAdapter();
  if (!adapter || typeof (adapter as any).requestRefund !== "function"
      || typeof (adapter as any).verifyRefund !== "function") {
    throw new AuthError(503, "Flutterwave test refund verification is unavailable", "PROVIDER_UNAVAILABLE");
  }
  const client = await pool.connect();
  let reservation: any;
  let shouldRequestProviderRefund = false;
  let refundAlreadyComplete = false;
  try {
    await client.query("BEGIN");
    const paymentResult = await client.query<any>(
      `SELECT p.id,p.subscription_id AS "subscriptionId",p.school_id AS "schoolId",
              p.provider,p.provider_mode AS "providerMode",p.provider_transaction_id AS "providerTransactionId",
              p.gross_amount_minor AS "grossAmountMinor",p.refunded_amount_minor AS "refundedAmountMinor",
              p.status,p.refund_status AS "refundStatus"
         FROM staff_nfc_payments p
        WHERE p.subscription_id=$1 AND p.school_id=$2
        ORDER BY p.created_at DESC,p.id DESC LIMIT 1
        FOR UPDATE`,
      [subscriptionId, query.schoolId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new AuthError(404, "Staff NFC subscription payment not found");
    if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") {
      throw new AuthError(409, "Only a verified paid staff NFC transaction can be refunded");
    }
    if (payment.provider !== "FLUTTERWAVE" || payment.providerMode !== "SANDBOX"
        || !payment.providerTransactionId) {
      throw new AuthError(409, "Only a verified Flutterwave sandbox transaction can be refunded");
    }
    const existing = await client.query<any>(
      `SELECT id,payment_id AS "paymentId",amount_minor AS "amountMinor",reason,status,
              provider_refund_id AS "providerRefundId"
         FROM staff_nfc_refunds WHERE payment_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [payment.id, key],
    );
    if (existing.rows[0]) {
      reservation = {
        ...existing.rows[0],
        providerTransactionId: payment.providerTransactionId,
        providerRefundId: existing.rows[0].providerRefundId,
        paymentId: Number(payment.id),
      };
      if ((input.amountMinor != null && Number(reservation.amountMinor) !== input.amountMinor)
          || reservation.reason !== input.reason) {
        throw new AuthError(409, "Refund idempotency key is already bound to different request details");
      }
      if (reservation.status === "FAILED") {
        throw new AuthError(409, "This refund request has a verified failure; use a new key only for a new audited request");
      }
      if (reservation.status === "SUCCEEDED") {
        refundAlreadyComplete = true;
      } else if (!reservation.providerRefundId
          && ["REQUESTED", "RECONCILIATION_REQUIRED"].includes(String(reservation.status))) {
        await client.query("COMMIT");
        res.status(202).json(await refundProjection(Number(reservation.id)));
        return;
      }
      shouldRequestProviderRefund = false;
    } else {
      const activeRefund = await client.query(
        `SELECT id FROM staff_nfc_refunds
          WHERE payment_id=$1 AND status IN ('REQUESTED','PENDING','RECONCILIATION_REQUIRED')
          LIMIT 1 FOR UPDATE`,
        [payment.id],
      );
      if (activeRefund.rows[0]) {
        throw new AuthError(409, "An existing refund is pending reconciliation for this payment");
      }
      const remaining = Number(payment.grossAmountMinor) - Number(payment.refundedAmountMinor);
      const amountMinor = input.amountMinor ?? remaining;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > remaining) {
        throw new AuthError(409, "Refund amount must be within the verified unrefunded balance");
      }
      const inserted = await client.query<any>(
        `INSERT INTO staff_nfc_refunds (
           payment_id,school_id,amount_minor,idempotency_key,reason,status,created_by
         ) VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6)
         RETURNING id,payment_id AS "paymentId",amount_minor AS "amountMinor",reason,status,
                   provider_refund_id AS "providerRefundId"`,
        [payment.id, query.schoolId, amountMinor, key, input.reason, context.user.id],
      );
      reservation = inserted.rows[0];
      reservation.providerTransactionId = payment.providerTransactionId;
      await auditFinancial(client, req, {
        schoolId: query.schoolId,
        action: "Requested staff NFC provider refund",
        module: "Staff NFC Refunds",
        recordId: Number(reservation.id),
        eventType: "STAFF_NFC_REFUND_REQUESTED",
        metadata: { paymentId: Number(payment.id), amountMinor, reason: input.reason },
      });
      await client.query(
        `UPDATE staff_nfc_payments SET refund_status='PENDING',updated_at=NOW() WHERE id=$1`,
        [payment.id],
      );
      shouldRequestProviderRefund = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (refundAlreadyComplete) {
    res.status(202).json(await refundProjection(Number(reservation.id)));
    return;
  }
  try {
    const providerResult = shouldRequestProviderRefund
      ? await (adapter as any).requestRefund({
          providerTransactionId: reservation.providerTransactionId,
          amountMinor: Number(reservation.amountMinor),
          currency: STAFF_NFC_CURRENCY,
          reason: reservation.reason,
        }) as FlutterwaveRefundResult
      : await (adapter as any).verifyRefund(reservation.providerRefundId) as FlutterwaveRefundResult;
    await persistRefundProviderResult(Number(reservation.id), providerResult, req);
  } catch {
    await pool.query(
      `UPDATE staff_nfc_refunds SET status='RECONCILIATION_REQUIRED',
              failure_code='REFUND_PROVIDER_OUTCOME_UNKNOWN',updated_at=NOW()
        WHERE id=$1 AND status IN ('REQUESTED','PENDING')`,
      [reservation.id],
    ).catch(() => undefined);
    await pool.query(
      `UPDATE staff_nfc_payments SET refund_status='RECONCILIATION_REQUIRED',updated_at=NOW()
        WHERE id=$1`,
      [reservation.paymentId],
    ).catch(() => undefined);
  }
  res.status(202).json(await refundProjection(Number(reservation.id)));
}));

router.get("/staff-nfc/payments/:paymentId/receipt", wrap(async (req, res) => {
  const paymentId = positiveId(req.params.paymentId, "paymentId");
  const query = parse(schoolQuery, req.query);
  const receipt = await pool.query<any>(
    `SELECT r.receipt_number AS "receiptNumber",r.issued_at AS "issuedAt",r.snapshot,
            p.employee_id AS "employeeId",p.school_id AS "schoolId"
       FROM staff_nfc_receipts r
       JOIN staff_nfc_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
      WHERE p.id=$1 AND p.school_id=$2`,
    [paymentId, query.schoolId],
  );
  const row = receipt.rows[0];
  if (!row) throw new AuthError(404, "Staff NFC receipt not found");
  await requireReceiptScope(pool, req, {
    schoolId: Number(row.schoolId),
    employeeId: Number(row.employeeId),
  });
  const snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
  const allocations = Array.isArray(snapshot.allocations) ? snapshot.allocations : [];
  res.json({
    receiptNumber: row.receiptNumber,
    issuedAt: row.issuedAt,
    staffName: snapshot.employeeName,
    employeeNumber: snapshot.employeeNo,
    schoolId: Number(snapshot.schoolId),
    schoolName: snapshot.schoolName,
    schoolLogoVersionUrl: typeof snapshot.schoolLogoVersionUrl === "string"
      ? snapshot.schoolLogoVersionUrl
      : null,
    sessionName: snapshot.sessionName,
    termName: snapshot.termName,
    payment: {
      id: Number(snapshot.paymentId),
      provider: snapshot.provider,
      providerMode: snapshot.providerMode,
      status: "PAID",
      grossAmountMinor: Number(snapshot.grossAmountMinor),
      providerFeeMinor: snapshot.providerFeeMinor == null ? null : Number(snapshot.providerFeeMinor),
      settlementAmountMinor: snapshot.settlementAmountMinor == null ? null : Number(snapshot.settlementAmountMinor),
      currency: snapshot.currency,
      providerReference: snapshot.reference,
      providerTransactionId: null,
      paidAt: snapshot.paidAt,
      settledAt: null,
      reconciliationStatus: "RECONCILED",
      refundStatus: "NONE",
      allocations,
    },
    allocations,
  });
}));

const financeQuery = z.object({
  schoolId: safeId.optional(),
  academicSessionId: safeId.optional(),
  academicTermId: safeId.optional(),
  partnerId: safeId.optional(),
  employeeId: safeId.optional(),
  paymentStatus: z.enum([
    "UNPAID", "PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED",
    "PARTIALLY_REFUNDED", "all",
  ]).optional().default("all"),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().optional(),
}).strict();

router.get("/finance/staff-nfc/subscriptions", wrap(async (req, res) => {
  const query = parse(financeQuery, req.query, "Finance filters are invalid");
  if (query.from && query.to && query.from > query.to) {
    throw new AuthError(400, "The finance start date must be before the end date");
  }
  const { platformOwner } = scopedFinanceRead(req, query.schoolId);
  if (!platformOwner && query.schoolId === undefined) throw new AuthError(400, "A valid schoolId is required");
  const schoolScope = platformOwner ? query.schoolId ?? null : query.schoolId!;
  const values = [
    schoolScope,
    query.academicSessionId ?? null,
    query.academicTermId ?? null,
    query.partnerId ?? null,
    query.employeeId ?? null,
    query.paymentStatus,
    query.from ?? null,
    query.to ?? null,
    query.search?.trim() || null,
    query.cursor ?? null,
    query.limit + 1,
  ];
  const results = await pool.query<any>(
    `WITH matching AS (
       SELECT s.id,s.employee_id AS "employeeId",s.school_id AS "schoolId",sc.name AS "schoolName",
              trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
              e.employee_no AS "employeeNo",s.partner_profile_id AS "partnerId",pp.full_name AS "partnerName",
              s.academic_session_id AS "sessionId",ses.name AS "sessionName",
              s.academic_term_id AS "termId",t.name AS "termName",
              s.billing_rule_id AS "billingRuleId",s.billing_rule_version AS "billingRuleVersion",
              s.price_minor AS "priceMinor",s.school_share_minor AS "schoolShareMinor",
              s.platform_share_minor AS "platformShareMinor",s.partner_share_minor AS "partnerShareMinor",
              s.status AS "subscriptionStatus",s.currency,s.due_date AS "dueDate",s.paid_at AS "paidAt",
              s.created_at AS "createdAt",
              COALESCE(latest.status,s.status) AS "paymentStatus",
              COALESCE(latest.id,0) AS "paymentId",
              latest.provider AS "paymentProvider",latest.provider_mode AS "providerMode",
              latest.gross_amount_minor AS "grossAmountMinor",
              latest.provider_fee_minor AS "providerFeeMinor",
              latest.settlement_amount_minor AS "settlementAmountMinor",
              latest.currency AS "paymentCurrency",
              latest.provider_transaction_id AS "providerTransactionId",
              latest.reference AS "providerReference",
              latest.paid_at AS "paymentPaidAt",
              latest.settlement_status AS "settlementStatus",
              latest.reconciliation_status AS "reconciliationStatus",
              latest.refund_status AS "refundStatus",
              COALESCE(alloc.items,'[]'::jsonb) AS allocations,
              latest.created_at AS "paymentCreatedAt"
         FROM staff_nfc_subscriptions s
         JOIN employees e ON e.id=s.employee_id AND e.school_id=s.school_id
         JOIN schools sc ON sc.id=s.school_id
         JOIN academic_sessions ses ON ses.id=s.academic_session_id AND ses.school_id=s.school_id
         JOIN academic_terms t ON t.id=s.academic_term_id AND t.school_id=s.school_id
         LEFT JOIN partner_profiles pp ON pp.id=s.partner_profile_id
         LEFT JOIN LATERAL (
           SELECT p.* FROM staff_nfc_payments p
            WHERE p.subscription_id=s.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'recipientType',a.recipient_type,'recipientId',a.recipient_id,
             'amountMinor',a.amount_minor,'currency',a.currency,'entryType',a.entry_type
           ) ORDER BY a.id) AS items
             FROM staff_nfc_allocations a WHERE a.payment_id=latest.id
         ) alloc ON true
        WHERE ($1::int IS NULL OR s.school_id=$1)
          AND ($2::int IS NULL OR s.academic_session_id=$2)
          AND ($3::int IS NULL OR s.academic_term_id=$3)
          AND ($4::int IS NULL OR s.partner_profile_id=$4)
          AND ($5::int IS NULL OR s.employee_id=$5)
          AND ($6::text='all' OR COALESCE(latest.status,s.status)=$6)
          AND ($7::date IS NULL OR latest.created_at >= $7::date)
          AND ($8::date IS NULL OR latest.created_at < ($8::date + INTERVAL '1 day'))
          AND ($9::text IS NULL OR
               sc.name ILIKE '%' || $9 || '%' OR
               e.employee_no ILIKE '%' || $9 || '%' OR
               concat_ws(' ',e.first_name,e.middle_name,e.last_name) ILIKE '%' || $9 || '%')
     ), totals AS (
       SELECT COALESCE(SUM(CASE WHEN "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
                               THEN COALESCE("grossAmountMinor","priceMinor") ELSE 0 END),0)::bigint AS gross,
              COUNT(*) FILTER (WHERE "paymentStatus"='PAID')::int AS paid_count,
              COUNT(*) FILTER (WHERE "paymentStatus"='PENDING')::int AS pending_count,
              COUNT(*) FILTER (WHERE "paymentStatus"='FAILED')::int AS failed_count,
              COUNT(*) FILTER (WHERE "paymentStatus" IN ('REFUNDED','PARTIALLY_REFUNDED'))::int AS refunded_count
         FROM matching
     ), allocation_totals AS (
       SELECT COALESCE(SUM(CASE WHEN a.entry_type='CREDIT' THEN a.amount_minor
                                WHEN a.entry_type='REVERSAL' THEN -a.amount_minor ELSE 0 END)
                       FILTER (WHERE a.recipient_type='SCHOOL'),0)::bigint AS school_amount,
              COALESCE(SUM(CASE WHEN a.entry_type='CREDIT' THEN a.amount_minor
                                WHEN a.entry_type='REVERSAL' THEN -a.amount_minor ELSE 0 END)
                       FILTER (WHERE a.recipient_type='PLATFORM'),0)::bigint AS platform_amount,
              COALESCE(SUM(CASE WHEN a.entry_type='CREDIT' THEN a.amount_minor
                                WHEN a.entry_type='REVERSAL' THEN -a.amount_minor ELSE 0 END)
                       FILTER (WHERE a.recipient_type='PARTNER'),0)::bigint AS partner_amount,
              COALESCE(SUM(a.amount_minor) FILTER (WHERE a.entry_type='EXPENSE'
                        AND a.recipient_type='PLATFORM_PROVIDER_FEE'),0)::bigint AS provider_fee
         FROM staff_nfc_allocations a
         JOIN matching m ON m."paymentId"=a.payment_id
     )
     SELECT to_jsonb(page.*) AS item,totals.*,allocation_totals.*,
            (SELECT COUNT(*)::int FROM matching) AS "totalCount"
       FROM totals CROSS JOIN allocation_totals
       LEFT JOIN LATERAL (
         SELECT m.* FROM matching m
          WHERE ($10::int IS NULL OR m.id < $10)
          ORDER BY m.id DESC LIMIT $11
       ) page ON true`,
    values,
  );
  const source = results.rows;
  const totalRow = source[0] ?? {};
  const rawItems = source.filter((entry) => entry.item).map((entry) => entry.item);
  const items = rawItems.slice(0, query.limit);
  const hasMore = rawItems.length > query.limit;
  const scopedTotals = {
    grossAmountMinor: Number(totalRow.gross ?? 0),
    schoolAllocationMinor: Number(totalRow.school_amount ?? 0),
    platformRevenueMinor: platformOwner ? Number(totalRow.platform_amount ?? 0) : 0,
    partnerCommissionMinor: platformOwner ? Number(totalRow.partner_amount ?? 0) : 0,
    providerFeeExpenseMinor: platformOwner ? Number(totalRow.provider_fee ?? 0) : 0,
    paidCount: Number(totalRow.paid_count ?? 0),
    pendingCount: Number(totalRow.pending_count ?? 0),
    failedCount: Number(totalRow.failed_count ?? 0),
    refundedCount: Number(totalRow.refunded_count ?? 0),
  };
  const role = platformOwner
    ? "PLATFORM_OWNER"
    : hasRole(requester(req), "ACCOUNTANT", query.schoolId!)
      ? "ACCOUNTANT"
      : "SCHOOL_ADMIN";
  const pageItems = items.map((row: any) => ({
    id: Number(row.id),
    employeeId: Number(row.employeeId),
    employeeName: row.employeeName,
    employeeNumber: row.employeeNo,
    schoolId: Number(row.schoolId),
    schoolName: row.schoolName,
    partnerId: row.partnerId == null ? null : Number(row.partnerId),
    partnerName: row.partnerName ?? null,
    sessionId: Number(row.sessionId),
    sessionName: row.sessionName,
    termId: Number(row.termId),
    termName: row.termName,
    billingRuleId: Number(row.billingRuleId),
    billingRuleVersion: Number(row.billingRuleVersion),
    priceMinor: Number(row.priceMinor),
    schoolShareMinor: Number(row.schoolShareMinor),
    platformShareMinor: Number(row.platformShareMinor),
    partnerShareMinor: Number(row.partnerShareMinor),
    status: row.subscriptionStatus,
    currency: row.currency,
    dueDate: row.dueDate,
    paidAt: row.paidAt ?? null,
    nextTerm: null,
    cardStatus: "NONE",
    isEligibleForNfc: row.subscriptionStatus === "PAID",
    latestPayment: Number(row.paymentId) > 0 ? paymentSummary(row) : null,
    createdAt: row.createdAt,
  }));
  res.json({
    role,
    totals: scopedTotals,
    items: pageItems,
    nextCursor: hasMore && pageItems.length ? pageItems[pageItems.length - 1].id : null,
  });
}));

router.get("/partner/staff-nfc/commissions", wrap(async (req, res) => {
  const context = partnerContext(req);
  const query = parse(z.object({
    academicSessionId: safeId.optional(),
    academicTermId: safeId.optional(),
    status: z.enum(["PENDING", "PAID", "REVERSED", "all"]).optional().default("all"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.coerce.number().int().nonnegative().optional(),
  }).strict(), req.query);
  const partner = await pool.query<{ id: number }>(
    `SELECT id FROM partner_profiles WHERE user_id=$1 AND status='ACTIVE' LIMIT 1`,
    [context.user.id],
  );
  if (!partner.rows[0]) throw new AuthError(404, "Partner profile not found");
  const results = await pool.query<any>(
    `WITH allocations AS (
       SELECT a.subscription_id AS "subscriptionId",a.payment_id AS "paymentId",
              SUM(CASE WHEN a.entry_type='CREDIT' THEN a.amount_minor
                       WHEN a.entry_type='REVERSAL' THEN -a.amount_minor ELSE 0 END)::bigint AS "commissionMinor"
         FROM staff_nfc_allocations a
        WHERE a.recipient_type='PARTNER' AND a.recipient_id=$1
        GROUP BY a.subscription_id,a.payment_id
     ), matching AS (
       SELECT n.id AS "subscriptionId",n.school_id AS "schoolId",sc.name AS "schoolName",
              n.academic_session_id AS "sessionId",ses.name AS "sessionName",
              n.academic_term_id AS "termId",t.name AS "termName",
              n.price_minor AS "priceMinor",alloc."commissionMinor",
              pay.status AS "paymentStatus",
              CASE WHEN pay.status='REFUNDED' OR alloc."commissionMinor"=0 THEN 'REVERSED'
                   ELSE com.status END AS "commissionStatus"
         FROM staff_nfc_partner_commissions com
         JOIN staff_nfc_subscriptions n
           ON n.id=com.subscription_id AND n.school_id=com.school_id
          AND n.partner_profile_id=$1
         JOIN staff_nfc_payments pay ON pay.id=com.payment_id AND pay.school_id=com.school_id
         JOIN schools sc ON sc.id=n.school_id
         JOIN academic_sessions ses ON ses.id=n.academic_session_id AND ses.school_id=n.school_id
         JOIN academic_terms t ON t.id=n.academic_term_id AND t.school_id=n.school_id
         JOIN allocations alloc ON alloc."subscriptionId"=n.id AND alloc."paymentId"=pay.id
        WHERE ($2::int IS NULL OR n.academic_session_id=$2)
          AND ($3::int IS NULL OR n.academic_term_id=$3)
          AND ($4::text='all' OR
            CASE WHEN pay.status='REFUNDED' OR alloc."commissionMinor"=0 THEN 'REVERSED'
                 ELSE com.status END=$4)
          AND ($5::int IS NULL OR n.id<$5)
     ), totals AS (
       SELECT COUNT(*)::int AS eligible_count,
              COALESCE(SUM("priceMinor"),0)::bigint AS gross,
              COALESCE(SUM("commissionMinor"),0)::bigint AS commission,
              COALESCE(SUM("commissionMinor") FILTER (WHERE "commissionStatus"='PENDING'),0)::bigint AS pending,
              COALESCE(SUM("commissionMinor") FILTER (WHERE "commissionStatus"='PAID'),0)::bigint AS paid
         FROM matching
     )
     SELECT to_jsonb(page.*) AS item,totals.*
       FROM totals LEFT JOIN LATERAL (
         SELECT m.* FROM matching m
          WHERE ($5::int IS NULL OR m."subscriptionId"<$5)
          ORDER BY m."subscriptionId" DESC LIMIT $6
       ) page ON true`,
    [
      Number(partner.rows[0].id),
      query.academicSessionId ?? null,
      query.academicTermId ?? null,
      query.status,
      query.cursor ?? null,
      query.limit + 1,
    ],
  );
  const first = results.rows[0] ?? {};
  const rawItems = results.rows.flatMap((result) => result.item ? [result.item] : []);
  const items = rawItems.slice(0, query.limit).map((item: any) => ({
    subscriptionId: Number(item.subscriptionId),
    schoolId: Number(item.schoolId),
    schoolName: item.schoolName,
    sessionId: Number(item.sessionId),
    sessionName: item.sessionName,
    termId: Number(item.termId),
    termName: item.termName,
    priceMinor: Number(item.priceMinor),
    commissionMinor: Number(item.commissionMinor),
    paymentStatus: item.paymentStatus === "PARTIALLY_REFUNDED"
      ? "PARTIALLY_REFUNDED"
      : item.paymentStatus,
    commissionStatus: item.commissionStatus,
  }));
  res.json({
    partnerId: Number(partner.rows[0].id),
    totals: {
      eligibleSubscriptionCount: Number(first.eligible_count ?? 0),
      grossAmountMinor: Number(first.gross ?? 0),
      commissionAmountMinor: Number(first.commission ?? 0),
      pendingCommissionMinor: Number(first.pending ?? 0),
      paidCommissionMinor: Number(first.paid ?? 0),
    },
    items,
    nextCursor: rawItems.length > query.limit && items.length ? items[items.length - 1].subscriptionId : null,
  });
}));

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function providerString(value: unknown, maximum = 120) {
  if ((typeof value !== "string" && typeof value !== "number")
      || (typeof value === "number" && !Number.isSafeInteger(value))) return null;
  const result = String(value);
  return result.length <= maximum ? result : null;
}

async function recordStaffWebhookEvent(input: {
  eventId: string;
  providerReference: string;
  providerTransactionId: string;
  digest: string;
  paymentId?: number | null;
  schoolId?: number | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO staff_nfc_provider_events (
         event_id,provider_reference,provider_transaction_id,payload_sha256,
         signature_verified,outcome,payment_id,school_id
       ) VALUES ($1,$2,$3,$4,true,'RECEIVED',$5,$6)
       ON CONFLICT (provider,event_id) DO NOTHING
       RETURNING id`,
      [
        input.eventId,
        input.providerReference,
        input.providerTransactionId,
        input.digest,
        input.paymentId ?? null,
        input.schoolId ?? null,
      ],
    );
    if (inserted.rows[0]) {
      await client.query("COMMIT");
      return { eventRowId: Number(inserted.rows[0].id), duplicate: false, conflict: false, completed: false };
    }
    const existing = await client.query<{ id: number; payloadSha256: string; outcome: string }>(
      `SELECT id,payload_sha256 AS "payloadSha256",outcome
         FROM staff_nfc_provider_events
        WHERE provider='FLUTTERWAVE' AND event_id=$1 FOR UPDATE`,
      [input.eventId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error("Provider event idempotency row was not found");
    if (row.payloadSha256 !== input.digest) {
      await client.query(
        `UPDATE staff_nfc_provider_events
            SET outcome='RECONCILIATION_REQUIRED',failure_code='DUPLICATE_EVENT_DIGEST_MISMATCH'
          WHERE id=$1`,
        [row.id],
      );
      await client.query("COMMIT");
      return { eventRowId: Number(row.id), duplicate: false, conflict: true, completed: false };
    }
    const completed = ["VERIFIED", "FAILED", "REFUNDED", "PARTIAL_REFUND"].includes(row.outcome);
    await client.query("COMMIT");
    return { eventRowId: Number(row.id), duplicate: true, conflict: false, completed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordUnmatchedProviderEvent(input: {
  eventId: string;
  reference: string;
  transactionId: string;
  digest: string;
  outcome?: "RECONCILIATION_REQUIRED" | "PENDING";
}) {
  const event = await recordStaffWebhookEvent({
    eventId: input.eventId,
    providerReference: input.reference || `unmatched:${input.eventId}`,
    providerTransactionId: input.transactionId,
    digest: input.digest,
  });
  await pool.query(
    `UPDATE staff_nfc_provider_events
        SET outcome=$1,failure_code='STAFF_NFC_PAYMENT_NOT_FOUND',resolved_at=NOW()
      WHERE id=$2 AND payment_id IS NULL`,
    [input.outcome ?? "RECONCILIATION_REQUIRED", event.eventRowId],
  );
  return event;
}

async function handleChargeCompletedWebhook(
  eventId: string,
  digest: string,
  reference: string,
  transactionId: string,
  adapter: NonNullable<ReturnType<typeof makeStaffNfcProviderAdapter>>,
): Promise<"verified" | "pending" | "failed" | "duplicate" | "reconciliation_required"> {
  const matched = await pool.query<any>(
    `SELECT id,school_id AS "schoolId",reference,gross_amount_minor AS "grossAmountMinor",
            currency,status,provider,provider_mode AS "providerMode",
            subscription_id AS "subscriptionId"
       FROM staff_nfc_payments
      WHERE reference=$1 AND provider='FLUTTERWAVE'
      LIMIT 1`,
    [reference],
  );
  const payment = matched.rows[0];
  if (!payment) {
    const saved = await recordUnmatchedProviderEvent({ eventId, reference, transactionId, digest });
    return saved.completed ? "duplicate" : "reconciliation_required";
  }
  const event = await recordStaffWebhookEvent({
    eventId,
    providerReference: reference,
    providerTransactionId: transactionId,
    digest,
    paymentId: Number(payment.id),
    schoolId: Number(payment.schoolId),
  });
  if (event.conflict) {
    await pool.query(
      `UPDATE staff_nfc_payments
          SET status=CASE WHEN status='PENDING' THEN 'RECONCILIATION_REQUIRED' ELSE status END,
              reconciliation_status='RECONCILIATION_REQUIRED',updated_at=NOW()
        WHERE id=$1`,
      [payment.id],
    );
    return "reconciliation_required";
  }
  if (event.duplicate && event.completed) return "duplicate";
  await pool.query(
    `UPDATE staff_nfc_provider_events
        SET outcome='RECEIVED',failure_code=NULL
      WHERE id=$1`,
    [event.eventRowId],
  );
  try {
    const verified = await adapter.verifyPayment({
      reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: payment.currency,
      providerTransactionId: transactionId,
    });
    const settled = await completeVerifiedPayment(Number(payment.id), verified, null);
    const outcome = verified.status === "succeeded"
      ? "VERIFIED"
      : verified.status === "failed"
        ? "FAILED"
        : "PENDING";
    await pool.query(
      `UPDATE staff_nfc_provider_events
          SET outcome=$1,resolved_at=NOW(),failure_code=NULL
        WHERE id=$2`,
      [outcome, event.eventRowId],
    );
    return verified.status === "succeeded" ? "verified" : verified.status === "failed" ? "failed" : "pending";
  } catch {
    await pool.query(
      `UPDATE staff_nfc_provider_events SET outcome='RECONCILIATION_REQUIRED',
              failure_code='PROVIDER_VERIFICATION_UNAVAILABLE'
        WHERE id=$1`,
      [event.eventRowId],
    );
    await pool.query(
      `UPDATE staff_nfc_payments
          SET status=CASE WHEN status='PENDING' THEN 'RECONCILIATION_REQUIRED' ELSE status END,
              reconciliation_status='RECONCILIATION_REQUIRED',updated_at=NOW()
        WHERE id=$1`,
      [payment.id],
    );
    return "reconciliation_required";
  }
}

async function handleRefundCompletedWebhook(
  eventId: string,
  digest: string,
  providerRefundId: string,
  adapter: NonNullable<ReturnType<typeof makeStaffNfcProviderAdapter>>,
): Promise<"refund_pending" | "refunded" | "partial_refund" | "duplicate" | "reconciliation_required"> {
  const linked = await pool.query<any>(
    `SELECT r.id AS "refundId",r.payment_id AS "paymentId",r.school_id AS "schoolId",
            p.reference,p.provider_transaction_id AS "providerTransactionId"
       FROM staff_nfc_refunds r
       JOIN staff_nfc_payments p ON p.id=r.payment_id AND p.school_id=r.school_id
      WHERE r.provider_refund_id=$1 AND p.provider='FLUTTERWAVE'
      LIMIT 1`,
    [providerRefundId],
  );
  const refund = linked.rows[0];
  if (!refund) {
    const marker = await recordUnmatchedProviderEvent({
      eventId,
      reference: `unmatched-refund:${providerRefundId}`,
      transactionId: providerRefundId,
      digest,
    });
    return marker.completed ? "duplicate" : "reconciliation_required";
  }
  const event = await recordStaffWebhookEvent({
    eventId,
    providerReference: refund.reference,
    providerTransactionId: String(refund.providerTransactionId),
    digest,
    paymentId: Number(refund.paymentId),
    schoolId: Number(refund.schoolId),
  });
  if (event.conflict) return "reconciliation_required";
  if (event.duplicate && event.completed) return "duplicate";
  try {
    const adapterWithRefund = adapter as typeof adapter & {
      verifyRefund?: (id: string) => Promise<FlutterwaveRefundResult>;
    };
    if (!adapterWithRefund.verifyRefund) return "reconciliation_required";
    const verified = await adapterWithRefund.verifyRefund(providerRefundId);
    const outcome = await finalizeVerifiedRefund(Number(refund.refundId), verified, null);
    const dbOutcome = outcome === "refunded" ? "REFUNDED"
      : outcome === "partial_refund" ? "PARTIAL_REFUND"
        : outcome === "duplicate" ? "DUPLICATE"
          : outcome === "failed" ? "FAILED"
            : outcome === "pending" ? "REFUND_PENDING"
              : "RECONCILIATION_REQUIRED";
    await pool.query(
      `UPDATE staff_nfc_provider_events SET outcome=$1,resolved_at=NOW()
        WHERE id=$2`,
      [dbOutcome, event.eventRowId],
    );
    return outcome === "duplicate" ? "duplicate"
      : outcome === "refunded" || outcome === "partial_refund" ? outcome
        : outcome === "pending" ? "refund_pending"
          : "reconciliation_required";
  } catch {
    await pool.query(
      `UPDATE staff_nfc_provider_events SET outcome='RECONCILIATION_REQUIRED',
              failure_code='REFUND_PROVIDER_STATUS_UNAVAILABLE'
        WHERE id=$1`,
      [event.eventRowId],
    );
    return "reconciliation_required";
  }
}

export const staffFlutterwaveWebhookRouter: IRouter = Router();
staffFlutterwaveWebhookRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody || rawBody.length < 1 || rawBody.length > 65_536) {
    res.status(400).json({ error: "Webhook body is invalid" });
    return;
  }
  const adapter = makeStaffNfcProviderAdapter();
  const signingSecret = staffNfcWebhookSigningSecret();
  if (!adapter || !signingSecret) {
    res.status(503).json({ error: "Flutterwave webhook verification credentials are unavailable" });
    return;
  }
  const signature = typeof req.headers["flutterwave-signature"] === "string"
    ? req.headers["flutterwave-signature"]
    : undefined;
  if (!verifyFlutterwaveStaffWebhookSignature(rawBody, signature, signingSecret)) {
    res.status(401).json({ error: "Flutterwave webhook signature is invalid" });
    return;
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = objectField(JSON.parse(rawBody.toString("utf8")));
  } catch {
    // An authenticated but malformed payload has no financial effect.
  }
  if (!parsed) {
    res.status(400).json({ error: "Webhook payload is invalid" });
    return;
  }
  const eventType = providerString(parsed.event, 100);
  const data = objectField(parsed.data);
  if (!eventType || !data) {
    res.status(202).json({ received: true, outcome: "reconciliation_required" });
    return;
  }
  const digest = staffNfcWebhookDigest(rawBody);
  const id = providerString(data.id);
  if (!id || !/^[0-9]+$/.test(id)) {
    res.status(202).json({ received: true, outcome: "reconciliation_required" });
    return;
  }
  if (eventType === "charge.completed") {
    const reference = providerString(data.tx_ref, 100);
    if (!reference || !/^[A-Za-z0-9_-]{8,100}$/.test(reference)) {
      res.status(202).json({ received: true, outcome: "reconciliation_required" });
      return;
    }
    const outcome = await handleChargeCompletedWebhook(
      `flutterwave:charge.completed:${id}`,
      digest,
      reference,
      id,
      adapter,
    );
    res.status(outcome === "reconciliation_required" ? 202 : 200).json({ received: true, outcome });
    return;
  }
  if (eventType === "refund.completed") {
    const outcome = await handleRefundCompletedWebhook(
      `flutterwave:refund.completed:${id}`,
      digest,
      id,
      adapter,
    );
    res.status(outcome === "reconciliation_required" || outcome === "refund_pending" ? 202 : 200)
      .json({ received: true, outcome });
    return;
  }
  res.status(202).json({ received: true, outcome: "pending" });
});


