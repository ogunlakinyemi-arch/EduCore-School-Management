-- Development-only reconciliation reference; not journaled or auto-run.
-- Rename only when the prior constraint exists and the target name is free.
DO $$
DECLARE
  old_constraint_exists boolean;
  new_constraint_exists boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.platform_devices'::regclass
        AND conname = 'platform_devices_status_check'
        AND contype = 'c'
    ),
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.platform_devices'::regclass
        AND conname = 'platform_devices_status_supported_check'
        AND contype = 'c'
    )
  INTO old_constraint_exists, new_constraint_exists;

  IF old_constraint_exists AND NOT new_constraint_exists THEN
    ALTER TABLE public.platform_devices
      RENAME CONSTRAINT platform_devices_status_check
      TO platform_devices_status_supported_check;
  ELSIF NOT old_constraint_exists AND new_constraint_exists THEN
    NULL; -- Already reconciled.
  ELSE
    RAISE EXCEPTION
      'Expected exactly one of platform_devices_status_check or platform_devices_status_supported_check on public.platform_devices';
  END IF;
  END;
$$;

-- Optional only after confirming both preconditions:
--   1. school_classes has a valid eligible UNIQUE key on (id, school_id).
--   2. Every platform_devices row with both school_class_id and school_id
--      non-NULL references a class with that same school_id (the mismatch
--      query below returns no rows).
--
-- Read-only preflight:
-- SELECT d.id, d.school_class_id, d.school_id
-- FROM public.platform_devices AS d
-- WHERE d.school_class_id IS NOT NULL
--   AND d.school_id IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1
--     FROM public.school_classes AS c
--     WHERE c.id = d.school_class_id
--       AND c.school_id = d.school_id
--   );
--
-- Only after both preconditions are verified:
-- ALTER TABLE public.platform_devices
--   VALIDATE CONSTRAINT platform_devices_class_school_fk;