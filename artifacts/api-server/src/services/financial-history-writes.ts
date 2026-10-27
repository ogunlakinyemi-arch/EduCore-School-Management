/**
 * Application write boundary, not a database security boundary.
 * Never accepts caller-supplied SQL, table names or update columns.
 * Callers own BEGIN/COMMIT, eligibility checks and audit writes on the SAME client.
 * Existing procedural readiness gates remain mandatory.
 */
export type FinancialClient = {
  query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>;
};
const inserts = {
  reviewRequest: `INSERT INTO student_direct_live_release_requests
    (school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,merchant_evidence_reference,
     merchant_evidence_hash,policy,no_split_confirmed,expires_at,created_by,reason)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,true,$10,$11,$12)
    ON CONFLICT(evidence_digest) DO NOTHING RETURNING id`,
  review: `INSERT INTO student_direct_live_reviews
    (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
    VALUES($1,$2,$3,$4,$5,true,$6,$7,$8) RETURNING id`,
  binding: `INSERT INTO student_direct_live_review_bindings(review_id,request_id,rule_version,release,environment)
    VALUES($1,$2,$3,$4,'LIVE')`,
  decision: `INSERT INTO student_direct_live_release_decisions(request_id,action,actor_user_id,reason)
    VALUES($1,$2,$3,$4)`,
  obligation: `INSERT INTO student_direct_live_obligations(school_id,student_id,academic_term_id,
    rule_id,review_id,merchant_scope,assistance_request_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,student_id,academic_term_id) DO NOTHING`,
  attempt: `INSERT INTO student_direct_live_attempts(obligation_id,reference,idempotency_key,state,created_by)
    VALUES($1,$2,$3,'RESERVED',$4) RETURNING *`,
  event: `INSERT INTO student_direct_live_events(attempt_id,kind,actor_user_id,details)
    VALUES($1,$2,$3,$4::jsonb)`,
  bro: `INSERT INTO bro_term_commission_entitlements
    (school_id,student_id,academic_term_id,partner_profile_id,attribution_id,policy_id,
     direct_obligation_id,direct_attempt_id,amount_minor,earned_at,evidence,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
    ON CONFLICT ON CONSTRAINT bro_term_commission_scope_uq DO NOTHING RETURNING *`,
} as const;

export class FinancialWriteBlocked extends Error {}

/** Recheck live DB authority even for non-HTTP callers. Public verification is separate. */
export async function requireFinancialActor(c:FinancialClient,actorId:number,schoolId?:number){
  const row=(await c.query(`SELECT EXISTS(
    SELECT 1 FROM app_users u JOIN school_memberships m ON m.user_id=u.id
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.status='ACTIVE'
      AND (($2::integer IS NULL AND m.role='PLATFORM_OWNER' AND m.school_id IS NULL)
        OR ($2::integer IS NOT NULL AND m.role='SCHOOL_ADMIN' AND m.school_id=$2
          AND NOT EXISTS(SELECT 1 FROM school_memberships own WHERE own.user_id=u.id AND own.role='PLATFORM_OWNER')))
      AND NOT EXISTS(SELECT 1 FROM school_memberships restricted WHERE restricted.user_id=u.id
        AND restricted.status='ACTIVE' AND restricted.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'))
    FOR SHARE OF u,m
    ) AS financial_actor_authorized`,[actorId,schoolId??null])).rows[0];
  if(row?.financial_actor_authorized!==true)throw new FinancialWriteBlocked("FINANCIAL_ACTOR_NOT_AUTHORIZED");
}

/**
 * Repeats the 0179 INSERT relationship predicate at the write boundary.
 * The BRO service additionally enforces rollout, latest approved policy, active
 * participants, legacy exclusion and provider event evidence under its locks.
 */
async function requireBroScope(c:FinancialClient,v:unknown[]){
  const row=(await c.query(`SELECT EXISTS(
    SELECT 1 FROM student_direct_live_obligations o
    JOIN student_direct_live_attempts a ON a.obligation_id=o.id
    JOIN academic_terms t ON t.id=o.academic_term_id AND t.school_id=o.school_id
    JOIN school_partner_attributions at ON at.id=$5 AND at.school_id=o.school_id AND at.partner_profile_id=$4
    JOIN subscription_rule_proposals p ON p.id=$6 AND p.product='BRO_COMMISSION'
      AND p.status IN ('ACTIVE','SCHEDULED') AND p.amount_minor=15000 AND p.activated_at IS NOT NULL
    WHERE o.id=$7 AND a.id=$8 AND o.school_id=$1 AND o.student_id=$2 AND o.academic_term_id=$3
      AND o.amount_minor=320000 AND o.school_share_minor=0 AND o.bro_share_minor=0 AND o.currency='NGN'
      AND a.state='PAID' AND a.verified_at=$10::timestamptz AND a.provider_transaction_id IS NOT NULL
      AND p.effective_at<=(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos')
      AND (p.ends_at IS NULL OR p.ends_at>(t.start_date::timestamp AT TIME ZONE 'Africa/Lagos'))
      AND $9::integer=15000
    FOR SHARE OF o,a,t,at,p
    ) AS financial_bro_scope_valid`,v.slice(0,10))).rows[0];
  if(row?.financial_bro_scope_valid!==true)throw new FinancialWriteBlocked("BRO_EARNING_SCOPE_INVALID");
}

export async function appendFinancialHistory(c:FinancialClient,operation:keyof typeof inserts,values:unknown[]){
  // Own-property check also fails closed for untyped callers.
  if(!Object.hasOwn(inserts,operation))throw new FinancialWriteBlocked("FINANCIAL_WRITE_OPERATION_INVALID");
  if(operation==="bro")await requireBroScope(c,values);
  return c.query(inserts[operation],values);
}

export type AttemptState="RESERVED"|"READY"|"UNKNOWN"|"PENDING"|"PAID"|"FAILED";
type AttemptChange = {
  state:AttemptState;checkoutUrl?:string;
  transactionId?:string;providerReference?:string|null;
  providerFeeMinor?:number|null;additionalFeeMinor?:number|null;
};
const nextStates:Record<AttemptState,readonly AttemptState[]>={
  RESERVED:["READY","UNKNOWN","PENDING","PAID","FAILED"],
  READY:["PENDING","PAID","FAILED"],UNKNOWN:["PENDING","PAID","FAILED"],
  PENDING:["PAID","FAILED"],PAID:[],FAILED:[],
};

/** Locks and updates only mutable columns. Terminal rows are NEVER updated. */
export async function transitionDirectAttempt(c:FinancialClient,id:number,change:AttemptChange){
  const allowed=["state","checkoutUrl","transactionId","providerReference","providerFeeMinor","additionalFeeMinor"];
  if(Object.keys(change).some(k=>!allowed.includes(k)))throw new FinancialWriteBlocked("ATTEMPT_IDENTITY_IMMUTABLE");
  const old=(await c.query("SELECT * FROM student_direct_live_attempts WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!old||!Object.hasOwn(nextStates,old.state)||!nextStates[old.state as AttemptState].includes(change.state))
    throw new FinancialWriteBlocked("ATTEMPT_TRANSITION_FORBIDDEN");
  if(old.provider_transaction_id && change.transactionId!==old.provider_transaction_id)
    throw new FinancialWriteBlocked("VERIFIED_TRANSACTION_CONFLICT");
  const terminal=change.state==="PAID"||change.state==="FAILED";
  if((terminal||change.state==="PENDING")&&!/^[1-9][0-9]{0,15}$/.test(change.transactionId??""))
    throw new FinancialWriteBlocked("VERIFIED_TRANSACTION_REQUIRED");
  if(change.state==="READY" && !change.checkoutUrl)throw new FinancialWriteBlocked("CHECKOUT_URL_REQUIRED");
  if(change.state==="PAID" && (!change.providerReference
    ||!Number.isSafeInteger(change.providerFeeMinor)||!Number.isSafeInteger(change.additionalFeeMinor)
    ||change.providerFeeMinor!<0||change.additionalFeeMinor!<0
    ||change.providerFeeMinor!+change.additionalFeeMinor!>=320000))
    throw new FinancialWriteBlocked("VERIFIED_PAYMENT_EVIDENCE_REQUIRED");
  const saved=(await c.query(`UPDATE student_direct_live_attempts SET state=$2,
    checkout_url=$3,provider_transaction_id=$4,provider_reference=$5,
    provider_fee_minor=$6,additional_fee_minor=$7,
    verified_at=CASE WHEN $8::boolean THEN now() ELSE verified_at END
    WHERE id=$1 AND state=$9 AND state NOT IN ('PAID','FAILED') RETURNING *`,
    [id,change.state,change.checkoutUrl??old.checkout_url,change.transactionId??old.provider_transaction_id,
      change.providerReference===undefined?old.provider_reference:change.providerReference,
      change.providerFeeMinor===undefined?old.provider_fee_minor:change.providerFeeMinor,
      change.additionalFeeMinor===undefined?old.additional_fee_minor:change.additionalFeeMinor,terminal,old.state])).rows[0];
  if(!saved)throw new FinancialWriteBlocked("ATTEMPT_TRANSITION_CONFLICT");
  return saved;
}
