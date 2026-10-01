import { sql } from "drizzle-orm";
import {
  check,
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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  academicSessions,
  academicTerms,
  appUsers,
  commissionRules,
  schoolPartnerAttributions,
  schools,
  students,
  subscriptions,
} from "./edupulse";

export const studentSubscriptionPayments = pgTable(
  "student_subscription_payments",
  {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id").notNull(),
    schoolId: integer("school_id").notNull(),
    studentId: integer("student_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    payerUserId: integer("payer_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("FLUTTERWAVE"),
    providerMode: text("provider_mode").notNull().default("SANDBOX"),
    reference: text("reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    grossAmountMinor: integer("gross_amount_minor").notNull().default(500_000),
    providerFeeMinor: integer("provider_fee_minor"),
    settlementAmountMinor: integer("settlement_amount_minor"),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("PENDING"),
    settlementStatus: text("settlement_status").notNull().default("PENDING"),
    reconciliationStatus: text("reconciliation_status").notNull().default("PENDING"),
    checkoutUrl: text("checkout_url"),
    providerTransactionId: text("provider_transaction_id"),
    providerPaidAt: timestamp("provider_paid_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    receiptSnapshot: jsonb("receipt_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("student_subscription_payments_reference_uq").on(table.reference),
    uniqueIndex("student_subscription_payments_provider_transaction_uq")
      .on(table.provider, table.providerTransactionId)
      .where(sql`${table.providerTransactionId} IS NOT NULL`),
    uniqueIndex("student_subscription_payments_subscription_idempotency_uq").on(
      table.subscriptionId,
      table.idempotencyKey,
    ),
    uniqueIndex("student_subscription_payments_id_owner_term_uq").on(
      table.id,
      table.subscriptionId,
      table.schoolId,
      table.studentId,
      table.academicSessionId,
      table.academicTermId,
    ),
    foreignKey({
      columns: [table.subscriptionId, table.schoolId, table.studentId],
      foreignColumns: [subscriptions.id, subscriptions.schoolId, subscriptions.studentId],
      name: "student_subscription_payments_subscription_owner_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "student_subscription_payments_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "student_subscription_payments_term_school_fk",
    }),
    check("student_subscription_payments_provider_ck", sql`${table.provider} = 'FLUTTERWAVE'`),
    check("student_subscription_payments_provider_mode_ck", sql`${table.providerMode} = 'SANDBOX'`),
    check(
      "student_subscription_payments_reference_ck",
      sql`${table.reference} ~ '^[A-Za-z0-9_-]{8,100}$'`,
    ),
    check(
      "student_subscription_payments_gross_ck",
      sql`${table.grossAmountMinor} = 500000 AND ${table.currency} = 'NGN'
        AND (${table.providerFeeMinor} IS NULL OR ${table.providerFeeMinor} >= 0)
        AND (${table.settlementAmountMinor} IS NULL
          OR ${table.settlementAmountMinor} BETWEEN 0 AND ${table.grossAmountMinor})`,
    ),
    check(
      "student_subscription_payments_status_ck",
      sql`${table.status} IN ('PENDING','PAID','FAILED','RECONCILIATION_REQUIRED')`,
    ),
    check(
      "student_subscription_payments_settlement_ck",
      sql`${table.settlementStatus} IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')`,
    ),
    check(
      "student_subscription_payments_reconciliation_ck",
      sql`${table.reconciliationStatus} IN ('PENDING','RECONCILED','RECONCILIATION_REQUIRED','NOT_APPLICABLE')`,
    ),
    index("student_subscription_payments_school_status_idx").on(
      table.schoolId,
      table.status,
      table.createdAt.desc(),
    ),
    index("student_subscription_payments_term_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
    ),
    uniqueIndex("student_subscription_payments_one_open_attempt_uq")
      .on(table.subscriptionId)
      .where(sql`${table.status} IN ('PENDING','RECONCILIATION_REQUIRED')`),
    uniqueIndex("student_subscription_payments_one_business_term_uq")
      .on(table.schoolId, table.studentId, table.academicSessionId, table.academicTermId)
      .where(sql`${table.status} IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
        OR ${table.reconciliationStatus} = 'RECONCILIATION_REQUIRED'`),
  ],
);

export const studentSubscriptionAllocations = pgTable(
  "student_subscription_allocations",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    entryType: text("entry_type").notNull().default("CREDIT"),
    recipientType: text("recipient_type").notNull(),
    recipientId: integer("recipient_id"),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
    payerUserId: integer("payer_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    subscriptionId: integer("subscription_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    attributionId: integer("attribution_id").references(() => schoolPartnerAttributions.id, { onDelete: "restrict" }),
    commissionRuleId: integer("commission_rule_id").references(() => commissionRules.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("student_subscription_allocations_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("student_subscription_allocations_id_payment_entry_recipient_uq")
      .on(table.id, table.paymentId, table.entryType, table.recipientType),
    uniqueIndex("student_subscription_allocations_payment_credit_recipient_uq")
      .on(table.paymentId, table.recipientType)
      .where(sql`${table.entryType} = 'CREDIT'`),
    uniqueIndex("student_subscription_allocations_payment_fee_expense_uq")
      .on(table.paymentId)
      .where(sql`${table.entryType} = 'EXPENSE' AND ${table.recipientType} = 'PLATFORM_PROVIDER_FEE'`),
    foreignKey({
      columns: [
        table.paymentId,
        table.subscriptionId,
        table.schoolId,
        table.studentId,
        table.academicSessionId,
        table.academicTermId,
      ],
      foreignColumns: [
        studentSubscriptionPayments.id,
        studentSubscriptionPayments.subscriptionId,
        studentSubscriptionPayments.schoolId,
        studentSubscriptionPayments.studentId,
        studentSubscriptionPayments.academicSessionId,
        studentSubscriptionPayments.academicTermId,
      ],
      name: "student_subscription_allocations_payment_owner_term_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "student_subscription_allocations_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "student_subscription_allocations_term_school_fk",
    }),
    foreignKey({
      columns: [table.attributionId, table.recipientId],
      foreignColumns: [schoolPartnerAttributions.id, schoolPartnerAttributions.partnerProfileId],
      name: "student_subscription_allocations_attribution_partner_fk",
    }),
    check(
      "student_subscription_allocations_recipient_ck",
      sql`${table.recipientType} IN ('SCHOOL','PLATFORM','PARTNER','PLATFORM_PROVIDER_FEE')`,
    ),
    check("student_subscription_allocations_entry_ck", sql`${table.entryType} IN ('CREDIT','REVERSAL','EXPENSE')`),
    check(
      "student_subscription_allocations_amount_ck",
      sql`${table.amountMinor} > 0 AND ${table.currency} = 'NGN'
        AND ((${table.entryType} = 'CREDIT' AND ${table.recipientType} IN ('SCHOOL','PLATFORM','PARTNER'))
          OR (${table.entryType} = 'REVERSAL' AND ${table.recipientType} IN ('SCHOOL','PLATFORM','PARTNER'))
          OR (${table.entryType} = 'EXPENSE' AND ${table.recipientType} = 'PLATFORM_PROVIDER_FEE'))`,
    ),
    check(
      "student_subscription_allocations_partner_ck",
      sql`(${table.recipientType} = 'PARTNER' AND ${table.recipientId} IS NOT NULL
          AND ${table.attributionId} IS NOT NULL AND ${table.commissionRuleId} IS NOT NULL)
        OR (${table.recipientType} <> 'PARTNER' AND ${table.recipientId} IS NULL)`,
    ),
    index("student_subscription_allocations_school_term_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.createdAt.desc(),
    ),
    index("student_subscription_allocations_partner_idx").on(table.recipientId, table.createdAt.desc())
      .where(sql`${table.recipientType} = 'PARTNER'`),
  ],
);

export const insertStudentSubscriptionPaymentSchema = createInsertSchema(studentSubscriptionPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StudentSubscriptionPayment = typeof studentSubscriptionPayments.$inferSelect;
export type InsertStudentSubscriptionPayment = z.infer<typeof insertStudentSubscriptionPaymentSchema>;
export type StudentSubscriptionAllocation = typeof studentSubscriptionAllocations.$inferSelect;