import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const admissionStatuses = [
  "Draft",
  "Submitted",
  "UnderReview",
  "Shortlisted",
  "InterviewScheduled",
  "AssessmentPending",
  "AssessmentCompleted",
  "Accepted",
  "Waitlisted",
  "Rejected",
  "Withdrawn",
  "Enrolled",
] as const;
export type AdmissionStatus = (typeof admissionStatuses)[number];

const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Phone number must use international E.164 format");
const objectPathSchema = z.string().regex(/^\/objects\/admissions\/[a-zA-Z0-9/_-]+$/).max(500);
const schoolLogoObjectPathSchema = z.string().regex(
  /^\/objects\/school-logos\/[1-9]\d*\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const positiveId = z.number().int().positive();

export const admissionDocumentInputSchema = z.object({
  documentType: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
  objectPath: objectPathSchema,
}).strict();

export const admissionApplicationInputSchema = z.object({
  applicant: z.object({
    firstName: z.string().trim().min(1).max(100),
    middleName: optionalText(100),
    lastName: z.string().trim().min(1).max(100),
    dateOfBirth: z.string().date(),
    gender: z.enum(["Female", "Male", "Other", "PreferNotToSay"]),
    photoObjectPath: objectPathSchema.optional(),
    previousSchool: optionalText(200),
    previousClass: optionalText(100),
    intendedClassId: positiveId,
    academicSessionId: positiveId.optional(),
    academicTermId: positiveId.optional(),
    address: optionalText(1000),
  }).strict(),
  guardian: z.object({
    fullName: z.string().trim().min(1).max(200),
    phone: phoneSchema,
    email: z.string().trim().email().max(254).optional(),
    relationship: optionalText(80),
    address: optionalText(1000),
  }).strict(),
  emergencyContact: z.object({
    fullName: z.string().trim().min(1).max(200),
    phone: phoneSchema,
    relationship: optionalText(80),
  }).strict().optional(),
  documents: z.array(admissionDocumentInputSchema).max(20).optional(),
}).strict();
export type AdmissionApplicationInput = z.infer<typeof admissionApplicationInputSchema>;

const applicantProfilePatchSchema = admissionApplicationInputSchema.shape.applicant
  .omit({ photoObjectPath: true })
  .partial()
  .extend({ academicTermId: positiveId.nullable().optional() })
  .strict();
const emergencyContactInputSchema = admissionApplicationInputSchema.shape.emergencyContact.unwrap();

export const admissionApplicationPatchInputSchema = z.object({
  expectedVersion: positiveId,
  applicant: applicantProfilePatchSchema.optional(),
  guardian: admissionApplicationInputSchema.shape.guardian
    .partial()
    .extend({ email: z.string().trim().email().max(254).nullable().optional() })
    .strict()
    .optional(),
  emergencyContact: emergencyContactInputSchema.nullable().optional(),
}).strict();
export type AdmissionApplicationPatchInput = z.infer<typeof admissionApplicationPatchInputSchema>;

export const admissionPortalSettingsInputSchema = z.object({
  open: z.boolean(),
  academicSessionId: positiveId.nullable().optional(),
  academicTermId: positiveId.nullable().optional(),
  availableClassIds: z.array(positiveId).max(100).refine((values) => new Set(values).size === values.length, "Class IDs must be unique"),
  deadline: z.string().date().nullable().optional(),
  feeInfo: optionalText(1000),
  requirements: z.array(z.string().trim().max(500)).max(50),
  requiredDocuments: z.array(z.string().trim().max(200)).max(50),
  instructions: optionalText(5000),
  entranceExamination: optionalText(2000),
  interviewInformation: optionalText(2000),
  publicDescription: optionalText(3000),
  publicAddress: optionalText(1000),
  publicPhone: phoneSchema.nullable().optional(),
  publicEmail: z.string().email().max(254).nullable().optional(),
  logoObjectPath: z.union([objectPathSchema, schoolLogoObjectPathSchema]).nullable().optional(),
}).strict();

export const admissionTrackingInputSchema = z.object({
  applicationNumber: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  receiptSecret: z.string().min(32).max(256),
}).strict();

export const admissionStatusTransitionInputSchema = z.object({
  status: z.enum(admissionStatuses),
  expectedVersion: positiveId,
  publicMessage: optionalText(2000),
  internalNotes: optionalText(10000),
}).strict();

export const admissionReviewInputSchema = z.object({
  expectedVersion: positiveId,
  assessment: z.object({
    result: optionalText(2000),
    score: z.number().min(0).max(100).optional(),
    publicMessage: optionalText(2000),
    internalNotes: optionalText(10000),
  }).strict().optional(),
  interview: z.object({
    scheduledAt: z.string().datetime().optional(),
    result: optionalText(2000),
    publicMessage: optionalText(2000),
    internalNotes: optionalText(10000),
  }).strict().optional(),
  internalNotes: optionalText(10000),
  publicMessage: optionalText(2000),
}).strict();

export const admissionConversionInputSchema = z.object({
  expectedVersion: positiveId,
  existingStudentId: positiveId.nullable().optional(),
  existingParentId: positiveId.nullable().optional(),
  createParentRecord: z.boolean().default(false),
  parentRelationship: z.string().trim().min(1).max(80).default("Guardian"),
  section: z.string().trim().min(1).max(100).optional(),
}).strict();

export const publicAdmissionPortalResponseSchema = z.object({
  portalKey: z.string(),
  school: z.object({
    name: z.string(),
    description: z.string().nullable(),
    address: z.string().nullable(),
    publicPhone: z.string().nullable(),
    publicEmail: z.string().nullable(),
    logoUrl: z.string().nullable(),
  }).strict(),
  admission: z.object({
    open: z.boolean(),
    session: z.string().nullable().optional(),
    term: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
    feeInfo: z.string().nullable().optional(),
    requirements: z.array(z.string()).optional(),
    requiredDocuments: z.array(z.string()).optional(),
    instructions: z.string().nullable().optional(),
    entranceExamination: z.string().nullable().optional(),
    interviewInformation: z.string().nullable().optional(),
  }).strict(),
  availableClasses: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string(),
    section: z.string(),
  }).strict()),
}).strict();

export const publicAdmissionApplicationReceiptSchema = z.object({
  applicationId: positiveId,
  applicationNumber: z.string(),
  status: z.enum(admissionStatuses),
  receiptSecret: z.string().min(32),
  confirmation: z.object({
    deliveryStatus: z.enum(["NOT_SENT", "QUEUED", "CONFIRMED", "UNKNOWN"]),
    message: z.string(),
  }).strict(),
}).strict();

export const publicAdmissionApplicationStatusSchema = z.object({
  applicationNumber: z.string(),
  status: z.enum(admissionStatuses),
  publicMessage: z.string().nullable(),
  updatedAt: z.string().datetime(),
}).strict();

const admissionApplicantResponseSchema = z.object({
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  gender: z.enum(["Female", "Male", "Other", "PreferNotToSay"]),
  photoObjectPath: z.string().nullable(),
  previousSchool: z.string().nullable(),
  previousClass: z.string().nullable(),
  intendedClassId: positiveId,
  academicSessionId: positiveId,
  academicTermId: positiveId.nullable(),
  address: z.string().nullable(),
}).strict();

const admissionGuardianResponseSchema = z.object({
  fullName: z.string(),
  phone: phoneSchema,
  email: z.string().email().nullable(),
  relationship: z.string().nullable(),
  address: z.string().nullable(),
}).strict();

const admissionEmergencyContactResponseSchema = z.object({
  fullName: z.string(),
  phone: phoneSchema,
  relationship: z.string().nullable(),
}).strict();

const admissionDocumentResponseItemSchema = z.object({
  id: positiveId,
  documentType: z.string(),
  fileName: z.string(),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
  objectPath: objectPathSchema,
}).strict();

export const admissionApplicationResponseSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  applicationNumber: z.string(),
  status: z.enum(admissionStatuses),
  applicant: admissionApplicantResponseSchema,
  guardian: admissionGuardianResponseSchema,
  emergencyContact: admissionEmergencyContactResponseSchema.nullable(),
  documents: z.array(admissionDocumentResponseItemSchema),
  assessment: z.record(z.string(), z.unknown()).nullable(),
  interview: z.record(z.string(), z.unknown()).nullable(),
  internalNotes: z.string().nullable(),
  publicMessage: z.string().nullable(),
  studentId: positiveId.nullable(),
  version: positiveId,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const admissionPortalSettingsResponseSchema = admissionPortalSettingsInputSchema.extend({
  schoolId: positiveId,
  portalKey: z.string(),
  portalUrl: z.string(),
  availableSchoolLogoObjectPath: schoolLogoObjectPathSchema.nullable(),
}).strict();

export const admissionApplicationListResponseSchema = z.object({
  applications: z.array(admissionApplicationResponseSchema),
}).strict();

export const admissionConversionResponseSchema = z.object({
  applicationId: positiveId,
  studentId: positiveId,
  admissionNumber: z.string(),
  parentId: positiveId.nullable(),
  idempotent: z.boolean(),
}).strict();

export const admissionDocumentUploadInputSchema = z.object({
  documentType: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();

export const admissionDocumentUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectPath: objectPathSchema,
  expiresAt: z.string().datetime(),
}).strict();

export const admissionDocumentResponseSchema = admissionDocumentInputSchema.extend({ id: positiveId }).strict();

export const admissionDocumentDownloadInputSchema = z.object({
  receiptSecret: z.string().min(32).max(256).optional(),
}).strict();

export const admissionDocumentDownloadResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newAdmissionReceiptSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyAdmissionReceipt(secret: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(sha256(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const allowedTransitions: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
  Draft: ["Submitted", "Withdrawn"],
  Submitted: ["UnderReview", "Withdrawn"],
  UnderReview: ["Shortlisted", "InterviewScheduled", "AssessmentPending", "AssessmentCompleted", "Accepted", "Waitlisted", "Rejected", "Withdrawn"],
  Shortlisted: ["UnderReview", "InterviewScheduled", "AssessmentPending", "AssessmentCompleted", "Accepted", "Waitlisted", "Rejected", "Withdrawn"],
  InterviewScheduled: ["UnderReview", "AssessmentPending", "AssessmentCompleted", "Accepted", "Waitlisted", "Rejected", "Withdrawn"],
  AssessmentPending: ["UnderReview", "InterviewScheduled", "AssessmentCompleted", "Accepted", "Waitlisted", "Rejected", "Withdrawn"],
  AssessmentCompleted: ["UnderReview", "InterviewScheduled", "Accepted", "Waitlisted", "Rejected", "Withdrawn"],
  Accepted: ["Enrolled", "Withdrawn"],
  Waitlisted: ["UnderReview", "InterviewScheduled", "Accepted", "Rejected", "Withdrawn"],
  Rejected: [],
  Withdrawn: [],
  Enrolled: [],
};

export function canTransitionAdmissionStatus(from: AdmissionStatus, to: AdmissionStatus): boolean {
  return from === to || allowedTransitions[from].includes(to);
}