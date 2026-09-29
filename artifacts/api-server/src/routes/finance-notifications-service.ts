import { logger } from "../lib/logger";
import { enqueueFinancePaymentCommunications } from "./finance-communication-service";

type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};
type ConnectableQueryClient = QueryClient & {
  connect: () => Promise<{ query: QueryClient["query"]; release: () => void }>;
};

export const financePaymentNotificationEvents = [
  "PAYMENT_VERIFIED",
  "PAYMENT_REJECTED",
  "PROVIDER_CHECKOUT_INITIATED",
  "PROVIDER_CHECKOUT_PROCESSING",
  "PROVIDER_PAYMENT_FAILED",
  "MANUAL_TRANSFER_SUBMITTED",
  "MANUAL_TRANSFER_APPROVED",
  "MANUAL_TRANSFER_REJECTED",
  "REFUND_APPROVED",
  "REVERSAL_APPROVED",
] as const;
export type FinancePaymentNotificationEvent = typeof financePaymentNotificationEvents[number];

const notificationEligibility = `(
  ($3='PAYMENT_VERIFIED' AND p.status='VERIFIED')
  OR ($3='PAYMENT_REJECTED' AND p.status='REJECTED')
  OR ($3='MANUAL_TRANSFER_SUBMITTED' AND p.method='BANK_TRANSFER' AND p.status='PENDING')
  OR ($3='MANUAL_TRANSFER_APPROVED' AND p.method='BANK_TRANSFER' AND p.status='VERIFIED')
  OR ($3='MANUAL_TRANSFER_REJECTED' AND p.method='BANK_TRANSFER' AND p.status='REJECTED')
  OR ($3='PROVIDER_CHECKOUT_INITIATED' AND p.provider IN ('PAYSTACK','FLUTTERWAVE')
    AND p.status IN ('PENDING','PROCESSING','FAILED','VERIFIED') AND EXISTS (
      SELECT 1 FROM fee_provider_checkout_sessions cs WHERE cs.payment_id=p.id
        AND cs.school_id=p.school_id
        AND cs.state IN ('INITIALIZING','READY','FAILED','SETTLED','RELEASED')
    ))
  OR ($3='PROVIDER_CHECKOUT_PROCESSING' AND p.provider IN ('PAYSTACK','FLUTTERWAVE')
    AND p.status='PROCESSING' AND EXISTS (
      SELECT 1 FROM fee_provider_checkout_sessions cs WHERE cs.payment_id=p.id
        AND cs.school_id=p.school_id AND cs.state IN ('INITIALIZING','READY','FAILED')
    ))
  OR ($3='PROVIDER_PAYMENT_FAILED' AND p.provider IN ('PAYSTACK','FLUTTERWAVE')
    AND p.status='FAILED' AND p.provider_transaction_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM fee_provider_checkout_sessions cs WHERE cs.payment_id=p.id
        AND cs.school_id=p.school_id AND cs.state IN ('INITIALIZING','READY','FAILED','RELEASED')
    ))
  OR ($3 IN ('REFUND_APPROVED','REVERSAL_APPROVED')
    AND p.status IN ('VERIFIED','REFUNDED','REVERSED')
    AND EXISTS (
      SELECT 1 FROM fee_refunds fr
      WHERE fr.id=$4 AND fr.payment_id=p.id AND fr.invoice_id=p.invoice_id
        AND fr.school_id=p.school_id AND fr.status='APPROVED'
        AND (($3='REFUND_APPROVED' AND fr.transaction_type='REFUND')
          OR ($3='REVERSAL_APPROVED' AND fr.transaction_type='REVERSAL'))
    ))
)`;

const notificationReferenceEligibility = `(
  ($3 IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED','PROVIDER_CHECKOUT_INITIATED',
      'PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED','MANUAL_TRANSFER_SUBMITTED',
      'MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED') AND $4=0)
  OR ($3 IN ('REFUND_APPROVED','REVERSAL_APPROVED') AND $4>0)
)`;

// An outbox row is created only after the strict state checks above succeed.
// During delivery retry, allow subsequent valid state transitions to occur
// without discarding the already-committed notification intent.
const notificationRetryEligibility = `(
  ($3 IN ('PAYMENT_VERIFIED','PAYMENT_REJECTED') AND p.status IN ('VERIFIED','REJECTED','REFUNDED','REVERSED'))
  OR ($3 IN ('MANUAL_TRANSFER_SUBMITTED','MANUAL_TRANSFER_APPROVED','MANUAL_TRANSFER_REJECTED')
    AND p.method='BANK_TRANSFER')
  OR ($3 IN ('PROVIDER_CHECKOUT_INITIATED','PROVIDER_CHECKOUT_PROCESSING','PROVIDER_PAYMENT_FAILED')
    AND p.provider IN ('PAYSTACK','FLUTTERWAVE')
    AND EXISTS (
      SELECT 1 FROM fee_provider_checkout_sessions cs
      WHERE cs.payment_id=p.id AND cs.school_id=p.school_id
    ))
  OR ($3 IN ('REFUND_APPROVED','REVERSAL_APPROVED')
    AND p.status IN ('VERIFIED','REFUNDED','REVERSED')
    AND EXISTS (
      SELECT 1 FROM fee_refunds fr
      WHERE fr.id=$4 AND fr.payment_id=p.id AND fr.invoice_id=p.invoice_id
        AND fr.school_id=p.school_id AND fr.status='APPROVED'
        AND (($3='REFUND_APPROVED' AND fr.transaction_type='REFUND')
          OR ($3='REVERSAL_APPROVED' AND fr.transaction_type='REVERSAL'))
    ))
)`;

export class FinanceNotificationSettlementSafetyError extends Error {
  constructor() {
    super("Finance notification intent or savepoint could not be safely persisted");
    this.name = "FinanceNotificationSettlementSafetyError";
  }
}

const SAFE_ERROR_CODE_CATEGORIES: Record<string, string> = {
  ECONNRESET: "network",
  ETIMEDOUT: "network",
  ECONNREFUSED: "network",
  EHOSTUNREACH: "network",
  ENETUNREACH: "network",
  ENOTFOUND: "network",
  EAI_AGAIN: "network",
  EPIPE: "network",
  "57P01": "database",
  "53300": "database",
};
const SAFE_PROVIDER_ERROR_NAMES = new Set(["ProviderError", "PaystackError", "FlutterwaveError", "AxiosError"]);

function safeErrorDiagnostics(error: unknown): { errorCategory: string; errorCode: string | null } {
  let name: unknown;
  let code: unknown;
  let isError = false;
  try {
    isError = error instanceof Error;
    if (error && (typeof error === "object" || typeof error === "function")) {
      name = (error as { name?: unknown }).name;
      code = (error as { code?: unknown }).code;
    }
  } catch {
    // Error objects can have accessor properties; never let diagnostics expose or disrupt on them.
  }

  const safeCode = typeof code === "string" && Object.prototype.hasOwnProperty.call(SAFE_ERROR_CODE_CATEGORIES, code)
    ? code
    : null;
  const category = safeCode
    ? SAFE_ERROR_CODE_CATEGORIES[safeCode]
    : typeof name === "string" && SAFE_PROVIDER_ERROR_NAMES.has(name)
      ? "provider"
      : isError ? "exception" : "unknown";
  return { errorCategory: category, errorCode: safeCode };
}

/**
 * Enqueue role-scoped notifications using only current, active relationships
 * in the payment's own school. Call from the payment transaction.
 */
export async function enqueueFinancePaymentNotifications(
  client: QueryClient,
  paymentId: number,
  schoolId: number,
  eventType: FinancePaymentNotificationEvent,
  metadata: Record<string, unknown> = {},
  eventReferenceId = 0,
  retryingCommittedIntent = false,
): Promise<number> {
  const inserted = await client.query(
    `WITH target AS (
       SELECT p.id AS payment_id,p.school_id,p.invoice_id,p.student_id
       FROM fee_payments p
       JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
         WHERE p.id=$1 AND p.school_id=$2
           AND ${retryingCommittedIntent ? notificationRetryEligibility : notificationEligibility}
           AND ${notificationReferenceEligibility}
     ), recipients AS (
       SELECT DISTINCT t.payment_id,t.school_id,t.invoice_id,pa.user_id AS user_id,'PARENT'::text AS role
       FROM target t
       JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id AND LOWER(st.status)='active'
       JOIN parent_student_relationships rel ON rel.student_id=st.id AND rel.status='ACTIVE'
       JOIN parents pa ON pa.id=rel.parent_id AND pa.school_id=t.school_id
         AND pa.status='ACTIVE' AND pa.user_id IS NOT NULL
       JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.payment_id,t.school_id,t.invoice_id,st.user_id,'STUDENT'::text
       FROM target t
       JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id
         AND LOWER(st.status)='active' AND st.user_id IS NOT NULL
       JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.payment_id,t.school_id,t.invoice_id,m.user_id,m.role
       FROM target t
       JOIN school_memberships m ON m.school_id=t.school_id AND m.status='ACTIVE'
         AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')
       JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
     )
     INSERT INTO fee_payment_notifications
        (school_id,payment_id,invoice_id,event_reference_id,recipient_user_id,recipient_role,event_type,channel)
      SELECT school_id,payment_id,invoice_id,$4,user_id,role,$3,'IN_APP'
     FROM recipients
      ON CONFLICT (payment_id,recipient_user_id,recipient_role,event_type,event_reference_id) DO NOTHING
     RETURNING id`,
    [paymentId, schoolId, eventType, eventReferenceId],
  );
  const createdCount = inserted.rowCount ?? inserted.rows.length;
  if (createdCount > 0) {
    const intent = await client.query(
      `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES ('Finance notification service','SYSTEM',$1,'generated in-app finance notifications',
         'Finance',$2,'info','FEE_PAYMENT_NOTIFICATION','SUCCESS',$3)`,
      [schoolId, paymentId, {
        ...metadata,
        createdCount,
        eventType,
        channel: "IN_APP",
        externalChannels: { email: "BLOCKED_UNCONFIGURED", sms: "BLOCKED_UNCONFIGURED" },
      }],
    );
  }
  return createdCount;
}

/**
 * Notification persistence is best-effort relative to a committed financial
 * operation. A durable outbox row lets a later authorized notification read
 * retry delivery if either the insert or its success audit fails.
 */
export async function enqueueFinancePaymentNotificationsSafely(
  client: QueryClient,
  paymentId: number,
  schoolId: number,
  eventType: FinancePaymentNotificationEvent,
  metadata: Record<string, unknown> = {},
  eventReferenceId = 0,
): Promise<{ queued: boolean }> {
  try {
    const intent = await client.query(
      `INSERT INTO fee_payment_notification_outbox
        (school_id,payment_id,invoice_id,event_type,event_reference_id,metadata,last_error)
       SELECT p.school_id,p.id,p.invoice_id,$3,$4,$5,'Notification enqueue pending'
       FROM fee_payments p
        WHERE p.id=$1 AND p.school_id=$2
          AND ${notificationEligibility}
          AND ${notificationReferenceEligibility}
        ON CONFLICT (payment_id,event_type,event_reference_id) DO NOTHING
        RETURNING id`,
      [paymentId, schoolId, eventType, eventReferenceId, metadata],
    );
    if ((intent.rowCount ?? intent.rows.length) === 0) {
      const existing = await client.query(
        `SELECT id FROM fee_payment_notification_outbox
         WHERE payment_id=$1 AND school_id=$2 AND event_type=$3 AND event_reference_id=$4`,
        [paymentId, schoolId, eventType, eventReferenceId],
      );
      if (!existing.rows[0]) throw new FinanceNotificationSettlementSafetyError();
    }
  } catch (error) {
    if (error instanceof FinanceNotificationSettlementSafetyError) throw error;
    throw new FinanceNotificationSettlementSafetyError();
  }
  try {
    await client.query("SAVEPOINT fee_payment_notification_delivery");
  } catch {
    throw new FinanceNotificationSettlementSafetyError();
  }
  try {
    await enqueueFinancePaymentNotifications(client, paymentId, schoolId, eventType, metadata, eventReferenceId);
    await enqueueFinancePaymentCommunications(client, paymentId, schoolId, eventType, eventReferenceId);
    await client.query(
      `DELETE FROM fee_payment_notification_outbox
       WHERE payment_id=$1 AND school_id=$2 AND event_type=$3 AND event_reference_id=$4`,
      [paymentId, schoolId, eventType, eventReferenceId],
    );
    await client.query("RELEASE SAVEPOINT fee_payment_notification_delivery");
    return { queued: false };
  } catch (error) {
    try {
      await client.query("ROLLBACK TO SAVEPOINT fee_payment_notification_delivery");
      await client.query("RELEASE SAVEPOINT fee_payment_notification_delivery");
    } catch (rollbackError) {
      logger.error({ ...safeErrorDiagnostics(rollbackError), paymentId, schoolId, eventType }, "Unable to roll back failed finance notification savepoint");
      throw new FinanceNotificationSettlementSafetyError();
    }
    logger.error({ ...safeErrorDiagnostics(error), paymentId, schoolId, eventType, eventReferenceId },
      "Finance notification delivery failed; atomic outbox intent remains pending");
    return { queued: true };
  }
}

export async function retryPendingFinancePaymentNotifications(
  db: ConnectableQueryClient,
  schoolIds: number[],
): Promise<void> {
  if (!schoolIds.length) return;
  let pending: any[];
  try {
    const result = await db.query(
      `SELECT id,payment_id,school_id,event_type,event_reference_id,metadata
       FROM fee_payment_notification_outbox
       WHERE school_id=ANY($1::integer[]) AND next_attempt_at<=NOW()
       ORDER BY created_at,id LIMIT 20`,
      [schoolIds],
    );
    pending = result.rows;
  } catch (error) {
    logger.error({ ...safeErrorDiagnostics(error), schoolIds }, "Unable to inspect pending finance notification retries");
    return;
  }
  for (const row of pending) {
    let client: Awaited<ReturnType<ConnectableQueryClient["connect"]>> | undefined;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id,payment_id,school_id,event_type,event_reference_id,metadata
         FROM fee_payment_notification_outbox WHERE id=$1 AND school_id=$2
           AND next_attempt_at<=NOW() FOR UPDATE SKIP LOCKED`,
        [row.id, row.school_id],
      );
      if (!locked.rows[0]) {
        await client.query("COMMIT");
        continue;
      }
      const retry = locked.rows[0];
      await client.query("SAVEPOINT fee_payment_notification_retry");
      try {
        await enqueueFinancePaymentNotifications(
          client,
          Number(retry.payment_id),
          Number(retry.school_id),
          retry.event_type,
          retry.metadata ?? {},
          Number(retry.event_reference_id),
          true,
        );
        await enqueueFinancePaymentCommunications(
          client,
          Number(retry.payment_id),
          Number(retry.school_id),
          retry.event_type,
          Number(retry.event_reference_id),
        );
        await client.query("RELEASE SAVEPOINT fee_payment_notification_retry");
        await client.query(
          "DELETE FROM fee_payment_notification_outbox WHERE id=$1 AND school_id=$2",
          [retry.id, retry.school_id],
        );
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT fee_payment_notification_retry");
        await client.query("RELEASE SAVEPOINT fee_payment_notification_retry");
        await client.query(
          `UPDATE fee_payment_notification_outbox SET attempts=attempts+1,
             next_attempt_at=NOW()+LEAST(INTERVAL '1 hour',INTERVAL '15 seconds' * POWER(2,LEAST(attempts,8))),
             last_error='Notification retry failed'
           WHERE id=$1 AND school_id=$2`,
          [retry.id, retry.school_id],
        );
        logger.error({ ...safeErrorDiagnostics(error), paymentId: retry.payment_id, schoolId: retry.school_id, eventType: retry.event_type },
          "Finance notification outbox retry failed");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      logger.error({ ...safeErrorDiagnostics(error), outboxId: row.id, schoolId: row.school_id }, "Unable to process finance notification retry");
    } finally {
      client?.release();
    }
  }
}