import {
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const schools = pgTable(
  "schools",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("schools_code_unique").on(table.code)],
);

export const students = pgTable(
  "students",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    admissionNo: text("admission_no").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    gender: text("gender").notNull(),
    className: text("class_name").notNull(),
    section: text("section").notNull(),
    parentName: text("parent_name"),
    parentPhone: text("parent_phone"),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("students_school_admission_unique").on(table.schoolId, table.admissionNo),
    index("students_school_idx").on(table.schoolId),
  ],
);

export const parents = pgTable(
  "parents",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
  },
  (table) => [index("parents_school_idx").on(table.schoolId)],
);

export const schoolClasses = pgTable(
  "school_classes",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    section: text("section").notNull(),
    classTeacher: text("class_teacher"),
    capacity: integer("capacity").notNull().default(30),
  },
  (table) => [uniqueIndex("school_classes_unique").on(table.schoolId, table.name, table.section)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    studentId: integer("student_id").notNull().references(() => students.id),
    term: text("term").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("5000"),
    schoolShare: numeric("school_share", { precision: 12, scale: 2 }).notNull().default("2000"),
    edupulseShare: numeric("edupulse_share", { precision: 12, scale: 2 }).notNull().default("3000"),
    status: text("status").notNull().default("pending"),
    verificationStatus: text("verification_status").notNull().default("pending"),
    provider: text("provider").notNull().default("test"),
    providerReference: text("provider_reference"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("subscriptions_school_idx").on(table.schoolId),
    uniqueIndex("subscriptions_provider_reference_unique").on(table.providerReference),
  ],
);

export const nfcCards = pgTable(
  "nfc_cards",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    uid: text("uid").notNull(),
    studentId: integer("student_id").references(() => students.id),
    status: text("status").notNull().default("unassigned"),
    scans: integer("scans").notNull().default(0),
    lastScan: timestamp("last_scan", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("nfc_cards_uid_unique").on(table.uid),
    index("nfc_cards_school_idx").on(table.schoolId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    user: text("user").notNull(),
    role: text("role").notNull(),
    schoolId: integer("school_id").references(() => schools.id),
    action: text("action").notNull(),
    module: text("module").notNull(),
    recordId: integer("record_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    severity: text("severity").notNull().default("info"),
  },
  (table) => [index("audit_logs_school_idx").on(table.schoolId, table.timestamp)],
);