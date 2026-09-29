CREATE TABLE "school_asset_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "asset_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "quantity_before" integer,
  "quantity_after" integer,
  "assigned_to_before_user_id" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "assigned_to_after_user_id" integer REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "status_before" text,
  "status_after" text,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "event_at" timestamp with time zone NOT NULL DEFAULT now(),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "school_asset_history_event_type_check"
    CHECK ("event_type" IN ('CREATED', 'QUANTITY_CHANGED', 'ASSIGNMENT_CHANGED', 'STATUS_CHANGED', 'UPDATED')),
  CONSTRAINT "school_asset_history_quantity_check"
    CHECK (("quantity_before" IS NULL OR "quantity_before" >= 0)
      AND ("quantity_after" IS NULL OR "quantity_after" >= 0)),
  CONSTRAINT "school_asset_history_status_check"
    CHECK (("status_before" IS NULL OR "status_before" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))
      AND ("status_after" IS NULL OR "status_after" IN ('ACTIVE', 'AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'DAMAGED', 'LOST', 'RETIRED'))),
  CONSTRAINT "school_asset_history_asset_school_fk" FOREIGN KEY ("asset_id", "school_id")
    REFERENCES "school_assets" ("id", "school_id") ON DELETE RESTRICT
);
CREATE INDEX "school_asset_history_asset_timeline_idx"
  ON "school_asset_history" ("school_id", "asset_id", "event_at", "id");

CREATE TABLE "maintenance_request_status_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "maintenance_request_id" integer NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "maintenance_request_status_history_status_check"
    CHECK (("from_status" IS NULL OR "from_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
      AND "to_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "maintenance_request_status_history_request_school_fk"
    FOREIGN KEY ("maintenance_request_id", "school_id")
    REFERENCES "maintenance_requests" ("id", "school_id") ON DELETE RESTRICT
);
CREATE INDEX "maintenance_request_status_history_timeline_idx"
  ON "maintenance_request_status_history" ("school_id", "maintenance_request_id", "occurred_at", "id");

CREATE TABLE "operational_task_status_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "task_id" integer NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE RESTRICT,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "operational_task_status_history_status_check"
    CHECK (("from_status" IS NULL OR "from_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'))
      AND "to_status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "operational_task_status_history_task_school_fk"
    FOREIGN KEY ("task_id", "school_id")
    REFERENCES "operational_tasks" ("id", "school_id") ON DELETE RESTRICT
);
CREATE INDEX "operational_task_status_history_timeline_idx"
  ON "operational_task_status_history" ("school_id", "task_id", "occurred_at", "id");

CREATE FUNCTION "prevent_operations_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operations history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "school_asset_history_append_only"
  BEFORE UPDATE OR DELETE ON "school_asset_history"
  FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();
CREATE TRIGGER "maintenance_request_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "maintenance_request_status_history"
  FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();
CREATE TRIGGER "operational_task_status_history_append_only"
  BEFORE UPDATE OR DELETE ON "operational_task_status_history"
  FOR EACH ROW EXECUTE FUNCTION "prevent_operations_history_mutation"();