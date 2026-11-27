import {currentFinanceActor} from "./current-finance-access";
import {demand,type CurrentPool} from "./current-financial-contract";

/** Read requests, not the money-changing ledger's readiness contract.
 * No provider calls, payment assertions, commissions or financial writes. */
export async function readOwnerSchoolAssistance(pool:CurrentPool,actorId:number,
 schoolId?:number,page=1,pageSize=20){
 const c=await pool.connect();
 try{
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL statement_timeout='10s'");
  demand((await currentFinanceActor(c,actorId)).owner,"OWNER_ASSISTANCE_ACCESS_DENIED");
  const schools=(await c.query(`SELECT id,COALESCE(to_jsonb(s)->>'name','School #'||id::text) AS name
   FROM schools s ORDER BY id`)).rows.map(s=>({id:Number(s.id),name:s.name}));
  if(schoolId)demand(schools.some(s=>s.id===schoolId),"SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
  const storage=(await c.query(`SELECT to_regclass('public.current_payment_batches') IS NOT NULL AS available,
   to_regclass('public.current_bank_credits') IS NOT NULL AS credits`)).rows[0];
  const result={schools,batches:[] as any[],page,pageSize,total:0,storageAvailable:storage.available===true};
  // Absence is explicit, never disguised as a successful empty request store.
  // Existing individual assistance is a separate retained workflow.
  if(storage.available){
   const where=`b.snapshot->>'method'='COMPANY_BANK' AND ($1::integer IS NULL OR b.school_id=$1)`;
   const from=`FROM current_payment_batches b JOIN schools s ON s.id=b.school_id
    JOIN academic_terms t ON t.id=b.academic_term_id AND t.school_id=b.school_id`;
   result.total=Number((await c.query(`SELECT count(*) AS total ${from} WHERE ${where}`,
    [schoolId??null])).rows[0].total);
   const batches=(await c.query(`SELECT b.*,s.name AS school_name,t.name AS term_name ${from}
    WHERE ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT $2 OFFSET $3`,
    [schoolId??null,pageSize,(page-1)*pageSize])).rows;
   for(const b of batches){
    const phase=(await c.query(`SELECT state FROM current_bulk_events WHERE batch_id=$1
     AND allocation_id IS NULL ORDER BY id DESC LIMIT 1`,[b.id])).rows[0]?.state??"RESERVED";
    const items=(await c.query(`SELECT a.id,a.student_id,
     EXISTS(SELECT 1 FROM current_bulk_events ev WHERE ev.allocation_id=a.id AND ev.state='POSTED') AS posted,
     (SELECT details->>'code' FROM current_bulk_events WHERE allocation_id=a.id
      AND state='ALLOCATION_ERROR' ORDER BY id DESC LIMIT 1) AS error
     FROM current_bulk_allocations a WHERE a.batch_id=$1 ORDER BY a.id`,[b.id])).rows.map(a=>({
      id:Number(a.id),studentId:Number(a.student_id),
      studentName:b.snapshot.students?.find((s:any)=>s.studentId===Number(a.student_id))?.studentName??`Student #${a.student_id}`,
      state:a.posted?"POSTED":"UNRESOLVED",error:phase==="COMPLETED"?null:a.error??null,
     }));
    const credit=storage.credits?(await c.query(`SELECT bank_name,statement_reference,credit_date::text AS credit_date,
     amount_minor,verified_at,verified_by FROM current_bank_credits WHERE batch_id=$1`,[b.id])).rows[0]:null;
    if(["BANK_VERIFIED","RECOVERY_REQUIRED","COMPLETED"].includes(phase))
     demand(credit&&Number(credit.amount_minor)===Number(b.amount_minor),"VERIFIED_BANK_CREDIT_RECORD_REQUIRED");
    result.batches.push({id:Number(b.id),schoolId:Number(b.school_id),schoolName:b.school_name??`School #${b.school_id}`,
     termId:Number(b.academic_term_id),termName:b.term_name,reference:b.reference,state:phase,
     amountMinor:Number(b.amount_minor),method:"COMPANY_BANK",checkoutUrl:null,items,
     ...(credit?{bankProof:{bankName:credit.bank_name,statementReference:credit.statement_reference,
      creditDate:credit.credit_date,amountMinor:Number(credit.amount_minor),verifiedAt:new Date(credit.verified_at).toISOString(),
      verifiedBy:Number(credit.verified_by)}}:{})});
   }
  }
  await c.query("COMMIT");return result;
 }catch(e){await c.query("ROLLBACK").catch(()=>undefined);throw e;}
 finally{c.release();}
}
