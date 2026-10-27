import { pgTable, text, integer, timestamp, date, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUsers, schools, students, academicTerms } from "./edupulse";

/** Evidence metadata, not a payment/credit ledger. File bytes live only in private App Storage. */
export const paymentReceiptUploads = pgTable("payment_receipt_uploads", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  schoolId: integer("school_id").notNull().references(() => schools.id),
  studentId: integer("student_id").references(() => students.id),
  termId: integer("term_id").references(() => academicTerms.id),
  amountMinor: integer("amount_minor").notNull(),
  purpose: text("purpose").notNull(),
  transferDate: date("transfer_date", { mode: "string" }).notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => appUsers.id),
  state: text("state").notNull().default("STAGED"),
  objectPath: text("object_path"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  canonicalReceiptId: text("canonical_receipt_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
}, t => [
  uniqueIndex("payment_receipts_target_digest_uq").on(t.kind, t.targetId, t.sha256)
    .where(sql`${t.state}='AVAILABLE'`),
  check("payment_receipts_kind_ck", sql`${t.kind} IN ('PARENT_BANK_TRANSFER','SCHOOL_SETTLEMENT')`),
  check("payment_receipts_state_ck", sql`${t.state} IN ('STAGED','AVAILABLE','DUPLICATE')`),
  check("payment_receipts_amount_ck", sql`${t.amountMinor}>0 AND length(btrim(${t.purpose})) BETWEEN 3 AND 300`),
  check("payment_receipts_available_ck", sql`${t.state}<>'AVAILABLE' OR (
    ${t.objectPath} IS NOT NULL AND ${t.sha256} IS NOT NULL AND ${t.sha256} ~ '^[a-f0-9]{64}$'
    AND ${t.contentType} IS NOT NULL AND ${t.contentType} IN ('image/png','image/jpeg','application/pdf')
    AND ${t.sizeBytes} IS NOT NULL AND ${t.sizeBytes} BETWEEN 1 AND 5242880 AND ${t.uploadedAt} IS NOT NULL)`),
]);
