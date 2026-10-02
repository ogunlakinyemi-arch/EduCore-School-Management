import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  academicSessions,
  academicTerms,
  appUsers,
  employees,
  schoolClasses,
  schools,
  studentClassAssignments,
  students,
  subjects,
} from "./edupulse";

export const academicAssignments = pgTable(
  "academic_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    section: text("section"),
    subjectId: integer("subject_id").notNull(),
    teacherEmployeeId: integer("teacher_employee_id").notNull(),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_assignments_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_assignments_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "academic_assignments_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "academic_assignments_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "academic_assignments_subject_school_fk",
    }),
    foreignKey({
      columns: [table.teacherEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "academic_assignments_teacher_school_fk",
    }),
    check("academic_assignments_max_score_check", sql`${table.maxScore} > 0`),
    check(
      "academic_assignments_dates_check",
      sql`${table.dueDate} >= ${table.issueDate}`,
    ),
    check(
      "academic_assignments_status_check",
      sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')`,
    ),
    index("academic_assignments_school_context_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.schoolClassId,
    ),
  ],
);

export const academicAssessmentTypes = pgTable(
  "academic_assessment_types",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: text("status").notNull().default("ACTIVE"),
  },
  (table) => [
    unique("academic_assessment_types_id_school_unique").on(table.id, table.schoolId),
    unique("academic_assessment_types_school_code_unique").on(table.schoolId, table.code),
    check(
      "academic_assessment_types_status_check",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`,
    ),
    index("academic_assessment_types_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const academicAssessments = pgTable(
  "academic_assessments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    section: text("section"),
    subjectId: integer("subject_id").notNull(),
    assessmentTypeId: integer("assessment_type_id").notNull(),
    teacherEmployeeId: integer("teacher_employee_id").notNull(),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    assessmentDate: date("assessment_date", { mode: "string" }).notNull(),
    maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull(),
    status: text("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_assessments_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_assessments_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "academic_assessments_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "academic_assessments_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "academic_assessments_subject_school_fk",
    }),
    foreignKey({
      columns: [table.assessmentTypeId, table.schoolId],
      foreignColumns: [academicAssessmentTypes.id, academicAssessmentTypes.schoolId],
      name: "academic_assessments_type_school_fk",
    }),
    foreignKey({
      columns: [table.teacherEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "academic_assessments_teacher_school_fk",
    }),
    check("academic_assessments_max_score_check", sql`${table.maxScore} > 0`),
    check(
      "academic_assessments_status_check",
      sql`${table.status} IN ('DRAFT', 'OPEN', 'CLOSED', 'PUBLISHED', 'ARCHIVED')`,
    ),
    index("academic_assessments_school_context_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.schoolClassId,
    ),
  ],
);

export const academicGradingRules = pgTable(
  "academic_grading_rules",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    minScore: numeric("min_score", { precision: 10, scale: 2 }).notNull(),
    maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull(),
    grade: text("grade").notNull(),
    gradePoint: numeric("grade_point", { precision: 5, scale: 2 }),
    remark: text("remark").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_grading_rules_id_school_unique").on(table.id, table.schoolId),
    check(
      "academic_grading_rules_score_range_check",
      sql`${table.minScore} >= 0 AND ${table.maxScore} >= ${table.minScore}`,
    ),
    check(
      "academic_grading_rules_status_check",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')`,
    ),
    index("academic_grading_rules_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const academicResults = pgTable(
  "academic_results",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    assessmentId: integer("assessment_id").notNull(),
    studentId: integer("student_id").notNull(),
    studentClassAssignmentId: integer("student_class_assignment_id").notNull(),
    teacherEmployeeId: integer("teacher_employee_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    sectionSnapshot: text("section_snapshot").notNull(),
    subjectId: integer("subject_id").notNull(),
    score: numeric("score", { precision: 10, scale: 2 }).notNull(),
    maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull(),
    grade: text("grade"),
    gradePoint: numeric("grade_point", { precision: 5, scale: 2 }),
    remark: text("remark"),
    status: text("status").notNull().default("DRAFT"),
    reviewStatus: text("review_status").notNull().default("NOT_REVIEWED"),
    reviewComment: text("review_comment"),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    publishedBy: integer("published_by").references(() => appUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_results_assessment_student_unique").on(
      table.assessmentId,
      table.studentId,
    ),
    unique("academic_results_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.assessmentId, table.schoolId],
      foreignColumns: [academicAssessments.id, academicAssessments.schoolId],
      name: "academic_results_assessment_school_fk",
    }),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "academic_results_student_school_fk",
    }),
    foreignKey({
      columns: [table.studentClassAssignmentId, table.schoolId],
      foreignColumns: [studentClassAssignments.id, studentClassAssignments.schoolId],
      name: "academic_results_class_assignment_school_fk",
    }),
    foreignKey({
      columns: [table.teacherEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "academic_results_teacher_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_results_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "academic_results_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "academic_results_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "academic_results_subject_school_fk",
    }),
    check(
      "academic_results_score_check",
      sql`${table.score} >= 0 AND ${table.maxScore} > 0 AND ${table.score} <= ${table.maxScore}`,
    ),
    check(
      "academic_results_status_check",
      sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'ARCHIVED')`,
    ),
    check(
      "academic_results_publication_check",
      sql`(${table.status} = 'PUBLISHED' AND ${table.publishedBy} IS NOT NULL AND ${table.publishedAt} IS NOT NULL) OR (${table.status} <> 'PUBLISHED')`,
    ),
    index("academic_results_school_context_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.studentId,
    ),
  ],
);

export const academicReportCards = pgTable(
  "academic_report_cards",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    studentId: integer("student_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    studentClassAssignmentId: integer("student_class_assignment_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    classNameSnapshot: text("class_name_snapshot").notNull(),
    sectionSnapshot: text("section_snapshot").notNull(),
    status: text("status").notNull().default("DRAFT"),
    teacherRemark: text("teacher_remark").notNull(),
    schoolRemark: text("school_remark").notNull(),
    publishedBy: integer("published_by").references(() => appUsers.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_report_cards_student_session_term_unique").on(
      table.studentId,
      table.academicSessionId,
      table.academicTermId,
    ),
    unique("academic_report_cards_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "academic_report_cards_student_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_report_cards_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "academic_report_cards_term_school_fk",
    }),
    foreignKey({
      columns: [table.studentClassAssignmentId, table.schoolId],
      foreignColumns: [studentClassAssignments.id, studentClassAssignments.schoolId],
      name: "academic_report_cards_class_assignment_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "academic_report_cards_class_school_fk",
    }),
    check(
      "academic_report_cards_status_check",
      sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    ),
    check(
      "academic_report_cards_publication_check",
      sql`(${table.status} = 'PUBLISHED' AND ${table.publishedBy} IS NOT NULL AND ${table.publishedAt} IS NOT NULL) OR (${table.status} <> 'PUBLISHED')`,
    ),
    index("academic_report_cards_school_student_idx").on(
      table.schoolId,
      table.studentId,
      table.academicSessionId,
      table.academicTermId,
    ),
  ],
);

export const academicReportCardLines = pgTable(
  "academic_report_card_lines",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    reportCardId: integer("report_card_id").notNull(),
    resultId: integer("result_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    subjectNameSnapshot: text("subject_name_snapshot").notNull(),
    assessmentNameSnapshot: text("assessment_name_snapshot").notNull(),
    score: numeric("score", { precision: 10, scale: 2 }).notNull(),
    maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull(),
    grade: text("grade").notNull(),
    gradePoint: numeric("grade_point", { precision: 5, scale: 2 }).notNull(),
    remark: text("remark").notNull(),
  },
  (table) => [
    unique("academic_report_card_lines_id_school_unique").on(table.id, table.schoolId),
    unique("academic_report_card_lines_report_card_result_unique").on(
      table.reportCardId,
      table.resultId,
    ),
    foreignKey({
      columns: [table.reportCardId, table.schoolId],
      foreignColumns: [academicReportCards.id, academicReportCards.schoolId],
      name: "academic_report_card_lines_report_card_school_fk",
    }),
    foreignKey({
      columns: [table.resultId, table.schoolId],
      foreignColumns: [academicResults.id, academicResults.schoolId],
      name: "academic_report_card_lines_result_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "academic_report_card_lines_subject_school_fk",
    }),
    check(
      "academic_report_card_lines_score_check",
      sql`${table.score} >= 0 AND ${table.maxScore} > 0 AND ${table.score} <= ${table.maxScore}`,
    ),
    index("academic_report_card_lines_report_card_idx").on(table.schoolId, table.reportCardId),
  ],
);

export const academicTimetableEntries = pgTable(
  "academic_timetable_entries",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    schoolClassId: integer("school_class_id").notNull(),
    section: text("section").notNull(),
    subjectId: integer("subject_id").notNull(),
    teacherEmployeeId: integer("teacher_employee_id").notNull(),
    weekday: text("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    room: text("room"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("academic_timetable_entries_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_timetable_entries_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "academic_timetable_entries_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "academic_timetable_entries_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "academic_timetable_entries_subject_school_fk",
    }),
    foreignKey({
      columns: [table.teacherEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "academic_timetable_entries_teacher_school_fk",
    }),
    check(
      "academic_timetable_entries_weekday_check",
      sql`${table.weekday} IN ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')`,
    ),
    check("academic_timetable_entries_time_check", sql`${table.endTime} > ${table.startTime}`),
    check(
      "academic_timetable_entries_status_check",
      sql`${table.status} IN ('ACTIVE', 'CANCELLED', 'ARCHIVED')`,
    ),
    index("academic_timetable_entries_school_context_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
      table.schoolClassId,
      table.section,
    ),
  ],
);