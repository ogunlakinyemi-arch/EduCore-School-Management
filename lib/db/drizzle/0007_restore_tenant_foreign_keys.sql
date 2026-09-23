-- Rebind the two named tenant constraints to the pre-existing unique indexes,
-- then recreate the legacy index names. This leaves both schema objects intact
-- while ensuring PostgreSQL binds the restored FKs to the named constraints.
-- Publish compares the final schemas, so none of these catalog-alignment steps
-- are emitted against production.
ALTER TABLE "school_classes"
  DROP CONSTRAINT "school_classes_id_school_tenant_key";--> statement-breakpoint
ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_id_school_tenant_key"
  UNIQUE USING INDEX "school_classes_id_school_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "school_classes_id_school_unique"
  ON "school_classes" ("id","school_id");--> statement-breakpoint
ALTER TABLE "students"
  DROP CONSTRAINT "students_id_school_tenant_key";--> statement-breakpoint
ALTER TABLE "students"
  ADD CONSTRAINT "students_id_school_tenant_key"
  UNIQUE USING INDEX "students_id_school_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "students_id_school_unique"
  ON "students" ("id","school_id");--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  ADD CONSTRAINT "student_class_assignments_student_school_fk"
  FOREIGN KEY ("student_id","school_id")
  REFERENCES "students"("id","school_id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  VALIDATE CONSTRAINT "student_class_assignments_student_school_fk";--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  ADD CONSTRAINT "student_class_assignments_class_school_fk"
  FOREIGN KEY ("school_class_id","school_id")
  REFERENCES "school_classes"("id","school_id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  VALIDATE CONSTRAINT "student_class_assignments_class_school_fk";--> statement-breakpoint
ALTER TABLE "class_subjects"
  ADD CONSTRAINT "class_subjects_class_school_fk"
  FOREIGN KEY ("school_class_id","school_id")
  REFERENCES "school_classes"("id","school_id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "class_subjects"
  VALIDATE CONSTRAINT "class_subjects_class_school_fk";--> statement-breakpoint
ALTER TABLE "teacher_class_assignments"
  ADD CONSTRAINT "teacher_class_assignments_class_school_fk"
  FOREIGN KEY ("school_class_id","school_id")
  REFERENCES "school_classes"("id","school_id")
  NOT VALID;--> statement-breakpoint
ALTER TABLE "teacher_class_assignments"
  VALIDATE CONSTRAINT "teacher_class_assignments_class_school_fk";