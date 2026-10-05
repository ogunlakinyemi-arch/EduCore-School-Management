import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, numeric, jsonb, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { schools, appUsers, academicSessions, academicTerms, schoolClasses, subjects, employees } from "./edupulse";

const scope = () => ({
  id: serial("id").primaryKey(), schoolId: integer("school_id").notNull().references(() => schools.id),
  academicSessionId: integer("academic_session_id").notNull(), academicTermId: integer("academic_term_id").notNull(),
  schoolClassId: integer("school_class_id").notNull(), section: text("section").notNull().default(""),
  subjectId: integer("subject_id").notNull(), teacherEmployeeId: integer("teacher_employee_id").notNull(),
  status: text("status").notNull().default("DRAFT"), revision: integer("revision").notNull().default(0),
  createdBy: integer("created_by").notNull().references(() => appUsers.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
function scopeKeys(t: any, prefix: string) {
  return [
    unique(`${prefix}_id_school_unique`).on(t.id,t.schoolId),
    foreignKey({columns:[t.academicSessionId,t.schoolId],foreignColumns:[academicSessions.id,academicSessions.schoolId],name:`${prefix}_session_fk`}),
    foreignKey({columns:[t.academicTermId,t.schoolId],foreignColumns:[academicTerms.id,academicTerms.schoolId],name:`${prefix}_term_fk`}),
    foreignKey({columns:[t.schoolClassId,t.schoolId],foreignColumns:[schoolClasses.id,schoolClasses.schoolId],name:`${prefix}_class_fk`}),
    foreignKey({columns:[t.subjectId,t.schoolId],foreignColumns:[subjects.id,subjects.schoolId],name:`${prefix}_subject_fk`}),
    foreignKey({columns:[t.teacherEmployeeId,t.schoolId],foreignColumns:[employees.id,employees.schoolId],name:`${prefix}_teacher_fk`}),
    check(`${prefix}_revision_check`,sql`${t.revision}>=0`),
  ];
}
export const academicResultBatches = pgTable("academic_result_batches", {
  ...scope(), components: jsonb("components").notNull().default([]), returnComment: text("return_comment"),
},t=>[
  ...scopeKeys(t,"academic_result_batches"),
  unique("academic_result_batches_context_unique").on(t.schoolId,t.academicSessionId,t.academicTermId,t.schoolClassId,t.section,t.subjectId),
  check("academic_result_batches_status_check",sql`${t.status} IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','LOCKED')`),
  check("academic_result_batches_components_check",sql`jsonb_typeof(${t.components})='array'`),
  index("academic_result_batches_teacher_idx").on(t.schoolId,t.teacherEmployeeId,t.academicSessionId,t.academicTermId),
]);
export const examQuestionPapers = pgTable("exam_question_papers", {
  ...scope(), examinationName: text("examination_name").notNull(), instructions: text("instructions").notNull().default(""),
  duration: text("duration"), totalMarks: numeric("total_marks",{precision:10,scale:2}),
  approvedAt: timestamp("approved_at",{withTimezone:true}),
},t=>[
  ...scopeKeys(t,"exam_question_papers"),
  check("exam_question_papers_status_check",sql`${t.status} IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED')`),
  check("exam_question_papers_marks_check",sql`${t.totalMarks} IS NULL OR ${t.totalMarks}>0`),
  check("exam_question_papers_approval_check",sql`${t.status}<>'APPROVED' OR ${t.approvedAt} IS NOT NULL`),
  index("exam_question_papers_context_idx").on(t.schoolId,t.academicSessionId,t.academicTermId,t.schoolClassId,t.section,t.subjectId),
]);
export const examQuestionVersions = pgTable("exam_question_versions",{
  id:serial("id").primaryKey(), schoolId:integer("school_id").notNull().references(()=>schools.id), paperId:integer("paper_id").notNull(),
  revision:integer("revision").notNull(),filename:text("filename").notNull(),mimeType:text("mime_type").notNull(),
  objectPath:text("object_path").notNull(),sha256:text("sha256").notNull(),previewText:text("preview_text").notNull().default(""),
  createdBy:integer("created_by").notNull().references(()=>appUsers.id),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  unique("exam_question_versions_id_school_unique").on(t.id,t.schoolId),
  unique("exam_question_versions_paper_revision_unique").on(t.paperId,t.revision),
  foreignKey({columns:[t.paperId,t.schoolId],foreignColumns:[examQuestionPapers.id,examQuestionPapers.schoolId],name:"exam_question_versions_paper_fk"}),
  check("exam_question_versions_revision_check",sql`${t.revision}>0`),
  check("exam_question_versions_object_check",sql`${t.objectPath} LIKE '/objects/exam-questions/%'`),
  check("exam_question_versions_sha_check",sql`length(${t.sha256})=64`),
]);
export const examQuestionReviews = pgTable("exam_question_reviews",{
  id:serial("id").primaryKey(),schoolId:integer("school_id").notNull().references(()=>schools.id),
  paperId:integer("paper_id").notNull(),versionId:integer("version_id").notNull(),
  reviewerUserId:integer("reviewer_user_id").notNull().references(()=>appUsers.id),decision:text("decision").notNull(),
  comment:text("comment").notNull().default(""),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  foreignKey({columns:[t.paperId,t.schoolId],foreignColumns:[examQuestionPapers.id,examQuestionPapers.schoolId],name:"exam_question_reviews_paper_fk"}),
  foreignKey({columns:[t.versionId,t.schoolId],foreignColumns:[examQuestionVersions.id,examQuestionVersions.schoolId],name:"exam_question_reviews_version_fk"}),
  check("exam_question_reviews_decision_check",sql`${t.decision} IN ('RETURN','APPROVE')`),
  check("exam_question_reviews_reason_check",sql`${t.decision}<>'RETURN' OR length(btrim(${t.comment}))>0`),
  index("exam_question_reviews_history_idx").on(t.schoolId,t.paperId,t.createdAt),
]);
export const insertAcademicResultBatchSchema = createInsertSchema(academicResultBatches).omit({id:true,createdAt:true,updatedAt:true});
export const insertExamQuestionPaperSchema = createInsertSchema(examQuestionPapers).omit({id:true,createdAt:true,updatedAt:true});
export const insertExamQuestionVersionSchema = createInsertSchema(examQuestionVersions).omit({id:true,createdAt:true});
export const insertExamQuestionReviewSchema = createInsertSchema(examQuestionReviews).omit({id:true,createdAt:true});
export type AcademicResultBatch = typeof academicResultBatches.$inferSelect;
export type ExamQuestionPaper = typeof examQuestionPapers.$inferSelect;
export type ExamQuestionVersion = typeof examQuestionVersions.$inferSelect;
export type ExamQuestionReview = typeof examQuestionReviews.$inferSelect;
