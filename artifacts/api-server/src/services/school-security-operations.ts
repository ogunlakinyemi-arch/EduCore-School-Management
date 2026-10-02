import { z } from "zod/v4";

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const databaseTimestamp = z.union([z.string(), z.date()]);

export const incidentAttachmentUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255)
    .refine((value) => !/[\/\\\u0000-\u001f\u007f]/.test(value), "fileName must not contain a path or control characters"),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();

export const incidentAttachmentSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  incidentId: positiveId,
  fileName: z.string(),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
  status: z.enum(["PENDING_UPLOAD", "CONFIRMED"]),
  uploadedByUserId: positiveId,
  uploadExpiresAt: databaseTimestamp,
  confirmedAt: databaseTimestamp.nullable(),
  createdAt: databaseTimestamp,
}).strict();

export const incidentAttachmentUploadIntentOutputSchema = z.object({
  attachment: incidentAttachmentSchema,
  uploadUrl: z.string().url(),
}).strict();

export const incidentAttachmentDownloadOutputSchema = z.object({
  attachment: incidentAttachmentSchema,
  downloadUrl: z.string().url(),
}).strict();

export const visitorInputSchema = z.object({
  visitorName: z.string().trim().min(1).max(160),
  phone: optionalText(40),
  idReference: optionalText(160),
  purpose: z.string().trim().min(1).max(1000),
  hostName: optionalText(160),
  hostStudentId: positiveId.nullable().optional(),
  notes: optionalText(2000),
  securityLocationId: positiveId.nullable().optional(),
  securityDeviceId: positiveId.nullable().optional(),
}).strict();

export const visitorPatchSchema = z.object({
  expectedVersion: positiveId,
  visitorName: z.string().trim().min(1).max(160).optional(),
  phone: optionalText(40),
  idReference: optionalText(160),
  purpose: z.string().trim().min(1).max(1000).optional(),
  hostName: optionalText(160),
  hostStudentId: positiveId.nullable().optional(),
  notes: optionalText(2000),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
  message: "At least one visitor field must be updated",
});

export const pickupPersonInputSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(3).max(40),
  relationship: optionalText(100),
  identityReference: optionalText(160),
  validFrom: timestamp.optional(),
  validUntil: timestamp.optional(),
}).strict().refine((value) =>
  !value.validFrom || !value.validUntil || Date.parse(value.validUntil) > Date.parse(value.validFrom), {
  message: "validUntil must be later than validFrom",
});

export const pickupRequestInputSchema = z.object({
  pickupPersonId: positiveId,
  requestedPickupAt: timestamp,
  reason: optionalText(1000),
}).strict();

export const pickupDecisionInputSchema = z.object({
  expectedVersion: positiveId,
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const pickupPersonDecisionInputSchema = z.object({
  expectedVersion: positiveId,
  decision: z.enum(["APPROVE", "REJECT", "REVOKE"]),
  reason: optionalText(1000),
}).strict();

export const pickupCompletionInputSchema = z.object({
  expectedVersion: positiveId,
  pickupPersonId: positiveId,
  recordedSecurityEventId: positiveId,
}).strict();

export const pickupCancelInputSchema = z.object({
  expectedVersion: positiveId,
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const incidentInputSchema = z.object({
  incidentType: z.enum([
    "UNAUTHORIZED_ACCESS",
    "LOST_CARD",
    "VISITOR_ISSUE",
    "STUDENT_RELEASE",
    "GATE_INCIDENT",
    "SECURITY_CONCERN",
    "OTHER",
  ]),
  occurredAt: timestamp,
  securityLocationId: positiveId.nullable().optional(),
  securityDeviceId: positiveId.nullable().optional(),
  studentId: positiveId.nullable().optional(),
  involvedPersons: z.array(z.object({
    personType: z.enum(["STUDENT", "STAFF", "VISITOR"]),
    personId: positiveId,
  }).strict()).max(20).default([]),
  assignedStaffUserId: positiveId.nullable().optional(),
  description: z.string().trim().min(1).max(5000),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW"),
}).strict();

export const incidentPatchSchema = z.object({
  expectedVersion: positiveId,
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED"]).optional(),
  involvedPersons: z.array(z.object({
    personType: z.enum(["STUDENT", "STAFF", "VISITOR"]),
    personId: positiveId,
  }).strict()).max(20).optional(),
  assignedStaffUserId: positiveId.nullable().optional(),
  resolution: optionalText(5000),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), {
  message: "At least one incident field must be updated",
});

export const visitorOutputSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  visitorName: z.string(),
  phone: z.string().nullable(),
  idReference: z.string().nullable(),
  purpose: z.string(),
  hostName: z.string().nullable(),
  hostStudentId: positiveId.nullable(),
  checkedInAt: databaseTimestamp,
  checkedOutAt: databaseTimestamp.nullable(),
  status: z.enum(["ON_SITE", "CHECKED_OUT"]),
  notes: z.string().nullable(),
  securityOfficerUserId: positiveId,
  securityLocationId: positiveId.nullable(),
  securityDeviceId: positiveId.nullable(),
  version: positiveId,
  createdAt: databaseTimestamp,
  updatedAt: databaseTimestamp,
}).strict();

export const pickupPersonOutputSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  studentId: positiveId,
  fullName: z.string(),
  phone: z.string(),
  relationship: z.string().nullable(),
  identityReference: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED"]),
  validFrom: databaseTimestamp.nullable(),
  validUntil: databaseTimestamp.nullable(),
  requestedAt: databaseTimestamp,
  decisionReason: z.string().nullable(),
  decidedAt: databaseTimestamp.nullable(),
  version: positiveId,
  createdAt: databaseTimestamp,
  updatedAt: databaseTimestamp,
}).strict();

export const pickupRequestOutputSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  studentId: positiveId,
  requestedByParentId: positiveId,
  pickupPersonId: positiveId,
  requestedPickupAt: databaseTimestamp,
  validFrom: databaseTimestamp,
  validUntil: databaseTimestamp,
  reason: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUSED", "COMPLETED"]),
  decisionReason: z.string().nullable(),
  decidedAt: databaseTimestamp.nullable(),
  completedAt: databaseTimestamp.nullable(),
  completionPickupPersonId: positiveId.nullable(),
  recordedSecurityEventId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  version: positiveId,
  createdAt: databaseTimestamp,
  updatedAt: databaseTimestamp,
}).strict();

export const incidentOutputSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  incidentType: z.enum([
    "UNAUTHORIZED_ACCESS",
    "LOST_CARD",
    "VISITOR_ISSUE",
    "STUDENT_RELEASE",
    "GATE_INCIDENT",
    "SECURITY_CONCERN",
    "OTHER",
  ]),
  occurredAt: databaseTimestamp,
  securityLocationId: positiveId.nullable(),
  securityDeviceId: positiveId.nullable(),
  studentId: positiveId.nullable(),
  involvedPersons: z.array(z.object({
    personType: z.enum(["STUDENT", "STAFF", "VISITOR"]),
    personId: positiveId,
  }).strict()),
  assignedStaffUserId: positiveId.nullable(),
  description: z.string(),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED"]),
  resolution: z.string().nullable(),
  createdByUserId: positiveId,
  version: positiveId,
  createdAt: databaseTimestamp,
  updatedAt: databaseTimestamp,
}).strict();

export type VisitorInput = z.infer<typeof visitorInputSchema>;
export type VisitorPatch = z.infer<typeof visitorPatchSchema>;
export type PickupPersonInput = z.infer<typeof pickupPersonInputSchema>;
export type PickupRequestInput = z.infer<typeof pickupRequestInputSchema>;
export type IncidentInput = z.infer<typeof incidentInputSchema>;