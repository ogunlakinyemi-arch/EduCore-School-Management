import { logger } from "../lib/logger";

type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};
type ConnectableQueryClient = QueryClient & {
  connect: () => Promise<{ query: QueryClient["query"]; release: () => void }>;
};

export class InvoiceNotificationSettlementSafetyError extends Error {
  constructor() {
    super("Invoice notification intent or savepoint could not be safely persisted");
    this.name = "InvoiceNotificationSettlementSafetyError";
  }
}

export async function enqueueInvoiceGeneratedNotifications(
  client: QueryClient,
  invoiceId: number,
  schoolId: number,
): Promise<{ eligibleCount: number; createdCount: number }> {
  const result = await client.query(
    `WITH target AS (
       SELECT i.id AS invoice_id,i.school_id,i.student_id
       FROM fee_invoices i
       JOIN students st ON st.id=i.student_id AND st.school_id=i.school_id
         AND LOWER(st.status)='active'
       WHERE i.id=$1 AND i.school_id=$2
     ), recipients AS (
       SELECT DISTINCT t.invoice_id,t.school_id,pa.user_id AS user_id,'PARENT'::text AS role
       FROM target t
       JOIN parent_student_relationships rel ON rel.student_id=t.student_id AND rel.status='ACTIVE'
       JOIN parents pa ON pa.id=rel.parent_id AND pa.school_id=t.school_id
         AND pa.status='ACTIVE' AND pa.user_id IS NOT NULL
       JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.invoice_id,t.school_id,st.user_id,'STUDENT'::text
       FROM target t
       JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id
         AND LOWER(st.status)='active' AND st.user_id IS NOT NULL
       JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
       UNION
       SELECT t.invoice_id,t.school_id,m.user_id,m.role
       FROM target t
       JOIN school_memberships m ON m.school_id=t.school_id AND m.status='ACTIVE'
         AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')
       JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
      ), inserted AS (
       INSERT INTO fee_invoice_notifications
         (school_id,invoice_id,recipient_user_id,recipient_role,event_type,channel)
       SELECT school_id,invoice_id,user_id,role,'INVOICE_GENERATED','IN_APP'
       FROM recipients
       ON CONFLICT (school_id,invoice_id,recipient_user_id,recipient_role,event_type) DO NOTHING
       RETURNING id
     )
     SELECT (SELECT COUNT(*) FROM recipients)::integer AS eligible_count,
       (SELECT COUNT(*) FROM inserted)::integer AS created_count`,
    [invoiceId, schoolId],
  );
  const eligibleCount = Number(result.rows[0]?.eligible_count ?? 0);
  const createdCount = Number(result.rows[0]?.created_count ?? 0);
  if (createdCount > 0) {
    await client.query(
      `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES ('Finance notification service','SYSTEM',$1,'generated in-app invoice notifications',
         'Finance',$2,'info','FEE_INVOICE_NOTIFICATION','SUCCESS',$3)`,
      [schoolId, invoiceId, {
        createdCount,
        eventType: "INVOICE_GENERATED",
        channel: "IN_APP",
        externalChannels: { email: "BLOCKED_UNCONFIGURED", sms: "BLOCKED_UNCONFIGURED" },
      }],
    );
  }
  return { eligibleCount, createdCount };
}

async function deferInvoiceNotificationRetry(
  client: QueryClient,
  invoiceId: number,
  schoolId: number,
  reason: "NO_ELIGIBLE_RECIPIENTS" | "DELIVERY_FAILED",
): Promise<void> {
  await client.query(
    `UPDATE fee_invoice_notification_outbox SET attempts=attempts+1,
       next_attempt_at=NOW()+LEAST(INTERVAL '1 hour',INTERVAL '15 seconds' * POWER(2,LEAST(attempts,8))),
       last_error=$3
     WHERE invoice_id=$1 AND school_id=$2 AND event_type='INVOICE_GENERATED'`,
    [invoiceId, schoolId, reason === "NO_ELIGIBLE_RECIPIENTS"
      ? "No active eligible recipients; delivery deferred"
      : "Notification retry failed"],
  );
}

/**
 * Persist the invoice event before attempting delivery. The savepoint covers
 * only notification rows/audit, so a delivery failure cannot erase the intent
 * or roll back invoice creation.
 */
export async function enqueueInvoiceGeneratedNotificationsSafely(
  client: QueryClient,
  invoiceId: number,
  schoolId: number,
): Promise<{ queued: boolean }> {
  try {
    await client.query(
      `INSERT INTO fee_invoice_notification_outbox
        (school_id,invoice_id,event_type,metadata,last_error)
       SELECT i.school_id,i.id,'INVOICE_GENERATED','{}'::jsonb,'Notification enqueue pending'
       FROM fee_invoices i WHERE i.id=$1 AND i.school_id=$2
       ON CONFLICT (school_id,invoice_id,event_type) DO NOTHING`,
      [invoiceId, schoolId],
    );
  } catch {
    throw new InvoiceNotificationSettlementSafetyError();
  }
  try {
    await client.query("SAVEPOINT fee_invoice_notification_delivery");
  } catch {
    throw new InvoiceNotificationSettlementSafetyError();
  }
  try {
    const delivery = await enqueueInvoiceGeneratedNotifications(client, invoiceId, schoolId);
    if (delivery.eligibleCount > 0) {
      await client.query(
        `DELETE FROM fee_invoice_notification_outbox
         WHERE invoice_id=$1 AND school_id=$2 AND event_type='INVOICE_GENERATED'`,
        [invoiceId, schoolId],
      );
    } else {
      await deferInvoiceNotificationRetry(client, invoiceId, schoolId, "NO_ELIGIBLE_RECIPIENTS");
    }
    await client.query("RELEASE SAVEPOINT fee_invoice_notification_delivery");
    return { queued: delivery.eligibleCount === 0 };
  } catch (error) {
    try {
      await client.query("ROLLBACK TO SAVEPOINT fee_invoice_notification_delivery");
      await client.query("RELEASE SAVEPOINT fee_invoice_notification_delivery");
    } catch (rollbackError) {
      logger.error({ error: rollbackError, invoiceId, schoolId }, "Unable to roll back failed invoice notification savepoint");
      throw new InvoiceNotificationSettlementSafetyError();
    }
    logger.error({ error, invoiceId, schoolId }, "Invoice notification delivery failed; atomic outbox intent remains pending");
    return { queued: true };
  }
}

export async function retryPendingInvoiceNotifications(
  db: ConnectableQueryClient,
  schoolIds: number[],
): Promise<void> {
  if (!schoolIds.length) return;
  let pending: any[];
  try {
    const result = await db.query(
      `SELECT id,invoice_id,school_id FROM fee_invoice_notification_outbox
       WHERE school_id=ANY($1::integer[]) AND next_attempt_at<=NOW()
       ORDER BY created_at,id LIMIT 20`,
      [schoolIds],
    );
    pending = result.rows;
  } catch (error) {
    logger.error({ error, schoolIds }, "Unable to inspect pending invoice notification retries");
    return;
  }
  for (const row of pending) {
    let client: Awaited<ReturnType<ConnectableQueryClient["connect"]>> | undefined;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT id,invoice_id,school_id FROM fee_invoice_notification_outbox
         WHERE id=$1 AND school_id=$2 AND next_attempt_at<=NOW() FOR UPDATE SKIP LOCKED`,
        [row.id, row.school_id],
      );
      if (!locked.rows[0]) {
        await client.query("COMMIT");
        continue;
      }
      const retry = locked.rows[0];
      await client.query("SAVEPOINT fee_invoice_notification_retry");
      try {
        const delivery = await enqueueInvoiceGeneratedNotifications(
          client, Number(retry.invoice_id), Number(retry.school_id),
        );
        if (delivery.eligibleCount > 0) {
          await client.query(
            "DELETE FROM fee_invoice_notification_outbox WHERE id=$1 AND school_id=$2",
            [retry.id, retry.school_id],
          );
          await client.query("RELEASE SAVEPOINT fee_invoice_notification_retry");
        } else {
          await deferInvoiceNotificationRetry(
            client, Number(retry.invoice_id), Number(retry.school_id), "NO_ELIGIBLE_RECIPIENTS",
          );
          await client.query("RELEASE SAVEPOINT fee_invoice_notification_retry");
        }
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT fee_invoice_notification_retry");
        await client.query("RELEASE SAVEPOINT fee_invoice_notification_retry");
        await deferInvoiceNotificationRetry(
          client, Number(retry.invoice_id), Number(retry.school_id), "DELIVERY_FAILED",
        );
        logger.error({ error, invoiceId: retry.invoice_id, schoolId: retry.school_id }, "Invoice notification outbox retry failed");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      logger.error({ error, outboxId: row.id, schoolId: row.school_id }, "Unable to process invoice notification retry");
    } finally {
      client?.release();
    }
  }
}