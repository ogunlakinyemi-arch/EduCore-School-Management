/** Final 0181 + 0182 structure, with no intermediate obsolete source CHECK. */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, integer, text, jsonb, timestamp, unique, uniqueIndex, primaryKey, index, check } from "drizzle-orm/pg-core";
import { schools, academicTerms, appUsers } from "./edupulse";
import { studentDirectLiveAttempts, broTermCommissionEntitlements } from "./current-finance-prerequisites";
import { currentBulkAllocations, currentBulkBroEntitlements } from "./current-bulk-payments";
import { sourceReference as fk } from "./current-finance-keys";

export const currentSubscriptionOperations = pgTable("current_subscription_operations", {
  id: bigserial("id", { mode: "number" }).primaryKey(), kind: text("kind").notNull(), requestKey: text("request_key").notNull(),
  schoolId: integer("school_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  attemptId: bigint("attempt_id", { mode: "number" }), entitlementId: bigint("entitlement_id", { mode: "number" }),
  parentId: bigint("parent_id", { mode: "number" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), currency: text("currency").notNull().default("NGN"),
  reason: text("reason").notNull(), createdBy: integer("created_by").notNull(), snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  allocationId: bigint("allocation_id", { mode: "number" }), bulkEntitlementId: bigint("bulk_entitlement_id", { mode: "number" }),
}, t => [
  fk("current_subscription_operations", t.schoolId, schools.id, true), fk("current_subscription_operations", t.academicTermId, academicTerms.id, true),
  fk("current_subscription_operations", t.attemptId, studentDirectLiveAttempts.id, true),
  fk("current_subscription_operations", t.entitlementId, broTermCommissionEntitlements.id, true), fk("current_subscription_operations", t.createdBy, appUsers.id, true),
  fk("current_subscription_operations", t.parentId, t.id, true),
  fk("current_subscription_operations", t.allocationId, currentBulkAllocations.id), fk("current_subscription_operations", t.bulkEntitlementId, currentBulkBroEntitlements.id),
  unique("current_subscription_operations_kind_request_key_key").on(t.kind, t.requestKey),
  uniqueIndex("current_subscription_bro_root_uq").on(t.entitlementId).where(sql`kind='BRO'`),
  uniqueIndex("current_subscription_bulk_bro_root_uq").on(t.bulkEntitlementId).where(sql`kind='BRO'`),
  check("current_subscription_operations_kind_check", sql`kind IN ('REFUND','BRO','BRO_PAYOUT','BRO_RECOVERY','BULK_PLAN')`),
  check("current_subscription_operations_request_key_check", sql`length(request_key) BETWEEN 16 AND 100`),
  check("current_subscription_operations_amount_minor_check", sql`amount_minor>0 AND amount_minor<=9007199254740991`),
  check("current_subscription_operations_currency_check", sql`currency='NGN'`),
  check("current_subscription_operations_reason_check", sql`length(btrim(reason)) BETWEEN 3 AND 500`),
  check("current_subscription_operations_snapshot_check", sql`jsonb_typeof(snapshot)='object'`),
  check("current_subscription_source_ck", sql`
    (kind='BULK_PLAN' AND attempt_id IS NULL AND allocation_id IS NULL
      AND entitlement_id IS NULL AND bulk_entitlement_id IS NULL AND parent_id IS NULL AND amount_minor%320000=0)
    OR (
      ((attempt_id IS NOT NULL AND allocation_id IS NULL AND bulk_entitlement_id IS NULL)
       OR (allocation_id IS NOT NULL AND attempt_id IS NULL AND entitlement_id IS NULL))
      AND (
        (kind='REFUND' AND entitlement_id IS NULL AND bulk_entitlement_id IS NULL AND parent_id IS NULL AND amount_minor<=320000)
        OR (kind='BRO' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NULL AND amount_minor=15000)
        OR (kind='BRO_PAYOUT' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NOT NULL AND amount_minor=15000)
        OR (kind='BRO_RECOVERY' AND (entitlement_id IS NOT NULL OR bulk_entitlement_id IS NOT NULL) AND parent_id IS NOT NULL AND amount_minor<=15000)
      )
    )`),
]);
export const currentSubscriptionOperationEvents = pgTable("current_subscription_operation_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), operationId: bigint("operation_id", { mode: "number" }).notNull(),
  eventKey: text("event_key").notNull().unique("current_subscription_operation_events_event_key_key"),
  state: text("state").notNull(), actorUserId: integer("actor_user_id"), details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("current_subscription_operation_events", t.operationId, currentSubscriptionOperations.id, true),
  fk("current_subscription_operation_events", t.actorUserId, appUsers.id, true),
  index("current_subscription_operation_event_order").on(t.operationId, t.id.desc().nullsFirst()),
  check("current_subscription_operation_events_state_check", sql`state IN ('REQUESTED','APPROVED','PROCESSING','UNKNOWN','PENDING','SUCCEEDED','FAILED','REVERSED','HELD','RECOVERY_REQUIRED','RECOVERY_RECORDED','REVIEW_ONLY')`),
  check("current_subscription_operation_events_details_check", sql`jsonb_typeof(details)='object'`),
]);
export const currentSubscriptionReferenceClaims = pgTable("current_subscription_reference_claims", {
  namespace: text("namespace").notNull(), reference: text("reference").notNull(), operationId: bigint("operation_id", { mode: "number" }).notNull(),
}, t => [
  primaryKey({ name: "current_subscription_reference_claims_pkey", columns: [t.namespace, t.reference] }),
  fk("current_subscription_reference_claims", t.operationId, currentSubscriptionOperations.id, true),
  check("current_subscription_reference_claims_namespace_check", sql`namespace IN ('REFUND','COLLECTION_REVERSAL','BRO_PAYOUT','BRO_RECOVERY')`),
  check("current_subscription_reference_claims_reference_check", sql`reference=lower(btrim(reference)) AND length(reference) BETWEEN 3 AND 200`),
]);
