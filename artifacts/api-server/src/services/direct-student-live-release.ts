import {readStudentRollout} from "./student-platform-rollout";
import {createHash} from "node:crypto";
import type {StudentSubscriptionSqlPool} from "../lib/student-subscription-billing";
import {directLiveConfiguration,DIRECT_STUDENT_RELEASE} from "../lib/flutterwave-direct-live-config";
import {previewStudentNfcReconciliation} from "./student-nfc-reconciliation";
import {inspectFinancialGuards} from "./financial-guard-schema";
import {appendFinancialHistory,requireFinancialActor} from "./financial-history-writes";

type Db=Awaited<ReturnType<StudentSubscriptionSqlPool["connect"]>>;
export class DirectReleaseError extends Error{
  constructor(public code:string,public status=409){super(code);}
}
export type ReleaseScope={schoolId:number;termId:number;ruleId:number};
export type ReleaseDependencies={
  env?:NodeJS.ProcessEnv;report?:typeof previewStudentNfcReconciliation;
};
export const directFactsDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_key,v)=>
  v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
const fail=(code:string):never=>{throw new DirectReleaseError(code);};
const columns:Record<string,string[]>={
  student_direct_live_reviews:["id","school_id","academic_term_id","rule_id","report_digest","merchant_scope","expires_at","approved_by","approved_at","no_split_confirmed","reason"],
  student_direct_live_obligations:["id","school_id","student_id","academic_term_id","rule_id","review_id","assistance_request_id","merchant_scope","amount_minor","school_share_minor","bro_share_minor","currency","created_by","created_at"],
  student_direct_live_attempts:["id","obligation_id","reference","idempotency_key","state","verified_at","provider_transaction_id","checkout_url","provider_reference","provider_fee_minor","additional_fee_minor","created_by","created_at"],
  student_direct_live_events:["id","attempt_id","kind","actor_user_id","details","created_at"],
  student_direct_live_release_requests:["id","school_id","academic_term_id","rule_id","snapshot","facts_digest","evidence_digest","expires_at","policy","no_split_confirmed","merchant_evidence_reference","merchant_evidence_hash","created_by","created_at","reason"],
  student_direct_live_release_decisions:["id","request_id","action","actor_user_id","reason","created_at"],
  student_direct_live_review_bindings:["review_id","request_id","rule_version","release","environment"],
  subscription_rule_proposals:["id","version","product","status","amount_minor","currency","billing_period","school_share_minor","effective_at","ends_at","updated_by","updated_at","activated_at"],
  school_memberships:["user_id","school_id","role","status"],
  app_users:["id","status"],
  audit_logs:["actor_user_id","role","record_id","event_type","metadata"],
  subscription_payment_assistance_requests:["id","school_id","student_id","academic_term_id","status","amount_minor","verified_amount_minor","verified_by","verified_at","bank_name","bank_credit_date","bank_statement_reference"],
  schools:["id","status"],
  students:["id","school_id","status"],
  academic_terms:["id","school_id","academic_session_id","is_current","status","start_date","end_date"],
  academic_sessions:["id","school_id","is_current","status"],
};
/** SELECT-only catalog inspection. No missing-table casts, DDL or automatic initialization. */
export async function inspectDirectReleaseSchema(c:Db){
  const tables=await c.query(`SELECT t.relname AS name,t.relrowsecurity AS rls,
    has_table_privilege(t.oid,'SELECT') AS readable,has_table_privilege(t.oid,'INSERT') AS writable,
    array_agg(a.attname::text) FILTER(WHERE a.attnum>0 AND NOT a.attisdropped) AS columns
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid
    WHERE n.nspname='public' AND t.relkind='r' AND t.relname=ANY($1::text[])
    GROUP BY t.oid,t.relname`,[Object.keys(columns)]);
  const issues:string[]=[];
  for(const [name,required] of Object.entries(columns)){
    const t=tables.rows.find(t=>t.name===name);
    if(!t||t.rls||!t.readable||(name.startsWith("student_direct_")&&!t.writable)
      ||required.some(col=>!t.columns.includes(col)))issues.push(`TABLE_COLUMNS_OR_PRIVILEGES:${name}`);
  }
  issues.push(...(await inspectFinancialGuards(c,"direct")).issues);
  const indexes=await c.query(`SELECT i.indisunique,i.indisvalid,pg_get_expr(i.indpred,i.indrelid) AS predicate,
    pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid JOIN pg_namespace ns ON ns.oid=n.relnamespace
    WHERE ns.nspname='public' AND n.relname='student_direct_one_open_or_paid'`);
  if(!indexes.rows.some(r=>r.indisunique&&r.indisvalid&&r.predicate?.includes("FAILED")
    &&r.definition.includes("student_direct_live_attempts")&&r.definition.includes("(obligation_id)")))issues.push("ONE_OPEN_OR_PAID_INDEX");
  const checks=await c.query(`SELECT pg_get_constraintdef(co.oid) AS definition FROM pg_constraint co
    JOIN pg_class t ON t.oid=co.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='student_direct_live_obligations' AND co.contype='c' AND co.convalidated`);
  for(const expression of ["amount_minor = 320000","school_share_minor = 0","bro_share_minor = 0","currency = 'NGN'"]){
    if(!checks.rows.some(c=>c.definition.includes(expression)))issues.push(`FIXED_ALLOCATION_CHECK:${expression}`);
  }
  return{ready:issues.length===0,issues};
}
/** Same predicate before and under the permanent checkout claim's lock. Old unbound approvals never qualify. */
export async function findApprovedDirectReview(c:Db,scope:{schoolId:number;termId:number;studentId:number},
  reportDigest:string,config:ReturnType<typeof directLiveConfiguration>){
  return(await c.query(`SELECT v.*,b.request_id,r.version AS rule_version
    FROM student_direct_live_reviews v JOIN student_direct_live_review_bindings b ON b.review_id=v.id
    JOIN student_direct_live_release_requests q ON q.id=b.request_id
    JOIN subscription_rule_proposals r ON r.id=v.rule_id
    JOIN academic_terms t ON t.id=v.academic_term_id AND t.school_id=v.school_id
    JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
    JOIN schools sc ON sc.id=v.school_id AND lower(sc.status)='active'
    JOIN students st ON st.id=$3 AND st.school_id=v.school_id AND lower(st.status)='active'
    JOIN app_users approver ON approver.id=v.approved_by AND approver.status='ACTIVE'
    WHERE v.school_id=$1 AND v.academic_term_id=$2 AND v.report_digest=$4
      AND v.merchant_scope=$5 AND b.release=$6 AND b.environment='LIVE'
      AND b.rule_version=r.version AND q.rule_id=r.id AND q.school_id=v.school_id AND q.academic_term_id=t.id
      AND q.policy='NEW_ONLY_PRESERVE_LEGACY' AND q.no_split_confirmed=true
      AND q.snapshot->>'merchantScope'=$5 AND q.snapshot->>'callbackUrl'=$7 AND q.snapshot->>'webhookUrl'=$8
      AND q.snapshot->>'reportDigest'=$4 AND q.snapshot->>'release'=$6 AND q.snapshot->>'environment'='LIVE'
      AND (q.snapshot->'rule'->>'version')::integer=r.version
      AND (q.snapshot->'rule'->>'effectiveAtExact')::timestamptz=r.effective_at
      AND (q.snapshot->'rule'->>'endsAtExact')::timestamptz IS NOT DISTINCT FROM r.ends_at
      AND q.snapshot->'eligibleStudentIds' @> to_jsonb(ARRAY[$3::integer])
      AND (SELECT d.action FROM student_direct_live_release_decisions d WHERE d.request_id=q.id ORDER BY d.id DESC LIMIT 1)='APPROVED'
      -- A withdrawn/expired newer approval must not resurrect an older approval.
      AND v.id=(SELECT max(v2.id) FROM student_direct_live_reviews v2
        JOIN student_direct_live_review_bindings b2 ON b2.review_id=v2.id
        WHERE v2.school_id=v.school_id AND v2.academic_term_id=v.academic_term_id AND v2.rule_id=v.rule_id)
      AND EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.user_id=approver.id
        AND sm.role='PLATFORM_OWNER' AND sm.school_id IS NULL AND sm.status='ACTIVE')
      AND q.expires_at>now() AND v.expires_at>now() AND v.approved_at<=now() AND v.no_split_confirmed=true
      AND r.product='STUDENT_PLATFORM' AND r.status IN ('ACTIVE','SCHEDULED') AND r.amount_minor=320000
      AND r.school_share_minor=0 AND r.currency='NGN' AND r.billing_period='ACADEMIC_TERM'
      AND r.effective_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())
      AND t.is_current=true AND upper(t.status)='ACTIVE' AND ses.is_current=true AND upper(ses.status)='ACTIVE'
      AND (now() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date
    ORDER BY v.id DESC LIMIT 1`,
    [scope.schoolId,scope.termId,scope.studentId,reportDigest,config.merchantScope,DIRECT_STUDENT_RELEASE,
      config.callbackUrl,config.webhookUrl])).rows[0];
}
/** Complete server-owned facts; never includes secret values, hashes of secrets or provider access. */
export async function previewDirectRelease(pool:StudentSubscriptionSqlPool,scope:ReleaseScope,deps:ReleaseDependencies={}){
  const config=directLiveConfiguration(deps.env);
  const c=await pool.connect();
  let schema:Awaited<ReturnType<typeof inspectDirectReleaseSchema>>,r:any,t:any;
  let rollout:Awaited<ReturnType<typeof readStudentRollout>>;
  try{
    rollout=await readStudentRollout(c,scope.schoolId,scope.termId);
    schema=await inspectDirectReleaseSchema(c);
    r=(await c.query(`SELECT id,version,product,status,amount_minor,currency,billing_period,school_share_minor,
      effective_at,ends_at,effective_at::text AS effective_at_exact,ends_at::text AS ends_at_exact
      FROM subscription_rule_proposals WHERE id=$1`,[scope.ruleId])).rows[0];
    t=(await c.query(`SELECT t.id,t.school_id,t.is_current,t.status,t.start_date,t.end_date,
      ses.is_current AS session_current,ses.status AS session_status,sc.status AS school_status
      FROM academic_terms t JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
      JOIN schools sc ON sc.id=t.school_id WHERE t.id=$1 AND t.school_id=$2`,[scope.termId,scope.schoolId])).rows[0];
  }finally{c.release();}
  const rule=r?{id:Number(r.id),version:Number(r.version),product:r.product,amountMinor:r.amount_minor,
    currency:r.currency,billingPeriod:r.billing_period,schoolShareMinor:r.school_share_minor,
    effectiveAt:new Date(r.effective_at).toISOString(),endsAt:r.ends_at?new Date(r.ends_at).toISOString():null,
    effectiveAtExact:r.effective_at_exact,endsAtExact:r.ends_at_exact}:null;
  let report:Awaited<ReturnType<typeof previewStudentNfcReconciliation>>|null=null;
  if(t)report=await (deps.report??previewStudentNfcReconciliation)(pool as any,{schoolId:scope.schoolId,termId:scope.termId});
  const eligibleStudentIds=report?.rows.filter(r=>r.status==="NEW_OBLIGATION_AFTER_REVIEW").map(r=>r.studentId).sort((a,b)=>a-b)??[];
  const facts={schoolId:scope.schoolId,termId:scope.termId,ruleId:scope.ruleId,
    release:DIRECT_STUDENT_RELEASE,environment:"LIVE",merchantScope:config.merchantScope,
    callbackUrl:config.callbackUrl,webhookUrl:config.webhookReady?config.webhookUrl:null,webhookAuthentication:"V3_VERIF_HASH",
    configurationReady:config.configurationReady,rule,
    term:t?JSON.parse(JSON.stringify(t)):null,reportDigest:report?.evidenceDigest??null,
    reportComplete:report?.sourceStatus==="COMPLETE",eligibleStudentIds,
    legacyCount:(report?.rows.length??0)-eligibleStudentIds.length,policy:"NEW_ONLY_PRESERVE_LEGACY"};
  const ruleReady=!!r&&r.product==="STUDENT_PLATFORM"&&r.amount_minor===320000&&r.school_share_minor===0
    &&r.currency==="NGN"&&r.billing_period==="ACADEMIC_TERM"
    &&["DRAFT","ACTIVE","SCHEDULED"].includes(r.status)
    &&(!r.ends_at||new Date(r.ends_at).getTime()>Date.now())
    &&(r.status!=="DRAFT"||new Date(r.effective_at).getTime()>Date.now());
  const termReady=!!t&&t.is_current&&t.session_current&&String(t.status).toUpperCase()==="ACTIVE"
    &&String(t.session_status).toUpperCase()==="ACTIVE"&&String(t.school_status).toUpperCase()==="ACTIVE";
  const checks=[
    {code:"COLLECTION_ROLLOUT",label:"School January 2027 second-term collection",status:rollout!.chargeable?"READY":"BLOCKED",
      detail:`Policies approved 27 October 2026. Current-term platform access is free; no devices or cards required. ${rollout!.collectionStartDate?`This school's configured collection start is ${rollout!.collectionStartDate}.`:"Configure this school's January 2027 second academic term; no date is assumed."}`},
    {code:"MERCHANT_CONFIG",label:"Dedicated LIVE merchant configuration",status:config.configurationReady&&!!config.merchantScope?"READY":"BLOCKED",detail:"Production LIVE mode, dedicated LIVE key/verifier and a reviewed merchant scope are required. Secret values are never returned."},
    {code:"HTTPS_ENDPOINTS",label:"Callback and webhook configuration",status:config.callbackUrl&&config.webhookReady?"READY":"BLOCKED",detail:"Exact public HTTPS callback and same-origin direct webhook URL required. Dashboard registration needs independent merchant evidence."},
    {code:"SCHEMA",label:"Required schema and immutable history",status:schema.ready?"READY":"BLOCKED",detail:schema.ready?"Direct schema and history guards present.":schema.issues.join("; ")},
    {code:"STUDENT_RULE",label:"₦3,200 rule and effective dates",status:ruleReady?"READY":"BLOCKED",detail:ruleReady?`Version ${r.version}: ${r.status}; effective ${rule!.effectiveAt}. A draft is scheduled only by explicit final approval.`:"An eligible ₦3,200 zero-school-share Student rule with valid dates is required."},
    {code:"RECONCILIATION",label:"Actual school/term reconciliation",status:termReady&&facts.reportComplete&&eligibleStudentIds.length>0?"READY":"BLOCKED",detail:`${eligibleStudentIds.length} new obligations eligible; ${facts.legacyCount} legacy/review rows excluded. No conversion or rebilling is authorized.`},
    {code:"NON_SPLIT_EVIDENCE",label:"Independent non-split merchant evidence",status:"REVIEW_REQUIRED",detail:"Provide the reviewed merchant evidence reference and SHA-256 commitment; explicitly confirm no subaccounts, split or BRO allocation."},
    {code:"RUNTIME_SWITCH",label:"Separate operational LIVE release",status:config.releaseApproved?"READY":"BLOCKED",detail:"Review approval never sets the runtime release switch. Separate operational release authorization is still required."},
  ];
  const approvalReady=checks.filter(c=>!["NON_SPLIT_EVIDENCE","RUNTIME_SWITCH"].includes(c.code)).every(c=>c.status==="READY");
  return{schoolId:scope.schoolId,termId:scope.termId,ruleId:scope.ruleId,facts,previewDigest:directFactsDigest(facts),checks,approvalReady,
    checkoutEnabled:false as const,schemaReady:schema.ready};
}
const actionStatus=(row:any,events:any[])=>{
  if(new Date(row.expires_at).getTime()<=Date.now())return"EXPIRED";
  return events.at(-1)?.action??"CREATED";
};
async function load(c:Db,id:number){
  const row=(await c.query("SELECT * FROM student_direct_live_release_requests WHERE id=$1",[id])).rows[0];
  if(!row)throw new DirectReleaseError("DIRECT_REVIEW_NOT_FOUND",404);
  const events=(await c.query(`SELECT id,action,actor_user_id AS "actorId",reason,created_at AS "createdAt"
    FROM student_direct_live_release_decisions WHERE request_id=$1 ORDER BY id`,[id])).rows;
  return{row,events,status:actionStatus(row,events)};
}
function dto(v:Awaited<ReturnType<typeof load>>){
  const {row:r,events,status}=v;
  return{id:Number(r.id),schoolId:r.school_id,termId:r.academic_term_id,ruleId:Number(r.rule_id),status,
    facts:r.snapshot,evidenceDigest:r.evidence_digest,previewDigest:r.facts_digest,
    merchantEvidenceReference:r.merchant_evidence_reference,merchantEvidenceHash:r.merchant_evidence_hash,
    expiresAt:new Date(r.expires_at).toISOString(),createdAt:new Date(r.created_at).toISOString(),
    reason:r.reason,events};
}
export async function listDirectReleaseReviews(pool:StudentSubscriptionSqlPool,scope:ReleaseScope){
  const c=await pool.connect();try{
    const schema=await inspectDirectReleaseSchema(c);if(!schema.ready)return[];
    const ids=(await c.query(`SELECT id FROM student_direct_live_release_requests
      WHERE school_id=$1 AND academic_term_id=$2 AND rule_id=$3 ORDER BY id DESC LIMIT 50`,
      [scope.schoolId,scope.termId,scope.ruleId])).rows;
    return await Promise.all(ids.map(async r=>dto(await load(c,Number(r.id)))));
  }finally{c.release();}
}
export type DirectReviewInput=ReleaseScope&{previewDigest:string;merchantEvidenceReference:string;
  merchantEvidenceHash:string;noSplitConfirmed:boolean;policy:string;expiresAt:string;reason:string};
export async function createDirectReleaseReview(pool:StudentSubscriptionSqlPool,input:DirectReviewInput,
  actorId:number,deps:ReleaseDependencies={}){
  const preview=await previewDirectRelease(pool,input,deps);
  if(!preview.schemaReady)fail("DIRECT_RELEASE_SCHEMA_REQUIRED");
  if(preview.previewDigest!==input.previewDigest)fail("STALE_READINESS_PREVIEW");
  if(!input.noSplitConfirmed||input.policy!=="NEW_ONLY_PRESERVE_LEGACY")fail("NON_SPLIT_NEW_ONLY_CONFIRMATION_REQUIRED");
  const expiry=new Date(input.expiresAt).getTime();
  if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+7*86400000)fail("REVIEW_EXPIRY_OUT_OF_RANGE");
  const evidenceDigest=directFactsDigest({facts:preview.facts,reference:input.merchantEvidenceReference,
    hash:input.merchantEvidenceHash,expiresAt:new Date(expiry).toISOString(),reason:input.reason});
  const c=await pool.connect();try{
    await c.query("BEGIN");
    await requireFinancialActor(c,actorId);
    const row=(await appendFinancialHistory(c,"reviewRequest",
      [input.schoolId,input.termId,input.ruleId,JSON.stringify(preview.facts),preview.previewDigest,evidenceDigest,
        input.merchantEvidenceReference,input.merchantEvidenceHash,input.policy,input.expiresAt,actorId,input.reason])).rows[0]
      ??(await c.query("SELECT id FROM student_direct_live_release_requests WHERE evidence_digest=$1",[evidenceDigest])).rows[0];
    if(!row)fail("DIRECT_REVIEW_CREATE_CONFLICT");
    await reviewAudit(c,Number(row.id),actorId,"CREATED",input.reason);
    const result=dto(await load(c,Number(row.id)));await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
async function reviewAudit(c:Db,id:number,actorId:number,action:string,reason:string){
  await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,action,module,record_id,event_type,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Direct Flutterwave LIVE Readiness',$3,
      'SUBSCRIPTION_RULE_DIRECT_RELEASE_REVIEW',$4::jsonb)`,
    [actorId,`DIRECT_RELEASE_${action}`,id,JSON.stringify({requestId:id,action,reason,release:DIRECT_STUDENT_RELEASE})]);
}
export async function decideDirectReleaseReview(pool:StudentSubscriptionSqlPool,id:number,
  input:{action:"REVIEWED"|"APPROVED"|"REJECTED"|"EXPIRED";reason:string;evidenceDigest:string;confirmScope:boolean},
  actorId:number,deps:ReleaseDependencies={}){
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await requireFinancialActor(c,actorId);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`direct-release:${id}`]);
    const v=await load(c,id),scope={schoolId:v.row.school_id,termId:v.row.academic_term_id,ruleId:Number(v.row.rule_id)};
    if(v.row.evidence_digest!==input.evidenceDigest)fail("REVIEW_EVIDENCE_MISMATCH");
    if(input.action==="EXPIRED"){
      if(new Date(v.row.expires_at).getTime()>Date.now())fail("REVIEW_NOT_EXPIRED");
      if(v.events.at(-1)?.action==="EXPIRED")fail("REVIEW_ALREADY_EXPIRED");
    }else{
      if(["REJECTED","EXPIRED"].includes(v.status))fail("REVIEW_TERMINAL");
      if(input.action!=="REJECTED"){
        if(input.action==="APPROVED"&&v.status!=="REVIEWED")fail("EXPLICIT_REVIEW_REQUIRED");
        if(input.action==="REVIEWED"&&v.status!=="CREATED")fail("REVIEW_ALREADY_DECIDED");
        const fresh=await previewDirectRelease(pool,scope,deps);
        if(fresh.previewDigest!==v.row.facts_digest)fail("STALE_REVIEW_EVIDENCE");
        if(input.action==="APPROVED"){
          if(!input.confirmScope||!fresh.approvalReady)fail("DIRECT_APPROVAL_PREREQUISITES_REQUIRED");
          // Serializes activation with ordinary Owner rule governance; no staff rules are changed.
          await c.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-rule:STUDENT_PLATFORM',0))");
          const r=(await c.query(`SELECT *,effective_at::text AS effective_at_exact,ends_at::text AS ends_at_exact
            FROM subscription_rule_proposals WHERE id=$1 FOR UPDATE`,[scope.ruleId])).rows[0];
          if(!r||Number(r.version)!==fresh.facts.rule?.version||!["DRAFT","ACTIVE","SCHEDULED"].includes(r.status)
            ||r.product!=="STUDENT_PLATFORM"||r.amount_minor!==320000||r.school_share_minor!==0||r.currency!=="NGN"
            ||r.billing_period!=="ACADEMIC_TERM"||r.effective_at_exact!==fresh.facts.rule.effectiveAtExact
            ||r.ends_at_exact!==fresh.facts.rule.endsAtExact)
            fail("RULE_CHANGED");
          const overlapping=(await c.query(`SELECT id FROM subscription_rule_proposals WHERE product='STUDENT_PLATFORM'
            AND id<>$1 AND status IN ('ACTIVE','SCHEDULED')
            AND tstzrange(effective_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')`,
            [r.id,r.effective_at,r.ends_at])).rows;
          if(overlapping.length)fail("STUDENT_RULE_EFFECTIVE_PERIOD_OVERLAP");
          if(r.status==="DRAFT"){
            if(new Date(r.effective_at).getTime()<=Date.now())fail("DRAFT_RULE_REQUIRES_FUTURE_EFFECTIVE_DATE");
            await c.query(`UPDATE subscription_rule_proposals SET status='SCHEDULED',updated_by=$2,
              updated_at=now(),activated_at=now() WHERE id=$1`,[r.id,actorId]);
          }
          const approved=(await appendFinancialHistory(c,"review",
            [scope.schoolId,scope.termId,scope.ruleId,fresh.facts.reportDigest,fresh.facts.merchantScope,actorId,v.row.expires_at,input.reason])).rows[0];
          await appendFinancialHistory(c,"binding",[approved.id,id,r.version,DIRECT_STUDENT_RELEASE]);
        }
      }
    }
    await appendFinancialHistory(c,"decision",[id,input.action,actorId,input.reason]);
    await reviewAudit(c,id,actorId,input.action,input.reason);
    const result=dto(await load(c,id));await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
