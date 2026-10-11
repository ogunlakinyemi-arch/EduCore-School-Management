import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { configuredStudentNfcTestAdapter } from "../lib/fee-providers/factory";
import { PaymentProviderError } from "../lib/fee-providers";
import { configuredStudentSubscriptionCheckoutBaseUrl } from "../lib/student-subscription-return-url";
import { ensureStudentNfcSubscription } from "../lib/student-nfc-obligations";
import {
  findStudentSubscriptionTermPaymentConflict, finalizeVerifiedStudentSubscriptionPayment,
} from "../lib/student-subscription-billing";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import {
  nfcLinkStatus, nfcLinkTokenHash, publicLinkSql, publicNfcLink, requireNfcLinkDevelopment,
} from "./nfc-payment-links";

function adapterForGuest() {
  requireNfcLinkDevelopment();
  try {
    const adapter = configuredStudentNfcTestAdapter();
    if (!adapter || !process.env.FLUTTERWAVE_WEBHOOK_VERIF_HASH
        || !configuredStudentSubscriptionCheckoutBaseUrl()) throw new Error();
    return adapter;
  } catch {
    throw new AuthError(503, "Flutterwave TEST checkout configuration is unavailable");
  }
}

export async function readGuestNfcLink(token: string) {
  requireNfcLinkDevelopment();
  const row = (await pool.query(publicLinkSql, [nfcLinkTokenHash(token)])).rows[0];
  if (!row) throw new AuthError(404, "Invalid payment link");
  return row;
}

function payableLink(row: any) {
  if (row.mode !== "FLUTTERWAVE_SANDBOX" || nfcLinkStatus(row) !== "PENDING") {
    throw new AuthError(409, "This TEST payment link is not available for checkout");
  }
}

/**
 * Shared with the authenticated NFC checkout: one persisted reservation,
 * one provider POST, and fail-closed reconciliation on an uncertain response.
 * No subaccounts, transfers or automatic split parameters are supplied.
 */
export async function initializeStudentNfcHostedCheckout(
  payment: any, email: string, returnUrl: string, persistCheckout = true,
) {
  const adapter = configuredStudentNfcTestAdapter();
  if (!adapter) throw new PaymentProviderError("Flutterwave TEST configuration is unavailable");
  try {
    const checkout = await adapter.initializePayment({
      reference: payment.reference,
      amountMinor: Number(payment.grossAmountMinor),
      currency: String(payment.currency), email, returnUrl,
    });
    if (checkout.reference !== payment.reference) throw new PaymentProviderError("Checkout reference mismatch");
    const saved = persistCheckout ? await pool.query(
      `UPDATE student_subscription_payments SET checkout_url=$1,updated_at=NOW()
        WHERE id=$2 AND status='PENDING' RETURNING id`,
      [checkout.checkoutUrl, payment.paymentId],
    ) : { rows: [{ id: payment.paymentId }] };
    if (!saved.rows[0]) throw new PaymentProviderError("Checkout changed state during initialization");
    return checkout;
  } catch {
    if (persistCheckout) await pool.query(
      `UPDATE student_subscription_payments
          SET status='RECONCILIATION_REQUIRED',reconciliation_status='RECONCILIATION_REQUIRED',
              failure_code='CHECKOUT_INITIALIZATION_OUTCOME_UNKNOWN',updated_at=NOW()
        WHERE id=$1 AND status='PENDING'`,
      [payment.paymentId],
    );
    return null;
  }
}

export async function createGuestNfcCheckout(token: string, email: string) {
  const adapter = adapterForGuest();
  const first = await readGuestNfcLink(token);
  payableLink(first);
  const db = await pool.connect();
  let payment: any = null;
  let initialize = false;
  try {
    await db.query("BEGIN");
    // Match authenticated checkout lock order: subscription/student, then payment.
    const sub = (await db.query(
      `SELECT sub.amount,sub.status,sub.verification_status,sub.provider_reference
         FROM subscriptions sub JOIN students st
           ON st.id=sub.student_id AND st.school_id=sub.school_id
        WHERE sub.id=$1 AND sub.school_id=$2 AND sub.student_id=$3 AND upper(st.status)='ACTIVE'
        FOR NO KEY UPDATE OF sub,st`,
      [first.subscription_id, first.school_id, first.student_id],
    )).rows[0];
    const row = (await db.query(`${publicLinkSql} FOR UPDATE OF l`, [nfcLinkTokenHash(token)])).rows[0];
    if (!row) throw new AuthError(404, "Invalid payment link");
    payableLink(row);
    if (!sub || Number(sub.amount) !== 5000 || sub.provider_reference
        || ["active", "waived"].includes(String(sub.status).toLowerCase())
        || String(sub.verification_status).toLowerCase() === "verified"
        || row.subscription_id !== first.subscription_id || row.school_id !== first.school_id
        || row.student_id !== first.student_id || row.academic_term_id !== first.academic_term_id
        || row.academic_session_id !== first.academic_session_id) {
      throw new AuthError(409, "The bound NFC subscription is not eligible for checkout");
    }
    if (row.payment_id) {
      // The joined public row already proves the exact school/student/session/term binding.
      if (!row.paymentReference) throw new AuthError(409, "The existing payment requires review");
    } else {
      const current = (await db.query(
        `SELECT t.id FROM academic_terms t JOIN academic_sessions ses
           ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
          WHERE t.id=$1 AND ses.id=$2 AND t.school_id=$3 AND t.is_current AND ses.is_current
            AND upper(t.status)='ACTIVE' AND upper(ses.status)='ACTIVE'
            AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE FOR SHARE OF t,ses`,
        [row.academic_term_id, row.academic_session_id, row.school_id],
      )).rows[0];
      if (!current) throw new AuthError(409, "Checkout requires the bound active current term");
      const conflict = await findStudentSubscriptionTermPaymentConflict(db, {
        schoolId: Number(row.school_id), studentId: Number(row.student_id),
        sessionId: Number(row.academic_session_id), termId: Number(row.academic_term_id),
      });
      if (conflict) throw new AuthError(409, "An existing term payment must be completed or reconciled");
      const canonical = await ensureStudentNfcSubscription(
        db, Number(row.school_id), Number(row.student_id),
        Number(row.academic_session_id), Number(row.academic_term_id),
      );
      if (!canonical || Number(canonical.subscriptionId) !== Number(row.subscription_id)) {
        throw new AuthError(409, "The authoritative NFC obligation requires review");
      }
      payment = (await db.query(
        `INSERT INTO student_subscription_payments
          (subscription_id,school_id,student_id,academic_session_id,academic_term_id,payer_user_id,
           provider,provider_mode,reference,idempotency_key,gross_amount_minor,currency)
         VALUES($1,$2,$3,$4,$5,$6,'FLUTTERWAVE','SANDBOX',$7,$8,500000,'NGN')
         RETURNING id AS "paymentId",reference,gross_amount_minor AS "grossAmountMinor",currency`,
        [row.subscription_id, row.school_id, row.student_id, row.academic_session_id, row.academic_term_id,
          row.created_by, adapter.generateReference(), `guest:${row.reference}`],
      )).rows[0];
      // The issuing account is the internal audit actor; the guest is not impersonated as that account.
      await db.query("UPDATE nfc_payment_links SET payment_id=$1,updated_at=NOW() WHERE id=$2",
        [payment.paymentId, row.id]);
      initialize = true;
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
  if (initialize) {
    const base = configuredStudentSubscriptionCheckoutBaseUrl()!;
    const callback = new URL(`${base.replace(/\/$/, "")}/nfc/pay`);
    // Fragment keeps the bearer token out of server query/access logs.
    callback.hash = token;
    await initializeStudentNfcHostedCheckout(payment, email, callback.toString());
  }
  return publicNfcLink(await readGuestNfcLink(token));
}

export async function verifyGuestNfcCheckout(token: string) {
  const adapter = adapterForGuest();
  const row = await readGuestNfcLink(token);
  if (row.mode !== "FLUTTERWAVE_SANDBOX") throw new AuthError(409, "A simulation cannot be verified as payment");
  if (nfcLinkStatus(row) === "PAID") return publicNfcLink(row);
  if (["EXPIRED", "CANCELLED"].includes(nfcLinkStatus(row))) {
    throw new AuthError(409, "This payment link is no longer available");
  }
  if (!row.payment_id || !row.paymentReference) throw new AuthError(409, "No bound checkout has been initialized");
  const expected = (await pool.query(
    `SELECT id,reference,gross_amount_minor,currency FROM student_subscription_payments
      WHERE id=$1 AND subscription_id=$2 AND school_id=$3 AND student_id=$4
        AND academic_session_id=$5 AND academic_term_id=$6
        AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX'`,
    [row.payment_id, row.subscription_id, row.school_id, row.student_id,
      row.academic_session_id, row.academic_term_id],
  )).rows[0];
  if (!expected) throw new AuthError(409, "The existing checkout requires review");
  let verified;
  try {
    // No transaction ID, amount or success flag supplied by the browser is trusted.
    verified = await adapter.verifyCheckoutStatus({
      reference: expected.reference, amountMinor: Number(expected.gross_amount_minor), currency: expected.currency,
    });
  } catch {
    // No match yet or transient verification failures are not evidence of success/failure.
    throw new AuthError(409, "Flutterwave has not yet verified this payment. Retry status checking later.");
  }
  await finalizeVerifiedStudentSubscriptionPayment(pool, Number(expected.id), verified, canonicalSchoolLogoVersionUrl);
  return publicNfcLink(await readGuestNfcLink(token));
}
