CREATE TABLE IF NOT EXISTS lesson_note_documents (
  id serial PRIMARY KEY,
  school_id integer NOT NULL,
  lesson_note_id integer NOT NULL,
  note_revision integer NOT NULL,
  filename text NOT NULL,
  byte_size integer NOT NULL,
  staging_path text NOT NULL,
  object_path text NOT NULL,
  sha256 text,
  context jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  uploaded_by integer NOT NULL REFERENCES app_users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  CONSTRAINT lesson_document_note_school_fk FOREIGN KEY(lesson_note_id,school_id) REFERENCES lesson_notes(id,school_id),
  CONSTRAINT lesson_document_object_path_unique UNIQUE(object_path),
  CONSTRAINT lesson_document_status_check CHECK(status IN ('PENDING','READY')),
  CONSTRAINT lesson_document_bytes_check CHECK(byte_size BETWEEN 1 AND 10485760)
);
CREATE INDEX IF NOT EXISTS lesson_document_note_idx ON lesson_note_documents(school_id,lesson_note_id,status);
