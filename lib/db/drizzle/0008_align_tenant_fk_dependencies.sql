-- Align the FK dependency graph with existing production databases.
-- Production's composite FKs predate the named tenant-key constraints and
-- therefore depend on the legacy unique indexes. Recreate only the affected
-- constraints in that same order while preserving both uniqueness objects.
ALTER TABLE "student_class_assignments"
  DROP CONSTRAINT "student_class_assignments_student_school_fk";--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  DROP CONSTRAINT "student_class_assignments_class_school_fk";--> statement-breakpoint
ALTER TABLE "class_subjects"
  DROP CONSTRAINT "class_subjects_class_school_fk";--> statement-breakpoint
ALTER TABLE "teacher_class_assignments"
  DROP CONSTRAINT "teacher_class_assignments_class_school_fk";--> statement-breakpoint
ALTER TABLE "school_classes"
  DROP CONSTRAINT "school_classes_id_school_tenant_key";--> statement-breakpoint
ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_id_school_tenant_key"
  UNIQUE ("id","school_id");--> statement-breakpoint
ALTER TABLE "students"
  DROP CONSTRAINT "students_id_school_tenant_key";--> statement-breakpoint
ALTER TABLE "students"
  ADD CONSTRAINT "students_id_school_tenant_key"
  UNIQUE ("id","school_id");--> statement-breakpoint
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