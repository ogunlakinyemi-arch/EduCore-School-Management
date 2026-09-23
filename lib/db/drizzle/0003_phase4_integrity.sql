INSERT INTO "commission_rules"
  ("name","status","term","currency","calculation_basis","effective_at",
   "partner_rate","allocation_total","partner_amount","school_amount","edupulse_amount")
SELECT
  'Default partner referral','ACTIVE',NULL,'NGN','PER_ELIGIBLE_STUDENT_PER_TERM',NOW(),
  100,5000,100,2000,2900
WHERE NOT EXISTS (
  SELECT 1 FROM "commission_rules"
  WHERE "status"='ACTIVE' AND "term" IS NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_attribution_conflicts_open_unique"
  ON "partner_attribution_conflicts" ("school_id","attempted_partner_profile_id")
  WHERE "status"='OPEN';
--> statement-breakpoint
ALTER TABLE "commission_ledger"
  ADD CONSTRAINT "commission_ledger_payout_id_partner_payouts_id_fk"
  FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "partner_payouts"
  ADD CONSTRAINT "partner_payouts_status_check"
  CHECK ("status" IN ('PENDING','PROCESSING','PAID','FAILED','REVERSED'));