CREATE TABLE IF NOT EXISTS public.school_subscription_enforcement (
  school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  academic_term_id integer NOT NULL,
  restricted_student_ids integer[] NOT NULL DEFAULT '{}',
  school_locked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, academic_term_id),
  CONSTRAINT subscription_enforcement_term_school_fk
    FOREIGN KEY (academic_term_id, school_id)
    REFERENCES public.academic_terms(id, school_id)
);