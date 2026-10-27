import { randomUUID } from "node:crypto";
import type { StudentSubscriptionSqlClient, StudentSubscriptionSqlPool } from "../lib/student-subscription-billing";
import { HOSTED_HISTORY_GUARD_BODY, HostedPaymentError, hostedAmounts } from "../lib/hosted-manual-policy";

export type HostedActor = { id: number; email: string; owner: boolean; schoolIds: number[] };
export type HostedRow = Record<string, any>;
export async function hostedTransaction<T>(pool: StudentSubscriptionSqlPool,
  operation: (client: StudentSubscriptionSqlClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await operation(c); await c.query("COMMIT"); return r; }
  catch (e) { try { await c.query("ROLLBACK"); } catch {} throw e; }
  finally { c.release(); }
}
export function requireHostedRead(actor: HostedActor, schoolId: number) {
  if (!actor.owner && !actor.schoolIds.includes(schoolId)) throw new HostedPaymentError(404, "NOT_FOUND", "Payment not found.");
}
export async function hostedDatabaseReady(pool: StudentSubscriptionSqlPool) {
  const c = await pool.connect();
  try {
    const r = await c.query(`SELECT c.relname,t.tgtype,p.prosrc FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname='public' AND pn.nspname='public' AND p.proname='hosted_history_guard'
        AND c.relname IN ('hosted_checkout_orders','hosted_checkout_events')
        AND t.tgname='hosted_history_immutable' AND t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgnargs=0 AND NOT p.prosecdef`);
    return r.rows.length === 2 && ["hosted_checkout_orders", "hosted_checkout_events"].every(name =>
      r.rows.some(row => row.relname === name && Number(row.tgtype) === 58 &&
        String(row.prosrc).replace(/\r\n/g, "\n").trim() === HOSTED_HISTORY_GUARD_BODY.trim()));
  } catch { return false; } finally { c.release(); }
}
export async function appendHostedEvent(c: StudentSubscriptionSqlClient, order: HostedRow,
  kind: string, key: string, fields: {
    actorId?: number; transactionId?: string; amount?: number; fee?: number | null;
    externalReference?: string; proofSha256?: string; data?: Record<string, unknown>;
  } = {}) {
  const r = await c.query(`INSERT INTO hosted_checkout_events
    (id,order_reference,environment,kind,idempotency_key,actor_id,provider_transaction_id,amount_minor,
      fee_minor,external_reference,proof_sha256,data)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT (order_reference,idempotency_key) DO NOTHING RETURNING id`,
  [randomUUID(), order.reference, order.environment, kind, key, fields.actorId ?? null,
    fields.transactionId ?? null, fields.amount ?? null, fields.fee ?? null,
    fields.externalReference ?? null, fields.proofSha256 ?? null, JSON.stringify(fields.data ?? {})]);
  return r.rows.length === 1;
}
export async function loadHostedOrder(c: StudentSubscriptionSqlClient, reference: string, lock = false) {
  const r = await c.query(`SELECT o.*,s.name AS school_name FROM hosted_checkout_orders o
    JOIN schools s ON s.id=o.school_id WHERE o.reference=$1 ${lock ? "FOR UPDATE OF o" : ""}`, [reference]);
  if (!r.rows[0]) throw new HostedPaymentError(404, "NOT_FOUND", "Payment not found.");
  return r.rows[0] as HostedRow;
}
export async function hostedOrderView(c: StudentSubscriptionSqlClient, order: HostedRow) {
  const { rows } = await c.query(`SELECT * FROM hosted_checkout_events WHERE order_reference=$1 ORDER BY created_at,id`, [order.reference]);
  const event = (kind: string) => rows.find(e => e.kind === kind);
  const paid = event("PAYMENT_VERIFIED"), ready = event("CHECKOUT_READY");
  const hold = Boolean(event("RECONCILIATION_HOLD"));
  const fee = paid?.fee_minor === null || paid?.fee_minor === undefined ? null : Number(paid.fee_minor);
  const amounts = hostedAmounts(order.bro_profile_id !== null, fee);
  const payoutClaim=event("SCHOOL_PAYOUT_CLAIMED"),payoutSuccess=event("SCHOOL_PAYOUT_SUCCESS");
  const proof=event("SCHOOL_SETTLED")??event("SCHOOL_PAYOUT_RECEIPT");
  const schoolSettled=Boolean(event("SCHOOL_SETTLED")||payoutSuccess);
  const payoutFee=payoutSuccess?.fee_minor===undefined?null:Number(payoutSuccess.fee_minor);
  const lastObservation=rows.filter(e=>["SCHOOL_PAYOUT_UNCERTAIN","SCHOOL_PAYOUT_STATUS","SCHOOL_PAYOUT_ACCEPTED"].includes(e.kind)).at(-1);
  return { reference: String(order.reference), schoolId: Number(order.school_id), studentId: Number(order.student_id),
    schoolName:String(order.school_name??`School ${order.school_id}`),
    studentName: String(order.snapshot.studentName), termName: String(order.snapshot.termName),
    environment: order.environment as "TEST" | "LIVE",
    status: hold ? "RECONCILIATION_REQUIRED" : paid ? "PAID" : event("CHECKOUT_UNKNOWN") ? "RECONCILIATION_REQUIRED"
      : rows.some(e => e.kind === "VERIFICATION_FAILED") ? "FAILED" : ready ? "READY" : "PENDING",
    checkoutUrl: !paid && !hold ? ready?.data?.checkoutUrl ?? null : null, ...amounts, feeMinor: fee,
    schoolSettled, broSettled: Boolean(event("BRO_SETTLED")),
    schoolSettlementStatus:schoolSettled?"SUCCESS":!paid?"NOT_ELIGIBLE":event("SCHOOL_PAYOUT_FAILED")?"FAILED":
      lastObservation?.kind==="SCHOOL_PAYOUT_UNCERTAIN"?"RECONCILIATION_REQUIRED":
      event("SCHOOL_PAYOUT_ACCEPTED")||event("SCHOOL_PAYOUT_STATUS")?"PROCESSING":payoutClaim?"PENDING":"PENDING_SETTLEMENT",
    schoolPayoutClaimed:Boolean(payoutClaim),schoolPayoutSucceeded:Boolean(payoutSuccess),
    schoolPayoutTransferId:payoutSuccess?.provider_transaction_id??event("SCHOOL_PAYOUT_ACCEPTED")?.provider_transaction_id??null,
    schoolPayoutReference:payoutClaim?.external_reference??null,schoolPayoutFeeMinor:payoutFee,
    schoolPayoutFeeReviewRequired:Boolean(payoutSuccess?.data?.feeCeilingExceeded),
    platformNetAfterPayoutMinor:amounts.platformNetMinor===null||!payoutSuccess?null:amounts.platformNetMinor-(payoutFee??0),
    settlementReceiptId:proof?.data?.receiptId??null,
    settlementDate:proof?.data?.settlementDate??null,
    settlementExternalReference:event("SCHOOL_SETTLED")?.external_reference??payoutSuccess?.external_reference??null,
    settlementUploadedBy:proof?.data?.receiptUploadedBy??null,
    hold, createdAt: new Date(order.created_at).toISOString() };
}
