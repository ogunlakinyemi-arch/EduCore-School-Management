import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb, foreignKey, check } from "drizzle-orm/pg-core";
import { subscriptions, appUsers } from "./edupulse";
import { studentSubscriptionTerms } from "./student-subscription-terms";
import { studentSubscriptionPayments } from "./student-subscription-billing";

/** Link lifecycle only. Simulations never enter the financial payment/receipt ledger. */
export const nfcPaymentLinks = pgTable("nfc_payment_links", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull(),
  studentId: integer("student_id").notNull(),
  subscriptionId: integer("subscription_id").notNull(),
  sessionId: integer("academic_session_id").notNull(),
  termId: integer("academic_term_id").notNull(),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  reference: text("reference").notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("PENDING"),
  paymentId: integer("payment_id").references(() => studentSubscriptionPayments.id),
  expectedAllocations: jsonb("expected_allocations").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  /* Round 1: omitted. Round 2: restore nfc_payment_links_subscription_id_school_id_student_id_fkey,
   * with the original default NO ACTION delete/update actions.
  foreignKey({ columns: [t.subscriptionId, t.schoolId, t.studentId], foreignColumns: [subscriptions.id, subscriptions.schoolId, subscriptions.studentId] }),
  */
  foreignKey({ columns: [t.schoolId, t.studentId, t.sessionId, t.termId], foreignColumns: [studentSubscriptionTerms.schoolId, studentSubscriptionTerms.studentId, studentSubscriptionTerms.academicSessionId, studentSubscriptionTerms.academicTermId] }),
  check("nfc_payment_links_mode", sql`${t.mode} IN ('DEVELOPMENT_SIMULATION','FLUTTERWAVE_SANDBOX')`),
  check("nfc_payment_links_status", sql`${t.status} IN ('PENDING','SIMULATED_SUCCESS','SIMULATED_FAILED','CANCELLED')`),
  check("nfc_payment_links_isolation", sql`(${t.mode}='DEVELOPMENT_SIMULATION' AND ${t.paymentId} IS NULL) OR (${t.mode}='FLUTTERWAVE_SANDBOX' AND ${t.paymentId} IS NOT NULL AND ${t.status} IN ('PENDING','CANCELLED'))`),
]);
