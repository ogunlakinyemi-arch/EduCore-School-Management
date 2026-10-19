import { pgTable, serial, text, integer, timestamp, jsonb, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUsers, commissionLedger, partnerPayouts } from "./edupulse";
import { studentSubscriptionPayments } from "./student-subscription-billing";

export const deferredCommissionAdverseEvents = pgTable("deferred_commission_adverse_events", {
  eventHash: text("event_hash").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => studentSubscriptionPayments.id),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at",{withTimezone:true}).notNull().defaultNow(),
});

export const partnerPayoutBatches = pgTable("partner_payout_batches", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("APPROVED"),
  approvedBy: integer("approved_by").notNull().references(() => appUsers.id),
  approvedAt: timestamp("approved_at", {withTimezone:true}).notNull().defaultNow(),
  snapshot: jsonb("snapshot").notNull(),
}, t => [check("partner_payout_batches_status_check",sql`${t.status} IN ('APPROVED','REVIEW_REQUIRED')`)]);
export const partnerPayoutBatchItems = pgTable("partner_payout_batch_items", {
  batchId: integer("batch_id").notNull().references(() => partnerPayoutBatches.id),
  commissionId: integer("commission_id").notNull().unique().references(() => commissionLedger.id),
  payoutId: integer("payout_id").notNull().references(() => partnerPayouts.id),
}, t => [primaryKey({columns:[t.batchId,t.commissionId]})]);
