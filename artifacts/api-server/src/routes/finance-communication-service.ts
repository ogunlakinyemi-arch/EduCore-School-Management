import {
  queueCommunicationNotification,
  type CommunicationQueryClient,
} from "../services/communication-service";
import { logger } from "../lib/logger";
import type { FinancePaymentNotificationEvent } from "./finance-notifications-service";

type InvoiceRecipient = {
  recipientUserId: number | string;
  subjectStudentId: number | string;
  invoiceNumber: string;
};

type InvoiceCommunicationCandidate = InvoiceRecipient & {
  invoiceId: number | string;
  schoolId: number | string;
};

type PaymentRecipient = {
  recipientUserId: number | string;
  subjectStudentId: number | string;
  invoiceNumber: string;
};

const DEFAULT_COMMUNICATION_RECONCILIATION_BATCH_SIZE = 100;
const MAX_COMMUNICATION_RECONCILIATION_BATCH_SIZE = 250;

const externallyCommunicatedPaymentEvents = new Set<FinancePaymentNotificationEvent>([
  "PAYMENT_VERIFIED",
  "PAYMENT_REJECTED",
  "MANUAL_TRANSFER_APPROVED",
  "MANUAL_TRANSFER_REJECTED",
  "REFUND_APPROVED",
  "REVERSAL_APPROVED",
]);

async function queueInvoiceCommunication(
  client: CommunicationQueryClient,
  invoiceId: number,
  schoolId: number,
  recipient: InvoiceRecipient,
): Promise<number | null> {
  return queueCommunicationNotification(client, {
    recipientUserId: Number(recipient.recipientUserId),
    schoolId,
    subjectStudentId: Number(recipient.subjectStudentId),
    category: "FINANCE",
    eventKey: `finance:invoice:${invoiceId}:INVOICE_GENERATED`,
    subject: `New school fee invoice: ${recipient.invoiceNumber}`,
    body: `A school fee invoice (${recipient.invoiceNumber}) has been generated. Sign in to Yemait EduCore to view its details.`,
    link: null,
    channels: ["SMS", "EMAIL"],
  });
}

export async function enqueueFinanceInvoiceCommunications(
  client: CommunicationQueryClient,
  invoiceId: number,
  schoolId: number,
): Promise<number> {
  const recipients = await client.query<InvoiceRecipient>(
    `SELECT DISTINCT n.recipient_user_id AS "recipientUserId",i.student_id AS "subjectStudentId",
       i.invoice_number AS "invoiceNumber"
     FROM fee_invoice_notifications n
     JOIN fee_invoices i ON i.id=n.invoice_id AND i.school_id=n.school_id
     WHERE n.invoice_id=$1 AND n.school_id=$2
       AND n.event_type='INVOICE_GENERATED'
       AND n.channel='IN_APP'
       AND n.recipient_role IN ('PARENT','STUDENT')
     ORDER BY n.recipient_user_id`,
    [invoiceId, schoolId],
  );
  let queued = 0;
  for (const recipient of recipients.rows) {
    const notificationId = await queueInvoiceCommunication(client, invoiceId, schoolId, recipient);
    if (notificationId !== null) queued += 1;
  }
  return queued;
}

/**
 * Backfill SMS/email intents from durable invoice notification rows. Repeated
 * calls are idempotent: queued communication event keys are excluded from the
 * next bounded batch, while records that could not be queued remain eligible.
 */
export async function reconcileFinanceCommunicationIntents(
  client: CommunicationQueryClient,
  batchSize = DEFAULT_COMMUNICATION_RECONCILIATION_BATCH_SIZE,
): Promise<{ invoiceRecipientsScanned: number; invoiceIntentsQueued: number; hasMore: boolean }> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_COMMUNICATION_RECONCILIATION_BATCH_SIZE) {
    throw new RangeError(
      `Finance communication reconciliation batch size must be an integer from 1 to ${MAX_COMMUNICATION_RECONCILIATION_BATCH_SIZE}`,
    );
  }

  const candidates = await client.query<InvoiceCommunicationCandidate>(
    `SELECT DISTINCT n.invoice_id AS "invoiceId",n.school_id AS "schoolId",
       i.student_id AS "subjectStudentId",
       n.recipient_user_id AS "recipientUserId",i.invoice_number AS "invoiceNumber"
     FROM fee_invoice_notifications n
     JOIN fee_invoices i ON i.id=n.invoice_id AND i.school_id=n.school_id
     JOIN students st ON st.id=i.student_id AND st.school_id=i.school_id
       AND LOWER(st.status)='active'
     JOIN app_users recipient ON recipient.id=n.recipient_user_id
       AND UPPER(recipient.status)='ACTIVE'
     WHERE n.event_type='INVOICE_GENERATED'
       AND n.channel='IN_APP'
       AND n.recipient_role IN ('PARENT','STUDENT')
       AND (
         (n.recipient_role='PARENT' AND EXISTS (
           SELECT 1
           FROM parent_student_relationships rel
           JOIN parents pa ON pa.id=rel.parent_id AND pa.school_id=n.school_id
             AND UPPER(pa.status)='ACTIVE' AND pa.user_id=n.recipient_user_id
           WHERE rel.student_id=i.student_id AND rel.status='ACTIVE'
         ))
         OR
         (n.recipient_role='STUDENT' AND st.user_id=n.recipient_user_id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM school_memberships owner_role
         WHERE owner_role.user_id=n.recipient_user_id
           AND owner_role.school_id IS NULL
           AND owner_role.role='PLATFORM_OWNER'
           AND UPPER(owner_role.status)='ACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1 FROM communication_notifications c
         WHERE c.school_id=n.school_id
           AND c.recipient_user_id=n.recipient_user_id
           AND c.event_key=('finance:invoice:' || n.invoice_id::text || ':INVOICE_GENERATED')
       )
     ORDER BY 1,2,3
     LIMIT $1`,
    [batchSize],
  );

  let queued = 0;
  for (const candidate of candidates.rows) {
    const notificationId = await queueInvoiceCommunication(
      client,
      Number(candidate.invoiceId),
      Number(candidate.schoolId),
      candidate,
    );
    if (notificationId !== null) queued += 1;
  }
  return {
    invoiceRecipientsScanned: candidates.rows.length,
    invoiceIntentsQueued: queued,
    hasMore: candidates.rows.length === batchSize,
  };
}

export async function enqueueFinancePaymentCommunications(
  client: CommunicationQueryClient,
  paymentId: number,
  schoolId: number,
  eventType: FinancePaymentNotificationEvent,
  eventReferenceId = 0,
): Promise<number> {
  if (!externallyCommunicatedPaymentEvents.has(eventType)) return 0;

  const recipients = await client.query<PaymentRecipient>(
    `SELECT DISTINCT n.recipient_user_id AS "recipientUserId",i.student_id AS "subjectStudentId",
       i.invoice_number AS "invoiceNumber"
     FROM fee_payment_notifications n
     JOIN fee_payments p ON p.id=n.payment_id AND p.school_id=n.school_id
     JOIN fee_invoices i ON i.id=n.invoice_id AND i.school_id=n.school_id
     WHERE n.payment_id=$1 AND n.school_id=$2
       AND n.event_type=$3 AND n.event_reference_id=$4
       AND n.channel='IN_APP'
       AND n.recipient_role IN ('PARENT','STUDENT')
     ORDER BY n.recipient_user_id`,
    [paymentId, schoolId, eventType, eventReferenceId],
  );

  let subject: string;
  let message: string;
  if (eventType === "PAYMENT_VERIFIED" || eventType === "MANUAL_TRANSFER_APPROVED") {
    subject = "School fee payment verified";
    message = "A payment for your school fee invoice has been verified.";
  } else if (eventType === "PAYMENT_REJECTED" || eventType === "MANUAL_TRANSFER_REJECTED") {
    subject = "School fee payment update";
    message = "A payment for your school fee invoice was not accepted. Please contact the school accounts office.";
  } else if (eventType === "REFUND_APPROVED") {
    subject = "School fee refund approved";
    message = "A refund for your school fee invoice has been approved.";
  } else {
    subject = "School fee payment reversal approved";
    message = "A reversal for your school fee payment has been approved.";
  }

  let queued = 0;
  for (const recipient of recipients.rows) {
    const notificationId = await queueCommunicationNotification(client, {
      recipientUserId: Number(recipient.recipientUserId),
      schoolId,
      subjectStudentId: Number(recipient.subjectStudentId),
      category: eventType === "PAYMENT_VERIFIED" || eventType === "PAYMENT_REJECTED"
        ? "PAYMENT"
        : "FINANCE",
      eventKey: `finance:payment:${paymentId}:${eventType}:${eventReferenceId}`,
      subject,
      body: `${message} Invoice ${recipient.invoiceNumber}.`,
      link: null,
      channels: ["SMS", "EMAIL"],
    });
    if (notificationId !== null) queued += 1;
  }
  return queued;
}

/**
 * Invoice delivery intent is best-effort: notification infrastructure must not
 * abort an otherwise valid invoice transaction. The savepoint removes partial
 * communication rows if any recipient/channel queue write fails.
 */
export async function enqueueFinanceInvoiceCommunicationsSafely(
  client: CommunicationQueryClient,
  invoiceId: number,
  schoolId: number,
): Promise<void> {
  try {
    await client.query("SAVEPOINT finance_communication_invoice");
    await enqueueFinanceInvoiceCommunications(client, invoiceId, schoolId);
    await client.query("RELEASE SAVEPOINT finance_communication_invoice");
  } catch (error) {
    try {
      await client.query("ROLLBACK TO SAVEPOINT finance_communication_invoice");
      await client.query("RELEASE SAVEPOINT finance_communication_invoice");
    } catch (rollbackError) {
      logger.error(
        { error: rollbackError, invoiceId, schoolId },
        "Unable to roll back failed invoice communication savepoint",
      );
    }
    logger.error(
      { error, invoiceId, schoolId },
      "Invoice communication could not be queued",
    );
  }
}