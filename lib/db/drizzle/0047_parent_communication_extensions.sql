ALTER TABLE "communication_notifications"
  ADD COLUMN "archived_at" timestamp with time zone;

ALTER TABLE "communication_campaigns"
  ADD COLUMN "is_emergency" boolean DEFAULT false NOT NULL,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD CONSTRAINT "communication_campaigns_emergency_category_check"
    CHECK (NOT "is_emergency" OR "category" = 'SECURITY');

CREATE INDEX "communication_campaigns_active_expiry_idx"
  ON "communication_campaigns" ("school_id","expires_at","created_at")
  WHERE "expires_at" IS NOT NULL;

CREATE TABLE "communication_message_threads" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "student_id" integer NOT NULL,
  "subject_class_id" integer,
  "parent_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "request_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "subject" text NOT NULL,
  "category" text DEFAULT 'GENERAL' NOT NULL,
  "parent_last_read_at" timestamp with time zone,
  "school_last_read_at" timestamp with time zone,
  "parent_archived_at" timestamp with time zone,
  "school_archived_at" timestamp with time zone,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_message_threads_id_school_unique" UNIQUE ("id","school_id"),
  CONSTRAINT "communication_message_threads_student_school_fk"
    FOREIGN KEY ("student_id","school_id") REFERENCES "students"("id","school_id"),
  CONSTRAINT "communication_message_threads_class_school_fk"
    FOREIGN KEY ("subject_class_id","school_id") REFERENCES "school_classes"("id","school_id"),
  CONSTRAINT "communication_message_threads_request_key_check"
    CHECK (length("request_key") BETWEEN 8 AND 128),
  CONSTRAINT "communication_message_threads_request_hash_check"
    CHECK (length("request_hash") = 64),
  CONSTRAINT "communication_message_threads_subject_check"
    CHECK (length(btrim("subject")) BETWEEN 1 AND 200),
  CONSTRAINT "communication_message_threads_category_check"
    CHECK ("category" IN ('GENERAL','ACADEMIC','ASSIGNMENT','FINANCE'))
);

CREATE UNIQUE INDEX "communication_message_threads_request_unique"
  ON "communication_message_threads" ("school_id","created_by_user_id","request_key");
CREATE INDEX "communication_message_threads_parent_student_idx"
  ON "communication_message_threads" ("parent_user_id","student_id","last_message_at" DESC);
CREATE INDEX "communication_message_threads_school_student_idx"
  ON "communication_message_threads" ("school_id","student_id","last_message_at" DESC);

CREATE TABLE "communication_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "thread_id" integer NOT NULL,
  "school_id" integer NOT NULL,
  "sender_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "request_key" text NOT NULL,
  "content_hash" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "communication_messages_thread_school_fk"
    FOREIGN KEY ("thread_id","school_id")
    REFERENCES "communication_message_threads"("id","school_id") ON DELETE CASCADE,
  CONSTRAINT "communication_messages_request_key_check"
    CHECK (length("request_key") BETWEEN 8 AND 128),
  CONSTRAINT "communication_messages_content_hash_check"
    CHECK (length("content_hash") = 64),
  CONSTRAINT "communication_messages_body_check"
    CHECK (length(btrim("body")) BETWEEN 1 AND 5000)
);

CREATE UNIQUE INDEX "communication_messages_request_unique"
  ON "communication_messages" ("thread_id","sender_user_id","request_key");
CREATE INDEX "communication_messages_thread_created_idx"
  ON "communication_messages" ("thread_id","created_at","id");