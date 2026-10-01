import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  PaymentProviderError,
  type ExpectedPayment,
  type VerifiedPayment,
} from "../lib/fee-providers";
import { configuredTestAdapter, type ConfigurableFeeProvider } from "../lib/fee-providers/factory";
import { invoiceStatus } from "./finance-money";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import {
  enqueueFinancePaymentNotificationsSafely,
  FinanceNotificationSettlementSafetyError,
} from "./finance-notifications-service";

const router: IRouter = Router();
const providerForRoute = (value: string): ConfigurableFeeProvider | null => {
  const normalized = value.toUpperCase();
  return normalized === "PAYSTACK" || normalized === "FLUTTERWAVE" ? normalized : null;
};

router.post("/:provider", async (req: Request, res: Response): Promise<void> => {
  const pathProvider = req.params.provider;
  const provider = providerForRoute(Array.isArray(pathProvider) ? pathProvider[0] ?? "" : pathProvider ?? "");
  if (!provider) {
    res.status(404).json({ error: "Payment provider webhook not found" });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody || rawBody.length === 0 || rawBody.length > 65_536) {
    res.status(400).json({ error: "Webhook body is invalid" });
    return;
  }
  let adapter: ReturnType<typeof configuredTestAdapter>;
  try {
    adapter = configuredTestAdapter(provider);
  } catch {
    res.status(503).json({ error: "Payment provider test credentials are unavailable" });
    return;
  }
  if (!adapter) {
    res.status(503).json({ error: "Payment provider test credentials are unavailable" });
    return;
  }
  try {
    const result = await adapter.handleWebhook({
      rawBody,
      headers: req.headers,
      resolveExpectedPayment: async (reference: string): Promise<ExpectedPayment | null> => {
        const found = await pool.query(
          `SELECT reference,amount_minor AS "amountMinor",currency
           FROM fee_payments WHERE reference=$1 AND provider=$2`,
          [reference, provider],
        );
        return found.rows[0] ?? null;
      },
    });
    const settlement = await settleVerifiedPayment(provider, result.eventId, result.payment, rawBody);
    res.status(200).json({
      received: true,
      outcome: settlement,
    });
  } catch (error) {
    if (error instanceof FinanceNotificationSettlementSafetyError) {
      try {
        await persistReconciliationFailure(provider, rawBody, error.message);
        res.status(202).json({ received: true, outcome: "reconciliation_required" });
      } catch {
        res.status(500).json({ error: "Webhook processing failed; reconciliation marker could not be persisted" });
      }
      return;
    }
    if (error instanceof PaymentProviderError && error.signatureVerified) {
      await persistReconciliationFailure(provider, rawBody, error.message);
      res.status(202).json({ received: true, outcome: "reconciliation_required" });
      return;
    }
    if (error instanceof PaymentProviderError) {
      res.status(401).json({ error: "Webhook verification failed" });
      return;
    }
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

type SettlementOutcome = "verified" | "pending" | "failed" | "duplicate" | "reconciliation_required";

export async function settleVerifiedPayment(
  provider: ConfigurableFeeProvider,
  eventId: string,
  providerPayment: Readonly<VerifiedPayment>,
  rawBody: Buffer,
  source: "SIGNED_WEBHOOK" | "ADMIN_RECONCILIATION" = "SIGNED_WEBHOOK",
): Promise<SettlementOutcome> {
  const client = await pool.connect();
  const parsedEvent = extractWebhookFields(rawBody);
  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  try {
    await client.query("BEGIN");
    const insertedEvent = await client.query(
      `INSERT INTO fee_provider_webhook_events
        (provider,event_id,provider_reference,webhook_transaction_id,verified_transaction_id,status,
         signature_verified,payload_sha256)
       VALUES ($1,$2,$3,$4,$5,'RECEIVED',$7,$6)
       ON CONFLICT (provider,event_id) DO NOTHING RETURNING id`,
      [provider, eventId, providerPayment.reference, parsedEvent.transactionId, providerPayment.providerTransactionId,
        payloadSha256, source === "SIGNED_WEBHOOK"],
    );
    if (!insertedEvent.rows[0]) {
      const existing = await client.query(
        `SELECT status FROM fee_provider_webhook_events WHERE provider=$1 AND event_id=$2 FOR UPDATE`,
        [provider, eventId],
      );
      if (existing.rows[0]?.status === "VERIFIED") {
        await client.query("COMMIT");
        return "duplicate";
      }
      await client.query(
        `UPDATE fee_provider_webhook_events SET status='RECEIVED',error_message=NULL,
           verified_transaction_id=$3,resolved_at=NULL,updated_at=NOW()
         WHERE provider=$1 AND event_id=$2`,
        [provider, eventId, providerPayment.providerTransactionId],
      );
    }
    const rows = await client.query(
      `SELECT p.*,i.total_minor,i.paid_minor,i.outstanding_minor,i.currency AS invoice_currency,i.status AS invoice_status,
          i.invoice_number,i.student_name_snapshot,i.admission_no_snapshot,i.class_name_snapshot,
          i.academic_session_id,i.academic_term_id,i.student_id AS invoice_student_id,
           cs.provider AS session_provider,cs.reference AS session_reference,cs.state AS session_state,
           s.name AS school_name,s.logo AS school_logo,l.id AS school_logo_version_id,
           pa.name AS payer_name
       FROM fee_payments p
       JOIN fee_provider_checkout_sessions cs ON cs.payment_id=p.id AND cs.school_id=p.school_id
       JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
       JOIN schools s ON s.id=p.school_id
        LEFT JOIN school_branding_logos l ON l.school_id=s.id AND l.is_current=true
       LEFT JOIN parents pa ON pa.id=p.parent_id AND pa.school_id=p.school_id
       WHERE p.reference=$1 AND p.provider=$2
        FOR UPDATE OF p,i,cs`,
      [providerPayment.reference, provider],
    );
    const payment = rows.rows[0];
    const eventFields = [provider, eventId];
    if (!payment) {
      await markEventForReconciliation(client, eventFields, "No payment matches the provider reference", parsedEvent);
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    const exactMatch = payment.method === provider
      && payment.provider === provider
      && payment.reference === providerPayment.reference
      && payment.session_provider === provider
      && payment.session_reference === providerPayment.reference
      && Number(payment.amount_minor) === providerPayment.amountMinor
      && payment.currency === providerPayment.currency
      && payment.invoice_currency === providerPayment.currency
      && Number(payment.invoice_student_id) === Number(payment.student_id)
      && payment.school_id !== null
      && payment.invoice_id !== null
      && (!payment.provider_transaction_id
        || payment.provider_transaction_id === providerPayment.providerTransactionId);
    if (!exactMatch) {
      await markEventForReconciliation(client, eventFields, "Provider payment does not match the persisted payment", parsedEvent, payment);
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    const transactionOwner = await client.query(
      `SELECT id FROM fee_payments
       WHERE provider=$1 AND provider_transaction_id=$2 AND id<>$3`,
      [provider, providerPayment.providerTransactionId, payment.id],
    );
    if (transactionOwner.rows[0]) {
      await markEventForReconciliation(
        client, eventFields, "Provider transaction is already assigned to another payment", parsedEvent, payment,
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    if (payment.session_state === "RELEASED" && source !== "ADMIN_RECONCILIATION") {
      await markEventForReconciliation(
        client, eventFields, "Late provider success arrived after the checkout reservation was released",
        parsedEvent, payment,
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    if (payment.status === "VERIFIED") {
      await client.query(
        `UPDATE fee_provider_webhook_events SET status='VERIFIED',payment_id=$3,school_id=$4,
           resolved_at=COALESCE(resolved_at,NOW()),updated_at=NOW()
         WHERE provider=$1 AND event_id=$2`,
        [provider, eventId, payment.id, payment.school_id],
      );
      await client.query("COMMIT");
      return "duplicate";
    }
    if (payment.status !== "PENDING" && payment.status !== "PROCESSING" && payment.status !== "FAILED") {
      await markEventForReconciliation(client, eventFields, "Payment is not in a settleable state", parsedEvent, payment);
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    if (payment.status === "FAILED" && providerPayment.status === "pending") {
      await markEventForReconciliation(
        client, eventFields, "Provider reported pending after this payment was terminally failed", parsedEvent, payment,
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    // A signed, independently verified provider callback proves checkout was
    // initiated even if it races the route that persists INITIALIZING -> READY.
    // READY sessions already enqueue this event atomically with that transition.
    if (payment.session_state === "INITIALIZING") {
      await enqueueFinancePaymentNotificationsSafely(
        client, Number(payment.id), Number(payment.school_id), "PROVIDER_CHECKOUT_INITIATED",
        { provider },
      );
    }
    if (providerPayment.status === "pending") {
      const processingPayment = await client.query(
        `UPDATE fee_payments SET status='PROCESSING'
         WHERE id=$1 AND school_id=$2 AND status IN ('PENDING','PROCESSING')
         RETURNING id`,
        [payment.id, payment.school_id],
      );
      if (processingPayment.rows[0]) {
        await enqueueFinancePaymentNotificationsSafely(
          client, Number(payment.id), Number(payment.school_id), "PROVIDER_CHECKOUT_PROCESSING",
        );
      }
      await client.query(
        `UPDATE fee_provider_webhook_events SET status='PENDING',payment_id=$3,school_id=$4,
           updated_at=NOW() WHERE provider=$1 AND event_id=$2`,
        [provider, eventId, payment.id, payment.school_id],
      );
      await client.query("COMMIT");
      return "pending";
    }
    if (providerPayment.status === "failed") {
      await client.query(
        `UPDATE fee_payments SET status='FAILED',provider_transaction_id=$1
         WHERE id=$2 AND school_id=$3 AND status IN ('PENDING','PROCESSING','FAILED')
         RETURNING id`,
        [providerPayment.providerTransactionId, payment.id, payment.school_id],
      );
      await client.query(
        `UPDATE fee_provider_checkout_sessions SET state='FAILED',claim_token=NULL,claim_expires_at=NULL,
            last_error='Provider confirmed terminal failure',updated_at=NOW()
         WHERE payment_id=$1 AND school_id=$2 AND state IN ('INITIALIZING','READY','FAILED')`,
        [payment.id, payment.school_id],
      );
      await enqueueFinancePaymentNotificationsSafely(
        client, Number(payment.id), Number(payment.school_id), "PROVIDER_PAYMENT_FAILED",
      );
      await client.query(
        `UPDATE fee_provider_webhook_events SET status='FAILED',payment_id=$3,school_id=$4,
           resolved_at=NOW(),updated_at=NOW() WHERE provider=$1 AND event_id=$2`,
        [provider, eventId, payment.id, payment.school_id],
      );
      await client.query("COMMIT");
      return "failed";
    }
    if (payment.invoice_status === "CANCELLED" || payment.invoice_status === "PAID"
        || Number(payment.outstanding_minor) < providerPayment.amountMinor) {
      await markEventForReconciliation(client, eventFields, "Verified amount exceeds current invoice outstanding balance", parsedEvent, payment);
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    const nextPaid = Number(payment.paid_minor) + providerPayment.amountMinor;
    const nextOutstanding = Number(payment.total_minor) - nextPaid;
    const receiptNumber = `RCP-${payment.school_id}-${String(payment.id).padStart(8, "0")}`;
    const receiptSnapshot = {
      invoiceId: payment.invoice_id,
      schoolId: payment.school_id,
      studentId: payment.student_id,
      schoolName: payment.school_name,
      schoolLogo: payment.school_logo_version_id
        ? canonicalSchoolLogoVersionUrl(Number(payment.school_id), Number(payment.school_logo_version_id))
        : payment.school_logo,
      schoolLogoVersionId: payment.school_logo_version_id ?? null,
      invoiceNumber: payment.invoice_number,
      studentName: payment.student_name_snapshot,
      admissionNo: payment.admission_no_snapshot,
      className: payment.class_name_snapshot,
      sessionId: payment.academic_session_id,
      termId: payment.academic_term_id,
      payerName: payment.payer_name,
      paymentReference: payment.reference,
      amountMinor: providerPayment.amountMinor,
      currency: providerPayment.currency,
      previousBalanceMinor: payment.outstanding_minor,
      remainingBalanceMinor: nextOutstanding,
      status: "VERIFIED",
      method: payment.method,
      provider,
    };
    await client.query(
      `INSERT INTO fee_receipts (school_id,payment_id,invoice_id,receipt_number,snapshot)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payment_id) DO NOTHING`,
      [payment.school_id, payment.id, payment.invoice_id, receiptNumber, receiptSnapshot],
    );
    const receipt = await client.query(
      `SELECT school_id,payment_id,invoice_id,receipt_number,snapshot
       FROM fee_receipts WHERE payment_id=$1 FOR UPDATE`,
      [payment.id],
    );
    const existingReceipt = receipt.rows[0];
    if (!existingReceipt || !receiptMatchesCanonicalPayment(
      existingReceipt, payment, receiptNumber, receiptSnapshot,
    )) {
      const message = "Existing receipt does not match the verified payment";
      await markEventForReconciliation(client, eventFields, message, parsedEvent, payment);
      await client.query(
        `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
         VALUES ('Payment provider verification','SYSTEM',$1,'receipt mismatch requires reconciliation',
          'Finance',$2,'info',$3,'RECONCILIATION_REQUIRED',$4)`,
        [payment.school_id, payment.id,
          source === "SIGNED_WEBHOOK" ? "PAYMENT_PROVIDER_WEBHOOK" : "PAYMENT_PROVIDER_RECONCILIATION",
          { provider, eventId, reference: payment.reference, receiptNumber: existingReceipt?.receipt_number ?? null }],
      );
      await client.query("COMMIT");
      return "reconciliation_required";
    }
    const receiptNumberForAudit = existingReceipt.receipt_number;
    await client.query(
      `UPDATE fee_payments SET status='VERIFIED',provider_transaction_id=$1,verified_at=NOW(),
         provider_metadata=COALESCE(provider_metadata,'{}'::jsonb) || $2::jsonb
       WHERE id=$3 AND school_id=$4 AND status IN ('PENDING','PROCESSING','FAILED')`,
      [providerPayment.providerTransactionId, JSON.stringify({
        providerEventId: eventId,
        paidAt: providerPayment.paidAt ?? null,
        reference: providerPayment.reference,
      }), payment.id, payment.school_id],
    );
    await client.query(
      `UPDATE fee_invoices SET paid_minor=$1,outstanding_minor=$2,status=$3
       WHERE id=$4 AND school_id=$5`,
      [nextPaid, nextOutstanding, invoiceStatus(nextPaid, Number(payment.total_minor)), payment.invoice_id, payment.school_id],
    );
    const settlableStates = source === "ADMIN_RECONCILIATION"
      ? "('INITIALIZING','READY','FAILED','RELEASED')"
      : "('INITIALIZING','READY','FAILED')";
    const settledSession = await client.query(
      `UPDATE fee_provider_checkout_sessions SET state='SETTLED',claim_token=NULL,claim_expires_at=NULL,updated_at=NOW()
       WHERE payment_id=$1 AND school_id=$2 AND state IN ${settlableStates}
       RETURNING payment_id`,
      [payment.id, payment.school_id],
    );
    if (!settledSession.rows[0]) throw new Error("Verified payment checkout session integrity failure");
    await enqueueFinancePaymentNotificationsSafely(client, Number(payment.id), Number(payment.school_id), "PAYMENT_VERIFIED");
    await client.query(
      `UPDATE fee_provider_webhook_events SET status='VERIFIED',payment_id=$3,school_id=$4,
          resolved_at=NOW(),updated_at=NOW(),error_message=NULL
       WHERE provider=$1 AND event_id=$2`,
      [provider, eventId, payment.id, payment.school_id],
    );
    const auditAction = source === "SIGNED_WEBHOOK" ? "verified online fee payment" : "reconciled online fee payment";
    const auditEventType = source === "SIGNED_WEBHOOK" ? "PAYMENT_PROVIDER_WEBHOOK" : "PAYMENT_PROVIDER_RECONCILIATION";
    await client.query(
      `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES ('Payment provider verification','SYSTEM',$1,$3,'Finance',$2,
         'info',$4,'SUCCESS',$5)`,
      [payment.school_id, payment.id, auditAction, auditEventType, {
        provider, eventId, reference: payment.reference, amountMinor: providerPayment.amountMinor,
        currency: providerPayment.currency, receiptNumber: receiptNumberForAudit,
      }],
    );
    await client.query(
      `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES ('Payment provider verification','SYSTEM',$1,'generated fee receipt','Finance',$2,
         'info',$3,'SUCCESS',$4)`,
      [payment.school_id, payment.id, auditEventType, { provider, eventId, receiptNumber: receiptNumberForAudit }],
    );
    await client.query("COMMIT");
    return "verified";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function receiptMatchesCanonicalPayment(
  receipt: Record<string, any>,
  payment: Record<string, any>,
  receiptNumber: string,
  receiptSnapshot: Record<string, unknown>,
): boolean {
  return Number(receipt.payment_id) === Number(payment.id)
    && Number(receipt.invoice_id) === Number(payment.invoice_id)
    && Number(receipt.school_id) === Number(payment.school_id)
    && receipt.receipt_number === receiptNumber
    && canonicalJson(receipt.snapshot) === canonicalJson(receiptSnapshot);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function markEventForReconciliation(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  eventKey: unknown[],
  message: string,
  eventFields: { reference: string | null; transactionId: string | null },
  payment?: Record<string, any>,
) {
  await client.query(
    `UPDATE fee_provider_webhook_events SET status='RECONCILIATION_REQUIRED',
       payment_id=$3,school_id=$4,provider_reference=COALESCE(provider_reference,$5),
       webhook_transaction_id=COALESCE(webhook_transaction_id,$6),
       error_message=$7,updated_at=NOW()
     WHERE provider=$1 AND event_id=$2`,
    [eventKey[0], eventKey[1], payment?.id ?? null, payment?.school_id ?? null,
      eventFields.reference, eventFields.transactionId, message.slice(0, 300)],
  );
}

async function persistReconciliationFailure(provider: ConfigurableFeeProvider, rawBody: Buffer, message: string) {
  const fields = extractWebhookFields(rawBody);
  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  const eventId = fields.transactionId
    ? `${provider.toLowerCase()}:${fields.transactionId}`
    : `${provider.toLowerCase()}:invalid:${payloadSha256}`;
  let payment: { id: number; school_id: number } | undefined;
  if (fields.reference) {
    const found = await pool.query(
      `SELECT id,school_id FROM fee_payments WHERE reference=$1 AND provider=$2`,
      [fields.reference, provider],
    );
    payment = found.rows[0];
  }
  await pool.query(
    `INSERT INTO fee_provider_webhook_events
       (provider,event_id,payment_id,school_id,provider_reference,webhook_transaction_id,status,
        signature_verified,payload_sha256,error_message)
     VALUES ($1,$2,$3,$4,$5,$6,'RECONCILIATION_REQUIRED',true,$7,$8)
     ON CONFLICT (provider,event_id) DO UPDATE SET
       status=CASE WHEN fee_provider_webhook_events.status='VERIFIED'
         THEN 'VERIFIED' ELSE 'RECONCILIATION_REQUIRED' END,
       error_message=CASE WHEN fee_provider_webhook_events.status='VERIFIED'
         THEN NULL ELSE EXCLUDED.error_message END,
       updated_at=NOW()`,
    [provider, eventId, payment?.id ?? null, payment?.school_id ?? null, fields.reference,
      fields.transactionId, payloadSha256, message.slice(0, 300)],
  );
}

export async function retryReconciliationEvent(schoolId: number, eventId: string): Promise<SettlementOutcome> {
  const found = await pool.query(
    `SELECT e.provider,e.event_id,e.webhook_transaction_id,p.reference,p.amount_minor AS "amountMinor",
        p.currency,p.school_id
     FROM fee_provider_webhook_events e
     JOIN fee_payments p ON p.id=e.payment_id AND p.school_id=e.school_id
     WHERE e.school_id=$1 AND e.event_id=$2 AND e.status='RECONCILIATION_REQUIRED'
       AND e.signature_verified=true`,
    [schoolId, eventId],
  );
  const row = found.rows[0];
  if (!row || !row.webhook_transaction_id) {
    throw new Error("Reconciliation event cannot be safely retried");
  }
  const provider = row.provider as ConfigurableFeeProvider;
  let adapter: ReturnType<typeof configuredTestAdapter>;
  try {
    adapter = configuredTestAdapter(provider);
  } catch {
    throw new Error("Provider test credentials are unavailable");
  }
  if (!adapter) throw new Error("Provider test credentials are unavailable");
  const verified = await adapter.verifyPayment({
    reference: row.reference,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    providerTransactionId: row.webhook_transaction_id,
  });
  if (`${provider.toLowerCase()}:${verified.providerTransactionId}` !== eventId) {
    throw new Error("Verified provider transaction does not match the reconciliation event");
  }
  return settleVerifiedPayment(provider, eventId, verified, Buffer.alloc(0));
}

function extractWebhookFields(rawBody: Buffer): { reference: string | null; transactionId: string | null } {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object") return { reference: null, transactionId: null };
    const data = (parsed as Record<string, unknown>).data;
    if (!data || typeof data !== "object") return { reference: null, transactionId: null };
    const object = data as Record<string, unknown>;
    const reference = typeof object.reference === "string"
      ? object.reference
      : typeof object.tx_ref === "string" ? object.tx_ref : null;
    const id = object.id;
    const transactionId = normalizeWebhookTransactionId(id);
    return {
      reference: reference && reference.length <= 100 ? reference : null,
      transactionId,
    };
  } catch {
    return { reference: null, transactionId: null };
  }
}

function normalizeWebhookTransactionId(id: unknown): string | null {
  if ((typeof id !== "string" && typeof id !== "number")
      || (typeof id === "number" && !Number.isSafeInteger(id))) return null;
  const value = String(id);
  if (!/^[0-9]{1,32}$/.test(value)) return null;
  const numeric = BigInt(value);
  return numeric > 0n && numeric <= BigInt(Number.MAX_SAFE_INTEGER) ? numeric.toString() : null;
}

export default router;