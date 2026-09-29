CREATE TABLE IF NOT EXISTS "platform_company_employees" (
  "id" serial PRIMARY KEY NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "job_title" text,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_company_employees_status_check"
    CHECK ("status" IN ('ACTIVE','INACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_company_employees_email_unique"
  ON "platform_company_employees" (lower("email"));
CREATE INDEX IF NOT EXISTS "platform_company_employees_status_idx"
  ON "platform_company_employees" ("status");