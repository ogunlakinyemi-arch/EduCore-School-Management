/**
 * REVIEW-ONLY ORM source candidate for 0181/0182; intentionally not exported by
 * schema/index.ts or included in automatic push/Publish/startup. SQL candidates
 * remain authoritative for CHECK expressions and procedural guards. Referenced
 * legacy raw-SQL tables below are FK identity metadata only, never migration
 * replacement definitions. Export/schema-diff acceptance requires separate review.
 */
import {pgTable,bigserial,bigint,integer,text,jsonb,timestamp,boolean,uniqueIndex} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {schools,students,academicTerms,appUsers,partnerProfiles,schoolPartnerAttributions} from "../schema/edupulse";
import {subscriptionRuleProposals} from "../schema/owner-subscription-rules";
const legacyAttempt=pgTable("student_direct_live_attempts",{id:bigint("id",{mode:"number"}).primaryKey()});
const legacyEntitlement=pgTable("bro_term_commission_entitlements",{id:bigint("id",{mode:"number"}).primaryKey()});
const legacyReview=pgTable("student_direct_live_reviews",{id:bigint("id",{mode:"number"}).primaryKey()});
const fieldLead=pgTable("bro_field_leads",{id:bigint("id",{mode:"number"}).primaryKey()});
const serialId=()=>bigserial("id",{mode:"number"}).primaryKey();
const money=(name="amount_minor")=>bigint(name,{mode:"number"}).notNull();
const instant=()=>timestamp("created_at",{withTimezone:true}).notNull().defaultNow();
export const currentPaymentBatches=pgTable("current_payment_batches",{
 id:serialId(),schoolId:integer("school_id").notNull().references(()=>schools.id),
 academicTermId:integer("academic_term_id").notNull().references(()=>academicTerms.id),
 reference:text("reference").notNull().unique(),requestKey:text("request_key").notNull().unique(),
 amountMinor:money(),currency:text("currency").notNull().default("NGN"),
 createdBy:integer("created_by").notNull().references(()=>appUsers.id),snapshot:jsonb("snapshot").notNull(),createdAt:instant(),
});
export const currentBulkAllocations=pgTable("current_bulk_allocations",{
 id:serialId(),batchId:bigint("batch_id",{mode:"number"}).notNull().references(()=>currentPaymentBatches.id),
 schoolId:integer("school_id").notNull().references(()=>schools.id),studentId:integer("student_id").notNull().references(()=>students.id),
 academicTermId:integer("academic_term_id").notNull().references(()=>academicTerms.id),
 amountMinor:integer("amount_minor").notNull().default(320000),reviewId:bigint("review_id",{mode:"number"}).notNull().references(()=>legacyReview.id),
},t=>[uniqueIndex("current_bulk_student_term_uq").on(t.studentId,t.academicTermId),
 uniqueIndex("current_bulk_batch_student_uq").on(t.batchId,t.studentId)]);
export const currentBulkConfirmations=pgTable("current_bulk_confirmations",{
 batchId:bigint("batch_id",{mode:"number"}).primaryKey().references(()=>currentPaymentBatches.id),
 providerTransactionId:text("provider_transaction_id").notNull().unique(),providerReference:text("provider_reference").notNull().unique(),
 amountMinor:money(),verifiedAt:timestamp("verified_at",{withTimezone:true}).notNull().defaultNow(),evidence:jsonb("evidence").notNull(),
});
export const currentBulkEvents=pgTable("current_bulk_events",{
 id:serialId(),batchId:bigint("batch_id",{mode:"number"}).notNull().references(()=>currentPaymentBatches.id),
 allocationId:bigint("allocation_id",{mode:"number"}).references(()=>currentBulkAllocations.id),
 eventKey:text("event_key").notNull().unique(),state:text("state").notNull(),
 actorUserId:integer("actor_user_id").notNull().references(()=>appUsers.id),details:jsonb("details").notNull().default({}),createdAt:instant(),
},t=>[uniqueIndex("current_bulk_posted_once").on(t.allocationId).where(sql`${t.state}='POSTED'`)]);
export const currentBulkBroEntitlements=pgTable("current_bulk_bro_entitlements",{
 id:serialId(),allocationId:bigint("allocation_id",{mode:"number"}).notNull().unique().references(()=>currentBulkAllocations.id),
 schoolId:integer("school_id").notNull().references(()=>schools.id),studentId:integer("student_id").notNull().references(()=>students.id),
 academicTermId:integer("academic_term_id").notNull().references(()=>academicTerms.id),
 partnerProfileId:integer("partner_profile_id").notNull().references(()=>partnerProfiles.id),
 attributionId:integer("attribution_id").notNull().references(()=>schoolPartnerAttributions.id),
 policyId:bigint("policy_id",{mode:"number"}).notNull().references(()=>subscriptionRuleProposals.id),
 amountMinor:integer("amount_minor").notNull().default(15000),earnedAt:timestamp("earned_at",{withTimezone:true}).notNull(),
 evidence:jsonb("evidence").notNull(),createdBy:integer("created_by").notNull().references(()=>appUsers.id),
},t=>[uniqueIndex("current_bulk_bro_student_term_uq").on(t.studentId,t.academicTermId)]);
export const currentSubscriptionOperations=pgTable("current_subscription_operations",{
 id:serialId(),kind:text("kind").notNull(),requestKey:text("request_key").notNull(),
 schoolId:integer("school_id").notNull().references(()=>schools.id),academicTermId:integer("academic_term_id").notNull().references(()=>academicTerms.id),
 attemptId:bigint("attempt_id",{mode:"number"}).references(()=>legacyAttempt.id),
 entitlementId:bigint("entitlement_id",{mode:"number"}).references(()=>legacyEntitlement.id),
 allocationId:bigint("allocation_id",{mode:"number"}).references(()=>currentBulkAllocations.id),
 bulkEntitlementId:bigint("bulk_entitlement_id",{mode:"number"}).references(()=>currentBulkBroEntitlements.id),
 parentId:bigint("parent_id",{mode:"number"}),amountMinor:money(),currency:text("currency").notNull().default("NGN"),
 reason:text("reason").notNull(),createdBy:integer("created_by").notNull().references(()=>appUsers.id),snapshot:jsonb("snapshot").notNull(),createdAt:instant(),
},t=>[uniqueIndex("current_operation_request_uq").on(t.kind,t.requestKey),
 uniqueIndex("current_subscription_bro_root_uq").on(t.entitlementId).where(sql`${t.kind}='BRO'`),
 uniqueIndex("current_subscription_bulk_bro_root_uq").on(t.bulkEntitlementId).where(sql`${t.kind}='BRO'`)]);
export const currentSubscriptionOperationEvents=pgTable("current_subscription_operation_events",{
 id:serialId(),operationId:bigint("operation_id",{mode:"number"}).notNull().references(()=>currentSubscriptionOperations.id),
 eventKey:text("event_key").notNull().unique(),state:text("state").notNull(),actorUserId:integer("actor_user_id").references(()=>appUsers.id),
 details:jsonb("details").notNull(),createdAt:instant(),
});
export const currentSubscriptionReferenceClaims=pgTable("current_subscription_reference_claims",{
 namespace:text("namespace").notNull(),reference:text("reference").notNull(),
 operationId:bigint("operation_id",{mode:"number"}).notNull().references(()=>currentSubscriptionOperations.id),
},t=>[uniqueIndex("current_subscription_reference_identity_uq").on(t.namespace,t.reference)]);
export const currentBroWithdrawals=pgTable("current_bro_withdrawals",{
 id:serialId(),partnerProfileId:integer("partner_profile_id").notNull().references(()=>partnerProfiles.id),
 createdBy:integer("created_by").notNull().references(()=>appUsers.id),requestKey:text("request_key").notNull().unique(),
 amountMinor:money(),reason:text("reason").notNull(),snapshot:jsonb("snapshot").notNull(),createdAt:instant(),
});
export const currentBroWithdrawalLines=pgTable("current_bro_withdrawal_lines",{
 id:serialId(),requestId:bigint("request_id",{mode:"number"}).notNull().references(()=>currentBroWithdrawals.id),
 entitlementId:bigint("entitlement_id",{mode:"number"}).unique().references(()=>legacyEntitlement.id),
 bulkEntitlementId:bigint("bulk_entitlement_id",{mode:"number"}).unique().references(()=>currentBulkBroEntitlements.id),
 journalId:bigint("journal_id",{mode:"number"}).notNull().unique().references(()=>currentSubscriptionOperations.id),
});
export const currentBroWithdrawalDecisions=pgTable("current_bro_withdrawal_decisions",{
 lineId:bigint("line_id",{mode:"number"}).primaryKey().references(()=>currentBroWithdrawalLines.id),
 decision:text("decision").notNull(),decidedBy:integer("decided_by").notNull().references(()=>appUsers.id),
 reason:text("reason").notNull(),requestKey:text("request_key").notNull().unique(),createdAt:instant(),
});
export const fieldSmsPermissions=pgTable("bro_field_sms_permissions",{
 id:serialId(),leadId:bigint("lead_id",{mode:"number"}).notNull().references(()=>fieldLead.id),
 allowed:boolean("allowed").notNull(),phone:text("phone").notNull(),reason:text("reason").notNull(),
 actorUserId:integer("actor_user_id").notNull().references(()=>appUsers.id),createdAt:instant(),
});
export const fieldSmsCampaigns=pgTable("bro_field_sms_campaigns",{
 id:serialId(),requestKey:text("request_key").notNull().unique(),message:text("message").notNull(),
 digest:text("digest").notNull(),snapshot:jsonb("snapshot").notNull(),createdBy:integer("created_by").notNull().references(()=>appUsers.id),createdAt:instant(),
});
export const fieldSmsRecipients=pgTable("bro_field_sms_recipients",{
 id:serialId(),campaignId:bigint("campaign_id",{mode:"number"}).notNull().references(()=>fieldSmsCampaigns.id),
 leadId:bigint("lead_id",{mode:"number"}).notNull().references(()=>fieldLead.id),phone:text("phone").notNull(),schoolName:text("school_name").notNull(),
},t=>[uniqueIndex("field_sms_campaign_phone_uq").on(t.campaignId,t.phone),uniqueIndex("field_sms_campaign_lead_uq").on(t.campaignId,t.leadId)]);
export const fieldSmsEvents=pgTable("bro_field_sms_events",{
 id:serialId(),recipientId:bigint("recipient_id",{mode:"number"}).notNull().references(()=>fieldSmsRecipients.id),
 state:text("state").notNull(),actorUserId:integer("actor_user_id").notNull().references(()=>appUsers.id),details:jsonb("details").notNull(),createdAt:instant(),
});
