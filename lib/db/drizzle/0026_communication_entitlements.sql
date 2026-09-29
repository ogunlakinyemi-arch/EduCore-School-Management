ALTER TABLE "communication_notifications"
  ADD COLUMN "subject_student_id" integer,
  ADD COLUMN "subject_class_id" integer,
  ADD CONSTRAINT "communication_notifications_subject_student_school_fk"
    FOREIGN KEY ("subject_student_id","school_id")
    REFERENCES "students"("id","school_id"),
  ADD CONSTRAINT "communication_notifications_subject_class_school_fk"
    FOREIGN KEY ("subject_class_id","school_id")
    REFERENCES "school_classes"("id","school_id"),
  ADD CONSTRAINT "communication_notifications_subject_student_school_check"
    CHECK ("subject_student_id" IS NULL OR "school_id" IS NOT NULL),
  ADD CONSTRAINT "communication_notifications_subject_class_school_check"
    CHECK ("subject_class_id" IS NULL OR "school_id" IS NOT NULL);

CREATE INDEX "communication_notifications_subject_student_dispatch_idx"
  ON "communication_notifications" ("school_id","subject_student_id","created_at")
  WHERE "subject_student_id" IS NOT NULL;
CREATE INDEX "communication_notifications_subject_class_dispatch_idx"
  ON "communication_notifications" ("school_id","subject_class_id","created_at")
  WHERE "subject_class_id" IS NOT NULL;