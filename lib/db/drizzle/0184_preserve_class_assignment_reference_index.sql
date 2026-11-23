-- Additive Development alignment. Never DROP/CASCADE the Production index:
-- academic results, report cards and promotion history reference its identity.
-- Publish should retain that index once Development declares the same object.
CREATE UNIQUE INDEX "student_class_assignments_id_school_unique"
  ON "public"."student_class_assignments" USING btree ("id", "school_id");
