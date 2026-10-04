import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { appUsers, schools, students, nfcCards } from "./edupulse";
import { feeInvoices } from "./finance";

export const studentNfcReplacementRequests = pgTable("student_nfc_replacement_requests", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  studentId: integer("student_id").notNull(),
  oldCardId: integer("old_card_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  requestedBy: integer("requested_by").notNull().references(() => appUsers.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("REQUESTED"),
  newCardId: integer("new_card_id"),
  issuedBy: integer("issued_by").references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
}, t => [
  unique("student_nfc_replacement_requests_old_card_id_key").on(t.oldCardId),
  unique("student_nfc_replacement_requests_invoice_id_key").on(t.invoiceId),
  unique("student_nfc_replacement_requests_new_card_id_key").on(t.newCardId),
  foreignKey({ columns: [t.studentId, t.schoolId], foreignColumns: [students.id, students.schoolId] }),
  foreignKey({ columns: [t.oldCardId, t.schoolId], foreignColumns: [nfcCards.id, nfcCards.schoolId] }),
  foreignKey({ columns: [t.newCardId, t.schoolId], foreignColumns: [nfcCards.id, nfcCards.schoolId] }),
  foreignKey({ columns: [t.invoiceId, t.schoolId], foreignColumns: [feeInvoices.id, feeInvoices.schoolId] }),
  check("student_nfc_replacement_requests_status_check", sql`${t.status} IN ('REQUESTED','ISSUED')`),
  check("student_nfc_replacement_requests_check", sql`${t.oldCardId} IS DISTINCT FROM ${t.newCardId}`),
  check("student_nfc_replacement_requests_check1", sql`(${t.status}='REQUESTED' AND ${t.newCardId} IS NULL AND ${t.issuedBy} IS NULL AND ${t.issuedAt} IS NULL) OR (${t.status}='ISSUED' AND ${t.newCardId} IS NOT NULL AND ${t.issuedBy} IS NOT NULL AND ${t.issuedAt} IS NOT NULL)`),
  index("student_nfc_replacement_school_idx").on(t.schoolId,t.studentId),
]);