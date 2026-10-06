import { sql } from "drizzle-orm";
import { pgTable,integer,timestamp,primaryKey,unique,foreignKey,check } from "drizzle-orm/pg-core";
import { schools,students,subscriptions,academicSessions,academicTerms } from "./edupulse";
import { feeInvoices } from "./finance";

/** Academic identity for the existing ledger, never a second fee/payment ledger. */
export const studentSubscriptionTerms=pgTable("student_subscription_terms",{
  schoolId:integer("school_id").notNull().references(()=>schools.id),
  studentId:integer("student_id").notNull(),
  academicSessionId:integer("academic_session_id").notNull(),
  academicTermId:integer("academic_term_id").notNull(),
  subscriptionId:integer("subscription_id"),
  legacyInvoiceId:integer("legacy_invoice_id"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  primaryKey({columns:[t.schoolId,t.studentId,t.academicSessionId,t.academicTermId]}),
  unique().on(t.subscriptionId),
  foreignKey({columns:[t.studentId,t.schoolId],foreignColumns:[students.id,students.schoolId]}),
  foreignKey({columns:[t.academicSessionId,t.schoolId],foreignColumns:[academicSessions.id,academicSessions.schoolId]}),
  foreignKey({columns:[t.academicTermId,t.schoolId,t.academicSessionId],foreignColumns:[academicTerms.id,academicTerms.schoolId,academicTerms.academicSessionId]}),
  foreignKey({columns:[t.subscriptionId,t.schoolId,t.studentId],foreignColumns:[subscriptions.id,subscriptions.schoolId,subscriptions.studentId]}),
  foreignKey({columns:[t.legacyInvoiceId,t.schoolId],foreignColumns:[feeInvoices.id,feeInvoices.schoolId]}),
  check("student_subscription_terms_one_source",sql`(${t.subscriptionId} IS NOT NULL)::integer + (${t.legacyInvoiceId} IS NOT NULL)::integer = 1`),
]);
