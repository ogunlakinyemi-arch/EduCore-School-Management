import { createHash } from "node:crypto";
import { z } from "zod/v4";

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const timestamp = z.iso.datetime({ offset: true });

export const carePermissionSchema = z.enum([
  "MEDICAL_READ",
  "MEDICAL_WRITE",
  "WELFARE_READ",
  "WELFARE_WRITE",
  "SAFEGUARDING_READ",
  "SAFEGUARDING_WRITE",
  "BEHAVIOUR_READ",
  "BEHAVIOUR_WRITE",
  "BEHAVIOUR_REVIEW",
  "BEHAVIOUR_ACTION",
]);
export type CarePermission = z.infer<typeof carePermissionSchema>;

const contactSchema = z.object({
  name: nonEmpty(200),
  phone: nonEmpty(40),
  role: optionalText(100),
  relationship: optionalText(100),
  email: z.string().email().max(254).nullable().optional(),
}).strict();

export const medicalProfileInputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  bloodGroup: optionalText(16),
  genotype: optionalText(16),
  allergies: z.array(nonEmpty(500)).max(100).default([]),
  conditions: z.array(nonEmpty(1000)).max(100).default([]),
  supportNeeds: z.array(nonEmpty(1000)).max(100).default([]),
  medications: z.array(nonEmpty(1000)).max(100).default([]),
  emergencyMedicalNotes: optionalText(5000),
  providerContacts: z.array(contactSchema).max(100).default([]),
  emergencyContacts: z.array(contactSchema).max(100).default([]),
}).strict();

export const medicalProfileOutputSchema = z.object({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  bloodGroup: z.string().nullable(),
  genotype: z.string().nullable(),
  allergies: z.array(z.string()),
  conditions: z.array(z.string()),
  supportNeeds: z.array(z.string()),
  medications: z.array(z.string()),
  emergencyMedicalNotes: z.string().nullable(),
  providerContacts: z.array(contactSchema),
  emergencyContacts: z.array(contactSchema),
  version: z.number().int().positive(),
  updatedAt: z.union([z.string(), z.date()]),
  archivedAt: z.union([z.string(), z.date()]).nullable(),
}).strict();

export const medicalVisitInputSchema = z.object({
  occurredAt: timestamp,
  reason: nonEmpty(2000),
  symptoms: optionalText(5000),
  observations: optionalText(5000),
  actionTaken: optionalText(5000),
  treatment: optionalText(5000),
  referral: optionalText(2000),
  followUpAt: timestamp.nullable().optional(),
  followUpNotes: optionalText(5000),
  notes: optionalText(5000),
}).strict();
export const medicalVisitPatchSchema = z.object({
  occurredAt: timestamp,
  reason: nonEmpty(2000),
  symptoms: optionalText(5000),
  observations: optionalText(5000),
  actionTaken: optionalText(5000),
  treatment: optionalText(5000),
  referral: optionalText(2000),
  followUpAt: timestamp.nullable().optional(),
  followUpNotes: optionalText(5000),
  notes: optionalText(5000),
  expectedVersion: z.number().int().positive(),
}).strict();
export const medicalVisitOutputSchema = medicalVisitInputSchema.extend({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  recordedByUserId: z.number().int().positive(),
  version: z.number().int().positive(),
  occurredAt: z.union([z.string(), z.date()]),
  followUpAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  archivedAt: z.union([z.string(), z.date()]).nullable(),
}).strict();

export const welfareRecordInputSchema = z.object({
  category: z.enum([
    "WELFARE_CONCERN",
    "COUNSELLING_REFERRAL",
    "SAFEGUARDING",
    "FAMILY_SUPPORT",
    "LEARNING_SUPPORT",
  ]),
  concern: nonEmpty(5000),
  assignedStaffUserId: z.number().int().positive().nullable().optional(),
  followUpAt: timestamp.nullable().optional(),
  followUpStatus: z.enum(["NOT_REQUIRED", "PENDING", "IN_PROGRESS", "COMPLETE"]).default("PENDING"),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).default("OPEN"),
  resolution: optionalText(5000),
  internalNotes: optionalText(10000),
  parentVisible: z.boolean().default(false),
}).strict();
export const welfareRecordPatchSchema = z.object({
  category: welfareRecordInputSchema.shape.category,
  concern: welfareRecordInputSchema.shape.concern,
  assignedStaffUserId: z.number().int().positive().nullable().optional(),
  followUpAt: timestamp.nullable().optional(),
  followUpStatus: z.enum(["NOT_REQUIRED", "PENDING", "IN_PROGRESS", "COMPLETE"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  resolution: optionalText(5000),
  internalNotes: optionalText(10000),
  parentVisible: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
}).strict();
export const welfareRecordOutputSchema = welfareRecordInputSchema.extend({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  createdByUserId: z.number().int().positive(),
  version: z.number().int().positive(),
  followUpAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  archivedAt: z.union([z.string(), z.date()]).nullable(),
}).strict();

export const behaviourRecordInputSchema = z.object({
  category: z.enum(["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"]),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  description: nonEmpty(5000),
  occurredAt: timestamp.optional(),
  schoolClassId: z.number().int().positive().nullable().optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  location: optionalText(500),
  action: optionalText(2000),
  followUpAt: timestamp.nullable().optional(),
  followUpNotes: optionalText(5000),
  resolution: optionalText(5000),
  internalNotes: optionalText(10000),
  parentVisible: z.boolean().default(false),
}).strict();
export const behaviourRecordPatchSchema = z.object({
  category: behaviourRecordInputSchema.shape.category,
  severity: behaviourRecordInputSchema.shape.severity,
  description: behaviourRecordInputSchema.shape.description,
  occurredAt: timestamp.optional(),
  schoolClassId: z.number().int().positive().nullable().optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  location: optionalText(500),
  action: optionalText(2000),
  followUpAt: timestamp.nullable().optional(),
  followUpNotes: optionalText(5000),
  resolution: optionalText(5000),
  internalNotes: optionalText(10000),
  parentVisible: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
  status: z.enum(["REVIEW", "ACTION", "PARENT_NOTIFICATION", "FOLLOW_UP", "RESOLVED"]).optional(),
  parentNotificationRequested: z.boolean().optional(),
}).strict();
export const behaviourRecordOutputSchema = behaviourRecordInputSchema.extend({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  studentId: z.number().int().positive(),
  reporterUserId: z.number().int().positive(),
  status: z.enum(["REVIEW", "ACTION", "PARENT_NOTIFICATION", "FOLLOW_UP", "RESOLVED"]),
  parentNotificationStatus: z.enum(["NOT_REQUESTED", "QUEUED", "PARTIAL", "NOT_CONFIGURED", "FAILED"]),
  version: z.number().int().positive(),
  occurredAt: z.union([z.string(), z.date()]),
  followUpAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  archivedAt: z.union([z.string(), z.date()]).nullable(),
}).strict();

export const behaviourConfigurationInputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  categories: z.array(nonEmpty(100)).min(1).max(50),
  actions: z.array(nonEmpty(200)).min(1).max(100),
}).strict().superRefine((value, context) => {
  for (const key of ["categories", "actions"] as const) {
    const values = value[key];
    const normalized = values.map((entry) => entry.trim().toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: "custom", path: [key], message: "Values must be unique." });
    }
  }
});

export const careGrantInputSchema = z.object({
  userId: z.number().int().positive(),
  active: z.boolean(),
  permissions: z.array(carePermissionSchema).max(10),
}).strict();

export const careGrantOutputSchema = z.object({
  schoolId: z.number().int().positive(),
  userId: z.number().int().positive(),
  active: z.boolean(),
  permissions: z.array(carePermissionSchema),
  updatedAt: z.union([z.string(), z.date()]),
}).strict();
export const careHistoryEntryOutputSchema = z.object({
  revision: z.number().int().positive(),
  changedAt: z.union([z.string(), z.date()]),
  changedByUserId: z.number().int().positive(),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();
export const behaviourConfigurationOutputSchema = z.object({
  categories: z.array(z.string()),
  actions: z.array(z.string()),
  version: z.number().int().nonnegative(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
}).strict();
export const parentCareSummaryOutputSchema = z.object({
  studentId: z.number().int().positive(),
  welfare: z.array(z.object({
    id: z.number().int().positive(),
    category: z.string(),
    concern: z.string(),
    status: z.string(),
    updatedAt: z.union([z.string(), z.date()]),
  }).strict()),
  behaviour: z.array(z.object({
    id: z.number().int().positive(),
    category: z.string(),
    description: z.string(),
    status: z.string(),
    occurredAt: z.union([z.string(), z.date()]),
  }).strict()),
}).strict();

export function stableRequestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export const behaviourLifecycle = [
  "REVIEW",
  "ACTION",
  "PARENT_NOTIFICATION",
  "FOLLOW_UP",
  "RESOLVED",
] as const;

export function nextBehaviourStatus(current: string, requested: string): boolean {
  const currentIndex = behaviourLifecycle.indexOf(current as (typeof behaviourLifecycle)[number]);
  return currentIndex >= 0 && behaviourLifecycle[currentIndex + 1] === requested;
}

/** Safe notification text contains no student name, concern, action, notes, or safeguarding detail. */
export const parentBehaviourNotification = {
  subject: "A school update is available",
  body: "A new school behaviour update is available in EduCore. Sign in to view the parent-visible update.",
} as const;

export function resolveParentNotificationStatus(
  recipientCount: number,
  queuedCount: number,
  failedCount: number,
): "QUEUED" | "PARTIAL" | "NOT_CONFIGURED" | "FAILED" {
  if (recipientCount <= 0) return "NOT_CONFIGURED";
  if (queuedCount === recipientCount) return "QUEUED";
  if (queuedCount > 0) return "PARTIAL";
  if (failedCount > 0) return "FAILED";
  return "NOT_CONFIGURED";
}

/**
 * Reusable projection for legacy student queries that select medical_info.
 * Only an active School Admin operational context or school-local active MEDICAL_READ
 * grant may retain the field. MEDICAL_WRITE is a separate mutation capability and
 * must never be used to infer read visibility here. Call before serializing general
 * student responses; Platform Owner contexts must set platformOwner even if dual-role.
 */
export function projectStudentMedicalInfo<T extends Record<string, unknown>>(
  student: T,
  access: { activeSchoolAdmin: boolean; hasMedicalReadGrant: boolean; platformOwner: boolean },
): T {
  if (access.platformOwner || (!access.activeSchoolAdmin && !access.hasMedicalReadGrant)) {
    const { medicalInfo: _medicalInfo, medical_info: _medicalInfoSnake, ...safeStudent } = student;
    return safeStudent as T;
  }
  return student;
}

/** Parent views are deliberately allow-list projections, never object spreads. */
export function projectParentWelfare(row: Record<string, unknown>) {
  return {
    id: row.id,
    category: row.category,
    concern: row.concern,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export function projectParentBehaviour(row: Record<string, unknown>) {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    status: row.status,
    occurredAt: row.occurredAt,
  };
}