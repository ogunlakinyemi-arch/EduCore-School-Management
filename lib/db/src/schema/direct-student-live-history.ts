/**
 * Exact structural evidence from 0176/0177. No release, rule seed or SQL execution.
 * Source history triggers remain mandatory and are not supplied by these models.
 */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, integer, text, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { schools, academicTerms, appUsers } from "./edupulse";
import { subscriptionRuleProposals } from "./owner-subscription-rules";
import { studentDirectLiveAttempts, studentDirectLiveReviews } from "./current-finance-prerequisites";
import { sourceReference as fk, sourceKeyName } from "./current-finance-keys";

export const studentDirectLiveEvents = pgTable("student_direct_live_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  attemptId: bigint("attempt_id", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  actorUserId: integer("actor_user_id"),
  details: jsonb("details").notNull().default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_events", t.attemptId, studentDirectLiveAttempts.id),
  fk("student_direct_live_events", t.actorUserId, appUsers.id),
]);

export const studentDirectLiveReleaseRequests = pgTable("student_direct_live_release_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  schoolId: integer("school_id").notNull(),
  academicTermId: integer("academic_term_id").notNull(),
  ruleId: bigint("rule_id", { mode: "number" }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  factsDigest: text("facts_digest").notNull(),
  evidenceDigest: text("evidence_digest").notNull().unique("student_direct_live_release_requests_evidence_digest_key"),
  merchantEvidenceReference: text("merchant_evidence_reference").notNull(),
  merchantEvidenceHash: text("merchant_evidence_hash").notNull(),
  policy: text("policy").notNull(),
  noSplitConfirmed: boolean("no_split_confirmed").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: integer("created_by").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_release_requests", t.schoolId, schools.id),
  fk("student_direct_live_release_requests", t.academicTermId, academicTerms.id),
  fk("student_direct_live_release_requests", t.ruleId, subscriptionRuleProposals.id),
  fk("student_direct_live_release_requests", t.createdBy, appUsers.id),
  check("student_direct_live_release_requests_snapshot_check", sql`jsonb_typeof(snapshot)='object'`),
  check("student_direct_live_release_requests_facts_digest_check", sql`facts_digest ~ '^[a-f0-9]{64}$'`),
  check("student_direct_live_release_requests_evidence_digest_check", sql`evidence_digest ~ '^[a-f0-9]{64}$'`),
  check(sourceKeyName("student_direct_live_release_requests", ["merchant_evidence_reference"], "check"), sql`length(trim(merchant_evidence_reference)) BETWEEN 8 AND 300`),
  check(sourceKeyName("student_direct_live_release_requests", ["merchant_evidence_hash"], "check"), sql`merchant_evidence_hash ~ '^[a-f0-9]{64}$'`),
  check("student_direct_live_release_requests_policy_check", sql`policy='NEW_ONLY_PRESERVE_LEGACY'`),
  check("student_direct_live_release_requests_no_split_confirmed_check", sql`no_split_confirmed IS TRUE`),
  check("student_direct_live_release_requests_reason_check", sql`length(trim(reason)) BETWEEN 3 AND 500`),
  check("student_direct_live_release_requests_check", sql`expires_at>created_at AND expires_at<=created_at+interval '7 days'`),
]);

export const studentDirectLiveReleaseDecisions = pgTable("student_direct_live_release_decisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  requestId: bigint("request_id", { mode: "number" }).notNull(),
  action: text("action").notNull(),
  actorUserId: integer("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_release_decisions", t.requestId, studentDirectLiveReleaseRequests.id),
  fk("student_direct_live_release_decisions", t.actorUserId, appUsers.id),
  check("student_direct_live_release_decisions_action_check", sql`action IN ('REVIEWED','APPROVED','REJECTED','EXPIRED')`),
  check("student_direct_live_release_decisions_reason_check", sql`length(trim(reason)) BETWEEN 3 AND 500`),
  index("student_direct_release_latest_decision").on(t.requestId, t.id.desc().nullsFirst()),
]);

export const studentDirectLiveReviewBindings = pgTable("student_direct_live_review_bindings", {
  reviewId: bigint("review_id", { mode: "number" }).primaryKey(),
  requestId: bigint("request_id", { mode: "number" }).notNull().unique("student_direct_live_review_bindings_request_id_key"),
  ruleVersion: integer("rule_version").notNull(),
  release: text("release").notNull(),
  environment: text("environment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("student_direct_live_review_bindings", t.reviewId, studentDirectLiveReviews.id),
  fk("student_direct_live_review_bindings", t.requestId, studentDirectLiveReleaseRequests.id),
  check("student_direct_live_review_bindings_rule_version_check", sql`rule_version>0`),
  check("student_direct_live_review_bindings_release_check", sql`release='STUDENT_DIRECT_3200_V1'`),
  check("student_direct_live_review_bindings_environment_check", sql`environment='LIVE'`),
]);
