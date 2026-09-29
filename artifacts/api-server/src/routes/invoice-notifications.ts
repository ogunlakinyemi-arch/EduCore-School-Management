import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  ListMyFeeInvoiceNotificationsQueryParams,
  ListMyFeeInvoiceNotificationsResponse,
  MarkMyFeeInvoiceNotificationReadParams,
  MarkMyFeeInvoiceNotificationReadResponse,
} from "@workspace/api-zod";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";
import { retryPendingInvoiceNotifications } from "./invoice-notifications-service";

const router: IRouter = Router();
router.use(requireAuthentication());

const eligibleRoles = ["PARENT", "STUDENT", "SCHOOL_ADMIN", "ACCOUNTANT"] as const;
type EligibleRole = typeof eligibleRoles[number];
type Scope = { role: EligibleRole; schoolId: number };

function authorizedScopes(req: Request): Scope[] {
  const context = getUserContext(req);
  return context.roles.filter((assignment): assignment is typeof assignment & { role: EligibleRole; schoolId: number } =>
    eligibleRoles.includes(assignment.role as EligibleRole)
      && Number.isInteger(assignment.schoolId)
      && assignment.schoolId !== null,
  ).map(({ role, schoolId }) => ({ role: role as EligibleRole, schoolId: schoolId as number }));
}

function selectedSchool(req: Request, scopes: Scope[]): number | undefined {
  let schoolId: number | undefined;
  try {
    schoolId = ListMyFeeInvoiceNotificationsQueryParams.parse(req.query).schoolId;
  } catch {
    throw new AuthError(400, "schoolId must be a positive integer");
  }
  if (schoolId !== undefined && !scopes.some((scope) => scope.schoolId === schoolId)) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return schoolId;
}

function accessWhere(userId: number, scopes: Scope[], schoolId?: number, notificationId?: number) {
  if (!scopes.length) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  const values: unknown[] = [userId];
  const clauses = ["n.recipient_user_id=$1"];
  if (schoolId !== undefined) {
    values.push(schoolId);
    clauses.push(`n.school_id=$${values.length}`);
  }
  const roleScopes = scopes.map(({ role, schoolId: assignedSchoolId }) => {
    values.push(assignedSchoolId, role);
    return `(n.school_id=$${values.length - 1} AND n.recipient_role=$${values.length})`;
  });
  clauses.push(`(${roleScopes.join(" OR ")})`);
  clauses.push(`(
    (n.recipient_role='PARENT' AND EXISTS (
      SELECT 1 FROM parents pa
      JOIN parent_student_relationships rel ON rel.parent_id=pa.id AND rel.status='ACTIVE'
      JOIN students st ON st.id=rel.student_id AND st.school_id=pa.school_id AND LOWER(st.status)='active'
      JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
      JOIN fee_invoices linked_invoice ON linked_invoice.id=n.invoice_id
        AND linked_invoice.school_id=n.school_id AND linked_invoice.student_id=st.id
      WHERE pa.user_id=n.recipient_user_id AND pa.school_id=n.school_id AND pa.status='ACTIVE'
    ))
    OR (n.recipient_role='STUDENT' AND EXISTS (
      SELECT 1 FROM students st JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
      JOIN fee_invoices linked_invoice ON linked_invoice.id=n.invoice_id
        AND linked_invoice.school_id=n.school_id AND linked_invoice.student_id=st.id
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

const invoiceNotificationSelect = `
  SELECT n.id,n.school_id AS "schoolId",n.event_type AS "eventType",
    n.is_read AS "isRead",
    to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
    CASE WHEN n.read_at IS NULL THEN NULL
      ELSE to_char(n.read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "readAt",
    i.invoice_number AS "invoiceNumber",i.student_name_snapshot AS "studentName",
    i.total_minor AS "amountMinor",i.outstanding_minor AS "outstandingMinor",i.currency,i.status
  FROM fee_invoice_notifications n
  JOIN fee_invoices i ON i.id=n.invoice_id AND i.school_id=n.school_id
`;

async function findNotification(
  db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  userId: number,
  scopes: Scope[],
  notificationId: number,
) {
  const access = accessWhere(userId, scopes, undefined, notificationId);
  const result = await db.query(`${invoiceNotificationSelect} WHERE ${access.where}`, access.values);
  return result.rows[0];
}

function fail(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ error: error.message, code: error.eventType });
    return;
  }
  res.status(500).json({ error: "Invoice notification operation failed" });
}

router.get("/me/finance/invoice-notifications", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const scopes = authorizedScopes(req);
    const schoolId = selectedSchool(req, scopes);
    await retryPendingInvoiceNotifications(pool, Array.from(new Set(scopes.map((scope) => scope.schoolId))));
    const access = accessWhere(context.user.id, scopes, schoolId);
    const result = await pool.query(
      `${invoiceNotificationSelect} WHERE ${access.where} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      access.values,
    );
    res.json(ListMyFeeInvoiceNotificationsResponse.parse(result.rows));
  } catch (error) { fail(res, error); }
});

router.patch("/me/finance/invoice-notifications/:notificationId/read", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    let id: number;
    try {
      id = MarkMyFeeInvoiceNotificationReadParams.parse(req.params).notificationId;
    } catch {
      throw new AuthError(404, "Notification not found");
    }
    const context = getUserContext(req);
    const scopes = authorizedScopes(req);
    const access = accessWhere(context.user.id, scopes, undefined, id);
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE fee_invoice_notifications n SET is_read=true,read_at=COALESCE(n.read_at,NOW())
       WHERE ${access.where} AND n.is_read=false
       RETURNING n.id,n.school_id AS "schoolId",n.recipient_role AS "recipientRole"`,
      access.values,
    );
    const notification = await findNotification(client, context.user.id, scopes, id);
    if (!notification) throw new AuthError(404, "Notification not found");
    if (updated.rows[0]) {
      await client.query(
        `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,
          record_id,severity,event_type,result,metadata)
         VALUES ($1,$2,$3,$4,$5,'marked invoice notification as read','Finance',$6,
          'info','FEE_INVOICE_NOTIFICATION_READ','SUCCESS',$7)`,
        [
          [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
          updated.rows[0].recipientRole, context.user.id, context.user.clerkUserId,
          updated.rows[0].schoolId, id, { eventType: notification.eventType },
        ],
      );
    }
    const response = MarkMyFeeInvoiceNotificationReadResponse.parse(notification);
    await client.query("COMMIT");
    res.json(response);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error);
  } finally { client.release(); }
});

export default router;