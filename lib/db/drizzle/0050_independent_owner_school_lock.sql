-- Preserve term restriction history. Never interpret an old automatic school_locked
-- flag as a new explicit Owner lock, and never touch card/payment lifecycle states.
CREATE TABLE IF NOT EXISTS public.school_subscription_manual_locks (
  school_id integer PRIMARY KEY REFERENCES public.schools(id) ON DELETE RESTRICT,
  locked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by_user_id integer REFERENCES public.app_users(id) ON DELETE RESTRICT,
  last_unlocked_at timestamptz,
  last_unlocked_by_user_id integer REFERENCES public.app_users(id) ON DELETE RESTRICT,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_manual_lock_version_nonnegative CHECK (version >= 0)
);