import type { pool as applicationPool } from "@workspace/db";
import {
  assertDiagnosticDevelopment, assertPaymentBinding, DiagnosticError,
  paymentIdentitySql, readPaymentBinding,
} from "../lib/development-payment-binding";

export function diagnosticSelector(query: Record<string, unknown>) {
  const keys = Object.keys(query);
  if (keys.length !== 1 || !["txRef","flutterwaveReference"].includes(keys[0])) {
    throw new DiagnosticError(400,"ONE_EXACT_REFERENCE_REQUIRED");
  }
  const kind = keys[0], value = query[kind];
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new DiagnosticError(400,"INVALID_EXACT_REFERENCE");
  }
  return {kind,value};
}
const code = (v: unknown) => typeof v === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(v) ? v : null;
const minor = (v: unknown) => v !== null && v !== undefined && Number.isSafeInteger(Number(v))
  && Number(v) >= 0 ? Number(v) : null;

/** No provider imports, provisioning middleware, financial mutations or raw snapshots. */
export async function localPaymentDiagnostic(
  pool: Pick<typeof applicationPool,"connect">, clerkUserId: string | null, query: Record<string, unknown>,
  binding = readPaymentBinding,
) {
  assertDiagnosticDevelopment();
  if (!clerkUserId) throw new DiagnosticError(401,"AUTHENTICATION_REQUIRED");
  const selector = diagnosticSelector(query);
  const expected = await binding(); // No DB connection without independent proof.
  const db = await pool.connect();
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout='3000ms'");
    await db.query("SET LOCAL lock_timeout='500ms'");
    const actual = (await db.query(paymentIdentitySql)).rows[0];
    assertPaymentBinding(expected,actual ?? {});
    const auth = (await db.query(
      `SELECT u.id FROM app_users u WHERE u.clerk_user_id=$1 AND u.status='ACTIVE'
       AND EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=u.id
         AND m.role='PLATFORM_OWNER' AND m.status='ACTIVE' AND m.school_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM school_memberships m WHERE m.user_id=u.id
         AND m.status='ACTIVE' AND m.role IN ('INTERNAL_OFFICER','COMPANY_ACCOUNTANT'))
       LIMIT 1`, [clerkUserId],
    )).rows[0];
    if (!auth) throw new DiagnosticError(403,"ACTIVE_GLOBAL_PLATFORM_OWNER_REQUIRED");
    // flw_ref is not persisted by this collection pipeline. Never confuse it
    // with tx_ref or the numeric provider transaction ID.
    if (selector.kind === "flutterwaveReference") {
      await db.query("COMMIT");
      return {outcome:"LOOKUP_UNAVAILABLE",reason:"FLUTTERWAVE_REFERENCE_NOT_PERSISTED",
        requiredIdentifier:"Exact app tx_ref or a separately established local mapping"};
    }
    const p = (await db.query(
      `SELECT id,school_id,student_id,subscription_id,status,provider,provider_mode,currency,
         gross_amount_minor,provider_fee_minor,settlement_amount_minor,settlement_status,
         reconciliation_status,failure_code,(receipt_snapshot IS NOT NULL) AS receipt_present
       FROM student_subscription_payments WHERE reference=$1
         AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX' LIMIT 1`, [selector.value],
    )).rows[0];
    if (!p) {
      await db.query("COMMIT");
      return {outcome:"NOT_FOUND",scope:"VERIFIED_DEVELOPMENT_FLUTTERWAVE_SANDBOX_ONLY"};
    }
    const plan = (await db.query(
      `SELECT status,school_amount_minor,partner_amount_minor,platform_amount_minor,
          provider_fee_minor,provider_additional_fee_minor
       FROM flutterwave_split_payments WHERE payment_id=$1 AND school_id=$2
         AND student_id=$3 AND subscription_id=$4 LIMIT 1`,
      [p.id,p.school_id,p.student_id,p.subscription_id],
    )).rows[0];
    const ledger = (await db.query(
      `SELECT entry_type,recipient_type,amount_minor FROM student_subscription_allocations
       WHERE payment_id=$1 AND school_id=$2 AND student_id=$3 AND subscription_id=$4
       ORDER BY id LIMIT 101`, [p.id,p.school_id,p.student_id,p.subscription_id],
    )).rows;
    const settlements = plan ? (await db.query(
      `SELECT r.kind,s.status,s.expected_amount_minor,s.observed_amount_minor,
         (s.provider_settlement_id IS NOT NULL) AS provider_record_present
       FROM flutterwave_split_settlements s
       JOIN flutterwave_split_recipients r ON r.id=s.recipient_id
       JOIN flutterwave_split_payments p ON p.payment_id=s.payment_id
       WHERE s.payment_id=$1 AND p.school_id=$2 AND p.student_id=$3 AND p.subscription_id=$4
         AND ((r.id=p.school_recipient_id AND r.school_id=p.school_id)
           OR (r.id=p.partner_recipient_id AND r.partner_profile_id=p.partner_profile_id))
       ORDER BY s.id LIMIT 3`, [p.id,p.school_id,p.student_id,p.subscription_id],
    )).rows : [];
    await db.query("COMMIT");
    return {
      outcome:"FOUND",scope:"VERIFIED_DEVELOPMENT_FLUTTERWAVE_SANDBOX_ONLY",
      payment:{status:code(p.status),provider:code(p.provider),mode:code(p.provider_mode),
        currency:code(p.currency),grossMinor:minor(p.gross_amount_minor),providerFeeMinor:minor(p.provider_fee_minor),
        providerNetMinor:minor(p.settlement_amount_minor),settlementStatus:code(p.settlement_status),
        reconciliationStatus:code(p.reconciliation_status),failureCode:code(p.failure_code)},
      frozenPlan: plan ? {present:true,status:code(plan.status),schoolMinor:minor(plan.school_amount_minor),
        partnerMinor:minor(plan.partner_amount_minor),ownerMinor:minor(plan.platform_amount_minor),
        providerFeeMinor:minor(plan.provider_fee_minor),additionalFeeMinor:minor(plan.provider_additional_fee_minor)}
        : {present:false},
      receipt:{present:p.receipt_present === true},
      ledger:{truncated:ledger.length > 100,entries:ledger.slice(0,100).map(r => ({
        entryType:code(r.entry_type),recipientType:code(r.recipient_type),amountMinor:minor(r.amount_minor),
      }))},
      settlements:{truncated:settlements.length > 2,records:settlements.slice(0,2).map(r => ({
        kind:code(r.kind),status:code(r.status),expectedMinor:minor(r.expected_amount_minor),
        observedMinor:minor(r.observed_amount_minor),providerRecordPresent:r.provider_record_present === true,
      })),actualBankDelivery:"NOT_ESTABLISHED_BY_TEST_RECORDS"},
      webhook:{outcome:"UNKNOWN",durableCorrelatedDeliveryEvidence:false,
        persistedSignedVerificationUncertainty:p.failure_code === "SIGNED_WEBHOOK_PROVIDER_VERIFICATION_UNCERTAIN",
        note:"Payment finalization is shared with browser returns; payment status is not webhook delivery proof."},
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError(503,"LOCAL_PAYMENT_DIAGNOSTIC_UNAVAILABLE");
  } finally { db.release(); }
}
