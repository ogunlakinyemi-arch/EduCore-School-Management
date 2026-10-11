import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, boolean, timestamp, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { schools, students, subscriptions, academicSessions, academicTerms, partnerProfiles, schoolPartnerAttributions, commissionRules, appUsers } from "./edupulse";
import { studentSubscriptionPayments } from "./student-subscription-billing";

export const flutterwaveSplitRecipients = pgTable("flutterwave_split_recipients", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  schoolId: integer("school_id").references(() => schools.id),
  partnerProfileId: integer("partner_profile_id").references(() => partnerProfiles.id),
  entityName: text("entity_name").notNull(),
  bankCiphertext: text("bank_ciphertext").notNull(),
  bankFingerprint: text("bank_fingerprint").notNull(),
  accountLast4: text("account_last4").notNull(),
  bankName: text("bank_name").notNull(),
  status: text("status").notNull().default("BANK_RESOLVED"),
  providerId: integer("provider_id"),
  providerSubaccountId: text("provider_subaccount_id"),
  submittedBy: integer("submitted_by").notNull().references(() => appUsers.id),
  reviewedBy: integer("reviewed_by").references(() => appUsers.id),
  reviewNote: text("review_note"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("flw_recipient_scope_ck", sql`(${t.kind}='SCHOOL' AND ${t.schoolId} IS NOT NULL AND ${t.partnerProfileId} IS NULL) OR (${t.kind}='PARTNER' AND ${t.partnerProfileId} IS NOT NULL AND ${t.schoolId} IS NULL)`),
  check("flw_recipient_state_ck", sql`${t.status} IN ('BANK_RESOLVED','CREATING','CREATION_UNKNOWN','TEST_READY','SUSPENDED','RETIRED')`),
  check("flw_recipient_ready_ck", sql`${t.status}<>'TEST_READY' OR (${t.providerId} IS NOT NULL AND ${t.providerId}>0 AND ${t.providerSubaccountId} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL)`),
  uniqueIndex("flw_recipient_school_uq").on(t.schoolId).where(sql`${t.status}<>'RETIRED'`),
  uniqueIndex("flw_recipient_partner_uq").on(t.partnerProfileId).where(sql`${t.status}<>'RETIRED'`),
  uniqueIndex("flw_recipient_bank_uq").on(t.bankFingerprint).where(sql`${t.status}<>'RETIRED'`),
  uniqueIndex("flw_recipient_provider_uq").on(t.providerSubaccountId),
  uniqueIndex("flw_recipient_provider_id_uq").on(t.providerId),
]);
export const flutterwaveSplitSettings = pgTable("flutterwave_split_settings", {
  schoolId: integer("school_id").primaryKey().references(() => schools.id),
  enabled: boolean("enabled").notNull().default(false),
  automaticSettlementConfirmed: boolean("automatic_settlement_confirmed").notNull().default(false),
  reviewedBy: integer("reviewed_by").notNull().references(() => appUsers.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("flw_settings_ready_ck", sql`NOT ${t.enabled} OR ${t.automaticSettlementConfirmed}`)]);
export const flutterwaveSplitPayments = pgTable("flutterwave_split_payments", {
  paymentId: integer("payment_id").primaryKey().references(() => studentSubscriptionPayments.id),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  studentId: integer("student_id").notNull().references(() => students.id),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id),
  termId: integer("term_id").notNull().references(() => academicTerms.id),
  reference: text("reference").notNull().unique(),
  schoolRecipientId: integer("school_recipient_id").notNull().references(() => flutterwaveSplitRecipients.id),
  partnerRecipientId: integer("partner_recipient_id").references(() => flutterwaveSplitRecipients.id),
  partnerProfileId: integer("partner_profile_id").references(() => partnerProfiles.id),
  attributionId: integer("attribution_id").references(() => schoolPartnerAttributions.id),
  commissionRuleId: integer("commission_rule_id").references(() => commissionRules.id),
  instructions: jsonb("instructions").notNull(),
  schoolAmountMinor: integer("school_amount_minor").notNull().default(200000),
  partnerAmountMinor: integer("partner_amount_minor").notNull().default(0),
  platformAmountMinor: integer("platform_amount_minor").notNull(),
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("CHECKOUT_FROZEN"),
  providerFeeMinor: integer("provider_fee_minor"),
  providerAdditionalFeeMinor: integer("provider_additional_fee_minor"),
  reconciliationNote: text("reconciliation_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("flw_split_amounts_ck", sql`${t.schoolAmountMinor}=200000 AND ${t.currency}='NGN' AND ((${t.partnerRecipientId} IS NULL AND ${t.partnerProfileId} IS NULL AND ${t.attributionId} IS NULL AND ${t.commissionRuleId} IS NULL AND ${t.partnerAmountMinor}=0 AND ${t.platformAmountMinor}=300000) OR (${t.partnerRecipientId} IS NOT NULL AND ${t.partnerProfileId} IS NOT NULL AND ${t.attributionId} IS NOT NULL AND ${t.commissionRuleId} IS NOT NULL AND ${t.partnerAmountMinor}=10000 AND ${t.platformAmountMinor}=290000))`),
  check("flw_split_status_ck", sql`${t.status} IN ('CHECKOUT_FROZEN','COLLECTION_PAID','COLLECTION_FAILED','COLLECTION_EXCEPTION','REPORT_EXCEPTION','TEST_PROVIDER_REPORTED_COMPLETE','REFUND_REVIEW','REFUNDED')`),
  check("flw_split_costs_ck", sql`(${t.providerFeeMinor} IS NULL OR ${t.providerFeeMinor}>=0) AND (${t.providerAdditionalFeeMinor} IS NULL OR ${t.providerAdditionalFeeMinor}>=0)`),
]);
export const flutterwaveSplitSettlements = pgTable("flutterwave_split_settlements", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => flutterwaveSplitPayments.paymentId),
  recipientId: integer("recipient_id").notNull().references(() => flutterwaveSplitRecipients.id),
  expectedAmountMinor: integer("expected_amount_minor").notNull(),
  observedAmountMinor: integer("observed_amount_minor"),
  providerSettlementId: text("provider_settlement_id"),
  status: text("status").notNull().default("UNVERIFIED"),
  exception: text("exception"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("flw_settlement_payment_recipient_uq").on(t.paymentId, t.recipientId),
  uniqueIndex("flw_settlement_report_payment_recipient_uq").on(t.providerSettlementId, t.paymentId, t.recipientId),
  check("flw_settlement_amount_ck", sql`${t.expectedAmountMinor} IN (200000,10000) AND (${t.observedAmountMinor} IS NULL OR ${t.observedAmountMinor}>=0)`),
  check("flw_settlement_status_ck", sql`${t.status} IN ('UNVERIFIED','PENDING','FAILED','MISMATCH','TEST_PROVIDER_REPORTED_COMPLETE')`),
]);
export const flutterwaveSplitAdjustments = pgTable("flutterwave_split_adjustments", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => flutterwaveSplitPayments.paymentId),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("REQUESTING"),
  providerRefundId: text("provider_refund_id").unique(),
  recoveryStatus: text("recovery_status").notNull().default("NOT_APPLIED"),
  schoolRecoveryMinor: integer("school_recovery_minor"),
  partnerRecoveryMinor: integer("partner_recovery_minor"),
  platformReversalMinor: integer("platform_reversal_minor"),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("flw_refund_amount_ck", sql`${t.amountMinor} BETWEEN 10000 AND 500000`),
  check("flw_refund_status_ck", sql`${t.status} IN ('REQUESTING','OUTCOME_UNKNOWN','PROCESSING','CONFIRMED','FAILED')`),
  check("flw_refund_recovery_ck", sql`${t.recoveryStatus} IN ('NOT_APPLIED','RECIPIENT_RECOVERY_REVIEW')`),
]);
export const insertFlutterwaveRecipientSchema = createInsertSchema(flutterwaveSplitRecipients);
export type FlutterwaveRecipientRecord = typeof flutterwaveSplitRecipients.$inferSelect;
