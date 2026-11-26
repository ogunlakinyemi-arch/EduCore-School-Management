/** Final structural contract of 0182. Procedural guards remain in reviewed SQL. */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, integer, text, jsonb, timestamp, unique, uniqueIndex, check } from "drizzle-orm/pg-core";
import { schools, students, academicTerms, appUsers, partnerProfiles, schoolPartnerAttributions } from "./edupulse";
import { subscriptionRuleProposals } from "./owner-subscription-rules";
import { studentDirectLiveReviews } from "./current-finance-prerequisites";
import { sourceReference as fk, sourceKeyName as key } from "./current-finance-keys";

export const currentPaymentBatches = pgTable("current_payment_batches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  schoolId: integer("school_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  reference: text("reference").notNull().unique("current_payment_batches_reference_key"),
  requestKey: text("request_key").notNull().unique("current_payment_batches_request_key_key"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull().default("NGN"),
  createdBy: integer("created_by").notNull(), snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("current_payment_batches", t.schoolId, schools.id, true), fk("current_payment_batches", t.academicTermId, academicTerms.id, true),
  fk("current_payment_batches", t.createdBy, appUsers.id),
  check("current_payment_batches_amount_minor_check", sql`amount_minor>0 AND amount_minor%320000=0 AND amount_minor<=9007199254740991`),
  check("current_payment_batches_currency_check", sql`currency='NGN'`),
]);
export const currentBulkAllocations = pgTable("current_bulk_allocations", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull(),
  schoolId: integer("school_id").notNull(), studentId: integer("student_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  amountMinor: integer("amount_minor").notNull().default(320000), reviewId: bigint("review_id", { mode: "number" }).notNull(),
}, t => [
  fk("current_bulk_allocations", t.batchId, currentPaymentBatches.id), fk("current_bulk_allocations", t.schoolId, schools.id),
  fk("current_bulk_allocations", t.studentId, students.id), fk("current_bulk_allocations", t.academicTermId, academicTerms.id),
  fk("current_bulk_allocations", t.reviewId, studentDirectLiveReviews.id),
  unique(key("current_bulk_allocations", ["student_id", "academic_term_id"])).on(t.studentId, t.academicTermId),
  unique(key("current_bulk_allocations", ["batch_id", "student_id"])).on(t.batchId, t.studentId),
  check("current_bulk_allocations_amount_minor_check", sql`amount_minor=320000`),
]);
export const currentBulkConfirmations = pgTable("current_bulk_confirmations", {
  batchId: bigint("batch_id", { mode: "number" }).primaryKey(),
  providerTransactionId: text("provider_transaction_id").notNull().unique("current_bulk_confirmations_provider_transaction_id_key"),
  providerReference: text("provider_reference").notNull().unique("current_bulk_confirmations_provider_reference_key"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(), evidence: jsonb("evidence").notNull(),
}, t => [
  fk("current_bulk_confirmations", t.batchId, currentPaymentBatches.id),
  check("current_bulk_confirmations_amount_minor_check", sql`amount_minor>0`),
]);
export const currentBulkEvents = pgTable("current_bulk_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), batchId: bigint("batch_id", { mode: "number" }).notNull(),
  allocationId: bigint("allocation_id", { mode: "number" }), eventKey: text("event_key").notNull().unique("current_bulk_events_event_key_key"),
  state: text("state").notNull(), actorUserId: integer("actor_user_id").notNull(),
  details: jsonb("details").notNull().default(sql`'{}'`), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("current_bulk_events", t.batchId, currentPaymentBatches.id), fk("current_bulk_events", t.allocationId, currentBulkAllocations.id),
  fk("current_bulk_events", t.actorUserId, appUsers.id),
  uniqueIndex("current_bulk_posted_once").on(t.allocationId).where(sql`state='POSTED'`),
]);
export const currentBulkBroEntitlements = pgTable("current_bulk_bro_entitlements", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  allocationId: bigint("allocation_id", { mode: "number" }).notNull().unique("current_bulk_bro_entitlements_allocation_id_key"),
  schoolId: integer("school_id").notNull(), studentId: integer("student_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  partnerProfileId: integer("partner_profile_id").notNull(), attributionId: integer("attribution_id").notNull(),
  policyId: bigint("policy_id", { mode: "number" }).notNull(), amountMinor: integer("amount_minor").notNull().default(15000),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(), evidence: jsonb("evidence").notNull(), createdBy: integer("created_by").notNull(),
}, t => [
  fk("current_bulk_bro_entitlements", t.allocationId, currentBulkAllocations.id), fk("current_bulk_bro_entitlements", t.schoolId, schools.id),
  fk("current_bulk_bro_entitlements", t.studentId, students.id), fk("current_bulk_bro_entitlements", t.academicTermId, academicTerms.id),
  fk("current_bulk_bro_entitlements", t.partnerProfileId, partnerProfiles.id), fk("current_bulk_bro_entitlements", t.attributionId, schoolPartnerAttributions.id),
  fk("current_bulk_bro_entitlements", t.policyId, subscriptionRuleProposals.id), fk("current_bulk_bro_entitlements", t.createdBy, appUsers.id),
  unique(key("current_bulk_bro_entitlements", ["student_id", "academic_term_id"])).on(t.studentId, t.academicTermId),
  check("current_bulk_bro_entitlements_amount_minor_check", sql`amount_minor=15000`),
]);
