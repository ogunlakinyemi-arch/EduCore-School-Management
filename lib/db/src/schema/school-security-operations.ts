import { sql } from "drizzle-orm";
import {
  bigint,
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
import { appUsers, deviceSchoolBindings, parents, schools, students } from "./edupulse";
import { securityEvents, securityLocations } from "./school-security-core";

/** Visitor registration/check-in records with optional school-scoped security references. */
export const schoolSecurityVisitors = pgTable(
  "school_security_visitors",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    visitorName: text("visitor_name").notNull(),
    phone: text("phone"),
    idReference: text("id_reference"),
    purpose: text("purpose").notNull(),
    hostName: text("host_name"),
    hostStudentId: integer("host_student_id"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkoutIdempotencyKey: text("checkout_idempotency_key"),
    status: text("status").notNull().default("ON_SITE"),
    notes: text("notes"),
    securityOfficerUserId: integer("security_officer_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    securityLocationId: integer("security_location_id"),
    securityDeviceId: integer("security_device_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_security_visitors_id_school_unique").on(table.id, table.schoolId),
    unique("school_security_visitors_checkout_key_unique").on(table.schoolId, table.checkoutIdempotencyKey),
    foreignKey({
      columns: [table.securityLocationId, table.schoolId],
      foreignColumns: [securityLocations.id, securityLocations.schoolId],
      name: "school_security_visitors_location_school_fk",
    }),
    foreignKey({
      columns: [table.securityDeviceId, table.schoolId],
      foreignColumns: [deviceSchoolBindings.deviceId, deviceSchoolBindings.schoolId],
      name: "school_security_visitors_device_school_fk",
    }),
    foreignKey({
      columns: [table.hostStudentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "school_security_visitors_host_student_school_fk",
    }),
    check("school_security_visitors_name_check", sql`length(btrim(${table.visitorName})) BETWEEN 1 AND 160`),
    check("school_security_visitors_purpose_check", sql`length(btrim(${table.purpose})) BETWEEN 1 AND 1000`),
    check("school_security_visitors_status_check", sql`${table.status} IN ('ON_SITE','CHECKED_OUT')`),
    check(
      "school_security_visitors_checkout_shape_check",
      sql`(${table.status}='ON_SITE' AND ${table.checkedOutAt} IS NULL AND ${table.checkoutIdempotencyKey} IS NULL) OR (${table.status}='CHECKED_OUT' AND ${table.checkedOutAt} IS NOT NULL AND ${table.checkoutIdempotencyKey} IS NOT NULL)`,
    ),
    check("school_security_visitors_version_check", sql`${table.version}>0`),
    index("school_security_visitors_school_status_date_idx").on(table.schoolId, table.status, table.checkedInAt),
  ],
);

export const schoolAuthorizedPickupPersons = pgTable(
  "school_authorized_pickup_persons",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    nominatedByParentId: integer("nominated_by_parent_id").notNull().references(() => parents.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    relationship: text("relationship"),
    identityReference: text("identity_reference"),
    status: text("status").notNull().default("PENDING"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decisionByUserId: integer("decision_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_pickup_person_id_school_student_unique").on(table.id, table.schoolId, table.studentId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "school_pickup_person_student_school_fk",
    }),
    check("school_pickup_person_name_check", sql`length(btrim(${table.fullName})) BETWEEN 1 AND 160`),
    check("school_pickup_person_phone_check", sql`length(btrim(${table.phone})) BETWEEN 3 AND 40`),
    check(
      "school_pickup_person_status_check",
      sql`${table.status} IN ('PENDING','APPROVED','REJECTED','REVOKED')`,
    ),
    check(
      "school_pickup_person_decision_shape_check",
      sql`(${table.status}='PENDING' AND ${table.decisionByUserId} IS NULL AND ${table.decidedAt} IS NULL) OR (${table.status}<>'PENDING' AND ${table.decisionByUserId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
    check(
      "school_pickup_person_validity_check",
      sql`${table.validFrom} IS NULL OR ${table.validUntil} IS NULL OR ${table.validUntil}>${table.validFrom}`,
    ),
    check("school_pickup_person_version_check", sql`${table.version}>0`),
    index("school_pickup_person_student_status_idx").on(table.schoolId, table.studentId, table.status),
  ],
);

export const schoolPickupRequests = pgTable(
  "school_pickup_requests",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    requestedByParentId: integer("requested_by_parent_id").notNull().references(() => parents.id, { onDelete: "restrict" }),
    pickupPersonId: integer("pickup_person_id").notNull(),
    requestedPickupAt: timestamp("requested_pickup_at", { withTimezone: true }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("PENDING"),
    decisionByUserId: integer("decision_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: integer("completed_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    completionPickupPersonId: integer("completion_pickup_person_id"),
    recordedSecurityEventId: bigint("recorded_security_event_id", { mode: "number" }),
    completionIdempotencyKey: text("completion_idempotency_key"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_pickup_requests_id_school_unique").on(table.id, table.schoolId),
    unique("school_pickup_requests_school_exit_event_unique").on(table.schoolId, table.recordedSecurityEventId),
    unique("school_pickup_requests_completion_key_unique").on(table.schoolId, table.completionIdempotencyKey),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "school_pickup_requests_student_school_fk",
    }),
    foreignKey({
      columns: [table.pickupPersonId, table.schoolId, table.studentId],
      foreignColumns: [
        schoolAuthorizedPickupPersons.id,
        schoolAuthorizedPickupPersons.schoolId,
        schoolAuthorizedPickupPersons.studentId,
      ],
      name: "school_pickup_requests_person_school_student_fk",
    }),
    foreignKey({
      columns: [table.completionPickupPersonId, table.schoolId, table.studentId],
      foreignColumns: [
        schoolAuthorizedPickupPersons.id,
        schoolAuthorizedPickupPersons.schoolId,
        schoolAuthorizedPickupPersons.studentId,
      ],
      name: "school_pickup_requests_completion_person_school_student_fk",
    }),
    foreignKey({
      columns: [table.recordedSecurityEventId, table.schoolId],
      foreignColumns: [securityEvents.id, securityEvents.schoolId],
      name: "school_pickup_requests_security_event_school_fk",
    }),
    check(
      "school_pickup_requests_status_check",
      sql`${table.status} IN ('PENDING','APPROVED','REJECTED','CANCELLED','REFUSED','COMPLETED')`,
    ),
    check("school_pickup_requests_validity_check", sql`${table.validUntil}>${table.validFrom}`),
    check(
      "school_pickup_requests_completion_shape_check",
      sql`(${table.status}='COMPLETED' AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL AND ${table.completionPickupPersonId} IS NOT NULL AND ${table.recordedSecurityEventId} IS NOT NULL AND ${table.completionIdempotencyKey} IS NOT NULL) OR (${table.status}<>'COMPLETED' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL AND ${table.completionPickupPersonId} IS NULL AND ${table.recordedSecurityEventId} IS NULL AND ${table.completionIdempotencyKey} IS NULL)`,
    ),
    check("school_pickup_requests_version_check", sql`${table.version}>0`),
    index("school_pickup_requests_school_student_status_idx").on(table.schoolId, table.studentId, table.status, table.requestedPickupAt),
    index("school_pickup_requests_parent_idx").on(table.requestedByParentId, table.createdAt),
  ],
);

export const schoolSecurityIncidents = pgTable(
  "school_security_incidents",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    incidentType: text("incident_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    securityLocationId: integer("security_location_id"),
    securityDeviceId: integer("security_device_id"),
    studentId: integer("student_id"),
    involvedPersons: jsonb("involved_persons").$type<Array<{ personType: "STUDENT" | "STAFF" | "VISITOR"; personId: number }>>().notNull().default([]),
    assignedStaffUserId: integer("assigned_staff_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    severity: text("severity").notNull().default("LOW"),
    status: text("status").notNull().default("OPEN"),
    resolution: text("resolution"),
    createdByUserId: integer("created_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_security_incidents_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "school_security_incidents_student_school_fk",
    }),
    foreignKey({
      columns: [table.securityLocationId, table.schoolId],
      foreignColumns: [securityLocations.id, securityLocations.schoolId],
      name: "school_security_incidents_location_school_fk",
    }),
    foreignKey({
      columns: [table.securityDeviceId, table.schoolId],
      foreignColumns: [deviceSchoolBindings.deviceId, deviceSchoolBindings.schoolId],
      name: "school_security_incidents_device_school_fk",
    }),
    check(
      "school_security_incidents_type_check",
      sql`${table.incidentType} IN ('UNAUTHORIZED_ACCESS','LOST_CARD','VISITOR_ISSUE','STUDENT_RELEASE','GATE_INCIDENT','SECURITY_CONCERN','OTHER')`,
    ),
    check("school_security_incidents_severity_check", sql`${table.severity} IN ('LOW','MODERATE','HIGH','CRITICAL')`),
    check("school_security_incidents_status_check", sql`${table.status} IN ('OPEN','INVESTIGATING','RESOLVED')`),
    check("school_security_incidents_involved_persons_check", sql`jsonb_typeof(${table.involvedPersons})='array'`),
    check(
      "school_security_incidents_resolution_shape_check",
      sql`${table.status}<>'RESOLVED' OR (${table.resolution} IS NOT NULL AND length(btrim(${table.resolution}))>0)`,
    ),
    check("school_security_incidents_version_check", sql`${table.version}>0`),
    index("school_security_incidents_school_status_date_idx").on(table.schoolId, table.status, table.occurredAt),
  ],
);

export const schoolSecurityIncidentAttachments = pgTable(
  "school_security_incident_attachments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    incidentId: integer("incident_id").notNull(),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status").notNull().default("PENDING_UPLOAD"),
    uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("school_security_incident_attachments_id_scope_unique").on(table.id, table.schoolId, table.incidentId),
    unique("school_security_incident_attachments_school_object_unique").on(table.schoolId, table.objectPath),
    foreignKey({
      columns: [table.incidentId, table.schoolId],
      foreignColumns: [schoolSecurityIncidents.id, schoolSecurityIncidents.schoolId],
      name: "school_security_incident_attachments_incident_school_fk",
    }),
    check(
      "school_security_incident_attachments_type_check",
      sql`${table.contentType} IN ('application/pdf','image/jpeg','image/png','image/webp')`,
    ),
    check("school_security_incident_attachments_size_check", sql`${table.byteSize} BETWEEN 1 AND 10485760`),
    check(
      "school_security_incident_attachments_path_check",
      sql`${table.objectPath} ~ '^/objects/school-security/[1-9][0-9]*/[1-9][0-9]*/[0-9a-fA-F-]{36}$'`,
    ),
    check("school_security_incident_attachments_name_check", sql`length(btrim(${table.fileName})) BETWEEN 1 AND 255`),
    check(
      "school_security_incident_attachments_status_shape_check",
      sql`(${table.status}='PENDING_UPLOAD' AND ${table.confirmedAt} IS NULL) OR (${table.status}='CONFIRMED' AND ${table.confirmedAt} IS NOT NULL)`,
    ),
    index("school_security_incident_attachments_scope_status_idx").on(table.schoolId, table.incidentId, table.status),
  ],
);

/** Append-only audit history for visitor, pickup and security-incident operations. */
export const schoolSecurityOperationHistory = pgTable(
  "school_security_operation_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id"),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    revision: integer("revision").notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: integer("actor_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    result: text("result").notNull().default("SUCCESS"),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "school_security_operation_history_student_school_fk",
    }),
    check(
      "school_security_operation_history_entity_check",
      sql`${table.entityType} IN ('VISITOR','PICKUP_PERSON','PICKUP_REQUEST','INCIDENT')`,
    ),
    check("school_security_operation_history_result_check", sql`${table.result} IN ('SUCCESS','REJECTED')`),
    check("school_security_operation_history_revision_check", sql`${table.revision}>0`),
    unique("school_security_operation_history_revision_unique").on(table.entityType, table.entityId, table.revision),
    index("school_security_operation_history_school_created_idx").on(table.schoolId, table.createdAt, table.id),
    index("school_security_operation_history_student_idx").on(table.schoolId, table.studentId, table.createdAt),
  ],
);