import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  academicSessions,
  academicTerms,
  appUsers,
  employees,
  schools,
  subjects,
} from "./edupulse";

/**
 * School-authored calendar configuration. TERM_START and TERM_END are projected
 * directly from the authoritative academic_sessions / academic_terms rows;
 * this table only stores additional configurable or school-authored entries.
 */
export const schoolCalendarEvents = pgTable(
  "school_calendar_events",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    academicSessionId: integer("academic_session_id"),
    academicTermId: integer("academic_term_id"),
    source: text("source").notNull(),
    sourceKey: text("source_key").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    isAcademic: boolean("is_academic").notNull().default(true),
    audience: text("audience").array().notNull().default(sql`ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[]`),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedByUserId: integer("updated_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "school_calendar_events_source_check",
      sql`${table.source} IN ('GENERATED', 'SCHOOL_EVENT')`,
    ),
    check(
      "school_calendar_events_category_check",
      sql`${table.category} IN ('RESUMPTION','MID_TERM_BREAK','HOLIDAY','EXAMINATION','RESULT_PUBLICATION','SCHOOL_EVENT','OTHER')`,
    ),
    check(
      "school_calendar_events_status_check",
      sql`${table.status} IN ('ACTIVE','INACTIVE')`,
    ),
    check(
      "school_calendar_events_dates_check",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "school_calendar_events_audience_check",
      sql`cardinality(${table.audience}) > 0
        AND ${table.audience} <@ ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[]`,
    ),
    unique("school_calendar_events_id_school_tenant_key").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "school_calendar_events_session_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "school_calendar_events_term_school_fk",
    }).onDelete("restrict"),
    uniqueIndex("school_calendar_events_school_source_key_unique").on(
      table.schoolId,
      table.sourceKey,
    ),
    index("school_calendar_events_school_dates_status_idx").on(
      table.schoolId,
      table.startDate,
      table.status,
    ),
    index("school_calendar_events_school_session_term_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.academicTermId,
    ),
  ],
);

/**
 * One private, validated logo per school. Legacy/external URLs remain in the
 * existing schools.logo field until that school uploads its first managed logo.
 */
export const schoolBrandingLogos = pgTable(
  "school_branding_logos",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    updatedByUserId: integer("updated_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "school_branding_logos_content_type_check",
      sql`${table.contentType} IN ('image/jpeg','image/png','image/webp')`,
    ),
    check(
      "school_branding_logos_byte_size_check",
      sql`${table.byteSize} BETWEEN 1 AND 3145728`,
    ),
    uniqueIndex("school_branding_logos_school_unique").on(table.schoolId),
    uniqueIndex("school_branding_logos_object_path_unique").on(table.objectPath),
    index("school_branding_logos_updated_by_idx").on(table.updatedByUserId, table.updatedAt),
  ],
);

/** School-wide teacher ↔ subject ownership when no single class is specified. */
export const teacherSubjectAssignments = pgTable(
  "teacher_subject_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    subjectId: integer("subject_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: text("status").notNull().default("ACTIVE"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedByUserId: integer("updated_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "teacher_subject_assignments_dates_check",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "teacher_subject_assignments_status_check",
      sql`${table.status} IN ('ACTIVE','INACTIVE')`,
    ),
    unique("teacher_subject_assignments_id_school_tenant_key").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "teacher_subject_assignments_employee_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "teacher_subject_assignments_subject_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "teacher_subject_assignments_session_school_fk",
    }).onDelete("restrict"),
    uniqueIndex("teacher_subject_assignments_active_unique")
      .on(table.schoolId, table.employeeId, table.subjectId, table.academicSessionId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("teacher_subject_assignments_school_session_status_idx").on(
      table.schoolId,
      table.academicSessionId,
      table.status,
    ),
  ],
);

/** A weekly employee roster record, safely isolated to its home school. */
export const teacherDutyRoster = pgTable(
  "teacher_duty_roster",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id").notNull(),
    dutyRole: text("duty_role").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedByUserId: integer("updated_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "teacher_duty_roster_dates_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "teacher_duty_roster_status_check",
      sql`${table.status} IN ('ACTIVE','INACTIVE')`,
    ),
    unique("teacher_duty_roster_id_school_tenant_key").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "teacher_duty_roster_employee_school_fk",
    }).onDelete("restrict"),
    uniqueIndex("teacher_duty_roster_employee_exact_active_unique")
      .on(table.schoolId, table.employeeId, table.startDate, table.endDate)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("teacher_duty_roster_school_dates_status_idx").on(
      table.schoolId,
      table.startDate,
      table.endDate,
      table.status,
    ),
    index("teacher_duty_roster_employee_history_idx").on(
      table.schoolId,
      table.employeeId,
      table.startDate,
    ),
  ],
);