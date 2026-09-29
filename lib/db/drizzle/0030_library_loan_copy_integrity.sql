ALTER TABLE "library_book_copies"
  ADD CONSTRAINT "library_book_copies_school_book_id_unique"
  UNIQUE ("school_id", "book_id", "id");

ALTER TABLE "library_loans"
  DROP CONSTRAINT "library_loans_copy_school_fk";

ALTER TABLE "library_loans"
  ADD CONSTRAINT "library_loans_copy_book_school_fk"
  FOREIGN KEY ("school_id", "book_id", "copy_id")
  REFERENCES "library_book_copies" ("school_id", "book_id", "id");