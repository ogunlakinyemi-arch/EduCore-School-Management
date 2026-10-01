import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { PaymentProviderError, type ExpectedPayment } from "../lib/fee-providers";
import { configuredTestAdapter } from "../lib/fee-providers/factory";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import { finalizeVerifiedStudentSubscriptionPayment } from "../lib/student-subscription-billing";

export const studentSubscriptionFlutterwaveWebhookRouter: IRouter = Router();

function signedReference(rawBody: Buffer): string | null {
  try {
    const event: unknown = JSON.parse(rawBody.toString("utf8"));
    if (typeof event !== "object" || event === null || !("data" in event)
        || !("event" in event) || event.event !== "charge.completed"
        || typeof event.data !== "object" || event.data === null || !("tx_ref" in event.data)
        || typeof event.data.tx_ref !== "string"
        || !/^[A-Za-z0-9_-]{8,100}$/.test(event.data.tx_ref)
        || !("id" in event.data)
        || !((typeof event.data.id === "number" && Number.isSafeInteger(event.data.id) && event.data.id > 0)
          || (typeof event.data.id === "string" && /^[1-9][0-9]{0,15}$/.test(event.data.id)))) {
      return null;
    }
    return event.data.tx_ref;
  } catch {
    return null;
  }
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

    let adapter: ReturnType<typeof configuredTestAdapter>;
    try {
      adapter = configuredTestAdapter("FLUTTERWAVE");
    } catch {
      res.status(503).json({ error: "Flutterwave sandbox verification is unavailable" });
      return;
    }
    if (!adapter || adapter.provider !== "flutterwave") {
      res.status(503).json({ error: "Flutterwave sandbox verification is unavailable" });
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
        res.status(202).json({ received: true, outcome: "unmatched" });
        return;
      }
      const finalized = await finalizeVerifiedStudentSubscriptionPayment(
        pool,
        Number(persistedPayment.paymentId),
        webhook.payment,
        canonicalSchoolLogoVersionUrl,
      );
      const statusCode = finalized.status === "PENDING" || finalized.reconciliationRequired ? 202 : 200;
      res.status(statusCode).json({
        received: true,
        outcome: finalized.status.toLowerCase(),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError && error.signatureVerified) {
        const reference = signedReference(rawBody);
        if (reference) {
          try {
            await markWebhookPaymentUncertain(reference);
          } catch {
            res.status(500).json({ error: "Webhook uncertainty could not be persisted" });
            return;
          }
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