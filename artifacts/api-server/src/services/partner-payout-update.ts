import type { Request } from "express";
import { pool, type DatabasePoolClient } from "@workspace/db";
import { AuthError, assertResourceId } from "../middlewares/auth";

type Audit = (
  req: Request, action: string, module: string, id: number,
  metadata: Record<string, unknown> | null, client: DatabasePoolClient,
) => Promise<unknown>;

/** Manual bookkeeping, not bank verification. Never release a used payment reference. */
export async function updateManualPartnerPayout(req: Request, audit: Audit) {
  const id = assertResourceId(req.params.payoutId, "Payout");
  const status = req.body?.status;
  const reference = typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : "";
  const transitions: Record<string, string[]> = {
    PENDING: ["PROCESSING", "FAILED"], PROCESSING: ["PAID", "FAILED"], PAID: ["REVERSED"],
  };
  if (reference.length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(reference)) {
    throw new AuthError(400, "A valid paymentReference is required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id,status,payment_reference FROM partner_payouts WHERE id=$1 FOR UPDATE`, [id]);
    const row = current.rows[0];
    if (!row) throw new AuthError(404, "Payout not found");
    if (!transitions[row.status]?.includes(status)) {
      throw new AuthError(409, `Invalid payout transition from ${row.status} to ${status}`);
    }
    if (["PAID", "REVERSED"].includes(status) && !reference) {
      throw new AuthError(400, "paymentReference is required when marking a payout paid or reversed");
    }
    // Keeping a recorded reference also keeps its unique reservation after failure/reversal.
    const recorded = typeof row.payment_reference === "string" ? row.payment_reference.trim() : "";
    if (status !== "REVERSED" && recorded && reference && recorded !== reference) {
      throw new AuthError(409, "A recorded payout payment reference cannot be replaced");
    }
    const payout = await client.query(
      `UPDATE partner_payouts SET status=$1,
       payment_reference=CASE WHEN $1='REVERSED' OR $2='' THEN payment_reference ELSE $2 END,
       paid_at=CASE WHEN $1='PAID' THEN NOW() ELSE paid_at END,
       reversed_at=CASE WHEN $1='REVERSED' THEN NOW() ELSE reversed_at END,
       reversal_reference=CASE WHEN $1='REVERSED' THEN $3 ELSE reversal_reference END
       WHERE id=$4 RETURNING id,partner_profile_id AS "partnerId",amount::float,currency,status,
         payment_reference AS "paymentReference",reversal_reference AS "reversalReference",
         period_start AS "periodStart",period_end AS "periodEnd",created_at AS "createdAt",paid_at AS "paidAt"`,
      [status, reference, status === "REVERSED" ? reference : null, id],
    );
    if (status === "PAID") await client.query(
      `UPDATE commission_ledger SET status='PAID',paid_at=NOW(),payment_reference=$1 WHERE payout_id=$2 AND status='PAYABLE'`,
      [reference, id]);
    if (status === "FAILED") await client.query(
      `UPDATE commission_ledger SET payout_id=NULL WHERE payout_id=$1 AND status='PAYABLE'`, [id]);
    if (status === "REVERSED") await client.query(
      `UPDATE commission_ledger SET payout_id=NULL,status='PAYABLE',reversed_at=NOW(),reversal_reference=$2
       WHERE payout_id=$1 AND status='PAID'`, [id, reference]);
    await audit(req, `Updated partner payout to ${status}`, "Payouts", id,
      status === "REVERSED" ? { reversalReference: reference } : null, client);
    await client.query("COMMIT");
    return payout.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const conflict = error as { code?: string; constraint?: string };
    if (conflict.code === "23505" && conflict.constraint === "partner_payouts_manual_reference_uq") {
      throw new AuthError(409, "This payment reference is already recorded against another payout");
    }
    throw error;
  } finally {
    client.release();
  }
}
