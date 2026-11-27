import {demand,type CurrentSql,type CurrentSource} from "./current-financial-contract";
import {refundAmounts} from "./current-financial-store";

/** New source kind never invents a Flutterwave transaction for a bank receipt. */
export async function bulkCreditSource(c:CurrentSql){
 const bank=(await c.query("SELECT to_regclass('public.current_bank_credits') IS NOT NULL AS present")).rows[0]?.present;
 if(bank)await requireBankWorkflow(c);
 return `(SELECT batch_id,verified_at,amount_minor,provider_transaction_id,provider_reference,provider_reference AS proof_reference,'FLUTTERWAVE'::text AS payment_method
   FROM current_bulk_confirmations${bank?` UNION ALL SELECT batch_id,verified_at,amount_minor,
   NULL::text AS provider_transaction_id,NULL::text AS provider_reference,normalized_reference AS proof_reference,'COMPANY_BANK'::text AS payment_method FROM current_bank_credits`:""})`;
}
export async function bulkProof(c:CurrentSql,id:number){
 return (await c.query(`SELECT * FROM ${await bulkCreditSource(c)} proof WHERE batch_id=$1`,[id])).rows[0];
}
export async function activeAllocationPredicate(c:CurrentSql,alias="a"){
 demand(/^[a-z]+$/.test(alias),"INVALID_INTERNAL_ALIAS");
 const installed=(await c.query("SELECT to_regclass('public.current_bulk_allocation_releases') IS NOT NULL AS present")).rows[0]?.present;
 if(installed)await requireBankWorkflow(c);
 return installed?`NOT EXISTS(SELECT 1 FROM current_bulk_allocation_releases released WHERE released.allocation_id=${alias}.id)`:"TRUE";
}
/** Approved policy: partial refunds retain access, full refund/reversal removes it. */
export async function retainsPaidAccess(c:CurrentSql,source:CurrentSource){
 const installed=(await c.query("SELECT to_regclass('public.current_subscription_operations') IS NOT NULL AS present")).rows[0]?.present;
 // Pre-lifecycle databases cannot contain current refunds; original payment
 // eligibility must still be established by the caller, never by this helper.
 if(!installed)return true;
 return (await refundAmounts(c,source)).netPaidMinor>0;
}
export async function positiveDirectStudentIds(c:CurrentSql,schoolId:number,termId:number){
 const rows=(await c.query(`SELECT o.student_id,a.id AS attempt_id FROM student_direct_live_obligations o
   JOIN student_direct_live_attempts a ON a.obligation_id=o.id
   WHERE o.school_id=$1 AND o.academic_term_id=$2 AND o.amount_minor=320000 AND o.currency='NGN'
     AND o.school_share_minor=0 AND o.bro_share_minor=0 AND a.state='PAID'
     AND a.reference ~ '^SCV4_live_[A-Za-z0-9_-]{8,80}$' AND a.verified_at IS NOT NULL
     AND a.provider_transaction_id ~ '^[1-9][0-9]*$' AND NULLIF(btrim(a.provider_reference),'') IS NOT NULL
     AND a.provider_fee_minor>=0 AND a.additional_fee_minor>=0 AND a.provider_fee_minor+a.additional_fee_minor<320000
     AND EXISTS(SELECT 1 FROM student_direct_live_events e WHERE e.attempt_id=a.id
       AND e.kind='PROVIDER_PAYMENT_VERIFIED' AND e.details->>'transactionId'=a.provider_transaction_id)`,[schoolId,termId])).rows;
 const paid=new Set<number>();
 for(const row of rows)if(await retainsPaidAccess(c,Number(row.attempt_id)))paid.add(Number(row.student_id));
 return paid;
}
export async function requireBankWorkflow(c:CurrentSql){
 const row=(await c.query(`SELECT
   to_regclass('public.current_bank_credits') IS NOT NULL
   AND to_regclass('public.current_bulk_allocation_releases') IS NOT NULL
   AND to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL
   AND to_regclass('public.current_bulk_term_claims') IS NOT NULL AS ready`)).rows[0];
 demand(row?.ready,"BANK_REMITTANCE_SCHEMA_NOT_APPLIED");
 const guards=(await c.query(`SELECT count(*)::int AS count FROM pg_trigger t
   JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
   JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O'
     AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0 AND p.pronamespace=n.oid
     AND ((t.tgtype=7 AND p.proname='guard_current_bank_workflow' AND (r.relname,t.tgname) IN
       (('current_bank_credits','current_bank_credit_scope'),('current_bulk_allocations','current_bulk_reservation_scope'),
        ('current_bulk_allocation_releases','current_bulk_release_scope')))
       OR (t.tgtype=23 AND p.proname='guard_current_bank_workflow'
         AND r.relname='subscription_payment_assistance_requests' AND t.tgname='current_legacy_bank_reference_scope')
       OR (t.tgtype=5 AND p.proname='guard_current_bulk_term_claims'
         AND r.relname='current_bulk_allocations' AND t.tgname='current_bulk_claim_index')
       OR (t.tgtype=31 AND p.proname='guard_current_bulk_term_claims'
         AND r.relname='current_bulk_term_claims' AND t.tgname='current_bulk_claim_index_protection')
       OR (t.tgtype=27 AND p.proname='guard_student_direct_history' AND (r.relname,t.tgname) IN
       (('current_bank_credits','current_bank_credits_history'),('current_bulk_allocation_releases','current_bulk_allocation_releases_history'),
        ('current_bulk_checkout_attempts','current_bulk_checkout_attempts_history'))))`)).rows[0];
 demand(guards?.count===9,"BANK_REMITTANCE_HISTORY_AND_SCOPE_GUARDS_REQUIRED");
}
