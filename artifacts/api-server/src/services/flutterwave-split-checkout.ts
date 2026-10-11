import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { fixedSplitInstructions, isSplitDevelopment, type FixedSplitInstruction } from "../lib/flutterwave-split-policy";
import type { StudentSubscriptionSqlClient } from "../lib/student-subscription-billing";
import type { VerifiedPayment } from "../lib/fee-providers";

export async function frozenSplit(db: StudentSubscriptionSqlClient, paymentId: number) {
  if (!isSplitDevelopment()) return null;
  return (await db.query("SELECT * FROM flutterwave_split_payments WHERE payment_id=$1", [paymentId])).rows[0] ?? null;
}
export async function splitAttribution(db: StudentSubscriptionSqlClient, schoolId: number, term: string) {
  const a = (await db.query(
    `SELECT a.id,a.partner_profile_id FROM school_partner_attributions a
     JOIN partner_profiles pp ON pp.id=a.partner_profile_id
     WHERE a.school_id=$1 AND a.is_current AND a.status='ACTIVE' AND pp.status='ACTIVE'
      AND a.starts_at<=NOW() AND (a.ends_at IS NULL OR a.ends_at>NOW())
     ORDER BY a.starts_at DESC,a.id DESC LIMIT 1 FOR SHARE OF a,pp`, [schoolId],
  )).rows[0];
  if (!a) return null;
  const rule = (await db.query(
    `SELECT id FROM commission_rules WHERE status='ACTIVE' AND currency='NGN'
      AND allocation_total=5000 AND school_amount=2000 AND partner_amount=100 AND edupulse_amount=2900
      AND (term=$1 OR term IS NULL) AND effective_at<=NOW() AND (ends_at IS NULL OR ends_at>NOW())
     ORDER BY (term=$1) DESC,effective_at DESC,id DESC LIMIT 1 FOR SHARE`, [term],
  )).rows[0];
  if (!rule) throw new AuthError(409, "Eligible partner has no matching effective commission rule");
  return { attributionId: Number(a.id), partnerId: Number(a.partner_profile_id), ruleId: Number(rule.id) };
}

/** Transaction owns both the frozen plan and its payment. No browser financial inputs. */
export async function prepareSplitCheckout(paymentId: number): Promise<FixedSplitInstruction[] | undefined> {
  if (!isSplitDevelopment()) return undefined;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const p = (await db.query(
      `SELECT p.*,sub.term FROM student_subscription_payments p JOIN subscriptions sub ON sub.id=p.subscription_id
       WHERE p.id=$1 FOR UPDATE OF p`, [paymentId],
    )).rows[0];
    if (!p || p.status !== "PENDING" || p.provider !== "FLUTTERWAVE" || p.provider_mode !== "SANDBOX"
        || p.gross_amount_minor !== 500000 || p.currency !== "NGN") throw new AuthError(409, "Checkout payment requires review");
    const setting = (await db.query(
      "SELECT * FROM flutterwave_split_settings WHERE school_id=$1 FOR SHARE", [p.school_id],
    )).rows[0];
    const existing = await frozenSplit(db, paymentId);
    if (!setting?.enabled && !existing) { await db.query("COMMIT"); return undefined; }
    if (!setting?.enabled || !setting.automatic_settlement_confirmed) throw new AuthError(409, "School split configuration is not ready");
    const school = (await db.query(
      "SELECT * FROM flutterwave_split_recipients WHERE school_id=$1 AND status='TEST_READY' FOR SHARE", [p.school_id],
    )).rows[0];
    if (!school) throw new AuthError(409, "School needs its own reviewed and provider-verified TEST subaccount");
    const eligibility = await splitAttribution(db, p.school_id, p.term);
    const partner = eligibility ? (await db.query(
      "SELECT * FROM flutterwave_split_recipients WHERE partner_profile_id=$1 AND status='TEST_READY' FOR SHARE", [eligibility.partnerId],
    )).rows[0] : null;
    if (eligibility && !partner) throw new AuthError(409, "Eligible partner needs its own reviewed and provider-verified TEST subaccount");
    const instructions = fixedSplitInstructions(school.provider_subaccount_id, partner?.provider_subaccount_id ?? null);
    if (existing) {
      const canonicalInstructions = (value: FixedSplitInstruction[]) => JSON.stringify(
        value.map(s => [s.id,s.transaction_charge_type,s.transaction_charge]));
      if (existing.status !== "CHECKOUT_FROZEN" || existing.school_recipient_id !== school.id
          || existing.partner_recipient_id !== (partner?.id ?? null)
          || existing.attribution_id !== (eligibility?.attributionId ?? null)
          || existing.commission_rule_id !== (eligibility?.ruleId ?? null)
          || canonicalInstructions(existing.instructions) !== canonicalInstructions(instructions)) {
        throw new AuthError(409, "Frozen split recipients or eligibility changed; reconciliation is required");
      }
    } else {
      await db.query(
        `INSERT INTO flutterwave_split_payments(payment_id,school_id,student_id,subscription_id,session_id,term_id,reference,
           school_recipient_id,partner_recipient_id,partner_profile_id,attribution_id,commission_rule_id,
           instructions,partner_amount_minor,platform_amount_minor)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
        [paymentId,p.school_id,p.student_id,p.subscription_id,p.academic_session_id,p.academic_term_id,p.reference,
          school.id,partner?.id ?? null,eligibility?.partnerId ?? null,eligibility?.attributionId ?? null,
          eligibility?.ruleId ?? null,JSON.stringify(instructions),eligibility ? 10000 : 0,eligibility ? 290000 : 300000],
      );
      for (const r of [{ id: school.id, amount: 200000 }, ...(partner ? [{ id: partner.id, amount: 10000 }] : [])]) {
        await db.query(
          `INSERT INTO flutterwave_split_settlements(payment_id,recipient_id,expected_amount_minor)
           VALUES($1,$2,$3) ON CONFLICT(payment_id,recipient_id) DO NOTHING`, [paymentId,r.id,r.amount],
        );
      }
    }
    await db.query("COMMIT");
    return instructions;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

/** Must run before the legacy PAID fast path; split snapshots cannot be reassigned. */
export async function validateSplitCollection(db: StudentSubscriptionSqlClient, payment: any, verified: VerifiedPayment) {
  const split = await frozenSplit(db, Number(payment.id));
  if (!split) return null;
  if (verified.reference !== split.reference || verified.amountMinor !== 500000 || verified.currency !== "NGN"
      || split.school_id !== Number(payment.schoolId) || split.student_id !== Number(payment.studentId)
      || split.subscription_id !== Number(payment.subscriptionId) || split.session_id !== Number(payment.sessionId)
      || split.term_id !== Number(payment.termId)
      || (verified.providerChargedAmountMinor !== undefined && verified.providerChargedAmountMinor !== 500000)
      || (payment.providerTransactionId && payment.providerTransactionId !== verified.providerTransactionId)) {
    throw new AuthError(409, "Frozen split collection does not match provider evidence");
  }
  if (payment.status === "PAID") {
    if (verified.status !== "succeeded" || ["REFUND_REVIEW","REFUNDED","COLLECTION_EXCEPTION"].includes(split.status)) {
      throw new AuthError(409, "Previously paid split has a refund or collection exception");
    }
    return split;
  }
  if (verified.status !== "succeeded") return split;
  if (verified.providerChargedAmountMinor !== 500000) {
    throw new AuthError(409, "Provider must independently confirm the payer was charged exactly NGN 5000 without a surcharge");
  }
  const attribution = await splitAttribution(db, split.school_id, payment.subscriptionTerm);
  if ((attribution?.attributionId ?? null) !== split.attribution_id
      || (attribution?.partnerId ?? null) !== split.partner_profile_id
      || (attribution?.ruleId ?? null) !== split.commission_rule_id) {
    throw new AuthError(409, "Partner eligibility changed after frozen checkout");
  }
  const costs = verified.providerCostComponents;
  if (!costs || costs.appFeeMinor === null || costs.additionalFeeMinor === null
      || !Number.isSafeInteger(costs.appFeeMinor) || !Number.isSafeInteger(costs.additionalFeeMinor)
      || costs.appFeeMinor < 0 || costs.additionalFeeMinor < 0
      || costs.appFeeMinor + costs.additionalFeeMinor > split.platform_amount_minor) {
    throw new AuthError(409, "Complete provider fee components are required for transparent platform expenses");
  }
  await db.query(
    "UPDATE flutterwave_split_payments SET provider_fee_minor=$1,provider_additional_fee_minor=$2 WHERE payment_id=$3",
    [costs.appFeeMinor,costs.additionalFeeMinor,payment.id],
  );
  return split;
}
export async function recordSplitCollection(db: StudentSubscriptionSqlClient, paymentId: number, status: string, subscriptionId?: number) {
  if (!isSplitDevelopment()) return;
  await db.query(
    `UPDATE flutterwave_split_payments SET status=$1 WHERE payment_id=$2 AND status='CHECKOUT_FROZEN'`,
    [status === "PAID" ? "COLLECTION_PAID" : status === "FAILED" ? "COLLECTION_FAILED" : "CHECKOUT_FROZEN",paymentId],
  );
  if (status === "PAID" && subscriptionId) await db.query(
    `UPDATE commission_ledger SET status='HELD' WHERE subscription_id=$1 AND payout_id IS NULL
     AND academic_session_id=(SELECT session_id FROM flutterwave_split_payments WHERE payment_id=$2)
     AND term=(SELECT t.name FROM flutterwave_split_payments s JOIN academic_terms t ON t.id=s.term_id WHERE s.payment_id=$2)
     AND partner_profile_id=(SELECT partner_profile_id FROM flutterwave_split_payments WHERE payment_id=$2)
     AND status='PENDING' AND EXISTS(SELECT 1 FROM flutterwave_split_payments WHERE payment_id=$2 AND partner_profile_id IS NOT NULL)`,
    [subscriptionId,paymentId],
  );
}
