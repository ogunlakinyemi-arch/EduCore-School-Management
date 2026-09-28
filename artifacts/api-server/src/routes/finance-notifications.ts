import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  ListMyFeePaymentNotificationsQueryParams,
  ListMyFeePaymentNotificationsResponse,
  MarkMyFeePaymentNotificationReadParams,
  MarkMyFeePaymentNotificationReadResponse,
} from "@workspace/api-zod";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuthentication());

const eligibleRoles = ["PARENT", "STUDENT", "SCHOOL_ADMIN", "ACCOUNTANT"] as const;
type EligibleRole = typeof eligibleRoles[number];

function authorizedScopes(req: Request): Array<{ role: EligibleRole; schoolId: number }> {
  const context = getUserContext(req);
  return context.roles.filter((assignment): assignment is typeof assignment & { role: EligibleRole; schoolId: number } =>
    eligibleRoles.includes(assignment.role as EligibleRole)
      && Number.isInteger(assignment.schoolId)
      && assignment.schoolId !== null,
  ).map(({ role, schoolId }) => ({ role: role as EligibleRole, schoolId: schoolId as number }));
}

function schoolIdFilter(req: Request, scopes: Array<{ role: EligibleRole; schoolId: number }>) {
  let schoolId: number | undefined;
  try {
    schoolId = ListMyFeePaymentNotificationsQueryParams.parse(req.query).schoolId;
  } catch {
    throw new AuthError(400, "schoolId must be a positive integer");
  }
  if (schoolId === undefined) return undefined;
  if (!scopes.some((scope) => scope.schoolId === schoolId)) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return schoolId;
}

function recipientAccessSql(
  userId: number,
  scopes: Array<{ role: EligibleRole; schoolId: number }>,
  schoolId?: number,
  notificationId?: number,
) {
  if (!scopes.length) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  const values: unknown[] = [userId];
  const clauses = ["n.recipient_user_id=$1"];
  if (schoolId !== undefined) {
    values.push(schoolId);
    clauses.push(`n.school_id=$${values.length}`);
  }
  const scopedRoles = scopes.map(({ role, schoolId: assignedSchoolId }) => {
    values.push(assignedSchoolId, role);
    return `(n.school_id=$${values.length - 1} AND n.recipient_role=$${values.length})`;
  });
  clauses.push(`(${scopedRoles.join(" OR ")})`);
  clauses.push(`(
    (n.recipient_role='PARENT' AND EXISTS (
      SELECT 1 FROM parents pa
      JOIN parent_student_relationships rel ON rel.parent_id=pa.id AND rel.status='ACTIVE'
      JOIN students st ON st.id=rel.student_id AND st.school_id=pa.school_id AND LOWER(st.status)='active'
      JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
      JOIN fee_payments linked_payment ON linked_payment.id=n.payment_id
        AND linked_payment.school_id=n.school_id AND linked_payment.student_id=st.id
      WHERE pa.user_id=n.recipient_user_id AND pa.school_id=n.school_id AND pa.status='ACTIVE'
    ))
    OR (n.recipient_role='STUDENT' AND EXISTS (
      SELECT 1 FROM students st JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
      JOIN fee_payments linked_payment ON linked_payment.id=n.payment_id
        AND linked_payment.school_id=n.school_id AND linked_payment.student_id=st.id
      WHERE st.user_id=n.recipient_user_id AND st.school_id=n.school_id AND LOWER(st.status)='active'
    ))
    OR (n.recipient_role IN ('SCHOOL_ADMIN','ACCOUNTANT') AND EXISTS (
      SELECT 1 FROM school_memberships m
      JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
      WHERE m.user_id=n.recipient_user_id AND m.school_id=n.school_id
        AND m.role=n.recipient_role AND m.status='ACTIVE'
    ))
  )`);
  if (notificationId !== undefined) {
    values.push(notificationId);
    clauses.push(`n.id=$${values.length}`);
  }
  return { where: clauses.join(" AND "), values };
}

const safeNotificationSelect = `
  SELECT n.id,n.school_id AS "schoolId",n.event_type AS "eventType",
    n.is_read AS "isRead",
    to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
    CASE WHEN n.read_at IS NULL THEN NULL
      ELSE to_char(n.read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "readAt",
    r.receipt_number AS "receiptNumber",i.invoice_number AS "invoiceNumber",
    i.student_name_snapshot AS "studentName",p.reference AS "paymentReference",
    p.amount_minor AS "amountMinor",p.currency,p.method
  FROM fee_payment_notifications n
  JOIN fee_payments p ON p.id=n.payment_id AND p.school_id=n.school_id AND p.invoice_id=n.invoice_id
  JOIN fee_invoices i ON i.id=n.invoice_id AND i.school_id=n.school_id AND i.student_id=p.student_id
  JOIN fee_receipts r ON r.payment_id=p.id AND r.invoice_id=i.id AND r.school_id=n.school_id
`;

async function findNotification(
  db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  userId: number,
  scopes: Array<{ role: EligibleRole; schoolId: number }>,
  notificationId: number,
) {
  const access = recipientAccessSql(userId, scopes, undefined, notificationId);
  const result = await db.query(
    `${safeNotificationSelect} WHERE ${access.where}`,
    access.values,
  );
  return result.rows[0];
}

function fail(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ error: error.message, code: error.eventType });
    return;
  }
  res.status(500).json({ error: "Finance notification operation failed" });
}

router.get("/me/finance/payment-notifications", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const scopes = authorizedScopes(req);
    const schoolId = schoolIdFilter(req, scopes);
    const access = recipientAccessSql(context.user.id, scopes, schoolId);
    const result = await pool.query(
      `${safeNotificationSelect} WHERE ${access.where} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      access.values,
    );
    res.json(ListMyFeePaymentNotificationsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.patch("/me/finance/payment-notifications/:notificationId/read", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    let id: number;
    try {
      id = MarkMyFeePaymentNotificationReadParams.parse(req.params).notificationId;
    } catch {
      throw new AuthError(404, "Notification not found");
    }
    const context = getUserContext(req);
    const scopes = authorizedScopes(req);
    const access = recipientAccessSql(context.user.id, scopes, undefined, id);
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE fee_payment_notifications n SET is_read=true,read_at=COALESCE(n.read_at,NOW())
       WHERE ${access.where} AND n.is_read=false RETURNING n.id,n.school_id AS "schoolId",n.recipient_role AS "recipientRole"`,
      access.values,
    );
    const notification = await findNotification(client, context.user.id, scopes, id);
    if (!notification) throw new AuthError(404, "Notification not found");
    if (updated.rows[0]) {
      const role = updated.rows[0].recipientRole;
      await client.query(
        `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,
          record_id,severity,event_type,result,metadata)
         VALUES ($1,$2,$3,$4,$5,'marked verified-payment notification as read','Finance',$6,
          'info','FEE_PAYMENT_NOTIFICATION_READ','SUCCESS',$7)`,
        [
          [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
          role, context.user.id, context.user.clerkUserId, updated.rows[0].schoolId, id,
          { eventType: "PAYMENT_VERIFIED" },
        ],
      );
    }
    const response = MarkMyFeePaymentNotificationReadResponse.parse(notification);
    await client.query("COMMIT");
    res.json(response);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

export default router;