import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, jsonb, timestamp, foreignKey, check, index, unique } from "drizzle-orm/pg-core";
import { lessonNotes } from "./curriculum-learning";
import { appUsers } from "./edupulse";

export const lessonNoteDocuments = pgTable("lesson_note_documents", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull(),
  noteId: integer("lesson_note_id").notNull(),
  noteRevision: integer("note_revision").notNull(),
  filename: text("filename").notNull(),
  byteSize: integer("byte_size").notNull(),
  stagingPath: text("staging_path").notNull(),
  objectPath: text("object_path").notNull(),
  sha256: text("sha256"),
  context: jsonb("context").notNull(),
  status: text("status").notNull().default("PENDING"),
  uploadedBy: integer("uploaded_by").notNull().references(() => appUsers.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
}, t => [
  foreignKey({ columns: [t.noteId, t.schoolId], foreignColumns: [lessonNotes.id, lessonNotes.schoolId], name: "lesson_document_note_school_fk" }),
  unique("lesson_document_object_path_unique").on(t.objectPath),
  check("lesson_document_status_check", sql`${t.status} IN ('PENDING','READY')`),
  check("lesson_document_bytes_check", sql`${t.byteSize} BETWEEN 1 AND 10485760`),
  index("lesson_document_note_idx").on(t.schoolId, t.noteId, t.status),
]);
