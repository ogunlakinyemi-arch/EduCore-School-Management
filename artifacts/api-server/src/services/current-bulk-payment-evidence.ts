import type {CurrentSql} from "./current-financial-contract";
import {requireCurrentExtensions} from "./current-finance-access";
/** Read the aggregate proof plus exactly-once child posting, never a plan/reservation. */
export async function verifiedBulkStudentIds(db:CurrentSql,schoolId:number,termId:number){
 const present=(await db.query("SELECT to_regclass('public.current_bulk_confirmations') IS NOT NULL AS present")).rows[0]?.present;
 if(!present)return new Set<number>();
 await requireCurrentExtensions(db);
 const rows=(await db.query(`SELECT a.student_id FROM current_bulk_allocations a
   JOIN current_payment_batches b ON b.id=a.batch_id AND b.school_id=a.school_id AND b.academic_term_id=a.academic_term_id
   JOIN current_bulk_confirmations c ON c.batch_id=b.id AND c.amount_minor=b.amount_minor
   WHERE a.school_id=$1 AND a.academic_term_id=$2 AND a.amount_minor=320000 AND b.currency='NGN'
   AND b.reference ~ '^SCV4_live_bulk_[A-Za-z0-9_-]{8,70}$'
   AND c.provider_transaction_id ~ '^[1-9][0-9]*$' AND length(btrim(c.provider_reference))>0
   AND EXISTS(SELECT 1 FROM current_bulk_events ev WHERE ev.allocation_id=a.id AND ev.batch_id=b.id AND ev.state='POSTED')`,
   [schoolId,termId])).rows;
 return new Set<number>(rows.map(r=>Number(r.student_id)));
}
