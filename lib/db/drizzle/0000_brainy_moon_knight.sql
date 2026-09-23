CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"role" text NOT NULL,
	"actor_user_id" integer,
	"clerk_user_id" text,
	"school_id" integer,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"record_id" integer,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"event_type" text DEFAULT 'APPLICATION_EVENT' NOT NULL,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "nfc_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"uid" text NOT NULL,
	"student_id" integer,
	"status" text DEFAULT 'unassigned' NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"last_scan" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parent_student_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"relationship_type" text DEFAULT 'Guardian' NOT NULL,
	"is_primary_guardian" boolean DEFAULT false NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"contact_priority" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"class_teacher" text,
	"capacity" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"school_id" integer,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"user_id" integer,
	"admission_no" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"gender" text NOT NULL,
	"class_name" text NOT NULL,
	"section" text NOT NULL,
	"parent_name" text,
	"parent_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"term" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '5000' NOT NULL,
	"school_share" numeric(12, 2) DEFAULT '2000' NOT NULL,
	"edupulse_share" numeric(12, 2) DEFAULT '3000' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'test' NOT NULL,
	"provider_reference" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfc_cards" ADD CONSTRAINT "nfc_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_relationships" ADD CONSTRAINT "parent_student_relationships_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_student_relationships" ADD CONSTRAINT "parent_student_relationships_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parents" ADD CONSTRAINT "parents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_memberships" ADD CONSTRAINT "school_memberships_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_memberships" ADD CONSTRAINT "school_memberships_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_clerk_user_id_unique" ON "app_users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "app_users_email_idx" ON "app_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_logs_school_idx" ON "audit_logs" USING btree ("school_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "nfc_cards_uid_unique" ON "nfc_cards" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "nfc_cards_school_idx" ON "nfc_cards" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parent_student_relationship_unique" ON "parent_student_relationships" USING btree ("parent_id","student_id");--> statement-breakpoint
CREATE INDEX "parent_student_relationship_parent_idx" ON "parent_student_relationships" USING btree ("parent_id","status");--> statement-breakpoint
CREATE INDEX "parent_student_relationship_student_idx" ON "parent_student_relationships" USING btree ("student_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "parents_user_unique" ON "parents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "parents_school_idx" ON "parents" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_classes_unique" ON "school_classes" USING btree ("school_id","name","section");--> statement-breakpoint
CREATE UNIQUE INDEX "school_memberships_user_school_role_unique" ON "school_memberships" USING btree ("user_id","school_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "school_memberships_platform_role_unique" ON "school_memberships" USING btree ("user_id","role") WHERE "school_id" is null;--> statement-breakpoint
CREATE INDEX "school_memberships_user_idx" ON "school_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "school_memberships_school_idx" ON "school_memberships" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_code_unique" ON "schools" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "students_school_admission_unique" ON "students" USING btree ("school_id","admission_no");--> statement-breakpoint
CREATE UNIQUE INDEX "students_user_unique" ON "students" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "students_school_idx" ON "students" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "subscriptions_school_idx" ON "subscriptions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_reference_unique" ON "subscriptions" USING btree ("provider_reference");
--> statement-breakpoint
INSERT INTO "parent_student_relationships"
  ("parent_id", "student_id", "relationship_type", "is_primary_guardian",
   "is_emergency_contact", "contact_priority", "status")
SELECT p.id, st.id, 'Guardian', true, true, 1, 'ACTIVE'
FROM "students" st
JOIN "parents" p
  ON p.school_id = st.school_id
 AND lower(trim(p.name)) = lower(trim(st.parent_name))
 AND regexp_replace(p.phone, '\D', '', 'g') =
     regexp_replace(st.parent_phone, '\D', '', 'g')
WHERE st.parent_name IS NOT NULL
  AND st.parent_phone IS NOT NULL
ON CONFLICT ("parent_id", "student_id") DO NOTHING;