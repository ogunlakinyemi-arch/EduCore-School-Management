import {sql} from "drizzle-orm";
import {pgTable,integer,serial,text,timestamp,uniqueIndex,check} from "drizzle-orm/pg-core";
import {appUsers,schools} from "./edupulse";
export const teacherTelegramLinks=pgTable("teacher_telegram_links",{
  userId:integer("user_id").primaryKey().references(()=>appUsers.id),
  schoolId:integer("school_id").notNull().references(()=>schools.id),
  botId:text("bot_id").notNull(),chatCiphertext:text("chat_ciphertext"),chatHash:text("chat_hash"),
  consentedAt:timestamp("consented_at",{withTimezone:true}),revokedAt:timestamp("revoked_at",{withTimezone:true}),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("teacher_telegram_chat_unique").on(t.chatHash),
  check("teacher_telegram_consent_check",sql`
    (${t.consentedAt} IS NOT NULL AND ${t.revokedAt} IS NULL AND ${t.chatCiphertext} IS NOT NULL AND ${t.chatHash} IS NOT NULL)
    OR (${t.consentedAt} IS NULL AND ${t.revokedAt} IS NOT NULL AND ${t.chatCiphertext} IS NULL AND ${t.chatHash} IS NULL)`)]);
export const teacherTelegramChallenges=pgTable("teacher_telegram_challenges",{
  id:serial("id").primaryKey(),userId:integer("user_id").notNull().references(()=>appUsers.id),
  schoolId:integer("school_id").notNull().references(()=>schools.id),botId:text("bot_id").notNull(),
  tokenHash:text("token_hash").notNull(),pendingCiphertext:text("pending_ciphertext"),chatHash:text("chat_hash"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
  claimedAt:timestamp("claimed_at",{withTimezone:true}),confirmedAt:timestamp("confirmed_at",{withTimezone:true}),
  revokedAt:timestamp("revoked_at",{withTimezone:true}),
},t=>[uniqueIndex("teacher_telegram_token_unique").on(t.tokenHash),
  check("teacher_telegram_expiry_check",sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+INTERVAL '10 minutes'`)]);
