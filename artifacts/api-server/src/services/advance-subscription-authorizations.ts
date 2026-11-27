import type {StudentSubscriptionSqlPool} from "../lib/student-subscription-billing";
import {financialTransaction} from "./financial-transaction";
import {requireFinancialActor,appendFinancialHistory} from "./financial-history-writes";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
import {DirectReleaseError,inspectDirectReleaseSchema,type ReleaseScope} from "./direct-student-live-release";
import {previewAdvanceReconciliation,NFC_PREVIEW_SOURCES} from "./student-nfc-reconciliation";
import {readStudentRollout,lagosDate} from "./student-platform-rollout";
import {readFreeTermGrant} from "./owner-free-academic-term-read";
import {ADVANCE_RELEASE,advanceDigest,advanceWindow,materialCalendar,advanceCheckoutOpen,advanceEvidenceMatches} from "./advance-subscription-policy";
type Db=Awaited<ReturnType<StudentSubscriptionSqlPool["connect"]>>;
const fail=(code:string):never=>{throw new DirectReleaseError(code);};
const why=(s:string)=>{if(s.trim().length<3||s.trim().length>500)fail("ADVANCE_REASON_REQUIRED");return s.trim();};
const terminal=["REJECTED","WITHDRAWN","INVALIDATED","EXPIRED"];
const sameEvidence=(a:{facts_digest:string;snapshot:{materialVersion:string}},fresh:{digest:string;facts:{materialVersion:string}})=>
 advanceEvidenceMatches({digest:a.facts_digest,materialVersion:a.snapshot.materialVersion},
  {digest:fresh.digest,materialVersion:fresh.facts.materialVersion});
const expectedGuards=[
 ["advance_subscription_authorizations","advance_authorization_scope","guard_advance_subscription_authorization",7],
 ["advance_subscription_decisions","advance_decision_scope","guard_advance_subscription_authorization",7],
 ["advance_subscription_authorizations","advance_authorization_history","guard_student_direct_history",27],
 ["advance_subscription_decisions","advance_decision_history","guard_student_direct_history",27],
 ["advance_subscription_changes","advance_changes_history","guard_student_direct_history",27],
 ["student_direct_live_obligations","advance_obligation_calendar","guard_advance_subscription_checkout",7],
 ["student_direct_live_attempts","advance_attempt_calendar","guard_advance_subscription_checkout",7],
] as const;
export async function advanceSchema(c:Db){
 const installed=(await c.query(`SELECT to_regclass('public.advance_subscription_authorizations') IS NOT NULL
  AND to_regclass('public.advance_subscription_decisions') IS NOT NULL
  AND to_regclass('public.advance_subscription_changes') IS NOT NULL AS present`)).rows[0]?.present;
 if(!installed)fail("ADVANCE_AUTHORIZATION_SCHEMA_REQUIRED");
 const columns:Record<string,string[]>={
  advance_subscription_authorizations:["id","school_id","academic_term_id","rule_id","snapshot","facts_digest","evidence_digest",
   "request_key","merchant_evidence_reference","merchant_evidence_hash","not_before","expires_at","created_by","reason","created_at"],
  advance_subscription_decisions:["id","authorization_id","action","review_id","actor_user_id","reason","created_at"],
  advance_subscription_changes:["id","school_id","academic_term_id","academic_session_id","source_table","changed_at"],
 };
 const tables=(await c.query(`SELECT r.relname,r.relrowsecurity,
   has_table_privilege(r.oid,'SELECT') AND has_table_privilege(r.oid,'INSERT') AS permitted,
   array_agg(a.attname::text) FILTER(WHERE a.attnum>0 AND NOT a.attisdropped) AS columns
  FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=r.oid
  WHERE n.nspname='public' AND r.relkind='r' AND r.relname=ANY($1::text[])
  GROUP BY r.oid,r.relname`,[Object.keys(columns)])).rows;
 if(Object.entries(columns).some(([name,required])=>!tables.some(t=>t.relname===name&&!t.relrowsecurity&&t.permitted===true
   &&required.every(col=>t.columns?.includes(col)))))fail("ADVANCE_COLUMNS_AND_PRIVILEGES_REQUIRED");
 const guards=(await c.query(`SELECT r.relname,t.tgname,p.proname,t.tgtype FROM pg_trigger t
  JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE n.nspname='public' AND p.pronamespace=n.oid AND NOT p.prosecdef AND p.pronargs=0 AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgconstraint=0 AND NOT t.tgdeferrable
    AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0`)).rows;
 if(expectedGuards.some(([table,name,fn,type])=>!guards.some(g=>
   g.relname===table&&g.tgname===name&&g.proname===fn&&Number(g.tgtype)===type)))
   fail("ADVANCE_AUTHORIZATION_GUARDS_REQUIRED");
 const bulk=(await c.query("SELECT to_regclass('public.current_bulk_allocations') IS NOT NULL AS present")).rows[0]?.present;
 if(bulk&&!guards.some(g=>g.relname==="current_bulk_allocations"&&g.tgname==="advance_bulk_calendar"
   &&g.proname==="guard_advance_subscription_checkout"&&Number(g.tgtype)===7))fail("ADVANCE_BULK_CALENDAR_GUARD_REQUIRED");
 const retries=(await c.query("SELECT to_regclass('public.current_bulk_checkout_attempts') IS NOT NULL AS present")).rows[0]?.present;
 if(retries&&!guards.some(g=>g.relname==="current_bulk_checkout_attempts"&&g.tgname==="advance_bulk_retry_calendar"
  &&g.proname==="guard_advance_subscription_checkout"&&Number(g.tgtype)===7))fail("ADVANCE_BULK_RETRY_GUARD_REQUIRED");
 const sources=(await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND (c.relname=ANY($1::text[]) OR c.relname ~ '^(flutterwave_live_|student_subscription_|hosted_checkout_|deferred_commission_)')
   ORDER BY c.relname`,[[...Object.keys(NFC_PREVIEW_SOURCES),"subscription_rule_proposals",
    "owner_free_academic_terms","owner_free_academic_term_events"]])).rows.map(r=>String(r.relname));
 if(sources.some(table=>!guards.some(g=>g.relname===table&&g.tgname==="advance_material_revision"
   &&g.proname==="record_advance_subscription_change"&&Number(g.tgtype)===29)))fail("ADVANCE_MATERIAL_REVISION_GUARDS_REQUIRED");
 return sources;
}
export type AdvanceDeps={env?:NodeJS.ProcessEnv;configuration?:ReturnType<typeof directLiveConfiguration>};
/** All material evidence comes from this pinned client. Locks close the
 * calendar/roster race between revalidation and a durable checkout claim. */
export async function advanceSnapshot(c:Db,scope:ReleaseScope,deps:AdvanceDeps={},locked=false){
 const sources=await advanceSchema(c);
 if(!(await inspectDirectReleaseSchema(c)).ready)fail("DIRECT_RELEASE_SCHEMA_REQUIRED");
 if(locked){
   if(sources.some(s=>!/^[a-z_]+$/.test(s)))fail("INVALID_ADVANCE_SOURCE");
   await c.query(`LOCK TABLE ${sources.map(s=>`public."${s}"`).join(",")} IN SHARE MODE`);
 }
 const config=deps.configuration??directLiveConfiguration(deps.env);
 const term=(await c.query(`SELECT to_jsonb(t) AS calendar,to_jsonb(s) AS session,
   t.start_date::text AS start,t.end_date::text AS end,
   (SELECT count(*) FROM academic_terms ct WHERE ct.school_id=t.school_id AND ct.is_current=true AND ct.status='ACTIVE') AS current_terms,
   (SELECT count(*) FROM academic_sessions cs WHERE cs.school_id=t.school_id AND cs.is_current=true AND cs.status='ACTIVE') AS current_sessions,
   (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS today
   FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
   WHERE t.id=$2 AND t.school_id=$1`,[scope.schoolId,scope.termId])).rows[0];
 if(!term)fail("ADVANCE_SCHOOL_TERM_NOT_FOUND");
 if(!["PLANNED","ACTIVE"].includes(term.calendar.status)||!["PLANNED","ACTIVE"].includes(term.session.status))
   fail("ADVANCE_TERM_LIFECYCLE_REQUIRES_REVIEW");
 const rollout=await readStudentRollout(c,scope.schoolId,scope.termId,term.start);
 if(!rollout.periodEligible)fail("ADVANCE_JANUARY_ROLLOUT_REQUIRED");
 const rule=(await c.query(`SELECT id,version,product,status,amount_minor,currency,billing_period,school_share_minor,
   effective_at::text,ends_at::text,activated_at::text FROM subscription_rule_proposals WHERE id=$1`,[scope.ruleId])).rows[0];
 if(!rule||!["ACTIVE","SCHEDULED"].includes(rule.status)||rule.product!=="STUDENT_PLATFORM"
  ||Number(rule.amount_minor)!==320000||Number(rule.school_share_minor)!==0||rule.currency!=="NGN"
  ||rule.billing_period!=="ACADEMIC_TERM"||!rule.activated_at
  ||Date.parse(rule.effective_at)>Date.parse(`${term.start}T00:00:00+01:00`)
  ||(rule.ends_at&&Date.parse(rule.ends_at)<Date.parse(advanceWindow(term.start,term.end).expiresAt)))
   fail("ADVANCE_APPROVED_3200_TERM_RULE_REQUIRED");
 if((await c.query(`SELECT 1 FROM subscription_rule_proposals WHERE id<>$1 AND product='STUDENT_PLATFORM'
   AND status IN ('ACTIVE','SCHEDULED') AND tstzrange(effective_at,ends_at,'[)')
    && tstzrange($2::timestamptz,$3::timestamptz,'[)')`,
   [scope.ruleId,`${term.start}T00:00:00+01:00`,advanceWindow(term.start,term.end).expiresAt])).rows.length)
   fail("ADVANCE_RULE_WINDOW_OVERLAP");
 const report=await previewAdvanceReconciliation(c,{schoolId:scope.schoolId,termId:scope.termId});
 if(report.sourceStatus!=="COMPLETE")fail("ADVANCE_COMPLETE_RECONCILIATION_REQUIRED");
 const eligibleStudentIds=report.rows.filter(r=>r.status==="NEW_OBLIGATION_AFTER_REVIEW").map(r=>r.studentId).sort((a,b)=>a-b);
 if(!eligibleStudentIds.length)fail("ADVANCE_ELIGIBLE_NEW_STUDENTS_REQUIRED");
 const materialVersion=String((await c.query(`SELECT COALESCE(max(id),0)::text AS version
   FROM advance_subscription_changes WHERE school_id IS NULL OR (school_id=$1
    AND (academic_term_id IS NULL OR academic_term_id=$2) AND (academic_session_id IS NULL OR academic_session_id=$3))`,
    [scope.schoolId,scope.termId,term.calendar.academic_session_id])).rows[0].version);
 const grant=await readFreeTermGrant(c,scope.schoolId,scope.termId,term.start);
 const freeTermEvidence=grant?{id:grant.id}:null;
 const facts={schoolId:scope.schoolId,termId:scope.termId,ruleId:scope.ruleId,release:ADVANCE_RELEASE,environment:"LIVE",calendar:materialCalendar(term.calendar),
  session:materialCalendar(term.session),calendarVersion:materialVersion,materialVersion,
  reportDigest:report.evidenceDigest,eligibleStudentIds,rule,freeTermEvidence,amountMinor:320000,schoolShareMinor:0,broShareMinor:0,
  merchantScope:config.merchantScope,callbackUrl:config.callbackUrl,webhookUrl:config.webhookReady?config.webhookUrl:null,
  webhookAuthentication:"V3_VERIF_HASH",policy:"NEW_ONLY_PRESERVE_LEGACY",...advanceWindow(term.start,term.end)};
 return {facts,digest:advanceDigest(facts),today:term.today,start:term.start,end:term.end,
  calendarStatus:term.calendar.status,sessionStatus:term.session.status,
  termCurrent:term.calendar.is_current===true&&Number(term.current_terms)===1,
  sessionCurrent:term.session.is_current===true&&Number(term.current_sessions)===1,
  approvalReady:config.configurationReady&&!!config.merchantScope&&!!config.callbackUrl&&config.webhookReady,
  runtimeReleased:config.ready,checkoutEnabled:false as const};
}
async function event(c:Db,id:number,action:string,actorId:number|null,reason:string,reviewId?:number){
 await c.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason,review_id)
   VALUES($1,$2,$3,$4,$5)`,[id,action,actorId,reason,reviewId??null]);
 if(actorId!==null){
  const actor=(await c.query("SELECT email,clerk_user_id FROM app_users WHERE id=$1",[actorId])).rows[0];
  await c.query(`INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,action,module,record_id,event_type,metadata)
   VALUES($1,'PLATFORM_OWNER',$2,$3,$4,'Advance subscription authorization',$5,$4,$6::jsonb)`,
   [actor.email,actorId,actor.clerk_user_id,`ADVANCE_SUBSCRIPTION_${action}`,id,JSON.stringify({reason,reviewId:reviewId??null})]);
 }
}
async function load(c:Db,id:number,lock=false){
 const a=(await c.query(`SELECT * FROM advance_subscription_authorizations WHERE id=$1${lock?" FOR UPDATE":""}`,[id])).rows[0];
 if(!a)fail("ADVANCE_AUTHORIZATION_NOT_FOUND");
 const events=(await c.query("SELECT * FROM advance_subscription_decisions WHERE authorization_id=$1 ORDER BY id",[id])).rows;
 return {...a,events,status:events.at(-1)?.action??"CREATED"};
}
function view(a:any,_today=lagosDate()){
 return {id:Number(a.id),schoolId:Number(a.school_id),termId:Number(a.academic_term_id),ruleId:Number(a.rule_id),
  status:!terminal.includes(a.status)&&Date.now()>=new Date(a.expires_at).getTime()?"EXPIRED":a.status,
  facts:a.snapshot,previewDigest:a.facts_digest,evidenceDigest:a.evidence_digest,
  merchantEvidenceReference:a.merchant_evidence_reference,merchantEvidenceHash:a.merchant_evidence_hash,
  notBefore:new Date(a.not_before).toISOString(),expiresAt:new Date(a.expires_at).toISOString(),
  reason:a.reason,events:a.events.map((e:any)=>({id:Number(e.id),action:e.action,reason:e.reason,actorId:e.actor_user_id,createdAt:new Date(e.created_at).toISOString()}))};
}
export async function previewAdvanceAuthorization(pool:StudentSubscriptionSqlPool,scope:ReleaseScope,deps:AdvanceDeps={}){
 return financialTransaction(pool,async c=>advanceSnapshot(c as Db,scope,deps,true));
}
export async function listAdvanceAuthorizations(pool:StudentSubscriptionSqlPool,scope:ReleaseScope,deps:AdvanceDeps={}){
 return financialTransaction(pool,async client=>{
  const c=client as Db;await advanceSchema(c);
  const ids=(await c.query(`SELECT id FROM advance_subscription_authorizations WHERE school_id=$1
    AND academic_term_id=$2 AND rule_id=$3 ORDER BY id DESC`,[scope.schoolId,scope.termId,scope.ruleId])).rows;
  let fresh:Awaited<ReturnType<typeof advanceSnapshot>>|null=null;
  try{fresh=await advanceSnapshot(c,scope,deps,true);}catch(e){if(!(e instanceof DirectReleaseError))throw e;}
  const results=[];
  for(const {id} of ids){
   let a=await load(c,Number(id),true);
   if(!terminal.includes(a.status)){
    if(Date.now()>=new Date(a.expires_at).getTime())await event(c,Number(id),"EXPIRED",null,"Reviewed academic term window ended");
    else if(!fresh||!sameEvidence(a,fresh))await event(c,Number(id),"INVALIDATED",null,"Bound material evidence changed; fresh Owner review required");
    a=await load(c,Number(id));
   }
   results.push(view(a));
  }
  return {authorizations:results};
 });
}
export type AdvanceInput=ReleaseScope&{previewDigest:string;merchantEvidenceReference:string;merchantEvidenceHash:string;
 noSplitConfirmed:boolean;reason:string;requestKey:string};
export async function createAdvanceAuthorization(pool:StudentSubscriptionSqlPool,input:AdvanceInput,actorId:number,deps:AdvanceDeps={}){
 return financialTransaction(pool,async client=>{
  const c=client as Db;await requireFinancialActor(c,actorId);
  await advanceSchema(c);
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))fail("ADVANCE_REQUEST_KEY_REQUIRED");
  const priorKey=(await c.query("SELECT id FROM advance_subscription_authorizations WHERE request_key=$1",[input.requestKey])).rows[0];
  if(priorKey){
   const previous=await load(c,Number(priorKey.id));
   if(Number(previous.created_by)!==actorId||Number(previous.school_id)!==input.schoolId||Number(previous.academic_term_id)!==input.termId
     ||Number(previous.rule_id)!==input.ruleId||previous.facts_digest!==input.previewDigest||!input.noSplitConfirmed
     ||previous.merchant_evidence_reference!==input.merchantEvidenceReference.trim()
     ||previous.merchant_evidence_hash!==input.merchantEvidenceHash||previous.reason!==input.reason.trim())fail("ADVANCE_REQUEST_KEY_CONTENT_CONFLICT");
   return view(previous);
  }
  const fresh=await advanceSnapshot(c,input,deps,true),reason=why(input.reason);
  if(!input.noSplitConfirmed||!/^[a-f0-9]{64}$/.test(input.merchantEvidenceHash)
    ||input.merchantEvidenceReference.trim().length<8||input.merchantEvidenceReference.trim().length>300)fail("ADVANCE_NON_SPLIT_MERCHANT_EVIDENCE_REQUIRED");
  if(!fresh.approvalReady||fresh.digest!==input.previewDigest)fail("ADVANCE_STALE_OR_BLOCKED_PREVIEW");
  // First authorization must be genuinely prospective. A replacement after
  // invalidation may be reviewed in-term, never after its exclusive expiry.
  const prior=(await c.query(`SELECT id FROM advance_subscription_authorizations WHERE school_id=$1 AND academic_term_id=$2 ORDER BY id DESC LIMIT 1`,
   [input.schoolId,input.termId])).rows[0];
  if(fresh.today>fresh.end||(!prior&&fresh.today>=fresh.start))fail("ADVANCE_FUTURE_TERM_REQUIRED");
  const evidence=advanceDigest({facts:fresh.facts,merchantEvidenceReference:input.merchantEvidenceReference.trim(),
   merchantEvidenceHash:input.merchantEvidenceHash,reason,actorId,requestKey:input.requestKey});
  const id=Number((await c.query(`INSERT INTO advance_subscription_authorizations(school_id,academic_term_id,rule_id,
   snapshot,facts_digest,evidence_digest,merchant_evidence_reference,merchant_evidence_hash,not_before,expires_at,created_by,reason,request_key)
   VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
   [input.schoolId,input.termId,input.ruleId,JSON.stringify(fresh.facts),fresh.digest,evidence,input.merchantEvidenceReference.trim(),
    input.merchantEvidenceHash,fresh.facts.notBefore,fresh.facts.expiresAt,actorId,reason,input.requestKey])).rows[0].id);
  await event(c,id,"REVIEWED",actorId,reason);
  if(prior){
   const old=await load(c,Number(prior.id),true);
   if(!terminal.includes(old.status))await event(c,Number(prior.id),"WITHDRAWN",actorId,"Superseded by a fresh reviewed authorization");
  }
  // Submission is the explicit review step; approval is a separate confirmed
  // action against this immutable evidence digest, never a side effect of GET.
  return view(await load(c,id));
 });
}
export async function decideAdvanceAuthorization(pool:StudentSubscriptionSqlPool,id:number,input:{
 action:"APPROVED"|"REJECTED"|"WITHDRAWN";evidenceDigest:string;confirmScope:boolean;reason:string},actorId:number,deps:AdvanceDeps={}){
 // Stale/expiry outcomes must COMMIT their denial evidence rather than be lost
 // when an HTTP conflict is returned.
 const outcome=await financialTransaction(pool,async client=>{
  const c=client as Db;await requireFinancialActor(c,actorId);await advanceSchema(c);
  let a=await load(c,id,true);const reason=why(input.reason);
  if(a.evidence_digest!==input.evidenceDigest)fail("ADVANCE_EVIDENCE_CONFIRMATION_MISMATCH");
  if(a.status===input.action)return {value:view(a)};
  if(terminal.includes(a.status))fail("ADVANCE_REVIEW_TERMINAL_CREATE_FRESH_REVIEW");
  if(input.action==="APPROVED"){
   if(!input.confirmScope||a.status!=="REVIEWED")fail("ADVANCE_EXPLICIT_SCOPE_CONFIRMATION_REQUIRED");
   let fresh:Awaited<ReturnType<typeof advanceSnapshot>>|null=null;
   try{fresh=await advanceSnapshot(c,{schoolId:Number(a.school_id),termId:Number(a.academic_term_id),ruleId:Number(a.rule_id)},deps,true);}
   catch(e){if(!(e instanceof DirectReleaseError))throw e;}
   if(Date.now()>=new Date(a.expires_at).getTime()){
    await event(c,id,"EXPIRED",actorId,"Reviewed academic term window ended");return {error:"ADVANCE_EXPIRED"};
   }
   if(!fresh||!sameEvidence(a,fresh)){
    await event(c,id,"INVALIDATED",actorId,"Bound material evidence changed; fresh review required");return {error:"ADVANCE_MATERIAL_EVIDENCE_CHANGED"};
   }
   if(!fresh.approvalReady)fail("ADVANCE_MERCHANT_CONFIGURATION_REQUIRED");
   const review=await appendFinancialHistory(c,"review",[a.school_id,a.academic_term_id,a.rule_id,
    a.snapshot.reportDigest,a.snapshot.merchantScope,actorId,a.expires_at,reason]);
   await event(c,id,"APPROVED",actorId,reason,Number(review.rows[0].id));
  }else await event(c,id,input.action,actorId,reason);
  a=await load(c,id);return {value:view(a)};
 });
 if(outcome.error)fail(outcome.error);return outcome.value!;
}
/** Return undefined only when this school/term has never entered the separate
 * workflow. A withdrawn/stale latest authorization must not resurrect an older
 * ordinary or advance approval. Caller already applies global runtime gates. */
export async function findAdvanceReview(c:Db,scope:{schoolId:number;termId:number;studentId:number},deps:AdvanceDeps={},locked=false){
 if(!(await c.query("SELECT to_regclass('public.advance_subscription_authorizations') IS NOT NULL AS present")).rows[0]?.present)return undefined;
 await advanceSchema(c);
 const latest=(await c.query(`SELECT id FROM advance_subscription_authorizations WHERE school_id=$1 AND academic_term_id=$2 ORDER BY id DESC LIMIT 1`,
  [scope.schoolId,scope.termId])).rows[0];
 if(!latest)return undefined;
 const a=await load(c,Number(latest.id));
 if(a.status!=="APPROVED")return null;
 let fresh:Awaited<ReturnType<typeof advanceSnapshot>>|null=null;
 try{fresh=await advanceSnapshot(c,{...scope,ruleId:Number(a.rule_id)},deps,locked);}
 catch(e){if(!(e instanceof DirectReleaseError))throw e;return null;}
 if(!sameEvidence(a,fresh)||!fresh.facts.eligibleStudentIds.includes(scope.studentId)
   ||!advanceCheckoutOpen(fresh.today,fresh.start,fresh.end,fresh.termCurrent,fresh.sessionCurrent,fresh.calendarStatus,fresh.sessionStatus))
   return null;
 const reviewId=a.events.find((e:any)=>e.action==="APPROVED")?.review_id;
 return (await c.query(`SELECT r.*,$2::text AS request_id FROM student_direct_live_reviews r
  JOIN app_users u ON u.id=r.approved_by AND u.status='ACTIVE'
  WHERE r.id=$1 AND r.expires_at>clock_timestamp() AND r.approved_at<=clock_timestamp()
   AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.status='ACTIVE' AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.status='ACTIVE'
    AND m.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'))`,
  [reviewId,`advance:${a.id}`])).rows[0]??null;
}
/** Explicit checkout preflight, NOT a readiness GET or a payment. Persist stale
 * and expired denials in their own transaction so a later checkout rollback
 * cannot resurrect an authorization after observed merchant/evidence changes. */
export async function reconcileAdvanceCheckout(pool:StudentSubscriptionSqlPool,scope:{schoolId:number;termId:number},
 actorId:number,owner=false,deps:AdvanceDeps={}){
 return financialTransaction(pool,async client=>{
  const c=client as Db;await requireFinancialActor(c,actorId,owner?undefined:scope.schoolId);
  if(!(await c.query("SELECT to_regclass('public.advance_subscription_authorizations') IS NOT NULL AS present")).rows[0]?.present)return;
  await advanceSchema(c);
  const latest=(await c.query(`SELECT id FROM advance_subscription_authorizations WHERE school_id=$1 AND academic_term_id=$2 ORDER BY id DESC LIMIT 1`,
   [scope.schoolId,scope.termId])).rows[0];
  if(!latest)return;
  const a=await load(c,Number(latest.id),true);
  if(terminal.includes(a.status))return;
  let fresh:Awaited<ReturnType<typeof advanceSnapshot>>|null=null;
  try{fresh=await advanceSnapshot(c,{...scope,ruleId:Number(a.rule_id)},deps,true);}
  catch(e){if(!(e instanceof DirectReleaseError))throw e;}
  if(Date.now()>=new Date(a.expires_at).getTime())await event(c,Number(a.id),"EXPIRED",null,"Reviewed academic term window ended");
  else if(!fresh||!sameEvidence(a,fresh))await event(c,Number(a.id),"INVALIDATED",null,"Checkout observed changed bound evidence; fresh Owner review required");
 });
}
