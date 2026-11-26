/**
 * Complete structural models of existing FK parents, from 0176, 0178 and
 * dev-reconciliation/bro-field-operations.sql. No SQL is executed by this module.
 * Existing procedural guards remain owned by their unchanged SQL sources.
 */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, serial, integer, text, boolean, jsonb, timestamp, date, check, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { schools, students, academicTerms, appUsers, partnerProfiles, schoolPartnerAttributions } from "./edupulse";
import { subscriptionRuleProposals, subscriptionPaymentAssistanceRequests } from "./owner-subscription-rules";
import { sourceReference as fk, sourceKeyName } from "./current-finance-keys";

export const studentDirectLiveReviews = pgTable("student_direct_live_reviews", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  schoolId: integer("school_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  ruleId: bigint("rule_id", { mode: "number" }).notNull(),
  reportDigest: text("report_digest").notNull(), merchantScope: text("merchant_scope").notNull(),
  noSplitConfirmed: boolean("no_split_confirmed").notNull(), approvedBy: integer("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), reason: text("reason").notNull(),
}, t => [
  fk("student_direct_live_reviews", t.schoolId, schools.id), fk("student_direct_live_reviews", t.academicTermId, academicTerms.id),
  fk("student_direct_live_reviews", t.ruleId, subscriptionRuleProposals.id), fk("student_direct_live_reviews", t.approvedBy, appUsers.id),
  check("student_direct_live_reviews_report_digest_check", sql`report_digest ~ '^[a-f0-9]{64}$'`),
  check("student_direct_live_reviews_merchant_scope_check", sql`length(trim(merchant_scope)) BETWEEN 3 AND 120`),
  check("student_direct_live_reviews_no_split_confirmed_check", sql`no_split_confirmed IS TRUE`),
  check("student_direct_live_reviews_check", sql`expires_at>approved_at`),
  check("student_direct_live_reviews_reason_check", sql`length(trim(reason)) BETWEEN 3 AND 500`),
]);

export const studentDirectLiveObligations = pgTable("student_direct_live_obligations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  schoolId: integer("school_id").notNull(), studentId: integer("student_id").notNull(),
  academicTermId: integer("academic_term_id").notNull(), ruleId: bigint("rule_id", { mode: "number" }).notNull(),
  reviewId: bigint("review_id", { mode: "number" }).notNull(), merchantScope: text("merchant_scope").notNull(),
  amountMinor: integer("amount_minor").notNull().default(320000),
  schoolShareMinor: integer("school_share_minor").notNull().default(0), broShareMinor: integer("bro_share_minor").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  assistanceRequestId: bigint("assistance_request_id", { mode: "number" }).unique("student_direct_live_obligations_assistance_request_id_key"),
  createdBy: integer("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_obligations", t.schoolId, schools.id), fk("student_direct_live_obligations", t.studentId, students.id),
  fk("student_direct_live_obligations", t.academicTermId, academicTerms.id), fk("student_direct_live_obligations", t.ruleId, subscriptionRuleProposals.id),
  fk("student_direct_live_obligations", t.reviewId, studentDirectLiveReviews.id),
  fk("student_direct_live_obligations", t.assistanceRequestId, subscriptionPaymentAssistanceRequests.id),
  fk("student_direct_live_obligations", t.createdBy, appUsers.id),
  unique(sourceKeyName("student_direct_live_obligations", ["school_id", "student_id", "academic_term_id"])).on(t.schoolId, t.studentId, t.academicTermId),
  check("student_direct_live_obligations_amount_minor_check", sql`amount_minor=320000`),
  check("student_direct_live_obligations_school_share_minor_check", sql`school_share_minor=0`),
  check("student_direct_live_obligations_bro_share_minor_check", sql`bro_share_minor=0`),
  check("student_direct_live_obligations_currency_check", sql`currency='NGN'`),
]);

export const studentDirectLiveAttempts = pgTable("student_direct_live_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(), obligationId: bigint("obligation_id", { mode: "number" }).notNull(),
  reference: text("reference").notNull().unique("student_direct_live_attempts_reference_key"),
  idempotencyKey: text("idempotency_key").notNull(), state: text("state").notNull(), checkoutUrl: text("checkout_url"),
  providerTransactionId: text("provider_transaction_id").unique("student_direct_live_attempts_provider_transaction_id_key"),
  providerReference: text("provider_reference"), providerFeeMinor: integer("provider_fee_minor"), additionalFeeMinor: integer("additional_fee_minor"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }), createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_attempts", t.obligationId, studentDirectLiveObligations.id), fk("student_direct_live_attempts", t.createdBy, appUsers.id),
  unique("student_direct_live_attempts_obligation_id_idempotency_key_key").on(t.obligationId, t.idempotencyKey),
  uniqueIndex("student_direct_one_open_or_paid").on(t.obligationId).where(sql`state<>'FAILED'`),
  check("student_direct_live_attempts_reference_check", sql`reference ~ '^SCV4_live_[A-Za-z0-9_-]{8,80}$'`),
  check("student_direct_live_attempts_state_check", sql`state IN ('RESERVED','READY','UNKNOWN','PENDING','FAILED','PAID')`),
  check("student_direct_live_attempts_provider_fee_minor_check", sql`provider_fee_minor>=0`),
  check("student_direct_live_attempts_additional_fee_minor_check", sql`additional_fee_minor>=0`),
  check("student_direct_live_attempts_check", sql`state NOT IN ('PAID','FAILED') OR (provider_transaction_id ~ '^[1-9][0-9]*$' AND verified_at IS NOT NULL)`),
  check("student_direct_live_attempts_check1", sql`state<>'PAID' OR (provider_reference IS NOT NULL AND provider_fee_minor IS NOT NULL AND additional_fee_minor IS NOT NULL AND provider_fee_minor+additional_fee_minor<320000)`),
]);

export const broTermCommissionEntitlements = pgTable("bro_term_commission_entitlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(), schoolId: integer("school_id").notNull(), studentId: integer("student_id").notNull(),
  academicTermId: integer("academic_term_id").notNull(), partnerProfileId: integer("partner_profile_id").notNull(),
  attributionId: integer("attribution_id").notNull(), policyId: bigint("policy_id", { mode: "number" }).notNull(),
  directObligationId: bigint("direct_obligation_id", { mode: "number" }).notNull(),
  directAttemptId: bigint("direct_attempt_id", { mode: "number" }).notNull().unique("bro_term_commission_entitlements_direct_attempt_id_key"),
  amountMinor: integer("amount_minor").notNull(), currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("PENDING_OWNER_APPROVAL"), earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
  evidence: jsonb("evidence").notNull(), createdBy: integer("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("bro_term_commission_entitlements", t.schoolId, schools.id, true), fk("bro_term_commission_entitlements", t.studentId, students.id, true),
  fk("bro_term_commission_entitlements", t.academicTermId, academicTerms.id, true), fk("bro_term_commission_entitlements", t.partnerProfileId, partnerProfiles.id, true),
  fk("bro_term_commission_entitlements", t.attributionId, schoolPartnerAttributions.id, true), fk("bro_term_commission_entitlements", t.policyId, subscriptionRuleProposals.id, true),
  fk("bro_term_commission_entitlements", t.directObligationId, studentDirectLiveObligations.id, true),
  fk("bro_term_commission_entitlements", t.directAttemptId, studentDirectLiveAttempts.id, true), fk("bro_term_commission_entitlements", t.createdBy, appUsers.id, true),
  unique("bro_term_commission_scope_uq").on(t.studentId, t.academicTermId),
  check("bro_term_commission_entitlements_amount_minor_check", sql`amount_minor=15000`),
  check("bro_term_commission_entitlements_currency_check", sql`currency='NGN'`),
  check("bro_term_commission_entitlements_status_check", sql`status='PENDING_OWNER_APPROVAL'`),
  check("bro_term_commission_entitlements_evidence_check", sql`(jsonb_typeof(evidence)='object' AND evidence->>'funding'='SEPARATE_PLATFORM_EXPENSE' AND (evidence->>'studentCollectionMinor')::integer=320000 AND (evidence->>'collectionBroShareMinor')::integer=0) IS TRUE`),
]);

export const broFieldLeads = pgTable("bro_field_leads", {
  id: serial("id").primaryKey(), originalOwnerId: integer("original_owner_id").notNull(), currentOwnerId: integer("current_owner_id"),
  schoolId: integer("school_id"), schoolName: text("school_name").notNull(), address: text("address").notNull(),
  contactPerson: text("contact_person"), contactPhone: text("contact_phone"), visitDate: date("visit_date", { mode: "string" }).notNull(),
  personMet: text("person_met").notNull(), notes: text("notes").notNull(), interestLevel: text("interest_level").notNull(),
  status: text("status").notNull(), nextFollowUpDate: date("next_follow_up_date", { mode: "string" }),
  version: integer("version").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("bro_field_leads", t.originalOwnerId, appUsers.id), fk("bro_field_leads", t.currentOwnerId, appUsers.id), fk("bro_field_leads", t.schoolId, schools.id),
  index("bro_field_owner_followup").on(t.currentOwnerId, t.nextFollowUpDate),
  check("bro_field_leads_interest_level_check", sql`interest_level IN ('Unknown','Low','Medium','High')`),
  check("bro_field_leads_status_check", sql`status IN ('Visited','Interested','Demo Scheduled','Negotiation','Adopted','Not Interested','Follow-up')`),
  check("bro_field_leads_check", sql`status<>'Adopted' OR school_id IS NOT NULL`),
]);
