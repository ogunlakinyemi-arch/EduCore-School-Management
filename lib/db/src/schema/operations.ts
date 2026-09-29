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
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appUsers, schools } from "./edupulse";

export const schoolOperationCategories = pgTable(
  "school_operation_categories",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    categoryType: text("category_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "school_operation_categories_type_check",
      sql`${table.categoryType} IN ('ASSET', 'MAINTENANCE', 'TASK')`,
    ),
    uniqueIndex("school_operation_categories_school_type_name_unique")
      .on(table.schoolId, table.categoryType, sql`lower(${table.name})`),
    uniqueIndex("school_operation_categories_id_school_type_unique")
      .on(table.id, table.schoolId, table.categoryType),
    index("school_operation_categories_school_active_idx")
      .on(table.schoolId, table.categoryType, table.isActive),
  ],
);

export const schoolAssets = pgTable(
  "school_assets",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    categoryId: integer("category_id"),
    categoryType: text("category_type").notNull().default("ASSET"),
    assetCode: text("asset_code"),
    name: text("name").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    unit: text("unit").notNull().default("item"),
    location: text("location"),
    condition: text("condition").notNull().default("GOOD"),
    assignedToUserId: integer("assigned_to_user_id")
      .references(() => appUsers.id, { onDelete: "restrict" }),
    acquiredOn: date("acquired_on", { mode: "string" }),
    status: text("status").notNull().default("AVAILABLE"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("school_assets_quantity_check", sql`${table.quantity} >= 0`),
    check(
      "school_assets_condition_check",
      sql`${table.condition} IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')`,
    ),
    check("school_assets_category_type_check", sql`${table.categoryType} = 'ASSET'`),
    check(
      "school_assets_status_check",
      sql`${table.status} IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED')`,
    ),
    foreignKey({
      columns: [table.categoryId, table.schoolId, table.categoryType],
      foreignColumns: [
        schoolOperationCategories.id,
        schoolOperationCategories.schoolId,
        schoolOperationCategories.categoryType,
      ],
      name: "school_assets_category_school_fk",
    }).onDelete("no action").onUpdate("no action"),
    unique("school_assets_id_school_unique").on(table.id, table.schoolId),
    uniqueIndex("school_assets_school_code_unique")
      .on(table.schoolId, sql`lower(${table.assetCode})`)
      .where(sql`${table.assetCode} IS NOT NULL`),
    index("school_assets_school_status_idx").on(table.schoolId, table.status, table.name),
  ],
);

export const schoolFacilities = pgTable(
  "school_facilities",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    facilityType: text("facility_type").notNull(),
    location: text("location"),
    condition: text("condition").notNull().default("GOOD"),
    capacity: integer("capacity"),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "school_facilities_capacity_check",
      sql`${table.capacity} IS NULL OR ${table.capacity} >= 0`,
    ),
    check(
      "school_facilities_condition_check",
      sql`${table.condition} IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')`,
    ),
    check(
      "school_facilities_status_check",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED')`,
    ),
    unique("school_facilities_id_school_unique").on(table.id, table.schoolId),
    uniqueIndex("school_facilities_school_name_unique")
      .on(table.schoolId, sql`lower(${table.name})`),
    index("school_facilities_school_status_idx").on(table.schoolId, table.status, table.name),
  ],
);

export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    categoryId: integer("category_id"),
    categoryType: text("category_type").notNull().default("MAINTENANCE"),
    assetId: integer("asset_id"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    location: text("location"),
    reportedByUserId: integer("reported_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    assignedToUserId: integer("assigned_to_user_id")
      .references(() => appUsers.id, { onDelete: "restrict" }),
    priority: text("priority").notNull().default("MEDIUM"),
    status: text("status").notNull().default("OPEN"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    dueOn: date("due_on", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("maintenance_requests_category_type_check", sql`${table.categoryType} = 'MAINTENANCE'`),
    check(
      "maintenance_requests_priority_check",
      sql`${table.priority} IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')`,
    ),
    check(
      "maintenance_requests_status_check",
      sql`${table.status} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')`,
    ),
    foreignKey({
      columns: [table.categoryId, table.schoolId, table.categoryType],
      foreignColumns: [
        schoolOperationCategories.id,
        schoolOperationCategories.schoolId,
        schoolOperationCategories.categoryType,
      ],
      name: "maintenance_requests_category_school_fk",
    }),
    foreignKey({
      columns: [table.assetId, table.schoolId],
      foreignColumns: [schoolAssets.id, schoolAssets.schoolId],
      name: "maintenance_requests_asset_school_fk",
    }).onDelete("restrict"),
    unique("maintenance_requests_id_school_unique").on(table.id, table.schoolId),
    index("maintenance_requests_school_status_idx")
      .on(table.schoolId, table.status, table.priority, table.reportedAt),
    index("maintenance_requests_reporter_idx")
      .on(table.schoolId, table.reportedByUserId, table.reportedAt),
    index("maintenance_requests_assignee_idx")
      .on(table.schoolId, table.assignedToUserId, table.status),
  ],
);

export const operationalTasks = pgTable(
  "operational_tasks",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "restrict" }),
    categoryId: integer("category_id"),
    categoryType: text("category_type").notNull().default("TASK"),
    title: text("title").notNull(),
    description: text("description"),
    assignedToUserId: integer("assigned_to_user_id")
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdByUserId: integer("created_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    priority: text("priority").notNull().default("MEDIUM"),
    status: text("status").notNull().default("OPEN"),
    dueOn: date("due_on", { mode: "string" }),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("operational_tasks_category_type_check", sql`${table.categoryType} = 'TASK'`),
    check(
      "operational_tasks_priority_check",
      sql`${table.priority} IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')`,
    ),
    check(
      "operational_tasks_status_check",
      sql`${table.status} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')`,
    ),
    foreignKey({
      columns: [table.categoryId, table.schoolId, table.categoryType],
      foreignColumns: [
        schoolOperationCategories.id,
        schoolOperationCategories.schoolId,
        schoolOperationCategories.categoryType,
      ],
      name: "operational_tasks_category_school_fk",
    }),
    unique("operational_tasks_id_school_unique").on(table.id, table.schoolId),
    index("operational_tasks_school_status_idx")
      .on(table.schoolId, table.status, table.priority, table.dueOn),
    index("operational_tasks_assignee_idx")
      .on(table.schoolId, table.assignedToUserId, table.status),
  ],
);

export const schoolAssetHistory = pgTable(
  "school_asset_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    assetId: integer("asset_id").notNull(),
    eventType: text("event_type").notNull(),
    quantityBefore: integer("quantity_before"),
    quantityAfter: integer("quantity_after"),
    assignedToBeforeUserId: integer("assigned_to_before_user_id")
      .references(() => appUsers.id, { onDelete: "restrict" }),
    assignedToAfterUserId: integer("assigned_to_after_user_id")
      .references(() => appUsers.id, { onDelete: "restrict" }),
    statusBefore: text("status_before"),
    statusAfter: text("status_after"),
    actorUserId: integer("actor_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    check(
      "school_asset_history_event_type_check",
      sql`${table.eventType} IN ('CREATED', 'QUANTITY_CHANGED', 'ASSIGNMENT_CHANGED', 'STATUS_CHANGED', 'UPDATED')`,
    ),
    check(
      "school_asset_history_quantity_check",
      sql`(${table.quantityBefore} IS NULL OR ${table.quantityBefore} >= 0)
        AND (${table.quantityAfter} IS NULL OR ${table.quantityAfter} >= 0)`,
    ),
    check(
      "school_asset_history_status_check",
      sql`(${table.statusBefore} IS NULL OR ${table.statusBefore} IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))
        AND (${table.statusAfter} IS NULL OR ${table.statusAfter} IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))`,
    ),
    foreignKey({
      columns: [table.assetId, table.schoolId],
      foreignColumns: [schoolAssets.id, schoolAssets.schoolId],
      name: "school_asset_history_asset_school_fk",
    }).onDelete("restrict"),
    index("school_asset_history_asset_timeline_idx")
      .on(table.schoolId, table.assetId, table.eventAt, table.id),
  ],
);

export const maintenanceRequestStatusHistory = pgTable(
  "maintenance_request_status_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    maintenanceRequestId: integer("maintenance_request_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: integer("actor_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "maintenance_request_status_history_status_check",
      sql`(${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
        AND ${table.toStatus} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')`,
    ),
    foreignKey({
      columns: [table.maintenanceRequestId, table.schoolId],
      foreignColumns: [maintenanceRequests.id, maintenanceRequests.schoolId],
      name: "maintenance_request_status_history_request_school_fk",
    }).onDelete("restrict"),
    index("maintenance_request_status_history_timeline_idx")
      .on(table.schoolId, table.maintenanceRequestId, table.occurredAt, table.id),
  ],
);

export const operationalTaskStatusHistory = pgTable(
  "operational_task_status_history",
  {
    id: serial("id").primaryKey(),
    schoolId: integer("school_id").notNull(),
    taskId: integer("task_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: integer("actor_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "operational_task_status_history_status_check",
      sql`(${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
        AND ${table.toStatus} IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')`,
    ),
    foreignKey({
      columns: [table.taskId, table.schoolId],
      foreignColumns: [operationalTasks.id, operationalTasks.schoolId],
      name: "operational_task_status_history_task_school_fk",
    }).onDelete("restrict"),
    index("operational_task_status_history_timeline_idx")
      .on(table.schoolId, table.taskId, table.occurredAt, table.id),
  ],
);

export const schoolOperationsSettings = pgTable(
  "school_operations_settings",
  {
    schoolId: integer("school_id").primaryKey().references(() => schools.id, { onDelete: "restrict" }),
    defaultMaintenancePriority: text("default_maintenance_priority").notNull().default("MEDIUM"),
    defaultTaskPriority: text("default_task_priority").notNull().default("MEDIUM"),
    staffCanReportMaintenance: boolean("staff_can_report_maintenance").notNull().default(true),
    updatedByUserId: integer("updated_by_user_id").notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "school_operations_default_maintenance_priority_check",
      sql`${table.defaultMaintenancePriority} IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')`,
    ),
    check(
      "school_operations_default_task_priority_check",
      sql`${table.defaultTaskPriority} IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')`,
    ),
  ],
);

export const insertSchoolOperationCategorySchema = createInsertSchema(schoolOperationCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSchoolAssetSchema = createInsertSchema(schoolAssets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSchoolFacilitySchema = createInsertSchema(schoolFacilities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMaintenanceRequestSchema = createInsertSchema(maintenanceRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOperationalTaskSchema = createInsertSchema(operationalTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSchoolAssetHistorySchema = createInsertSchema(schoolAssetHistory).omit({
  id: true,
  eventAt: true,
});
export const insertMaintenanceRequestStatusHistorySchema = createInsertSchema(maintenanceRequestStatusHistory).omit({
  id: true,
  occurredAt: true,
});
export const insertOperationalTaskStatusHistorySchema = createInsertSchema(operationalTaskStatusHistory).omit({
  id: true,
  occurredAt: true,
});
export const insertSchoolOperationsSettingsSchema = createInsertSchema(schoolOperationsSettings).omit({
  updatedAt: true,
});

export type SchoolOperationCategory = typeof schoolOperationCategories.$inferSelect;
export type InsertSchoolOperationCategory = z.infer<typeof insertSchoolOperationCategorySchema>;
export type SchoolAsset = typeof schoolAssets.$inferSelect;
export type InsertSchoolAsset = z.infer<typeof insertSchoolAssetSchema>;
export type SchoolFacility = typeof schoolFacilities.$inferSelect;
export type InsertSchoolFacility = z.infer<typeof insertSchoolFacilitySchema>;
export type MaintenanceRequest = typeof maintenanceRequests.$inferSelect;
export type InsertMaintenanceRequest = z.infer<typeof insertMaintenanceRequestSchema>;
export type OperationalTask = typeof operationalTasks.$inferSelect;
export type InsertOperationalTask = z.infer<typeof insertOperationalTaskSchema>;
export type SchoolAssetHistory = typeof schoolAssetHistory.$inferSelect;
export type InsertSchoolAssetHistory = z.infer<typeof insertSchoolAssetHistorySchema>;
export type MaintenanceRequestStatusHistory = typeof maintenanceRequestStatusHistory.$inferSelect;
export type InsertMaintenanceRequestStatusHistory = z.infer<typeof insertMaintenanceRequestStatusHistorySchema>;
export type OperationalTaskStatusHistory = typeof operationalTaskStatusHistory.$inferSelect;
export type InsertOperationalTaskStatusHistory = z.infer<typeof insertOperationalTaskStatusHistorySchema>;
export type SchoolOperationsSettings = typeof schoolOperationsSettings.$inferSelect;
export type InsertSchoolOperationsSettings = z.infer<typeof insertSchoolOperationsSettingsSchema>;