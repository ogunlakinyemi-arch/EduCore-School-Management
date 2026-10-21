import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { holdSignedDeferredAdverseEvent } from "../services/deferred-commission-adverse-events";
import { PaymentProviderError, type ExpectedPayment } from "../lib/fee-providers";
import { configuredStudentNfcTestAdapter } from "../lib/fee-providers/factory";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import { finalizeVerifiedStudentSubscriptionPayment } from "../lib/student-subscription-billing";

export const studentSubscriptionFlutterwaveWebhookRouter: IRouter = Router();

type SignedWebhookIdentity = {
  eventId: string;
  eventName: string | null;
  eventStatus: string | null;
  reference: string | null;
  transactionId: string | null;
  payloadSha256: string;
};

function signedWebhookIdentity(rawBody: Buffer): SignedWebhookIdentity {
  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  try {
    const event: unknown = JSON.parse(rawBody.toString("utf8"));
    if (typeof event !== "object" || event === null) throw new Error("Invalid event");
    const row = event as Record<string, unknown>;
    const data = typeof row.data === "object" && row.data !== null
      ? row.data as Record<string, unknown> : row;
    const eventName = typeof row.event === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(row.event)
      ? row.event : null;
    const eventStatus = typeof data.status === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(data.status)
      ? data.status.toLowerCase() : null;
    const rawReference = data.tx_ref ?? data.reference;
    const reference = typeof rawReference === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(rawReference)
      ? rawReference : null;
    const rawId = data.id ?? data.transaction_id ?? data.refund_id;
    const transactionId = (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0)
      ? String(rawId)
      : typeof rawId === "string" && /^[1-9][0-9]{0,15}$/.test(rawId) ? rawId : null;
    const eventId = transactionId
      ? `flutterwave:student-subscription:${eventName ?? "unknown"}:${transactionId}:${eventStatus ?? "unknown"}`
      : `flutterwave:student-subscription:payload:${payloadSha256}`;
    return { eventId, eventName, eventStatus, reference, transactionId, payloadSha256 };
  } catch {
    return {
      eventId: `flutterwave:student-subscription:payload:${payloadSha256}`,
      eventName: null, eventStatus: null, reference: null, transactionId: null, payloadSha256,
    };
  }
}

/** Store the signed delivery before provider verification; do not retain raw body bytes. */
async function persistWebhookReceipt(identity: SignedWebhookIdentity): Promise<{
  duplicate: boolean; conflict: boolean; heldForReconciliation?: boolean;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const school = identity.reference
      ? (await client.query(
        `SELECT school_id FROM student_subscription_payments
          WHERE reference=$1 AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX'`,
        [identity.reference],
      )).rows[0]
      : null;
    await client.query(
      `INSERT INTO fee_provider_webhook_events
        (provider,event_id,school_id,provider_reference,webhook_transaction_id,status,
         signature_verified,payload_sha256)
       VALUES('FLUTTERWAVE',$1,$2,$3,$4,'RECEIVED',true,$5)
       ON CONFLICT(provider,event_id) DO NOTHING`,
      [identity.eventId, school?.school_id ?? null, identity.reference, identity.transactionId, identity.payloadSha256],
    );
    const prior = (await client.query(
      `SELECT status,error_message,school_id,provider_reference,webhook_transaction_id,payload_sha256
         FROM fee_provider_webhook_events
        WHERE provider='FLUTTERWAVE' AND event_id=$1 FOR UPDATE`,
      [identity.eventId],
    )).rows[0];
    if (!prior) throw new Error("Webhook receipt was not durable");
    const conflict = prior.payload_sha256 !== identity.payloadSha256
      || prior.provider_reference !== identity.reference
      || prior.webhook_transaction_id !== identity.transactionId;
    if (conflict) {
      await client.query(
        `UPDATE fee_provider_webhook_events
            SET status='RECONCILIATION_REQUIRED',error_message='Signed delivery fingerprint conflicts with the stored event',
                resolved_at=NOW(),updated_at=NOW()
          WHERE provider='FLUTTERWAVE' AND event_id=$1`,
        [identity.eventId],
      );
      await client.query("COMMIT");
      return { duplicate: false, conflict: true };
    }
    if (prior.status === "RECONCILIATION_REQUIRED"
        && prior.error_message === "Signed adverse event held for reconciliation") {
      await client.query("COMMIT");
      return { duplicate: true, conflict: false, heldForReconciliation: true };
    }
    if (prior.status === "VERIFIED" || prior.status === "FAILED") {
      await client.query("COMMIT");
      return { duplicate: true, conflict: false };
    }
    await client.query(
      `UPDATE fee_provider_webhook_events SET status='RECEIVED',error_message=NULL,resolved_at=NULL,updated_at=NOW()
        WHERE provider='FLUTTERWAVE' AND event_id=$1`,
      [identity.eventId],
    );
    await client.query("COMMIT");
    return { duplicate: false, conflict: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateWebhookReceipt(
  identity: SignedWebhookIdentity,
  status: "VERIFIED" | "PENDING" | "FAILED" | "RECONCILIATION_REQUIRED",
  errorMessage: string | null,
  verifiedTransactionId: string | null = null,
): Promise<void> {
  const result = await pool.query(
    `UPDATE fee_provider_webhook_events
        SET status=$1,error_message=$2,verified_transaction_id=COALESCE($3,verified_transaction_id),
            resolved_at=CASE WHEN $1 IN ('VERIFIED','FAILED') THEN NOW() ELSE NULL END,updated_at=NOW()
      WHERE provider='FLUTTERWAVE' AND event_id=$4 AND signature_verified=true
      RETURNING id`,
    [status,errorMessage,verifiedTransactionId,identity.eventId],
  );
  if (!result.rows[0]) throw new Error("Signed webhook receipt could not be updated");
}

async function markWebhookPaymentUncertain(reference: string): Promise<void> {
  await pool.query(
    `UPDATE student_subscription_payments AS p
        SET status=CASE WHEN p.status='FAILED' AND EXISTS (
              SELECT 1 FROM student_subscription_payments other
               WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                 AND other.academic_session_id=p.academic_session_id
                 AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                 AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                   OR other.reconciliation_status='RECONCILIATION_REQUIRED')
            ) THEN p.status ELSE 'RECONCILIATION_REQUIRED' END,
            reconciliation_status=CASE WHEN p.status='FAILED' AND EXISTS (
              SELECT 1 FROM student_subscription_payments other
               WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                 AND other.academic_session_id=p.academic_session_id
                 AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                 AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                   OR other.reconciliation_status='RECONCILIATION_REQUIRED')
            ) THEN p.reconciliation_status ELSE 'RECONCILIATION_REQUIRED' END,
            failure_code='SIGNED_WEBHOOK_PROVIDER_VERIFICATION_UNCERTAIN',updated_at=NOW()
      WHERE p.reference=$1 AND p.provider='FLUTTERWAVE' AND p.provider_mode='SANDBOX' AND p.status<>'PAID'`,
    [reference],
  );
}

studentSubscriptionFlutterwaveWebhookRouter.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody || rawBody.length === 0 || rawBody.length > 65_536) {
      res.status(400).json({ error: "Webhook body is invalid" });
      return;
    }

    let adapter: ReturnType<typeof configuredStudentNfcTestAdapter>;
    try {
      adapter = configuredStudentNfcTestAdapter();
    } catch {
      res.status(503).json({ error: "Flutterwave sandbox verification is unavailable" });
      return;
    }
    if (!adapter || adapter.provider !== "flutterwave" || !adapter.authenticateWebhook) {
      res.status(503).json({ error: "Flutterwave sandbox verification is unavailable" });
      return;
    }

    try {
      adapter.authenticateWebhook(req.headers);
    } catch {
      res.status(401).json({ error: "Webhook verification failed" });
      return;
    }
    const identity = signedWebhookIdentity(rawBody);
    let receipt: { duplicate: boolean; conflict: boolean; heldForReconciliation?: boolean };
    try {
      receipt = await persistWebhookReceipt(identity);
    } catch {
      res.status(500).json({ error: "Signed webhook receipt could not be persisted" });
      return;
    }
    if (receipt.conflict) {
      res.status(202).json({ received: true, outcome: "reconciliation_required" });
      return;
    }
    if (receipt.duplicate) {
      res.status(200).json({
        received: true,
        outcome: receipt.heldForReconciliation ? "held_for_reconciliation" : "duplicate",
      });
      return;
    }

    let persistedPayment: any = null;
    try {
      const webhook = await adapter.handleWebhook({
        rawBody,
        headers: req.headers,
        resolveExpectedPayment: async (reference: string): Promise<ExpectedPayment | null> => {
          const result = await pool.query(
            `SELECT id AS "paymentId",subscription_id AS "subscriptionId",
                    school_id AS "schoolId",student_id AS "studentId",
                    academic_session_id AS "sessionId",academic_term_id AS "termId",
                    payer_user_id AS "payerUserId",reference,
                    gross_amount_minor AS "grossAmountMinor",currency
               FROM student_subscription_payments
              WHERE reference=$1 AND provider='FLUTTERWAVE' AND provider_mode='SANDBOX'`,
            [reference],
          );
          persistedPayment = result.rows[0] ?? null;
          if (!persistedPayment) return null;
          return {
            reference: String(persistedPayment.reference),
            amountMinor: Number(persistedPayment.grossAmountMinor),
            currency: String(persistedPayment.currency),
          };
        },
      });
      if (!persistedPayment || webhook.payment.reference !== persistedPayment.reference) {
        await updateWebhookReceipt(identity,"RECONCILIATION_REQUIRED","Signed provider event did not match a persisted TEST subscription payment");
        res.status(202).json({ received: true, outcome: "unmatched" });
        return;
      }
      const finalized = await finalizeVerifiedStudentSubscriptionPayment(
        pool,
        Number(persistedPayment.paymentId),
        webhook.payment,
        canonicalSchoolLogoVersionUrl,
      );
      const receiptStatus = finalized.status === "PAID" ? "VERIFIED"
        : finalized.status === "FAILED" ? "FAILED"
        : finalized.status === "PENDING" ? "PENDING" : "RECONCILIATION_REQUIRED";
      await updateWebhookReceipt(identity,receiptStatus,
        finalized.reconciliationRequired ? "Payment finalization requires reconciliation" : null,
        webhook.payment.providerTransactionId);
      const statusCode = finalized.status === "PENDING" || finalized.reconciliationRequired ? 202 : 200;
      res.status(statusCode).json({
        received: true,
        outcome: finalized.status.toLowerCase(),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError && error.signatureVerified) {
        let held = false;
        try { held = await holdSignedDeferredAdverseEvent(rawBody); }
        catch {
          res.status(500).json({error:"Adverse webhook hold could not be persisted"});return;
        }
        if (held) {
          try { await updateWebhookReceipt(identity,"RECONCILIATION_REQUIRED","Signed adverse event held for reconciliation"); }
          catch {
            res.status(500).json({error:"Adverse event hold was recorded but its webhook receipt could not be updated"});return;
          }
          // Flutterwave acknowledges only HTTP 200, not 202. The hold and audit
          // are durable; do not request retries for an already persisted event.
          res.status(200).json({received:true,outcome:"held_for_reconciliation"});return;
        }
        const reference = identity.reference;
        if (reference) {
          try {
            await markWebhookPaymentUncertain(reference);
          } catch {
            res.status(500).json({ error: "Webhook uncertainty could not be persisted" });
            return;
          }
        }
        try { await updateWebhookReceipt(identity,"RECONCILIATION_REQUIRED",error.message); }
        catch {
          res.status(500).json({error:"Webhook uncertainty could not be linked to its durable receipt"});
          return;
        }
        res.status(202).json({ received: true, outcome: "reconciliation_required" });
        return;
      }
      if (error instanceof PaymentProviderError) {
        res.status(401).json({ error: "Webhook verification failed" });
        return;
      }
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);