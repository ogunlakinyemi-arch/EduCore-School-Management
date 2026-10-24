import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUsers } from "./edupulse";

export const partnerAccountReapplications = pgTable("partner_account_reapplications", {
  id: serial("id").primaryKey(),
  newUserId: integer("new_user_id").notNull().references(() => appUsers.id),
  clerkUserId: text("clerk_user_id").notNull(),
  email: text("email").notNull(),
  initialSessionId: text("initial_session_id").notNull(),
  previousUserIds: integer("previous_user_ids").array().notNull(),
  previousPartnerIds: integer("previous_partner_ids").array().notNull(),
  archiveBatchIds: text("archive_batch_ids").array().notNull(),
  requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("partner_reapplications_user_unique").on(t.newUserId),
  uniqueIndex("partner_reapplications_initial_session_unique").on(t.initialSessionId),
  index("partner_reapplications_subject_idx").on(t.clerkUserId, t.id),
  check("partner_reapplications_email_check", sql`${t.email}=lower(btrim(${t.email}))`),
]);

export const partnerReapplicationSessions = pgTable("partner_reapplication_sessions", {
  sessionId: text("session_id").primaryKey(),
  reapplicationId: integer("reapplication_id").notNull().references(() => partnerAccountReapplications.id),
  clerkUserId: text("clerk_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
