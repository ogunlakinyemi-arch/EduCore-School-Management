-- Preserve the device/school pairs needed by immutable attendance events
-- across future device reassignment.
ALTER TABLE "device_assignment_history"
  ADD COLUMN IF NOT EXISTS "new_school_id" integer REFERENCES "schools"("id");

CREATE TABLE IF NOT EXISTS "device_school_bindings" (
  "device_id" integer NOT NULL REFERENCES "platform_devices"("id"),
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "device_school_bindings_pkey" PRIMARY KEY ("device_id","school_id")
);
CREATE INDEX IF NOT EXISTS "device_school_bindings_school_idx"
  ON "device_school_bindings" ("school_id");

-- Keep all extant pairings before changing the event constraint. Historical
-- records are sources of truth in addition to each device's current owner.
INSERT INTO "device_school_bindings" ("device_id","school_id")
SELECT device_id, school_id FROM "attendance_events" WHERE device_id IS NOT NULL
UNION
SELECT device_id, school_id FROM "device_credentials"
UNION
SELECT device_id, school_id FROM "device_assignment_history"
UNION
SELECT device_id, previous_school_id FROM "device_assignment_history"
  WHERE previous_school_id IS NOT NULL
UNION
SELECT device_id, new_school_id FROM "device_assignment_history"
  WHERE new_school_id IS NOT NULL
UNION
SELECT id, school_id FROM "platform_devices" WHERE school_id IS NOT NULL
ON CONFLICT ("device_id","school_id") DO NOTHING;

CREATE OR REPLACE FUNCTION "prevent_device_school_binding_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'device_school_bindings is append-only';
END;
$$;
DROP TRIGGER IF EXISTS "device_school_bindings_append_only" ON "device_school_bindings";
CREATE TRIGGER "device_school_bindings_append_only"
  BEFORE UPDATE OR DELETE ON "device_school_bindings"
  FOR EACH ROW EXECUTE FUNCTION "prevent_device_school_binding_mutation"();
DROP TRIGGER IF EXISTS "device_school_bindings_no_truncate" ON "device_school_bindings";
CREATE TRIGGER "device_school_bindings_no_truncate"
  BEFORE TRUNCATE ON "device_school_bindings"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_device_school_binding_mutation"();

ALTER TABLE "attendance_events"
  DROP CONSTRAINT IF EXISTS "attendance_events_device_school_fk";
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_events_device_school_fk'
      AND conrelid = '"attendance_events"'::regclass
  ) THEN
    ALTER TABLE "attendance_events"
      ADD CONSTRAINT "attendance_events_device_school_fk"
      FOREIGN KEY ("device_id","school_id")
      REFERENCES "device_school_bindings"("device_id","school_id") NOT VALID;
  END IF;
END;
$$;
ALTER TABLE "attendance_events"
  VALIDATE CONSTRAINT "attendance_events_device_school_fk";