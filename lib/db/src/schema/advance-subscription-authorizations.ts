/** Structural candidate only. Procedural guards in 0186 are independently required. */
import {sql} from "drizzle-orm";
import {pgTable,bigserial,bigint,integer,text,jsonb,timestamp,index,check} from "drizzle-orm/pg-core";
import {schools,academicTerms,appUsers} from "./edupulse";
import {subscriptionRuleProposals} from "./owner-subscription-rules";
import {studentDirectLiveReviews} from "./current-finance-prerequisites";
import {sourceReference as fk,sourceKeyName as key} from "./current-finance-keys";
export const advanceSubscriptionChanges=pgTable("advance_subscription_changes",{
 id:bigserial("id",{mode:"number"}).primaryKey(),schoolId:integer("school_id"),
 academicTermId:integer("academic_term_id"),academicSessionId:integer("academic_session_id"),
 sourceTable:text("source_table").notNull(),
 changedAt:timestamp("changed_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[index("advance_subscription_change_scope").on(t.schoolId,t.id)]);
export const advanceSubscriptionAuthorizations=pgTable("advance_subscription_authorizations",{
 id:bigserial("id",{mode:"number"}).primaryKey(),schoolId:integer("school_id").notNull(),
 academicTermId:integer("academic_term_id").notNull(),ruleId:bigint("rule_id",{mode:"number"}).notNull(),
 snapshot:jsonb("snapshot").notNull(),factsDigest:text("facts_digest").notNull(),
 evidenceDigest:text("evidence_digest").notNull().unique(key("advance_subscription_authorizations",["evidence_digest"],"key")),
 requestKey:text("request_key").notNull().unique(key("advance_subscription_authorizations",["request_key"],"key")),
 merchantEvidenceReference:text("merchant_evidence_reference").notNull(),merchantEvidenceHash:text("merchant_evidence_hash").notNull(),
 notBefore:timestamp("not_before",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
 createdBy:integer("created_by").notNull(),reason:text("reason").notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[
 fk("advance_subscription_authorizations",t.schoolId,schools.id),
 fk("advance_subscription_authorizations",t.academicTermId,academicTerms.id),
 fk("advance_subscription_authorizations",t.ruleId,subscriptionRuleProposals.id),
 fk("advance_subscription_authorizations",t.createdBy,appUsers.id),
 index("advance_subscription_scope").on(t.schoolId,t.academicTermId,t.id.desc()),
 check(key("advance_subscription_authorizations",["snapshot"],"check"),sql`jsonb_typeof(snapshot)='object'`),
 check(key("advance_subscription_authorizations",["facts_digest"],"check"),sql`facts_digest ~ '^[a-f0-9]{64}$'`),
 check(key("advance_subscription_authorizations",["evidence_digest"],"check"),sql`evidence_digest ~ '^[a-f0-9]{64}$'`),
 check(key("advance_subscription_authorizations",["request_key"],"check"),sql`request_key ~ '^[A-Za-z0-9_-]{16,100}$'`),
 check(key("advance_subscription_authorizations",["merchant_evidence_reference"],"check"),sql`length(trim(merchant_evidence_reference)) BETWEEN 8 AND 300`),
 check(key("advance_subscription_authorizations",["merchant_evidence_hash"],"check"),sql`merchant_evidence_hash ~ '^[a-f0-9]{64}$'`),
 check(key("advance_subscription_authorizations",["expires_at"],"check"),sql`expires_at>not_before`),
 check(key("advance_subscription_authorizations",["reason"],"check"),sql`length(trim(reason)) BETWEEN 3 AND 500`),
]);
export const advanceSubscriptionDecisions=pgTable("advance_subscription_decisions",{
 id:bigserial("id",{mode:"number"}).primaryKey(),
 authorizationId:bigint("authorization_id",{mode:"number"}).notNull(),action:text("action").notNull(),
 reviewId:bigint("review_id",{mode:"number"}).unique(key("advance_subscription_decisions",["review_id"],"key")),
 actorUserId:integer("actor_user_id"),reason:text("reason").notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[
 fk("advance_subscription_decisions",t.authorizationId,advanceSubscriptionAuthorizations.id),
 fk("advance_subscription_decisions",t.reviewId,studentDirectLiveReviews.id),
 fk("advance_subscription_decisions",t.actorUserId,appUsers.id),
 index("advance_subscription_latest").on(t.authorizationId,t.id.desc()),
 check(key("advance_subscription_decisions",["action"],"check"),sql`action IN ('REVIEWED','APPROVED','REJECTED','WITHDRAWN','INVALIDATED','EXPIRED')`),
 check(key("advance_subscription_decisions",["reason"],"check"),sql`length(trim(reason)) BETWEEN 3 AND 500`),
 check("advance_subscription_decisions_check",sql`(action='APPROVED')=(review_id IS NOT NULL)`),
]);
