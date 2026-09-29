CREATE TABLE "communication_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "recipient_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "school_id" integer REFERENCES "schools"("id"),
  "sender_user_id" integer REFERENCES "app_users"("id"),
  "category" text NOT NULL,
  "event_key" text,
  "subject" text,
  "body" text NOT NULL,
  "link" text,
  "is_read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_notifications_id_school_recipient_unique"
    UNIQUE ("id","school_id","recipient_user_id"),
  CONSTRAINT "communication_notifications_category_check"
    CHECK ("category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
  CONSTRAINT "communication_notifications_read_check"
    CHECK (("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "communication_notifications_school_event_recipient_unique"
  ON "communication_notifications" ("school_id","event_key","recipient_user_id")
  WHERE "school_id" IS NOT NULL AND "event_key" IS NOT NULL;
CREATE UNIQUE INDEX "communication_notifications_global_event_recipient_unique"
  ON "communication_notifications" ("event_key","recipient_user_id")
  WHERE "school_id" IS NULL AND "event_key" IS NOT NULL;
CREATE INDEX "communication_notifications_recipient_read_idx"
  ON "communication_notifications" ("recipient_user_id","is_read","created_at");
CREATE INDEX "communication_notifications_school_created_idx"
  ON "communication_notifications" ("school_id","created_at");
CREATE INDEX "communication_notifications_event_idx"
  ON "communication_notifications" ("school_id","category","created_at");

CREATE TABLE "communication_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer NOT NULL REFERENCES "communication_notifications"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "provider_message_id" text,
  "provider_acknowledged_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "error_code" text,
  "last_error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_deliveries_notification_channel_unique" UNIQUE ("notification_id","channel"),
  CONSTRAINT "communication_deliveries_channel_check"
    CHECK ("channel" IN ('IN_APP','SMS','EMAIL','PUSH')),
  CONSTRAINT "communication_deliveries_status_check"
    CHECK ("status" IN ('QUEUED','PROCESSING','SENT','DELIVERED','READ','FAILED','CANCELLED')),
  CONSTRAINT "communication_deliveries_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "communication_deliveries_delivered_status_check"
    CHECK ("delivered_at" IS NULL OR "status" IN ('DELIVERED','READ')),
  CONSTRAINT "communication_deliveries_provider_ack_channel_check"
    CHECK ("provider_acknowledged_at" IS NULL OR "channel" <> 'IN_APP')
);

CREATE INDEX "communication_deliveries_retry_idx"
  ON "communication_deliveries" ("status","next_attempt_at","created_at");
CREATE INDEX "communication_deliveries_provider_message_idx"
  ON "communication_deliveries" ("channel","provider_message_id");

CREATE TABLE "communication_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "school_id" integer REFERENCES "schools"("id"),
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_preferences_category_check"
    CHECK ("category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
  CONSTRAINT "communication_preferences_channel_check"
    CHECK ("channel" IN ('IN_APP','SMS','EMAIL','PUSH'))
);

CREATE UNIQUE INDEX "communication_preferences_school_unique"
  ON "communication_preferences" ("user_id","school_id","category","channel")
  WHERE "school_id" IS NOT NULL;
CREATE UNIQUE INDEX "communication_preferences_global_unique"
  ON "communication_preferences" ("user_id","category","channel")
  WHERE "school_id" IS NULL;
CREATE INDEX "communication_preferences_user_idx"
  ON "communication_preferences" ("user_id","school_id");

CREATE TABLE "communication_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "template_key" text NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "allowed_variables" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_templates_id_school_unique" UNIQUE ("id","school_id"),
  CONSTRAINT "communication_templates_school_key_channel_unique" UNIQUE ("school_id","template_key","channel"),
  CONSTRAINT "communication_templates_category_check"
    CHECK ("category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
  CONSTRAINT "communication_templates_channel_check"
    CHECK ("channel" IN ('IN_APP','SMS','EMAIL','PUSH')),
  CONSTRAINT "communication_templates_variables_check"
    CHECK ("allowed_variables" <@ ARRAY[
      'student_name','parent_name','school_name','class_name','amount','invoice_number',
      'payment_date','attendance_date','term_name','assignment_title'
    ]::text[])
);

CREATE INDEX "communication_templates_school_active_idx"
  ON "communication_templates" ("school_id","is_active","category");

CREATE TABLE "communication_campaigns" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "template_id" integer,
  "idempotency_key" text,
  "title" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "category" text DEFAULT 'ANNOUNCEMENT' NOT NULL,
  "target_type" text NOT NULL,
  "target_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "channels" text[] NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "scheduled_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_campaigns_id_school_unique" UNIQUE ("id","school_id"),
  CONSTRAINT "communication_campaigns_template_school_fk"
    FOREIGN KEY ("template_id","school_id")
    REFERENCES "communication_templates"("id","school_id"),
  CONSTRAINT "communication_campaigns_category_check"
    CHECK ("category" IN (
      'ATTENDANCE','ACADEMIC','ASSIGNMENT','FINANCE','PAYMENT','ANNOUNCEMENT',
      'ACCOUNT','SYSTEM','SUBSCRIPTION','PARTNER','SECURITY'
    )),
  CONSTRAINT "communication_campaigns_target_type_check"
    CHECK ("target_type" IN ('SCHOOL','PARENTS','STUDENTS','TEACHERS','STAFF','CLASS','SECTION','USERS')),
  CONSTRAINT "communication_campaigns_channels_check"
    CHECK (
      cardinality("channels") > 0
      AND "channels" <@ ARRAY['IN_APP','SMS','EMAIL','PUSH']::text[]
    ),
  CONSTRAINT "communication_campaigns_status_check"
    CHECK ("status" IN ('DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED')),
  CONSTRAINT "communication_campaigns_recipient_count_check" CHECK ("recipient_count" >= 0),
  CONSTRAINT "communication_campaigns_target_criteria_check"
    CHECK (jsonb_typeof("target_criteria") = 'object')
);

CREATE UNIQUE INDEX "communication_campaigns_school_idempotency_unique"
  ON "communication_campaigns" ("school_id","idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "communication_campaigns_school_status_idx"
  ON "communication_campaigns" ("school_id","status","created_at");

CREATE TABLE "communication_campaign_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL,
  "school_id" integer NOT NULL,
  "recipient_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "notification_id" integer,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "communication_campaign_recipients_campaign_user_unique"
    UNIQUE ("campaign_id","recipient_user_id"),
  CONSTRAINT "communication_campaign_recipients_campaign_school_fk"
    FOREIGN KEY ("campaign_id","school_id")
    REFERENCES "communication_campaigns"("id","school_id"),
  CONSTRAINT "communication_campaign_recipients_notification_school_user_fk"
    FOREIGN KEY ("notification_id","school_id","recipient_user_id")
    REFERENCES "communication_notifications"("id","school_id","recipient_user_id"),
  CONSTRAINT "communication_campaign_recipients_status_check"
    CHECK ("status" IN ('QUEUED','SENT','FAILED','SKIPPED'))
);

CREATE INDEX "communication_campaign_recipients_school_status_idx"
  ON "communication_campaign_recipients" ("school_id","status","created_at");
CREATE INDEX "communication_campaign_recipients_user_idx"
  ON "communication_campaign_recipients" ("recipient_user_id","school_id","created_at");

CREATE TABLE "communication_push_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "school_id" integer REFERENCES "schools"("id"),
  "provider" text DEFAULT 'WEB_PUSH' NOT NULL,
  "opaque_device_reference" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "communication_push_devices_provider_check" CHECK ("provider" IN ('WEB_PUSH')),
  CONSTRAINT "communication_push_devices_status_check"
    CHECK (
      ("status" = 'ACTIVE' AND "revoked_at" IS NULL)
      OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
    ),
  CONSTRAINT "communication_push_devices_reference_check"
    CHECK (length(btrim("opaque_device_reference")) BETWEEN 1 AND 256)
);

CREATE UNIQUE INDEX "communication_push_devices_school_active_unique"
  ON "communication_push_devices" ("user_id","school_id","provider","opaque_device_reference")
  WHERE "school_id" IS NOT NULL AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "communication_push_devices_global_active_unique"
  ON "communication_push_devices" ("user_id","provider","opaque_device_reference")
  WHERE "school_id" IS NULL AND "status" = 'ACTIVE';
CREATE INDEX "communication_push_devices_user_school_idx"
  ON "communication_push_devices" ("user_id","school_id","status");