import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  isPlatformOwner,
  requireAuthentication,
} from "../middlewares/auth";
import {
  queueCommunicationNotification,
  type CommunicationQueryClient,
} from "../services/communication-service";
import { logger } from "../lib/logger";
import employeeNfcRouter from "./employee-nfc";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);

function assertCardAccess(req: Request, schoolId: number) {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) return context;
  return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "STAFF"]);
}

function bearer(req: Request) {
  // Device credentials are deliberately not accepted as user Bearer tokens.
  const value = req.header("X-Device-Credential");
  if (!value) throw new AuthError(401, "Device credential required");
  const token = value.trim();
  const split = token.indexOf(".");
  if (split < 1 || split === token.length - 1) throw new AuthError(401, "Invalid device credential");
  return { identifier: token.slice(0, split), secret: token.slice(split + 1) };
}

function attendanceInstant(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AuthError(400, "Invalid attendance date");
  return date;
}

export const currentNfcStudentRecordQuery = `
  SELECT st.id AS "studentId",
         trim(concat_ws(' ',st.first_name,st.middle_name,st.last_name)) AS "studentName",
         current_assignment."className",current_assignment.section,
         current_assignment."academicSession",current_assignment.term
    FROM students st
    LEFT JOIN LATERAL (
      SELECT cl.name AS "className",a.section,ses.name AS "academicSession",
             current_term.name AS term
        FROM student_class_assignments a
        JOIN school_classes cl
          ON cl.id=a.school_class_id AND cl.school_id=a.school_id
        JOIN academic_sessions ses
          ON ses.id=a.academic_session_id AND ses.school_id=a.school_id
         AND ses.status='ACTIVE' AND ses.is_current=true
        LEFT JOIN LATERAL (
          SELECT t.name
            FROM academic_terms t
           WHERE t.school_id=a.school_id
             AND t.academic_session_id=a.academic_session_id
             AND t.status='ACTIVE' AND t.is_current=true
           ORDER BY t.start_date DESC,t.id DESC
           LIMIT 1
        ) current_term ON TRUE
       WHERE a.school_id=st.school_id AND a.student_id=st.id
         AND a.status='ACTIVE' AND a.is_current=true
       ORDER BY a.created_at DESC,a.id DESC
       LIMIT 1
    ) current_assignment ON TRUE
   WHERE st.id=$2 AND st.school_id=$1 AND UPPER(st.status)='ACTIVE'`;

async function deviceAuth(req: Request) {
  const { identifier, secret } = bearer(req);
  const result = await pool.query(
    `SELECT c.id AS "credentialId", c.device_id AS "deviceId", c.school_id AS "schoolId",
            c.secret_hash AS "secretHash", d.status AS "deviceStatus"
       FROM device_credentials c JOIN platform_devices d ON d.id=c.device_id
        WHERE c.credential_identifier=$1 AND c.status='ACTIVE'
          AND c.school_id=d.school_id
        AND (c.expires_at IS NULL OR c.expires_at > NOW())`,
    [identifier],
  );
  const row = result.rows[0];
  const digest = createHash("sha256").update(secret).digest();
  const stored = row?.secretHash ? Buffer.from(row.secretHash, "hex") : Buffer.alloc(0);
  const valid = stored.length === digest.length && timingSafeEqual(digest, stored);
  if (!row || !valid || row.deviceStatus !== "ACTIVE" ||
      !(await pool.query(`SELECT 1 FROM platform_devices WHERE id=$1 AND school_id IS NOT NULL AND configuration_status='CONFIGURED'`, [row.deviceId])).rows[0]) {
    throw new AuthError(401, "Invalid or inactive device credential");
  }
  await pool.query(`UPDATE device_credentials SET last_used_at=NOW() WHERE id=$1`, [row.credentialId]);
  await pool.query(`UPDATE platform_devices SET last_seen_at=NOW() WHERE id=$1`, [row.deviceId]);
  return row as { credentialId: number; deviceId: number; schoolId: number };
}

async function enforcePolicy(schoolId: number, studentId: number, method: string) {
  const policy = await pool.query(
    `SELECT policy FROM student_identification_policies
      WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE'`,
    [schoolId, studentId],
  );
  const selected = policy.rows[0]?.policy ?? "NFC_ONLY";
  const allowed =
    selected === "MANUAL_FALLBACK" ? method === "NFC" || method === "FINGERPRINT" :
    selected === "NFC_AND_BIOMETRIC" ? method === "NFC" || method === "FINGERPRINT" :
    selected === "BIOMETRIC_ONLY" ? method === "FINGERPRINT" : method === "NFC";
  if (!allowed) throw new AuthError(403, `Identification policy ${selected} does not allow ${method}`);
}

async function reconcileAttendance(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }, event: any) {
  if (!event.studentId) return;
  const kind = event.eventType === "SCHOOL_EXIT" ? "EXIT_WITHOUT_ENTRY" :
    event.eventType === "CLASSROOM_ENTRY" ? "CLASS_WITHOUT_SCHOOL" : null;
  if (!kind) return;
  const check = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM attendance_events
        WHERE school_id=$1 AND student_id=$2 AND event_type='SCHOOL_ENTRY'
          AND occurred_at <= $3 AND NOT EXISTS (
            SELECT 1 FROM attendance_events x WHERE x.school_id=$1 AND x.student_id=$2
              AND x.event_type='SCHOOL_EXIT' AND x.id <> $4 AND x.occurred_at > attendance_events.occurred_at
              AND x.occurred_at <= $3)
     ) AS present`,
    [event.schoolId, event.studentId, event.occurredAt, event.id],
  );
  const valid = !check.rows[0]?.present;
  if (!valid) return;
  const d = await client.query(
    `INSERT INTO attendance_discrepancies(school_id,student_id,attendance_event_id,discrepancy_type,status,details)
      VALUES($1,$2,$3,$4,'OPEN',$5::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`,
    [event.schoolId, event.studentId, event.id, kind, JSON.stringify({ eventType: event.eventType })],
  );
  if (d.rows[0]) await client.query(
    `INSERT INTO attendance_notification_events(school_id,attendance_event_id,discrepancy_id,notification_type,channel,status,payload)
      VALUES($1,$2,$3,'ATTENDANCE_DISCREPANCY','IN_APP','PENDING',$4::jsonb)`,
    [event.schoolId, event.id, d.rows[0].id, JSON.stringify({ kind, studentId: event.studentId })],
  );
}

type AttendanceNoticeInput = {
  schoolId: number;
  studentId: number;
  subjectClassId?: number | null;
  eventKey: string;
  subject: string;
  body: string;
  link?: string;
};

/**
 * Resolve notification recipients from the persisted, active parent-child
 * relationship and tenant. Callers must pass the transaction client so
 * notification intent commits or rolls back with its attendance event.
 */
export async function queueStudentAttendanceCommunication(
  client: CommunicationQueryClient,
  input: AttendanceNoticeInput,
): Promise<void> {
  if (!Number.isSafeInteger(input.schoolId) || input.schoolId < 1 ||
      !Number.isSafeInteger(input.studentId) || input.studentId < 1) {
    return;
  }

  const recipients = await client.query<{
    recipientUserId: number | string;
    recipientRole: "PARENT" | "STUDENT";
  }>(
    `SELECT recipient_user_id AS "recipientUserId", recipient_role AS "recipientRole"
       FROM (
         SELECT st.user_id AS recipient_user_id, 'STUDENT'::text AS recipient_role
           FROM students st
          WHERE st.school_id=$1 AND st.id=$2 AND UPPER(st.status)='ACTIVE'
            AND st.user_id IS NOT NULL
         UNION
         SELECT p.user_id AS recipient_user_id, 'PARENT'::text AS recipient_role
           FROM students st
           JOIN parent_student_relationships psr
             ON psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
           JOIN parents p
             ON p.id=psr.parent_id AND p.school_id=st.school_id
            AND UPPER(p.status)='ACTIVE'
          WHERE st.school_id=$1 AND st.id=$2 AND UPPER(st.status)='ACTIVE'
            AND p.user_id IS NOT NULL
       ) recipients
      ORDER BY recipient_role, recipient_user_id`,
    [input.schoolId, input.studentId],
  );

  for (const recipient of recipients.rows) {
    const recipientUserId = Number(recipient.recipientUserId);
    if (!Number.isSafeInteger(recipientUserId) || recipientUserId < 1) continue;
    await queueCommunicationNotification(client, {
      recipientUserId,
      schoolId: input.schoolId,
      subjectStudentId: input.studentId,
      subjectClassId: input.subjectClassId ?? null,
      category: "ATTENDANCE",
      eventKey: input.eventKey,
      subject: input.subject,
      body: input.body,
      link: input.link ?? "/",
      channels: recipient.recipientRole === "PARENT" ? ["IN_APP", "SMS"] : ["IN_APP"],
    });
  }
}

export async function queueSchoolEntryExitCommunication(
  client: CommunicationQueryClient,
  event: {
    id: number | string;
    schoolId: number | string;
    studentId: number | string | null;
    schoolClassId?: number | string | null;
    eventType: string;
    status: string;
  },
): Promise<void> {
  if (event.studentId == null || !["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(event.eventType)) return;
  const entered = event.eventType === "SCHOOL_ENTRY";
  const attendanceStatus = String(event.status).toUpperCase();
  if (entered && !["PRESENT", "LATE"].includes(attendanceStatus)) return;
  if (!entered && !["PRESENT", "LEFT_EARLY"].includes(attendanceStatus)) return;
  const schoolId = Number(event.schoolId);
  const eventId = Number(event.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return;
  await queueStudentAttendanceCommunication(client, {
    schoolId,
    studentId: Number(event.studentId),
    subjectClassId: event.schoolClassId == null ? null : Number(event.schoolClassId),
    eventKey: `attendance:${schoolId}:${eventId}:${event.eventType}`,
    subject: entered ? "School entry recorded" : "School exit recorded",
    body: entered
      ? "A student entry into school has been recorded."
      : "A student exit from school has been recorded.",
  });
}

/**
 * Attendance remains authoritative when the notification system is unavailable.
 * Savepoints contain database errors from recipient lookup or queue writes;
 * the failure is logged and the attendance transaction remains committable.
 */
export async function queueAttendanceCommunicationBestEffort(
  client: CommunicationQueryClient,
  req: Request,
  queue: () => Promise<void>,
  context: { schoolId: number; eventType: string },
): Promise<void> {
  const savepoint = "attendance_communication_queue";
  try {
    await client.query(`SAVEPOINT ${savepoint}`);
  } catch (error) {
    logAttendanceCommunicationFailure(req, context, error);
    return;
  }

  try {
    await queue();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      logAttendanceCommunicationFailure(req, context, error);
      throw rollbackError;
    }
    logAttendanceCommunicationFailure(req, context, error);
  }
}

function logAttendanceCommunicationFailure(
  req: Request,
  context: { schoolId: number; eventType: string },
  error: unknown,
) {
  const fields = {
    schoolId: context.schoolId,
    eventType: context.eventType,
    error: error instanceof Error ? error.message : "Unknown communication queue failure",
  };
  if (req.log) req.log.warn(fields, "Could not queue attendance communication");
  else logger.warn(fields, "Could not queue attendance communication");
}

// Reconcile only after the school's configured classroom window. Schools with no
// window do not receive speculative "missing" flags.
async function reconcileMissingClass(
  schoolId: number,
  day: string,
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> } = pool,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    throw new AuthError(400, "Invalid attendance date");
  }
  await client.query(
    `WITH missing AS (
      SELECT DISTINCT ON (e.student_id) e.id, e.student_id
      FROM attendance_events e
      JOIN attendance_settings s ON s.school_id=e.school_id
      JOIN student_class_assignments a ON a.student_id=e.student_id
        AND a.school_id=e.school_id AND a.status='ACTIVE' AND a.is_current=true
      WHERE e.school_id=$1 AND e.event_date=$2 AND e.event_type='SCHOOL_ENTRY'
        AND s.classroom_window_end IS NOT NULL
        AND NOW() > (e.event_date + s.classroom_window_end) AT TIME ZONE 'Africa/Lagos'
        AND e.occurred_at <= (e.event_date + s.classroom_window_end) AT TIME ZONE 'Africa/Lagos'
        AND NOT EXISTS (
          SELECT 1 FROM attendance_events c WHERE c.school_id=e.school_id
            AND c.student_id=e.student_id AND c.event_date=e.event_date
            AND c.event_type='CLASSROOM_ENTRY'
        )
      ORDER BY e.student_id,e.occurred_at
    ), inserted AS (
      INSERT INTO attendance_discrepancies
        (school_id,student_id,attendance_event_id,discrepancy_type,status,details)
      SELECT $1,student_id,id,'SCHOOL_PRESENT_CLASS_MISSING','OPEN',
        '{"note":"School entry recorded without a classroom entry by the configured classroom window"}'::jsonb
      FROM missing ON CONFLICT (attendance_event_id,discrepancy_type) DO NOTHING
      RETURNING id,attendance_event_id,student_id
    )
    INSERT INTO attendance_notification_events
      (school_id,attendance_event_id,discrepancy_id,notification_type,channel,status,payload)
    SELECT $1,attendance_event_id,id,'ATTENDANCE_DISCREPANCY','IN_APP','PENDING',
      jsonb_build_object('studentId',student_id,'kind','SCHOOL_PRESENT_CLASS_MISSING')
    FROM inserted`,
    [schoolId, day],
  );
}

function hasSchoolWideAttendanceRead(context: ReturnType<typeof getUserContext>, schoolId: number) {
  return isPlatformOwner(context) || context.roles.some(
    (assignment) => assignment.schoolId === schoolId &&
      ["SCHOOL_ADMIN", "STAFF"].includes(assignment.role),
  );
}

const processDeviceAttendance = run(async (req, res) => {
  const device = await deviceAuth(req);
  const body = req.body ?? {};
  const eventType = String(body.eventType ?? "").toUpperCase();
  const method = String(body.identificationMethod ?? "NFC").toUpperCase();
  const suppliedStudentId = body.studentId == null ? null : Number(body.studentId);
  if ((body.studentId != null &&
       (!Number.isSafeInteger(suppliedStudentId) || Number(suppliedStudentId) < 1)) ||
      (method === "FINGERPRINT" && suppliedStudentId == null) ||
      !["SCHOOL_ENTRY", "SCHOOL_EXIT", "CLASSROOM_ENTRY"].includes(eventType) ||
       !["NFC", "FINGERPRINT"].includes(method)) {
    throw new AuthError(400, "A valid studentId (required for fingerprint), eventType, and identificationMethod are required");
  }
  let studentId = suppliedStudentId;
  let cardId: number | null = null;
  if (method === "NFC") {
    const uid = String(body.nfcUid ?? "").trim();
    const card = await pool.query(
      `SELECT id,student_id AS "studentId" FROM nfc_cards
        WHERE uid=$1 AND school_id=$2 AND student_id IS NOT NULL
          AND UPPER(status)='ACTIVE'`,
      [uid, device.schoolId],
    );
    if (!card.rows[0]) throw new AuthError(403, "NFC card is invalid for this student or school");
    const resolvedStudentId = Number(card.rows[0].studentId);
    if (!Number.isSafeInteger(resolvedStudentId) || resolvedStudentId < 1) {
      throw new AuthError(403, "NFC card is invalid for this student or school");
    }
    if (suppliedStudentId != null && suppliedStudentId !== resolvedStudentId) {
      throw new AuthError(403, "NFC card is invalid for this student or school");
    }
    studentId = resolvedStudentId;
    cardId = Number(card.rows[0].id);
  }
  if (studentId == null) throw new AuthError(400, "studentId is required");
  const student = await pool.query(
    `SELECT id FROM students WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'`, [studentId, device.schoolId],
  );
  if (!student.rows[0]) throw new AuthError(404, "Student not found");
  await enforcePolicy(device.schoolId, studentId, method);
  if (!body.occurredAt) throw new AuthError(400, "occurredAt is required");
  if (method === "FINGERPRINT") {
    const provider = String(body.provider ?? "").trim();
    const reference = String(body.providerReference ?? "").trim();
    if (String(body.matchResult ?? "").toUpperCase() !== "MATCH" || !provider || !reference) {
      throw new AuthError(400, "A matched provider reference is required for fingerprint attendance");
    }
    const enrollment = await pool.query(
      `SELECT id FROM biometric_enrollments
        WHERE school_id=$1 AND student_id=$2 AND provider=$3 AND provider_reference=$4
          AND status='ACTIVE' AND (device_id IS NULL OR device_id=$5)`,
      [device.schoolId, studentId, provider, reference, device.deviceId],
    );
    if (!enrollment.rows[0]) throw new AuthError(403, "Fingerprint enrollment is not valid for this school or device");
  }
  let schoolClassId: number | null = null;
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60_000 ||
      occurredAt.getTime() < Date.now() - 24 * 60 * 60_000) throw new AuthError(400, "occurredAt is outside the allowed time window");
  if (eventType === "CLASSROOM_ENTRY") {
    const assignment = await pool.query(
      `SELECT a.school_class_id AS "classId", d.school_class_id AS "deviceClassId"
         FROM student_class_assignments a CROSS JOIN platform_devices d
        WHERE a.student_id=$1 AND a.school_id=$2 AND a.status='ACTIVE' AND a.is_current=true
          AND d.id=$3 AND d.school_id=$2`, [studentId, device.schoolId, device.deviceId]);
    if (!assignment.rows[0] || assignment.rows[0].classId !== assignment.rows[0].deviceClassId) {
      throw new AuthError(403, "Device is not assigned to the student's current class");
    }
    schoolClassId = assignment.rows[0].classId;
  }
  const settings = await pool.query(`SELECT duplicate_suppression_seconds AS seconds FROM attendance_settings WHERE school_id=$1`, [device.schoolId]);
  const suppression = Math.max(0, Number(settings.rows[0]?.seconds ?? 30));
  // The lock and time-range check make suppression a true rolling window rather
  // than the old wall-clock bucket (which allowed events at every boundary).
  const lockKey = `${device.schoolId}:${studentId}:${device.deviceId}:${eventType}`;
  const dedupeKey = randomUUID();
  const client = await pool.connect();
  let result: { rows: any[] };
  let currentStudent: { rows: any[] };
  try {
   await client.query("BEGIN");
   // Serialize ingestion with assignment/rotation so a credential cannot be
   // validated on the old school and inserted after an owner moves the device.
   const current = await client.query(
     `SELECT 1 FROM platform_devices d JOIN device_credentials c ON c.device_id=d.id
       WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE'
         AND d.configuration_status='CONFIGURED' AND c.id=$3
         AND c.school_id=d.school_id AND c.status='ACTIVE'
         AND (c.expires_at IS NULL OR c.expires_at>NOW())
       FOR UPDATE OF d`,
     [device.deviceId, device.schoolId, device.credentialId],
   );
   if (!current.rows[0]) throw new AuthError(401, "Invalid or inactive device credential");
   await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [lockKey]);
   const recent = await client.query(
     `SELECT id FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND device_id=$3 AND event_type=$4
       AND occurred_at BETWEEN $5::timestamptz - ($6::text || ' seconds')::interval
                           AND $5::timestamptz + ($6::text || ' seconds')::interval
       LIMIT 1`,
     [device.schoolId, studentId, device.deviceId, eventType, occurredAt.toISOString(), suppression],
   );
   if (recent.rows[0]) {
     await client.query("ROLLBACK");
     res.status(409).json({ error: "Duplicate event" });
     return;
   }
   result = await client.query(
    `INSERT INTO attendance_events
      (school_id,student_id,device_id,nfc_card_id,school_class_id,identification_method,event_type,result,
       attendance_status,event_date,occurred_at,dedupe_key,section_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,'ACCEPTED','PRESENT',$8,$9,$10,
       (SELECT a.section FROM student_class_assignments a
        WHERE a.school_id=$1 AND a.student_id=$2
          AND ($5::int IS NULL OR a.school_class_id=$5)
          AND a.created_at<=$9::timestamptz
          AND (a.start_date IS NULL OR a.start_date<=$8::date)
          AND (a.end_date IS NULL OR a.end_date>=$8::date)
        ORDER BY a.created_at DESC,a.id DESC LIMIT 1))
     ON CONFLICT (school_id,dedupe_key) DO NOTHING
      RETURNING id,school_id AS "schoolId",student_id AS "studentId",school_class_id AS "schoolClassId",device_id AS "deviceId",
       event_type AS "eventType",identification_method AS "identificationMethod",
        attendance_status AS status,result,failure_reason AS "failureReason",occurred_at AS "occurredAt",created_at AS "createdAt"`,
      [device.schoolId, studentId, device.deviceId, cardId, schoolClassId, method, eventType,
       occurredAt.toISOString().slice(0, 10), occurredAt.toISOString(), dedupeKey],
   );
   if (!result.rows[0]) { await client.query("ROLLBACK"); res.status(409).json({ error: "Duplicate event" }); return; }
    currentStudent = await client.query(
      currentNfcStudentRecordQuery,
      [device.schoolId, studentId],
    );
    if (!currentStudent.rows[0]) throw new AuthError(404, "Student not found for this NFC device");
   await reconcileAttendance(client, result.rows[0]);
    await reconcileMissingClass(device.schoolId, occurredAt.toISOString().slice(0, 10), client);
    await queueAttendanceCommunicationBestEffort(
      client,
      req,
      () => queueSchoolEntryExitCommunication(client, result.rows[0]),
      { schoolId: device.schoolId, eventType },
    );
   await client.query(`INSERT INTO attendance_notification_events(school_id,attendance_event_id,notification_type,channel,status,payload)
      SELECT $1::int,$2::int,x,'IN_APP','PENDING',jsonb_build_object('studentId',$3::int)
       FROM unnest(ARRAY['SCHOOL_ENTRY','SCHOOL_EXIT']::text[]) x
       WHERE ($4::text='SCHOOL_ENTRY' AND x='SCHOOL_ENTRY') OR ($4::text='SCHOOL_EXIT' AND x='SCHOOL_EXIT')`, [device.schoolId, result.rows[0].id, studentId, eventType]);
   await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
    res.status(201).json({ ...result.rows[0], ...currentStudent.rows[0] });
});
router.post("/device/attendance/events", processDeviceAttendance);
router.post("/biometric/events", (req, res, next) => {
  req.body = { ...req.body, identificationMethod: "FINGERPRINT" };
  processDeviceAttendance(req, res, next);
});

// An event keeps its own section snapshot. Older events are matched to the
// assignment in effect at the event instant, never to the student's current
// section (which may have changed since then).
const eventSection = `COALESCE(e.section_snapshot,(
  SELECT a.section FROM student_class_assignments a
  WHERE a.school_id=e.school_id AND a.student_id=e.student_id
    AND (e.school_class_id IS NULL OR a.school_class_id=e.school_class_id)
    AND a.created_at<=e.occurred_at
    AND (a.start_date IS NULL OR a.start_date<=e.event_date)
    AND (a.end_date IS NULL OR a.end_date>=e.event_date)
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1))`;
const eventClass = `COALESCE(e.school_class_id,(
  SELECT a.school_class_id FROM student_class_assignments a
  WHERE a.school_id=e.school_id AND a.student_id=e.student_id
    AND a.created_at<=e.occurred_at
    AND (a.start_date IS NULL OR a.start_date<=e.event_date)
    AND (a.end_date IS NULL OR a.end_date>=e.event_date)
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1))`;

router.get("/school/attendance/events", requireAuthentication(), run(async (req, res) => {
  const schoolId = Number(req.query.schoolId);
  if (!Number.isInteger(schoolId) || schoolId < 1) throw new AuthError(400, "A valid schoolId is required");
  assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN", "STAFF", "TEACHER"]);
  if (getUserContext(req).roles.some(x => x.role === "TEACHER")) {
    throw new AuthError(403, "Teachers may only view attendance through an assigned class report");
  }
  const values: unknown[] = [schoolId];
  const conditions = ["e.school_id=$1"];
  if (req.query.studentId != null) { conditions.push(`e.student_id=$${values.length + 1}`); values.push(Number(req.query.studentId)); }
  if (req.query.employeeId != null) { conditions.push(`e.employee_id=$${values.length + 1}`); values.push(Number(req.query.employeeId)); }
  if (req.query.classId != null) { conditions.push(`${eventClass}=$${values.length + 1}`); values.push(Number(req.query.classId)); }
  if (req.query.section !== undefined) {
    const section = String(req.query.section).trim();
    if (!section || section.length > 100) throw new AuthError(400, "Valid section is required");
    conditions.push(`${eventSection}=$${values.length + 1}`);
    values.push(section);
  }
  if (req.query.from !== undefined) { conditions.push(`e.occurred_at >= $${values.length + 1}`); values.push(attendanceInstant(req.query.from)); }
  if (req.query.to !== undefined) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to));
    const end = attendanceInstant(req.query.to);
    if (dateOnly) end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(`e.occurred_at ${dateOnly ? "<" : "<="} $${values.length + 1}`);
    values.push(end);
  }
  for (const key of ["eventType", "status", "identificationMethod"] as const) {
    if (req.query[key]) { const column = key === "status" ? "attendance_status" : key === "eventType" ? "event_type" : "identification_method"; conditions.push(`e.${column}=$${values.length + 1}`); values.push(String(req.query[key]).toUpperCase()); }
  }
  const result = await pool.query(
    `SELECT e.id,e.school_id AS "schoolId",e.student_id AS "studentId",e.employee_id AS "employeeId",
      e.device_id AS "deviceId",${eventClass} AS "classId",${eventSection} AS "section",
      e.event_type AS "eventType",e.identification_method AS "identificationMethod",
      e.attendance_status AS status,e.result,e.occurred_at AS "occurredAt",e.created_at AS "createdAt"
     FROM attendance_events e WHERE ${conditions.join(" AND ")} ORDER BY e.occurred_at DESC LIMIT 500`, values,
  );
  res.json(result.rows);
}));

router.get("/school/attendance/today", requireAuthentication(), run(async (req, res) => {
  const schoolId = Number(req.query.schoolId); if (!Number.isInteger(schoolId)) throw new AuthError(400, "A valid schoolId is required");
  assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN", "STAFF", "TEACHER"]);
   if (getUserContext(req).roles.some(x => x.role === "TEACHER")) throw new AuthError(403, "Teachers may not view school-wide attendance");
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const r = await pool.query(
    `WITH gate AS (
      SELECT DISTINCT ON (student_id) student_id,event_type FROM attendance_events
       WHERE school_id=$1 AND event_date=$2 AND student_id IS NOT NULL
         AND event_type IN ('SCHOOL_ENTRY','SCHOOL_EXIT')
         AND (event_type='SCHOOL_EXIT' OR attendance_status IN ('PRESENT','LATE'))
       ORDER BY student_id,occurred_at DESC,id DESC
    ), counts AS (
      SELECT COUNT(DISTINCT student_id) FILTER(WHERE event_type='SCHOOL_ENTRY' AND attendance_status IN ('PRESENT','LATE'))::int entries,
        COUNT(DISTINCT student_id) FILTER(WHERE event_type='SCHOOL_EXIT')::int exits,
        COUNT(DISTINCT student_id) FILTER(WHERE event_type='SCHOOL_ENTRY' AND attendance_status='LATE')::int late
      FROM attendance_events WHERE school_id=$1 AND event_date=$2
    )
    SELECT counts.entries,counts.exits, (SELECT COUNT(*)::int FROM gate WHERE event_type='SCHOOL_ENTRY') AS present,
      GREATEST(0,(SELECT COUNT(*)::int FROM students WHERE school_id=$1 AND UPPER(status)='ACTIVE') - counts.entries) AS absent,
      counts.late,
      (SELECT COUNT(*)::int FROM attendance_discrepancies d JOIN attendance_events e ON e.id=d.attendance_event_id
        WHERE d.school_id=$1 AND e.event_date=$2 AND d.status='OPEN') AS discrepancies
    FROM counts`,
    [schoolId, date],
  );
  res.json({ date, ...r.rows[0] });
}));

router.get("/school/attendance/students/:studentId", requireAuthentication(), run(async (req,res) => {
   const schoolId=Number(req.query.schoolId), studentId=Number(req.params.studentId); const ctx=assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","STAFF","TEACHER"]);
  const student=await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2`,[studentId,schoolId]); if(!student.rows[0]) throw new AuthError(404,"Student not found");
    if (ctx.roles.some(x=>x.role==="TEACHER") && !hasSchoolWideAttendanceRead(ctx, schoolId)) {
     const assigned=await pool.query(`SELECT 1 FROM teacher_class_assignments t JOIN employees e ON e.id=t.employee_id JOIN student_class_assignments a ON a.school_class_id=t.school_class_id WHERE e.user_id=$1 AND t.school_id=$2 AND a.student_id=$3 AND t.status='ACTIVE' AND a.status='ACTIVE'`,[ctx.user.id,schoolId,studentId]);
     if(!assigned.rows[0]) throw new AuthError(404,"Student not found");
   }
  const r=await pool.query(`SELECT id,school_id AS "schoolId",student_id AS "studentId",device_id AS "deviceId",event_type AS "eventType",identification_method AS "identificationMethod",occurred_at AS "occurredAt",attendance_status AS status,result,created_at AS "createdAt" FROM attendance_events WHERE school_id=$1 AND student_id=$2 ORDER BY occurred_at DESC LIMIT 500`,[schoolId,studentId]); res.json(r.rows);
}));

router.get("/school/attendance/classes/:classId", requireAuthentication(), run(async (req,res) => {
  const schoolId=Number(req.query.schoolId), classId=Number(req.params.classId); const ctx=assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","STAFF","TEACHER"]);
  if (ctx.roles.some(x=>x.role==="TEACHER")&&!hasSchoolWideAttendanceRead(ctx, schoolId)) { const ok=await pool.query(`SELECT 1 FROM teacher_class_assignments t JOIN employees e ON e.id=t.employee_id WHERE e.user_id=$1 AND t.school_id=$2 AND t.school_class_id=$3 AND t.status='ACTIVE'`,[ctx.user.id,schoolId,classId]); if(!ok.rows[0]) throw new AuthError(404,"Class not found"); }
  const date=String(req.query.date??new Date().toISOString().slice(0,10)); const r=await pool.query(`SELECT id,school_id AS "schoolId",student_id AS "studentId",device_id AS "deviceId",event_type AS "eventType",identification_method AS "identificationMethod",occurred_at AS "occurredAt",attendance_status AS status,result,created_at AS "createdAt" FROM attendance_events WHERE school_id=$1 AND school_class_id=$2 AND event_date=$3 ORDER BY occurred_at DESC`,[schoolId,classId,date]); res.json(r.rows);
}));

router.get("/school/attendance/discrepancies", requireAuthentication(), run(async (req,res) => {
  const schoolId=Number(req.query.schoolId); assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","STAFF","TEACHER"]);
   if (getUserContext(req).roles.some(x => x.role === "TEACHER")) throw new AuthError(403,"Teachers may not view school-wide discrepancies");
  const vals:any[]=[schoolId]; const c=["d.school_id=$1"]; if(req.query.status){c.push(`d.status=$${vals.length+1}`);vals.push(String(req.query.status));} if(req.query.from){c.push(`COALESCE(e.event_date,d.created_at::date) >= $${vals.length+1}::date`);vals.push(String(req.query.from));} if(req.query.to){c.push(`COALESCE(e.event_date,d.created_at::date) <= $${vals.length+1}::date`);vals.push(String(req.query.to));}
  const r=await pool.query(`SELECT d.id,d.school_id AS "schoolId",d.student_id AS "studentId",
    d.attendance_event_id AS "attendanceEventId",d.discrepancy_type AS kind,d.status,
    d.created_at AS "detectedAt",d.created_at AS "createdAt",d.resolved_at AS "resolvedAt",
    d.resolved_by AS "resolvedBy",d.details->>'note' AS note,
    d.details->>'reason' AS "resolutionReason",
    COALESCE(d.details->'resolutionHistory','[]'::jsonb) AS "resolutionHistory",
    CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'name',trim(concat_ws(' ',u.first_name,u.last_name))) END AS resolver,
    CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id',e.id,'eventType',e.event_type,'status',e.attendance_status,'occurredAt',e.occurred_at,'classId',e.school_class_id,'section',${eventSection}) END AS "relatedEvent",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('action',a.action,'actorUserId',a.actor_user_id,'createdAt',a."timestamp",'eventType',a.event_type) ORDER BY a."timestamp")
      FROM audit_logs a WHERE a.school_id=d.school_id AND a.record_id=d.id AND a.module='Attendance' AND a.event_type='ATTENDANCE_DISCREPANCY_RESOLVED'),'[]'::jsonb) AS "auditHistory"
    FROM attendance_discrepancies d
    LEFT JOIN attendance_events e ON e.id=d.attendance_event_id AND e.school_id=d.school_id
    LEFT JOIN app_users u ON u.id=d.resolved_by
    WHERE ${c.join(" AND ")} ORDER BY d.created_at DESC`,vals); res.json(r.rows);
}));

router.post("/school/attendance/manual", requireAuthentication(), run(async (req, res) => {
  const context = getUserContext(req);
  const schoolId = Number(req.body?.schoolId);
  const studentId = req.body?.studentId == null ? null : Number(req.body.studentId);
  const employeeId = req.body?.employeeId == null ? null : Number(req.body.employeeId);
  const eventType = String(req.body?.eventType ?? "").toUpperCase();
  const reason = String(req.body?.reason ?? "").trim();
   const attendanceStatus = String(req.body?.status ?? "").toUpperCase();
   assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "STAFF"]);
   if ((studentId === null) === (employeeId === null) ||
       (studentId !== null && (!Number.isInteger(studentId) || studentId < 1)) ||
       (employeeId !== null && (!Number.isInteger(employeeId) || employeeId < 1)) ||
       (employeeId !== null && !["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(eventType)) ||
       reason.length < 3 ||
       !["SCHOOL_ENTRY", "SCHOOL_EXIT", "CLASSROOM_ENTRY", "CLASSROOM_EXIT"].includes(eventType) ||
       !["PRESENT", "ABSENT", "LATE", "LEFT_EARLY", "EXCUSED", "UNKNOWN", "MISMATCH"].includes(attendanceStatus) ||
       !req.body?.occurredAt) {
     throw new AuthError(400, "Provide one studentId or employeeId, eventType, occurredAt, status, and reason");
  }
  const subject = studentId !== null
    ? await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'`, [studentId, schoolId])
    : await pool.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND UPPER(employment_status)='ACTIVE'`, [employeeId, schoolId]);
  if (!subject.rows[0]) throw new AuthError(404, "Student or employee not found");
   const occurred = new Date(req.body.occurredAt);
   if (Number.isNaN(occurred.getTime())) throw new AuthError(400, "Invalid occurredAt");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO attendance_events
        (school_id,student_id,employee_id,identification_method,event_type,result,attendance_status,event_date,occurred_at,reason,actor_user_id,dedupe_key,section_snapshot)
       VALUES($1,$2,$3,'MANUAL',$4,'ACCEPTED',$5,$6,$7,$8,$9,$10,
         (SELECT a.section FROM student_class_assignments a
          WHERE a.school_id=$1 AND a.student_id=$2 AND a.created_at<=$7::timestamptz
            AND (a.start_date IS NULL OR a.start_date<=$6::date)
            AND (a.end_date IS NULL OR a.end_date>=$6::date)
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1))
       RETURNING id,school_id AS "schoolId",student_id AS "studentId",employee_id AS "employeeId",
         school_class_id AS "schoolClassId",device_id AS "deviceId",event_type AS "eventType",identification_method AS "identificationMethod",
         occurred_at AS "occurredAt",attendance_status AS status,result,created_at AS "createdAt"`,
      [schoolId, studentId, employeeId, eventType, attendanceStatus, occurred.toISOString().slice(0, 10),
        occurred.toISOString(), reason, context.user.id, `manual:${randomUUID()}`],
    );
     if (studentId !== null && ["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(eventType)) {
       await queueAttendanceCommunicationBestEffort(
         client,
         req,
         () => queueSchoolEntryExitCommunication(client, result.rows[0]),
         { schoolId, eventType },
       );
     }
     await reconcileMissingClass(schoolId, occurred.toISOString().slice(0, 10), client);
    await client.query(
      `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result)
       VALUES($1,$2,$3,$4,$5,'Created manual attendance','Attendance',$6,'ATTENDANCE_MANUALLY_CREATED','SUCCESS')`,
      [context.user.email, context.roles[0]?.role ?? "SCHOOL_ADMIN", context.user.id,
        context.user.clerkUserId, schoolId, result.rows[0].id],
    );
    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.put("/school/students/:studentId/identification-policy", requireAuthentication(), run(async (req, res) => {
  const schoolId = Number(req.body?.schoolId);
  const studentId = Number(req.params.studentId);
  const policy = String(req.body?.policy ?? "").toUpperCase();
  const context = assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "STAFF"]);
  if (!Number.isInteger(studentId) || !["NFC_ONLY", "BIOMETRIC_ONLY", "NFC_AND_BIOMETRIC", "MANUAL_FALLBACK"].includes(policy)) {
    throw new AuthError(400, "A valid identification policy is required");
  }
  const student = await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2`, [studentId, schoolId]);
  if (!student.rows[0]) throw new AuthError(404, "Student not found");
  const result = await pool.query(
    `INSERT INTO student_identification_policies(school_id,student_id,policy,created_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(student_id) DO UPDATE SET policy=EXCLUDED.policy,updated_at=NOW(),status='ACTIVE'
     RETURNING id,school_id AS "schoolId",student_id AS "studentId",policy,status`,
    [schoolId, studentId, policy, context.user.id],
  );
  res.json(result.rows[0]);
}));

router.get("/students/:studentId/identification-methods", requireAuthentication(), run(async (req,res) => {
  const schoolId=Number(req.query.schoolId), studentId=Number(req.params.studentId); assertSchoolAccess(req,schoolId,["SCHOOL_ADMIN","STAFF"]);
  const student=await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2`,[studentId,schoolId]);
  if(!student.rows[0]) throw new AuthError(404,"Student not found");
  const p=await pool.query(`SELECT policy FROM student_identification_policies WHERE student_id=$1 AND school_id=$2 AND status='ACTIVE'`,[studentId,schoolId]);
  const e=await pool.query(`SELECT id,provider,provider_reference AS "deviceReference",status,enrolled_at AS "enrolledAt" FROM biometric_enrollments WHERE student_id=$1 AND school_id=$2 AND status='ACTIVE'`,[studentId,schoolId]);
  res.json({studentId,schoolId,policy:p.rows[0]?.policy??"NFC_ONLY",biometricEnrollments:e.rows});
}));

router.post("/students/:studentId/identification-methods", requireAuthentication(), run(async (req,res) => {
  const schoolId=Number(req.query.schoolId), studentId=Number(req.params.studentId), policy=String(req.body?.policy??"").toUpperCase(); const c=assertSchoolOperationalAccess(req,schoolId,["SCHOOL_ADMIN","STAFF"]);
  if(!["NFC_ONLY","BIOMETRIC_ONLY","NFC_AND_BIOMETRIC","MANUAL_FALLBACK"].includes(policy)) throw new AuthError(400,"Invalid policy");
  const student=await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2`,[studentId,schoolId]); if(!student.rows[0]) throw new AuthError(404,"Student not found");
  const r=await pool.query(`INSERT INTO student_identification_policies(school_id,student_id,policy,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET policy=EXCLUDED.policy,updated_at=NOW(),status='ACTIVE' RETURNING student_id AS "studentId",school_id AS "schoolId",policy`,[schoolId,studentId,policy,c.user.id]); res.json({...r.rows[0],biometricEnrollments:[]});
}));

router.post("/students/:studentId/biometric-enrollments", requireAuthentication(), run(async (req,res) => {
  const schoolId=Number(req.query.schoolId), studentId=Number(req.params.studentId); const c=assertSchoolOperationalAccess(req,schoolId,["SCHOOL_ADMIN"]);
  const provider=String(req.body?.provider??"").trim(), reference=String(req.body?.enrollmentReference??"").trim(); if(!provider||!reference) throw new AuthError(400,"provider and enrollmentReference are required");
  const s=await pool.query(`SELECT id FROM students WHERE id=$1 AND school_id=$2`,[studentId,schoolId]); if(!s.rows[0]) throw new AuthError(404,"Student not found");
  const r=await pool.query(`INSERT INTO biometric_enrollments(school_id,student_id,provider,provider_reference,device_id,metadata) VALUES($1,$2,$3,$4,$5,NULL) RETURNING id,provider,provider_reference AS "deviceReference",status,enrolled_at AS "enrolledAt"`,[schoolId,studentId,provider,reference,req.body?.deviceReference?Number(req.body.deviceReference):null]); res.status(201).json(r.rows[0]);
}));

router.get("/cards/:cardId/history", requireAuthentication(), run(async (req,res) => {
  const id=Number(req.params.cardId); const c=await pool.query(`SELECT school_id FROM nfc_cards WHERE id=$1`,[id]); if(!c.rows[0]) throw new AuthError(404,"Card not found"); assertCardAccess(req,c.rows[0].school_id);
  const r=await pool.query(`SELECT id,nfc_card_id AS "cardId",action,actor_user_id AS "actorId",created_at AS "occurredAt",reason AS note FROM nfc_card_history WHERE nfc_card_id=$1 ORDER BY created_at`,[id]); res.json(r.rows);
}));

router.post("/cards/:cardId/replace", requireAuthentication(), run(async (req,res) => {
  const id=Number(req.params.cardId), uid=String(req.body?.uid??"").trim(), old=await pool.query(`SELECT * FROM nfc_cards WHERE id=$1`,[id]); if(!old.rows[0]) throw new AuthError(404,"Card not found"); const schoolId=old.rows[0].school_id; const c=assertCardAccess(req,schoolId); if(!uid) throw new AuthError(400,"uid is required"); if(old.rows[0].student_id==null) throw new AuthError(409,"Only a student-bound NFC card may be replaced through the student-card workflow");
  const client=await pool.connect(); try { await client.query("BEGIN"); const n=await client.query(`INSERT INTO nfc_cards(school_id,uid,student_id,status) VALUES($1,$2,$3,'locked') RETURNING id,school_id AS "schoolId",uid,student_id AS "studentId",status`,[schoolId,uid,old.rows[0].student_id]); await client.query(`UPDATE nfc_cards SET status='replaced' WHERE id=$1`,[id]); await client.query(`INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,previous_status,new_status,replaced_by_card_id,reason,actor_user_id) VALUES($1,$2,$3,'REPLACED',$4,'replaced',$5,$6,$7)`,[schoolId,id,old.rows[0].student_id,old.rows[0].status,n.rows[0].id,req.body.reason??null,c.user.id]); await client.query("COMMIT"); res.status(201).json(n.rows[0]); } catch(e){await client.query("ROLLBACK");throw e} finally{client.release()}
}));

router.post("/school/attendance/:eventId/correct", requireAuthentication(), run(async (req, res) => {
  const eventId = Number(req.params.eventId);
  const status = String(req.body?.status ?? "").toUpperCase();
  const reason = String(req.body?.reason ?? "").trim();
  if (!Number.isInteger(eventId) || eventId < 1 ||
      !["PRESENT", "ABSENT", "LATE", "LEFT_EARLY", "EXCUSED", "UNKNOWN", "MISMATCH"].includes(status) ||
      reason.length < 3) throw new AuthError(400, "Valid status and reason are required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const original = await client.query(
      `SELECT id,school_id,attendance_status FROM attendance_events WHERE id=$1 FOR UPDATE`,
      [eventId],
    );
    if (!original.rows[0]) throw new AuthError(404, "Attendance event not found");
    const schoolId = original.rows[0].school_id;
    const context = assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const correction = await client.query(
      `INSERT INTO attendance_corrections(school_id,attendance_event_id,original_value,corrected_value,reason,actor_user_id)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)
       RETURNING id`,
      [schoolId, eventId, JSON.stringify({ status: original.rows[0].attendance_status }),
        JSON.stringify({ status }), reason, context.user.id],
    );
    const updated = await client.query(
      `UPDATE attendance_events SET attendance_status=$1 WHERE id=$2
       RETURNING id,school_id AS "schoolId",student_id AS "studentId",school_class_id AS "schoolClassId",employee_id AS "employeeId",
         device_id AS "deviceId",event_type AS "eventType",identification_method AS "identificationMethod",
         occurred_at AS "occurredAt",attendance_status AS status,result,created_at AS "createdAt"`,
      [status, eventId],
    );
     if (updated.rows[0]?.studentId != null) {
       await queueAttendanceCommunicationBestEffort(
         client,
         req,
         () => queueStudentAttendanceCommunication(client, {
           schoolId: Number(updated.rows[0].schoolId),
           studentId: Number(updated.rows[0].studentId),
           subjectClassId: updated.rows[0].schoolClassId == null ? null : Number(updated.rows[0].schoolClassId),
           eventKey: `attendance-correction:${schoolId}:${eventId}:${correction.rows[0]?.id ?? status}`,
           subject: "Attendance record updated",
           body: "The school updated an attendance record for your child.",
         }),
         { schoolId, eventType: "ATTENDANCE_CORRECTION" },
       );
     }
    await client.query(
      `INSERT INTO audit_logs("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result)
       VALUES($1,'SCHOOL_ADMIN',$2,$3,$4,'Corrected attendance','Attendance',$5,'ATTENDANCE_CORRECTED','SUCCESS')`,
      [context.user.email, context.user.id, context.user.clerkUserId, schoolId, eventId],
    );
    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.use(employeeNfcRouter);
export default router;