import { randomUUID } from "node:crypto";
import type { StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { blockedLiveWorkflow, requireLiveWorkflow, type LiveWorkflowCapability } from "../lib/flutterwave-live-workflow-gate";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

/** Prices, recipients, Partner IDs, labels and eligibility are NEVER caller input.
 * Canonical identity/calendar/membership/attribution reads are environment-neutral;
 * every financial read/write is LIVE-only. No TEST recipient/profile is consulted.
 */
export async function issueLiveIntent(pool: StudentSubscriptionSqlPool, input: {
  actorId: number; schoolId: number; studentId: number; termId: number; merchantScope: string; idempotencyKey: string;
}, capability: LiveWorkflowCapability = blockedLiveWorkflow) {
  requireLiveWorkflow(capability);
  if (![input.actorId,input.schoolId,input.studentId,input.termId].every(n=>Number.isSafeInteger(n)&&n>0)
    || !/^[A-Za-z0-9_-]{8,80}$/.test(input.merchantScope)
    || !/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey)) throw new LiveFinalizationBlocked("LIVE_INTENT_INPUT_INVALID");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='3s'");
    const source=(await client.query(`SELECT st.id,st.school_id,sc.name AS school_name,
      trim(concat_ws(' ',st.first_name,st.last_name)) AS student_name,
      t.id AS term_id,t.name AS term_name,to_char(t.end_date,'YYYY-MM-DD') AS end_date,t.academic_session_id,ses.name AS session_name
      FROM students st JOIN schools sc ON sc.id=st.school_id
      JOIN academic_terms t ON t.school_id=st.school_id
      JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=st.school_id
      JOIN app_users au ON au.id=$1 AND au.status='ACTIVE'
      WHERE st.id=$2 AND st.school_id=$3 AND t.id=$4 AND lower(st.status)='active'
       AND EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.user_id=au.id AND sm.school_id=st.school_id
         AND sm.role='SCHOOL_ADMIN' AND sm.status='ACTIVE')
       AND NOT EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.user_id=au.id
         AND sm.role='PLATFORM_OWNER' AND sm.status='ACTIVE')
      FOR SHARE OF st,sc,t,ses,au`,[input.actorId,input.studentId,input.schoolId,input.termId])).rows[0];
    if (!source) throw new LiveFinalizationBlocked("LIVE_INTENT_AUTHORITY_DENIED");
    const review=(await client.query(`SELECT * FROM flutterwave_live_authority_reviews
      WHERE environment='LIVE' AND merchant_scope=$1 AND school_id=$2 AND expires_at>now()
      ORDER BY id DESC LIMIT 1 FOR SHARE`,[input.merchantScope,input.schoolId])).rows[0];
    if(!review) throw new LiveFinalizationBlocked("LIVE_RECIPIENT_REVIEW_MISSING");
    const attribution=(await client.query(`SELECT a.id,a.partner_profile_id FROM school_partner_attributions a
      JOIN partner_profiles pp ON pp.id=a.partner_profile_id AND pp.status='ACTIVE'
      WHERE a.school_id=$1 AND a.is_current AND a.status='ACTIVE' AND a.starts_at<=now()
       AND (a.ends_at IS NULL OR a.ends_at>now()) ORDER BY a.starts_at DESC,a.id DESC LIMIT 1 FOR SHARE OF a,pp`,
      [input.schoolId])).rows[0];
    const rule=attribution ? (await client.query(`SELECT id FROM commission_rules WHERE status='ACTIVE'
      AND currency='NGN' AND allocation_total=5000 AND school_amount=1900 AND partner_amount=100 AND edupulse_amount=3000
      AND (term=$1 OR term IS NULL) AND effective_at<=now() AND (ends_at IS NULL OR ends_at>now())
      ORDER BY (term=$1) DESC,effective_at DESC,id DESC LIMIT 1 FOR SHARE`,[source.term_name])).rows[0] : null;
    if(attribution&&!rule) throw new LiveFinalizationBlocked("LIVE_PARTNER_RULE_MISSING");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`live-intent:${input.merchantScope}:${input.actorId}:${input.idempotencyKey}`]);
    const prior=(await client.query(`SELECT * FROM flutterwave_live_subscription_intents
      WHERE environment='LIVE' AND merchant_scope=$1 AND issued_by=$2 AND issuer_key=$3`,
      [input.merchantScope,input.actorId,input.idempotencyKey])).rows[0];
    if(prior) {
      if(prior.school_id!==input.schoolId||prior.student_id!==input.studentId||prior.term_id!==input.termId)
        throw new LiveFinalizationBlocked("LIVE_INTENT_KEY_CONFLICT");
      await client.query("COMMIT");return prior;
    }
    const snapshot={ schoolName:source.school_name,studentName:source.student_name,
      sessionName:source.session_name,termName:source.term_name,
      attributionId:attribution?.id??null,ruleId:rule?.id??null,evidenceSha256:review.evidence_sha256 };
    const row=(await client.query(`INSERT INTO flutterwave_live_subscription_intents
      (merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,school_subaccount_id,
       partner_profile_id,partner_accrual_minor,issued_by,issuer_key,authority_review_id,authority_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
      [input.merchantScope,`SCV3_live_${randomUUID().replaceAll("-","")}`,input.schoolId,input.studentId,
        source.academic_session_id,input.termId,source.end_date,review.school_subaccount_id,
        attribution?.partner_profile_id??null,attribution?10000:0,input.actorId,input.idempotencyKey,review.id,JSON.stringify(snapshot)])).rows[0];
    await client.query("COMMIT");return row;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
}
