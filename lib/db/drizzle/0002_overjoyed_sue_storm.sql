CREATE TABLE "commission_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"commission_rule_id" integer NOT NULL,
	"academic_session_id" integer,
	"term" text NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payout_id" integer,
	"approved_at" timestamp with time zone,
	"payable_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"held_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"payment_reference" text,
	"adjustment_reference" text,
	"reversal_reference" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_ledger_amount_nonnegative" CHECK ("commission_ledger"."amount" >= 0 AND "commission_ledger"."count" > 0),
	CONSTRAINT "commission_ledger_status_check" CHECK ("commission_ledger"."status" IN ('PENDING','APPROVED','PAYABLE','PAID','HELD','REVERSED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"term" text,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"calculation_basis" text DEFAULT 'FIXED' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"partner_rate" numeric(12, 4) DEFAULT '100' NOT NULL,
	"allocation_total" numeric(12, 2) DEFAULT '5000' NOT NULL,
	"partner_amount" numeric(12, 2) DEFAULT '100' NOT NULL,
	"school_amount" numeric(12, 2) DEFAULT '2000' NOT NULL,
	"edupulse_amount" numeric(12, 2) DEFAULT '2900' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_allocation_integrity" CHECK ("commission_rules"."partner_amount" >= 0 AND "commission_rules"."school_amount" >= 0 AND "commission_rules"."edupulse_amount" >= 0 AND "commission_rules"."partner_amount" + "commission_rules"."school_amount" + "commission_rules"."edupulse_amount" = "commission_rules"."allocation_total")
);
--> statement-breakpoint
CREATE TABLE "partner_attribution_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"existing_partner_profile_id" integer,
	"attempted_partner_profile_id" integer NOT NULL,
	"referral_link_id" integer,
	"source" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"metadata" jsonb,
	"evidence" jsonb,
	"resolved_by" integer,
	"decision" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"invited_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payout_information" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"method" text NOT NULL,
	"bank_name_encrypted" text NOT NULL,
	"account_name_encrypted" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"bank_code_encrypted" text,
	"account_last4" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"academic_session_id" integer,
	"term" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_reference" text,
	"payment_date" timestamp with time zone,
	"method" text,
	"notes" text,
	"provider" text,
	"provider_reference" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"reversal_reference" text,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payouts_amount_nonnegative" CHECK ("partner_payouts"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partner_profile_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'PARTNER' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"partner_code" text NOT NULL,
	"type" text DEFAULT 'RESELLER' NOT NULL,
	"full_name" text NOT NULL,
	"business_name" text,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"state" text,
	"lga" text,
	"registration_number" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_referral_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "school_partner_attributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"partner_profile_id" integer NOT NULL,
	"referral_link_id" integer,
	"source" text DEFAULT 'REFERRAL_LINK' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "partner_profile_id" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "partner_share" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "allocation_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_existing_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("existing_partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_attempted_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("attempted_partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_referral_link_id_partner_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_conflicts" ADD CONSTRAINT "partner_attribution_conflicts_resolved_by_app_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invitations" ADD CONSTRAINT "partner_invitations_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_information" ADD CONSTRAINT "partner_payout_information_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profile_users" ADD CONSTRAINT "partner_profile_users_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profile_users" ADD CONSTRAINT "partner_profile_users_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_referral_link_id_partner_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_partner_attributions" ADD CONSTRAINT "school_partner_attributions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_ledger_subscription_period_unique" ON "commission_ledger" USING btree ("subscription_id","term");--> statement-breakpoint
CREATE INDEX "commission_ledger_partner_status_idx" ON "commission_ledger" USING btree ("partner_profile_id","status");--> statement-breakpoint
CREATE INDEX "commission_rules_status_term_idx" ON "commission_rules" USING btree ("status","term");--> statement-breakpoint
CREATE INDEX "partner_attribution_conflicts_school_status_idx" ON "partner_attribution_conflicts" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "partner_attribution_conflicts_attempted_idx" ON "partner_attribution_conflicts" USING btree ("attempted_partner_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_invitations_token_hash_unique" ON "partner_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "partner_invitations_partner_status_idx" ON "partner_invitations" USING btree ("partner_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_information_partner_unique" ON "partner_payout_information" USING btree ("partner_profile_id");--> statement-breakpoint
CREATE INDEX "partner_payout_information_status_idx" ON "partner_payout_information" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_provider_reference_unique" ON "partner_payouts" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "partner_payouts_partner_status_idx" ON "partner_payouts" USING btree ("partner_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_profile_users_unique" ON "partner_profile_users" USING btree ("partner_profile_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_profile_users_user_role_unique" ON "partner_profile_users" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "partner_profile_users_partner_idx" ON "partner_profile_users" USING btree ("partner_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_profiles_code_unique" ON "partner_profiles" USING btree ("partner_code");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_profiles_user_unique" ON "partner_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "partner_profiles_email_idx" ON "partner_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "partner_profiles_status_idx" ON "partner_profiles" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_referral_links_hash_unique" ON "partner_referral_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "partner_referral_links_partner_status_idx" ON "partner_referral_links" USING btree ("partner_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "school_partner_attributions_current_unique" ON "school_partner_attributions" USING btree ("school_id") WHERE "school_partner_attributions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "school_partner_attributions_school_history_idx" ON "school_partner_attributions" USING btree ("school_id","starts_at");--> statement-breakpoint
CREATE INDEX "school_partner_attributions_partner_idx" ON "school_partner_attributions" USING btree ("partner_profile_id","status");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_partner_profile_id_partner_profiles_id_fk" FOREIGN KEY ("partner_profile_id") REFERENCES "public"."partner_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_partner_profile_idx" ON "subscriptions" USING btree ("partner_profile_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_partner_allocation_integrity" CHECK ("subscriptions"."partner_profile_id" IS NULL OR ("subscriptions"."partner_share" IS NOT NULL AND "subscriptions"."amount" = "subscriptions"."school_share" + "subscriptions"."edupulse_share" + "subscriptions"."partner_share"));