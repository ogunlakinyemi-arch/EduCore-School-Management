ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_id_school_tenant_key" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "academic_sessions"
  ADD CONSTRAINT "academic_sessions_id_school_tenant_key" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "academic_terms"
  ADD CONSTRAINT "academic_terms_id_school_tenant_key" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "students"
  ADD CONSTRAINT "students_id_school_tenant_key" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_id_school_tenant_key" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_id_school_tenant_key" UNIQUE("id","school_id");