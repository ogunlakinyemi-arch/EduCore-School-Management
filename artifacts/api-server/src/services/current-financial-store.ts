import {createHash} from "node:crypto";
import {financialTransaction} from "./financial-transaction";
import {requireFinancialActor} from "./financial-history-writes";
import {inspectFinancialGuards} from "./financial-guard-schema";
import {demand, type CurrentPool, type CurrentSql,type CurrentSource} from "./current-financial-contract";
import {bulkCreditSource} from "./current-payment-evidence";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const referenceFor = (id: number) => `YETENIA_CURRENT_${id}`;
export async function currentTransaction<T>(pool: CurrentPool, actorId: number, work: (c: CurrentSql) => Promise<T>) {
  return financialTransaction(pool, async c => {
    await requireFinancialActor(c, actorId);
    await requireCurrentLifecycle(c);
    return work(c);
  });
}
export async function requireCurrentLifecycle(c: CurrentSql) {
  const tables = (await c.query(`SELECT
    to_regclass('public.current_subscription_operations') IS NOT NULL
    AND to_regclass('public.current_subscription_operation_events') IS NOT NULL
    AND to_regclass('public.current_subscription_reference_claims') IS NOT NULL AS ready`)).rows[0];
  demand(tables?.ready === true, "CURRENT_LIFECYCLE_MIGRATION_NOT_APPLIED");
  demand((await inspectFinancialGuards(c)).ready, "EXISTING_FINANCIAL_GUARDS_REQUIRED");
  const triggers = (await c.query(`SELECT count(*)::int AS count
    FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND (r.relname,t.tgname) IN
      (('current_subscription_operations','current_subscription_operations_history'),
       ('current_subscription_operation_events','current_subscription_events_history'),
       ('current_subscription_reference_claims','current_subscription_claims_history'))
      AND t.tgenabled='O' AND t.tgtype=27 AND NOT t.tgisinternal
      AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
      AND p.proname='guard_student_direct_history' AND p.pronamespace=n.oid`)).rows[0];
  demand(triggers?.count === 3, "CURRENT_HISTORY_GUARDS_REQUIRED");
}
export async function operation(c: CurrentSql, id: number) {
  const root = (await c.query("SELECT * FROM current_subscription_operations WHERE id=$1", [id])).rows[0];
  demand(root, "OPERATION_NOT_FOUND");
  return root;
}
export async function state(c: CurrentSql, id: number): Promise<string> {
  return (await c.query(`SELECT state FROM current_subscription_operation_events
    WHERE operation_id=$1 ORDER BY id DESC LIMIT 1`, [id])).rows[0]?.state ?? "REQUESTED";
}
export async function appendState(c: CurrentSql, id: number, next: string, key: string,
  actorId: number | null, details: object = {}) {
  const eventKey = `${id}:${key}`;
  const old = (await c.query(`SELECT * FROM current_subscription_operation_events WHERE event_key=$1`, [eventKey])).rows[0];
  if (old) {
    demand(old.state === next && digest(old.details) === digest(JSON.parse(JSON.stringify(details))),
      "EVENT_KEY_CONTENT_CONFLICT");
    return;
  }
  await c.query(`INSERT INTO current_subscription_operation_events
    (operation_id,event_key,state,actor_user_id,details) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [id,eventKey,next,actorId,JSON.stringify(details)]);
}
export async function createOperation(c: CurrentSql, v: {
  kind: string; key: string; schoolId: number; termId: number; attemptId?: number;
  entitlementId?: number; allocationId?:number; bulkEntitlementId?:number; parentId?: number; amountMinor: number;
  actorId: number; reason: string; snapshot: object;
}) {
  demand(v.reason.trim().length >= 3 && v.reason.trim().length <= 500, "REASON_REQUIRED");
  const values = [v.kind,v.key,v.schoolId,v.termId,v.attemptId??null,v.entitlementId??null,
    v.parentId??null,v.amountMinor,v.reason.trim(),v.actorId,JSON.stringify(v.snapshot)];
  const old = (await c.query(`SELECT * FROM current_subscription_operations WHERE kind=$1 AND request_key=$2`,
    values.slice(0,2))).rows[0];
  if (old) {
    demand(Number(old.school_id)===v.schoolId && Number(old.academic_term_id)===v.termId
      && Number(old.attempt_id??0)===(v.attemptId??0) && Number(old.entitlement_id??0)===(v.entitlementId??0)
      && Number(old.parent_id??0)===(v.parentId??0) && Number(old.amount_minor)===v.amountMinor
      && Number(old.created_by)===v.actorId && old.reason===v.reason.trim()
      && Number(old.allocation_id??0)===(v.allocationId??0)
      && Number(old.bulk_entitlement_id??0)===(v.bulkEntitlementId??0)
      && digest(old.snapshot)===digest(JSON.parse(JSON.stringify(v.snapshot))), "IDEMPOTENCY_CONTENT_CONFLICT");
    return old;
  }
  if(v.allocationId) return (await c.query(`INSERT INTO current_subscription_operations
    (kind,request_key,school_id,academic_term_id,attempt_id,entitlement_id,parent_id,amount_minor,reason,created_by,snapshot,
     allocation_id,bulk_entitlement_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING *`,
    [...values,v.allocationId,v.bulkEntitlementId??null])).rows[0];
  return (await c.query(`INSERT INTO current_subscription_operations
    (kind,request_key,school_id,academic_term_id,attempt_id,entitlement_id,parent_id,
     amount_minor,reason,created_by,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,values)).rows[0];
}
/** Normalized read projection. Bulk never creates a synthetic direct attempt. */
export async function paidDirect(c: CurrentSql, attemptId: CurrentSource) {
  if(typeof attemptId!=="number"){
    const a=(await c.query(`SELECT a.*,b.reference,c.provider_transaction_id,c.provider_reference,c.verified_at,c.payment_method,
      'PAID' AS state,'NGN' AS currency,0 AS school_share_minor,0 AS bro_share_minor
      FROM current_bulk_allocations a JOIN current_payment_batches b ON b.id=a.batch_id
      JOIN ${await bulkCreditSource(c)} c ON c.batch_id=b.id AND c.amount_minor=b.amount_minor
      WHERE a.id=$1 AND EXISTS(SELECT 1 FROM current_bulk_events e WHERE e.allocation_id=a.id AND e.state='POSTED')`,
      [attemptId.allocationId])).rows[0];
    demand(a&&(a.provider_transaction_id||a.payment_method==="COMPANY_BANK")&&Number(a.amount_minor)===320000,"CURRENT_VERIFIED_ALLOCATION_REQUIRED");
    return a;
  }
  const a = (await c.query(`SELECT a.*,o.school_id,o.student_id,o.academic_term_id,
    o.amount_minor,o.school_share_minor,o.bro_share_minor,o.currency
    FROM student_direct_live_attempts a JOIN student_direct_live_obligations o ON o.id=a.obligation_id
    WHERE a.id=$1 FOR SHARE OF a,o`,[attemptId])).rows[0];
  demand(a && a.state==="PAID" && a.provider_transaction_id && a.verified_at
    && /^SCV4_live_/.test(a.reference) && Number(a.amount_minor)===320000 && a.currency==="NGN"
    && Number(a.school_share_minor)===0 && Number(a.bro_share_minor)===0, "CURRENT_VERIFIED_PAYMENT_REQUIRED");
  return a;
}
export async function claimReference(c: CurrentSql, namespace: string, reference: string, id: number) {
  demand(typeof reference==="string" && reference.trim().length>=3 && reference.length<=200
    && !/[\u0000-\u001f\u007f]/.test(reference), "INVALID_EXTERNAL_REFERENCE");
  const normalized = reference.trim().toLowerCase();
  const bound=(await c.query(`SELECT reference FROM current_subscription_reference_claims
    WHERE namespace=$1 AND operation_id=$2 LIMIT 1`,[namespace,id])).rows[0];
  demand(!bound || bound.reference===normalized,"PROVIDER_REFERENCE_CHANGED");
  if (namespace==="BRO_PAYOUT") {
    const old = (await c.query(`SELECT id FROM partner_payouts
      WHERE lower(btrim(payment_reference))=$1 LIMIT 1`,[normalized])).rows[0];
    demand(!old, "REFERENCE_ALREADY_USED_BY_HISTORICAL_PAYOUT");
  }
  await c.query(`INSERT INTO current_subscription_reference_claims(namespace,reference,operation_id)
    VALUES($1,$2,$3) ON CONFLICT(namespace,reference) DO NOTHING`,[namespace,normalized,id]);
  const owner = (await c.query(`SELECT operation_id FROM current_subscription_reference_claims
    WHERE namespace=$1 AND reference=$2`,[namespace,normalized])).rows[0];
  demand(Number(owner?.operation_id)===id, "EXTERNAL_REFERENCE_ALREADY_USED");
}
/** Called by the retained manual writer too, under the same global gate. */
export async function currentPayoutReferenceInUse(c: CurrentSql,reference:string) {
  const present=(await c.query(`SELECT to_regclass('public.current_subscription_reference_claims') IS NOT NULL AS present`)).rows[0]?.present;
  if(!present)return false;
  return !!(await c.query(`SELECT operation_id FROM current_subscription_reference_claims
    WHERE namespace='BRO_PAYOUT' AND reference=$1`,[reference.trim().toLowerCase()])).rows[0];
}
export async function refundAmounts(c: CurrentSql, attemptId: CurrentSource) {
  const rows = (await c.query(`SELECT o.amount_minor,o.snapshot,
    COALESCE(e.state,'REQUESTED') AS state FROM current_subscription_operations o
    LEFT JOIN LATERAL(SELECT state FROM current_subscription_operation_events
      WHERE operation_id=o.id ORDER BY id DESC LIMIT 1)e ON true
     WHERE o.kind='REFUND' AND o.${typeof attemptId==="number"?"attempt_id":"allocation_id"}=$1`,
     [typeof attemptId==="number"?attemptId:attemptId.allocationId])).rows;
  let reserved=0,refunded=0,reversed=0;
  for (const r of rows) {
    if (r.snapshot.movement==="COLLECTION_REVERSAL") {
      if (r.state==="SUCCEEDED") reversed+=Number(r.amount_minor);
      continue;
    }
    if (!["FAILED","REVERSED"].includes(r.state)) reserved+=Number(r.amount_minor);
    if (r.state==="SUCCEEDED") refunded+=Number(r.amount_minor);
  }
  return {reservedMinor:reserved+reversed,refundedMinor:refunded,
    collectionReversedMinor:reversed,netPaidMinor:Math.max(0,320000-refunded-reversed),
    overRecoveryMinor:Math.max(0,refunded+reversed-320000)};
}
