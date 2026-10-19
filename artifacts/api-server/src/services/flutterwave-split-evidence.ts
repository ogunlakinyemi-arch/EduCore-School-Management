import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { fixedSplitInstructions, requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { compareVerificationResponse } from "../lib/flutterwave-split-evidence";
import { splitProvider } from "./flutterwave-split-provider";
import { studentAllocationPolicy } from "../lib/student-allocation-policy";

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
  const policy = studentAllocationPolicy(p.reference);
  const canonical = fixedSplitInstructions(instructions[0]?.id, instructions[1]?.id ?? null,policy.version);
  if (JSON.stringify(instructions.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))
      !== JSON.stringify(canonical.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]))
      || (policy.deferredPartner && (instructions.length !== 1 || p.partner_recipient_id !== null))
      || Number(p.platform_amount_minor) !== (p.partner_profile_id ? policy.platformWithPartnerMinor : policy.platformWithoutPartnerMinor)
      || Number(p.school_amount_minor) !== policy.schoolMinor
      || Number(p.partner_amount_minor) !== (p.partner_profile_id ? 10000 : 0)) {
    throw new AuthError(409, "Frozen allocation differs from the approved policy");
  }
  const expected = {
    transactionId: String(p.provider_transaction_id), reference: String(p.reference), currency: "NGN",
    grossAmountMinor: 500000, platformGrossMinor: Number(p.platform_amount_minor) + (policy.deferredPartner ? Number(p.partner_amount_minor) : 0),
    recipients: instructions.map(s => ({ subaccountId: s.id, amountMinor: s.transaction_charge * 100 })),
  };
  // Only documented verify collection scalars are consumed. No speculative
  // settlement/report mapping, secondary provider requests, or financial writes.
  let result;
  try { result = compareVerificationResponse(expected, await splitProvider().transactionEvidence(expected.transactionId)); }
  catch { result = { ...compareVerificationResponse(expected, {}), reason: "Independent TEST transaction read-back is unavailable" }; }
  return {
    ...result,
    paymentId, transactionId:expected.transactionId, reference:expected.reference,
    checkedAt:new Date().toISOString(), source:"FLUTTERWAVE_TEST_READ_BACK",
  };
}
