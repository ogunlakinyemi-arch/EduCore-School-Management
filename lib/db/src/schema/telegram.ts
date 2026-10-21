import {sql} from "drizzle-orm";
import {pgTable,integer,serial,text,timestamp,uniqueIndex,check} from "drizzle-orm/pg-core";
import {parents,schools} from "./edupulse";
export const parentTelegramLinks=pgTable("parent_telegram_links",{
  parentId:integer("parent_id").primaryKey().references(()=>parents.id),
  botId:text("bot_id").notNull(),
  chatCiphertext:text("chat_ciphertext"),
  chatHash:text("chat_hash"),
  consentedAt:timestamp("consented_at",{withTimezone:true}),
  revokedAt:timestamp("revoked_at",{withTimezone:true}),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex("parent_telegram_links_chat_unique").on(t.chatHash),
  check("parent_telegram_links_consent_check",sql`
    (${t.consentedAt} IS NOT NULL AND ${t.revokedAt} IS NULL AND ${t.chatCiphertext} IS NOT NULL AND ${t.chatHash} IS NOT NULL)
    OR (${t.consentedAt} IS NULL AND ${t.revokedAt} IS NOT NULL AND ${t.chatCiphertext} IS NULL AND ${t.chatHash} IS NULL)`),
]);
export const telegramLinkChallenges=pgTable("telegram_link_challenges",{
  id:serial("id").primaryKey(),
  parentId:integer("parent_id").notNull().references(()=>parents.id),
  schoolId:integer("school_id").notNull().references(()=>schools.id),
  botId:text("bot_id").notNull(),
  tokenHash:text("token_hash").notNull(),
  pendingCiphertext:text("pending_ciphertext"),
  chatHash:text("chat_hash"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
  claimedAt:timestamp("claimed_at",{withTimezone:true}),
  confirmedAt:timestamp("confirmed_at",{withTimezone:true}),
  revokedAt:timestamp("revoked_at",{withTimezone:true}),
},t=>[
  uniqueIndex("telegram_link_challenges_token_unique").on(t.tokenHash),
  check("telegram_link_challenges_expiry_check",sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+INTERVAL '10 minutes'`),
]);
export const telegramPollState=pgTable("telegram_poll_state",{
  id:integer("id").primaryKey(),botId:text("bot_id").notNull(),
  lastUpdateId:integer("last_update_id").notNull().default(0),
},t=>[check("telegram_poll_state_singleton",sql`${t.id}=1 AND ${t.lastUpdateId}>=0`)]);
