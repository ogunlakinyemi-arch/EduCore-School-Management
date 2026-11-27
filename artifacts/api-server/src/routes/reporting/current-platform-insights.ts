import {pool} from "@workspace/db";
import {AuthError} from "../../middlewares/auth";
import {financialTransaction} from "../../services/financial-transaction";
import {requireCurrentExtensions} from "../../services/current-finance-access";
import {bulkCreditSource} from "../../services/current-payment-evidence";
import {paidDirect,refundAmounts} from "../../services/current-financial-store";
import type {CurrentPool} from "../../services/current-financial-contract";
import type {ReportDefinition} from "./core";

/** Existing current-payment evidence and net-refund definitions, not obligations. */
export function currentPlatformInsights(db:CurrentPool=pool):ReportDefinition{
 return {
  roles:["OWNER"],filters:["schoolId","from","to","sessionId","termId","limit","offset"],
  async run(context,filters){
   if(context.role!=="OWNER")throw new AuthError(403,"Platform Owner access required");
   return financialTransaction(db,async c=>{
    await requireCurrentExtensions(c);
    const credits=await bulkCreditSource(c);
    const sources=(await c.query(`WITH received AS (
      SELECT 'DIRECT' AS source,a.id,o.school_id,o.academic_term_id,a.verified_at AS paid_at
      FROM student_direct_live_attempts a JOIN student_direct_live_obligations o ON o.id=a.obligation_id
      WHERE a.state='PAID' AND o.amount_minor=320000
      UNION ALL
      SELECT 'BULK',a.id,a.school_id,a.academic_term_id,v.verified_at
      FROM current_bulk_allocations a JOIN current_payment_batches b ON b.id=a.batch_id
      JOIN ${credits} v ON v.batch_id=b.id AND v.amount_minor=b.amount_minor
      WHERE EXISTS(SELECT 1 FROM current_bulk_events e WHERE e.allocation_id=a.id AND e.state='POSTED')
    ) SELECT r.*,s.name AS school_name FROM received r JOIN schools s ON s.id=r.school_id
      JOIN academic_terms t ON t.id=r.academic_term_id AND t.school_id=r.school_id
      WHERE ($1::int IS NULL OR r.school_id=$1)
        AND ($2::int IS NULL OR t.academic_session_id=$2) AND ($3::int IS NULL OR t.id=$3)
        AND ($4::date IS NULL OR (r.paid_at AT TIME ZONE 'Africa/Lagos')::date >= $4::date)
        AND ($5::date IS NULL OR (r.paid_at AT TIME ZONE 'Africa/Lagos')::date <= $5::date)
      ORDER BY s.name,s.id,r.source,r.id`,
      [context.schoolId,filters.sessionId??null,filters.termId??null,filters.from??null,filters.to??null])).rows;
    const empty=()=>({verifiedPayments:0,verifiedGrossMinor:0,refundedMinor:0,collectionReversedMinor:0,netReceivedMinor:0});
    const summary=empty(),schools=new Map<number,ReturnType<typeof empty>&{schoolName:string}>();
    for(const row of sources){
      const source=row.source==="DIRECT"?Number(row.id):{allocationId:Number(row.id)};
      // Fail explicitly if a stored PAID/POSTED row lacks the existing proof.
      await paidDirect(c,source);
      const net=await refundAmounts(c,source);
      const school=schools.get(Number(row.school_id))??{...empty(),schoolName:row.school_name};
      for(const target of [summary,school]){
        target.verifiedPayments++;target.verifiedGrossMinor+=320000;
        target.refundedMinor+=net.refundedMinor;target.collectionReversedMinor+=net.collectionReversedMinor;
        target.netReceivedMinor+=net.netPaidMinor;
        if(Object.values(target).some(v=>typeof v==="number"&&!Number.isSafeInteger(v)))
          throw new AuthError(503,"Financial totals exceed supported exact range");
      }
      schools.set(Number(row.school_id),school);
    }
    const rows=[...schools.entries()].map(([schoolId,row])=>({schoolId,...row}));
    return {title:"Current verified student platform collections",summary,total:rows.length,
      rows:rows.slice(filters.offset,filters.offset+filters.limit),columns:[
        {key:"schoolName",label:"School"},{key:"verifiedPayments",label:"Verified payments"},
        {key:"verifiedGrossMinor",label:"Verified gross (kobo)"},
        {key:"refundedMinor",label:"Confirmed refunds (kobo)"},
        {key:"collectionReversedMinor",label:"Confirmed reversals (kobo)"},
        {key:"netReceivedMinor",label:"Net received (kobo)"},
      ]};
   });
  },
 };
}
