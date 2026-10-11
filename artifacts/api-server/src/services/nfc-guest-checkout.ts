import { pool } from "@workspace/db";
import { nfcPayableTermPredicate } from "../lib/nfc-payable-term";
import { AuthError } from "../middlewares/auth";
import { configuredStudentNfcTestAdapter } from "../lib/fee-providers/factory";
import { PaymentProviderError } from "../lib/fee-providers";
import { configuredStudentSubscriptionCheckoutBaseUrl } from "../lib/student-subscription-return-url";
import { ensureStudentNfcSubscription } from "../lib/student-nfc-obligations";
import {
  findStudentSubscriptionTermPaymentConflict, finalizeVerifiedStudentSubscriptionPayment, type StudentSubscriptionSqlClient,
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

/** The existing isolation CHECK requires the payment reservation BEFORE the link. */
export async function reserveGuestNfcPayment(
  db: StudentSubscriptionSqlClient, scope: any, reference: string, issuingUserId: number,
) {
  const adapter = adapterForGuest();
  const sub = (await db.query(
    `SELECT sub.amount,sub.status,sub.verification_status,sub.provider_reference
       FROM subscriptions sub JOIN students st ON st.id=sub.student_id AND st.school_id=sub.school_id
      WHERE sub.id=$1 AND sub.school_id=$2 AND sub.student_id=$3 AND upper(st.status)='ACTIVE'
      FOR NO KEY UPDATE OF sub,st`,
    [scope.subscriptionId, scope.schoolId, scope.studentId],
  )).rows[0];
  if (!sub || Number(sub.amount) !== 5000 || sub.provider_reference
      || ["active", "waived"].includes(String(sub.status).toLowerCase())
      || String(sub.verification_status).toLowerCase() === "verified") {
    throw new AuthError(409, "The bound NFC subscription is not eligible for checkout");
  }
  const existing = await findStudentSubscriptionTermPaymentConflict(db, scope);
  if (existing) {
    if (Number(existing.subscriptionId) !== Number(scope.subscriptionId) || existing.status !== "PENDING") {
      throw new AuthError(409, "An existing term payment must be completed or reconciled");
    }
    const matching = (await db.query(
      `SELECT id FROM student_subscription_payments
        WHERE id=$1 AND subscription_id=$2 AND school_id=$3 AND student_id=$4
          AND academic_session_id=$5 AND academic_term_id=$6
          AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX'
          AND gross_amount_minor=500000 AND currency='NGN'
          AND status='PENDING' AND reconciliation_status<>'RECONCILIATION_REQUIRED' FOR UPDATE`,
      [existing.id, scope.subscriptionId, scope.schoolId, scope.studentId, scope.sessionId, scope.termId],
    )).rows[0];
    if (!matching) throw new AuthError(409, "The existing term payment is not a matching TEST checkout");
    return Number(existing.id);
  }
  const current = (await db.query(
    `SELECT t.id FROM academic_terms t JOIN academic_sessions ses
       ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
       WHERE t.id=$1 AND ses.id=$2 AND t.school_id=$3
         AND ${nfcPayableTermPredicate} FOR SHARE OF t,ses`,
    [scope.termId, scope.sessionId, scope.schoolId],
  )).rows[0];
  if (!current) throw new AuthError(409, "Checkout requires the bound active current term");
  const canonical = await ensureStudentNfcSubscription(
    db, Number(scope.schoolId), Number(scope.studentId), Number(scope.sessionId), Number(scope.termId),
  );
  if (!canonical || Number(canonical.subscriptionId) !== Number(scope.subscriptionId)) {
    throw new AuthError(409, "The authoritative NFC obligation requires review");
  }
  const payment = (await db.query(
    `INSERT INTO student_subscription_payments
      (subscription_id,school_id,student_id,academic_session_id,academic_term_id,payer_user_id,
       provider,provider_mode,reference,idempotency_key,gross_amount_minor,currency,failure_code)
     VALUES($1,$2,$3,$4,$5,$6,'FLUTTERWAVE','SANDBOX',$7,$8,500000,'NGN','GUEST_CHECKOUT_RESERVED')
     RETURNING id`,
    [scope.subscriptionId, scope.schoolId, scope.studentId, scope.sessionId, scope.termId,
      issuingUserId, adapter.generateReference(), `guest:${reference}`],
  )).rows[0];
  return Number(payment.id);
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
      `UPDATE student_subscription_payments SET checkout_url=$1,failure_code=NULL,updated_at=NOW()
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
  adapterForGuest();
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
    if (!row.payment_id || !row.paymentReference) throw new AuthError(409, "The existing payment requires review");
    payment = (await db.query(
      `SELECT id AS "paymentId",reference,gross_amount_minor AS "grossAmountMinor",currency,status,
              checkout_url AS "checkoutUrl",failure_code AS "failureCode"
         FROM student_subscription_payments WHERE id=$1 AND subscription_id=$2 AND school_id=$3
           AND student_id=$4 AND academic_session_id=$5 AND academic_term_id=$6
           AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX' FOR UPDATE`,
      [row.payment_id, row.subscription_id, row.school_id, row.student_id,
        row.academic_session_id, row.academic_term_id],
    )).rows[0];
    if (!payment || payment.status !== "PENDING" || Number(payment.grossAmountMinor) !== 500000 || payment.currency !== "NGN") {
      throw new AuthError(409, "The existing payment requires review");
    }
    if (!payment.checkoutUrl && payment.failureCode === "GUEST_CHECKOUT_RESERVED") {
      const current = (await db.query(
        `SELECT t.id FROM academic_terms t JOIN academic_sessions ses
           ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
           WHERE t.id=$1 AND ses.id=$2 AND t.school_id=$3
             AND ${nfcPayableTermPredicate} FOR SHARE OF t,ses`,
        [row.academic_term_id, row.academic_session_id, row.school_id],
      )).rows[0];
      if (!current) throw new AuthError(409, "Checkout requires the bound active current term");
      await db.query(
        "UPDATE student_subscription_payments SET failure_code='GUEST_CHECKOUT_INITIALIZING',updated_at=NOW() WHERE id=$1",
        [payment.paymentId],
      );
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
