-- Reuse existing invoices/payments/cards. This table records only the replacement relationship.
CREATE TABLE IF NOT EXISTS student_nfc_replacement_requests (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id),
  student_id integer NOT NULL,
  old_card_id integer NOT NULL UNIQUE,
  invoice_id integer NOT NULL UNIQUE,
  requested_by integer NOT NULL REFERENCES app_users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','ISSUED')),
  new_card_id integer UNIQUE,
  issued_by integer REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  FOREIGN KEY(student_id,school_id) REFERENCES students(id,school_id),
  FOREIGN KEY(old_card_id,school_id) REFERENCES nfc_cards(id,school_id),
  FOREIGN KEY(new_card_id,school_id) REFERENCES nfc_cards(id,school_id),
  FOREIGN KEY(invoice_id,school_id) REFERENCES fee_invoices(id,school_id),
  CHECK(old_card_id IS DISTINCT FROM new_card_id),
  CHECK((status='REQUESTED' AND new_card_id IS NULL AND issued_by IS NULL AND issued_at IS NULL)
     OR (status='ISSUED' AND new_card_id IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS student_nfc_replacement_school_idx ON student_nfc_replacement_requests(school_id,student_id);