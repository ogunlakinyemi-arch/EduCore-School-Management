import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  text as textColumn,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  academicSessions,
  academicTerms,
  appUsers,
  employees,
  parentStudentRelationships,
  schools,
  students,
} from "./edupulse";
import { feeCategories, feeInvoices } from "./finance";

/**
 * School transportation extends existing students, employees, parents and
 * finance invoices. Tenant identity is part of every cross-entity reference.
 */
export const transportBuses = pgTable(
  "transport_buses",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    registrationNumber: text("registration_number").notNull(),
    make: text("make"),
    capacity: integer("capacity").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_buses_id_school_unique").on(table.id, table.schoolId),
    uniqueIndex("transport_buses_school_registration_unique").on(table.schoolId, sql`lower(btrim(${table.registrationNumber}))`),
    check("transport_buses_capacity_check", sql`${table.capacity} BETWEEN 1 AND 250`),
    check("transport_buses_status_check", sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE')`),
    index("transport_buses_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const transportRoutes = pgTable(
  "transport_routes",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    busId: integer("bus_id").notNull(),
    driverEmployeeId: integer("driver_employee_id").notNull(),
    name: text("name").notNull(),
    weekdays: textColumn("weekdays").array().notNull(),
    departureTime: text("departure_time").notNull(),
    arrivalTime: text("arrival_time").notNull(),
    fareMinor: integer("fare_minor").notNull().default(0),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_routes_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.busId, table.schoolId],
      foreignColumns: [transportBuses.id, transportBuses.schoolId],
      name: "transport_routes_bus_school_fk",
    }),
    foreignKey({
      columns: [table.driverEmployeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "transport_routes_driver_school_fk",
    }),
    check("transport_routes_name_check", sql`length(btrim(${table.name})) BETWEEN 2 AND 120`),
    check("transport_routes_weekdays_check", sql`
      cardinality(${table.weekdays}) BETWEEN 1 AND 7
      AND ${table.weekdays} <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::text[]
    `),
    check("transport_routes_departure_time_check", sql`${table.departureTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'`),
    check("transport_routes_arrival_time_check", sql`${table.arrivalTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'`),
    check("transport_routes_schedule_order_check", sql`${table.arrivalTime} > ${table.departureTime}`),
    check("transport_routes_fare_currency_check", sql`${table.fareMinor} >= 0 AND ${table.currency} = 'NGN'`),
    check("transport_routes_status_check", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    index("transport_routes_school_bus_status_idx").on(table.schoolId, table.busId, table.status),
    index("transport_routes_school_driver_idx").on(table.schoolId, table.driverEmployeeId, table.status),
  ],
);

export const transportRouteStops = pgTable(
  "transport_route_stops",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    routeId: integer("route_id").notNull(),
    name: text("name").notNull(),
    stopType: text("stop_type").notNull(),
    sequence: integer("sequence").notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_route_stops_id_route_school_unique").on(table.id, table.routeId, table.schoolId),
    foreignKey({
      columns: [table.routeId, table.schoolId],
      foreignColumns: [transportRoutes.id, transportRoutes.schoolId],
      name: "transport_route_stops_route_school_fk",
    }),
    check("transport_route_stops_name_check", sql`length(btrim(${table.name})) BETWEEN 2 AND 120`),
    check("transport_route_stops_type_check", sql`${table.stopType} IN ('PICKUP', 'DROPOFF', 'BOTH')`),
    check("transport_route_stops_sequence_check", sql`${table.sequence} > 0`),
    uniqueIndex("transport_route_stops_route_sequence_unique").on(table.routeId, table.sequence),
    index("transport_route_stops_school_route_active_idx").on(table.schoolId, table.routeId, table.isActive),
  ],
);

export const transportStudentAssignments = pgTable(
  "transport_student_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    routeId: integer("route_id").notNull(),
    pickupStopId: integer("pickup_stop_id").notNull(),
    dropoffStopId: integer("dropoff_stop_id").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    reason: text("reason").notNull(),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_student_assignments_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "transport_student_assignments_student_school_fk",
    }),
    foreignKey({
      columns: [table.routeId, table.schoolId],
      foreignColumns: [transportRoutes.id, transportRoutes.schoolId],
      name: "transport_student_assignments_route_school_fk",
    }),
    foreignKey({
      columns: [table.pickupStopId, table.routeId, table.schoolId],
      foreignColumns: [transportRouteStops.id, transportRouteStops.routeId, transportRouteStops.schoolId],
      name: "transport_student_assignments_pickup_route_school_fk",
    }),
    foreignKey({
      columns: [table.dropoffStopId, table.routeId, table.schoolId],
      foreignColumns: [transportRouteStops.id, transportRouteStops.routeId, transportRouteStops.schoolId],
      name: "transport_student_assignments_dropoff_route_school_fk",
    }),
    check("transport_student_assignments_status_check", sql`${table.status} IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`),
    check("transport_student_assignments_stops_check", sql`${table.pickupStopId} <> ${table.dropoffStopId}`),
    check("transport_student_assignments_dates_check", sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.effectiveDate}`),
    check("transport_student_assignments_reason_check", sql`length(btrim(${table.reason})) BETWEEN 3 AND 500`),
    uniqueIndex("transport_student_assignments_one_current_per_student").on(table.studentId).where(sql`${table.status} IN ('ACTIVE', 'SUSPENDED')`),
    index("transport_student_assignments_school_status_student_idx").on(table.schoolId, table.status, table.studentId),
    index("transport_student_assignments_route_status_idx").on(table.schoolId, table.routeId, table.status),
  ],
);

export const transportRouteStaff = pgTable(
  "transport_route_staff",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    routeId: integer("route_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    role: text("role").notNull().default("ACCOMPANIER"),
    isActive: boolean("is_active").notNull().default(true),
    assignedBy: integer("assigned_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_route_staff_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.routeId, table.schoolId],
      foreignColumns: [transportRoutes.id, transportRoutes.schoolId],
      name: "transport_route_staff_route_school_fk",
    }),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "transport_route_staff_employee_school_fk",
    }),
    check("transport_route_staff_role_check", sql`${table.role} IN ('TEACHER', 'STAFF', 'ACCOMPANIER')`),
    uniqueIndex("transport_route_staff_route_employee_active_unique").on(table.routeId, table.employeeId).where(sql`${table.isActive}`),
    index("transport_route_staff_school_route_active_idx").on(table.schoolId, table.routeId, table.isActive),
  ],
);

export const transportParentRequests = pgTable(
  "transport_parent_requests",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    parentId: integer("parent_id").notNull(),
    assignmentId: integer("assignment_id"),
    requestType: text("request_type").notNull(),
    requestDate: timestamp("request_date", { withTimezone: true }).notNull().defaultNow(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("PENDING"),
    schoolAction: text("school_action"),
    schoolNote: text("school_note"),
    reviewedBy: integer("reviewed_by").references(() => appUsers.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_parent_requests_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "transport_parent_requests_student_school_fk",
    }),
    foreignKey({
      columns: [table.parentId, table.studentId],
      foreignColumns: [parentStudentRelationships.parentId, parentStudentRelationships.studentId],
      name: "transport_parent_requests_active_relationship_fk",
    }),
    foreignKey({
      columns: [table.assignmentId, table.schoolId],
      foreignColumns: [transportStudentAssignments.id, transportStudentAssignments.schoolId],
      name: "transport_parent_requests_assignment_school_fk",
    }),
    check("transport_parent_requests_type_check", sql`${table.requestType} IN ('ACTIVATE', 'DEACTIVATE')`),
    check("transport_parent_requests_status_check", sql`${table.status} IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')`),
    check("transport_parent_requests_action_check", sql`${table.schoolAction} IS NULL OR ${table.schoolAction} IN ('ACTIVATE','SUSPEND','DEACTIVATE','NO_CHANGE')`),
    check("transport_parent_requests_reason_check", sql`length(btrim(${table.reason})) BETWEEN 3 AND 1000`),
    check("transport_parent_requests_review_check", sql`
      (${table.status} = 'PENDING' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
      OR (${table.status} <> 'PENDING' AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)
    `),
    uniqueIndex("transport_parent_requests_one_pending_student").on(table.studentId).where(sql`${table.status} = 'PENDING'`),
    index("transport_parent_requests_school_status_created_idx").on(table.schoolId, table.status, table.createdAt),
    index("transport_parent_requests_parent_student_created_idx").on(table.parentId, table.studentId, table.createdAt),
  ],
);

/**
 * Assignment/term fee plans are the transport-specific contract. A generated
 * charge points at an ordinary Finance invoice; this table is not a payment
 * ledger, and each plan can be linked to at most one Finance invoice.
 */
export const transportFeeInvoices = pgTable(
  "transport_fee_invoices",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    assignmentId: integer("assignment_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id").notNull(),
    feeCategoryId: integer("fee_category_id"),
    amountMinor: integer("amount_minor").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("PLANNED"),
    feeInvoiceId: integer("fee_invoice_id"),
    createdBy: integer("created_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    updatedBy: integer("updated_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("transport_fee_invoices_id_school_unique").on(table.id, table.schoolId),
    unique("transport_fee_invoices_assignment_term_unique").on(table.assignmentId, table.academicTermId),
    unique("transport_fee_invoices_fee_invoice_unique").on(table.feeInvoiceId),
    foreignKey({
      columns: [table.assignmentId, table.schoolId],
      foreignColumns: [transportStudentAssignments.id, transportStudentAssignments.schoolId],
      name: "transport_fee_invoices_assignment_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "transport_fee_invoices_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "transport_fee_invoices_term_school_fk",
    }),
    foreignKey({
      columns: [table.feeCategoryId, table.schoolId],
      foreignColumns: [feeCategories.id, feeCategories.schoolId],
      name: "transport_fee_invoices_category_school_fk",
    }),
    foreignKey({
      columns: [table.feeInvoiceId, table.schoolId],
      foreignColumns: [feeInvoices.id, feeInvoices.schoolId],
      name: "transport_fee_invoices_finance_invoice_school_fk",
    }),
    check("transport_fee_invoices_amount_check", sql`${table.amountMinor} >= 0`),
    check("transport_fee_invoices_status_check", sql`${table.status} IN ('PLANNED','INVOICED','CANCELLED')`),
    check("transport_fee_invoices_invoice_state_check", sql`
      (${table.status} = 'INVOICED' AND ${table.feeInvoiceId} IS NOT NULL AND ${table.amountMinor} > 0)
      OR (${table.status} IN ('PLANNED','CANCELLED') AND ${table.feeInvoiceId} IS NULL)
    `),
    check("transport_fee_invoices_category_check", sql`${table.amountMinor} = 0 OR ${table.feeCategoryId} IS NOT NULL`),
    index("transport_fee_invoices_school_term_idx").on(table.schoolId, table.academicTermId),
  ],
);

export const transportSchoolPolicies = pgTable(
  "transport_school_policies",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
    paymentRequired: boolean("payment_required").notNull().default(false),
    suspendWhenOverdue: boolean("suspend_when_overdue").notNull().default(false),
    updatedBy: integer("updated_by").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "transport_school_policies_payment_gate_check",
      sql`NOT ${table.suspendWhenOverdue} OR ${table.paymentRequired}`,
    ),
  ],
);

/** Immutable, tenant-bound audit snapshots for assignments, routes, buses and requests. */
export const transportHistory = pgTable(
  "transport_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    assignmentId: integer("assignment_id"),
    routeId: integer("route_id"),
    busId: integer("bus_id"),
    requestId: integer("request_id"),
    routeStaffId: integer("route_staff_id"),
    studentId: integer("student_id"),
    eventType: text("event_type").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    actorUserId: integer("actor_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.assignmentId, table.schoolId],
      foreignColumns: [transportStudentAssignments.id, transportStudentAssignments.schoolId],
      name: "transport_history_assignment_school_fk",
    }),
    foreignKey({
      columns: [table.routeId, table.schoolId],
      foreignColumns: [transportRoutes.id, transportRoutes.schoolId],
      name: "transport_history_route_school_fk",
    }),
    foreignKey({
      columns: [table.busId, table.schoolId],
      foreignColumns: [transportBuses.id, transportBuses.schoolId],
      name: "transport_history_bus_school_fk",
    }),
    foreignKey({
      columns: [table.requestId, table.schoolId],
      foreignColumns: [transportParentRequests.id, transportParentRequests.schoolId],
      name: "transport_history_request_school_fk",
    }),
    foreignKey({
      columns: [table.routeStaffId, table.schoolId],
      foreignColumns: [transportRouteStaff.id, transportRouteStaff.schoolId],
      name: "transport_history_route_staff_school_fk",
    }),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "transport_history_student_school_fk",
    }),
    check(
      "transport_history_one_event_entity_check",
      sql`num_nonnulls(${table.assignmentId}, ${table.routeId}, ${table.busId}, ${table.requestId}, ${table.routeStaffId}) = 1`,
    ),
    check("transport_history_event_reason_check", sql`length(btrim(${table.eventType})) BETWEEN 3 AND 80 AND length(btrim(${table.reason})) BETWEEN 3 AND 1000`),
    index("transport_history_school_assignment_created_idx").on(table.schoolId, table.assignmentId, table.createdAt),
    index("transport_history_school_student_created_idx").on(table.schoolId, table.studentId, table.createdAt),
    index("transport_history_school_request_created_idx").on(table.schoolId, table.requestId, table.createdAt),
    index("transport_history_school_route_created_idx").on(table.schoolId, table.routeId, table.createdAt),
  ],
);