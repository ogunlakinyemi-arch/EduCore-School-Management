import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  academicSessions,
  academicTerms,
  appUsers,
  employees,
  partnerProfiles,
  schoolPartnerAttributions,
  schools,
} from "./edupulse";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Effective-dated monetary rules are deliberately append-only. A subsequent
 * price or allocation starts a new rule version; issued subscriptions keep
 * their immutable snapshot.
 */
export const staffNfcBillingRules = pgTable(
  "staff_nfc_billing_rules",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull(),
    product: text("product").notNull().default("TEACHER_STAFF_NFC_EID"),
    billingFrequency: text("billing_frequency").notNull().default("ACADEMIC_TERM"),
    priceMinor: integer("price_minor").notNull(),
    schoolShareMinor: integer("school_share_minor").notNull(),
    platformShareMinor: integer("platform_share_minor").notNull(),
    partnerCommissionMinor: integer("partner_commission_minor").notNull(),
    noPartnerPlatformShareMinor: integer("no_partner_platform_share_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("ACTIVE"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    createdBy: integer("created_by").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_nfc_billing_rules_product_version_uq").on(table.product, table.version),
    uniqueIndex("staff_nfc_billing_rules_product_effective_uq").on(table.product, table.effectiveAt),
    uniqueIndex("staff_nfc_billing_rules_id_product_uq").on(table.id, table.product),
    uniqueIndex("staff_nfc_billing_rules_id_version_uq").on(table.id, table.version),
    index("staff_nfc_billing_rules_effective_idx").on(table.product, table.effectiveAt.desc()),
    check("staff_nfc_billing_rules_product_ck", sql`${table.product} = 'TEACHER_STAFF_NFC_EID'`),
    check("staff_nfc_billing_rules_frequency_ck", sql`${table.billingFrequency} = 'ACADEMIC_TERM'`),
    check("staff_nfc_billing_rules_currency_ck", sql`${table.currency} = 'NGN'`),
    check("staff_nfc_billing_rules_status_ck", sql`${table.status} = 'ACTIVE'`),
    check(
      "staff_nfc_billing_rules_amounts_ck",
      sql`${table.priceMinor} > 0 AND ${table.schoolShareMinor} >= 0
          AND ${table.platformShareMinor} >= 0 AND ${table.partnerCommissionMinor} >= 0
          AND ${table.noPartnerPlatformShareMinor} >= 0
          AND ${table.schoolShareMinor} + ${table.platformShareMinor} + ${table.partnerCommissionMinor} = ${table.priceMinor}
          AND ${table.schoolShareMinor} + ${table.noPartnerPlatformShareMinor} = ${table.priceMinor}`,
    ),
  ],
);

/**
 * Term subscription is independent of physical card identity and attendance.
 * The partial unique payment index permits a new attempt after a verified
 * terminal failure without losing previous payment history.
 */
export const staffNfcSubscriptions = pgTable(
  "staff_nfc_subscriptions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    product: text("product").notNull().default("TEACHER_STAFF_NFC_EID"),
    billingRuleId: integer("billing_rule_id").notNull(),
    billingRuleVersion: integer("billing_rule_version").notNull(),
    priceMinor: integer("price_minor").notNull(),
    schoolShareMinor: integer("school_share_minor").notNull(),
    platformShareMinor: integer("platform_share_minor").notNull(),
    partnerShareMinor: integer("partner_share_minor").notNull(),
    partnerProfileId: integer("partner_profile_id").references(() => partnerProfiles.id, { onDelete: "restrict" }),
    attributionId: integer("attribution_id").references(() => schoolPartnerAttributions.id, { onDelete: "restrict" }),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("UNPAID"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    createdBy: integer("created_by").references(() => appUsers.id, { onDelete: "restrict" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_nfc_subscriptions_employee_term_uq").on(
      table.employeeId,
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
    ),
    uniqueIndex("staff_nfc_subscriptions_id_school_uq").on(table.id, table.schoolId),
    uniqueIndex("staff_nfc_subscriptions_id_employee_school_term_uq").on(
      table.id,
      table.employeeId,
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
    ),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "staff_nfc_subscriptions_employee_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "staff_nfc_subscriptions_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "staff_nfc_subscriptions_term_school_fk",
    }),
    foreignKey({
      columns: [table.billingRuleId, table.billingRuleVersion],
      foreignColumns: [staffNfcBillingRules.id, staffNfcBillingRules.version],
      name: "staff_nfc_subscriptions_rule_version_fk",
    }),
    check(
      "staff_nfc_subscriptions_allocation_ck",
      sql`${table.priceMinor} > 0 AND ${table.schoolShareMinor} >= 0
          AND ${table.platformShareMinor} >= 0 AND ${table.partnerShareMinor} >= 0
          AND ${table.schoolShareMinor} + ${table.platformShareMinor} + ${table.partnerShareMinor} = ${table.priceMinor}
          AND ((${table.partnerProfileId} IS NULL AND ${table.partnerShareMinor} = 0 AND ${table.attributionId} IS NULL)
            OR (${table.partnerProfileId} IS NOT NULL AND ${table.attributionId} IS NOT NULL))`,
    ),
    check(
      "staff_nfc_subscriptions_status_ck",
      sql`${table.status} IN ('UNPAID','PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')`,
    ),
    check("staff_nfc_subscriptions_currency_ck", sql`${table.currency} = 'NGN'`),
    index("staff_nfc_subscriptions_school_term_status_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.status,
    ),
    index("staff_nfc_subscriptions_partner_term_idx").on(
      table.partnerProfileId,
      table.academicSessionId,
      table.academicTermId,
    ),
  ],
);

export const staffNfcPayments = pgTable(
  "staff_nfc_payments",
  {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    schoolId: integer("school_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    provider: text("provider").notNull(),
    providerMode: text("provider_mode").notNull(),
    reference: text("reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull(),
    providerFeeMinor: integer("provider_fee_minor"),
    settlementAmountMinor: integer("settlement_amount_minor"),
    refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("PENDING"),
    settlementStatus: text("settlement_status").notNull().default("PENDING"),
    reconciliationStatus: text("reconciliation_status").notNull().default("PENDING"),
    refundStatus: text("refund_status").notNull().default("NONE"),
    checkoutUrl: text("checkout_url"),
    providerTransactionId: text("provider_transaction_id"),
    providerPaidAt: timestamp("provider_paid_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    createdBy: integer("created_by").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_nfc_payments_reference_uq").on(table.reference),
    uniqueIndex("staff_nfc_payments_provider_transaction_uq").on(table.provider, table.providerTransactionId),
    uniqueIndex("staff_nfc_payments_employee_idempotency_uq").on(table.employeeId, table.idempotencyKey),
    uniqueIndex("staff_nfc_payments_id_subscription_school_uq").on(table.id, table.subscriptionId, table.schoolId),
    uniqueIndex("staff_nfc_payments_one_pending_attempt_per_subscription_uq")
      .on(table.subscriptionId)
      .where(sql`${table.status} IN ('PENDING','RECONCILIATION_REQUIRED')`),
    foreignKey({
      columns: [table.subscriptionId, table.employeeId, table.schoolId, table.academicSessionId, table.academicTermId],
      foreignColumns: [
        staffNfcSubscriptions.id,
        staffNfcSubscriptions.employeeId,
        staffNfcSubscriptions.schoolId,
        staffNfcSubscriptions.academicSessionId,
        staffNfcSubscriptions.academicTermId,
      ],
      name: "staff_nfc_payments_subscription_owner_term_fk",
    }),
    check("staff_nfc_payments_provider_ck", sql`${table.provider} IN ('FLUTTERWAVE','MOCK')`),
    check("staff_nfc_payments_provider_mode_ck", sql`${table.providerMode} IN ('SANDBOX','DEVELOPMENT_MOCK')`),
    check(
      "staff_nfc_payments_money_ck",
      sql`${table.grossAmountMinor} > 0 AND (${table.providerFeeMinor} IS NULL OR ${table.providerFeeMinor} >= 0)
          AND (${table.settlementAmountMinor} IS NULL OR ${table.settlementAmountMinor} >= 0)
          AND ${table.refundedAmountMinor} >= 0 AND ${table.refundedAmountMinor} <= ${table.grossAmountMinor}
          AND ${table.currency} = 'NGN'`,
    ),
    check(
      "staff_nfc_payments_status_ck",
      sql`${table.status} IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED','RECONCILIATION_REQUIRED')`,
    ),
    check(
      "staff_nfc_payments_settlement_ck",
      sql`${table.settlementStatus} IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')`,
    ),
    check(
      "staff_nfc_payments_reconciliation_ck",
      sql`${table.reconciliationStatus} IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')`,
    ),
    check(
      "staff_nfc_payments_refund_ck",
      sql`${table.refundStatus} IN ('NONE','PENDING','PARTIALLY_REFUNDED','REFUNDED','RECONCILIATION_REQUIRED')`,
    ),
    index("staff_nfc_payments_school_status_idx").on(table.schoolId, table.status, table.createdAt.desc()),
    index("staff_nfc_payments_term_idx").on(table.schoolId, table.academicSessionId, table.academicTermId),
  ],
);

export const staffNfcRefunds = pgTable(
  "staff_nfc_refunds",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id").notNull(),
    schoolId: integer("school_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    providerRefundId: text("provider_refund_id"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    providerVerifiedAt: timestamp("provider_verified_at", { withTimezone: true }),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("staff_nfc_refunds_payment_idempotency_uq").on(table.paymentId, table.idempotencyKey),
    uniqueIndex("staff_nfc_refunds_provider_id_uq").on(table.providerRefundId),
    uniqueIndex("staff_nfc_refunds_id_payment_school_uq").on(table.id, table.paymentId, table.schoolId),
    foreignKey({
      columns: [table.paymentId, table.schoolId],
      foreignColumns: [staffNfcPayments.id, staffNfcPayments.schoolId],
      name: "staff_nfc_refunds_payment_school_fk",
    }),
    check("staff_nfc_refunds_amount_ck", sql`${table.amountMinor} > 0`),
    check(
      "staff_nfc_refunds_status_ck",
      sql`${table.status} IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')`,
    ),
    index("staff_nfc_refunds_school_status_idx").on(table.schoolId, table.status, table.createdAt.desc()),
    uniqueIndex("staff_nfc_refunds_one_active_per_payment_uq")
      .on(table.paymentId)
      .where(sql`${table.status} IN ('REQUESTED','PENDING','RECONCILIATION_REQUIRED')`),
  ],
);

/** Immutable accounting events. Refunds add REVERSAL rows; originals never update. */
export const staffNfcAllocations = pgTable(
  "staff_nfc_allocations",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    entryType: text("entry_type").notNull().default("CREDIT"),
    product: text("product").notNull().default("TEACHER_STAFF_NFC_EID"),
    recipientType: text("recipient_type").notNull(),
    recipientId: integer("recipient_id"),
    schoolId: integer("school_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    subscriptionId: integer("subscription_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    attributionId: integer("attribution_id").references(() => schoolPartnerAttributions.id, { onDelete: "restrict" }),
    refundId: integer("refund_id"),
    allocationRuleId: integer("allocation_rule_id").notNull(),
    billingRuleVersion: integer("billing_rule_version").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_nfc_allocations_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("staff_nfc_allocations_id_payment_type_uq").on(table.id, table.paymentId, table.recipientType),
    uniqueIndex("staff_nfc_allocations_credit_payment_type_uq")
      .on(table.paymentId, table.recipientType)
      .where(sql`${table.entryType} = 'CREDIT'`),
    foreignKey({
      columns: [
        table.subscriptionId,
        table.employeeId,
        table.schoolId,
        table.academicSessionId,
        table.academicTermId,
      ],
      foreignColumns: [
        staffNfcSubscriptions.id,
        staffNfcSubscriptions.employeeId,
        staffNfcSubscriptions.schoolId,
        staffNfcSubscriptions.academicSessionId,
        staffNfcSubscriptions.academicTermId,
      ],
      name: "staff_nfc_allocations_subscription_owner_term_fk",
    }),
    foreignKey({
      columns: [table.paymentId, table.subscriptionId, table.schoolId],
      foreignColumns: [staffNfcPayments.id, staffNfcPayments.subscriptionId, staffNfcPayments.schoolId],
      name: "staff_nfc_allocations_payment_subscription_school_fk",
    }),
    foreignKey({
      columns: [table.refundId, table.paymentId, table.schoolId],
      foreignColumns: [staffNfcRefunds.id, staffNfcRefunds.paymentId, staffNfcRefunds.schoolId],
      name: "staff_nfc_allocations_refund_payment_school_fk",
    }),
    foreignKey({
      columns: [table.allocationRuleId, table.product],
      foreignColumns: [staffNfcBillingRules.id, staffNfcBillingRules.product],
      name: "staff_nfc_allocations_rule_product_fk",
    }),
    check("staff_nfc_allocations_type_ck", sql`${table.recipientType} IN ('SCHOOL','PLATFORM','PARTNER','PLATFORM_PROVIDER_FEE')`),
    check("staff_nfc_allocations_product_ck", sql`${table.product} = 'TEACHER_STAFF_NFC_EID'`),
    check("staff_nfc_allocations_entry_ck", sql`${table.entryType} IN ('CREDIT','REVERSAL','EXPENSE')`),
    check(
      "staff_nfc_allocations_amount_ck",
      sql`${table.amountMinor} > 0 AND ${table.currency} = 'NGN'
        AND ((${table.entryType} = 'CREDIT' AND ${table.refundId} IS NULL AND ${table.recipientType} IN ('SCHOOL','PLATFORM','PARTNER'))
          OR (${table.entryType} = 'REVERSAL' AND ${table.refundId} IS NOT NULL)
          OR (${table.entryType} = 'EXPENSE' AND ${table.recipientType} = 'PLATFORM_PROVIDER_FEE' AND ${table.refundId} IS NULL))`,
    ),
    index("staff_nfc_allocations_school_term_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.createdAt.desc(),
    ),
    index("staff_nfc_allocations_partner_idx").on(table.recipientId, table.createdAt.desc())
      .where(sql`${table.recipientType} = 'PARTNER'`),
  ],
);

export const staffNfcProviderEvents = pgTable(
  "staff_nfc_provider_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("FLUTTERWAVE"),
    eventId: text("event_id").notNull(),
    providerReference: text("provider_reference").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    signatureVerified: boolean("signature_verified").notNull().default(true),
    outcome: text("outcome").notNull().default("RECEIVED"),
    paymentId: integer("payment_id"),
    schoolId: integer("school_id"),
    failureCode: text("failure_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("staff_nfc_provider_events_provider_event_uq").on(table.provider, table.eventId),
    foreignKey({
      columns: [table.paymentId, table.schoolId],
      foreignColumns: [staffNfcPayments.id, staffNfcPayments.schoolId],
      name: "staff_nfc_provider_events_payment_school_fk",
    }),
    check("staff_nfc_provider_events_provider_ck", sql`${table.provider} = 'FLUTTERWAVE'`),
    check(
      "staff_nfc_provider_events_outcome_ck",
      sql`${table.outcome} IN ('RECEIVED','VERIFIED','PENDING','FAILED','DUPLICATE','RECONCILIATION_REQUIRED','REFUND_PENDING','REFUNDED','PARTIAL_REFUND')`,
    ),
    index("staff_nfc_provider_events_payment_idx").on(table.paymentId, table.outcome),
  ],
);

export const staffNfcPartnerCommissions = pgTable(
  "staff_nfc_partner_commissions",
  {
    id: serial("id").primaryKey(),
    allocationId: integer("allocation_id").notNull().unique(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    employeeId: integer("employee_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    subscriptionId: integer("subscription_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    recipientType: text("recipient_type").notNull().default("PARTNER"),
    commissionMinor: integer("commission_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("PENDING"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_nfc_partner_commissions_subscription_uq").on(table.subscriptionId),
    foreignKey({
      columns: [
        table.subscriptionId,
        table.employeeId,
        table.schoolId,
        table.academicSessionId,
        table.academicTermId,
      ],
      foreignColumns: [
        staffNfcSubscriptions.id,
        staffNfcSubscriptions.employeeId,
        staffNfcSubscriptions.schoolId,
        staffNfcSubscriptions.academicSessionId,
        staffNfcSubscriptions.academicTermId,
      ],
      name: "staff_nfc_partner_commissions_subscription_tenant_fk",
    }),
    foreignKey({
      columns: [table.paymentId, table.subscriptionId, table.schoolId],
      foreignColumns: [staffNfcPayments.id, staffNfcPayments.subscriptionId, staffNfcPayments.schoolId],
      name: "staff_nfc_partner_commissions_payment_tenant_fk",
    }),
    foreignKey({
      columns: [table.allocationId, table.paymentId, table.recipientType],
      foreignColumns: [staffNfcAllocations.id, staffNfcAllocations.paymentId, staffNfcAllocations.recipientType],
      name: "staff_nfc_partner_commissions_allocation_fk",
    }),
    check("staff_nfc_partner_commissions_amount_ck", sql`${table.commissionMinor} > 0 AND ${table.currency} = 'NGN'`),
    check(
      "staff_nfc_partner_commissions_recipient_ck",
      sql`${table.recipientType} = 'PARTNER'`,
    ),
    check(
      "staff_nfc_partner_commissions_status_ck",
      sql`${table.status} IN ('PENDING','PAID','REVERSED')`,
    ),
    index("staff_nfc_partner_commissions_partner_idx").on(table.partnerProfileId, table.status, table.createdAt.desc()),
  ],
);

export const staffNfcReceipts = pgTable(
  "staff_nfc_receipts",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id").notNull().unique(),
    subscriptionId: integer("subscription_id").notNull(),
    schoolId: integer("school_id").notNull(),
    receiptNumber: text("receipt_number").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (table) => [
    uniqueIndex("staff_nfc_receipts_payment_owner_uq").on(
      table.paymentId,
      table.subscriptionId,
      table.schoolId,
    ),
    foreignKey({
      columns: [table.paymentId, table.subscriptionId, table.schoolId],
      foreignColumns: [staffNfcPayments.id, staffNfcPayments.subscriptionId, staffNfcPayments.schoolId],
      name: "staff_nfc_receipts_payment_owner_fk",
    }),
    index("staff_nfc_receipts_school_issue_idx").on(table.schoolId, table.issuedAt.desc()),
  ],
);

export const insertStaffNfcBillingRuleSchema = createInsertSchema(staffNfcBillingRules).omit({
  id: true,
  version: true,
  createdAt: true,
});
export const insertStaffNfcSubscriptionSchema = createInsertSchema(staffNfcSubscriptions).omit({
  id: true,
  paidAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertStaffNfcPaymentSchema = createInsertSchema(staffNfcPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StaffNfcBillingRule = typeof staffNfcBillingRules.$inferSelect;
export type InsertStaffNfcBillingRule = z.infer<typeof insertStaffNfcBillingRuleSchema>;
export type StaffNfcSubscription = typeof staffNfcSubscriptions.$inferSelect;
export type InsertStaffNfcSubscription = z.infer<typeof insertStaffNfcSubscriptionSchema>;
export type StaffNfcPayment = typeof staffNfcPayments.$inferSelect;
export type InsertStaffNfcPayment = z.infer<typeof insertStaffNfcPaymentSchema>;
export type StaffNfcAllocation = typeof staffNfcAllocations.$inferSelect;
export type StaffNfcRefund = typeof staffNfcRefunds.$inferSelect;
export type StaffNfcPartnerCommission = typeof staffNfcPartnerCommissions.$inferSelect;
export type StaffNfcReceipt = typeof staffNfcReceipts.$inferSelect;
export type StaffNfcProviderEvent = typeof staffNfcProviderEvents.$inferSelect;