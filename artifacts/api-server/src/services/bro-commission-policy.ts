/** Independent BRO expense. Never changes a collection, split, legacy ledger or payout. */
import {lagosDate,readStudentRollout} from "./student-platform-rollout";
import {inspectFinancialGuards} from "./financial-guard-schema";
import {appendFinancialHistory,requireFinancialActor} from "./financial-history-writes";
export const BRO_TERM_RATE_MINOR = 15_000;
export type BroSql = {query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};
type Pool = BroSql & {connect:()=>Promise<BroSql & {release:()=>void}>};
export class BroCommissionBlocked extends Error {
  constructor(message:string){super(message);}
}
export async function broStorageReady(c:BroSql):Promise<boolean>{
  const {rows}=await c.query(`SELECT
    to_regclass('bro_term_commission_entitlements') IS NOT NULL
    AND to_regclass('student_direct_live_obligations') IS NOT NULL
    AND to_regclass('student_direct_live_attempts') IS NOT NULL
    AND to_regclass('student_direct_live_events') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('bro_term_commission_entitlements')
      AND conname='bro_term_commission_scope_uq' AND contype='u')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('bro_term_commission_entitlements')
      AND tgname='bro_term_commission_append_only' AND NOT tgisinternal AND tgenabled='O')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('bro_term_commission_entitlements')
      AND tgname='bro_term_commission_scope_guard' AND NOT tgisinternal AND tgenabled='O') AS ready`);
  return rows[0]?.ready===true&&(await inspectFinancialGuards(c,"bro")).ready;
}
export type BroEligibility = {
  termStart:string;paidAt:string;verified:boolean;studentEligible:boolean;
  attributionEligible:boolean;legacyExists:boolean;
};
export type BroPolicy = {
  id:number;status:string;amountMinor:number;effectiveAt:string;endsAt:string|null;approved:boolean;
};
/** Freeze rate at term commencement (Africa/Lagos); late payment never reprices an old term.
 * An expired/retired latest policy denies accrual; never fall back to an older policy. */
export function broEntitlementAmount(p:BroPolicy,e:BroEligibility):number|null{
  const start=Date.parse(e.termStart),paid=Date.parse(e.paidAt),effective=Date.parse(p.effectiveAt);
  const end=p.endsAt===null?Infinity:Date.parse(p.endsAt);
  if(![start,paid,effective].every(Number.isFinite)||Number.isNaN(end)
    ||!p.approved||!['ACTIVE','SCHEDULED'].includes(p.status)||p.amountMinor!==BRO_TERM_RATE_MINOR
    ||start<effective||start>=end||paid<effective||paid<start||lagosDate(new Date(start))<"2027-01-01"
    ||!e.verified||!e.studentEligible||!e.attributionEligible||e.legacyExists)return null;
  return BRO_TERM_RATE_MINOR;
}
export async function broCommissionSnapshot(c:BroSql){
  if(!await broStorageReady(c))return {available:false,entries:[]};
  const {rows}=await c.query(`SELECT id,school_id AS "schoolId",student_id AS "studentId",
    academic_term_id AS "termId",partner_profile_id AS "partnerId",policy_id AS "policyId",
    amount_minor AS "amountMinor",currency,status,earned_at AS "earnedAt"
    FROM bro_term_commission_entitlements ORDER BY id DESC LIMIT 100`);
  return {available:true,entries:rows};
}
export async function accrueBroCommission(pool:Pool,scope:{schoolId:number;studentId:number;termId:number},
  actor:{id:number;email:string;clerkUserId:string}){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await requireFinancialActor(c,actor.id);
    await c.query("SET LOCAL lock_timeout='2s'");
    // Same policy lock as approval/retirement, plus one global student/term earning key.
    await c.query("SELECT pg_advisory_xact_lock(310031,1)");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`bro-term:${scope.studentId}:${scope.termId}`]);
    if(!await broStorageReady(c))throw new BroCommissionBlocked("BRO storage requires separate review after recovery clearance.");
    const prior=(await c.query(`SELECT * FROM bro_term_commission_entitlements
      WHERE student_id=$1 AND academic_term_id=$2 FOR SHARE`,[scope.studentId,scope.termId])).rows[0];
    if(prior){
      if(Number(prior.school_id)!==scope.schoolId)throw new BroCommissionBlocked("Existing earning belongs to another school.");
      await c.query("COMMIT");return {id:Number(prior.id),amountMinor:Number(prior.amount_minor),existing:true};
    }
    const evidence=(await c.query(`SELECT o.id AS obligation_id,a.id AS attempt_id,a.verified_at AS paid_at,
      a.verified_at::text AS paid_at_exact,
      (t.start_date::timestamp AT TIME ZONE 'Africa/Lagos') AS term_start,
      t.end_date AS term_end,at.id AS attribution_id,at.partner_profile_id,
      EXISTS(SELECT 1 FROM commission_ledger l LEFT JOIN student_subscription_payments lp ON lp.id=l.payment_id
        WHERE l.student_id=o.student_id AND l.school_id=o.school_id
        AND (lp.academic_term_id=t.id OR
          (lp.academic_term_id IS NULL AND (l.academic_session_id=t.academic_session_id
            OR l.academic_session_id IS NULL)))) AS legacy_exists
      FROM student_direct_live_obligations o
      JOIN student_direct_live_attempts a ON a.obligation_id=o.id AND a.state='PAID'
        AND a.verified_at IS NOT NULL AND a.provider_transaction_id ~ '^[1-9][0-9]*$'
        AND a.provider_reference IS NOT NULL AND EXISTS(SELECT 1 FROM student_direct_live_events ev
          WHERE ev.attempt_id=a.id AND ev.kind='PROVIDER_PAYMENT_VERIFIED'
          AND ev.details->>'transactionId'=a.provider_transaction_id)
      JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
      JOIN students st ON st.id=o.student_id AND st.school_id=o.school_id
        AND lower(st.status)='active' AND upper(st.admission_status)='ADMITTED'
      JOIN school_partner_attributions at ON at.school_id=o.school_id
        AND at.status='ACTIVE' AND at.starts_at<=a.verified_at AND (at.ends_at IS NULL OR at.ends_at>a.verified_at)
      JOIN partner_profiles bp ON bp.id=at.partner_profile_id AND upper(bp.status)='ACTIVE'
      WHERE o.school_id=$1 AND o.student_id=$2 AND o.academic_term_id=$3
        AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0 AND o.currency='NGN'
        AND a.verified_at<=now() FOR SHARE OF o,a,t,st,at,bp`,
      [scope.schoolId,scope.studentId,scope.termId])).rows;
    if(evidence.length!==1)throw new BroCommissionBlocked("A unique eligible student, verified payment and historical BRO attribution are required.");
    const e=evidence[0];
    const rollout=await readStudentRollout(c,scope.schoolId,scope.termId,lagosDate(new Date(e.paid_at)));
    if(!rollout.periodEligible || lagosDate(new Date(e.paid_at))<rollout.collectionStartDate!)
      throw new BroCommissionBlocked("Term is ineligible for the approved January 2027 collection rollout.");
    const raw=(await c.query(`SELECT p.*,
      EXISTS(SELECT 1 FROM audit_logs a WHERE a.record_id=p.id AND a.role='PLATFORM_OWNER'
        AND a.event_type='SUBSCRIPTION_RULE_ACTIVATED'
        AND a.metadata->'after'->>'product'='BRO_COMMISSION'
        AND a.metadata->'after'->>'amountMinor'='15000'
        AND (a.metadata->'after'->>'version')::integer=p.version
        AND (a.metadata->'after'->>'effectiveAt')::timestamptz=p.effective_at) AS approved
      FROM subscription_rule_proposals p WHERE p.product='BRO_COMMISSION' AND p.status<>'DRAFT'
        AND p.effective_at<=$1 ORDER BY p.effective_at DESC,p.id DESC LIMIT 1`,[e.term_start])).rows[0];
    if(!raw)throw new BroCommissionBlocked("No approved BRO policy covers this term.");
    const amount=broEntitlementAmount({id:Number(raw.id),status:raw.status,amountMinor:Number(raw.amount_minor),
      effectiveAt:new Date(raw.effective_at).toISOString(),endsAt:raw.ends_at?new Date(raw.ends_at).toISOString():null,
      approved:raw.approved===true},{
      termStart:new Date(e.term_start).toISOString(),paidAt:new Date(e.paid_at).toISOString(),
      verified:true,studentEligible:true,attributionEligible:true,legacyExists:e.legacy_exists===true});
    if(amount===null)throw new BroCommissionBlocked("Term is ineligible, already earned historically, or outside the approved ₦150 policy.");
    const row=(await appendFinancialHistory(c,"bro",
      [scope.schoolId,scope.studentId,scope.termId,e.partner_profile_id,e.attribution_id,raw.id,
        e.obligation_id,e.attempt_id,amount,e.paid_at_exact,JSON.stringify({policyId:Number(raw.id),version:raw.version,
          amountMinor:amount,effectiveAt:raw.effective_at,endsAt:raw.ends_at,termStart:e.term_start,
          funding:"SEPARATE_PLATFORM_EXPENSE",studentCollectionMinor:320000,collectionBroShareMinor:0,
          rolloutPolicyApprovedOn:rollout.policy.approvedOn,launchTermId:rollout.launchTermId,
          collectionStartDate:rollout.collectionStartDate}),actor.id])).rows[0];
    if(!row)throw new BroCommissionBlocked("Concurrent earning requires readback; no amount was changed.");
    await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
      VALUES($1,'PLATFORM_OWNER',$2,$3,'BRO_COMMISSION_EARNED','Subscription & Payment Rules',$4,
        'BRO_COMMISSION_EARNED',$5::jsonb)`,[actor.email,actor.id,actor.clerkUserId,row.id,
      JSON.stringify({after:{...scope,partnerId:e.partner_profile_id,policyId:Number(raw.id),amountMinor:amount,
        currency:"NGN",funding:"SEPARATE_PLATFORM_EXPENSE",status:"PENDING_OWNER_APPROVAL"}})]);
    await c.query("COMMIT");return {id:Number(row.id),amountMinor:amount,existing:false};
  }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}finally{c.release();}
}
