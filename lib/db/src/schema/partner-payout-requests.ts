import { sql } from "drizzle-orm";
import { pgTable, text, integer, jsonb, timestamp, unique, check } from "drizzle-orm/pg-core";
import { appUsers, partnerPayouts } from "./edupulse";

/** Platform-wide request identity: every replay still requires PLATFORM_OWNER authorization. */
export const partnerPayoutRequests = pgTable("partner_payout_requests", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  requestHash: text("request_hash").notNull(),
  payoutId: integer("payout_id").notNull().references(() => partnerPayouts.id, { onDelete: "restrict" }),
  responseSnapshot: jsonb("response_snapshot").notNull(),
  createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("partner_payout_requests_payout_unique").on(t.payoutId),
  check("partner_payout_requests_key_check", sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{8,100}$'`),
  check("partner_payout_requests_hash_check", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("partner_payout_requests_response_check", sql`jsonb_typeof(${t.responseSnapshot}) = 'object'`),
]);
