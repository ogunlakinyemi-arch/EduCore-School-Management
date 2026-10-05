-- Additive workflow metadata only. Scores and reports remain in phase6 tables.
CREATE TABLE academic_result_batches (
 id serial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 academic_session_id integer NOT NULL, academic_term_id integer NOT NULL,
 school_class_id integer NOT NULL, section text NOT NULL DEFAULT '',
 subject_id integer NOT NULL, teacher_employee_id integer NOT NULL,
 components jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'DRAFT', revision integer NOT NULL DEFAULT 0,
 return_comment text, created_by integer NOT NULL REFERENCES app_users(id),
 submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT academic_result_batches_id_school_unique UNIQUE(id,school_id),
 CONSTRAINT academic_result_batches_context_unique UNIQUE(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id),
 CONSTRAINT academic_result_batches_session_fk FOREIGN KEY(academic_session_id,school_id) REFERENCES academic_sessions(id,school_id),
 CONSTRAINT academic_result_batches_term_fk FOREIGN KEY(academic_term_id,school_id) REFERENCES academic_terms(id,school_id),
 CONSTRAINT academic_result_batches_class_fk FOREIGN KEY(school_class_id,school_id) REFERENCES school_classes(id,school_id),
 CONSTRAINT academic_result_batches_subject_fk FOREIGN KEY(subject_id,school_id) REFERENCES subjects(id,school_id),
 CONSTRAINT academic_result_batches_teacher_fk FOREIGN KEY(teacher_employee_id,school_id) REFERENCES employees(id,school_id),
 CONSTRAINT academic_result_batches_status_check CHECK(status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','LOCKED')),
 CONSTRAINT academic_result_batches_revision_check CHECK(revision>=0),
 CONSTRAINT academic_result_batches_components_check CHECK(jsonb_typeof(components)='array')
);
CREATE INDEX academic_result_batches_teacher_idx ON academic_result_batches(school_id,teacher_employee_id,academic_session_id,academic_term_id);
CREATE TABLE exam_question_papers (
 id serial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 academic_session_id integer NOT NULL, academic_term_id integer NOT NULL,
 school_class_id integer NOT NULL, section text NOT NULL DEFAULT '',
 subject_id integer NOT NULL, teacher_employee_id integer NOT NULL,
 examination_name text NOT NULL, instructions text NOT NULL DEFAULT '',
 duration text, total_marks numeric(10,2), status text NOT NULL DEFAULT 'DRAFT',
 revision integer NOT NULL DEFAULT 0, submitted_at timestamptz, approved_at timestamptz,
 created_by integer NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT exam_question_papers_id_school_unique UNIQUE(id,school_id),
 CONSTRAINT exam_question_papers_session_fk FOREIGN KEY(academic_session_id,school_id) REFERENCES academic_sessions(id,school_id),
 CONSTRAINT exam_question_papers_term_fk FOREIGN KEY(academic_term_id,school_id) REFERENCES academic_terms(id,school_id),
 CONSTRAINT exam_question_papers_class_fk FOREIGN KEY(school_class_id,school_id) REFERENCES school_classes(id,school_id),
 CONSTRAINT exam_question_papers_subject_fk FOREIGN KEY(subject_id,school_id) REFERENCES subjects(id,school_id),
 CONSTRAINT exam_question_papers_teacher_fk FOREIGN KEY(teacher_employee_id,school_id) REFERENCES employees(id,school_id),
 CONSTRAINT exam_question_papers_status_check CHECK(status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','APPROVED')),
 CONSTRAINT exam_question_papers_revision_check CHECK(revision>=0),
 CONSTRAINT exam_question_papers_marks_check CHECK(total_marks IS NULL OR total_marks>0),
 CONSTRAINT exam_question_papers_approval_check CHECK(status<>'APPROVED' OR approved_at IS NOT NULL)
);
CREATE INDEX exam_question_papers_context_idx ON exam_question_papers(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id);
CREATE TABLE exam_question_versions (
 id serial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 paper_id integer NOT NULL, revision integer NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL, object_path text NOT NULL,
 sha256 text NOT NULL, preview_text text NOT NULL DEFAULT '',
 created_by integer NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT exam_question_versions_id_school_unique UNIQUE(id,school_id),
 CONSTRAINT exam_question_versions_paper_revision_unique UNIQUE(paper_id,revision),
 CONSTRAINT exam_question_versions_paper_fk FOREIGN KEY(paper_id,school_id) REFERENCES exam_question_papers(id,school_id),
 CONSTRAINT exam_question_versions_revision_check CHECK(revision>0),
 CONSTRAINT exam_question_versions_object_check CHECK(object_path LIKE '/objects/exam-questions/%'),
 CONSTRAINT exam_question_versions_sha_check CHECK(length(sha256)=64)
);
CREATE TABLE exam_question_reviews (
 id serial PRIMARY KEY, school_id integer NOT NULL REFERENCES schools(id),
 paper_id integer NOT NULL, version_id integer NOT NULL,
 reviewer_user_id integer NOT NULL REFERENCES app_users(id),
 decision text NOT NULL, comment text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT exam_question_reviews_paper_fk FOREIGN KEY(paper_id,school_id) REFERENCES exam_question_papers(id,school_id),
 CONSTRAINT exam_question_reviews_version_fk FOREIGN KEY(version_id,school_id) REFERENCES exam_question_versions(id,school_id),
 CONSTRAINT exam_question_reviews_decision_check CHECK(decision IN ('RETURN','APPROVE')),
 CONSTRAINT exam_question_reviews_reason_check CHECK(decision<>'RETURN' OR length(btrim(comment))>0)
);
CREATE INDEX exam_question_reviews_history_idx ON exam_question_reviews(school_id,paper_id,created_at);
