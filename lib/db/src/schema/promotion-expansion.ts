import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  academicSessions,
  academicTerms,
  appUsers,
  schoolClasses,
  schools,
  studentClassAssignments,
  students,
} from "./edupulse";

export const promotionBatches = pgTable(
  "promotion_batches",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    sourceSessionId: integer("source_session_id").notNull(),
    targetSessionId: integer("target_session_id").notNull(),
    status: text("status").notNull().default("PREPARED"),
    idempotencyActorUserId: integer("idempotency_actor_user_id").notNull().references(() => appUsers.id),
    idempotencyKey: text("idempotency_key").notNull(),
    preparedBy: integer("prepared_by").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedBy: integer("finalized_by").references(() => appUsers.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizationActorUserId: integer("finalization_actor_user_id").references(() => appUsers.id),
    finalizationIdempotencyKey: text("finalization_idempotency_key"),
  },
  (table) => [
    check("promotion_batches_status_check", sql`${table.status} IN ('PREPARED', 'FINALIZED')`),
    check("promotion_batches_distinct_sessions_check", sql`${table.sourceSessionId} <> ${table.targetSessionId}`),
    check(
      "promotion_batches_finalization_shape_check",
      sql`(${table.status} = 'PREPARED' AND ${table.finalizedBy} IS NULL AND ${table.finalizedAt} IS NULL AND ${table.finalizationActorUserId} IS NULL AND ${table.finalizationIdempotencyKey} IS NULL) OR (${table.status} = 'FINALIZED' AND ${table.finalizedBy} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL AND ${table.finalizationActorUserId} IS NOT NULL AND ${table.finalizationIdempotencyKey} IS NOT NULL)`,
    ),
    unique("promotion_batches_id_school_unique").on(table.id, table.schoolId),
    unique("promotion_batches_session_pair_unique").on(table.schoolId, table.sourceSessionId, table.targetSessionId),
    unique("promotion_batches_idempotency_unique").on(table.schoolId, table.idempotencyActorUserId, table.idempotencyKey),
    unique("promotion_batches_finalization_idempotency_unique").on(
      table.schoolId,
      table.finalizationActorUserId,
      table.finalizationIdempotencyKey,
    ),
    foreignKey({
      columns: [table.sourceSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "promotion_batches_source_session_school_fk",
    }),
    foreignKey({
      columns: [table.targetSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "promotion_batches_target_session_school_fk",
    }),
    index("promotion_batches_school_created_idx").on(table.schoolId, table.createdAt),
  ],
);

export const promotionBatchStudents = pgTable(
  "promotion_batch_students",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    batchId: integer("batch_id").notNull(),
    studentId: integer("student_id").notNull(),
    studentNameSnapshot: text("student_name_snapshot").notNull(),
    admissionNoSnapshot: text("admission_no_snapshot").notNull(),
    sourceAssignmentId: integer("source_assignment_id").notNull(),
    sourceSessionId: integer("source_session_id").notNull(),
    sourceTermId: integer("source_term_id"),
    sourceClassId: integer("source_class_id").notNull(),
    sourceClassName: text("source_class_name").notNull(),
    sourceSection: text("source_section").notNull(),
    recommendation: text("recommendation").notNull(),
    status: text("status").notNull().default("Pending"),
    reason: text("reason"),
    academicPerformance: jsonb("academic_performance").notNull(),
    attendanceSummary: jsonb("attendance_summary").notNull(),
    targetTermId: integer("target_term_id"),
    targetClassId: integer("target_class_id"),
    targetSection: text("target_section"),
    reviewedBy: integer("reviewed_by").references(() => appUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "promotion_batch_students_status_check",
      sql`${table.status} IN ('Pending', 'Eligible', 'Promoted', 'Repeat', 'Graduated', 'Withdrawn', 'Transferred')`,
    ),
    check("promotion_batch_students_recommendation_check", sql`${table.recommendation} IN ('Pending', 'Eligible')`),
    check(
      "promotion_batch_students_target_required_check",
      sql`((${table.status} IN ('Promoted', 'Repeat') AND ${table.targetTermId} IS NOT NULL AND ${table.targetClassId} IS NOT NULL AND ${table.targetSection} IS NOT NULL AND length(btrim(${table.targetSection})) > 0) OR (${table.status} NOT IN ('Promoted', 'Repeat') AND ${table.targetTermId} IS NULL AND ${table.targetClassId} IS NULL AND ${table.targetSection} IS NULL))`,
    ),
    check(
      "promotion_batch_students_review_shape_check",
      sql`(${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL) OR (${table.reviewedAt} IS NOT NULL AND ${table.reviewedBy} IS NOT NULL AND ${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`,
    ),
    unique("promotion_batch_students_id_school_unique").on(table.id, table.schoolId),
    unique("promotion_batch_students_batch_student_unique").on(table.batchId, table.studentId),
    foreignKey({
      columns: [table.batchId, table.schoolId],
      foreignColumns: [promotionBatches.id, promotionBatches.schoolId],
      name: "promotion_batch_students_batch_school_fk",
    }),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "promotion_batch_students_student_school_fk",
    }),
    foreignKey({
      columns: [table.sourceAssignmentId, table.schoolId],
      foreignColumns: [studentClassAssignments.id, studentClassAssignments.schoolId],
      name: "promotion_batch_students_assignment_school_fk",
    }),
    foreignKey({
      columns: [table.sourceSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "promotion_batch_students_source_session_school_fk",
    }),
    foreignKey({
      columns: [table.sourceTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "promotion_batch_students_source_term_school_fk",
    }),
    foreignKey({
      columns: [table.sourceClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "promotion_batch_students_source_class_school_fk",
    }),
    foreignKey({
      columns: [table.targetTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "promotion_batch_students_target_term_school_fk",
    }),
    foreignKey({
      columns: [table.targetClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "promotion_batch_students_target_class_school_fk",
    }),
    index("promotion_batch_students_batch_status_idx").on(table.batchId, table.status),
    index("promotion_batch_students_student_idx").on(table.schoolId, table.studentId, table.createdAt),
  ],
);

export const promotionHistory = pgTable(
  "promotion_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    batchId: integer("batch_id"),
    batchStudentId: integer("batch_student_id"),
    studentId: integer("student_id"),
    actorUserId: integer("actor_user_id").references(() => appUsers.id),
    eventType: text("event_type").notNull(),
    result: text("result").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "promotion_history_event_check",
      sql`${table.eventType} IN ('BATCH_PREPARED', 'STUDENT_SNAPSHOTTED', 'STUDENT_REVIEWED', 'STUDENT_FINALIZED', 'BATCH_FINALIZED', 'FINALIZATION_REJECTED')`,
    ),
    check("promotion_history_result_check", sql`${table.result} IN ('SUCCESS', 'REJECTED')`),
    foreignKey({
      columns: [table.batchId, table.schoolId],
      foreignColumns: [promotionBatches.id, promotionBatches.schoolId],
      name: "promotion_history_batch_school_fk",
    }),
    foreignKey({
      columns: [table.batchStudentId, table.schoolId],
      foreignColumns: [promotionBatchStudents.id, promotionBatchStudents.schoolId],
      name: "promotion_history_student_batch_school_fk",
    }),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "promotion_history_student_school_fk",
    }),
    index("promotion_history_school_created_idx").on(table.schoolId, table.createdAt, table.id),
    index("promotion_history_student_idx").on(table.schoolId, table.studentId, table.createdAt),
  ],
);