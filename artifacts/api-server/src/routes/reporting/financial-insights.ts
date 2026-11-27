import {pool} from "@workspace/db";
import {AuthError} from "../../middlewares/auth";
import {finance} from "./business";
import type {ReportDefinition} from "./core";

/**
 * Read projection only. Reuse the fee report's verified/net-refund definition
 * for both the complete scope and each school; never sum a paginated result.
 * Platform subscription receipts are a separate existing report, not school fees.
 */
export const financialInsights:ReportDefinition={
  roles:["OWNER"],
  filters:finance.filters,
  async run(context,filters){
    if(context.role!=="OWNER")throw new AuthError(403,"Platform Owner access required");
    const all=await finance.run(context,{...filters,limit:1,offset:0});
    if(!all.summary)throw new AuthError(503,"Financial totals could not be confirmed");
    const [count,schools]=await Promise.all([
      pool.query(`SELECT count(*)::int AS total FROM schools WHERE ($1::int IS NULL OR id=$1)`,[context.schoolId]),
      pool.query(`SELECT id,name FROM schools WHERE ($1::int IS NULL OR id=$1)
        ORDER BY name,id LIMIT $2 OFFSET $3`,[context.schoolId,filters.limit,filters.offset]),
    ]);
    const rows=[];
    // Bounded by report pagination. All amounts retain their source's kobo units.
    for(const school of schools.rows){
      const scoped=await finance.run({...context,schoolId:Number(school.id)},
        {...filters,schoolId:Number(school.id),limit:1,offset:0});
      if(!scoped.summary)throw new AuthError(503,"School financial totals could not be confirmed");
      rows.push({schoolId:Number(school.id),schoolName:school.name,...scoped.summary});
    }
    return {
      title:"All-schools Financial Insights — school fees",
      columns:[
        {key:"schoolName",label:"School"},
        {key:"invoiceCount",label:"Invoices"},
        {key:"totalBilledMinor",label:"Billed (kobo; not received)"},
        {key:"totalCollectedMinor",label:"Verified net collected (kobo)"},
        {key:"totalOutstandingMinor",label:"Outstanding (kobo; not received)"},
        {key:"totalRefundedMinor",label:"Refunded (kobo)"},
        {key:"totalReversedMinor",label:"Reversed (kobo)"},
        {key:"totalWaiverMinor",label:"Waived (kobo; not received)"},
      ],
      summary:all.summary,rows,total:Number(count.rows[0].total),
    };
  },
};
