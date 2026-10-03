import { boolean, foreignKey, integer, jsonb, pgTable, primaryKey, timestamp, text, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { academicTerms, schools, appUsers } from "./edupulse";

// Independent restrictions: never replace NFC lifecycle status or delete history.
export const schoolSubscriptionEnforcement = pgTable("school_subscription_enforcement", {
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
  academicTermId: integer("academic_term_id").notNull(),
  restrictedStudentIds: integer("restricted_student_ids").array().notNull().default([]),
  schoolLocked: boolean("school_locked").notNull().default(false),
  version: integer("version").notNull().default(0),
  snapshot: jsonb("snapshot").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.schoolId, table.academicTermId] }),
  foreignKey({
    columns: [table.academicTermId, table.schoolId],
    foreignColumns: [academicTerms.id, academicTerms.schoolId],
    name: "subscription_enforcement_term_school_fk",
  }),
]);

// Explicit Owner control is independent of terms and of the billing ledger.
export const schoolSubscriptionManualLocks = pgTable("school_subscription_manual_locks", {
  schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
  locked: boolean("locked").notNull().default(false),
  version: integer("version").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedByUserId: integer("locked_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
  lastUnlockedAt: timestamp("last_unlocked_at", { withTimezone: true }),
  lastUnlockedByUserId: integer("last_unlocked_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("school_manual_lock_version_nonnegative", sql`${table.version} >= 0`)]);

export const insertSchoolSubscriptionManualLockSchema = createInsertSchema(schoolSubscriptionManualLocks);
export type SchoolSubscriptionManualLock = typeof schoolSubscriptionManualLocks.$inferSelect;