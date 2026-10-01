-- Incremental employee NFC support. This migration is deliberately additive:
-- existing student cards, student-history rows and attendance events are not
-- updated or reinterpreted.
CREATE TABLE IF NOT EXISTS "employee_nfc_card_bindings" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "nfc_card_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'ASSIGNED',
  "created_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "employee_nfc_card_bindings_status_check"
    CHECK ("status" IN ('ASSIGNED','ACTIVE','LOCKED','DEACTIVATED','REPLACED')),
  CONSTRAINT "employee_nfc_card_bindings_card_school_fk"
    FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "nfc_cards"("id","school_id"),
  CONSTRAINT "employee_nfc_card_bindings_employee_school_fk"
    FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id"),
  UNIQUE ("id","school_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_nfc_card_bindings_card_unique"
  ON "employee_nfc_card_bindings" ("nfc_card_id");
CREATE UNIQUE INDEX IF NOT EXISTS "employee_nfc_card_bindings_one_current_per_employee"
  ON "employee_nfc_card_bindings" ("school_id","employee_id")
  WHERE "status" IN ('ASSIGNED','ACTIVE','LOCKED');
CREATE INDEX IF NOT EXISTS "employee_nfc_card_bindings_school_status_idx"
  ON "employee_nfc_card_bindings" ("school_id","status");

CREATE TABLE IF NOT EXISTS "employee_nfc_card_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "binding_id" integer NOT NULL,
  "nfc_card_id" integer NOT NULL,
  "employee_id" integer NOT NULL,
  "action" text NOT NULL,
  "previous_status" text,
  "new_status" text,
  "replacement_nfc_card_id" integer,
  "reason" text,
  "actor_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "employee_nfc_card_history_binding_school_fk"
    FOREIGN KEY ("binding_id","school_id")
    REFERENCES "employee_nfc_card_bindings"("id","school_id"),
  CONSTRAINT "employee_nfc_card_history_card_school_fk"
    FOREIGN KEY ("nfc_card_id","school_id") REFERENCES "nfc_cards"("id","school_id"),
  CONSTRAINT "employee_nfc_card_history_employee_school_fk"
    FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id"),
  CONSTRAINT "employee_nfc_card_history_replacement_card_school_fk"
    FOREIGN KEY ("replacement_nfc_card_id","school_id") REFERENCES "nfc_cards"("id","school_id"),
  UNIQUE ("id","school_id")
);
CREATE INDEX IF NOT EXISTS "employee_nfc_card_history_employee_idx"
  ON "employee_nfc_card_history" ("school_id","employee_id","created_at");
CREATE INDEX IF NOT EXISTS "employee_nfc_card_history_card_idx"
  ON "employee_nfc_card_history" ("nfc_card_id","created_at");

CREATE TABLE IF NOT EXISTS "employee_nfc_attendance_discrepancies" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "employee_id" integer NOT NULL,
  "attendance_event_id" integer NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resolved_at" timestamptz,
  "resolved_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "employee_nfc_attendance_discrepancies_status_check"
    CHECK ("status" IN ('OPEN','RESOLVED')),
  CONSTRAINT "employee_nfc_attendance_discrepancies_employee_school_fk"
    FOREIGN KEY ("employee_id","school_id") REFERENCES "employees"("id","school_id"),
  CONSTRAINT "employee_nfc_attendance_discrepancies_event_school_fk"
    FOREIGN KEY ("attendance_event_id","school_id") REFERENCES "attendance_events"("id","school_id"),
  UNIQUE ("id","school_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_nfc_attendance_discrepancies_event_kind_unique"
  ON "employee_nfc_attendance_discrepancies" ("school_id","attendance_event_id","kind");
CREATE INDEX IF NOT EXISTS "employee_nfc_attendance_discrepancies_school_status_idx"
  ON "employee_nfc_attendance_discrepancies" ("school_id","status","created_at");

CREATE TABLE IF NOT EXISTS "employee_nfc_discrepancy_actions" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "discrepancy_id" integer NOT NULL,
  "resolution" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "employee_nfc_discrepancy_actions_discrepancy_school_fk"
    FOREIGN KEY ("discrepancy_id","school_id")
    REFERENCES "employee_nfc_attendance_discrepancies"("id","school_id")
);
CREATE INDEX IF NOT EXISTS "employee_nfc_discrepancy_actions_history_idx"
  ON "employee_nfc_discrepancy_actions" ("school_id","discrepancy_id","created_at");