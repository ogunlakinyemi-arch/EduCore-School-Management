import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { requireSplitDevelopment, cumulativeRefundShares } from "../lib/flutterwave-split-policy";
import { splitProvider } from "./flutterwave-split-provider";
import { studentAllocationPolicy } from "../lib/student-allocation-policy";

export function adjustmentView(r: any) {
  return { id:r.id,paymentId:r.payment_id,amountMinor:r.amount_minor,status:r.status,
    providerRefundId:r.provider_refund_id ?? null,recoveryStatus:r.recovery_status,
    schoolRecoveryMinor:r.school_recovery_minor ?? null,partnerRecoveryMinor:r.partner_recovery_minor ?? null,
    platformReversalMinor:r.platform_reversal_minor ?? null };
}
export async function requestSplitRefund(paymentId: number, actorId: number,
  input: { amountMinor: number; reason: string; idempotencyKey: string },
) {
  requireSplitDevelopment();
  const db = await pool.connect();
  let adjustment: any, transactionId: string;
  try {
    await db.query("BEGIN");
    const payment = (await db.query(
      `SELECT s.*,p.status AS collection_status,p.provider_transaction_id
       FROM flutterwave_split_payments s JOIN student_subscription_payments p ON p.id=s.payment_id
       WHERE s.payment_id=$1 FOR UPDATE OF s,p`, [paymentId],
    )).rows[0];
    if (!payment || payment.collection_status !== "PAID" || !payment.provider_transaction_id) {
      throw new AuthError(409, "Refund requires an independently verified paid split transaction");
    }
    const key = `split-refund:${paymentId}:${input.idempotencyKey}`;
    const existing = (await db.query("SELECT * FROM flutterwave_split_adjustments WHERE idempotency_key=$1", [key])).rows[0];
    if (existing) {
      if (existing.amount_minor !== input.amountMinor || existing.reason !== input.reason) throw new AuthError(409, "Refund idempotency key is bound to a different request");
      await db.query("COMMIT"); return adjustmentView(existing);
    }
    const reserved = Number((await db.query(
      "SELECT COALESCE(sum(amount_minor),0) total FROM flutterwave_split_adjustments WHERE payment_id=$1 AND status<>'FAILED'", [paymentId],
    )).rows[0].total);
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 10000 || input.amountMinor + reserved > 500000) {
      throw new AuthError(409, "Refund exceeds the unreserved balance or Flutterwave's NGN 100 minimum");
    }
    adjustment = (await db.query(
      `INSERT INTO flutterwave_split_adjustments(payment_id,idempotency_key,amount_minor,reason,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`, [paymentId,key,input.amountMinor,input.reason,actorId],
    )).rows[0];
    transactionId = payment.provider_transaction_id;
    await db.query("UPDATE flutterwave_split_payments SET status='REFUND_REVIEW',reconciliation_note='Refund requested; customer disbursement and recipient recovery are separate' WHERE payment_id=$1", [paymentId]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
  try {
    const result = await splitProvider().requestRefund({
      providerTransactionId:transactionId!,amountMinor:input.amountMinor,currency:"NGN",reason:input.reason,
    });
    if (result.providerTransactionId !== transactionId! || result.amountMinor !== input.amountMinor) throw new Error("Mismatch");
    const saved = (await pool.query(
      `UPDATE flutterwave_split_adjustments SET provider_refund_id=$1,status='PROCESSING',updated_at=NOW()
       WHERE id=$2 AND status='REQUESTING' RETURNING *`, [result.providerRefundId,adjustment.id],
    )).rows[0];
    // POST success, including "completed", is not customer completion. A separate read is mandatory.
    return adjustmentView(saved);
  } catch {
    const saved = (await pool.query(
      "UPDATE flutterwave_split_adjustments SET status='OUTCOME_UNKNOWN',updated_at=NOW() WHERE id=$1 AND status='REQUESTING' RETURNING *",
      [adjustment.id],
    )).rows[0];
    return adjustmentView(saved);
  }
}
export async function verifySplitRefund(id: number) {
  requireSplitDevelopment();
  const first = (await pool.query(
    `SELECT a.*,p.provider_transaction_id FROM flutterwave_split_adjustments a
     JOIN student_subscription_payments p ON p.id=a.payment_id WHERE a.id=$1`, [id],
  )).rows[0];
  if (!first) throw new AuthError(404, "Refund not found");
  if (["CONFIRMED","FAILED"].includes(first.status)) return adjustmentView(first);
  if (!first.provider_refund_id) throw new AuthError(409, "Refund outcome is uncertain; reconcile its ID in the TEST dashboard without repeating the request");
  const verified = await splitProvider().verifyRefund(first.provider_refund_id);
  if (verified.providerRefundId !== first.provider_refund_id || verified.providerTransactionId !== first.provider_transaction_id
      || verified.amountMinor !== first.amount_minor) throw new AuthError(409, "Refund does not match its frozen transaction and amount");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const split = (await db.query("SELECT * FROM flutterwave_split_payments WHERE payment_id=$1 FOR UPDATE", [first.payment_id])).rows[0];
    let row = (await db.query("SELECT * FROM flutterwave_split_adjustments WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (["CONFIRMED","FAILED"].includes(row.status)) { await db.query("COMMIT"); return adjustmentView(row); }
    if (verified.status === "succeeded") {
      const previous = Number((await db.query(
        "SELECT COALESCE(sum(amount_minor),0) amount FROM flutterwave_split_adjustments WHERE payment_id=$1 AND status='CONFIRMED'", [split.payment_id],
      )).rows[0].amount);
      const version = studentAllocationPolicy(split.reference).version;
      const before = cumulativeRefundShares(previous, !!split.partner_profile_id, version);
      const after = cumulativeRefundShares(previous + row.amount_minor, !!split.partner_profile_id, version);
      row = (await db.query(
        `UPDATE flutterwave_split_adjustments SET status='CONFIRMED',recovery_status='RECIPIENT_RECOVERY_REVIEW',
         school_recovery_minor=$1,partner_recovery_minor=$2,platform_reversal_minor=$3,updated_at=NOW() WHERE id=$4 RETURNING *`,
        [after.school-before.school,after.partner-before.partner,after.platform-before.platform,id],
      )).rows[0];
      await db.query(
        `UPDATE flutterwave_split_payments SET status=$1,
         reconciliation_note='Customer refund independently confirmed; recipient recovery is not an automatic bank clawback'
         WHERE payment_id=$2`, [previous + row.amount_minor === 500000 ? "REFUNDED" : "REFUND_REVIEW",split.payment_id],
      );
      if (previous + row.amount_minor === 500000) await db.query(
        "UPDATE subscriptions SET status='pending',verification_status='pending' WHERE id=$1 AND provider_reference=$2",
        [split.subscription_id,split.reference],
      );
    } else {
      row = (await db.query(
        "UPDATE flutterwave_split_adjustments SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
        [verified.status === "failed" ? "FAILED" : "PROCESSING",id],
      )).rows[0];
    }
    await db.query("COMMIT"); return adjustmentView(row);
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
