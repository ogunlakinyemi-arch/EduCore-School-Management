/**
 * Catalog contract, NOT an installer. Bodies are pinned to approved 0176/0178;
 * the isolated native test compares these and 0179 with the original migrations.
 * A structural Publish diff alone does not certify these procedural objects.
 */
export const financialGuardBodies = {
  guard_student_direct_history: `
BEGIN RAISE EXCEPTION 'Direct LIVE history is append-only'; END `,
  guard_student_direct_attempt: `
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Direct LIVE attempts cannot be deleted'; END IF;
  IF (NEW.obligation_id,NEW.reference,NEW.idempotency_key,NEW.created_by,NEW.created_at)
       IS DISTINCT FROM (OLD.obligation_id,OLD.reference,OLD.idempotency_key,OLD.created_by,OLD.created_at)
     OR OLD.state IN ('PAID','FAILED') THEN RAISE EXCEPTION 'Direct LIVE attempt history is immutable'; END IF;
  RETURN NEW;
END `,
  guard_bro_term_commission_history: `
BEGIN RAISE EXCEPTION 'BRO term commission evidence is append-only'; END `,
  guard_bro_term_commission_scope: `
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o
    JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
    JOIN school_partner_attributions at ON at.id=NEW.attribution_id AND at.school_id=o.school_id
      AND at.partner_profile_id=NEW.partner_profile_id
    JOIN subscription_rule_proposals p ON p.id=NEW.policy_id AND p.product='BRO_COMMISSION'
      AND p.status IN ('ACTIVE','SCHEDULED') AND p.amount_minor=15000 AND p.activated_at IS NOT NULL
    WHERE o.id=NEW.direct_obligation_id AND a.id=NEW.direct_attempt_id
      AND o.school_id=NEW.school_id AND o.student_id=NEW.student_id AND o.academic_term_id=NEW.academic_term_id
      AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0 AND o.currency='NGN'
      AND a.state='PAID' AND a.verified_at=NEW.earned_at AND a.provider_transaction_id IS NOT NULL
      AND p.effective_at<=(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
      AND (p.ends_at IS NULL OR p.ends_at>(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'))
  ) THEN RAISE EXCEPTION 'Independent BRO earning scope or approval is invalid'; END IF;
  RETURN NEW;
END `,
} as const;
type GuardFunction = keyof typeof financialGuardBodies;
export const financialGuardTriggers: ReadonlyArray<{
  name: string; table: string; fn: GuardFunction; type: number;
}> = [
  {name:"student_direct_review_history",table:"student_direct_live_reviews",fn:"guard_student_direct_history",type:27},
  {name:"student_direct_obligation_history",table:"student_direct_live_obligations",fn:"guard_student_direct_history",type:27},
  {name:"student_direct_event_history",table:"student_direct_live_events",fn:"guard_student_direct_history",type:27},
  {name:"student_direct_attempt_history",table:"student_direct_live_attempts",fn:"guard_student_direct_attempt",type:27},
  {name:"student_direct_release_request_history",table:"student_direct_live_release_requests",fn:"guard_student_direct_history",type:27},
  {name:"student_direct_release_decision_history",table:"student_direct_live_release_decisions",fn:"guard_student_direct_history",type:27},
  {name:"student_direct_release_binding_history",table:"student_direct_live_review_bindings",fn:"guard_student_direct_history",type:27},
  {name:"bro_term_commission_append_only",table:"bro_term_commission_entitlements",fn:"guard_bro_term_commission_history",type:27},
  {name:"bro_term_commission_scope_guard",table:"bro_term_commission_entitlements",fn:"guard_bro_term_commission_scope",type:7},
];

// Intentionally strict: only trim surrounding whitespace/normalize line endings.
// Do not erase whitespace inside literals, fold string case, or accept arbitrary code
// merely because it contains fragments of the expected business predicate.
export const normalizeGuardBody = (body: string) => body.replace(/\r\n/g,"\n").trim();
type CatalogClient = {query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};
export async function inspectFinancialGuards(c:CatalogClient, scope:"direct"|"bro"|"all"="all"){
  const expected=financialGuardTriggers.filter(t=>scope==="all"
    ||(scope==="bro"?t.name.startsWith("bro_"):t.name.startsWith("student_")));
  const names=[...new Set(expected.map(t=>t.fn))];
  const functions=await c.query(`SELECT p.oid,p.proname,p.prosrc,p.prosecdef,p.provolatile,
    p.proisstrict,p.proleakproof,p.proconfig,p.prokind,p.pronargs,p.proparallel,p.proretset,
    p.prorettype='pg_catalog.trigger'::regtype AS returns_trigger,l.lanname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) AND p.pronargs=0`,[names]);
  const triggers=await c.query(`SELECT tg.tgname,t.relname,p.proname,p.oid AS function_oid,
    pn.nspname AS function_schema,tg.tgenabled,tg.tgtype,tg.tgnargs,
    tg.tgqual IS NULL AS unconditional,tg.tgconstraint=0 AS unconstrained,
    tg.tgattr::text AS columns,tg.tgparentid
    FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_proc p ON p.oid=tg.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT tg.tgisinternal AND tg.tgname=ANY($1::text[])`,[expected.map(t=>t.name)]);
  const issues:string[]=[];
  for(const name of names){
    const rows=functions.rows.filter(f=>f.proname===name);
    const f=rows[0];
    if(rows.length!==1||!f.returns_trigger||f.lanname!=="plpgsql"||f.prokind!=="f"
      ||f.prosecdef!==false||f.provolatile!=="v"||f.proisstrict!==false
      ||f.proleakproof!==false||f.proconfig!==null||f.proparallel!=="u"||f.proretset!==false
      ||normalizeGuardBody(f.prosrc)!==normalizeGuardBody(financialGuardBodies[name]))
      issues.push(`GUARD_FUNCTION_DEFINITION:${name}`);
  }
  for(const e of expected){
    const rows=triggers.rows.filter(t=>t.tgname===e.name&&t.relname===e.table);
    const t=rows[0],f=functions.rows.find(f=>f.proname===e.fn);
    if(rows.length!==1||t.proname!==e.fn||t.function_schema!=="public"
      ||!f||t.function_oid!==f.oid||t.tgenabled!=="O"||t.tgtype!==e.type
      ||t.tgnargs!==0||t.unconditional!==true||t.unconstrained!==true
      ||t.columns!==""||Number(t.tgparentid)!==0)
      issues.push(`GUARD_TRIGGER_DEFINITION:${e.name}`);
  }
  return{ready:issues.length===0,issues};
}
