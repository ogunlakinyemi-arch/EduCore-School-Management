import { z } from "zod";
import {activeAllocationPredicate,bulkCreditSource} from "./current-payment-evidence";
import { AuthError } from "../middlewares/auth";
import { lagosDate } from "./student-platform-rollout";
import {freeTermStorageReady,readFreeTermGrant} from "./owner-free-academic-term-read";
export {freeTermStorageReady,readFreeTermGrant} from "./owner-free-academic-term-read";
export type {FreeTermState} from "./owner-free-academic-term-read";

type Db = { query: (sql:string, values?:any[])=>Promise<{rows:any[]}> };
type Pool = Db & {connect:()=>Promise<Db & {release:()=>void}>};
export const freeTermSelection = z.object({
  schoolId:z.number().int().positive(), sessionId:z.number().int().positive(),
  termId:z.number().int().positive(), startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason:z.string().trim().min(5).max(500), confirmed:z.literal(true),
}).strict();
export type FreeTermSelection = z.infer<typeof freeTermSelection>;
/** Defense in depth: HTTP permission alone is not authority to append evidence. */
async function assertOwner(db:Db,actorId:number) {
  const r=await db.query(`SELECT u.id FROM app_users u JOIN school_memberships m ON m.user_id=u.id
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.status='ACTIVE'
      AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM school_memberships x WHERE x.user_id=u.id AND x.status='ACTIVE'
        AND x.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'))
      FOR SHARE OF u,m`,[actorId]);
  if(!r.rows.length)throw new AuthError(403,"Platform Owner permission required");
}
export async function changeFreeTermGrant(pool:Pool,actorId:number,raw:FreeTermSelection,action:"grant"|"suspend") {
  const input=freeTermSelection.parse(raw),c=await pool.connect();
  try {
    await c.query("BEGIN");
    await assertOwner(c,actorId);
    if(!await freeTermStorageReady(c))throw new AuthError(503,"Free-term schema approval and delivery are required; nothing was changed.");
    await c.query("SELECT pg_advisory_xact_lock(7749,$1::integer)",[input.schoolId]);
    const term=(await c.query(`SELECT t.id,t.start_date::text AS "startDate",t.end_date::text AS "endDate",
      t.status,s.status AS "sessionStatus",sc.status AS "schoolStatus"
      FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
      JOIN schools sc ON sc.id=t.school_id
      WHERE t.id=$3 AND t.school_id=$1 AND t.academic_session_id=$2 FOR SHARE OF t,s,sc`,
      [input.schoolId,input.sessionId,input.termId])).rows[0];
    if(!term)throw new AuthError(404,"The selected school, session and term do not match.");
    if(term.startDate!==input.startDate||term.endDate!==input.endDate)
      throw new AuthError(409,"The saved calendar changed. Refresh and confirm the dates again.");
    if(action==="grant"&&(!["ACTIVE","PLANNED"].includes(term.status)||!["ACTIVE","PLANNED"].includes(term.sessionStatus)||
      term.endDate<lagosDate()||term.endDate<term.startDate))
      throw new AuthError(409,"Only a current or future saved academic term can receive a grant.");
    let grant=await readFreeTermGrant(c,input.schoolId,input.termId);
    if(action==="grant"){
      if(grant)throw new AuthError(409,"This school and term already have a grant. Suspended or completed grants cannot be extended or replaced.");
      const overlaps=await c.query(`SELECT id FROM academic_terms WHERE school_id=$1 AND id<>$2
        AND status IN ('ACTIVE','PLANNED') AND start_date<=$4::date AND end_date>=$3::date`,
        [input.schoolId,input.termId,term.startDate,term.endDate]);
      if(overlaps.rows.length)throw new AuthError(409,"Overlapping school terms must be corrected before granting free usage.");
      // An already-issued checkout can still collect money. Never silently
      // cancel/reprice it or grant over its unresolved provider outcome.
      for(const table of ["student_direct_live_attempts","current_payment_batches","staff_nfc_payments"]){
        if(!(await c.query("SELECT to_regclass($1) IS NOT NULL AS present",[`public.${table}`])).rows[0]?.present)continue;
        const open=table==="student_direct_live_attempts"
          ?await c.query(`SELECT a.id FROM student_direct_live_attempts a JOIN student_direct_live_obligations o ON o.id=a.obligation_id
            WHERE o.school_id=$1 AND o.academic_term_id=$2 AND a.state NOT IN ('PAID','FAILED') LIMIT 1`,[input.schoolId,input.termId])
          :table==="current_payment_batches"
            ?await c.query(`SELECT b.id FROM current_payment_batches b WHERE b.school_id=$1 AND b.academic_term_id=$2
              AND EXISTS(SELECT 1 FROM current_bulk_allocations a WHERE a.batch_id=b.id
                AND ${await activeAllocationPredicate(c)})
              AND NOT EXISTS(SELECT 1 FROM ${await bulkCreditSource(c)} f WHERE f.batch_id=b.id) LIMIT 1`,[input.schoolId,input.termId])
            :await c.query(`SELECT id FROM staff_nfc_payments WHERE school_id=$1 AND academic_term_id=$2
              AND status NOT IN ('PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED','REVERSED','CANCELLED') LIMIT 1`,[input.schoolId,input.termId]);
        if(open.rows.length)throw new AuthError(409,"An existing checkout outcome must be reconciled before granting this term. No payment was cancelled or changed.");
      }
      grant=(await c.query(`INSERT INTO owner_free_academic_terms
        (school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [input.schoolId,input.sessionId,input.termId,term.startDate,term.endDate,actorId,input.reason])).rows[0];
    } else if(!grant||!["ACTIVE","TRIAL_GRANTED"].includes(grant.status)) {
      throw new AuthError(409,"Only a pending or active grant can be suspended. Refresh the term status.");
    }
    await c.query(`INSERT INTO owner_free_academic_term_events(grant_id,actor_user_id,status,reason)
      VALUES($1,$2,$3,$4)`,[grant!.id,actorId,action==="grant"?"TRIAL_GRANTED":"SUSPENDED",input.reason]);
    await c.query("COMMIT");
    return {schoolId:input.schoolId,termId:input.termId,action};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
