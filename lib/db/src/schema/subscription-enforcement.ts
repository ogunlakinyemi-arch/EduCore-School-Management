import { boolean, foreignKey, integer, jsonb, pgTable, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { academicTerms, schools } from "./edupulse";

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