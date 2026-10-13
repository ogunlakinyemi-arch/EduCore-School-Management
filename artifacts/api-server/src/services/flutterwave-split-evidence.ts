import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { fixedSplitInstructions, ngnMinor, requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { compareTransactionSplits, type ReportedTransactionSplit } from "../lib/flutterwave-split-evidence";
import { decryptSplitBank } from "./flutterwave-split-crypto";
import { splitProvider } from "./flutterwave-split-provider";

/**
 * Explicit, authorized provider GETs only. No payment, transfer, settlement or
 * historical ledger writes. Echoed subaccounts/meta are never allocation proof.
 */
export async function transactionSplitEvidence(paymentId: number) {
  requireSplitDevelopment();
  const p = (await pool.query(
    `SELECT s.*,p.status collection_status,p.provider_transaction_id,p.provider,p.provider_mode
     FROM flutterwave_split_payments s JOIN student_subscription_payments p ON p.id=s.payment_id
     WHERE s.payment_id=$1`, [paymentId],
  )).rows[0];
  if (!p || p.provider !== "FLUTTERWAVE" || p.provider_mode !== "SANDBOX") throw new AuthError(404, "TEST split payment not found");
  if (p.collection_status !== "PAID" || !p.provider_transaction_id
      || ["REFUNDED","REFUND_REVIEW","COLLECTION_EXCEPTION"].includes(p.status)) {
    throw new AuthError(409, "A verified, non-exception TEST collection is required");
  }
  const instructions = p.instructions;
  if (!Array.isArray(instructions) || ![1,2].includes(instructions.length)) throw new AuthError(409, "Frozen plan requires review");
  const canonical = fixedSplitInstructions(instructions[0]?.id, instructions[1]?.id ?? null);
  if (JSON.stringify(instructions.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))
      !== JSON.stringify(canonical.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))
      || Number(p.platform_amount_minor) !== (instructions.length === 2 ? 290000 : 300000)
      || Number(p.school_amount_minor) !== 200000
      || Number(p.partner_amount_minor) !== (instructions.length === 2 ? 10000 : 0)) {
    throw new AuthError(409, "Frozen allocation differs from the approved policy");
  }
  const expected = {
    transactionId: String(p.provider_transaction_id), reference: String(p.reference), currency: "NGN",
    grossAmountMinor: 500000, platformGrossMinor: Number(p.platform_amount_minor),
    recipients: instructions.map(s => ({ subaccountId: s.id, amountMinor: s.transaction_charge * 100 })),
  };
  const provider = splitProvider();
  let transaction: Record<string, unknown>;
  try { transaction = await provider.transactionEvidence(expected.transactionId); }
  catch {
    return {
      ...compareTransactionSplits(expected, {}, null),
      status: "UNCONFIRMED" as const, reason: "Independent TEST transaction read-back is unavailable",
      paymentId, transactionId:expected.transactionId, reference:expected.reference,
      checkedAt:new Date().toISOString(), source:"FLUTTERWAVE_TEST_READ_BACK",
    };
  }
  const initial = compareTransactionSplits(expected,transaction,null);
  if (initial.status === "MISMATCH" || initial.platformNetMinor === null) {
    return {
      ...initial,paymentId,transactionId:expected.transactionId,reference:expected.reference,
      checkedAt:new Date().toISOString(),source:"FLUTTERWAVE_TEST_READ_BACK",
    };
  }
  // No saved/documented verify response establishes an authoritative complete
  // split-set schema. Read known transaction settlement lines as PARTIAL evidence.
  // Do not promote request echoes, merchant-controlled metadata, or inferred
  // merchant remainder to full provider allocation confirmation.
  const observed: NonNullable<ReportedTransactionSplit>["recipients"] = [];
  const rows = (await pool.query(
    `SELECT r.* FROM flutterwave_split_settlements s JOIN flutterwave_split_recipients r ON r.id=s.recipient_id
     WHERE s.payment_id=$1 ORDER BY s.id`, [paymentId],
  )).rows;
  for (const row of rows) {
    try {
      const bank = decryptSplitBank(row.bank_ciphertext);
      const verifiedRecipient = await provider.verifyRecipient(Number(row.provider_id), bank);
      if (verifiedRecipient.subaccountId !== row.provider_subaccount_id
          || !expected.recipients.some(r => r.subaccountId === verifiedRecipient.subaccountId)) continue;
      const candidates = await provider.settlementCandidates(verifiedRecipient.subaccountId,new Date(p.created_at).toISOString().slice(0,10));
      const matches: number[] = [];
      for (const candidate of candidates) {
        if (!Number.isSafeInteger(Number(candidate.id)) || Number(candidate.id) < 1) continue;
        const report = await provider.settlement(Number(candidate.id));
        if (!Array.isArray(report.transactions) || report.meta?.page_info?.total_pages > 1
            || report.subaccount_id !== verifiedRecipient.subaccountId
            || report.currency !== "NGN" || String(report.bank_code) !== bank.bankCode
            || report.settlement_account !== bank.accountNumber
            || Number(report.refund ?? 0) > 0 || Number(report.chargeback ?? 0) > 0) continue;
        for (const t of report.transactions) {
          if (String(t.id) === expected.transactionId && t.tx_ref === expected.reference && t.currency === "NGN"
              && t.status === "successful") matches.push(ngnMinor(t.settlement_amount));
        }
      }
      if (matches.length === 1) observed.push({ subaccountId:verifiedRecipient.subaccountId,amountMinor:matches[0] });
    } catch { /* Unavailable, paginated or ambiguous evidence is never success. */ }
  }
  return {
    ...compareTransactionSplits(expected,transaction,observed.length ? {recipients:observed,completeRecipientSet:false} : null),
    paymentId, transactionId:expected.transactionId, reference:expected.reference,
    checkedAt:new Date().toISOString(), source:"FLUTTERWAVE_TEST_READ_BACK",
  };
}
