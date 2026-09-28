import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  ApproveFeeAdjustmentParams,
  ApproveFeeAdjustmentResponse,
  ApproveFeeAdjustmentQueryParams,
  AssignFeeStructureBody,
  AssignFeeStructureResponse,
  AssignFeeStructureQueryParams,
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
  InitializeFeeProviderPaymentBody,
  InitializeFeeProviderPaymentParams,
  InitializeFeeProviderPaymentQueryParams,
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
  assertRoles,
  assertSchoolAccess,
  AuthError,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";
import { invoiceStatus, payableAmount } from "./finance-money";

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

router.get("/school/finance/settings", async (req, res): Promise<void> => {
  try {
    const schoolId = schoolIdFromQuery(req, GetFinanceSettingsQueryParams);
    const result = await pool.query(
      `SELECT school_id AS "schoolId",partial_payments_enabled AS "partialPaymentsEnabled",
         bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1`,
      [schoolId],
    );
    res.json(GetFinanceSettingsResponse.parse(result.rows[0] ?? {
      schoolId, partialPaymentsEnabled: false, bankTransferEnabled: false,
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
         bank_account_name AS "accountName",bank_account_number AS "accountNumber"
       FROM fee_school_settings WHERE school_id=$1 FOR UPDATE`,
      [schoolId],
    );
    const current = currentResult.rows[0] ?? {
      partialPaymentsEnabled: false, bankTransferEnabled: false,
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
        (school_id,partial_payments_enabled,bank_transfer_enabled,bank_name,bank_account_name,bank_account_number,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (school_id) DO UPDATE SET
        partial_payments_enabled=EXCLUDED.partial_payments_enabled,
        bank_transfer_enabled=EXCLUDED.bank_transfer_enabled,bank_name=EXCLUDED.bank_name,
        bank_account_name=EXCLUDED.bank_account_name,bank_account_number=EXCLUDED.bank_account_number,
        updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING school_id AS "schoolId",partial_payments_enabled AS "partialPaymentsEnabled",
        bank_transfer_enabled AS "bankTransferEnabled",bank_name AS "bankName",
        bank_account_name AS "accountName",bank_account_number AS "accountNumber"`,
      [schoolId, partialPaymentsEnabled, bankTransferEnabled, bankName, accountName, accountNumber, context.user.id],
    );
    await audit(req, client, schoolId, "updated", "finance settings", schoolId,
      {
        changedFields: Object.keys(body), partialPaymentsEnabled, bankTransferEnabled,
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
    assignment.schoolId === schoolId && allowedRoles.includes(assignment.role as "SCHOOL_ADMIN" | "ACCOUNTANT"))) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
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
      context.roles.find((role) => role.schoolId === schoolId)?.role ?? "PLATFORM_OWNER",
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
  else res.status(500).json({ error: "Finance operation failed" });
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
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
    const subtotal = lines.rows.reduce((total: number, line: any) => total + line.amount_minor, 0);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const invoiceNumber = `EDC-${schoolId}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO fee_invoices (school_id,student_id,structure_id,academic_session_id,academic_term_id,invoice_number,
       student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,
       subtotal_minor,total_minor,outstanding_minor,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13,$14) RETURNING id`,
      [schoolId, body.studentId, body.structureId, structure.rows[0].academic_session_id, structure.rows[0].academic_term_id,
        invoiceNumber, `${student.rows[0].first_name} ${student.rows[0].last_name}`, student.rows[0].admission_no,
        student.rows[0].class_name, student.rows[0].section, date(body.issueDate), date(body.dueDate), subtotal, context.user.id],
    );
    for (const line of lines.rows) {
      await client.query(
        `INSERT INTO fee_invoice_lines (school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [schoolId, inserted.rows[0].id, line.category_id, line.category_name_snapshot, line.description_snapshot, line.amount_minor],
      );
    }
    await audit(req, client, schoolId, "assigned", "invoice", inserted.rows[0].id, { studentId: body.studentId });
    const invoice = await client.query(`SELECT ${invoiceShape} FROM fee_invoices i WHERE i.id=$1 AND i.school_id=$2`, [inserted.rows[0].id, schoolId]);
    await client.query("COMMIT");
    res.status(201).json(AssignFeeStructureResponse.parse(invoice.rows[0]));
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
    const filters = parsed(ListSchoolFinancePaymentsQueryParams, req.query);
    assertSchoolAccess(req, filters.schoolId, [...schoolRoles]);
    const result = await pool.query(
      `SELECT ${paymentHistoryShape(true)}
       FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
       LEFT JOIN fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id AND r.invoice_id=p.invoice_id
       WHERE p.school_id=$1 AND ($2::text IS NULL OR p.status=$2)
         AND ($3::integer IS NULL OR p.student_id=$3)
       ORDER BY p.created_at DESC,p.id DESC`,
      [filters.schoolId, filters.status ?? null, filters.studentId ?? null],
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
    const schoolInfo = await client.query(`SELECT name,logo FROM schools WHERE id=$1`, [schoolId]);
    const payer = payment.rows[0].parent_id
      ? await client.query(`SELECT name FROM parents WHERE id=$1 AND school_id=$2`, [payment.rows[0].parent_id, schoolId])
      : { rows: [] };
    await client.query(
      `INSERT INTO fee_receipts (school_id,payment_id,invoice_id,receipt_number,snapshot)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payment_id) DO NOTHING`,
      [schoolId, paymentId, invoice.rows[0].id, receiptNumber, {
        invoiceId: invoice.rows[0].id,
        schoolId,
        schoolName: schoolInfo.rows[0]?.name ?? null,
        schoolLogo: schoolInfo.rows[0]?.logo ?? null,
        invoiceNumber: invoice.rows[0].invoice_number, studentName: invoice.rows[0].student_name_snapshot,
        admissionNo: invoice.rows[0].admission_no_snapshot, className: invoice.rows[0].class_name_snapshot,
        sessionId: invoice.rows[0].academic_session_id, termId: invoice.rows[0].academic_term_id,
        payerName: payer.rows[0]?.name ?? null,
        paymentReference: payment.rows[0].reference, amountMinor: payment.rows[0].amount_minor,
        previousBalanceMinor: invoice.rows[0].outstanding_minor, remainingBalanceMinor: nextOutstanding,
        status: "VERIFIED", method: payment.rows[0].method, provider: payment.rows[0].provider,
      }],
    );
    const persistedReceipt = await client.query(
      `SELECT receipt_number FROM fee_receipts WHERE payment_id=$1 AND school_id=$2 AND invoice_id=$3`,
      [paymentId, schoolId, invoice.rows[0].id],
    );
    if (persistedReceipt.rows[0]?.receipt_number !== receiptNumber) {
      throw new Error("Verified payment receipt integrity failure");
    }
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
    await client.query("COMMIT");
    res.json(RejectManualBankTransferResponse.parse(result.rows[0]));
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
       WHERE p.id=$1 AND p.status='VERIFIED' ${authorization}`,
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
    await client.query("BEGIN");
    const invoice = await client.query(`SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2`, [invoiceId, schoolId]);
    if (!invoice.rows[0]) throw new AuthError(404, "Invoice not found");
    const result = await client.query(
      `INSERT INTO fee_adjustments (school_id,invoice_id,kind,amount_minor,reason,requested_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,school_id AS "schoolId",invoice_id AS "invoiceId",kind,amount_minor AS "amountMinor",reason,status`,
      [schoolId, invoiceId, body.kind, body.amountMinor, body.reason, context.user.id],
    );
    await audit(req, client, schoolId, "requested adjustment", "fee adjustment", result.rows[0].id, { kind: body.kind, amountMinor: body.amountMinor });
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
        a.reason,a.status,
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
      res.json(ApproveFeeAdjustmentResponse.parse({ id: adjustmentId, schoolId, invoiceId: adjustment.rows[0].invoice_id, kind: adjustment.rows[0].kind,
        amountMinor: adjustment.rows[0].amount_minor, reason: adjustment.rows[0].reason, status: "APPROVED" }));
      return;
    }
    if (adjustment.rows[0].status !== "PENDING") throw new AuthError(409, "Only pending adjustments can be approved");
    const invoice = await client.query(`SELECT * FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE`, [adjustment.rows[0].invoice_id, schoolId]);
    const invoiceRow = invoice.rows[0];
    if (!invoiceRow) throw new AuthError(404, "Invoice not found");
    const discount = invoiceRow.discount_minor + (adjustment.rows[0].kind === "WAIVER" ? 0 : adjustment.rows[0].amount_minor);
    const waiver = invoiceRow.waiver_minor + (adjustment.rows[0].kind === "WAIVER" ? adjustment.rows[0].amount_minor : 0);
    const total = invoiceRow.subtotal_minor - discount - waiver;
    if (total < 0 || total < invoiceRow.paid_minor) throw new AuthError(409, "Adjustment would reduce the invoice below payments already verified");
    await client.query(
      `UPDATE fee_invoices SET discount_minor=$1,waiver_minor=$2,total_minor=$3,outstanding_minor=$4,
       status=$5 WHERE id=$6 AND school_id=$7`,
      [discount, waiver, total, total - invoiceRow.paid_minor, invoiceStatus(invoiceRow.paid_minor, total), invoiceRow.id, schoolId],
    );
    const updated = await client.query(
      `UPDATE fee_adjustments SET status='APPROVED',approved_by=$1,approved_at=NOW()
       WHERE id=$2 AND school_id=$3 RETURNING id,school_id AS "schoolId",invoice_id AS "invoiceId",
       kind,amount_minor AS "amountMinor",reason,status`,
      [context.user.id, adjustmentId, schoolId],
    );
    await audit(req, client, schoolId, "approved adjustment", "fee adjustment", adjustmentId, { kind: adjustment.rows[0].kind });
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
       COALESCE(SUM(paid_minor),0)::int AS "totalCollectedMinor",
       COALESCE(SUM(outstanding_minor),0)::int AS "totalOutstandingMinor",
       (SELECT COUNT(*)::int FROM fee_payments WHERE school_id=$1 AND status='PENDING') AS "pendingPayments"
       FROM fee_invoices WHERE school_id=$1 AND status <> 'CANCELLED'`,
      [schoolId],
    );
    res.json(GetSchoolFinanceSummaryResponse.parse(result.rows[0]));
  } catch (error) { fail(res, error); }
});

router.post("/school/finance/payments/providers/:provider/initialize", async (req, res): Promise<void> => {
  try {
    parsed(InitializeFeeProviderPaymentParams, req.params);
    const schoolId = schoolIdForMutation(req, InitializeFeeProviderPaymentQueryParams, schoolRoles);
    parsed(InitializeFeeProviderPaymentBody, req.body);
    res.status(503).json({ error: "Online payment provider is unavailable: credentials and verified provider integration are not configured" });
  } catch (error) { fail(res, error); }
});

export default router;