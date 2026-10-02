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
  primaryKey,
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
  parents,
  schools,
  schoolClasses,
  students,
} from "./edupulse";

export const admissionPortalSettings = pgTable(
  "admission_portal_settings",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
    portalKey: text("portal_key").notNull(),
    isOpen: boolean("is_open").notNull().default(false),
    academicSessionId: integer("academic_session_id"),
    academicTermId: integer("academic_term_id"),
    deadline: date("deadline", { mode: "string" }),
    feeInfo: text("fee_info"),
    requirements: jsonb("requirements").notNull().default(sql`'[]'::jsonb`),
    requiredDocuments: jsonb("required_documents").notNull().default(sql`'[]'::jsonb`),
    instructions: text("instructions"),
    entranceExamination: text("entrance_examination"),
    interviewInformation: text("interview_information"),
    publicDescription: text("public_description"),
    publicAddress: text("public_address"),
    publicPhone: text("public_phone"),
    publicEmail: text("public_email"),
    logoObjectPath: text("logo_object_path"),
    updatedByUserId: integer("updated_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("admission_portal_settings_portal_key_unique").on(table.portalKey),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "admission_portal_settings_session_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "admission_portal_settings_term_school_fk",
    }).onDelete("restrict"),
    check("admission_portal_settings_slug_check", sql`${table.portalKey} ~ '^[a-z0-9][a-z0-9-]{2,79}$'`),
    check("admission_portal_settings_public_phone_check", sql`${table.publicPhone} IS NULL OR ${table.publicPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("admission_portal_settings_requirements_array_check", sql`jsonb_typeof(${table.requirements}) = 'array'`),
    check("admission_portal_settings_documents_array_check", sql`jsonb_typeof(${table.requiredDocuments}) = 'array'`),
  ],
);

export const admissionPortalClasses = pgTable(
  "admission_portal_classes",
  {
    schoolId: integer("school_id").notNull(),
    classId: integer("class_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.classId], name: "admission_portal_classes_pk" }),
    foreignKey({
      columns: [table.schoolId],
      foreignColumns: [admissionPortalSettings.schoolId],
      name: "admission_portal_classes_settings_school_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.classId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "admission_portal_classes_class_school_fk",
    }).onDelete("restrict"),
    index("admission_portal_classes_class_school_idx").on(table.classId, table.schoolId),
  ],
);

export const admissionApplicationCounters = pgTable(
  "admission_application_counters",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
    currentValue: integer("current_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("admission_application_counters_nonnegative_check", sql`${table.currentValue} >= 0`)],
);

export const admissionApplications = pgTable(
  "admission_applications",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    applicationNumber: text("application_number").notNull(),
    status: text("status").notNull().default("Submitted"),
    source: text("source").notNull(),
    applicantFirstName: text("applicant_first_name").notNull(),
    applicantMiddleName: text("applicant_middle_name"),
    applicantLastName: text("applicant_last_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    gender: text("gender").notNull(),
    photoObjectPath: text("photo_object_path"),
    previousSchool: text("previous_school"),
    previousClass: text("previous_class"),
    intendedClassId: integer("intended_class_id").notNull(),
    academicSessionId: integer("academic_session_id").notNull(),
    academicTermId: integer("academic_term_id"),
    applicantAddress: text("applicant_address"),
    guardianName: text("guardian_name").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    guardianEmail: text("guardian_email"),
    guardianRelationship: text("guardian_relationship"),
    guardianAddress: text("guardian_address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emergencyContactRelationship: text("emergency_contact_relationship"),
    receiptSecretHash: text("receipt_secret_hash"),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    assessment: jsonb("assessment"),
    interview: jsonb("interview"),
    internalNotes: text("internal_notes"),
    publicMessage: text("public_message"),
    convertedStudentId: integer("converted_student_id"),
    convertedParentId: integer("converted_parent_id"),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("admission_applications_id_school_tenant_key").on(table.id, table.schoolId),
    uniqueIndex("admission_applications_school_number_unique").on(table.schoolId, table.applicationNumber),
    uniqueIndex("admission_applications_idempotency_key_unique").on(table.schoolId, table.idempotencyKey),
    uniqueIndex("admission_applications_student_unique")
      .on(table.schoolId, table.convertedStudentId)
      .where(sql`${table.convertedStudentId} IS NOT NULL`),
    foreignKey({
      columns: [table.intendedClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "admission_applications_class_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "admission_applications_session_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "admission_applications_term_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.convertedStudentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "admission_applications_student_school_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.convertedParentId, table.schoolId],
      foreignColumns: [parents.id, parents.schoolId],
      name: "admission_applications_parent_school_fk",
    }).onDelete("restrict"),
    check(
      "admission_applications_status_check",
      sql`${table.status} IN ('Draft','Submitted','UnderReview','Shortlisted','InterviewScheduled','AssessmentPending','AssessmentCompleted','Accepted','Waitlisted','Rejected','Withdrawn','Enrolled')`,
    ),
    check("admission_applications_source_check", sql`${table.source} IN ('PUBLIC','STAFF')`),
    check("admission_applications_gender_check", sql`${table.gender} IN ('Female','Male','Other','PreferNotToSay')`),
    check("admission_applications_phone_check", sql`${table.guardianPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("admission_applications_emergency_phone_check", sql`${table.emergencyContactPhone} IS NULL OR ${table.emergencyContactPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      "admission_applications_emergency_contact_pair_check",
      sql`(${table.emergencyContactName} IS NULL) = (${table.emergencyContactPhone} IS NULL)`,
    ),
    check(
      "admission_applications_receipt_hash_check",
      sql`${table.receiptSecretHash} IS NULL OR ${table.receiptSecretHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("admission_applications_payload_hash_check", sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check("admission_applications_idempotency_key_check", sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128`),
    check(
      "admission_applications_photo_path_check",
      sql`${table.photoObjectPath} IS NULL OR ${table.photoObjectPath} ~ '^/objects/admissions/'`,
    ),
    check("admission_applications_version_check", sql`${table.version} >= 1`),
    index("admission_applications_school_status_created_idx").on(table.schoolId, table.status, table.createdAt),
    index("admission_applications_school_name_idx").on(table.schoolId, table.applicantLastName, table.applicantFirstName),
    index("admission_applications_guardian_phone_idx").on(table.schoolId, table.guardianPhone),
  ],
);

export const admissionApplicationDocuments = pgTable(
  "admission_application_documents",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    applicationId: integer("application_id").notNull(),
    documentType: text("document_type").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    objectPath: text("object_path").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId, table.schoolId],
      foreignColumns: [admissionApplications.id, admissionApplications.schoolId],
      name: "admission_application_documents_application_school_fk",
    }).onDelete("restrict"),
    uniqueIndex("admission_application_documents_object_path_unique").on(table.objectPath),
    check("admission_application_documents_content_type_check", sql`${table.contentType} IN ('application/pdf','image/jpeg','image/png','image/webp')`),
    check("admission_application_documents_size_check", sql`${table.byteSize} BETWEEN 1 AND 10485760`),
    check(
      "admission_application_documents_object_path_check",
      sql`${table.objectPath} ~ '^/objects/admissions/(intake/[a-z0-9][a-z0-9-]{2,79}|[1-9][0-9]*/[1-9][0-9]*)/(photo-)?[0-9a-f-]{36}$'`,
    ),
    index("admission_application_documents_app_school_idx").on(table.applicationId, table.schoolId),
  ],
);

export const admissionRequestRateLimits = pgTable(
  "admission_request_rate_limits",
  {
    bucketHash: text("bucket_hash").primaryKey(),
    bucketStartedAt: timestamp("bucket_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("admission_request_rate_limits_count_check", sql`${table.requestCount} >= 0`), index("admission_request_rate_limits_started_idx").on(table.bucketStartedAt)],
);
