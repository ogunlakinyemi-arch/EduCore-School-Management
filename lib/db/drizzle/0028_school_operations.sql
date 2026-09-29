CREATE TABLE "school_operation_categories" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "category_type" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_operation_categories_type_check"
    CHECK ("category_type" IN ('ASSET', 'MAINTENANCE', 'TASK'))
);
CREATE UNIQUE INDEX "school_operation_categories_school_type_name_unique"
  ON "school_operation_categories" ("school_id", "category_type", lower("name"));
CREATE UNIQUE INDEX "school_operation_categories_id_school_type_unique"
  ON "school_operation_categories" ("id", "school_id", "category_type");
CREATE INDEX "school_operation_categories_school_active_idx"
  ON "school_operation_categories" ("school_id", "category_type", "is_active");

CREATE TABLE "school_assets" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "category_id" integer,
  "category_type" text NOT NULL DEFAULT 'ASSET',
  "asset_code" text,
  "name" text NOT NULL,
  "description" text,
  "quantity" integer NOT NULL DEFAULT 1,
  "unit" text NOT NULL DEFAULT 'item',
  "location" text,
  "condition" text NOT NULL DEFAULT 'GOOD',
  "assigned_to_user_id" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "acquired_on" date,
  "status" text NOT NULL DEFAULT 'AVAILABLE',
  "notes" text,
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_assets_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "school_assets_condition_check" CHECK ("condition" IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
  CONSTRAINT "school_assets_category_type_check" CHECK ("category_type" = 'ASSET'),
  CONSTRAINT "school_assets_status_check"
    CHECK ("status" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED')),
  CONSTRAINT "school_assets_category_school_fk" FOREIGN KEY ("category_id", "school_id", "category_type")
    REFERENCES "school_operation_categories" ("id", "school_id", "category_type"),
  CONSTRAINT "school_assets_id_school_unique" UNIQUE ("id", "school_id")
);
CREATE UNIQUE INDEX "school_assets_school_code_unique"
  ON "school_assets" ("school_id", lower("asset_code")) WHERE "asset_code" IS NOT NULL;
CREATE INDEX "school_assets_school_status_idx" ON "school_assets" ("school_id", "status", "name");

CREATE TABLE "school_facilities" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "facility_type" text NOT NULL,
  "location" text,
  "condition" text NOT NULL DEFAULT 'GOOD',
  "capacity" integer,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "notes" text,
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_facilities_capacity_check" CHECK ("capacity" IS NULL OR "capacity" >= 0),
  CONSTRAINT "school_facilities_condition_check"
    CHECK ("condition" IN ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED')),
  CONSTRAINT "school_facilities_status_check"
    CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED')),
  CONSTRAINT "school_facilities_id_school_unique" UNIQUE ("id", "school_id")
);
CREATE UNIQUE INDEX "school_facilities_school_name_unique"
  ON "school_facilities" ("school_id", lower("name"));
CREATE INDEX "school_facilities_school_status_idx" ON "school_facilities" ("school_id", "status", "name");

CREATE TABLE "maintenance_requests" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "category_id" integer,
  "category_type" text NOT NULL DEFAULT 'MAINTENANCE',
  "asset_id" integer,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "location" text,
  "reported_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "assigned_to_user_id" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "priority" text NOT NULL DEFAULT 'MEDIUM',
  "status" text NOT NULL DEFAULT 'OPEN',
  "reported_at" timestamp with time zone NOT NULL DEFAULT now(),
  "due_on" date,
  "completed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "maintenance_requests_category_type_check" CHECK ("category_type" = 'MAINTENANCE'),
  CONSTRAINT "maintenance_requests_priority_check" CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT "maintenance_requests_status_check"
    CHECK ("status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "maintenance_requests_category_school_fk" FOREIGN KEY ("category_id", "school_id", "category_type")
    REFERENCES "school_operation_categories" ("id", "school_id", "category_type"),
  CONSTRAINT "maintenance_requests_asset_school_fk" FOREIGN KEY ("asset_id", "school_id")
    REFERENCES "school_assets" ("id", "school_id") ON DELETE RESTRICT,
  CONSTRAINT "maintenance_requests_id_school_unique" UNIQUE ("id", "school_id")
);
CREATE INDEX "maintenance_requests_school_status_idx"
  ON "maintenance_requests" ("school_id", "status", "priority", "reported_at");
CREATE INDEX "maintenance_requests_reporter_idx"
  ON "maintenance_requests" ("school_id", "reported_by_user_id", "reported_at");
CREATE INDEX "maintenance_requests_assignee_idx"
  ON "maintenance_requests" ("school_id", "assigned_to_user_id", "status");

CREATE TABLE "operational_tasks" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "category_id" integer,
  "category_type" text NOT NULL DEFAULT 'TASK',
  "title" text NOT NULL,
  "description" text,
  "assigned_to_user_id" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "priority" text NOT NULL DEFAULT 'MEDIUM',
  "status" text NOT NULL DEFAULT 'OPEN',
  "due_on" date,
  "notes" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "operational_tasks_category_type_check" CHECK ("category_type" = 'TASK'),
  CONSTRAINT "operational_tasks_priority_check" CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT "operational_tasks_status_check"
    CHECK ("status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "operational_tasks_category_school_fk" FOREIGN KEY ("category_id", "school_id", "category_type")
    REFERENCES "school_operation_categories" ("id", "school_id", "category_type"),
  CONSTRAINT "operational_tasks_id_school_unique" UNIQUE ("id", "school_id")
);
CREATE INDEX "operational_tasks_school_status_idx"
  ON "operational_tasks" ("school_id", "status", "priority", "due_on");
CREATE INDEX "operational_tasks_assignee_idx"
  ON "operational_tasks" ("school_id", "assigned_to_user_id", "status");

CREATE TABLE "school_operations_settings" (
  "school_id" integer PRIMARY KEY REFERENCES "schools"("id") ON DELETE RESTRICT,
  "default_maintenance_priority" text NOT NULL DEFAULT 'MEDIUM',
  "default_task_priority" text NOT NULL DEFAULT 'MEDIUM',
  "staff_can_report_maintenance" boolean NOT NULL DEFAULT true,
  "updated_by_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "school_operations_default_maintenance_priority_check"
    CHECK ("default_maintenance_priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT "school_operations_default_task_priority_check"
    CHECK ("default_task_priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'))
);
