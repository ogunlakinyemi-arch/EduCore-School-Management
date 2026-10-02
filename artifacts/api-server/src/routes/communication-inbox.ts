import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { pushSubscriptionSchema } from "../services/web-push-provider";
import { createHash } from "node:crypto";
import { AuthError, getUserContext, requireAuthentication } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuthentication());
router.get("/communication/push-configuration", (_req, res) => {
  const configured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  res.setHeader("Cache-Control", "no-store");
  // The application-server PUBLIC key is intentionally supplied to PushManager.
  res.json({ configured, publicKey: configured ? process.env.VAPID_PUBLIC_KEY : null });
});
router.post("/communication/push-devices/revoke-session", async (req, res) => {
  try {
    const user = getUserContext(req).user;
    const session = getAuth(req).sessionId;
    if (!session) throw new AuthError(401, "An active session is required");
    await pool.query(`UPDATE communication_push_devices SET status='REVOKED',revoked_at=NOW()
      WHERE user_id=$1 AND session_id=$2 AND status='ACTIVE'`, [user.id, session]);
    res.status(204).end();
  } catch (error) { fail(res, error, "Could not revoke push session"); }
});

const categories = new Set([
  "ATTENDANCE", "ACADEMIC", "ASSIGNMENT", "FINANCE", "PAYMENT", "ANNOUNCEMENT",
  "ACCOUNT", "SYSTEM", "SUBSCRIPTION", "PARTNER", "SECURITY",
]);
const channels = new Set(["IN_APP", "SMS", "EMAIL", "PUSH"]);
const MAX_ACTIVE_PUSH_DEVICES_PER_SCOPE = 10;
const MAX_PUSH_DEVICE_REGISTRATIONS_PER_MINUTE = 5;

type UserContext = ReturnType<typeof getUserContext>;
type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

function isPlatformOwner(context: UserContext) {
  return context.roles.some((role) =>
    role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE",
  );
}

function isPartnerOnly(context: UserContext) {
  const hasPartnerRole = context.roles.some((role) => role.role === "PARTNER" && role.status === "ACTIVE");
  const hasOtherRole = context.roles.some((role) =>
    role.status === "ACTIVE" && role.role !== "PARTNER" && role.role !== "PLATFORM_OWNER",
  );
  return hasPartnerRole && !hasOtherRole;
}

function parseSchoolId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AuthError(400, "schoolId must be a positive integer");
  }
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) throw new AuthError(400, "schoolId must be a positive integer");
  const schoolId = Number(raw);
  if (!Number.isSafeInteger(schoolId)) throw new AuthError(400, "schoolId must be a positive integer");
  return schoolId;
}

function parseBodySchoolId(value: unknown, optional: boolean): number | null {
  if (value === null || (optional && value === undefined)) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AuthError(400, "schoolId must be a positive integer or null");
  }
  return value;
}

function assertBodyKeys(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError(400, "Request body must be an object");
  }
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new AuthError(400, "Request body contains unsupported fields");
  }
}

function parsePositiveId(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(404, `${label} not found`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AuthError(404, `${label} not found`);
  return id;
}

function parseBoundedQueryInt(value: unknown, label: string, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new AuthError(400, `${label} must be a positive integer no greater than ${max}`);
  }
  return parsed;
}

function parseOptionalQueryBoolean(value: unknown, label: string, fallback = false) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AuthError(400, `${label} must be true or false`);
}

function parseSearch(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim().length > 100) {
    throw new AuthError(400, "search must be at most 100 characters");
  }
  return value.trim() || null;
}

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ error: error.message, code: error.eventType });
    return;
  }
  res.status(500).json({ error: fallback });
}

/**
 * An active school entitlement can come from an active school role, a current
 * parent/student relationship, or an active partner attribution. Global Owner
 * access is deliberately handled before this expression and never widens it.
 */
function activeSchoolEntitlementSql(userExpression: string, schoolExpression: string) {
  return `(
    EXISTS (
      SELECT 1 FROM school_memberships m
      JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
      WHERE m.user_id=${userExpression} AND m.school_id=${schoolExpression}
        AND m.status='ACTIVE' AND m.role<>'PLATFORM_OWNER'
    )
    OR EXISTS (
      SELECT 1 FROM parents pa
      JOIN parent_student_relationships rel ON rel.parent_id=pa.id AND rel.status='ACTIVE'
      JOIN students st ON st.id=rel.student_id AND st.school_id=pa.school_id
        AND LOWER(st.status)='active'
      JOIN app_users u ON u.id=pa.user_id AND u.status='ACTIVE'
      WHERE pa.user_id=${userExpression} AND pa.school_id=${schoolExpression}
        AND pa.status='ACTIVE'
    )
    OR EXISTS (
      SELECT 1 FROM students st
      JOIN app_users u ON u.id=st.user_id AND u.status='ACTIVE'
      WHERE st.user_id=${userExpression} AND st.school_id=${schoolExpression}
        AND LOWER(st.status)='active'
    )
    OR EXISTS (
      SELECT 1 FROM partner_profiles pp
      JOIN school_partner_attributions spa
        ON spa.partner_profile_id=pp.id AND spa.school_id=${schoolExpression}
        AND spa.is_current=true AND spa.status='ACTIVE'
      WHERE pp.status='ACTIVE' AND (
        pp.user_id=${userExpression}
        OR EXISTS (
          SELECT 1 FROM partner_profile_users ppu
          WHERE ppu.partner_profile_id=pp.id AND ppu.user_id=${userExpression}
            AND ppu.status='ACTIVE'
        )
      )
    )
  )`;
}

function authorizedStudentSql(userExpression: string, studentExpression: string, schoolExpression: string) {
  return `(
    EXISTS (
      SELECT 1 FROM students self_student
      JOIN app_users self_user ON self_user.id=self_student.user_id AND self_user.status='ACTIVE'
      WHERE self_student.id=${studentExpression} AND self_student.school_id=${schoolExpression}
        AND self_student.user_id=${userExpression} AND LOWER(self_student.status)='active'
    )
    OR EXISTS (
      SELECT 1 FROM parents pa
      JOIN app_users parent_user ON parent_user.id=pa.user_id AND parent_user.status='ACTIVE'
      JOIN parent_student_relationships rel ON rel.parent_id=pa.id AND rel.status='ACTIVE'
      JOIN students linked_student ON linked_student.id=rel.student_id
        AND linked_student.school_id=pa.school_id AND LOWER(linked_student.status)='active'
      WHERE pa.user_id=${userExpression} AND pa.school_id=${schoolExpression}
        AND pa.status='ACTIVE' AND linked_student.id=${studentExpression}
    )
  )`;
}

function subjectNotificationVisibilitySql(userExpression: string) {
  const trustedSchoolRole = `EXISTS (
    SELECT 1 FROM school_memberships m
    JOIN app_users u ON u.id=m.user_id AND u.status='ACTIVE'
    WHERE m.user_id=${userExpression} AND m.school_id=n.school_id AND m.status='ACTIVE'
      AND m.role NOT IN ('PLATFORM_OWNER','PARENT','STUDENT','PARTNER')
  )`;
  const authorizedSubjectStudent = authorizedStudentSql(
    userExpression, "n.subject_student_id", "n.school_id",
  );
  const authorizedCurrentClassStudent = `EXISTS (
    SELECT 1 FROM students class_student
    JOIN student_class_assignments enrollment
      ON enrollment.student_id=class_student.id AND enrollment.school_id=class_student.school_id
      AND enrollment.school_class_id=n.subject_class_id
      AND enrollment.status='ACTIVE' AND enrollment.is_current=true
    JOIN school_classes subject_class
      ON subject_class.id=enrollment.school_class_id AND subject_class.school_id=enrollment.school_id
      AND subject_class.section=enrollment.section
    WHERE class_student.school_id=n.school_id AND LOWER(class_student.status)='active'
      AND (n.subject_student_id IS NULL OR class_student.id=n.subject_student_id)
      AND ${authorizedStudentSql(userExpression, "class_student.id", "n.school_id")}
  )`;
  return `(
    ${trustedSchoolRole}
    OR (
      (n.subject_student_id IS NULL OR ${authorizedSubjectStudent})
      AND (n.subject_class_id IS NULL OR ${authorizedCurrentClassStudent})
    )
  )`;
}

async function assertSchoolEntitlement(
  context: UserContext,
  schoolId: number | null,
  db: Queryable = pool,
) {
  if (schoolId === null) return;
  if (isPlatformOwner(context)) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  const allowed = await db.query(
    `SELECT ${activeSchoolEntitlementSql("$1", "$2")} AS allowed`,
    [context.user.id, schoolId],
  );
  if (allowed.rows[0]?.allowed !== true) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
}

type Visibility = { where: string; values: unknown[] };

function notificationVisibility(context: UserContext, schoolId: number | null): Visibility {
  const userId = context.user.id;
  if (isPlatformOwner(context)) {
    if (schoolId !== null) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
    return { where: "n.recipient_user_id=$1 AND n.school_id IS NULL", values: [userId] };
  }

  const values: unknown[] = [userId];
  const globalCategory = isPartnerOnly(context)
    ? "n.category='PARTNER'"
    : "n.category IN ('ACCOUNT','SYSTEM','SECURITY')";
  const global = `(n.school_id IS NULL AND ${globalCategory})`;
  const schoolEntitlement = activeSchoolEntitlementSql("$1", "n.school_id");
  const subjectVisibility = subjectNotificationVisibilitySql("$1");
  const schoolCategory = isPartnerOnly(context) ? " AND n.category='PARTNER'" : "";
  if (schoolId !== null) {
    values.push(schoolId);
    return {
      where: `n.recipient_user_id=$1 AND n.school_id=$2 AND ${activeSchoolEntitlementSql("$1", "$2")} AND ${subjectVisibility}${schoolCategory}`,
      values,
    };
  }
  return {
    where: `n.recipient_user_id=$1 AND (${global} OR (n.school_id IS NOT NULL AND ${schoolEntitlement} AND ${subjectVisibility}${schoolCategory}))`,
    values,
  };
}

function preferenceScope(context: UserContext, bodyOrQuery: unknown) {
  const schoolId = parseSchoolId(bodyOrQuery);
  if (isPlatformOwner(context) && schoolId !== null) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return schoolId;
}

function auditRole(context: UserContext, schoolId: number | null) {
  return context.roles.find((role) => role.schoolId === schoolId && role.status === "ACTIVE")?.role
    ?? context.roles.find((role) => role.role === "PLATFORM_OWNER" && role.status === "ACTIVE")?.role
    ?? context.roles.find((role) => role.status === "ACTIVE")?.role
    ?? "USER";
}

async function auditAction(
  db: Queryable,
  context: UserContext,
  schoolId: number | null,
  action: string,
  eventType: string,
  recordId: number | null,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
       severity,event_type,result,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Communication',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      auditRole(context, schoolId),
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      recordId,
      eventType,
      JSON.stringify(metadata),
    ],
  );
}

function notificationResponse(row: Record<string, any>) {
  return {
    id: row.id,
    schoolId: row.schoolId ?? null,
    category: row.category,
    subject: row.subject ?? null,
    body: row.body,
    link: row.link ?? null,
    origin: row.origin,
    isRead: row.isRead,
    isArchived: Boolean(row.isArchived),
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
    deliveries: row.deliveries ?? [],
  };
}

function buildNotificationSelect(where: string) {
  return `SELECT n.id,n.school_id AS "schoolId",n.category,n.subject,n.body,n.link,
      n.is_read AS "isRead",(n.archived_at IS NOT NULL) AS "isArchived",
      to_char(n.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      CASE WHEN n.read_at IS NULL THEN NULL
        ELSE to_char(n.read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "readAt",
      CASE WHEN EXISTS (
        SELECT 1 FROM communication_campaign_recipients cr
        WHERE cr.notification_id=n.id
      ) THEN 'CAMPAIGN' ELSE 'SYSTEM' END AS origin,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id',d.id,'channel',d.channel,'status',d.status,'provider',NULL::text,
          'providerMessageId',d.provider_message_id,
          'providerAcknowledgedAt',d.provider_acknowledged_at,'sentAt',d.sent_at,
          'deliveredAt',d.delivered_at,'failedAt',d.failed_at,'errorCode',d.error_code,
          'lastError',d.last_error,'attempts',d.attempts,'nextAttemptAt',d.next_attempt_at,
          'lastAttemptAt',d.last_attempt_at,
          'simulated',d.error_code='SIMULATED',
          'label',CASE WHEN d.error_code='SIMULATED'
            THEN 'Development simulation — no message was sent.' ELSE NULL END
        ) ORDER BY d.id)
        FROM communication_deliveries d WHERE d.notification_id=n.id
      ),'[]'::json) AS deliveries
    FROM communication_notifications n WHERE ${where}`;
}

router.get("/communication/notifications", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const schoolId = parseSchoolId(req.query.schoolId);
    const limit = parseBoundedQueryInt(req.query.limit, "limit", 50, 100);
    const childId = req.query.childId === undefined
      ? null : parseBoundedQueryInt(req.query.childId, "childId", 1, Number.MAX_SAFE_INTEGER);
    const category = req.query.category;
    if (category !== undefined && (typeof category !== "string" || !categories.has(category))) {
      throw new AuthError(400, "category is invalid");
    }
    const isRead = parseOptionalQueryBoolean(req.query.isRead, "isRead");
    const includeArchived = parseOptionalQueryBoolean(req.query.includeArchived, "includeArchived");
    const includeExpired = parseOptionalQueryBoolean(req.query.includeExpired, "includeExpired");
    const search = parseSearch(req.query.search);
    const beforeId = req.query.beforeId === undefined
      ? null
      : parseBoundedQueryInt(req.query.beforeId, "beforeId", 1, Number.MAX_SAFE_INTEGER);
    await assertSchoolEntitlement(context, schoolId);
    const visibility = notificationVisibility(context, schoolId);
    const filterValues = [...visibility.values];
    let filterWhere = visibility.where;
    if (childId !== null) {
      filterValues.push(childId);
      filterWhere += ` AND n.subject_student_id=$${filterValues.length}`;
    }
    if (category !== undefined) {
      filterValues.push(category);
      filterWhere += ` AND n.category=$${filterValues.length}`;
    }
    if (req.query.isRead !== undefined) {
      filterValues.push(isRead);
      filterWhere += ` AND n.is_read=$${filterValues.length}`;
    }
    if (search) {
      filterValues.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      filterWhere += ` AND (COALESCE(n.subject,'') ILIKE $${filterValues.length} ESCAPE '\\'
        OR n.body ILIKE $${filterValues.length} ESCAPE '\\')`;
    }
    if (!includeArchived) filterWhere += " AND n.archived_at IS NULL";
    if (!includeExpired) {
      filterWhere += ` AND NOT EXISTS (
        SELECT 1 FROM communication_campaign_recipients expiring_recipient
        JOIN communication_campaigns expiring_campaign
          ON expiring_campaign.id=expiring_recipient.campaign_id
          AND expiring_campaign.school_id=expiring_recipient.school_id
        WHERE expiring_recipient.notification_id=n.id
          AND expiring_campaign.expires_at IS NOT NULL
          AND expiring_campaign.expires_at<=NOW()
      )`;
    }
    const listValues = [...filterValues];
    let listWhere = filterWhere;
    if (beforeId !== null) {
      listValues.push(beforeId);
      listWhere += ` AND n.id<$${listValues.length}`;
    }
    listValues.push(limit + 1);
    const [items, unread] = await Promise.all([
      pool.query(
        `${buildNotificationSelect(listWhere)} ORDER BY n.created_at DESC,n.id DESC LIMIT $${listValues.length}`,
        listValues,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM communication_notifications n
          WHERE ${filterWhere} AND n.is_read=false`,
        filterValues,
      ),
    ]);
    const hasMore = items.rows.length > limit;
    const page = hasMore ? items.rows.slice(0, limit) : items.rows;
    res.json({
      items: page.map(notificationResponse),
      unreadCount: unread.rows[0]?.count ?? 0,
      hasMore,
      nextBeforeId: hasMore && page.length > 0 ? page[page.length - 1].id : null,
    });
  } catch (error) {
    fail(res, error, "Could not load communication notifications");
  }
});

router.patch("/communication/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const context = getUserContext(req);
    const notificationId = parsePositiveId(req.params.notificationId, "Notification");
    const visibility = notificationVisibility(context, null);
    await client.query("BEGIN");
    const updated = await client.query(
      `WITH target AS (
         SELECT n.id,n.is_read AS "wasRead" FROM communication_notifications n
         WHERE ${visibility.where} AND n.id=$${visibility.values.length + 1}
         FOR UPDATE
       ), changed AS (
         UPDATE communication_notifications n
         SET is_read=true,read_at=COALESCE(n.read_at,NOW())
         FROM target t WHERE n.id=t.id
         RETURNING n.id,n.school_id AS "schoolId",t."wasRead"
       )
       SELECT changed.* FROM changed`,
      [...visibility.values, notificationId],
    );
    if (!updated.rows[0]) throw new AuthError(404, "Notification not found");
    await client.query(
      `UPDATE communication_deliveries SET status='READ',updated_at=NOW()
       WHERE notification_id=$1 AND channel='IN_APP' AND status IN ('SENT','DELIVERED')`,
      [notificationId],
    );
    const details = await client.query(
      `${buildNotificationSelect(visibility.where)} AND n.id=$${visibility.values.length + 1}`,
      [...visibility.values, notificationId],
    );
    const notification = details.rows[0];
    if (!updated.rows[0].wasRead) {
      await auditAction(
        client, context, notification.schoolId ?? null, "marked notification as read",
        "COMMUNICATION_NOTIFICATION_READ", notificationId,
      );
    }
    await client.query("COMMIT");
    res.json(notificationResponse(notification));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error, "Could not update communication notification");
  } finally {
    client.release();
  }
});

async function setNotificationArchived(req: Request, res: Response, archived: boolean) {
  const client = await pool.connect();
  try {
    const context = getUserContext(req);
    const notificationId = parsePositiveId(req.params.notificationId, "Notification");
    const visibility = notificationVisibility(context, null);
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT n.id,n.school_id AS "schoolId",n.archived_at AS "archivedAt",n.category
       FROM communication_notifications n
       WHERE ${visibility.where} AND n.id=$${visibility.values.length + 1}
       FOR UPDATE`,
      [...visibility.values, notificationId],
    );
    const record = existing.rows[0];
    if (!record) throw new AuthError(404, "Notification not found");
    if (archived && ["ACCOUNT", "SECURITY"].includes(record.category)) {
      throw new AuthError(400, "Account and security notifications cannot be archived");
    }
    const wasArchived = Boolean(record.archivedAt);
    await client.query(
      `UPDATE communication_notifications
       SET archived_at=CASE WHEN $2 THEN COALESCE(archived_at,NOW()) ELSE NULL END
       WHERE id=$1`,
      [notificationId, archived],
    );
    const details = await client.query(
      `${buildNotificationSelect(visibility.where)} AND n.id=$${visibility.values.length + 1}`,
      [...visibility.values, notificationId],
    );
    if (wasArchived !== archived) {
      await auditAction(
        client, context, record.schoolId ?? null,
        archived ? "archived communication notification" : "unarchived communication notification",
        archived ? "COMMUNICATION_NOTIFICATION_ARCHIVED" : "COMMUNICATION_NOTIFICATION_UNARCHIVED",
        notificationId,
      );
    }
    await client.query("COMMIT");
    res.json(notificationResponse(details.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error, "Could not archive communication notification");
  } finally {
    client.release();
  }
}

router.patch("/communication/notifications/:notificationId/archive", async (req, res): Promise<void> => {
  await setNotificationArchived(req, res, true);
});

router.patch("/communication/notifications/:notificationId/unarchive", async (req, res): Promise<void> => {
  await setNotificationArchived(req, res, false);
});

router.post("/communication/notifications/read-all", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const body = req.body ?? {};
    assertBodyKeys(body, ["schoolId"]);
    const schoolId = parseBodySchoolId(body.schoolId, true);
    await assertSchoolEntitlement(context, schoolId);
    const visibility = notificationVisibility(context, schoolId);
    const result = await pool.query(
      `WITH changed AS (
         UPDATE communication_notifications n
         SET is_read=true,read_at=COALESCE(n.read_at,NOW())
          WHERE ${visibility.where} AND n.is_read=false AND n.archived_at IS NULL
          RETURNING n.id,n.school_id
       ), delivery_updates AS (
         UPDATE communication_deliveries d SET status='READ',updated_at=NOW()
         FROM changed c WHERE d.notification_id=c.id AND d.channel='IN_APP'
           AND d.status IN ('SENT','DELIVERED') RETURNING d.id
       )
       SELECT COUNT(*)::int AS count FROM changed`,
      visibility.values,
    );
    res.json({ updatedCount: result.rows[0]?.count ?? 0 });
  } catch (error) {
    fail(res, error, "Could not mark communication notifications as read");
  }
});

router.get("/communication/preferences", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const schoolId = preferenceScope(context, req.query.schoolId);
    await assertSchoolEntitlement(context, schoolId);
    const result = await pool.query(
      `SELECT school_id AS "schoolId",category,channel,enabled,
         (category IN ('ACCOUNT','SECURITY')) AS mandatory,
         to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM communication_preferences
       WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2
       ORDER BY category,channel`,
      [context.user.id, schoolId],
    );
    res.json({
      schoolId,
      preferences: result.rows.map((preference) => ({
        ...preference,
        mandatory: preference.mandatory ?? ["ACCOUNT", "SECURITY"].includes(preference.category),
      })),
    });
  } catch (error) {
    fail(res, error, "Could not load communication preferences");
  }
});

router.put("/communication/preferences", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const context = getUserContext(req);
    const body = req.body ?? {};
    assertBodyKeys(body, ["schoolId", "category", "channel", "enabled"]);
    const schoolId = preferenceScope(context, parseBodySchoolId(body.schoolId, false));
    await assertSchoolEntitlement(context, schoolId, client);
    if (!categories.has(body.category) || !channels.has(body.channel) || typeof body.enabled !== "boolean") {
      throw new AuthError(400, "category, channel, and enabled are invalid");
    }
    if (body.enabled === false && ["ACCOUNT", "SECURITY"].includes(body.category)) {
      throw new AuthError(400, "Account and security notifications cannot be disabled");
    }
    await client.query("BEGIN");
    const conflict = schoolId === null
      ? "(user_id,category,channel) WHERE school_id IS NULL"
      : "(user_id,school_id,category,channel) WHERE school_id IS NOT NULL";
    const values = schoolId === null
      ? [context.user.id, body.category, body.channel, body.enabled]
      : [context.user.id, schoolId, body.category, body.channel, body.enabled];
    const schoolValue = schoolId === null ? "NULL" : "$2";
    const categoryIndex = schoolId === null ? 2 : 3;
    const channelIndex = schoolId === null ? 3 : 4;
    const enabledIndex = schoolId === null ? 4 : 5;
    const result = await client.query(
      `INSERT INTO communication_preferences
         (user_id,school_id,category,channel,enabled)
       VALUES ($1,${schoolValue},$${categoryIndex},$${channelIndex},$${enabledIndex})
       ON CONFLICT ${conflict}
       DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()
       RETURNING id,school_id AS "schoolId",category,channel,enabled,
         (category IN ('ACCOUNT','SECURITY')) AS mandatory,
         to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`,
      values,
    );
    const preference = result.rows[0];
    await auditAction(
      client, context, schoolId, "changed notification preference",
      "COMMUNICATION_PREFERENCE_CHANGED", preference.id,
      { category: body.category, channel: body.channel, enabled: body.enabled },
    );
    await client.query("COMMIT");
    const { id: _id, ...publicPreference } = preference;
    res.json(publicPreference);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error, "Could not update communication preference");
  } finally {
    client.release();
  }
});

function publicDevice(row: Record<string, any>) {
  return {
    id: row.id,
    schoolId: row.schoolId ?? null,
    provider: row.provider,
    status: row.status,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

router.get("/communication/push-devices", async (req, res): Promise<void> => {
  try {
    const context = getUserContext(req);
    const schoolId = parseSchoolId(req.query.schoolId);
    await assertSchoolEntitlement(context, schoolId);
    let schoolFilter: string;
    const values: unknown[] = [context.user.id];
    if (schoolId !== null) {
      values.push(schoolId);
      schoolFilter = `d.school_id=$2`;
    } else if (isPlatformOwner(context)) {
      schoolFilter = "d.school_id IS NULL";
    } else {
      schoolFilter = `(d.school_id IS NULL OR (d.school_id IS NOT NULL
        AND ${activeSchoolEntitlementSql("$1", "d.school_id")}))`;
    }
    const result = await pool.query(
      `SELECT d.id,d.school_id AS "schoolId",d.provider,d.status,
         to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         CASE WHEN d.last_used_at IS NULL THEN NULL
           ELSE to_char(d.last_used_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "lastUsedAt",
         CASE WHEN d.revoked_at IS NULL THEN NULL
           ELSE to_char(d.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "revokedAt"
       FROM communication_push_devices d
       WHERE d.user_id=$1 AND d.status='ACTIVE' AND ${schoolFilter}
       ORDER BY d.created_at DESC,d.id DESC`,
      values,
    );
    res.json(result.rows.map(publicDevice));
  } catch (error) {
    fail(res, error, "Could not load push devices");
  }
});

router.post("/communication/push-devices", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const context = getUserContext(req);
    const body = req.body ?? {};
    assertBodyKeys(body, ["schoolId", "opaqueDeviceReference", "subscription"]);
    const schoolId = parseBodySchoolId(body.schoolId, true);
    await assertSchoolEntitlement(context, schoolId, client);
    const suppliedReference = body.opaqueDeviceReference;
    const parsed = body.subscription === undefined ? null : pushSubscriptionSchema.safeParse(body.subscription);
    if (parsed && !parsed.success) throw new AuthError(400, "Invalid push subscription");
    const subscription = parsed?.success ? parsed.data : null;
    const reference = subscription ? createHash("sha256").update(subscription.endpoint).digest("hex") : suppliedReference;
    if (subscription?.expirationTime && subscription.expirationTime <= Date.now()) throw new AuthError(400, "Subscription is expired");
    const sessionId = subscription ? getAuth(req).sessionId : null;
    if (subscription && !sessionId) throw new AuthError(401, "An active session is required");
    if (
      typeof reference !== "string"
      || reference.length < 1
      || reference.length > 256
      || /[\u0000-\u001f\u007f]/.test(reference)
    ) {
      throw new AuthError(400, "opaqueDeviceReference is invalid");
    }
    await client.query("BEGIN");
    if (subscription) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`push-endpoint:${reference}`]);
      // Account switching replaces ownership; retain the old school's device history.
      await client.query(`UPDATE communication_push_devices SET status='REVOKED',revoked_at=NOW()
        WHERE opaque_device_reference=$1 AND user_id<>$2 AND status='ACTIVE'`, [reference,context.user.id]);
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`${context.user.id}:${schoolId ?? "global"}`],
    );
    const existing = await client.query(
      `SELECT id,school_id AS "schoolId",provider,status,
         to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         to_char(last_used_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastUsedAt",
         NULL::text AS "revokedAt"
       FROM communication_push_devices
       WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2
         AND provider='WEB_PUSH' AND opaque_device_reference=$3 AND status='ACTIVE'
       LIMIT 1`,
      [context.user.id, schoolId, reference],
    );
    if (existing.rows[0]) {
      const refreshed = await client.query(
        `UPDATE communication_push_devices SET last_used_at=NOW(),
           subscription=COALESCE($3::jsonb,subscription),session_id=COALESCE($4,session_id)
         WHERE id=$1 AND user_id=$2 AND status='ACTIVE'
         RETURNING id,school_id AS "schoolId",provider,status,
           to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
           to_char(last_used_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastUsedAt",
           NULL::text AS "revokedAt"`,
        [existing.rows[0].id, context.user.id, subscription ? JSON.stringify(subscription) : null, sessionId],
      );
      await client.query("COMMIT");
      res.status(200).json(publicDevice(refreshed.rows[0]));
      return;
    }
    const recentRegistrations = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM communication_push_devices
       WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2
         AND created_at >= NOW() - INTERVAL '1 minute'`,
      [context.user.id, schoolId],
    );
    if ((recentRegistrations.rows[0]?.count ?? 0) >= MAX_PUSH_DEVICE_REGISTRATIONS_PER_MINUTE) {
      await client.query("ROLLBACK");
      res.status(429).json({ error: "Too many push device registrations. Try again in a minute." });
      return;
    }
    const activeDevices = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM communication_push_devices
       WHERE user_id=$1 AND school_id IS NOT DISTINCT FROM $2 AND status='ACTIVE'`,
      [context.user.id, schoolId],
    );
    if ((activeDevices.rows[0]?.count ?? 0) >= MAX_ACTIVE_PUSH_DEVICES_PER_SCOPE) {
      await client.query("ROLLBACK");
      res.status(429).json({ error: "Maximum active push devices reached for this scope." });
      return;
    }
    const conflict = schoolId === null
      ? "(user_id,provider,opaque_device_reference) WHERE school_id IS NULL AND status='ACTIVE'"
      : "(user_id,school_id,provider,opaque_device_reference) WHERE school_id IS NOT NULL AND status='ACTIVE'";
    const values = schoolId === null
      ? [context.user.id, reference]
      : [context.user.id, schoolId, reference];
    const schoolValue = schoolId === null ? "NULL" : "$2";
    const deviceValue = schoolId === null ? "$2" : "$3";
    const result = await client.query(
      `INSERT INTO communication_push_devices
         (user_id,school_id,provider,opaque_device_reference,status,last_used_at,subscription,session_id)
       VALUES ($1,${schoolValue},'WEB_PUSH',${deviceValue},'ACTIVE',NOW(),$${values.length + 1}::jsonb,$${values.length + 2})
       ON CONFLICT ${conflict}
       DO UPDATE SET last_used_at=NOW(),subscription=COALESCE(EXCLUDED.subscription,communication_push_devices.subscription),
         session_id=COALESCE(EXCLUDED.session_id,communication_push_devices.session_id)
       RETURNING id,school_id AS "schoolId",provider,status,
         to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
         to_char(last_used_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastUsedAt",
         NULL::text AS "revokedAt"`,
      [...values, subscription ? JSON.stringify(subscription) : null, sessionId],
    );
    const device = result.rows[0];
    await auditAction(
      client, context, schoolId, "registered push device",
      "COMMUNICATION_PUSH_DEVICE_REGISTERED", device.id,
    );
    await client.query("COMMIT");
    res.status(201).json(publicDevice(device));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error, "Could not register push device");
  } finally {
    client.release();
  }
});

router.delete("/communication/push-devices/:deviceId", async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const context = getUserContext(req);
    const deviceId = parsePositiveId(req.params.deviceId, "Push device");
    const rawSchoolId = req.query.schoolId;
    const schoolId = parseSchoolId(rawSchoolId);
    await assertSchoolEntitlement(context, schoolId, client);
    let schoolFilter: string;
    const values: unknown[] = [deviceId, context.user.id];
    if (schoolId !== null) {
      values.push(schoolId);
      schoolFilter = "school_id=$3";
    } else if (isPlatformOwner(context)) {
      schoolFilter = "school_id IS NULL";
    } else {
      schoolFilter = `(school_id IS NULL OR (school_id IS NOT NULL
        AND ${activeSchoolEntitlementSql("$2", "school_id")}))`;
    }
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE communication_push_devices
       SET status='REVOKED',revoked_at=NOW()
       WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND ${schoolFilter}
       RETURNING id,school_id AS "schoolId"`,
      values,
    );
    if (!result.rows[0]) throw new AuthError(404, "Push device not found");
    await auditAction(
      client, context, result.rows[0].schoolId ?? null,
      "revoked push device", "COMMUNICATION_PUSH_DEVICE_REVOKED", deviceId,
    );
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    fail(res, error, "Could not revoke push device");
  } finally {
    client.release();
  }
});

export default router;