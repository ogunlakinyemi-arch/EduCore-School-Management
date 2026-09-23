import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appUsers = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_users_clerk_user_id_unique").on(table.clerkUserId),
    index("app_users_email_idx").on(table.email),
  ],
);

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
    registrationNumber: text("registration_number"),
    address: text("address"),
    lga: text("lga"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    logo: text("logo"),
    schoolType: text("school_type"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("schools_code_unique").on(table.code)],
);

export const schoolMemberships = pgTable(
  "school_memberships",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => appUsers.id),
    schoolId: integer("school_id").references(() => schools.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("school_memberships_user_school_role_unique").on(
      table.userId,
      table.schoolId,
      table.role,
    ),
    uniqueIndex("school_memberships_platform_role_unique")
      .on(table.userId, table.role)
      .where(sql`${table.schoolId} is null`),
    index("school_memberships_user_idx").on(table.userId, table.status),
    index("school_memberships_school_idx").on(table.schoolId, table.status),
  ],
);

export const students = pgTable(
  "students",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    userId: integer("user_id").references(() => appUsers.id),
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
    middleName: text("middle_name"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    photo: text("photo"),
    admissionDate: date("admission_date", { mode: "string" }),
    admissionStatus: text("admission_status").notNull().default("ADMITTED"),
    previousSchool: text("previous_school"),
    address: text("address"),
    medicalInfo: text("medical_info"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("students_school_admission_unique").on(table.schoolId, table.admissionNo),
    uniqueIndex("students_user_unique").on(table.userId),
    uniqueIndex("students_id_school_unique").on(table.id, table.schoolId),
    index("students_school_idx").on(table.schoolId),
  ],
);

export const parents = pgTable(
  "parents",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    userId: integer("user_id").references(() => appUsers.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    address: text("address"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parents_user_unique").on(table.userId),
    index("parents_school_idx").on(table.schoolId),
  ],
);

export const parentStudentRelationships = pgTable(
  "parent_student_relationships",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").notNull().references(() => parents.id),
    studentId: integer("student_id").notNull().references(() => students.id),
    relationshipType: text("relationship_type").notNull().default("Guardian"),
    isPrimaryGuardian: boolean("is_primary_guardian").notNull().default(false),
    isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
    contactPriority: integer("contact_priority").notNull().default(1),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("parent_student_relationship_unique").on(table.parentId, table.studentId),
    index("parent_student_relationship_parent_idx").on(table.parentId, table.status),
    index("parent_student_relationship_student_idx").on(table.studentId, table.status),
  ],
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
  (table) => [
    uniqueIndex("school_classes_unique").on(table.schoolId, table.name, table.section),
    uniqueIndex("school_classes_id_school_unique").on(table.id, table.schoolId),
  ],
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
    partnerProfileId: integer("partner_profile_id").references(() => partnerProfiles.id),
    partnerShare: numeric("partner_share", { precision: 12, scale: 2 }),
    allocationSnapshot: jsonb("allocation_snapshot"),
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
    index("subscriptions_partner_profile_idx").on(table.partnerProfileId),
    check(
      "subscriptions_partner_allocation_integrity",
      sql`${table.partnerProfileId} IS NULL OR (${table.partnerShare} IS NOT NULL AND ${table.amount} = ${table.schoolShare} + ${table.edupulseShare} + ${table.partnerShare})`,
    ),
  ],
);

export const partnerProfiles = pgTable(
  "partner_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => appUsers.id),
    partnerCode: text("partner_code").notNull(),
    type: text("type").notNull().default("RESELLER"),
    fullName: text("full_name").notNull(),
    businessName: text("business_name"),
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    state: text("state"),
    lga: text("lga"),
    registrationNumber: text("registration_number"),
    status: text("status").notNull().default("PENDING"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partner_profiles_code_unique").on(table.partnerCode),
    uniqueIndex("partner_profiles_user_unique").on(table.userId),
    index("partner_profiles_email_idx").on(table.email),
    index("partner_profiles_status_idx").on(table.status),
  ],
);

export const partnerProfileUsers = pgTable(
  "partner_profile_users",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    userId: integer("user_id").notNull().references(() => appUsers.id),
    role: text("role").notNull().default("PARTNER"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partner_profile_users_unique").on(table.partnerProfileId, table.userId),
    uniqueIndex("partner_profile_users_user_role_unique").on(table.userId, table.role),
    index("partner_profile_users_partner_idx").on(table.partnerProfileId, table.status),
  ],
);

export const partnerInvitations = pgTable(
  "partner_invitations",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    invitedEmail: text("invited_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partner_invitations_token_hash_unique").on(table.tokenHash),
    index("partner_invitations_partner_status_idx").on(table.partnerProfileId, table.status),
  ],
);

export const partnerReferralLinks = pgTable(
  "partner_referral_links",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: integer("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("partner_referral_links_hash_unique").on(table.tokenHash),
    index("partner_referral_links_partner_status_idx").on(table.partnerProfileId, table.status),
  ],
);

export const schoolPartnerAttributions = pgTable(
  "school_partner_attributions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    referralLinkId: integer("referral_link_id").references(() => partnerReferralLinks.id),
    source: text("source").notNull().default("REFERRAL_LINK"),
    status: text("status").notNull().default("ACTIVE"),
    isCurrent: boolean("is_current").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("school_partner_attributions_current_unique")
      .on(table.schoolId)
      .where(sql`${table.isCurrent} = true`),
    index("school_partner_attributions_school_history_idx").on(table.schoolId, table.startsAt),
    index("school_partner_attributions_partner_idx").on(table.partnerProfileId, table.status),
  ],
);

export const partnerAttributionConflicts = pgTable(
  "partner_attribution_conflicts",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    existingPartnerProfileId: integer("existing_partner_profile_id").references(() => partnerProfiles.id),
    attemptedPartnerProfileId: integer("attempted_partner_profile_id").notNull().references(() => partnerProfiles.id),
    referralLinkId: integer("referral_link_id").references(() => partnerReferralLinks.id),
    source: text("source").notNull(),
    status: text("status").notNull().default("OPEN"),
    metadata: jsonb("metadata"),
    evidence: jsonb("evidence"),
    resolvedBy: integer("resolved_by").references(() => appUsers.id),
    decision: text("decision"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("partner_attribution_conflicts_school_status_idx").on(table.schoolId, table.status),
    index("partner_attribution_conflicts_attempted_idx").on(table.attemptedPartnerProfileId),
  ],
);

export const commissionRules = pgTable(
  "commission_rules",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    term: text("term"),
    currency: text("currency").notNull().default("NGN"),
    calculationBasis: text("calculation_basis").notNull().default("FIXED"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    partnerRate: numeric("partner_rate", { precision: 12, scale: 4 }).notNull().default("100"),
    allocationTotal: numeric("allocation_total", { precision: 12, scale: 2 }).notNull().default("5000"),
    partnerAmount: numeric("partner_amount", { precision: 12, scale: 2 }).notNull().default("100"),
    schoolAmount: numeric("school_amount", { precision: 12, scale: 2 }).notNull().default("2000"),
    edupulseAmount: numeric("edupulse_amount", { precision: 12, scale: 2 }).notNull().default("2900"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("commission_rules_status_term_idx").on(table.status, table.term),
    check("commission_rules_allocation_integrity", sql`${table.partnerAmount} >= 0 AND ${table.schoolAmount} >= 0 AND ${table.edupulseAmount} >= 0 AND ${table.partnerAmount} + ${table.schoolAmount} + ${table.edupulseAmount} = ${table.allocationTotal}`),
  ],
);

export const commissionLedger = pgTable(
  "commission_ledger",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    studentId: integer("student_id").notNull().references(() => students.id),
    subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id),
    commissionRuleId: integer("commission_rule_id").notNull().references(() => commissionRules.id),
    academicSessionId: integer("academic_session_id").references(() => academicSessions.id),
    term: text("term").notNull(),
    rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
    count: integer("count").notNull().default(1),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("PENDING"),
    payoutId: integer("payout_id").references(() => partnerPayouts.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    payableAt: timestamp("payable_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    heldAt: timestamp("held_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    paymentReference: text("payment_reference"),
    adjustmentReference: text("adjustment_reference"),
    reversalReference: text("reversal_reference"),
    createdBy: integer("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("commission_ledger_subscription_period_unique").on(table.subscriptionId, table.term),
    index("commission_ledger_partner_status_idx").on(table.partnerProfileId, table.status),
    check("commission_ledger_amount_nonnegative", sql`${table.amount} >= 0 AND ${table.count} > 0`),
    check("commission_ledger_status_check", sql`${table.status} IN ('PENDING','APPROVED','PAYABLE','PAID','HELD','REVERSED','CANCELLED')`),
  ],
);

export const partnerPayouts = pgTable(
  "partner_payouts",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    academicSessionId: integer("academic_session_id").references(() => academicSessions.id),
    term: text("term"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("PENDING"),
    paymentReference: text("payment_reference"),
    paymentDate: timestamp("payment_date", { withTimezone: true }),
    method: text("method"),
    notes: text("notes"),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReference: text("reversal_reference"),
    reversalReason: text("reversal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partner_payouts_provider_reference_unique").on(table.providerReference),
    index("partner_payouts_partner_status_idx").on(table.partnerProfileId, table.status),
    check("partner_payouts_amount_nonnegative", sql`${table.amount} >= 0`),
    check("partner_payouts_status_check", sql`${table.status} IN ('PENDING','PROCESSING','PAID','FAILED','REVERSED')`),
  ],
);

export const partnerPayoutInformation = pgTable(
  "partner_payout_information",
  {
    id: serial("id").primaryKey(),
    partnerProfileId: integer("partner_profile_id").notNull().references(() => partnerProfiles.id),
    method: text("method").notNull(),
    bankNameEncrypted: text("bank_name_encrypted").notNull(),
    accountNameEncrypted: text("account_name_encrypted").notNull(),
    accountNumberEncrypted: text("account_number_encrypted").notNull(),
    bankCodeEncrypted: text("bank_code_encrypted"),
    accountLast4: text("account_last4").notNull(),
    encryptionKeyVersion: text("encryption_key_version").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partner_payout_information_partner_unique").on(table.partnerProfileId),
    index("partner_payout_information_status_idx").on(table.status),
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
    actorUserId: integer("actor_user_id").references(() => appUsers.id),
    clerkUserId: text("clerk_user_id"),
    schoolId: integer("school_id").references(() => schools.id),
    action: text("action").notNull(),
    module: text("module").notNull(),
    recordId: integer("record_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    severity: text("severity").notNull().default("info"),
    eventType: text("event_type").notNull().default("APPLICATION_EVENT"),
    result: text("result").notNull().default("SUCCESS"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("audit_logs_school_idx").on(table.schoolId, table.timestamp)],
);

export const academicSessions = pgTable(
  "academic_sessions",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("PLANNED"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("academic_sessions_school_name_unique").on(table.schoolId, table.name),
    uniqueIndex("academic_sessions_id_school_unique").on(table.id, table.schoolId),
    index("academic_sessions_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const academicTerms = pgTable(
  "academic_terms",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    academicSessionId: integer("academic_session_id").notNull().references(() => academicSessions.id),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("PLANNED"),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("academic_terms_session_name_unique").on(table.academicSessionId, table.name),
    uniqueIndex("academic_terms_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "academic_terms_session_school_fk",
    }),
    index("academic_terms_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    userId: integer("user_id").references(() => appUsers.id),
    employeeNo: text("employee_no").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    photo: text("photo"),
    gender: text("gender"),
    employeeType: text("employee_type").notNull().default("TEACHER"),
    employmentStatus: text("employment_status").notNull().default("ACTIVE"),
    dateEmployed: date("date_employed", { mode: "string" }),
    department: text("department"),
    qualification: text("qualification"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employees_school_employee_no_unique").on(table.schoolId, table.employeeNo),
    uniqueIndex("employees_id_school_unique").on(table.id, table.schoolId),
    index("employees_school_type_status_idx").on(table.schoolId, table.employeeType, table.employmentStatus),
  ],
);

export const subjects = pgTable(
  "subjects",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subjects_school_code_unique").on(table.schoolId, table.code),
    uniqueIndex("subjects_id_school_unique").on(table.id, table.schoolId),
    index("subjects_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const studentClassAssignments = pgTable(
  "student_class_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    studentId: integer("student_id").notNull().references(() => students.id),
    academicSessionId: integer("academic_session_id").notNull().references(() => academicSessions.id),
    academicTermId: integer("academic_term_id").references(() => academicTerms.id),
    schoolClassId: integer("school_class_id").notNull().references(() => schoolClasses.id),
    section: text("section").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    isCurrent: boolean("is_current").notNull().default(false),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("student_class_assignments_active_unique")
      .on(
        table.studentId,
        table.academicSessionId,
        sql`coalesce(${table.academicTermId}, 0)`,
        table.schoolClassId,
        table.section,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex("student_class_assignments_id_school_unique").on(table.id, table.schoolId),
    foreignKey({
      columns: [table.studentId, table.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "student_class_assignments_student_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "student_class_assignments_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "student_class_assignments_term_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "student_class_assignments_class_school_fk",
    }),
    index("student_class_assignments_school_current_idx").on(table.schoolId, table.isCurrent),
    index("student_class_assignments_student_history_idx").on(table.studentId, table.startDate),
  ],
);

export const classSubjects = pgTable(
  "class_subjects",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    schoolClassId: integer("school_class_id").notNull().references(() => schoolClasses.id),
    subjectId: integer("subject_id").notNull().references(() => subjects.id),
    academicSessionId: integer("academic_session_id").notNull().references(() => academicSessions.id),
    academicTermId: integer("academic_term_id").references(() => academicTerms.id),
    employeeId: integer("employee_id").references(() => employees.id),
    section: text("section"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("class_subjects_unique")
      .on(
        table.schoolClassId,
        table.subjectId,
        table.academicSessionId,
        sql`coalesce(${table.academicTermId}, 0)`,
        sql`coalesce(${table.section}, '')`,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "class_subjects_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "class_subjects_subject_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "class_subjects_session_school_fk",
    }),
    foreignKey({
      columns: [table.academicTermId, table.schoolId],
      foreignColumns: [academicTerms.id, academicTerms.schoolId],
      name: "class_subjects_term_school_fk",
    }),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "class_subjects_employee_school_fk",
    }),
    index("class_subjects_school_status_idx").on(table.schoolId, table.status),
  ],
);

export const teacherClassAssignments = pgTable(
  "teacher_class_assignments",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    academicSessionId: integer("academic_session_id").notNull().references(() => academicSessions.id),
    schoolClassId: integer("school_class_id").notNull().references(() => schoolClasses.id),
    subjectId: integer("subject_id").references(() => subjects.id),
    section: text("section").notNull(),
    assignmentType: text("assignment_type").notNull().default("CLASS_TEACHER"),
    status: text("status").notNull().default("ACTIVE"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_class_assignments_unique")
      .on(
        table.employeeId,
        table.academicSessionId,
        table.schoolClassId,
        table.section,
        table.assignmentType,
        sql`coalesce(${table.subjectId}, 0)`,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      columns: [table.employeeId, table.schoolId],
      foreignColumns: [employees.id, employees.schoolId],
      name: "teacher_class_assignments_employee_school_fk",
    }),
    foreignKey({
      columns: [table.academicSessionId, table.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
      name: "teacher_class_assignments_session_school_fk",
    }),
    foreignKey({
      columns: [table.schoolClassId, table.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "teacher_class_assignments_class_school_fk",
    }),
    foreignKey({
      columns: [table.subjectId, table.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
      name: "teacher_class_assignments_subject_school_fk",
    }),
    index("teacher_class_assignments_school_status_idx").on(table.schoolId, table.status),
  ],
);