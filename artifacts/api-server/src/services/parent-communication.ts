import { z } from "zod";

const positiveId = z.number().int().positive();
const requestKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const messageBody = z.string().trim().min(1).max(5000);

export const parentCommunicationChildrenResponseSchema = z.object({
  children: z.array(z.object({
    studentId: positiveId,
    schoolId: positiveId,
    schoolName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    className: z.string().nullable(),
    section: z.string().nullable(),
  }).strict()),
}).strict();

export const parentCreateThreadInputSchema = z.object({
  studentId: positiveId,
  subject: z.string().trim().min(1).max(200),
  category: z.enum(["GENERAL", "ACADEMIC", "ASSIGNMENT", "FINANCE"]),
  body: messageBody,
  idempotencyKey: requestKey,
}).strict();

export const staffCreateThreadInputSchema = z.object({
  schoolId: positiveId,
  studentId: positiveId,
  parentUserId: positiveId,
  subject: z.string().trim().min(1).max(200),
  category: z.enum(["GENERAL", "ACADEMIC", "ASSIGNMENT", "FINANCE"]),
  body: messageBody,
  idempotencyKey: requestKey,
}).strict();

export const replyThreadInputSchema = z.object({
  body: messageBody,
  idempotencyKey: requestKey,
}).strict();

export const parentThreadQuerySchema = z.object({
  schoolId: z.coerce.number().int().positive().optional(),
  childId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(100).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const parentThreadMessagesQuerySchema = z.object({
  beforeMessageId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const parentThreadArchiveResponseSchema = z.object({
  threadId: positiveId,
  archived: z.boolean(),
}).strict();

export const parentThreadMessageResponseSchema = z.object({
  id: positiveId,
  senderRole: z.enum(["PARENT", "SCHOOL"]),
  body: z.string(),
  createdAt: z.string().datetime(),
}).strict();

export const parentThreadSummaryResponseSchema = z.object({
  id: positiveId,
  schoolId: positiveId,
  studentId: positiveId,
  childName: z.string(),
  schoolName: z.string(),
  subject: z.string(),
  category: z.enum(["GENERAL", "ACADEMIC", "ASSIGNMENT", "FINANCE"]),
  lastMessageAt: z.string().datetime(),
  unreadCount: z.number().int().nonnegative(),
  archived: z.boolean(),
}).strict();

export const parentThreadReadResponseSchema = z.object({
  thread: parentThreadSummaryResponseSchema,
  readAt: z.string().datetime(),
}).strict();

export const parentThreadListResponseSchema = z.object({
  items: z.array(parentThreadSummaryResponseSchema),
  hasMore: z.boolean(),
  nextBeforeId: positiveId.nullable(),
}).strict();

export const parentThreadDetailResponseSchema = parentThreadSummaryResponseSchema.extend({
  messages: z.array(parentThreadMessageResponseSchema),
  hasMoreMessages: z.boolean(),
  nextBeforeMessageId: positiveId.nullable(),
}).strict();

export const parentThreadMutationResponseSchema = z.object({
  thread: parentThreadSummaryResponseSchema,
  message: parentThreadMessageResponseSchema,
  idempotent: z.boolean(),
}).strict();

export const communicationChannelAvailabilityResponseSchema = z.object({
  channels: z.array(z.object({
    channel: z.enum(["IN_APP", "PUSH", "SMS", "EMAIL"]),
    available: z.boolean(),
    status: z.enum(["AVAILABLE", "CONFIGURATION_REQUIRED", "UNAVAILABLE"]),
    detail: z.string(),
  }).strict()),
}).strict();