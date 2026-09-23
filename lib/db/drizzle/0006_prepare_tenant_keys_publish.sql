ALTER TABLE "student_class_assignments"
  DROP CONSTRAINT IF EXISTS "student_class_assignments_student_school_fk";--> statement-breakpoint
ALTER TABLE "student_class_assignments"
  DROP CONSTRAINT IF EXISTS "student_class_assignments_class_school_fk";--> statement-breakpoint
ALTER TABLE "class_subjects"
  DROP CONSTRAINT IF EXISTS "class_subjects_class_school_fk";--> statement-breakpoint
ALTER TABLE "teacher_class_assignments"
  DROP CONSTRAINT IF EXISTS "teacher_class_assignments_class_school_fk";