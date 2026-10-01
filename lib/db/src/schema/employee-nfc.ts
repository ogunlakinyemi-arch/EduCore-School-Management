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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { appUsers, employees, nfcCards, schools } from "./edupulse";
import { attendanceEvents } from "./edupulse";

/**
 * An employee binding is distinct from a card's existing student_id. Student
 * cards and provisioned-but-unassigned cards keep the existing card lifecycle.
 * Replacements are retained as rows and changed to REPLACED, never deleted.
 */
export const employeeNfcCardBindings = pgTable(
  "employee_nfc_card_bindings",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    nfcCardId: integer("nfc_card_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    status: text("status").notNull().default("ASSIGNED"),
    createdByUserId: integer("created_by_user_id").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "employee_nfc_card_bindings_status_check",
      sql`${table.status} IN ('ASSIGNED', 'ACTIVE', 'LOCKED', 'DEACTIVATED', 'REPLACED')`,
    ),
    uniqueIndex("employee_nfc_card_bindings_card_unique").on(table.nfcCardId),
    uniqueIndex("employee_nfc_card_bindings_id_school_unique").on(table.id, table.schoolId),
    uniqueIndex("employee_nfc_card_bindings_one_current_per_employee")
      .on(table.schoolId, table.employeeId)
      .where(sql`${table.status} IN ('ASSIGNED', 'ACTIVE', 'LOCKED')`),
    foreignKey({
      columns: [table.nfcCardId, table.schoolId],
      foreignColumns: [nfcCards.id, nfcCards.schoolId],
      name: "employee_nfc_card_bindings_card_school_fk",
    }),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "employee_nfc_card_bindings_employee_school_fk",
    }),
    index("employee_nfc_card_bindings_school_status_idx").on(table.schoolId, table.status),
  ],
);

/** Append-only employee card lifecycle log, separate from student card history. */
export const employeeNfcCardHistory = pgTable(
  "employee_nfc_card_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    bindingId: integer("binding_id").notNull(),
    nfcCardId: integer("nfc_card_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    action: text("action").notNull(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    replacementNfcCardId: integer("replacement_nfc_card_id"),
    reason: text("reason"),
    actorUserId: integer("actor_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.bindingId, table.schoolId],
      foreignColumns: [employeeNfcCardBindings.id, employeeNfcCardBindings.schoolId],
      name: "employee_nfc_card_history_binding_school_fk",
    }),
    foreignKey({
      columns: [table.nfcCardId, table.schoolId],
      foreignColumns: [nfcCards.id, nfcCards.schoolId],
      name: "employee_nfc_card_history_card_school_fk",
    }),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "employee_nfc_card_history_employee_school_fk",
    }),
    foreignKey({
      columns: [table.replacementNfcCardId, table.schoolId],
      foreignColumns: [nfcCards.id, nfcCards.schoolId],
      name: "employee_nfc_card_history_replacement_card_school_fk",
    }),
    uniqueIndex("employee_nfc_card_history_id_school_unique").on(table.id, table.schoolId),
    index("employee_nfc_card_history_employee_idx").on(
      table.schoolId,
      table.employeeId,
      table.createdAt,
    ),
    index("employee_nfc_card_history_card_idx").on(table.nfcCardId, table.createdAt),
  ],
);

/** Employee NFC anomalies; never forced into the student-only discrepancy table. */
export const employeeNfcAttendanceDiscrepancies = pgTable(
  "employee_nfc_attendance_discrepancies",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    employeeId: integer("employee_id").notNull(),
    attendanceEventId: integer("attendance_event_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("OPEN"),
    details: jsonb("details").notNull().default({}),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: integer("resolved_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "employee_nfc_attendance_discrepancies_status_check",
      sql`${table.status} IN ('OPEN', 'RESOLVED')`,
    ),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "employee_nfc_attendance_discrepancies_employee_school_fk",
    }),
    foreignKey({
      columns: [table.attendanceEventId, table.schoolId],
      foreignColumns: [attendanceEvents.id, attendanceEvents.schoolId],
      name: "employee_nfc_attendance_discrepancies_event_school_fk",
    }),
    uniqueIndex("employee_nfc_attendance_discrepancies_event_kind_unique")
      .on(table.schoolId, table.attendanceEventId, table.kind),
    uniqueIndex("employee_nfc_attendance_discrepancies_id_school_unique").on(
      table.id,
      table.schoolId,
    ),
    index("employee_nfc_attendance_discrepancies_school_status_idx").on(
      table.schoolId,
      table.status,
      table.createdAt,
    ),
  ],
);

/** Resolution actions are append-only; resolving never edits or erases an event. */
export const employeeNfcDiscrepancyActions = pgTable(
  "employee_nfc_discrepancy_actions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    discrepancyId: integer("discrepancy_id").notNull(),
    resolution: text("resolution").notNull(),
    reason: text("reason").notNull(),
    actorUserId: integer("actor_user_id").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.discrepancyId, table.schoolId],
      foreignColumns: [employeeNfcAttendanceDiscrepancies.id, employeeNfcAttendanceDiscrepancies.schoolId],
      name: "employee_nfc_discrepancy_actions_discrepancy_school_fk",
    }),
    index("employee_nfc_discrepancy_actions_history_idx").on(
      table.schoolId,
      table.discrepancyId,
      table.createdAt,
    ),
  ],
);