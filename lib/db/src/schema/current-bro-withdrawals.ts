/** BRO withdrawal evidence from 0182; no rule or payout activation. */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, integer, text, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { appUsers, partnerProfiles } from "./edupulse";
import { broTermCommissionEntitlements } from "./current-finance-prerequisites";
import { currentBulkBroEntitlements } from "./current-bulk-payments";
import { currentSubscriptionOperations } from "./current-subscription-lifecycle";
import { sourceReference as fk } from "./current-finance-keys";
export const currentBroWithdrawals = pgTable("current_bro_withdrawals", {
  id: bigserial("id", { mode: "number" }).primaryKey(), partnerProfileId: integer("partner_profile_id").notNull(),
  createdBy: integer("created_by").notNull(), requestKey: text("request_key").notNull().unique("current_bro_withdrawals_request_key_key"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), reason: text("reason").notNull(), snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("current_bro_withdrawals", t.partnerProfileId, partnerProfiles.id), fk("current_bro_withdrawals", t.createdBy, appUsers.id),
  check("current_bro_withdrawals_amount_minor_check", sql`amount_minor>0 AND amount_minor%15000=0`),
  check("current_bro_withdrawals_reason_check", sql`length(btrim(reason)) BETWEEN 3 AND 500`),
]);
export const currentBroWithdrawalLines = pgTable("current_bro_withdrawal_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(), requestId: bigint("request_id", { mode: "number" }).notNull(),
  entitlementId: bigint("entitlement_id", { mode: "number" }).unique("current_bro_withdrawal_lines_entitlement_id_key"),
  bulkEntitlementId: bigint("bulk_entitlement_id", { mode: "number" }).unique("current_bro_withdrawal_lines_bulk_entitlement_id_key"),
  journalId: bigint("journal_id", { mode: "number" }).notNull().unique("current_bro_withdrawal_lines_journal_id_key"),
}, t => [
  fk("current_bro_withdrawal_lines", t.requestId, currentBroWithdrawals.id), fk("current_bro_withdrawal_lines", t.entitlementId, broTermCommissionEntitlements.id),
  fk("current_bro_withdrawal_lines", t.bulkEntitlementId, currentBulkBroEntitlements.id), fk("current_bro_withdrawal_lines", t.journalId, currentSubscriptionOperations.id),
  check("current_bro_withdrawal_lines_check", sql`(entitlement_id IS NOT NULL)::int+(bulk_entitlement_id IS NOT NULL)::int=1`),
]);
export const currentBroWithdrawalDecisions = pgTable("current_bro_withdrawal_decisions", {
  lineId: bigint("line_id", { mode: "number" }).primaryKey(), decision: text("decision").notNull(), decidedBy: integer("decided_by").notNull(),
  reason: text("reason").notNull(), requestKey: text("request_key").notNull().unique("current_bro_withdrawal_decisions_request_key_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("current_bro_withdrawal_decisions", t.lineId, currentBroWithdrawalLines.id), fk("current_bro_withdrawal_decisions", t.decidedBy, appUsers.id),
  check("current_bro_withdrawal_decisions_decision_check", sql`decision IN ('APPROVED','REJECTED')`),
]);
