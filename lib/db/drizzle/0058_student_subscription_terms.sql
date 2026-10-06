-- Add a canonical academic-period binding to the existing subscription ledger.
-- Existing subscriptions and financial history are intentionally not rewritten.
ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_nfc_session_key UNIQUE(id,school_id,academic_session_id);
CREATE TABLE student_subscription_terms (
  school_id integer NOT NULL REFERENCES schools(id),
  student_id integer NOT NULL,
  academic_session_id integer NOT NULL,
  academic_term_id integer NOT NULL,
  subscription_id integer UNIQUE,
  legacy_invoice_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id,student_id,academic_session_id,academic_term_id),
  FOREIGN KEY (student_id,school_id) REFERENCES students(id,school_id),
  FOREIGN KEY (academic_session_id,school_id) REFERENCES academic_sessions(id,school_id),
  FOREIGN KEY (academic_term_id,school_id,academic_session_id) REFERENCES academic_terms(id,school_id,academic_session_id),
  FOREIGN KEY (subscription_id,school_id,student_id) REFERENCES subscriptions(id,school_id,student_id),
  FOREIGN KEY (legacy_invoice_id,school_id) REFERENCES fee_invoices(id,school_id),
  CHECK ((subscription_id IS NOT NULL)::integer + (legacy_invoice_id IS NOT NULL)::integer = 1)
);
