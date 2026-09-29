CREATE TABLE "library_authors" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "name" text NOT NULL CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  "reference" text,
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_authors_school_id_unique" UNIQUE ("school_id", "id")
);
CREATE UNIQUE INDEX "library_authors_school_name_unique"
  ON "library_authors" ("school_id", lower("name"));

CREATE TABLE "library_publishers" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "name" text NOT NULL CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  "reference" text,
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_publishers_school_id_unique" UNIQUE ("school_id", "id")
);
CREATE UNIQUE INDEX "library_publishers_school_name_unique"
  ON "library_publishers" ("school_id", lower("name"));

CREATE TABLE "library_categories" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "name" text NOT NULL CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_categories_school_id_unique" UNIQUE ("school_id", "id")
);
CREATE UNIQUE INDEX "library_categories_school_name_unique"
  ON "library_categories" ("school_id", lower("name"));

CREATE TABLE "library_books" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "title" text NOT NULL CHECK (length(btrim("title")) BETWEEN 1 AND 300),
  "subtitle" text,
  "isbn" text,
  "author_id" integer,
  "publisher_id" integer,
  "category_id" integer,
  "publication_year" integer CHECK ("publication_year" IS NULL OR "publication_year" BETWEEN 1000 AND 2200),
  "edition" text,
  "subject" text,
  "description" text,
  "cover_reference" text,
  "language" text NOT NULL DEFAULT 'English',
  "shelf_location" text,
  "status" text NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','ARCHIVED')),
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_books_school_id_unique" UNIQUE ("school_id", "id"),
  CONSTRAINT "library_books_author_school_fk"
    FOREIGN KEY ("author_id", "school_id") REFERENCES "library_authors"("id", "school_id"),
  CONSTRAINT "library_books_publisher_school_fk"
    FOREIGN KEY ("publisher_id", "school_id") REFERENCES "library_publishers"("id", "school_id"),
  CONSTRAINT "library_books_category_school_fk"
    FOREIGN KEY ("category_id", "school_id") REFERENCES "library_categories"("id", "school_id")
);
CREATE INDEX "library_books_school_search_idx"
  ON "library_books" ("school_id", "status", lower("title"));
CREATE INDEX "library_books_isbn_idx"
  ON "library_books" ("school_id", "isbn") WHERE "isbn" IS NOT NULL;

CREATE TABLE "library_book_copies" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "book_id" integer NOT NULL,
  "copy_code" text NOT NULL CHECK (length(btrim("copy_code")) BETWEEN 1 AND 100),
  "barcode" text,
  "condition" text NOT NULL DEFAULT 'GOOD' CHECK ("condition" IN ('NEW','GOOD','FAIR','POOR')),
  "status" text NOT NULL DEFAULT 'AVAILABLE'
    CHECK ("status" IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')),
  "location" text,
  "acquired_on" date,
  "acquisition_reference" text,
  "created_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_book_copies_school_id_unique" UNIQUE ("school_id", "id"),
  CONSTRAINT "library_book_copies_book_school_fk"
    FOREIGN KEY ("book_id", "school_id") REFERENCES "library_books"("id", "school_id")
);
CREATE UNIQUE INDEX "library_book_copies_school_code_unique"
  ON "library_book_copies" ("school_id", lower("copy_code"));
CREATE UNIQUE INDEX "library_book_copies_school_barcode_unique"
  ON "library_book_copies" ("school_id", "barcode") WHERE "barcode" IS NOT NULL;
CREATE INDEX "library_book_copies_available_idx"
  ON "library_book_copies" ("school_id", "book_id", "status");

CREATE TABLE "library_settings" (
  "school_id" integer PRIMARY KEY REFERENCES "schools"("id"),
  "student_borrowing_enabled" boolean NOT NULL DEFAULT true,
  "teacher_borrowing_enabled" boolean NOT NULL DEFAULT false,
  "staff_borrowing_enabled" boolean NOT NULL DEFAULT false,
  "max_books_per_student" integer NOT NULL DEFAULT 3,
  "max_books_per_teacher" integer NOT NULL DEFAULT 5,
  "max_books_per_staff" integer NOT NULL DEFAULT 5,
  "student_loan_days" integer NOT NULL DEFAULT 14,
  "teacher_loan_days" integer NOT NULL DEFAULT 30,
  "staff_loan_days" integer NOT NULL DEFAULT 30,
  "max_renewals" integer NOT NULL DEFAULT 1,
  "renewal_requires_not_overdue" boolean NOT NULL DEFAULT true,
  "fines_enabled" boolean NOT NULL DEFAULT false,
  "updated_by_user_id" integer REFERENCES "app_users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_settings_student_limit_check" CHECK ("max_books_per_student" BETWEEN 1 AND 50),
  CONSTRAINT "library_settings_teacher_limit_check" CHECK ("max_books_per_teacher" BETWEEN 1 AND 50),
  CONSTRAINT "library_settings_staff_limit_check" CHECK ("max_books_per_staff" BETWEEN 1 AND 50),
  CONSTRAINT "library_settings_student_days_check" CHECK ("student_loan_days" BETWEEN 1 AND 180),
  CONSTRAINT "library_settings_teacher_days_check" CHECK ("teacher_loan_days" BETWEEN 1 AND 180),
  CONSTRAINT "library_settings_staff_days_check" CHECK ("staff_loan_days" BETWEEN 1 AND 180),
  CONSTRAINT "library_settings_renewals_check" CHECK ("max_renewals" BETWEEN 0 AND 20),
  CONSTRAINT "library_settings_fines_disabled_check" CHECK ("fines_enabled" = false)
);

CREATE TABLE "library_staff" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "can_manage_catalogue" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "assigned_by_user_id" integer REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_staff_school_id_unique" UNIQUE ("school_id", "id"),
  CONSTRAINT "library_staff_school_user_unique" UNIQUE ("school_id", "user_id")
);
CREATE INDEX "library_staff_school_active_idx" ON "library_staff" ("school_id", "is_active");

CREATE TABLE "library_loans" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "book_id" integer NOT NULL,
  "copy_id" integer NOT NULL,
  "borrower_type" text NOT NULL CHECK ("borrower_type" IN ('STUDENT','TEACHER','STAFF')),
  "borrower_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "borrower_student_id" integer,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "due_on" date NOT NULL,
  "returned_at" timestamptz,
  "returned_overdue" boolean,
  "days_overdue_at_return" integer,
  "status" text NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RETURNED','LOST')),
  "issued_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "returned_by_user_id" integer REFERENCES "app_users"("id"),
  "renewal_count" integer NOT NULL DEFAULT 0 CHECK ("renewal_count" >= 0),
  "idempotency_key" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_loans_school_id_unique" UNIQUE ("school_id", "id"),
  CONSTRAINT "library_loans_days_overdue_check"
    CHECK ("days_overdue_at_return" IS NULL OR "days_overdue_at_return" >= 0),
  CONSTRAINT "library_loans_borrower_student_check"
    CHECK (("borrower_type" = 'STUDENT' AND "borrower_student_id" IS NOT NULL)
    OR ("borrower_type" IN ('TEACHER','STAFF') AND "borrower_student_id" IS NULL)),
  CONSTRAINT "library_loans_returned_state_check"
    CHECK (("status" = 'RETURNED' AND "returned_at" IS NOT NULL AND "returned_by_user_id" IS NOT NULL)
    AND "returned_overdue" IS NOT NULL AND "days_overdue_at_return" IS NOT NULL
    OR ("status" <> 'RETURNED' AND "returned_at" IS NULL AND "returned_by_user_id" IS NULL
      AND "returned_overdue" IS NULL AND "days_overdue_at_return" IS NULL)),
  CONSTRAINT "library_loans_book_school_fk"
    FOREIGN KEY ("book_id", "school_id") REFERENCES "library_books"("id", "school_id"),
  CONSTRAINT "library_loans_copy_school_fk"
    FOREIGN KEY ("copy_id", "school_id") REFERENCES "library_book_copies"("id", "school_id"),
  CONSTRAINT "library_loans_student_school_fk"
    FOREIGN KEY ("borrower_student_id", "school_id") REFERENCES "students"("id", "school_id")
);
CREATE UNIQUE INDEX "library_loans_school_idempotency_unique"
  ON "library_loans" ("school_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "library_loans_open_copy_unique"
  ON "library_loans" ("school_id", "copy_id") WHERE "status" = 'OPEN';
CREATE INDEX "library_loans_borrower_history_idx"
  ON "library_loans" ("school_id", "borrower_user_id", "issued_at" DESC);
CREATE INDEX "library_loans_overdue_idx"
  ON "library_loans" ("school_id", "due_on") WHERE "status" = 'OPEN';

CREATE TABLE "library_renewals" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "loan_id" integer NOT NULL,
  "renewed_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "previous_due_on" date NOT NULL,
  "new_due_on" date NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_renewals_school_loan_key_unique" UNIQUE ("school_id", "loan_id", "idempotency_key"),
  CONSTRAINT "library_renewals_loan_school_fk"
    FOREIGN KEY ("loan_id", "school_id") REFERENCES "library_loans"("id", "school_id")
);
CREATE INDEX "library_renewals_loan_history_idx"
  ON "library_renewals" ("school_id", "loan_id", "created_at");

CREATE TABLE "library_copy_status_history" (
  "id" serial PRIMARY KEY,
  "school_id" integer NOT NULL,
  "copy_id" integer NOT NULL,
  "loan_id" integer,
  "previous_status" text NOT NULL,
  "new_status" text NOT NULL,
  "reason" text NOT NULL,
  "notes" text,
  "changed_by_user_id" integer NOT NULL REFERENCES "app_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_copy_status_history_new_status_check"
    CHECK ("new_status" IN ('AVAILABLE','BORROWED','RESERVED','LOST','DAMAGED','MAINTENANCE','RETIRED')),
  CONSTRAINT "library_copy_status_history_reason_check"
    CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "library_copy_status_history_copy_school_fk"
    FOREIGN KEY ("copy_id", "school_id") REFERENCES "library_book_copies"("id", "school_id"),
  CONSTRAINT "library_copy_status_history_loan_school_fk"
    FOREIGN KEY ("loan_id", "school_id") REFERENCES "library_loans"("id", "school_id")
);
CREATE INDEX "library_copy_status_history_idx"
  ON "library_copy_status_history" ("school_id", "copy_id", "created_at" DESC);