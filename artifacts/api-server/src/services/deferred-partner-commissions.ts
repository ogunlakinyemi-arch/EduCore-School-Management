import { createHash } from "node:crypto";
import { pool, type DatabasePoolClient } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { ApprovePartnerPayoutBatchBody } from "@workspace/api-zod";

/** SQL view deliberately binds the immutable payment, school, student and term.
 * No current-school attribution lookup and no rewriting legacy commissions. */
export async function deferredCommissionEvidence() {
  requireSplitDevelopment();
  const { rows } = await pool.query(`SELECT * FROM deferred_partner_commission_evidence
    ORDER BY academic_session_id,term,partner_profile_id,id`);
  return rows.map(row => {
    const fee = row.provider_fee_minor, additional = row.provider_additional_fee_minor;
    const remainder = fee == null || additional == null ? null
      : Number(row.gross_amount_minor) - Number(row.school_amount_minor) - Number(fee) - Number(additional);
    return {
      id: row.id, partnerId: row.partner_profile_id, partnerName: row.partner_name,
      schoolId: row.school_id, studentId: row.student_id, sessionId: row.academic_session_id,
      termId: row.academic_term_id, term: row.term, sessionName: row.session_name,
      reference: row.reference, status: row.status, amountMinor: Math.round(Number(row.amount) * 100),
      grossMinor: row.gross_amount_minor, schoolMinor: row.school_amount_minor,
      providerFeeMinor: fee, providerAdditionalFeeMinor: additional,
      // additional fees are not documented VAT evidence. Never estimate VAT.
      vatMinor: null, merchantRemainderMinor: remainder,
      ownerNetMinor: remainder === null ? null : remainder - Math.round(Number(row.amount) * 100),
      eligible: row.verified_eligible === true && row.payout_id === null && row.status === "PENDING",
      termEnded: row.term_ended === true, settlementStatus: row.split_status,
    };
  });
}

export async function ownDeferredCommissionTotals(partnerId: number) {
  requireSplitDevelopment();
  const { rows } = await pool.query(`SELECT
    COALESCE(sum(amount*100) FILTER(WHERE verified_eligible AND status NOT IN ('HELD','REVERSED','CANCELLED')),0)::bigint earned,
    COALESCE(sum(amount*100) FILTER(WHERE verified_eligible AND status='PENDING'),0)::bigint pending,
    COALESCE(sum(amount*100) FILTER(WHERE verified_eligible AND status IN ('APPROVED','PAYABLE')),0)::bigint approved,
    COALESCE(sum(amount*100) FILTER(WHERE verified_eligible AND status='PAID'),0)::bigint paid,
    COALESCE(sum(amount*100) FILTER(WHERE status='REVERSED'),0)::bigint recovery
    FROM deferred_partner_commission_evidence WHERE partner_profile_id=$1`, [partnerId]);
  const row = rows[0];
  return { earnedMinor: Number(row.earned), pendingMinor: Number(row.pending),
    approvedMinor: Number(row.approved), paidMinor: Number(row.paid), recoveryMinor: Number(row.recovery) };
}

export async function commissionBatchAudit(client: DatabasePoolClient, actorId: number, action: string, id: number, metadata: unknown) {
  await client.query(`INSERT INTO audit_logs("user",role,actor_user_id,action,module,record_id,metadata)
    SELECT email,'PLATFORM_OWNER',id,$2,'Partner Commission Batches',$3,$4::jsonb FROM app_users WHERE id=$1`,
  [actorId,action,id,JSON.stringify(metadata)]);
}

export function batchView(row: any) {
  return { ...row.snapshot, id: row.id, status: row.status, approvedAt: new Date(row.approved_at).toISOString(),
    approvedBy: row.approved_by, executionMode: "EXPORT_ONLY" };
}

export async function approveCommissionBatch(input: unknown, actorId: number) {
  requireSplitDevelopment();
  const parsed = ApprovePartnerPayoutBatchBody.safeParse(input);
  if (!parsed.success) throw new AuthError(400, "Select 1–5000 commission IDs and provide a valid idempotency key");
  const { idempotencyKey, commissionIds } = parsed.data;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey) || new Set(commissionIds).size !== commissionIds.length) {
    throw new AuthError(400, "Unique commission IDs and a valid idempotency key are required");
  }
  const ids = [...commissionIds].sort((a,b) => a-b);
  const hash = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize same and different keys before reserving any entry. Refund
    // triggers lock those same rows and invalidate a committed batch afterward.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('deferred-commission-bulk-approval',0))");
    const prior = (await client.query("SELECT * FROM partner_payout_batches WHERE idempotency_key=$1", [idempotencyKey])).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new AuthError(409, "Approval key is already bound to different commissions");
      await client.query("COMMIT");
      return batchView(prior);
    }
    await client.query("SELECT id FROM commission_ledger WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
    const evidence = (await client.query(`SELECT e.* FROM deferred_partner_commission_evidence e
      WHERE e.id=ANY($1::int[]) ORDER BY e.id`, [ids])).rows;
    if (evidence.length !== ids.length || evidence.some(e => !e.verified_eligible || !e.term_ended
        || e.status !== "PENDING" || e.payout_id !== null)) {
      throw new AuthError(409, "Every selected commission must be verified, non-refunded, unapproved and past its school term end");
    }
    const batch = (await client.query(`INSERT INTO partner_payout_batches(idempotency_key,request_hash,approved_by,snapshot)
      VALUES($1,$2,$3,'{}') RETURNING *`, [idempotencyKey,hash,actorId])).rows[0];
    const items: Array<Record<string, unknown>> = [];
    // One approval contains one payout record per partner, with item-level terms.
    for (const partnerId of [...new Set(evidence.map(e => e.partner_profile_id))]) {
      const entries = evidence.filter(e => e.partner_profile_id === partnerId);
      const amountMinor = entries.reduce((sum,e) => sum + Math.round(Number(e.amount)*100),0);
      const payout = (await client.query(`INSERT INTO partner_payouts
        (partner_profile_id,amount,currency,status,period_start,period_end,method,notes)
        VALUES($1,$2,'NGN','PENDING',$3,$4,'DEFERRED_BATCH_EXPORT',$5) RETURNING id`,
      [partnerId,amountMinor/100,entries.reduce((min,e) => String(e.end_date) < String(min) ? e.end_date : min,entries[0].end_date),
        new Date(),`Approved batch ${batch.id}; export only. No transfer executed or verified.`])).rows[0];
      for (const e of entries) {
        await client.query(`INSERT INTO partner_payout_batch_items(batch_id,commission_id,payout_id) VALUES($1,$2,$3)`,
          [batch.id,e.id,payout.id]);
        await client.query(`UPDATE commission_ledger SET status='APPROVED',approved_at=NOW(),payout_id=$1 WHERE id=$2`, [payout.id,e.id]);
        items.push({commissionId:e.id,partnerId,payoutId:payout.id,amountMinor:Math.round(Number(e.amount)*100),
          reference:e.reference,schoolId:e.school_id,studentId:e.student_id,sessionId:e.academic_session_id,
          termId:e.academic_term_id,term:e.term});
      }
    }
    const snapshot = {currency:"NGN",amountMinor:items.reduce((sum,e) => sum + Number(e.amountMinor),0),items};
    batch.snapshot = snapshot;
    await client.query("UPDATE partner_payout_batches SET snapshot=$1::jsonb WHERE id=$2", [JSON.stringify(snapshot),batch.id]);
    await commissionBatchAudit(client,actorId,"Approved deferred partner payout batch",batch.id,{commissionIds:ids,executionMode:"EXPORT_ONLY"});
    await client.query("COMMIT");
    return batchView(batch);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function listCommissionBatches() {
  requireSplitDevelopment();
  return (await pool.query("SELECT * FROM partner_payout_batches ORDER BY id DESC")).rows.map(batchView);
}
export async function exportCommissionBatch(id: number, actorId: number) {
  requireSplitDevelopment();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT * FROM partner_payout_batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new AuthError(404, "Approval batch not found");
    if (row.status !== "APPROVED") throw new AuthError(409, "This batch has an exception; do not execute previously exported instructions");
    const invalid = (await client.query(`SELECT bi.commission_id FROM partner_payout_batch_items bi
      LEFT JOIN deferred_partner_commission_evidence e ON e.id=bi.commission_id
      WHERE bi.batch_id=$1 AND (e.id IS NULL OR NOT e.verified_eligible OR e.status<>'APPROVED' OR e.payout_id<>bi.payout_id)`, [id])).rows;
    if (invalid.length) throw new AuthError(409, "Batch evidence changed; payout review is required");
    await commissionBatchAudit(client,actorId,"Exported deferred partner payout batch",id,{executionMode:"EXPORT_ONLY"});
    await client.query("COMMIT");
    return batchView(row);
  } catch(error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
