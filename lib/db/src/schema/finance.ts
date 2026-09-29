import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { academicSessions, academicTerms, appUsers, schools, schoolClasses, students } from "./edupulse";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feeSchoolSettings = pgTable("fee_school_settings", {
  schoolId: integer("school_id").primaryKey().references(() => schools.id),
  partialPaymentsEnabled: boolean("partial_payments_enabled").notNull().default(false),
  bankTransferEnabled: boolean("bank_transfer_enabled").notNull().default(false),
  paystackEnabled: boolean("paystack_enabled").notNull().default(false),
  flutterwaveEnabled: boolean("flutterwave_enabled").notNull().default(false),
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  updatedBy: integer("updated_by").references(() => appUsers.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("fee_school_settings_bank_account_fields_check", sql`
    (${t.bankName} IS NULL OR COALESCE(LENGTH(BTRIM(${t.bankName})), 0) BETWEEN 2 AND 100)
    AND (${t.bankAccountName} IS NULL OR COALESCE(LENGTH(BTRIM(${t.bankAccountName})), 0) BETWEEN 2 AND 150)
    AND (${t.bankAccountNumber} IS NULL OR ${t.bankAccountNumber} ~ '^[0-9]{10}$')
    AND (NOT ${t.bankTransferEnabled} OR (
      ${t.bankName} IS NOT NULL AND ${t.bankAccountName} IS NOT NULL AND ${t.bankAccountNumber} IS NOT NULL
    ))
  `),
]);

export const feeCategories = pgTable("fee_categories", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  name: text("name").notNull(),
  description: text("description"),
  compulsory: boolean("compulsory").notNull().default(false),
  status: text("status").notNull().default("ACTIVE"),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_categories_id_school_unique").on(t.id, t.schoolId),
  unique("fee_categories_school_name_unique").on(t.schoolId, t.name),
  check("fee_categories_status_check", sql`${t.status} IN ('ACTIVE','INACTIVE')`),
  index("fee_categories_school_status_idx").on(t.schoolId, t.status),
]);

export const feeStructures = pgTable("fee_structures", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  academicSessionId: integer("academic_session_id").notNull(),
  academicTermId: integer("academic_term_id").notNull(),
  schoolClassId: integer("school_class_id").notNull(),
  section: text("section"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  publishedBy: integer("published_by").references(() => appUsers.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_structures_id_school_unique").on(t.id, t.schoolId),
  uniqueIndex("fee_structures_version_context_unique").on(
    t.schoolId, t.academicSessionId, t.academicTermId, t.schoolClassId,
    sql`COALESCE(${t.section}, '')`, t.version,
  ),
  foreignKey({ columns: [t.academicSessionId, t.schoolId], foreignColumns: [academicSessions.id, academicSessions.schoolId], name: "fee_structures_session_school_fk" }),
  foreignKey({ columns: [t.academicTermId, t.schoolId], foreignColumns: [academicTerms.id, academicTerms.schoolId], name: "fee_structures_term_school_fk" }),
  foreignKey({ columns: [t.schoolClassId, t.schoolId], foreignColumns: [schoolClasses.id, schoolClasses.schoolId], name: "fee_structures_class_school_fk" }),
  check("fee_structures_status_check", sql`${t.status} IN ('DRAFT','PUBLISHED','INACTIVE')`),
  index("fee_structures_school_context_idx").on(t.schoolId, t.academicSessionId, t.academicTermId, t.schoolClassId),
]);

export const feeStructureLines = pgTable("fee_structure_lines", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  structureId: integer("structure_id").notNull(),
  categoryId: integer("category_id").notNull(),
  categoryNameSnapshot: text("category_name_snapshot").notNull(),
  descriptionSnapshot: text("description_snapshot").notNull(),
  amountMinor: integer("amount_minor").notNull(),
}, (t) => [
  unique("fee_structure_lines_id_school_unique").on(t.id, t.schoolId),
  foreignKey({ columns: [t.structureId, t.schoolId], foreignColumns: [feeStructures.id, feeStructures.schoolId], name: "fee_structure_lines_structure_school_fk" }),
  foreignKey({ columns: [t.categoryId, t.schoolId], foreignColumns: [feeCategories.id, feeCategories.schoolId], name: "fee_structure_lines_category_school_fk" }),
  check("fee_structure_lines_amount_check", sql`${t.amountMinor} > 0`),
  unique("fee_structure_lines_structure_category_unique").on(t.structureId, t.categoryId),
]);

export const feeInvoices = pgTable("fee_invoices", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  studentId: integer("student_id").notNull(),
  parentId: integer("parent_id"),
  structureId: integer("structure_id"),
  academicSessionId: integer("academic_session_id").notNull(),
  academicTermId: integer("academic_term_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  studentNameSnapshot: text("student_name_snapshot").notNull(),
  admissionNoSnapshot: text("admission_no_snapshot").notNull(),
  classNameSnapshot: text("class_name_snapshot").notNull(),
  sectionSnapshot: text("section_snapshot").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  subtotalMinor: integer("subtotal_minor").notNull(),
  discountMinor: integer("discount_minor").notNull().default(0),
  waiverMinor: integer("waiver_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  paidMinor: integer("paid_minor").notNull().default(0),
  outstandingMinor: integer("outstanding_minor").notNull(),
  status: text("status").notNull().default("UNPAID"),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_invoices_id_school_unique").on(t.id, t.schoolId),
  unique("fee_invoices_school_number_unique").on(t.schoolId, t.invoiceNumber),
  foreignKey({ columns: [t.studentId, t.schoolId], foreignColumns: [students.id, students.schoolId], name: "fee_invoices_student_school_fk" }),
  foreignKey({ columns: [t.structureId, t.schoolId], foreignColumns: [feeStructures.id, feeStructures.schoolId], name: "fee_invoices_structure_school_fk" }),
  foreignKey({ columns: [t.academicSessionId, t.schoolId], foreignColumns: [academicSessions.id, academicSessions.schoolId], name: "fee_invoices_session_school_fk" }),
  foreignKey({ columns: [t.academicTermId, t.schoolId], foreignColumns: [academicTerms.id, academicTerms.schoolId], name: "fee_invoices_term_school_fk" }),
  unique("fee_invoices_assignment_unique").on(t.schoolId, t.studentId, t.structureId),
  check(
    "fee_invoices_amounts_check",
    sql`${t.subtotalMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.waiverMinor} >= 0
      AND ${t.discountMinor} + ${t.waiverMinor} <= ${t.subtotalMinor}
      AND ${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} - ${t.waiverMinor}
      AND ${t.paidMinor} >= 0 AND ${t.paidMinor} <= ${t.totalMinor}
      AND ${t.outstandingMinor} = ${t.totalMinor} - ${t.paidMinor}`,
  ),
  check("fee_invoices_status_check", sql`${t.status} IN ('UNPAID','PARTIALLY_PAID','PAID','OVERDUE','WAIVED','CANCELLED')`),
  index("fee_invoices_school_student_idx").on(t.schoolId, t.studentId, t.academicSessionId, t.academicTermId),
]);

export const feeInvoiceLines = pgTable("fee_invoice_lines", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  invoiceId: integer("invoice_id").notNull(),
  categoryId: integer("category_id"),
  categoryNameSnapshot: text("category_name_snapshot").notNull(),
  descriptionSnapshot: text("description_snapshot").notNull(),
  amountMinor: integer("amount_minor").notNull(),
}, (t) => [
  unique("fee_invoice_lines_id_school_unique").on(t.id, t.schoolId),
  foreignKey({ columns: [t.invoiceId, t.schoolId], foreignColumns: [feeInvoices.id, feeInvoices.schoolId], name: "fee_invoice_lines_invoice_school_fk" }),
  foreignKey({ columns: [t.categoryId, t.schoolId], foreignColumns: [feeCategories.id, feeCategories.schoolId], name: "fee_invoice_lines_category_school_fk" }),
  check("fee_invoice_lines_amount_check", sql`${t.amountMinor} >= 0`),
  index("fee_invoice_lines_invoice_idx").on(t.schoolId, t.invoiceId),
]);

export const feeAdjustments = pgTable("fee_adjustments", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  invoiceId: integer("invoice_id").notNull(),
  kind: text("kind").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  requestedPercentage: numeric("requested_percentage", { precision: 5, scale: 2 }),
  approvedAmountMinor: integer("approved_amount_minor"),
  originalBalanceMinor: integer("original_balance_minor"),
  resultingBalanceMinor: integer("resulting_balance_minor"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("PENDING"),
  requestedBy: integer("requested_by").notNull().references(() => appUsers.id),
  approvedBy: integer("approved_by").references(() => appUsers.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_adjustments_id_school_unique").on(t.id, t.schoolId),
  foreignKey({ columns: [t.invoiceId, t.schoolId], foreignColumns: [feeInvoices.id, feeInvoices.schoolId], name: "fee_adjustments_invoice_school_fk" }),
  check("fee_adjustments_kind_check", sql`${t.kind} IN ('DISCOUNT','SCHOLARSHIP','WAIVER')`),
  check("fee_adjustments_status_check", sql`${t.status} IN ('PENDING','APPROVED','REJECTED')`),
  check("fee_adjustments_amount_check", sql`${t.amountMinor} > 0`),
  check("fee_adjustments_percentage_check", sql`${t.requestedPercentage} IS NULL OR ${t.requestedPercentage}::numeric > 0 AND ${t.requestedPercentage}::numeric <= 100`),
  check("fee_adjustments_approved_amount_check", sql`${t.approvedAmountMinor} IS NULL OR ${t.approvedAmountMinor} > 0`),
  check("fee_adjustments_balance_check", sql`${t.originalBalanceMinor} IS NULL OR ${t.originalBalanceMinor} >= 0`),
  check("fee_adjustments_resulting_balance_check", sql`${t.resultingBalanceMinor} IS NULL OR ${t.resultingBalanceMinor} >= 0`),
  index("fee_adjustments_invoice_idx").on(t.schoolId, t.invoiceId, t.status),
]);

export const feePayments = pgTable("fee_payments", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  invoiceId: integer("invoice_id").notNull(),
  studentId: integer("student_id").notNull(),
  parentId: integer("parent_id"),
  reference: text("reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("NGN"),
  method: text("method").notNull(),
  provider: text("provider").notNull().default("MANUAL_BANK_TRANSFER"),
  providerTransactionId: text("provider_transaction_id"),
  status: text("status").notNull().default("PENDING"),
  transferBank: text("transfer_bank"),
  transferReference: text("transfer_reference"),
  transferDate: date("transfer_date", { mode: "string" }),
  proofUrl: text("proof_url"),
  submittedBy: integer("submitted_by").notNull().references(() => appUsers.id),
  verifiedBy: integer("verified_by").references(() => appUsers.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationEvidenceRef: text("verification_evidence_ref"),
  reviewerNotes: text("reviewer_notes"),
  verificationMetadata: jsonb("verification_metadata"),
  rejectionReason: text("rejection_reason"),
  providerMetadata: jsonb("provider_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_payments_id_school_unique").on(t.id, t.schoolId),
  unique("fee_payments_reference_unique").on(t.reference),
  unique("fee_payments_school_idempotency_unique").on(t.schoolId, t.idempotencyKey),
  unique("fee_payments_id_invoice_school_unique").on(t.id, t.invoiceId, t.schoolId),
  unique("fee_payments_provider_tx_unique").on(t.provider, t.providerTransactionId),
  uniqueIndex("fee_payments_school_bank_transfer_ref_unique")
    .on(t.schoolId, sql`LOWER(BTRIM(${t.transferBank}))`, sql`LOWER(BTRIM(${t.transferReference}))`)
    .where(sql`${t.method} = 'BANK_TRANSFER' AND NULLIF(BTRIM(${t.transferBank}), '') IS NOT NULL
      AND NULLIF(BTRIM(${t.transferReference}), '') IS NOT NULL`),
  uniqueIndex("fee_payments_school_verified_evidence_ref_unique")
    .on(t.schoolId, sql`LOWER(BTRIM(${t.verificationEvidenceRef}))`)
    .where(sql`${t.method} = 'BANK_TRANSFER' AND ${t.status} = 'VERIFIED'
      AND NULLIF(BTRIM(${t.verificationEvidenceRef}), '') IS NOT NULL`),
  foreignKey({ columns: [t.invoiceId, t.schoolId], foreignColumns: [feeInvoices.id, feeInvoices.schoolId], name: "fee_payments_invoice_school_fk" }),
  foreignKey({ columns: [t.studentId, t.schoolId], foreignColumns: [students.id, students.schoolId], name: "fee_payments_student_school_fk" }),
  check("fee_payments_amount_currency_check", sql`${t.amountMinor} > 0 AND ${t.currency} ~ '^[A-Z]{3}$'`),
  check("fee_payments_method_check", sql`${t.method} IN ('BANK_TRANSFER','REMITA','FLUTTERWAVE','PAYSTACK')`),
  check("fee_payments_status_check", sql`${t.status} IN ('PENDING','PROCESSING','VERIFIED','FAILED','REJECTED','CANCELLED','REVERSED','REFUNDED')`),
  check(
    "fee_payments_verified_evidence_check",
    sql`(${t.method} <> 'BANK_TRANSFER' OR ${t.status} <> 'VERIFIED' OR
      (${t.verifiedBy} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL
       AND NULLIF(BTRIM(${t.verificationEvidenceRef}), '') IS NOT NULL
       AND NULLIF(BTRIM(${t.reviewerNotes}), '') IS NOT NULL
       AND ${t.verificationMetadata} IS NOT NULL))`,
  ),
  check(
    "fee_payments_bank_transfer_details_check",
    sql`${t.method} <> 'BANK_TRANSFER' OR
      (COALESCE(LENGTH(BTRIM(${t.transferBank})), 0) >= 2
       AND COALESCE(LENGTH(BTRIM(${t.transferReference})), 0) >= 2
       AND ${t.transferDate} IS NOT NULL)`,
  ),
  check(
    "fee_payments_verification_evidence_length_check",
    sql`${t.method} <> 'BANK_TRANSFER' OR ${t.status} <> 'VERIFIED' OR
      (LENGTH(BTRIM(${t.verificationEvidenceRef})) >= 3
       AND LENGTH(BTRIM(${t.reviewerNotes})) >= 3)`,
  ),
  check(
    "fee_payments_rejection_reason_check",
    sql`${t.status} <> 'REJECTED' OR NULLIF(BTRIM(${t.rejectionReason}), '') IS NOT NULL`,
  ),
  index("fee_payments_school_status_idx").on(t.schoolId, t.status, t.createdAt),
]);

export const feeReceipts = pgTable("fee_receipts", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_receipts_payment_unique").on(t.paymentId),
  unique("fee_receipts_school_number_unique").on(t.schoolId, t.receiptNumber),
  foreignKey({ columns: [t.paymentId, t.schoolId], foreignColumns: [feePayments.id, feePayments.schoolId], name: "fee_receipts_payment_school_fk" }),
  foreignKey({
    columns: [t.paymentId, t.invoiceId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.invoiceId, feePayments.schoolId],
    name: "fee_receipts_payment_invoice_school_fk",
  }),
]);

export const feeRefunds = pgTable("fee_refunds", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  transactionType: text("transaction_type").notNull().default("REFUND"),
  reference: text("reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("PENDING"),
  requestedBy: integer("requested_by").notNull().references(() => appUsers.id),
  approvedBy: integer("approved_by").references(() => appUsers.id),
  evidenceReference: text("evidence_reference"),
  reviewerNotes: text("reviewer_notes"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_refunds_id_school_unique").on(t.id, t.schoolId),
  unique("fee_refunds_reference_unique").on(t.reference),
  unique("fee_refunds_school_idempotency_unique").on(t.schoolId, t.idempotencyKey),
  uniqueIndex("fee_refunds_school_evidence_unique")
    .on(t.schoolId, sql`LOWER(BTRIM(${t.evidenceReference}))`)
    .where(sql`${t.status}='APPROVED' AND NULLIF(BTRIM(${t.evidenceReference}), '') IS NOT NULL`),
  foreignKey({
    columns: [t.paymentId, t.invoiceId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.invoiceId, feePayments.schoolId],
    name: "fee_refunds_payment_invoice_school_fk",
  }),
  check("fee_refunds_amount_check", sql`${t.amountMinor} > 0 AND ${t.currency} ~ '^[A-Z]{3}$'`),
  check("fee_refunds_status_check", sql`${t.status} IN ('PENDING','APPROVED','REJECTED')`),
  check("fee_refunds_transaction_type_check", sql`${t.transactionType} IN ('REFUND','REVERSAL')`),
  check("fee_refunds_approval_evidence_check", sql`${t.status} <> 'APPROVED' OR (
    ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL
    AND NULLIF(BTRIM(${t.evidenceReference}), '') IS NOT NULL
    AND NULLIF(BTRIM(${t.reviewerNotes}), '') IS NOT NULL
  )`),
  index("fee_refunds_school_status_idx").on(t.schoolId, t.status, t.createdAt),
]);

export const feeProviderCheckoutSessions = pgTable("fee_provider_checkout_sessions", {
  paymentId: integer("payment_id").primaryKey(),
  schoolId: integer("school_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  provider: text("provider").notNull(),
  reference: text("reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  state: text("state").notNull().default("INITIALIZING"),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  checkoutUrl: text("checkout_url"),
  providerSessionMetadata: jsonb("provider_session_metadata").notNull().default({}),
  attemptCount: integer("attempt_count").notNull().default(1),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_provider_checkout_sessions_reference_unique").on(t.reference),
  unique("fee_provider_checkout_sessions_school_provider_idem_unique").on(t.schoolId, t.provider, t.idempotencyKey),
  uniqueIndex("fee_provider_checkout_sessions_one_open_invoice_unique")
    .on(t.schoolId, t.invoiceId)
    .where(sql`${t.state} IN ('INITIALIZING','READY','FAILED')`),
  foreignKey({
    columns: [t.paymentId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.schoolId],
    name: "fee_provider_checkout_sessions_payment_school_fk",
  }),
  foreignKey({
    columns: [t.invoiceId, t.schoolId],
    foreignColumns: [feeInvoices.id, feeInvoices.schoolId],
    name: "fee_provider_checkout_sessions_invoice_school_fk",
  }),
  check("fee_provider_checkout_sessions_provider_check", sql`${t.provider} IN ('PAYSTACK','FLUTTERWAVE')`),
  check("fee_provider_checkout_sessions_state_check", sql`${t.state} IN ('INITIALIZING','READY','FAILED','SETTLED','RELEASED')`),
  check("fee_provider_checkout_sessions_attempts_check", sql`${t.attemptCount} > 0`),
  check(
    "fee_provider_checkout_sessions_claim_pair_check",
    sql`(${t.claimToken} IS NULL) = (${t.claimExpiresAt} IS NULL)`,
  ),
  check("fee_provider_checkout_sessions_ready_url_check", sql`${t.state} <> 'READY' OR ${t.checkoutUrl} IS NOT NULL`),
]);

export const feeProviderWebhookEvents = pgTable("fee_provider_webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  paymentId: integer("payment_id"),
  schoolId: integer("school_id").references(() => schools.id),
  providerReference: text("provider_reference"),
  webhookTransactionId: text("webhook_transaction_id"),
  verifiedTransactionId: text("verified_transaction_id"),
  status: text("status").notNull().default("RECEIVED"),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  payloadSha256: text("payload_sha256").notNull(),
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  unique("fee_provider_webhook_events_provider_event_unique").on(t.provider, t.eventId),
  foreignKey({
    columns: [t.paymentId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.schoolId],
    name: "fee_provider_webhook_events_payment_school_fk",
  }),
  check("fee_provider_webhook_events_provider_check", sql`${t.provider} IN ('PAYSTACK','FLUTTERWAVE')`),
  check(
    "fee_provider_webhook_events_status_check",
    sql`${t.status} IN ('RECEIVED','VERIFIED','PENDING','FAILED','RECONCILIATION_REQUIRED')`,
  ),
  check(
    "fee_provider_webhook_events_signature_link_check",
    sql`${t.paymentId} IS NULL OR (
      ${t.schoolId} IS NOT NULL AND (${t.signatureVerified} OR ${t.verifiedTransactionId} IS NOT NULL)
    )`,
  ),
  index("fee_provider_webhook_events_school_status_idx").on(t.schoolId, t.status, t.receivedAt),
  index("fee_provider_webhook_events_reference_idx").on(t.provider, t.providerReference, t.receivedAt),
]);

export const feePaymentNotifications = pgTable("fee_payment_notifications", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  eventReferenceId: integer("event_reference_id").notNull().default(0),
  recipientUserId: integer("recipient_user_id").notNull().references(() => appUsers.id),
  recipientRole: text("recipient_role").notNull(),
  eventType: text("event_type").notNull().default("PAYMENT_VERIFIED"),
  channel: text("channel").notNull().default("IN_APP"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_payment_notifications_id_school_unique").on(t.id, t.schoolId),
  unique("fee_payment_notifications_delivery_unique")
    .on(t.paymentId, t.recipientUserId, t.recipientRole, t.eventType, t.eventReferenceId),
  foreignKey({
    columns: [t.paymentId, t.invoiceId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.invoiceId, feePayments.schoolId],
    name: "fee_payment_notifications_payment_invoice_school_fk",
  }),
  check("fee_payment_notifications_role_check", sql`${t.recipientRole} IN ('PARENT','STUDENT','SCHOOL_ADMIN','ACCOUNTANT')`),
  check("fee_payment_notifications_event_check", sql`${t.eventType} IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED','REFUND_APPROVED','REVERSAL_APPROVED')`),
  check("fee_payment_notifications_event_reference_check", sql`
    (${t.eventType} IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED') AND ${t.eventReferenceId}=0)
    OR (${t.eventType} IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND ${t.eventReferenceId}>0)
  `),
  check("fee_payment_notifications_channel_check", sql`${t.channel} = 'IN_APP'`),
  check("fee_payment_notifications_read_check", sql`(${t.isRead} = false AND ${t.readAt} IS NULL) OR (${t.isRead} = true AND ${t.readAt} IS NOT NULL)`),
  index("fee_payment_notifications_recipient_idx").on(t.recipientUserId, t.isRead, t.createdAt),
  index("fee_payment_notifications_school_idx").on(t.schoolId, t.createdAt),
]);

export const feePaymentNotificationOutbox = pgTable("fee_payment_notification_outbox", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  eventType: text("event_type").notNull(),
  eventReferenceId: integer("event_reference_id").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("fee_payment_notification_outbox_delivery_unique").on(t.paymentId, t.eventType, t.eventReferenceId),
  foreignKey({
    columns: [t.paymentId, t.invoiceId, t.schoolId],
    foreignColumns: [feePayments.id, feePayments.invoiceId, feePayments.schoolId],
    name: "fee_payment_notification_outbox_payment_invoice_school_fk",
  }),
  check("fee_payment_notification_outbox_event_check", sql`
    (${t.eventType} IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED') AND ${t.eventReferenceId}=0)
    OR (${t.eventType} IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND ${t.eventReferenceId}>0)
  `),
  index("fee_payment_notification_outbox_retry_idx").on(t.schoolId, t.nextAttemptAt, t.createdAt),
]);

export const insertFeeCategorySchema = createInsertSchema(feeCategories).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeeCategory = z.infer<typeof insertFeeCategorySchema>;
export type FeeCategory = typeof feeCategories.$inferSelect;
export type FeeStructure = typeof feeStructures.$inferSelect;
export type FeeInvoice = typeof feeInvoices.$inferSelect;
export type FeePayment = typeof feePayments.$inferSelect;