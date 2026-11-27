/** Structural source of 0185 only. Does not install guards or authorize operation. */
import {sql} from "drizzle-orm";
import {pgTable,bigserial,bigint,integer,text,date,timestamp,boolean,jsonb,check,primaryKey} from "drizzle-orm/pg-core";
import {createInsertSchema} from "drizzle-zod";
import {currentPaymentBatches,currentBulkAllocations,currentBulkEvents} from "./current-bulk-payments";
import {appUsers} from "./edupulse";
import {sourceReference as fk} from "./current-finance-keys";

export const currentBankCredits=pgTable("current_bank_credits",{
 batchId:bigint("batch_id",{mode:"number"}).primaryKey(),
 bankName:text("bank_name").notNull(),statementReference:text("statement_reference").notNull(),
 normalizedReference:text("normalized_reference").notNull().unique("current_bank_credits_normalized_reference_key"),
 creditDate:date("credit_date",{mode:"string"}).notNull(),amountMinor:bigint("amount_minor",{mode:"number"}).notNull(),
 independentlyChecked:boolean("independently_checked").notNull(),
 accountFingerprint:text("account_fingerprint").notNull(),requestKey:text("request_key").notNull().unique("current_bank_credits_request_key_key"),
 reason:text("reason").notNull(),verifiedBy:integer("verified_by").notNull(),
 verifiedAt:timestamp("verified_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[
 fk("current_bank_credits",t.batchId,currentPaymentBatches.id),fk("current_bank_credits",t.verifiedBy,appUsers.id),
 check("current_bank_credits_bank_name_check",sql`length(btrim(bank_name)) BETWEEN 2 AND 100`),
 check("current_bank_credits_statement_reference_check",sql`statement_reference ~ '^[A-Za-z0-9/._ -]{6,120}$'`),
 check("current_bank_credits_normalized_reference_check",sql`normalized_reference=lower(regexp_replace(statement_reference,'[[:space:]]','','g')) AND length(normalized_reference)>=6 AND normalized_reference ~ '[a-z0-9]'`),
 check("current_bank_credits_amount_minor_check",sql`amount_minor>0 AND amount_minor%320000=0`),
 check("current_bank_credits_independently_checked_check",sql`independently_checked IS TRUE`),
 check("current_bank_credits_account_fingerprint_check",sql`account_fingerprint ~ '^[a-f0-9]{64}$'`),
 check("current_bank_credits_reason_check",sql`length(btrim(reason)) BETWEEN 3 AND 500`),
]);
export const currentBulkAllocationReleases=pgTable("current_bulk_allocation_releases",{
 allocationId:bigint("allocation_id",{mode:"number"}).primaryKey(),eventId:bigint("event_id",{mode:"number"}).notNull(),
 releasedBy:integer("released_by").notNull(),releasedAt:timestamp("released_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[fk("current_bulk_allocation_releases",t.allocationId,currentBulkAllocations.id),
 fk("current_bulk_allocation_releases",t.eventId,currentBulkEvents.id),fk("current_bulk_allocation_releases",t.releasedBy,appUsers.id)]);
export const currentBulkCheckoutAttempts=pgTable("current_bulk_checkout_attempts",{
 id:bigserial("id",{mode:"number"}).primaryKey(),batchId:bigint("batch_id",{mode:"number"}).notNull(),
 reference:text("reference").notNull().unique("current_bulk_checkout_attempts_reference_key"),
 requestKey:text("request_key").notNull().unique("current_bulk_checkout_attempts_request_key_key"),
 previousTransactionId:text("previous_transaction_id").notNull(),evidence:jsonb("evidence").notNull(),
 reason:text("reason").notNull(),createdBy:integer("created_by").notNull(),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[fk("current_bulk_checkout_attempts",t.batchId,currentPaymentBatches.id),fk("current_bulk_checkout_attempts",t.createdBy,appUsers.id),
 check("current_bulk_checkout_attempts_reference_check",sql`reference ~ '^SCV4_live_bulk_[A-Za-z0-9_-]{8,70}$'`),
 check("current_bulk_checkout_attempts_previous_transaction_id_check",sql`previous_transaction_id ~ '^[1-9][0-9]{0,15}$'`),
 check("current_bulk_checkout_attempts_evidence_check",sql`jsonb_typeof(evidence)='object' AND evidence->>'status' IN ('failed','cancelled') AND (evidence->>'chargedAmountMinor')::bigint=0`),
 check("current_bulk_checkout_attempts_reason_check",sql`length(btrim(reason)) BETWEEN 3 AND 500`),
]);
export const insertCurrentBankCredit=createInsertSchema(currentBankCredits).omit({verifiedAt:true});
/** Mutable native uniqueness index. Only allocation/release triggers write it. */
export const currentBulkTermClaims=pgTable("current_bulk_term_claims",{
 studentId:integer("student_id").notNull(),academicTermId:integer("academic_term_id").notNull(),
 allocationId:bigint("allocation_id",{mode:"number"}).notNull().unique("current_bulk_term_claims_allocation_id_key"),
},t=>[primaryKey({name:"current_bulk_term_claims_pkey",columns:[t.studentId,t.academicTermId]}),
 fk("current_bulk_term_claims",t.allocationId,currentBulkAllocations.id)]);
export const insertCurrentBulkAllocationRelease=createInsertSchema(currentBulkAllocationReleases).omit({releasedAt:true});
export const insertCurrentBulkCheckoutAttempt=createInsertSchema(currentBulkCheckoutAttempts).omit({id:true,createdAt:true});
export type CurrentBankCredit=typeof currentBankCredits.$inferSelect;
