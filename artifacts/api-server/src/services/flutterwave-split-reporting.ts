import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { requireSplitDevelopment, ngnMinor, fixedSplitInstructions } from "../lib/flutterwave-split-policy";
import { studentAllocationPolicy } from "../lib/student-allocation-policy";
import { decryptSplitBank } from "./flutterwave-split-crypto";
import { splitProvider } from "./flutterwave-split-provider";
import { adjustmentView } from "./flutterwave-split-refunds";

export function splitFinancialSummary(payment: any, adjustments: any[], partnerAccrual: any) {
  const policy = studentAllocationPolicy(payment.reference);
  const feeComponentsComplete = payment.provider_fee_minor != null
    && payment.provider_additional_fee_minor != null;
  const providerFeesMinor = feeComponentsComplete
    ? Number(payment.provider_fee_minor) + Number(payment.provider_additional_fee_minor) : null;
  const merchantGrossMinor = Number(payment.platform_amount_minor)
    + (policy.deferredPartner ? Number(payment.partner_amount_minor) : 0);
  const confirmedRefundMinor = adjustments.filter(a => a.status === "CONFIRMED")
    .reduce((sum,a) => sum + Number(a.amount_minor),0);
  const partnerEligible = policy.deferredPartner && payment.partner_profile_id != null;
  const partnerAccrualMatches = partnerEligible && partnerAccrual
    && Number(partnerAccrual.amount) === 100 && String(partnerAccrual.currency).toUpperCase() === "NGN";
  return {
    providerFeesMinor,
    providerTaxMinor: null as number | null,
    merchantGrossMinor,
    merchantNetMinor: providerFeesMinor === null ? null : merchantGrossMinor-providerFeesMinor,
    merchantNetStatus: providerFeesMinor === null
      ? "PROVIDER_COSTS_INCOMPLETE" as const
      : "CALCULATED_BEFORE_REFUNDS_NOT_BANK_SETTLEMENT" as const,
    confirmedRefundMinor,
    internalPartnerAccrualMinor: partnerEligible ? 10_000 : 0,
    internalPartnerAccrualStatus: !policy.deferredPartner ? "NOT_CURRENT_POLICY"
      : !partnerEligible ? "NOT_ELIGIBLE"
      : partnerAccrualMatches ? String(partnerAccrual.status) : "MISSING_OR_MISMATCHED",
    platformNetMinor: providerFeesMinor === null ? null
      : Number(payment.platform_amount_minor)-providerFeesMinor
        - adjustments.filter(a => a.status === "CONFIRMED")
          .reduce((sum,a) => sum + Number(a.platform_reversal_minor ?? 0),0),
  };
}

export async function splitPaymentView(paymentId: number) {
  const r = (await pool.query(
    `SELECT s.*,p.status collection_status,p.settlement_amount_minor
       FROM flutterwave_split_payments s
     JOIN student_subscription_payments p ON p.id=s.payment_id WHERE s.payment_id=$1`, [paymentId],
  )).rows[0];
  if (!r) throw new AuthError(404, "Split payment not found");
  const adjustments = (await pool.query("SELECT * FROM flutterwave_split_adjustments WHERE payment_id=$1 ORDER BY id", [paymentId])).rows;
  const policy = studentAllocationPolicy(r.reference);
  const partnerAccrual = policy.deferredPartner && r.partner_profile_id != null
    ? (await pool.query(
      `SELECT amount,currency,status FROM commission_ledger
        WHERE payment_id=$1 AND partner_profile_id=$2 ORDER BY id DESC LIMIT 1`,
      [paymentId,r.partner_profile_id],
    )).rows[0] ?? null
    : null;
  const summary = splitFinancialSummary(r,adjustments,partnerAccrual);
  const webhookEvents = (await pool.query(
    `SELECT event_id AS "eventId",webhook_transaction_id AS "transactionId",status,
            signature_verified AS "signatureVerified",payload_sha256 AS "payloadSha256",
            received_at AS "receivedAt",updated_at AS "updatedAt",error_message AS "error"
       FROM fee_provider_webhook_events
      WHERE provider='FLUTTERWAVE' AND provider_reference=$1
        AND event_id LIKE 'flutterwave:student-subscription:%'
      ORDER BY received_at DESC LIMIT 10`,
    [r.reference],
  )).rows;
  return {
    paymentId:r.payment_id,schoolId:r.school_id,studentId:r.student_id,termId:r.term_id,reference:r.reference,
    status:r.status,collectionStatus:r.collection_status,grossAmountMinor:500000,
    schoolAmountMinor:r.school_amount_minor,partnerAmountMinor:r.partner_amount_minor,platformAmountMinor:r.platform_amount_minor,
    providerFeeMinor:r.provider_fee_minor,providerAdditionalFeeMinor:r.provider_additional_fee_minor,
    ...summary,
    providerSettlementAmountMinor:r.settlement_amount_minor ?? null,
    webhookEvents,
    currency:r.currency,reconciliationNote:r.reconciliation_note,
    recipients:(await pool.query(
      `SELECT recipient_id AS "recipientId",expected_amount_minor AS "expectedAmountMinor",
       observed_amount_minor AS "observedAmountMinor",provider_settlement_id AS "providerSettlementId",status,exception
       FROM flutterwave_split_settlements WHERE payment_id=$1 ORDER BY id`, [paymentId],
    )).rows,
    adjustments:adjustments.map(adjustmentView),
  };
}
/** Strict report matching, not a transfer operation and not actual-bank evidence in TEST. */
export function inspectRecipientSettlement(report: any, transaction: any, bank: { bankCode: string; accountNumber: string },
  expected: { transactionId: string; reference: string; amountMinor: number },
) {
  if (String(transaction.id) !== expected.transactionId || transaction.tx_ref !== expected.reference
      || transaction.currency !== "NGN" || report.currency !== "NGN"
      || String(report.bank_code) !== bank.bankCode || report.settlement_account !== bank.accountNumber) {
    return { status:"MISMATCH",amount:null,exception:"TRANSACTION_CURRENCY_OR_RECIPIENT_MISMATCH" };
  }
  if (Number(report.refund ?? 0) > 0 || Number(report.chargeback ?? 0) > 0) {
    return { status:"MISMATCH",amount:null,exception:"REFUND_OR_CHARGEBACK_DEDUCTION_REQUIRES_TRANSACTION_LEVEL_REVIEW" };
  }
  let amount;
  try { amount = ngnMinor(transaction.settlement_amount); }
  catch { return { status:"MISMATCH",amount:null,exception:"MISSING_EXACT_RECIPIENT_AMOUNT" }; }
  if (amount !== expected.amountMinor) return { status:"MISMATCH",amount,exception:"RECIPIENT_AMOUNT_MISMATCH" };
  if (["failed","flagged"].includes(String(report.status).toLowerCase())) {
    return { status:"FAILED",amount,exception:"PROVIDER_SETTLEMENT_FAILED_OR_FLAGGED" };
  }
  if (report.status !== "completed" || transaction.status !== "successful"
      || !report.disburse_ref || !report.processed_date || !Number.isFinite(Date.parse(report.processed_date))) {
    return { status:"PENDING",amount,exception:"DISBURSEMENT_EVIDENCE_NOT_COMPLETE" };
  }
  return { status:"TEST_PROVIDER_REPORTED_COMPLETE",amount,exception:null };
}
/** Empty, extra or cross-policy recipients can never prove disbursement. */
export function settlementRecipientsMatchPlan(payment: any, recipients: any[]): boolean {
  try {
    const instructions = payment.instructions;
    if (!Array.isArray(instructions)) return false;
    const policy = studentAllocationPolicy(payment.reference);
    if (policy.deferredPartner && payment.partner_recipient_id != null) return false;
    const canonical = fixedSplitInstructions(instructions[0]?.id,instructions[1]?.id ?? null,policy.version);
    if (instructions.length !== canonical.length
        || JSON.stringify(instructions.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))
          !== JSON.stringify(canonical.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))) return false;
    const ids = [payment.school_recipient_id,...(payment.partner_recipient_id != null ? [payment.partner_recipient_id] : [])];
    if (recipients.length !== canonical.length || ids.length !== canonical.length
        || new Set(ids).size !== ids.length || new Set(recipients.map(r=>r.id)).size !== recipients.length) return false;
    return canonical.every((item,i) => recipients.some(r => r.id === ids[i]
      && r.provider_subaccount_id === item.id && r.expected_amount_minor === item.transaction_charge*100));
  } catch { return false; }
}

export async function reconcileSplitPayment(paymentId: number) {
  requireSplitDevelopment();
  const p = (await pool.query(
    `SELECT s.*,p.status collection_status,p.provider_transaction_id FROM flutterwave_split_payments s
     JOIN student_subscription_payments p ON p.id=s.payment_id WHERE s.payment_id=$1`, [paymentId],
  )).rows[0];
  if (!p) throw new AuthError(404, "Split payment not found");
  if (p.collection_status !== "PAID" || !p.provider_transaction_id) throw new AuthError(409, "Settlement reports require verified collection");
  if (["REFUNDED","REFUND_REVIEW","COLLECTION_EXCEPTION"].includes(p.status)) {
    throw new AuthError(409, "Resolve the refund or collection exception before claiming settlement");
  }
  const recipients = (await pool.query(
    `SELECT r.*,s.expected_amount_minor FROM flutterwave_split_settlements s
     JOIN flutterwave_split_recipients r ON r.id=s.recipient_id WHERE s.payment_id=$1 ORDER BY s.id`, [paymentId],
  )).rows;
  if (!settlementRecipientsMatchPlan(p,recipients)) {
    await pool.query(`UPDATE flutterwave_split_payments SET status='REPORT_EXCEPTION',
      reconciliation_note='Frozen recipient evidence is missing or inconsistent; no settlement completion established'
      WHERE payment_id=$1 AND status NOT IN ('REFUND_REVIEW','REFUNDED','COLLECTION_EXCEPTION')`,[paymentId]);
    throw new AuthError(409,"Frozen recipient evidence is missing or inconsistent");
  }
  let hasException = false, complete = true;
  const provider = splitProvider();
  for (const r of recipients) {
    try {
      const bank = decryptSplitBank(r.bank_ciphertext);
      const candidates = await provider.settlementCandidates(r.provider_subaccount_id,new Date(p.created_at).toISOString().slice(0,10));
      const matches: { report:any; transaction:any }[] = [];
      for (const candidate of candidates) {
        const id = Number(candidate.id);
        if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid settlement ID");
        const report = await provider.settlement(id);
        if (!Array.isArray(report.transactions) || report.meta?.page_info?.total_pages > 1) throw new Error("Incomplete report");
        for (const transaction of report.transactions) {
          if (String(transaction.id) === p.provider_transaction_id || transaction.tx_ref === p.reference) {
            matches.push({report,transaction});
          }
        }
      }
      if (matches.length > 1) throw new Error("Ambiguous transaction reports");
      if (!matches.length) {
        complete = false;
        await pool.query(
          `UPDATE flutterwave_split_settlements SET exception='No matching recipient disbursement report yet',updated_at=NOW()
           WHERE payment_id=$1 AND recipient_id=$2 AND status<>'TEST_PROVIDER_REPORTED_COMPLETE'`, [paymentId,r.id],
        );
        continue;
      }
      const {report,transaction} = matches[0];
      const result = inspectRecipientSettlement(report,transaction,bank,{
        transactionId:p.provider_transaction_id,reference:p.reference,amountMinor:r.expected_amount_minor,
      });
      complete &&= result.status === "TEST_PROVIDER_REPORTED_COMPLETE";
      hasException ||= ["FAILED","MISMATCH"].includes(result.status);
      await pool.query(
        `UPDATE flutterwave_split_settlements SET status=$1,observed_amount_minor=$2,exception=$3,
         provider_settlement_id=$4,updated_at=NOW() WHERE payment_id=$5 AND recipient_id=$6`,
        [result.status,result.amount,result.exception,String(report.id),paymentId,r.id],
      );
    } catch {
      complete = false; hasException = true;
      await pool.query(
        `UPDATE flutterwave_split_settlements SET exception='Reporting unavailable, incomplete or ambiguous; inspect TEST dashboard permissions and recipient statement',
         updated_at=NOW() WHERE payment_id=$1 AND recipient_id=$2`, [paymentId,r.id],
      );
    }
  }
  await pool.query(
    `UPDATE flutterwave_split_payments SET status=$1,reconciliation_note=$2 WHERE payment_id=$3
     AND status NOT IN ('REFUND_REVIEW','REFUNDED','COLLECTION_EXCEPTION')`,
    [hasException ? "REPORT_EXCEPTION" : complete ? "TEST_PROVIDER_REPORTED_COMPLETE" : "COLLECTION_PAID",
      hasException ? "Recipient settlement evidence requires review; no transfer or new allocation was initiated"
      : complete ? "Provider-reported TEST disbursement matched all recipients; no real bank deposit is verified"
      : "Collection verified; recipient bank settlement remains unverified",paymentId],
  );
  return splitPaymentView(paymentId);
}
