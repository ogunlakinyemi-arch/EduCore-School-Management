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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appUsers, schoolClasses, schools, students } from "./edupulse";

export const communicationNotifications = pgTable(
  "communication_notifications",
  {
    id: serial("id").primaryKey(),
    recipientUserId: integer("recipient_user_id").notNull().references(() => appUsers.id),
    schoolId: integer("school_id").references(() => schools.id),
    subjectStudentId: integer("subject_student_id"),
    subjectClassId: integer("subject_class_id"),
    senderUserId: integer("sender_user_id").references(() => appUsers.id),
    category: text("category").notNull(),
    eventKey: text("event_key"),
    subject: text("subject"),
    body: text("body").notNull(),
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("communication_notifications_id_school_recipient_unique").on(t.id, t.schoolId, t.recipientUserId),
    foreignKey({
      columns: [t.subjectStudentId, t.schoolId],
      foreignColumns: [students.id, students.schoolId],
      name: "communication_notifications_subject_student_school_fk",
    }),
    foreignKey({
      columns: [t.subjectClassId, t.schoolId],
      foreignColumns: [schoolClasses.id, schoolClasses.schoolId],
      name: "communication_notifications_subject_class_school_fk",
    }),
    check(
      "communication_notifications_subject_student_school_check",
      sql`${t.subjectStudentId} IS NULL OR ${t.schoolId} IS NOT NULL`,
    ),
    check(
      "communication_notifications_subject_class_school_check",
      sql`${t.subjectClassId} IS NULL OR ${t.schoolId} IS NOT NULL`,
    ),
    uniqueIndex("communication_notifications_school_event_recipient_unique")
      .on(t.schoolId, t.eventKey, t.recipientUserId)
      .where(sql`${t.schoolId} IS NOT NULL AND ${t.eventKey} IS NOT NULL`),
    uniqueIndex("communication_notifications_global_event_recipient_unique")
      .on(t.eventKey, t.recipientUserId)
      .where(sql`${t.schoolId} IS NULL AND ${t.eventKey} IS NOT NULL`),
    check("communication_notifications_category_check", sql`${t.category} IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )`),
    check(
      "communication_notifications_read_check",
      sql`(${t.isRead} = false AND ${t.readAt} IS NULL) OR (${t.isRead} = true AND ${t.readAt} IS NOT NULL)`,
    ),
    index("communication_notifications_recipient_read_idx").on(t.recipientUserId, t.isRead, t.createdAt),
    index("communication_notifications_school_created_idx").on(t.schoolId, t.createdAt),
    index("communication_notifications_event_idx").on(t.schoolId, t.category, t.createdAt),
    index("communication_notifications_subject_student_dispatch_idx")
      .on(t.schoolId, t.subjectStudentId, t.createdAt)
      .where(sql`${t.subjectStudentId} IS NOT NULL`),
    index("communication_notifications_subject_class_dispatch_idx")
      .on(t.schoolId, t.subjectClassId, t.createdAt)
      .where(sql`${t.subjectClassId} IS NOT NULL`),
  ],
);

export const communicationDeliveries = pgTable(
  "communication_deliveries",
  {
    id: serial("id").primaryKey(),
    notificationId: integer("notification_id")
      .notNull()
      .references(() => communicationNotifications.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("QUEUED"),
    providerMessageId: text("provider_message_id"),
    providerAcknowledgedAt: timestamp("provider_acknowledged_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("communication_deliveries_notification_channel_unique").on(t.notificationId, t.channel),
    check("communication_deliveries_channel_check", sql`${t.channel} IN ('IN_APP','SMS','EMAIL','PUSH')`),
    check("communication_deliveries_status_check", sql`${t.status} IN (
      'QUEUED','PROCESSING','SENT','DELIVERED','READ','FAILED','CANCELLED'
    )`),
    check("communication_deliveries_attempts_check", sql`${t.attempts} >= 0`),
    check("communication_deliveries_delivered_status_check", sql`
      ${t.deliveredAt} IS NULL OR ${t.status} IN ('DELIVERED','READ')
    `),
    check("communication_deliveries_provider_ack_channel_check", sql`
      ${t.providerAcknowledgedAt} IS NULL OR ${t.channel} <> 'IN_APP'
    `),
    index("communication_deliveries_retry_idx").on(t.status, t.nextAttemptAt, t.createdAt),
    index("communication_deliveries_provider_message_idx").on(t.channel, t.providerMessageId),
  ],
);

export const communicationPreferences = pgTable(
  "communication_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => appUsers.id),
    schoolId: integer("school_id").references(() => schools.id),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("communication_preferences_school_unique")
      .on(t.userId, t.schoolId, t.category, t.channel)
      .where(sql`${t.schoolId} IS NOT NULL`),
    uniqueIndex("communication_preferences_global_unique")
      .on(t.userId, t.category, t.channel)
      .where(sql`${t.schoolId} IS NULL`),
    check("communication_preferences_category_check", sql`${t.category} IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )`),
    check("communication_preferences_channel_check", sql`${t.channel} IN ('IN_APP','SMS','EMAIL','PUSH')`),
    index("communication_preferences_user_idx").on(t.userId, t.schoolId),
  ],
);

export const communicationTemplates = pgTable(
  "communication_templates",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    templateKey: text("template_key").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    allowedVariables: text("allowed_variables").array().notNull().default(sql`ARRAY[]::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("communication_templates_id_school_unique").on(t.id, t.schoolId),
    unique("communication_templates_school_key_channel_unique").on(t.schoolId, t.templateKey, t.channel),
    check("communication_templates_category_check", sql`${t.category} IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )`),
    check("communication_templates_channel_check", sql`${t.channel} IN ('IN_APP','SMS','EMAIL','PUSH')`),
    check("communication_templates_variables_check", sql`
      ${t.allowedVariables} <@ ARRAY[
        'student_name','parent_name','school_name','class_name','amount','invoice_number',
        'payment_date','attendance_date','term_name','assignment_title'
      ]::text[]
    `),
    index("communication_templates_school_active_idx").on(t.schoolId, t.isActive, t.category),
  ],
);

export const communicationCampaigns = pgTable(
  "communication_campaigns",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id),
    createdByUserId: integer("created_by_user_id").notNull().references(() => appUsers.id),
    templateId: integer("template_id"),
    idempotencyKey: text("idempotency_key"),
    title: text("title").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    category: text("category").notNull().default("ANNOUNCEMENT"),
    targetType: text("target_type").notNull(),
    targetCriteria: jsonb("target_criteria").$type<Record<string, unknown>>().notNull().default({}),
    channels: text("channels").array().notNull(),
    status: text("status").notNull().default("DRAFT"),
    recipientCount: integer("recipient_count").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("communication_campaigns_id_school_unique").on(t.id, t.schoolId),
    foreignKey({
      columns: [t.templateId, t.schoolId],
      foreignColumns: [communicationTemplates.id, communicationTemplates.schoolId],
      name: "communication_campaigns_template_school_fk",
    }),
    uniqueIndex("communication_campaigns_school_idempotency_unique")
      .on(t.schoolId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check("communication_campaigns_category_check", sql`${t.category} IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )`),
    check("communication_campaigns_target_type_check", sql`${t.targetType} IN (
      'SCHOOL','PARENTS','STUDENTS','TEACHERS','STAFF','CLASS','SECTION','USERS'
    )`),
    check("communication_campaigns_channels_check", sql`
      cardinality(${t.channels}) > 0
      AND ${t.channels} <@ ARRAY['IN_APP','SMS','EMAIL','PUSH']::text[]
    `),
    check("communication_campaigns_status_check", sql`${t.status} IN (
      'DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED'
    )`),
    check("communication_campaigns_recipient_count_check", sql`${t.recipientCount} >= 0`),
    check("communication_campaigns_target_criteria_check", sql`jsonb_typeof(${t.targetCriteria}) = 'object'`),
    index("communication_campaigns_school_status_idx").on(t.schoolId, t.status, t.createdAt),
  ],
);

export const communicationCampaignRecipients = pgTable(
  "communication_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull(),
    schoolId: integer("school_id").notNull(),
    recipientUserId: integer("recipient_user_id").notNull().references(() => appUsers.id),
    notificationId: integer("notification_id"),
    status: text("status").notNull().default("QUEUED"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    unique("communication_campaign_recipients_campaign_user_unique").on(t.campaignId, t.recipientUserId),
    foreignKey({
      columns: [t.campaignId, t.schoolId],
      foreignColumns: [communicationCampaigns.id, communicationCampaigns.schoolId],
      name: "communication_campaign_recipients_campaign_school_fk",
    }),
    foreignKey({
      columns: [t.notificationId, t.schoolId, t.recipientUserId],
      foreignColumns: [
        communicationNotifications.id,
        communicationNotifications.schoolId,
        communicationNotifications.recipientUserId,
      ],
      name: "communication_campaign_recipients_notification_school_user_fk",
    }),
    check("communication_campaign_recipients_status_check", sql`${t.status} IN (
      'QUEUED','SENT','FAILED','SKIPPED'
    )`),
    index("communication_campaign_recipients_school_status_idx").on(t.schoolId, t.status, t.createdAt),
    index("communication_campaign_recipients_user_idx").on(t.recipientUserId, t.schoolId, t.createdAt),
  ],
);

export const communicationPushDevices = pgTable(
  "communication_push_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => appUsers.id),
    schoolId: integer("school_id").references(() => schools.id),
    provider: text("provider").notNull().default("WEB_PUSH"),
    opaqueDeviceReference: text("opaque_device_reference").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("communication_push_devices_school_active_unique")
      .on(t.userId, t.schoolId, t.provider, t.opaqueDeviceReference)
      .where(sql`${t.schoolId} IS NOT NULL AND ${t.status} = 'ACTIVE'`),
    uniqueIndex("communication_push_devices_global_active_unique")
      .on(t.userId, t.provider, t.opaqueDeviceReference)
      .where(sql`${t.schoolId} IS NULL AND ${t.status} = 'ACTIVE'`),
    check("communication_push_devices_provider_check", sql`${t.provider} IN ('WEB_PUSH')`),
    check("communication_push_devices_status_check", sql`
      (${t.status} = 'ACTIVE' AND ${t.revokedAt} IS NULL)
      OR (${t.status} = 'REVOKED' AND ${t.revokedAt} IS NOT NULL)
    `),
    check("communication_push_devices_reference_check", sql`length(btrim(${t.opaqueDeviceReference})) BETWEEN 1 AND 256`),
    index("communication_push_devices_user_school_idx").on(t.userId, t.schoolId, t.status),
  ],
);

export const insertCommunicationNotificationSchema = createInsertSchema(communicationNotifications).omit({
  id: true,
  createdAt: true,
});
export const insertCommunicationDeliverySchema = createInsertSchema(communicationDeliveries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationPreferenceSchema = createInsertSchema(communicationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationCampaignSchema = createInsertSchema(communicationCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationCampaignRecipientSchema = createInsertSchema(communicationCampaignRecipients).omit({
  id: true,
  createdAt: true,
});
export const insertCommunicationPushDeviceSchema = createInsertSchema(communicationPushDevices).omit({
  id: true,
  createdAt: true,
});

export type CommunicationNotification = typeof communicationNotifications.$inferSelect;
export type InsertCommunicationNotification = z.infer<typeof insertCommunicationNotificationSchema>;
export type CommunicationDelivery = typeof communicationDeliveries.$inferSelect;
export type InsertCommunicationDelivery = z.infer<typeof insertCommunicationDeliverySchema>;
export type CommunicationPreference = typeof communicationPreferences.$inferSelect;
export type InsertCommunicationPreference = z.infer<typeof insertCommunicationPreferenceSchema>;
export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;
export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;
export type CommunicationCampaign = typeof communicationCampaigns.$inferSelect;
export type InsertCommunicationCampaign = z.infer<typeof insertCommunicationCampaignSchema>;
export type CommunicationCampaignRecipient = typeof communicationCampaignRecipients.$inferSelect;
export type InsertCommunicationCampaignRecipient = z.infer<typeof insertCommunicationCampaignRecipientSchema>;
export type CommunicationPushDevice = typeof communicationPushDevices.$inferSelect;
export type InsertCommunicationPushDevice = z.infer<typeof insertCommunicationPushDeviceSchema>;