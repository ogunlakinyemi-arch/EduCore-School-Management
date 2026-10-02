import { sql } from "drizzle-orm";
import {
  boolean,
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
import { communicationNotifications } from "./communication";
import { appUsers, schoolClasses, schools, students, subjects } from "./edupulse";

type Contact = {
  name: string;
  phone: string;
  role?: string | null;
  relationship?: string;
  email?: string | null;
};

/** Sensitive health information is deliberately separate from students.medical_info. */
export const studentMedicalProfiles = pgTable(
  "student_medical_profiles",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    bloodGroup: text("blood_group"),
    genotype: text("genotype"),
    allergies: jsonb("allergies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    conditions: jsonb("conditions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    supportNeeds: jsonb("support_needs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    medications: jsonb("medications").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    emergencyMedicalNotes: text("emergency_medical_notes"),
    providerContacts: jsonb("provider_contacts").$type<Contact[]>().notNull().default(sql`'[]'::jsonb`),
    emergencyContacts: jsonb("emergency_contacts").$type<Contact[]>().notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
    updatedByUserId: integer("updated_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("student_medical_profiles_student_school_unique").on(table.studentId, table.schoolId),
    unique("student_medical_profiles_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_medical_profiles_student_school_fk",
    }),
    check("student_medical_profiles_allergies_array", sql`jsonb_typeof(${table.allergies})='array'`),
    check("student_medical_profiles_conditions_array", sql`jsonb_typeof(${table.conditions})='array'`),
    check("student_medical_profiles_support_array", sql`jsonb_typeof(${table.supportNeeds})='array'`),
    check("student_medical_profiles_medications_array", sql`jsonb_typeof(${table.medications})='array'`),
    check("student_medical_profiles_providers_array", sql`jsonb_typeof(${table.providerContacts})='array'`),
    check("student_medical_profiles_contacts_array", sql`jsonb_typeof(${table.emergencyContacts})='array'`),
    check("student_medical_profiles_version_positive_check", sql`${table.version} > 0`),
    index("student_medical_profiles_school_student_idx").on(table.schoolId, table.studentId),
  ],
);

export const studentMedicalVisits = pgTable(
  "student_medical_visits",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    symptoms: text("symptoms"),
    observations: text("observations"),
    actionTaken: text("action_taken"),
    treatment: text("treatment"),
    referral: text("referral"),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    followUpNotes: text("follow_up_notes"),
    notes: text("notes"),
    recordedByUserId: integer("recorded_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("student_medical_visits_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_medical_visits_student_school_fk",
    }),
    check("student_medical_visits_version_positive_check", sql`${table.version} > 0`),
    index("student_medical_visits_school_student_date_idx").on(table.schoolId, table.studentId, table.occurredAt),
  ],
);

export const studentWelfareRecords = pgTable(
  "student_welfare_records",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    category: text("category").notNull(),
    concern: text("concern").notNull(),
    assignedStaffUserId: integer("assigned_staff_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    followUpStatus: text("follow_up_status").notNull().default("PENDING"),
    status: text("status").notNull().default("OPEN"),
    resolution: text("resolution"),
    internalNotes: text("internal_notes"),
    parentVisible: boolean("parent_visible").notNull().default(false),
    createdByUserId: integer("created_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("student_welfare_records_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_welfare_records_student_school_fk",
    }),
    check(
      "student_welfare_records_category_check",
      sql`${table.category} IN ('WELFARE_CONCERN','COUNSELLING_REFERRAL','SAFEGUARDING','FAMILY_SUPPORT','LEARNING_SUPPORT')`,
    ),
    check("student_welfare_records_status_check", sql`${table.status} IN ('OPEN','IN_PROGRESS','RESOLVED')`),
    check(
      "student_welfare_records_follow_up_check",
      sql`${table.followUpStatus} IN ('NOT_REQUIRED','PENDING','IN_PROGRESS','COMPLETE')`,
    ),
    check("student_welfare_records_version_positive_check", sql`${table.version} > 0`),
    check(
      "student_welfare_records_safeguarding_private_check",
      sql`${table.category} <> 'SAFEGUARDING' OR ${table.parentVisible}=FALSE`,
    ),
    index("student_welfare_records_school_student_category_idx").on(table.schoolId, table.studentId, table.category),
    index("student_welfare_records_assigned_followup_idx").on(table.schoolId, table.assignedStaffUserId, table.followUpAt),
  ],
);

export const studentBehaviourConfigurations = pgTable(
  "student_behaviour_configurations",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
    categories: jsonb("categories").$type<string[]>().notNull().default(sql`'["POSITIVE","CONCERN","INCIDENT","RULE_VIOLATION","RECOGNITION"]'::jsonb`),
    actions: jsonb("actions").$type<string[]>().notNull().default(sql`'["Verbal warning","Written warning","Detention","Counselling","Parent meeting","Behaviour agreement","Suspension"]'::jsonb`),
    updatedByUserId: integer("updated_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("student_behaviour_configurations_categories_array", sql`jsonb_typeof(${table.categories})='array'`),
    check("student_behaviour_configurations_actions_array", sql`jsonb_typeof(${table.actions})='array'`),
    check("student_behaviour_configurations_version_check", sql`${table.version} > 0`),
  ],
);

export const studentBehaviourRecords = pgTable(
  "student_behaviour_records",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    schoolClassId: integer("school_class_id"),
    subjectId: integer("subject_id"),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    location: text("location"),
    reporterUserId: integer("reporter_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    action: text("action"),
    parentNotificationStatus: text("parent_notification_status").notNull().default("NOT_REQUESTED"),
    parentNotificationId: integer("parent_notification_id")
      .references(() => communicationNotifications.id, { onDelete: "restrict" }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    followUpNotes: text("follow_up_notes"),
    status: text("status").notNull().default("REVIEW"),
    resolution: text("resolution"),
    internalNotes: text("internal_notes"),
    parentVisible: boolean("parent_visible").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("student_behaviour_records_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_behaviour_records_student_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "student_behaviour_records_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "student_behaviour_records_subject_school_fk",
    }),
    check(
      "student_behaviour_records_category_check",
      sql`${table.category} IN ('POSITIVE','CONCERN','INCIDENT','RULE_VIOLATION','RECOGNITION')`,
    ),
    check("student_behaviour_records_description_nonempty_check", sql`length(btrim(${table.description})) > 0`),
    check(
      "student_behaviour_records_severity_check",
      sql`${table.severity} IN ('LOW','MODERATE','HIGH','CRITICAL')`,
    ),
    check(
      "student_behaviour_records_status_check",
      sql`${table.status} IN ('REVIEW','ACTION','PARENT_NOTIFICATION','FOLLOW_UP','RESOLVED')`,
    ),
    check(
      "student_behaviour_records_parent_notification_check",
      sql`${table.parentNotificationStatus} IN ('NOT_REQUESTED','QUEUED','PARTIAL','NOT_CONFIGURED','FAILED')`,
    ),
    check("student_behaviour_records_version_check", sql`${table.version} > 0`),
    index("student_behaviour_records_school_student_date_idx").on(table.schoolId, table.studentId, table.occurredAt),
    index("student_behaviour_records_followup_idx").on(table.schoolId, table.status, table.followUpAt),
  ],
);

/** Stable, school-local permission keys; only School Admin may manage these rows. */
export const studentCareGrants = pgTable(
  "student_care_grants",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    userId: integer("user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    grantedByUserId: integer("granted_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "student_care_grants_permissions_check",
      sql`${table.permissions} <@ ARRAY['MEDICAL_READ','MEDICAL_WRITE','WELFARE_READ','WELFARE_WRITE','SAFEGUARDING_READ','SAFEGUARDING_WRITE','BEHAVIOUR_READ','BEHAVIOUR_WRITE','BEHAVIOUR_REVIEW','BEHAVIOUR_ACTION']::text[]`,
    ),
    unique("student_care_grants_school_user_unique").on(table.schoolId, table.userId),
    unique("student_care_grants_id_school_unique").on(table.id, table.schoolId),
    index("student_care_grants_user_active_idx").on(table.userId, table.active),
  ],
);

/** Immutable before/after revisions; access is always checked against the owning record. */
export const studentCareRecordHistory = pgTable(
  "student_care_record_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    recordType: text("record_type").notNull(),
    recordId: integer("record_id").notNull(),
    revision: integer("revision").notNull(),
    changedByUserId: integer("changed_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    snapshot: jsonb("snapshot").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_care_history_student_school_fk",
    }),
    check(
      "student_care_history_record_type_check",
      sql`${table.recordType} IN ('MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR','BEHAVIOUR_CONFIGURATION')`,
    ),
    unique("student_care_history_record_revision_unique").on(table.recordType, table.recordId, table.revision),
    index("student_care_history_school_student_idx").on(table.schoolId, table.studentId, table.changedAt),
  ],
);

/** Client retry keys are scoped to school+student+resource and bind to input hash. */
export const studentCareIdempotency = pgTable(
  "student_care_idempotency",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    studentId: integer("student_id").notNull(),
    requestKey: text("request_key").notNull(),
    resourceType: text("resource_type").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceId: integer("resource_id").notNull(),
    responseRevision: integer("response_revision").notNull().default(1),
    createdByUserId: integer("created_by_user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("student_care_idempotency_request_key_check", sql`length(${table.requestKey}) BETWEEN 8 AND 128`),
    check("student_care_idempotency_request_hash_check", sql`length(${table.requestHash})=64`),
    check(
      "student_care_idempotency_resource_type_check",
      sql`${table.resourceType} IN ('MEDICAL_PROFILE','MEDICAL_VISIT','WELFARE','BEHAVIOUR')`,
    ),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_care_idempotency_student_school_fk",
    }),
    unique("student_care_idempotency_scope_key_unique").on(
      table.schoolId,
      table.studentId,
      table.resourceType,
      table.requestKey,
      table.createdByUserId,
    ),
    index("student_care_idempotency_resource_idx").on(table.resourceType, table.resourceId),
  ],
);