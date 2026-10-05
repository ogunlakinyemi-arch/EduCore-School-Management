import { createHash } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type UserContext,
} from "../middlewares/auth";
import { queueCommunicationNotification } from "../services/communication-service";
import {
  communicationChannelAvailabilityResponseSchema,
  parentCommunicationChildrenResponseSchema,
  parentCreateThreadInputSchema,
  parentThreadDetailResponseSchema,
  parentThreadListResponseSchema,
  parentThreadMutationResponseSchema,
  parentThreadMessagesQuerySchema,
  parentThreadQuerySchema,
  parentThreadArchiveResponseSchema,
  parentThreadReadResponseSchema,
  replyThreadInputSchema,
  staffCreateThreadInputSchema,
} from "../services/parent-communication";

const router = Router();
router.use(requireAuthentication());

export type ParentCommunicationSecurityPermission = "COMMUNICATION_SEND" | "EMERGENCY_BROADCAST";
export type ParentCommunicationSecurityAccess = (
  req: Request,
  schoolId: number,
  permission: ParentCommunicationSecurityPermission,
  options?: { ownerReadOnly?: boolean },
) => Promise<UserContext>;

let securityPermissionCheck: ParentCommunicationSecurityAccess | undefined;

/** Main router-registration hook: pass the shared core security permission helper here. */
export function createParentCommunicationRouter(requireSecurityAccess: ParentCommunicationSecurityAccess) {
  securityPermissionCheck = requireSecurityAccess;
  return router;
}

const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(error => handleAuthError(error, req, res, next));

type DbClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
  release?: () => void;
};

type Side = "PARENT" | "SCHOOL";

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError(400, result.error.issues[0]?.message ?? "Request validation failed");
  return result.data;
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new AuthError(404, `${label} not found`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new AuthError(404, `${label} not found`);
  return result;
}

function hasRole(req: Request, role: string, schoolId?: number) {
  return getUserContext(req).roles.some(item =>
    item.status === "ACTIVE" && item.role === role && (schoolId === undefined || item.schoolId === schoolId),
  );
}

function requireParentRole(req: Request) {
  if (!hasRole(req, "PARENT")) throw new AuthError(404, "Resource not found");
  return getUserContext(req);
}

function existingStaffRole(req: Request, schoolId: number) {
  const context = getUserContext(req);
  const roles = new Set(context.roles
    .filter(item => item.schoolId === schoolId && item.status === "ACTIVE")
    .map(item => item.role));
  if (roles.has("SCHOOL_ADMIN")) return "SCHOOL_ADMIN";
  if (roles.has("TEACHER")) return "TEACHER";
  if (roles.has("ACCOUNTANT")) return "ACCOUNTANT";
  if (roles.has("STAFF")) return "STAFF";
  throw new AuthError(404, "Resource not found");
}

async function requireCommunicationStaffAccess(
  req: Request,
  schoolId: number,
  studentId: number,
  category: string,
  permission: ParentCommunicationSecurityPermission = "COMMUNICATION_SEND",
) {
  const role = existingStaffRole(req, schoolId);
  if (role === "SCHOOL_ADMIN") {
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    return role;
  }
  if (role === "ACCOUNTANT") {
    if (category !== "FINANCE") throw new AuthError(404, "Resource not found");
    assertSchoolOperationalAccess(req, schoolId, ["ACCOUNTANT"]);
    return role;
  }
  if (category === "FINANCE") throw new AuthError(404, "Resource not found");
  if (!securityPermissionCheck) {
    throw new AuthError(503, "School communication permission service is unavailable");
  }
  await securityPermissionCheck(req, schoolId, permission, { ownerReadOnly: false });
  if (role === "TEACHER") {
    await assertTeacherAssigned(pool, getUserContext(req).user.id, schoolId, studentId);
  } else if (role === "STAFF") {
    await assertStaffStudentAssignment(pool, getUserContext(req).user.id, schoolId, studentId);
  }
  return role;
}

export function currentTeacherAssignmentSql(studentIdExpr: string, schoolIdExpr: string, userIdExpr: string) {
  return `EXISTS (
    SELECT 1
    FROM students assigned_student
    JOIN student_class_assignments sca ON sca.student_id=assigned_student.id
      AND sca.school_id=assigned_student.school_id
      AND sca.status='ACTIVE' AND sca.is_current=true
    JOIN teacher_class_assignments tca ON tca.school_id=sca.school_id
      AND tca.school_class_id=sca.school_class_id AND (tca.section='' OR tca.section=sca.section)
      AND tca.academic_session_id=sca.academic_session_id
      AND tca.status='ACTIVE'
    JOIN academic_sessions current_session ON current_session.id=tca.academic_session_id
      AND current_session.school_id=tca.school_id AND current_session.is_current=true
      AND tca.start_date<=COALESCE(current_session.end_date,CURRENT_DATE)
      AND (tca.end_date IS NULL OR tca.end_date>=current_session.start_date)
    JOIN employees teacher ON teacher.id=tca.employee_id AND teacher.school_id=tca.school_id
      AND teacher.user_id=${userIdExpr} AND UPPER(teacher.employment_status)='ACTIVE'
      AND UPPER(teacher.employee_type)='TEACHER'
    WHERE assigned_student.id=${studentIdExpr} AND assigned_student.school_id=${schoolIdExpr}
      AND LOWER(assigned_student.status)='active'
  )`;
}

async function assertLiveParentChild(
  db: DbClient,
  parentUserId: number,
  studentId: number,
  schoolId?: number,
) {
  const result = await db.query(
    `SELECT st.school_id AS "schoolId",st.id AS "studentId",st.first_name AS "firstName",
       st.last_name AS "lastName",school.name AS "schoolName",
       current_enrollment.school_class_id AS "classId",
       current_enrollment.section AS section,
       class.name AS "className"
     FROM parents p
     JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
     JOIN students st ON st.id=rel.student_id
       AND LOWER(st.status)='active'
     JOIN schools school ON school.id=st.school_id AND LOWER(school.status)='active'
     JOIN app_users parent_user ON parent_user.id=p.user_id AND parent_user.status='ACTIVE'
     LEFT JOIN student_class_assignments current_enrollment
       ON current_enrollment.student_id=st.id AND current_enrollment.school_id=st.school_id
       AND current_enrollment.status='ACTIVE' AND current_enrollment.is_current=true
     LEFT JOIN school_classes class ON class.id=current_enrollment.school_class_id
       AND class.school_id=current_enrollment.school_id AND class.section=current_enrollment.section
     WHERE p.user_id=$1 AND st.id=$2 AND ($3::int IS NULL OR st.school_id=$3) AND ${familyChildSchoolScope()}
       AND p.status='ACTIVE'
     LIMIT 1`,
    [parentUserId, studentId, schoolId ?? null],
  );
  return result.rows[0] ?? null;
}

async function assertTeacherAssigned(db: DbClient, teacherUserId: number, schoolId: number, studentId: number) {
  const result = await db.query(
    `SELECT 1 WHERE ${currentTeacherAssignmentSql("$1", "$2", "$3")}`,
    [studentId, schoolId, teacherUserId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student communication thread not found");
}

async function assertStaffStudentAssignment(db: DbClient, staffUserId: number, schoolId: number, studentId: number) {
  const result = await db.query(
    `SELECT 1
       FROM student_welfare_records assignment
       JOIN students st ON st.id=assignment.student_id AND st.school_id=assignment.school_id
         AND LOWER(st.status)='active'
      WHERE assignment.school_id=$1 AND assignment.student_id=$2
        AND assignment.assigned_staff_user_id=$3
        AND assignment.status IN ('OPEN','IN_PROGRESS') AND assignment.archived_at IS NULL
      LIMIT 1`,
    [schoolId, studentId, staffUserId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student communication thread not found");
}

async function writeAudit(
  db: DbClient,
  req: Request,
  schoolId: number,
  action: string,
  eventType: string,
  recordId: number,
  metadata: Record<string, unknown> = {},
) {
  const context = getUserContext(req);
  const role = context.roles.find(item => item.schoolId === schoolId && item.status === "ACTIVE")?.role ?? "PARENT";
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Parent Communication',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      role, context.user.id, context.user.clerkUserId, schoolId, action, recordId, eventType, JSON.stringify(metadata),
    ],
  );
}

const threadSummarySql = `SELECT t.id,t.school_id AS "schoolId",t.student_id AS "studentId",
    concat_ws(' ',st.first_name,st.last_name) AS "childName",school.name AS "schoolName",
    t.subject,t.category,
    to_char(t.last_message_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastMessageAt",
    CASE WHEN $1::text='PARENT' THEN
      (SELECT COUNT(*)::int FROM communication_messages unread
       WHERE unread.thread_id=t.id AND unread.sender_user_id<>t.parent_user_id
         AND (t.parent_last_read_at IS NULL OR unread.created_at>t.parent_last_read_at))
      ELSE
      (SELECT COUNT(*)::int FROM communication_messages unread
       WHERE unread.thread_id=t.id AND unread.sender_user_id=t.parent_user_id
         AND (t.school_last_read_at IS NULL OR unread.created_at>t.school_last_read_at))
    END AS "unreadCount",
    CASE WHEN $1::text='PARENT' THEN t.parent_archived_at IS NOT NULL
      ELSE t.school_archived_at IS NOT NULL END AS archived
  FROM communication_message_threads t
  JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id AND LOWER(st.status)='active'
  JOIN schools school ON school.id=t.school_id`;

async function loadThreadSummary(db: DbClient, threadId: number, side: Side) {
  const result = await db.query(`${threadSummarySql} WHERE t.id=$2`, [side, threadId]);
  return result.rows[0] ?? null;
}

async function authorizeThread(req: Request, db: DbClient, threadId: number): Promise<{ thread: any; side: Side; role: string }> {
  const context = getUserContext(req);
  const result = await db.query(
    `SELECT t.id,t.school_id AS "schoolId",t.student_id AS "studentId",
       t.parent_user_id AS "parentUserId",t.category
     FROM communication_message_threads t
     JOIN students st ON st.id=t.student_id AND st.school_id=t.school_id
       AND LOWER(st.status)='active'
     WHERE t.id=$1`,
    [threadId],
  );
  const thread = result.rows[0];
  if (!thread) throw new AuthError(404, "Message thread not found");
  if (Number(thread.parentUserId) === context.user.id && hasRole(req, "PARENT")) {
    const liveRelation = await assertLiveParentChild(db, context.user.id, Number(thread.studentId), Number(thread.schoolId));
    if (!liveRelation) throw new AuthError(404, "Message thread not found");
    return { thread, side: "PARENT", role: "PARENT" };
  }
  const role = await requireCommunicationStaffAccess(
    req,
    Number(thread.schoolId),
    Number(thread.studentId),
    thread.category,
  );
  return { thread, side: "SCHOOL", role };
}

function hashed(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function createInitialThread(
  req: Request,
  input: {
    schoolId: number;
    studentId: number;
    studentName: string;
    classId: number | null;
    parentUserId: number;
    subject: string;
    category: "GENERAL" | "ACADEMIC" | "ASSIGNMENT" | "FINANCE";
    body: string;
    idempotencyKey: string;
    actorSide: Side;
  },
) {
  const client = await pool.connect() as DbClient;
  let isIdempotent = false;
  try {
    await client.query("BEGIN");
    const requestHash = hashed([
      input.schoolId, input.studentId, input.parentUserId, input.subject, input.category, input.body, input.actorSide,
    ]);
    const created = await client.query(
      `INSERT INTO communication_message_threads
        (school_id,student_id,subject_class_id,parent_user_id,created_by_user_id,request_key,request_hash,subject,category)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(school_id,created_by_user_id,request_key) DO NOTHING
       RETURNING id`,
      [
        input.schoolId, input.studentId, input.classId, input.parentUserId,
        getUserContext(req).user.id, input.idempotencyKey, requestHash, input.subject, input.category,
      ],
    );
    let threadId = Number(created.rows[0]?.id);
    if (!threadId) {
      const existing = await client.query(
        `SELECT id,request_hash AS "requestHash" FROM communication_message_threads
         WHERE school_id=$1 AND created_by_user_id=$2 AND request_key=$3 FOR UPDATE`,
        [input.schoolId, getUserContext(req).user.id, input.idempotencyKey],
      );
      if (!existing.rows[0]) throw new AuthError(409, "Message request could not be reconciled");
      if (existing.rows[0].requestHash !== requestHash) throw new AuthError(409, "Idempotency key is already in use");
      threadId = Number(existing.rows[0].id);
      isIdempotent = true;
    } else {
      const message = await client.query(
        `INSERT INTO communication_messages
          (thread_id,school_id,sender_user_id,request_key,content_hash,body)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          threadId, input.schoolId, getUserContext(req).user.id,
          input.idempotencyKey, hashed(input.body), input.body,
        ],
      );
      await client.query(
        `UPDATE communication_message_threads SET last_message_at=NOW(),updated_at=NOW(),
           ${input.actorSide === "PARENT" ? "school_archived_at=NULL" : "parent_archived_at=NULL"}
         WHERE id=$1 AND school_id=$2`,
        [threadId, input.schoolId],
      );
      await notifyThreadCounterpart(client, input, threadId, Number(message.rows[0].id), input.actorSide);
      await writeAudit(
        client, req, input.schoolId, "Created parent communication thread",
        "PARENT_COMMUNICATION_THREAD_CREATED", threadId,
        { studentId: input.studentId, category: input.category, actorSide: input.actorSide },
      );
    }
    const summary = await loadThreadSummary(client, threadId, input.actorSide);
    const messageRows = await client.query(
      `SELECT id,CASE WHEN sender_user_id=$2 THEN 'PARENT' ELSE 'SCHOOL' END AS "senderRole",
          body,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
       FROM communication_messages WHERE thread_id=$1 ORDER BY id DESC LIMIT 1`,
      [threadId, input.parentUserId],
    );
    const payload = parentThreadMutationResponseSchema.parse({
      thread: summary,
      message: messageRows.rows[0],
      idempotent: isIdempotent,
    });
    await client.query("COMMIT");
    return payload;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

async function notifyThreadCounterpart(
  db: DbClient,
  input: {
    schoolId: number;
    studentId: number;
    studentName: string;
    classId: number | null;
    parentUserId: number;
    category: "GENERAL" | "ACADEMIC" | "ASSIGNMENT" | "FINANCE";
    body: string;
  },
  threadId: number,
  messageId: number,
  actorSide: Side,
) {
  if (actorSide === "SCHOOL") {
    await queueCommunicationNotification(db, {
      recipientUserId: input.parentUserId,
      schoolId: input.schoolId,
      subjectStudentId: input.studentId,
      subjectClassId: input.classId,
      category: input.category === "FINANCE" ? "FINANCE" : "ANNOUNCEMENT",
      eventKey: `PARENT_COMMUNICATION_MESSAGE:${messageId}:${input.studentId}:${input.parentUserId}`,
      subject: `${input.studentName} — ${input.category.toLowerCase()} message`,
      body: `A new school message is available for ${input.studentName}.`,
      link: `/communication/threads/${threadId}`,
      channels: ["IN_APP", "SMS", "EMAIL"],
    });
    return;
  }
  const allowedSchoolRoles = input.category === "FINANCE" ? "'SCHOOL_ADMIN','ACCOUNTANT'" : "'SCHOOL_ADMIN'";
  const administrators = await db.query(
    `SELECT DISTINCT sm.user_id AS "userId"
     FROM school_memberships sm
     JOIN app_users u ON u.id=sm.user_id AND u.status='ACTIVE'
     WHERE sm.school_id=$1 AND sm.status='ACTIVE'
       AND sm.role IN (${allowedSchoolRoles})
       AND NOT EXISTS (
         SELECT 1 FROM school_memberships owner_role WHERE owner_role.user_id=sm.user_id
           AND owner_role.school_id IS NULL AND owner_role.role='PLATFORM_OWNER' AND owner_role.status='ACTIVE'
       )`,
    [input.schoolId],
  );
  for (const recipient of administrators.rows) {
    await queueCommunicationNotification(db, {
      recipientUserId: Number(recipient.userId),
      schoolId: input.schoolId,
      subjectStudentId: input.studentId,
      subjectClassId: input.classId,
      category: input.category === "FINANCE" ? "FINANCE" : "ANNOUNCEMENT",
      eventKey: `PARENT_COMMUNICATION_MESSAGE:${messageId}:${input.studentId}:${recipient.userId}`,
      subject: `${input.studentName} — new parent message`,
      body: `A parent sent a new ${input.category.toLowerCase()} message about ${input.studentName}.`,
      link: `/communication/threads/${threadId}`,
      channels: ["IN_APP"],
    });
  }
}

router.get("/communication/channels", asyncRoute(async (_req, res) => {
  const env = process.env;
  const smsConfigured = env.COMMUNICATION_SMS_PROVIDER?.trim().toLowerCase() === "termii"
    && Boolean(env.TERMII_API_KEY?.trim() && env.TERMII_SENDER_ID?.trim());
  const emailConfigured = (env.COMMUNICATION_EMAIL_PROVIDER?.trim().toLowerCase() === "http"
    && Boolean(env.COMMUNICATION_EMAIL_API_KEY?.trim() && env.COMMUNICATION_EMAIL_ENDPOINT?.trim())) ||
    (env.COMMUNICATION_EMAIL_PROVIDER?.trim().toLowerCase() === "resend" && Boolean(env.RESEND_API_KEY && env.EMAIL_FROM));
  const pushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  res.json(communicationChannelAvailabilityResponseSchema.parse({
    channels: [
      { channel: "IN_APP", available: true, status: "AVAILABLE", detail: "In-app notifications are stored in the authenticated inbox." },
      { channel: "PUSH", available: pushConfigured, status: pushConfigured ? "AVAILABLE" : "CONFIGURATION_REQUIRED",
        detail: pushConfigured ? "Web Push is configured; permission and an active device subscription are still required." : "VAPID settings are missing; no push can be sent." },
      { channel: "SMS", available: smsConfigured, status: smsConfigured ? "AVAILABLE" : "CONFIGURATION_REQUIRED",
        detail: smsConfigured ? "Termii credentials and sender ID are configured; provider acceptance is not delivery." : "SMS provider not configured." },
      { channel: "EMAIL", available: emailConfigured, status: emailConfigured ? "AVAILABLE" : "CONFIGURATION_REQUIRED",
        detail: emailConfigured ? "Email provider endpoint and credentials are configured; provider acceptance is not delivery." : "Email provider not configured." },
    ],
  }));
}));

router.get("/communication/children", asyncRoute(async (req, res) => {
  const context = requireParentRole(req);
  const query = parse(parentThreadQuerySchema, req.query);
  const result = await pool.query(
    `SELECT DISTINCT st.id AS "studentId",st.school_id AS "schoolId",school.name AS "schoolName",
       st.first_name AS "firstName",st.last_name AS "lastName",
       current_enrollment.section AS section,class.name AS "className"
     FROM parents p
     JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
     JOIN students st ON st.id=rel.student_id AND LOWER(st.status)='active'
     JOIN schools school ON school.id=st.school_id AND LOWER(school.status)='active'
     LEFT JOIN student_class_assignments current_enrollment
       ON current_enrollment.student_id=st.id AND current_enrollment.school_id=st.school_id
       AND current_enrollment.status='ACTIVE' AND current_enrollment.is_current=true
     LEFT JOIN school_classes class ON class.id=current_enrollment.school_class_id
       AND class.school_id=current_enrollment.school_id AND class.section=current_enrollment.section
     WHERE p.user_id=$1 AND p.status='ACTIVE' AND ($2::int IS NULL OR st.school_id=$2) AND ${familyChildSchoolScope()}
     ORDER BY st.school_id,st.last_name,st.first_name,st.id`,
    [context.user.id, query.schoolId ?? null],
  );
  res.json(parentCommunicationChildrenResponseSchema.parse({ children: result.rows }));
}));

router.post("/communication/parent/threads", asyncRoute(async (req, res) => {
  const context = requireParentRole(req);
  const input = parse(parentCreateThreadInputSchema, req.body);
  const child = await assertLiveParentChild(pool, context.user.id, input.studentId);
  if (!child) throw new AuthError(404, "Student not found");
  const response = await createInitialThread(req, {
    schoolId: Number(child.schoolId),
    studentId: Number(child.studentId),
    studentName: `${child.firstName} ${child.lastName}`.trim(),
    classId: child.classId == null ? null : Number(child.classId),
    parentUserId: context.user.id,
    subject: input.subject,
    category: input.category,
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    actorSide: "PARENT",
  });
  res.status(response.idempotent ? 200 : 201).json(response);
}));

router.post("/communication/threads", asyncRoute(async (req, res) => {
  const input = parse(staffCreateThreadInputSchema, req.body);
  const role = await requireCommunicationStaffAccess(
    req, input.schoolId, input.studentId, input.category,
  );
  const child = await assertLiveParentChild(pool, input.parentUserId, input.studentId, input.schoolId);
  if (!child) throw new AuthError(404, "Student or parent recipient not found");
  const response = await createInitialThread(req, {
    schoolId: input.schoolId,
    studentId: input.studentId,
    studentName: `${child.firstName} ${child.lastName}`.trim(),
    classId: child.classId == null ? null : Number(child.classId),
    parentUserId: input.parentUserId,
    subject: input.subject,
    category: input.category,
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    actorSide: "SCHOOL",
  });
  res.status(response.idempotent ? 200 : 201).json(response);
}));

router.get("/communication/students", asyncRoute(async (req,res) => {
  const school = positiveId(String(req.query.schoolId ?? ""),"School");
  const role = existingStaffRole(req,school);
  if (!["SCHOOL_ADMIN","TEACHER"].includes(role)) throw new AuthError(404,"Resource not found");
  if (role === "SCHOOL_ADMIN") assertSchoolOperationalAccess(req,school,["SCHOOL_ADMIN"]);
  else {
    if (!securityPermissionCheck) throw new AuthError(503,"Communication permissions unavailable");
    await securityPermissionCheck(req,school,"COMMUNICATION_SEND",{ownerReadOnly:false});
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0,150) : "";
  const result = await pool.query(`SELECT st.id,st.admission_no AS "admissionNo",
    st.first_name AS "firstName",st.last_name AS "lastName",c.name AS "className",sca.section
    FROM students st JOIN student_class_assignments sca ON sca.student_id=st.id AND sca.school_id=st.school_id
      AND sca.status='ACTIVE' AND sca.is_current=true
    JOIN academic_sessions ac ON ac.id=sca.academic_session_id AND ac.school_id=sca.school_id AND ac.is_current=true
    JOIN school_classes c ON c.id=sca.school_class_id AND c.school_id=sca.school_id
    WHERE st.school_id=$1 AND LOWER(st.status)='active'
      AND ($3::boolean OR ${currentTeacherAssignmentSql("st.id","st.school_id","$2")})
      AND ($4='' OR concat_ws(' ',st.first_name,st.last_name,st.admission_no) ILIKE '%' || $4 || '%')
    ORDER BY st.last_name,st.first_name,st.id`,[school,getUserContext(req).user.id,role==="SCHOOL_ADMIN",search]);
  res.json(result.rows);
}));
router.get("/communication/students/:studentId/guardians", asyncRoute(async (req,res) => {
  const school = positiveId(String(req.query.schoolId ?? ""),"School"),student = positiveId(String(req.params.studentId),"Student");
  await requireCommunicationStaffAccess(req,school,student,"GENERAL");
  const found = await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2 AND LOWER(status)='active'`,[student,school]);
  if (!found.rows.length) throw new AuthError(404,"Student not found");
  const parents = await pool.query(`SELECT DISTINCT u.id AS "userId",u.first_name AS "firstName",u.last_name AS "lastName"
    FROM parent_student_relationships rel JOIN parents p ON p.id=rel.parent_id AND p.status='ACTIVE'
    JOIN students st ON st.id=rel.student_id AND st.school_id=$2 AND LOWER(st.status)='active'
    JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
    WHERE rel.student_id=$1 AND rel.status='ACTIVE' AND ${familyChildSchoolScope()}
    ORDER BY u.id`,[student,school]);
  res.json(parents.rows);
}));

async function listThreads(
  req: Request,
  side: Side,
  query: ReturnType<typeof parentThreadQuerySchema.parse>,
  schoolRole?: string,
) {
  const context = getUserContext(req);
  const values: unknown[] = [side];
  const filters = ["LOWER(st.status)='active'"];
  if (side === "PARENT") {
    values.push(context.user.id);
    filters.push(`t.parent_user_id=$${values.length}`);
    filters.push(`EXISTS (
      SELECT 1 FROM parents p
      JOIN parent_student_relationships rel ON rel.parent_id=p.id AND rel.status='ACTIVE'
      WHERE p.user_id=$${values.length} AND p.status='ACTIVE'
        AND rel.student_id=t.student_id AND ${familyChildSchoolScope()}
    )`);
    if (query.schoolId !== undefined) {
      values.push(query.schoolId);
      filters.push(`t.school_id=$${values.length}`);
    }
    if (query.childId !== undefined) {
      values.push(query.childId);
      filters.push(`t.student_id=$${values.length}`);
    }
    if (query.includeArchived !== "true") filters.push("t.parent_archived_at IS NULL");
  } else {
    values.push(query.schoolId);
    filters.push(`t.school_id=$${values.length}`);
    if (query.childId !== undefined) {
      values.push(query.childId);
      filters.push(`t.student_id=$${values.length}`);
    }
    if (schoolRole === "ACCOUNTANT") filters.push("t.category='FINANCE'");
    if (schoolRole === "TEACHER") {
      values.push(context.user.id);
      filters.push(currentTeacherAssignmentSql("t.student_id", "t.school_id", `$${values.length}`));
      filters.push("t.category<>'FINANCE'");
    }
    if (schoolRole === "STAFF") {
      values.push(query.childId);
      filters.push(`t.student_id=$${values.length}`);
      filters.push("t.category<>'FINANCE'");
    }
    if (query.includeArchived !== "true") filters.push("t.school_archived_at IS NULL");
  }
  if (query.search) {
    values.push(`%${query.search.replace(/[\\%_]/g, "\\$&")}%`);
    const searchParam = `$${values.length}`;
    filters.push(`(t.subject ILIKE ${searchParam} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM communication_messages matching_message
        WHERE matching_message.thread_id=t.id AND matching_message.body ILIKE ${searchParam} ESCAPE '\\'))`);
  }
  if (query.beforeId !== undefined) {
    values.push(query.beforeId);
    filters.push(`t.id<$${values.length}`);
  }
  values.push(query.limit + 1);
  return pool.query(
    `${threadSummarySql} WHERE ${filters.join(" AND ")}
     ORDER BY t.id DESC LIMIT $${values.length}`,
    values,
  );
}

router.get("/communication/parent/threads", asyncRoute(async (req, res) => {
  requireParentRole(req);
  const query = parse(parentThreadQuerySchema, req.query);
  const result = await listThreads(req, "PARENT", query);
  const hasMore = result.rows.length > query.limit;
  const items = result.rows.slice(0, query.limit);
  const payload = parentThreadListResponseSchema.parse({
    items,
    hasMore,
    nextBeforeId: hasMore ? Number(items[items.length - 1]?.id) : null,
  });
  res.json(payload);
}));

router.get("/communication/threads", asyncRoute(async (req, res) => {
  const query = parse(parentThreadQuerySchema, req.query);
  if (query.schoolId === undefined) throw new AuthError(400, "schoolId is required");
  const role = existingStaffRole(req, query.schoolId);
  if (role === "TEACHER" || role === "STAFF") {
    if (query.childId === undefined) throw new AuthError(400, "childId is required for scoped staff access");
    const verifiedRole = await requireCommunicationStaffAccess(
      req, query.schoolId, query.childId, "GENERAL",
    );
    if (verifiedRole === "TEACHER") {
      await assertTeacherAssigned(pool, getUserContext(req).user.id, query.schoolId, query.childId);
    }
  } else {
    await requireCommunicationStaffAccess(
      req, query.schoolId, query.childId ?? 1, role === "ACCOUNTANT" ? "FINANCE" : "GENERAL",
    );
  }
  const result = await listThreads(req, "SCHOOL", query, role);
  const hasMore = result.rows.length > query.limit;
  const items = result.rows.slice(0, query.limit);
  res.json(parentThreadListResponseSchema.parse({
    items,
    hasMore,
    nextBeforeId: hasMore ? Number(items[items.length - 1]?.id) : null,
  }));
}));

router.get("/communication/threads/:threadId", asyncRoute(async (req, res) => {
  const threadId = positiveId(req.params.threadId, "Message thread");
  const { thread, side } = await authorizeThread(req, pool, threadId);
  const query = parse<{
    beforeMessageId?: number;
    limit: number;
  }>(parentThreadMessagesQuerySchema, req.query);
  const values: unknown[] = [threadId, thread.parentUserId];
  let before = "";
  if (query.beforeMessageId !== undefined) {
    values.push(query.beforeMessageId);
    before = `AND id<$${values.length}`;
  }
  values.push(query.limit + 1);
  const result = await pool.query(
    `SELECT id,CASE WHEN sender_user_id=$2 THEN 'PARENT' ELSE 'SCHOOL' END AS "senderRole",
       body,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
     FROM communication_messages WHERE thread_id=$1 ${before}
     ORDER BY id DESC LIMIT $${values.length}`,
    values,
  );
  const hasMoreMessages = result.rows.length > query.limit;
  const messages = result.rows.slice(0, query.limit).reverse();
  const summary = await loadThreadSummary(pool, threadId, side);
  res.json(parentThreadDetailResponseSchema.parse({
    ...summary,
    messages,
    hasMoreMessages,
    nextBeforeMessageId: hasMoreMessages ? Number(messages[0]?.id) : null,
  }));
}));

router.post("/communication/threads/:threadId/messages", asyncRoute(async (req, res) => {
  const threadId = positiveId(req.params.threadId, "Message thread");
  const input = parse(replyThreadInputSchema, req.body);
  const client = await pool.connect() as DbClient;
  let response: any;
  try {
    await client.query("BEGIN");
    const access = await authorizeThread(req, client, threadId);
    if (access.role === "ACCOUNTANT" && access.thread.category !== "FINANCE") {
      throw new AuthError(404, "Message thread not found");
    }
    const context = getUserContext(req);
    const contentHash = hashed(input.body);
    const inserted = await client.query(
      `INSERT INTO communication_messages
        (thread_id,school_id,sender_user_id,request_key,content_hash,body)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(thread_id,sender_user_id,request_key) DO NOTHING
       RETURNING id,sender_user_id AS "senderUserId",body,
         to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`,
      [threadId, access.thread.schoolId, context.user.id, input.idempotencyKey, contentHash, input.body],
    );
    let message = inserted.rows[0];
    let idempotent = false;
    if (!message) {
      const existing = await client.query(
        `SELECT id,sender_user_id AS "senderUserId",content_hash AS "contentHash",body,
           to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
         FROM communication_messages
         WHERE thread_id=$1 AND sender_user_id=$2 AND request_key=$3`,
        [threadId, context.user.id, input.idempotencyKey],
      );
      message = existing.rows[0];
      if (!message || message.contentHash !== contentHash) {
        throw new AuthError(409, "Message idempotency key is already in use");
      }
      idempotent = true;
    } else {
      const actorSide = access.side;
      const receiverArchive = actorSide === "PARENT" ? "school_archived_at=NULL" : "parent_archived_at=NULL";
      const senderRead = actorSide === "PARENT" ? "parent_last_read_at=NOW()" : "school_last_read_at=NOW()";
      await client.query(
        `UPDATE communication_message_threads
           SET last_message_at=NOW(),updated_at=NOW(),${receiverArchive},${senderRead}
         WHERE id=$1 AND school_id=$2`,
        [threadId, access.thread.schoolId],
      );
      const current = await assertLiveParentChild(
        client, Number(access.thread.parentUserId), Number(access.thread.studentId), Number(access.thread.schoolId),
      );
      if (!current) throw new AuthError(404, "Message thread not found");
      await notifyThreadCounterpart(client, {
        schoolId: Number(access.thread.schoolId),
        studentId: Number(access.thread.studentId),
        studentName: `${current.firstName} ${current.lastName}`.trim(),
        classId: current.classId == null ? null : Number(current.classId),
        parentUserId: Number(access.thread.parentUserId),
        category: access.thread.category,
        body: input.body,
      }, threadId, Number(message.id), actorSide);
      await writeAudit(
        client, req, Number(access.thread.schoolId), "Replied to parent communication thread",
        "PARENT_COMMUNICATION_MESSAGE_CREATED", threadId,
        { messageId: Number(message.id), studentId: Number(access.thread.studentId), actorSide },
      );
    }
    const summary = await loadThreadSummary(client, threadId, access.side);
    const safeMessage = {
      id: Number(message.id),
      senderRole: Number(message.senderUserId) === Number(access.thread.parentUserId) ? "PARENT" : "SCHOOL",
      body: message.body,
      createdAt: message.createdAt,
    };
    response = parentThreadMutationResponseSchema.parse({ thread: summary, message: safeMessage, idempotent });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
  res.status(response.idempotent ? 200 : 201).json(response);
}));

router.patch("/communication/threads/:threadId/read", asyncRoute(async (req, res) => {
  const threadId = positiveId(req.params.threadId, "Message thread");
  const client = await pool.connect() as DbClient;
  let payload: unknown;
  try {
    await client.query("BEGIN");
    const { thread, side } = await authorizeThread(req, client, threadId);
    const readColumn = side === "PARENT" ? "parent_last_read_at" : "school_last_read_at";
    await client.query(
      `UPDATE communication_message_threads SET ${readColumn}=NOW(),updated_at=NOW()
       WHERE id=$1 AND school_id=$2`,
      [threadId, thread.schoolId],
    );
    const summary = await loadThreadSummary(client, threadId, side);
    const readAt = await client.query(
      `SELECT to_char(${readColumn} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "readAt"
       FROM communication_message_threads WHERE id=$1`,
      [threadId],
    );
    payload = parentThreadReadResponseSchema.parse({ thread: summary, readAt: readAt.rows[0]?.readAt });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
  res.json(payload);
}));

router.patch("/communication/threads/:threadId/archive", asyncRoute(async (req, res) => {
  const threadId = positiveId(req.params.threadId, "Message thread");
  const client = await pool.connect() as DbClient;
  let payload: unknown;
  try {
    await client.query("BEGIN");
    const { thread, side } = await authorizeThread(req, client, threadId);
    const archiveColumn = side === "PARENT" ? "parent_archived_at" : "school_archived_at";
    await client.query(
      `UPDATE communication_message_threads SET ${archiveColumn}=NOW(),updated_at=NOW()
       WHERE id=$1 AND school_id=$2`,
      [threadId, thread.schoolId],
    );
    await writeAudit(
      client, req, Number(thread.schoolId), "Archived parent communication thread",
      "PARENT_COMMUNICATION_THREAD_ARCHIVED", threadId, { side },
    );
    payload = parentThreadArchiveResponseSchema.parse({ threadId, archived: true });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
  res.json(payload);
}));

export default router;