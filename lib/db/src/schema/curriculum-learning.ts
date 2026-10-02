import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { academicSessions, academicTerms, appUsers, employees, schoolClasses, schools, subjects } from "./edupulse";

export const curriculumVersions = pgTable(
  "curriculum_versions",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    educationLevel: text("education_level").notNull(),
    classLevels: jsonb("class_levels").$type<string[]>().notNull().default([]),
    subjectCodes: jsonb("subject_codes").$type<string[]>().notNull().default([]),
    sourceKind: text("source_kind").notNull(),
    sourceOrganization: text("source_organization").notNull(),
    sourceReference: text("source_reference").notNull(),
    sourceVersion: text("source_version"),
    effectiveDate: date("effective_date", { mode: "string" }),
    verifiedDate: date("verified_date", { mode: "string" }),
    description: text("description"),
    sourceDocumentPath: text("source_document_path"),
    derivedFromVersionId: integer("derived_from_version_id"),
    status: text("status").notNull().default("DRAFT"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("curriculum_versions_id_unique").on(table.id),
    foreignKey({
      columns: [table.derivedFromVersionId],
      foreignColumns: [table.id],
      name: "curriculum_versions_derived_from_fk",
    }),
    check("curriculum_versions_source_kind_check", sql`${table.sourceKind} IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')`),
    check("curriculum_versions_status_check", sql`${table.status} IN ('DRAFT','PUBLISHED','ARCHIVED')`),
    index("curriculum_versions_status_idx").on(table.status, table.educationLevel),
  ],
);

export const schoolCurriculumAssignments = pgTable(
  "school_curriculum_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    curriculumVersionId: integer("curriculum_version_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    confirmedBy: integer("confirmed_by").notNull().references(() => appUsers.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_curriculum_assignments_id_school_unique").on(table.id, table.schoolId),
    uniqueIndex("school_curriculum_assignments_active_context_unique")
      .on(table.schoolId, table.schoolClassId, table.subjectId, table.academicSessionId, table.academicTermId)
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "school_curriculum_assignments_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "school_curriculum_assignments_subject_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "school_curriculum_assignments_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "school_curriculum_assignments_term_school_fk",
    }),
    foreignKey({
      columns: [table.curriculumVersionId],
      foreignColumns: [curriculumVersions.id],
      name: "school_curriculum_assignments_version_fk",
    }),
    check("school_curriculum_assignments_status_check", sql`${table.status} IN ('ACTIVE','ARCHIVED')`),
    index("school_curriculum_assignments_context_idx").on(table.schoolId, table.academicSessionId, table.academicTermId),
  ],
);

export const curriculumTopics = pgTable(
  "curriculum_topics",
  {
    id: serial("id").primaryKey(),
    curriculumVersionId: integer("curriculum_version_id"),
    schoolId: integer("school_id"),
    mappingId: integer("mapping_id"),
    classLevel: text("class_level").notNull(),
    subjectCode: text("subject_code").notNull(),
    parentTopicId: integer("parent_topic_id"),
    title: text("title").notNull(),
    learningObjectives: jsonb("learning_objectives").$type<string[]>().notNull().default([]),
    learningOutcomes: jsonb("learning_outcomes").$type<string[]>().notNull().default([]),
    suggestedResources: jsonb("suggested_resources").$type<string[]>().notNull().default([]),
    sourceKind: text("source_kind").notNull(),
    sequenceOrder: integer("sequence_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("curriculum_topics_id_version_unique").on(table.id, table.curriculumVersionId),
    unique("curriculum_topics_id_mapping_school_unique").on(table.id, table.mappingId, table.schoolId),
    foreignKey({
      columns: [table.curriculumVersionId],
      foreignColumns: [curriculumVersions.id],
      name: "curriculum_topics_version_fk",
    }),
    foreignKey({
      columns: [table.mappingId, table.schoolId],
      foreignColumns: [schoolCurriculumAssignments.id, schoolCurriculumAssignments.schoolId],
      name: "curriculum_topics_mapping_school_fk",
    }),
    check("curriculum_topics_source_check", sql`${table.sourceKind} IN ('OFFICIAL','SCHOOL_SPECIFIC','EDUCORE_SEQUENCE','AI_ASSISTANCE')`),
    check("curriculum_topics_origin_check", sql`(${table.curriculumVersionId} IS NOT NULL AND ${table.mappingId} IS NULL AND ${table.schoolId} IS NULL) OR (${table.curriculumVersionId} IS NULL AND ${table.mappingId} IS NOT NULL AND ${table.schoolId} IS NOT NULL AND ${table.sourceKind} = 'SCHOOL_SPECIFIC')`),
    index("curriculum_topics_version_class_subject_idx").on(table.curriculumVersionId, table.classLevel, table.subjectCode),
    index("curriculum_topics_mapping_idx").on(table.schoolId, table.mappingId),
  ],
);

export const curriculumProgress = pgTable(
  "curriculum_progress",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    mappingId: integer("mapping_id").notNull(),
    topicId: integer("topic_id").notNull(),
    progressStatus: text("progress_status").notNull(),
    completedDate: date("completed_date", { mode: "string" }),
    comment: text("comment"),
    updatedBy: integer("updated_by").notNull().references(() => appUsers.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("curriculum_progress_id_school_unique").on(table.id, table.schoolId),
    unique("curriculum_progress_mapping_topic_unique").on(table.schoolId, table.mappingId, table.topicId),
    foreignKey({
      columns: [table.mappingId, table.schoolId],
      foreignColumns: [schoolCurriculumAssignments.id, schoolCurriculumAssignments.schoolId],
      name: "curriculum_progress_mapping_school_fk",
    }),
    check("curriculum_progress_status_check", sql`${table.progressStatus} IN ('PLANNED','IN_PROGRESS','COMPLETED','DEFERRED')`),
    index("curriculum_progress_school_mapping_idx").on(table.schoolId, table.mappingId),
  ],
);

export const curriculumImports = pgTable(
  "curriculum_imports",
  {
    id: serial("id").primaryKey(),
    uploadedBy: integer("uploaded_by").notNull().references(() => appUsers.id),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    objectPath: text("object_path").notNull(),
    detectedType: text("detected_type").notNull(),
    previewRows: jsonb("preview_rows").$type<Array<Record<string, string>>>().notNull(),
    headers: jsonb("headers").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedVersionId: integer("confirmed_version_id").references(() => curriculumVersions.id),
  },
  (table) => [
    unique("curriculum_imports_id_unique").on(table.id),
    index("curriculum_imports_owner_created_idx").on(table.uploadedBy, table.createdAt),
  ],
);

export const lessonNotes = pgTable(
  "lesson_notes",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    teacherEmployeeId: integer("teacher_employee_id").notNull(),
    section: text("section"),
    week: integer("week").notNull(),
    lessonDate: date("lesson_date", { mode: "string" }).notNull(),
    curriculumMappingId: integer("curriculum_mapping_id"),
    curriculumVersionId: integer("curriculum_version_id"),
    topicId: integer("topic_id"),
    subTopicId: integer("sub_topic_id"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("DRAFT"),
    revision: integer("revision").notNull().default(0),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("lesson_notes_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "lesson_notes_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "lesson_notes_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "lesson_notes_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "lesson_notes_subject_school_fk",
    }),
    foreignKey({
      columns: [table.teacherEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "lesson_notes_teacher_school_fk",
    }),
    foreignKey({
      columns: [table.curriculumMappingId, table.schoolId],
      foreignColumns: [schoolCurriculumAssignments.id, schoolCurriculumAssignments.schoolId],
      name: "lesson_notes_mapping_school_fk",
    }),
    foreignKey({
      columns: [table.curriculumVersionId],
      foreignColumns: [curriculumVersions.id],
      name: "lesson_notes_version_fk",
    }),
    check("lesson_notes_week_check", sql`${table.week} BETWEEN 1 AND 60`),
    check("lesson_notes_revision_check", sql`${table.revision} >= 0`),
    check("lesson_notes_status_check", sql`${table.status} IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED','ARCHIVED')`),
    uniqueIndex("lesson_notes_week_assignment_unique").on(
      table.schoolId, table.academicSessionId, table.academicTermId, table.teacherEmployeeId,
      table.schoolClassId, table.subjectId, table.week, sql`COALESCE(${table.section}, '')`,
    ),
    index("lesson_notes_weekly_idx").on(table.schoolId, table.academicSessionId, table.academicTermId, table.week, table.status),
    index("lesson_notes_teacher_context_idx").on(table.schoolId, table.teacherEmployeeId, table.academicSessionId, table.academicTermId),
  ],
);

export const lessonNoteReviews = pgTable(
  "lesson_note_reviews",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    lessonNoteId: integer("lesson_note_id").notNull(),
    reviewerUserId: integer("reviewer_user_id").notNull().references(() => appUsers.id),
    decision: text("decision").notNull(),
    comment: text("comment"),
    noteRevision: integer("note_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.lessonNoteId, table.schoolId],
      foreignColumns: [lessonNotes.id, lessonNotes.schoolId],
      name: "lesson_note_reviews_note_school_fk",
    }),
    check("lesson_note_reviews_decision_check", sql`${table.decision} IN ('RETURN','APPROVE')`),
    check("lesson_note_reviews_return_comment_check", sql`${table.decision} <> 'RETURN' OR length(btrim(COALESCE(${table.comment},''))) > 0`),
    index("lesson_note_reviews_note_history_idx").on(table.schoolId, table.lessonNoteId, table.createdAt),
  ],
);

export const insertCurriculumVersionSchema = createInsertSchema(curriculumVersions).omit({ id: true, createdAt: true, publishedAt: true, archivedAt: true });
export const insertSchoolCurriculumAssignmentSchema = createInsertSchema(schoolCurriculumAssignments).omit({ id: true, confirmedAt: true });
export const insertCurriculumTopicSchema = createInsertSchema(curriculumTopics).omit({ id: true, createdAt: true });
export const insertCurriculumProgressSchema = createInsertSchema(curriculumProgress).omit({ id: true, updatedAt: true });
export const insertLessonNoteSchema = createInsertSchema(lessonNotes).omit({ id: true, revision: true, submittedAt: true, approvedAt: true, createdAt: true, updatedAt: true });
export const insertLessonNoteReviewSchema = createInsertSchema(lessonNoteReviews).omit({ id: true, createdAt: true });

export type CurriculumVersion = typeof curriculumVersions.$inferSelect;
export type InsertCurriculumVersion = z.infer<typeof insertCurriculumVersionSchema>;
export type SchoolCurriculumAssignment = typeof schoolCurriculumAssignments.$inferSelect;
export type CurriculumTopic = typeof curriculumTopics.$inferSelect;
export type CurriculumProgress = typeof curriculumProgress.$inferSelect;
export type LessonNote = typeof lessonNotes.$inferSelect;
export type LessonNoteReview = typeof lessonNoteReviews.$inferSelect;