import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { appUsers, employees, platformCompanyEmployees, schools } from "./edupulse";

/**
 * Bank account values in these profiles are AES-256-GCM ciphertext. Application
 * responses select the display metadata and account_last4 only; they never
 * return any of the encrypted columns.
 */
export const settlementPayrollProfiles = pgTable("settlement_payroll_profiles", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "restrict" }),
  businessName: text("business_name").notNull(),
  businessRegistrationNumber: text("business_registration_number"),
  settlementContactEmail: text("settlement_contact_email").notNull(),
  settlementContactPhone: text("settlement_contact_phone"),
  bankNameEncrypted: text("bank_name_encrypted").notNull(),
  bankCodeEncrypted: text("bank_code_encrypted").notNull(),
  accountNameEncrypted: text("account_name_encrypted").notNull(),
  accountNumberEncrypted: text("account_number_encrypted").notNull(),
  accountLast4: text("account_last4").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull(),
  currency: text("currency").notNull().default("NGN"),
  provider: text("provider").notNull().default("FLUTTERWAVE"),
  providerBusinessId: text("provider_business_id"),
  providerSubaccountId: text("provider_subaccount_id"),
  verificationStatus: text("verification_status").notNull().default("PENDING_VERIFICATION"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: integer("verified_by").references(() => appUsers.id, { onDelete: "restrict" }),
  createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  updatedBy: integer("updated_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("settlement_payroll_profiles_id_scope_school_unique").on(t.id, t.scope, t.schoolId),
  check("settlement_payroll_profiles_tenant_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)`),
  check("settlement_payroll_profiles_currency_check", sql`${t.currency}='NGN'`),
  check("settlement_payroll_profiles_provider_check", sql`${t.provider}='FLUTTERWAVE'`),
  check("settlement_payroll_profiles_account_last4_check", sql`${t.accountLast4} ~ '^[0-9]{4}$'`),
  check("settlement_payroll_profiles_encrypted_fields_check", sql`
    NULLIF(BTRIM(${t.bankNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.bankCodeEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNumberEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.encryptionKeyVersion}),'') IS NOT NULL`),
  check("settlement_payroll_profiles_verification_check", sql`
    (${t.verificationStatus}='VERIFIED' AND ${t.verifiedAt} IS NOT NULL AND ${t.verifiedBy} IS NOT NULL)
    OR (${t.verificationStatus}<>'VERIFIED' AND ${t.verifiedAt} IS NULL AND ${t.verifiedBy} IS NULL)`),
  uniqueIndex("settlement_payroll_profiles_school_unique").on(t.schoolId).where(sql`${t.scope}='SCHOOL'`),
  uniqueIndex("settlement_payroll_profiles_company_unique")
    .on(t.scope).where(sql`${t.scope}='YEMAIT_COMPANY'`),
  index("settlement_payroll_profiles_verification_idx").on(t.verificationStatus, t.updatedAt),
]);

/**
 * A salary profile binds to exactly one *existing* school employee or one
 * existing Platform Company employee. Payroll operations never duplicate an
 * employee directory or decrypt a bank value to render a list.
 */
export const payrollEmployeeProfiles = pgTable("payroll_employee_profiles", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "restrict" }),
  employeeId: integer("employee_id"),
  companyEmployeeId: integer("company_employee_id")
    .references(() => platformCompanyEmployees.id, { onDelete: "restrict" }),
  monthlySalaryMinor: integer("monthly_salary_minor").notNull(),
  allowanceMinor: integer("allowance_minor").notNull().default(0),
  deductionMinor: integer("deduction_minor").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  bankNameEncrypted: text("bank_name_encrypted").notNull(),
  bankCodeEncrypted: text("bank_code_encrypted").notNull(),
  accountNameEncrypted: text("account_name_encrypted").notNull(),
  accountNumberEncrypted: text("account_number_encrypted").notNull(),
  accountLast4: text("account_last4").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  updatedBy: integer("updated_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payroll_employee_profiles_id_scope_school_unique").on(t.id, t.scope, t.schoolId),
  check("payroll_employee_profiles_tenant_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL AND ${t.employeeId} IS NOT NULL AND ${t.companyEmployeeId} IS NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL AND ${t.employeeId} IS NULL
      AND ${t.companyEmployeeId} IS NOT NULL)`),
  check("payroll_employee_profiles_salary_check", sql`
    ${t.monthlySalaryMinor} >= 0 AND ${t.allowanceMinor} >= 0 AND ${t.deductionMinor} >= 0
    AND ${t.deductionMinor} <= ${t.monthlySalaryMinor} + ${t.allowanceMinor}`),
  check("payroll_employee_profiles_currency_check", sql`${t.currency}='NGN'`),
  check("payroll_employee_profiles_account_last4_check", sql`${t.accountLast4} ~ '^[0-9]{4}$'`),
  check("payroll_employee_profiles_encrypted_fields_check", sql`
    NULLIF(BTRIM(${t.bankNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.bankCodeEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNumberEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.encryptionKeyVersion}),'') IS NOT NULL`),
  foreignKey({
    columns: [t.employeeId, t.schoolId],
    foreignColumns: [employees.id, employees.schoolId],
    name: "payroll_employee_profiles_employee_school_fk",
  }).onDelete("restrict"),
  uniqueIndex("payroll_employee_profiles_school_employee_unique")
    .on(t.schoolId, t.employeeId)
    .where(sql`${t.scope}='SCHOOL'`),
  uniqueIndex("payroll_employee_profiles_company_employee_unique")
    .on(t.companyEmployeeId)
    .where(sql`${t.scope}='YEMAIT_COMPANY'`),
  index("payroll_employee_profiles_school_status_idx").on(t.schoolId, t.status, t.updatedAt),
  index("payroll_employee_profiles_company_status_idx").on(t.companyEmployeeId, t.status),
]);

export const payrollPeriods = pgTable("payroll_periods", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "restrict" }),
  periodMonth: text("period_month").notNull(),
  status: text("status").notNull().default("DRAFT"),
  employeeCount: integer("employee_count").notNull(),
  grossSalaryMinor: integer("gross_salary_minor").notNull(),
  allowanceMinor: integer("allowance_minor").notNull(),
  bonusMinor: integer("bonus_minor").notNull().default(0),
  deductionMinor: integer("deduction_minor").notNull(),
  adjustmentMinor: integer("adjustment_minor").notNull().default(0),
  netSalaryMinor: integer("net_salary_minor").notNull(),
  createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  submittedBy: integer("submitted_by").references(() => appUsers.id, { onDelete: "restrict" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: integer("approved_by").references(() => appUsers.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payroll_periods_id_scope_school_unique").on(t.id, t.scope, t.schoolId),
  check("payroll_periods_tenant_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)`),
  check("payroll_periods_month_check", sql`${t.periodMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("payroll_periods_status_check", sql`${t.status} IN (
    'DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED','FAILED','CANCELLED')`),
  check("payroll_periods_totals_check", sql`
    ${t.employeeCount} > 0 AND ${t.grossSalaryMinor} >= 0 AND ${t.allowanceMinor} >= 0
    AND ${t.bonusMinor} >= 0 AND ${t.deductionMinor} >= 0 AND ${t.netSalaryMinor} >= 0
    AND ${t.grossSalaryMinor} + ${t.allowanceMinor} + ${t.bonusMinor} + ${t.adjustmentMinor} >= ${t.deductionMinor}
    AND ${t.netSalaryMinor} = ${t.grossSalaryMinor} + ${t.allowanceMinor} + ${t.bonusMinor}
      + ${t.adjustmentMinor} - ${t.deductionMinor}`),
  check("payroll_periods_submit_state_check", sql`
    (${t.status} IN ('DRAFT','FAILED','CANCELLED') AND ${t.submittedAt} IS NULL)
    OR (${t.status} NOT IN ('DRAFT','FAILED','CANCELLED') AND ${t.submittedAt} IS NOT NULL AND ${t.submittedBy} IS NOT NULL)`),
  check("payroll_periods_approval_state_check", sql`
    (${t.status} NOT IN ('APPROVED','PROCESSING','COMPLETED','PARTIALLY_COMPLETED')
       OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL))`),
  uniqueIndex("payroll_periods_school_month_unique").on(t.schoolId, t.periodMonth).where(sql`${t.scope}='SCHOOL'`),
  uniqueIndex("payroll_periods_company_month_unique").on(t.scope, t.periodMonth).where(sql`${t.scope}='YEMAIT_COMPANY'`),
  index("payroll_periods_school_status_month_idx").on(t.schoolId, t.status, t.periodMonth),
  index("payroll_periods_company_status_month_idx").on(t.scope, t.status, t.periodMonth),
]);

export const payrollItems = pgTable("payroll_items", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id"),
  periodId: integer("period_id").notNull(),
  employeeProfileId: integer("employee_profile_id").notNull(),
  periodMonth: text("period_month").notNull(),
  employeeNameSnapshot: text("employee_name_snapshot").notNull(),
  employeeNumberSnapshot: text("employee_number_snapshot"),
  roleSnapshot: text("role_snapshot").notNull(),
  baseSalaryMinor: integer("base_salary_minor").notNull(),
  allowanceMinor: integer("allowance_minor").notNull().default(0),
  bonusMinor: integer("bonus_minor").notNull().default(0),
  deductionMinor: integer("deduction_minor").notNull().default(0),
  adjustmentMinor: integer("adjustment_minor").notNull().default(0),
  adjustmentReason: text("adjustment_reason"),
  netSalaryMinor: integer("net_salary_minor").notNull(),
  currency: text("currency").notNull().default("NGN"),
  bankNameEncrypted: text("bank_name_encrypted").notNull(),
  bankCodeEncrypted: text("bank_code_encrypted").notNull(),
  accountNameEncrypted: text("account_name_encrypted").notNull(),
  accountNumberEncrypted: text("account_number_encrypted").notNull(),
  accountLast4: text("account_last4").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payroll_items_id_period_unique").on(t.id, t.periodId),
  check("payroll_items_tenant_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)`),
  check("payroll_items_amounts_check", sql`
    ${t.baseSalaryMinor} >= 0 AND ${t.allowanceMinor} >= 0 AND ${t.bonusMinor} >= 0
    AND ${t.deductionMinor} >= 0
    AND ${t.netSalaryMinor} = ${t.baseSalaryMinor}+${t.allowanceMinor}+${t.bonusMinor}
      +${t.adjustmentMinor}-${t.deductionMinor} AND ${t.netSalaryMinor} >= 0`),
  check("payroll_items_currency_check", sql`${t.currency}='NGN'`),
  check("payroll_items_bank_snapshot_check", sql`
    NULLIF(BTRIM(${t.bankNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.bankCodeEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNameEncrypted}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.accountNumberEncrypted}),'') IS NOT NULL
    AND ${t.accountLast4} ~ '^[0-9]{4}$'
    AND NULLIF(BTRIM(${t.encryptionKeyVersion}),'') IS NOT NULL`),
  check("payroll_items_role_check", sql`${t.roleSnapshot} IN ('TEACHER','STAFF','COMPANY_EMPLOYEE')`),
  check("payroll_items_adjustment_audit_check", sql`
    (${t.adjustmentMinor}=0 AND ${t.adjustmentReason} IS NULL)
    OR (${t.adjustmentMinor}<>0 AND NULLIF(BTRIM(${t.adjustmentReason}),'') IS NOT NULL)`),
  foreignKey({
    columns: [t.periodId, t.scope, t.schoolId],
    foreignColumns: [payrollPeriods.id, payrollPeriods.scope, payrollPeriods.schoolId],
    name: "payroll_items_period_scope_school_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.employeeProfileId, t.scope, t.schoolId],
    foreignColumns: [payrollEmployeeProfiles.id, payrollEmployeeProfiles.scope, payrollEmployeeProfiles.schoolId],
    name: "payroll_items_profile_scope_school_fk",
  }).onDelete("restrict"),
  uniqueIndex("payroll_items_employee_period_unique").on(t.periodId, t.employeeProfileId),
  index("payroll_items_scope_school_period_idx").on(t.scope, t.schoolId, t.periodId),
]);

/** Every outbound salary is a durable, uniquely referenced, reconciled attempt. */
export const payrollTransfers = pgTable("payroll_transfers", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id"),
  periodId: integer("period_id").notNull(),
  payrollItemId: integer("payroll_item_id").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  idempotencyKeyHash: text("idempotency_key_hash").notNull(),
  provider: text("provider").notNull(),
  providerMode: text("provider_mode").notNull(),
  providerReference: text("provider_reference").notNull(),
  providerTransactionId: text("provider_transaction_id"),
  amountMinor: integer("amount_minor").notNull(),
  providerFeeMinor: integer("provider_fee_minor").notNull().default(0),
  settlementAmountMinor: integer("settlement_amount_minor").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("CLAIMED"),
  requiresReconciliation: boolean("requires_reconciliation").notNull().default(false),
  externalTransferVerified: boolean("external_transfer_verified").notNull().default(false),
  providerStatus: text("provider_status"),
  failureMessage: text("failure_message"),
  requestedBy: integer("requested_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  verifiedBy: integer("verified_by").references(() => appUsers.id, { onDelete: "restrict" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payroll_transfers_id_scope_school_unique").on(t.id, t.scope, t.schoolId),
  check("payroll_transfers_tenant_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)`),
  check("payroll_transfers_provider_check", sql`
    (${t.provider}='FLUTTERWAVE' AND ${t.providerMode} IN ('TEST','LIVE'))
    OR (${t.provider}='MOCK' AND ${t.providerMode}='MOCK')`),
  check("payroll_transfers_status_check", sql`${t.status} IN (
    'CLAIMED','PROCESSING','PENDING','MOCK_PENDING','PAID','FAILED','UNCERTAIN','RECONCILIATION_REQUIRED')`),
  check("payroll_transfers_amount_check", sql`
    ${t.amountMinor} > 0 AND ${t.providerFeeMinor} >= 0 AND ${t.settlementAmountMinor} >= 0
    AND ${t.currency}='NGN' AND ${t.settlementAmountMinor} <= ${t.amountMinor}`),
  check("payroll_transfers_reference_check", sql`
    NULLIF(BTRIM(${t.idempotencyKeyHash}),'') IS NOT NULL
    AND NULLIF(BTRIM(${t.providerReference}),'') IS NOT NULL AND ${t.attemptNumber} > 0`),
  check("payroll_transfers_paid_verification_check", sql`
    ${t.status}<>'PAID' OR (
      ${t.provider}='FLUTTERWAVE' AND ${t.providerMode}<>'MOCK'
      AND ${t.externalTransferVerified}=true AND ${t.verifiedAt} IS NOT NULL AND ${t.verifiedBy} IS NOT NULL
      AND ${t.providerTransactionId} IS NOT NULL)`),
  check("payroll_transfers_mock_never_paid_check", sql`
    ${t.provider}<>'MOCK' OR (${t.status}='MOCK_PENDING' AND ${t.externalTransferVerified}=false)`),
  check("payroll_transfers_ambiguous_no_retry_check", sql`
    NOT ${t.requiresReconciliation} OR ${t.status} IN ('UNCERTAIN','RECONCILIATION_REQUIRED')`),
  foreignKey({
    columns: [t.payrollItemId, t.periodId],
    foreignColumns: [payrollItems.id, payrollItems.periodId],
    name: "payroll_transfers_item_period_fk",
  }).onDelete("restrict"),
  uniqueIndex("payroll_transfers_provider_reference_unique").on(t.provider, t.providerReference),
  uniqueIndex("payroll_transfers_idempotency_period_unique").on(t.periodId, t.idempotencyKeyHash),
  uniqueIndex("payroll_transfers_item_attempt_unique").on(t.payrollItemId, t.attemptNumber),
  index("payroll_transfers_scope_school_period_status_idx").on(t.scope, t.schoolId, t.periodId, t.status),
  index("payroll_transfers_provider_transaction_idx").on(t.provider, t.providerTransactionId),
]);

/** Payslips exist only for provider-verified successfully-paid frozen items. */
export const payrollPayslips = pgTable("payroll_payslips", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id"),
  periodId: integer("period_id").notNull(),
  payrollItemId: integer("payroll_item_id").notNull(),
  transferId: integer("transfer_id").notNull(),
  payslipNumber: text("payslip_number").notNull(),
  employeeNameSnapshot: text("employee_name_snapshot").notNull(),
  employeeRoleSnapshot: text("employee_role_snapshot").notNull(),
  periodMonth: text("period_month").notNull(),
  baseSalaryMinor: integer("base_salary_minor").notNull(),
  allowanceMinor: integer("allowance_minor").notNull(),
  bonusMinor: integer("bonus_minor").notNull(),
  deductionMinor: integer("deduction_minor").notNull(),
  adjustmentMinor: integer("adjustment_minor").notNull(),
  netSalaryMinor: integer("net_salary_minor").notNull(),
  currency: text("currency").notNull().default("NGN"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payroll_payslips_id_scope_school_unique").on(t.id, t.scope, t.schoolId),
  check("payroll_payslips_scope_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)`),
  check("payroll_payslips_currency_check", sql`${t.currency}='NGN'`),
  check("payroll_payslips_amounts_check", sql`
    ${t.baseSalaryMinor} >= 0 AND ${t.allowanceMinor} >= 0 AND ${t.bonusMinor} >= 0
    AND ${t.deductionMinor} >= 0 AND ${t.netSalaryMinor} > 0`),
  foreignKey({
    columns: [t.payrollItemId, t.periodId],
    foreignColumns: [payrollItems.id, payrollItems.periodId],
    name: "payroll_payslips_item_period_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.transferId, t.scope, t.schoolId],
    foreignColumns: [payrollTransfers.id, payrollTransfers.scope, payrollTransfers.schoolId],
    name: "payroll_payslips_verified_transfer_scope_fk",
  }).onDelete("restrict"),
  uniqueIndex("payroll_payslips_item_unique").on(t.payrollItemId),
  uniqueIndex("payroll_payslips_number_unique").on(t.payslipNumber),
]);

/** Immutable event-level financial audit; safe summaries only, never credentials. */
export const settlementPayrollAuditEvents = pgTable("settlement_payroll_audit_events", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  schoolId: integer("school_id").references(() => schools.id, { onDelete: "restrict" }),
  actorUserId: integer("actor_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  actorRole: text("actor_role").notNull(),
  recordType: text("record_type").notNull(),
  recordId: integer("record_id"),
  action: text("action").notNull(),
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  providerReference: text("provider_reference"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("settlement_payroll_audit_scope_check", sql`
    (${t.scope}='SCHOOL' AND ${t.schoolId} IS NOT NULL)
    OR (${t.scope}='YEMAIT_COMPANY' AND ${t.schoolId} IS NULL)
    OR (${t.scope}='PLATFORM' AND ${t.schoolId} IS NULL)`),
  check("settlement_payroll_audit_amount_check", sql`
    (${t.amountMinor} IS NULL AND ${t.currency} IS NULL)
    OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor} >= 0 AND ${t.currency}='NGN')`),
  check("settlement_payroll_audit_record_type_check", sql`${t.recordType} IN (
    'SETTLEMENT_PROFILE','PAYROLL_PROFILE','PAYROLL_PERIOD','PAYROLL_ITEM','PAYROLL_TRANSFER','PAYSLIP')`),
  index("settlement_payroll_audit_scope_timeline_idx").on(t.scope, t.schoolId, t.occurredAt, t.id),
  index("settlement_payroll_audit_record_timeline_idx").on(t.recordType, t.recordId, t.occurredAt, t.id),
  index("settlement_payroll_audit_actor_timeline_idx").on(t.actorUserId, t.occurredAt, t.id),
]);

export type SettlementPayrollProfile = typeof settlementPayrollProfiles.$inferSelect;
export type PayrollEmployeeProfile = typeof payrollEmployeeProfiles.$inferSelect;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type PayrollItem = typeof payrollItems.$inferSelect;
export type PayrollTransfer = typeof payrollTransfers.$inferSelect;
export type PayrollPayslip = typeof payrollPayslips.$inferSelect;
export type SettlementPayrollAuditEvent = typeof settlementPayrollAuditEvents.$inferSelect;