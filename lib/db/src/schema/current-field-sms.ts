/** Structural evidence only; importing these models never sends a message. */
import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, integer, text, boolean, jsonb, timestamp, unique, check } from "drizzle-orm/pg-core";
import { appUsers } from "./edupulse";
import { broFieldLeads } from "./current-finance-prerequisites";
import { sourceReference as fk, sourceKeyName as key } from "./current-finance-keys";
export const fieldSmsPermissions = pgTable("bro_field_sms_permissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(), leadId: bigint("lead_id", { mode: "number" }).notNull(),
  allowed: boolean("allowed").notNull(), phone: text("phone").notNull(), reason: text("reason").notNull(),
  actorUserId: integer("actor_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [fk("bro_field_sms_permissions", t.leadId, broFieldLeads.id), fk("bro_field_sms_permissions", t.actorUserId, appUsers.id)]);
export const fieldSmsCampaigns = pgTable("bro_field_sms_campaigns", {
  id: bigserial("id", { mode: "number" }).primaryKey(), requestKey: text("request_key").notNull().unique("bro_field_sms_campaigns_request_key_key"),
  message: text("message").notNull(), digest: text("digest").notNull(), snapshot: jsonb("snapshot").notNull(),
  createdBy: integer("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("bro_field_sms_campaigns", t.createdBy, appUsers.id),
  check("bro_field_sms_campaigns_message_check", sql`length(message) BETWEEN 1 AND 1000`),
]);
export const fieldSmsRecipients = pgTable("bro_field_sms_recipients", {
  id: bigserial("id", { mode: "number" }).primaryKey(), campaignId: bigint("campaign_id", { mode: "number" }).notNull(),
  leadId: bigint("lead_id", { mode: "number" }).notNull(), phone: text("phone").notNull(), schoolName: text("school_name").notNull(),
}, t => [
  fk("bro_field_sms_recipients", t.campaignId, fieldSmsCampaigns.id), fk("bro_field_sms_recipients", t.leadId, broFieldLeads.id),
  unique(key("bro_field_sms_recipients", ["campaign_id", "phone"])).on(t.campaignId, t.phone),
  unique(key("bro_field_sms_recipients", ["campaign_id", "lead_id"])).on(t.campaignId, t.leadId),
]);
export const fieldSmsEvents = pgTable("bro_field_sms_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), recipientId: bigint("recipient_id", { mode: "number" }).notNull(),
  state: text("state").notNull(), actorUserId: integer("actor_user_id").notNull(), details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  fk("bro_field_sms_events", t.recipientId, fieldSmsRecipients.id), fk("bro_field_sms_events", t.actorUserId, appUsers.id),
  check("bro_field_sms_events_state_check", sql`state IN ('PROCESSING','UNKNOWN','ACCEPTED','DELIVERED','FAILED','EXCLUDED')`),
]);
