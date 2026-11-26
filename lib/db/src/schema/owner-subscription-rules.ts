import { pgTable, bigserial, integer, text, date, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sourceKeyName } from "./current-finance-keys";

/** Drafts and their lifecycle are metadata; native billing tables remain authoritative. */
export const subscriptionRuleProposals=pgTable("subscription_rule_proposals",{
  id:bigserial("id",{mode:"number"}).primaryKey(),
  product:text("product").notNull(),
  status:text("status").notNull().default("DRAFT"),
  amountMinor:integer("amount_minor").notNull(),
  currency:text("currency").notNull().default("NGN"),
  billingPeriod:text("billing_period").notNull().default("ACADEMIC_TERM"),
  schoolShareMinor:integer("school_share_minor").notNull().default(0),
  effectiveAt:timestamp("effective_at",{withTimezone:true}).notNull(),
  endsAt:timestamp("ends_at",{withTimezone:true}),
  reason:text("reason").notNull(),
  nativeRuleId:integer("native_rule_id"),
  version:integer("version").notNull().default(1),
  createdBy:integer("created_by").notNull(),
  updatedBy:integer("updated_by").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
  activatedAt:timestamp("activated_at",{withTimezone:true}),
  retiredAt:timestamp("retired_at",{withTimezone:true}),
},t=>[
  index("subscription_rule_proposals_product_window_idx").on(t.product,t.effectiveAt,t.endsAt,t.status),
  // Keep 0175's individual source constraints, including nullable CHECK semantics.
  check("subscription_rule_proposals_product_check",sql`product IN ('STUDENT_PLATFORM','TEACHER_STAFF_PLATFORM','BRO_COMMISSION')`),
  check("subscription_rule_proposals_status_check",sql`status IN ('DRAFT','SCHEDULED','ACTIVE','RETIRED')`),
  check("subscription_rule_proposals_amount_minor_check",sql`amount_minor > 0`),
  check("subscription_rule_proposals_currency_check",sql`currency = 'NGN'`),
  check("subscription_rule_proposals_billing_period_check",sql`billing_period = 'ACADEMIC_TERM'`),
  check("subscription_rule_proposals_school_share_minor_check",sql`school_share_minor = 0`),
  check("subscription_rule_proposals_reason_check",sql`length(trim(reason)) BETWEEN 3 AND 500`),
  check("subscription_rule_proposals_version_check",sql`version > 0`),
  check("subscription_rule_proposals_check",sql`ends_at IS NULL OR ends_at > effective_at`),
  check("subscription_rule_proposals_check1",sql`product <> 'TEACHER_STAFF_PLATFORM' OR amount_minor = 200000`),
]);
export const insertSubscriptionRuleProposal=createInsertSchema(subscriptionRuleProposals).omit({
  id:true,createdAt:true,updatedAt:true,activatedAt:true,retiredAt:true,
});
export type SubscriptionRuleProposal=z.infer<typeof insertSubscriptionRuleProposal>;

/** Owner attestations of independently checked bank credit, not provider receipts. */
export const subscriptionPaymentAssistanceRequests=pgTable("subscription_payment_assistance_requests",{
  id:bigserial("id",{mode:"number"}).primaryKey(),
  schoolId:integer("school_id").notNull(),
  studentId:integer("student_id").notNull(),
  academicTermId:integer("academic_term_id").notNull(),
  amountMinor:integer("amount_minor").notNull(),
  status:text("status").notNull().default("REQUESTED"),
  requestNote:text("request_note").notNull().default(""),
  bankName:text("bank_name"),
  bankStatementReference:text("bank_statement_reference"),
  bankCreditDate:date("bank_credit_date",{mode:"string"}),
  verifiedAmountMinor:integer("verified_amount_minor"),
  verifiedBy:integer("verified_by"),
  verifiedAt:timestamp("verified_at",{withTimezone:true}),
  createdBy:integer("created_by").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  index("subscription_payment_assistance_queue_idx").on(t.status,t.createdAt),
  uniqueIndex("subscription_payment_assistance_open_uq").on(t.schoolId,t.studentId,t.academicTermId).where(sql`${t.status}<>'CANCELLED'`),
  uniqueIndex("subscription_payment_assistance_bank_credit_uq").on(t.bankStatementReference).where(sql`${t.status}='BANK_VERIFIED'`),
  uniqueIndex("subscription_payment_assistance_bank_credit_normalized_uq").on(sql`lower(btrim(${t.bankStatementReference}))`).where(sql`${t.status}='BANK_VERIFIED'`),
  check("subscription_payment_assistance_requests_amount_minor_check",sql`amount_minor > 0`),
  check("subscription_payment_assistance_requests_status_check",sql`status IN ('REQUESTED','BANK_VERIFIED','CANCELLED')`),
  check(sourceKeyName("subscription_payment_assistance_requests",["verified_amount_minor"],"check"),sql`verified_amount_minor > 0`),
  check("subscription_payment_assistance_requests_check",sql`status <> 'BANK_VERIFIED' OR (
    bank_name IS NOT NULL AND bank_statement_reference IS NOT NULL
    AND bank_credit_date IS NOT NULL AND verified_amount_minor = amount_minor
    AND verified_by IS NOT NULL AND verified_at IS NOT NULL)`),
]);
export const insertSubscriptionPaymentAssistanceRequest=createInsertSchema(subscriptionPaymentAssistanceRequests).omit({
  id:true,createdAt:true,verifiedAt:true,
});
export type SubscriptionPaymentAssistanceRequest=z.infer<typeof insertSubscriptionPaymentAssistanceRequest>;
