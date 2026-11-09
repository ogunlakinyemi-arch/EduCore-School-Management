import { queueCommunicationNotification, type CommunicationQueryClient, type CommunicationDispatchPool } from "./communication-service";
import { readAttendanceSchedule } from "./attendance-schedule";
import { loadOwnerDeliveryControls, ownerNotificationDevelopment } from "./owner-notification-controls";
import { developmentPaymentNotificationsSuppressed } from "../lib/development-payment-notification-policy";

export const teacherPeriodPrefix = "TEACHER_PERIOD:";
type Period = {
  id: number; schoolId: number; userId: number; classId: number; date: string;
  subject: string; className: string; section: string; startTime: string; endTime: string;
  startAt: Date | string; endAt: Date | string;
};
/** EXISTS, rather than assignment joins, deduplicates teachers with both roles.
 * Only the teacher actually selected on the timetable receives the period. */
export const teacherPeriodsSql = `SELECT DISTINCT te.id,te.school_id AS "schoolId",e.user_id AS "userId",
  te.school_class_id AS "classId",days.date::text AS date,sub.name AS subject,c.name AS "className",
  te.section,te.start_time::text AS "startTime",te.end_time::text AS "endTime",
  (days.date+te.start_time) AT TIME ZONE $3 AS "startAt",
  (days.date+te.end_time) AT TIME ZONE $3 AS "endAt"
  FROM academic_timetable_entries te
  JOIN schools s ON s.id=te.school_id AND upper(s.status)='ACTIVE'
  JOIN employees e ON e.id=te.teacher_employee_id AND e.school_id=te.school_id
    AND upper(e.employment_status)='ACTIVE' AND upper(e.employee_type)='TEACHER'
  JOIN app_users u ON u.id=e.user_id AND upper(u.status)='ACTIVE'
  JOIN school_memberships m ON m.user_id=u.id AND m.school_id=te.school_id
    AND m.role='TEACHER' AND upper(m.status)='ACTIVE'
  JOIN school_classes c ON c.id=te.school_class_id AND c.school_id=te.school_id
  JOIN subjects sub ON sub.id=te.subject_id AND sub.school_id=te.school_id
  JOIN academic_sessions ac ON ac.id=te.academic_session_id AND ac.school_id=te.school_id
  JOIN academic_terms t ON t.id=te.academic_term_id AND t.school_id=te.school_id
    AND t.academic_session_id=ac.id
  CROSS JOIN (SELECT DISTINCT (instant AT TIME ZONE $3)::date AS date
    FROM (VALUES ($2::timestamptz),($2::timestamptz+interval '5 minutes')) v(instant)) days
  WHERE te.school_id=$1 AND te.status='ACTIVE'
    AND days.date BETWEEN ac.start_date AND ac.end_date
    AND days.date BETWEEN t.start_date AND t.end_date
    AND upper(trim(to_char(days.date,'DAY')))=te.weekday
    AND EXISTS (SELECT 1 FROM teacher_class_assignments a WHERE a.school_id=te.school_id
      AND a.employee_id=e.id AND a.academic_session_id=te.academic_session_id
      AND a.school_class_id=te.school_class_id AND a.status='ACTIVE'
      AND (a.section='' OR a.section=te.section)
      AND (a.start_date IS NULL OR a.start_date<=days.date)
      AND (a.end_date IS NULL OR a.end_date>=days.date)
      AND (a.assignment_type='CLASS_TEACHER'
        OR (a.assignment_type='SUBJECT_TEACHER' AND a.subject_id=te.subject_id)))`;

export function periodNotices(period: Period, timezone: string, now: Date, dispatch = false) {
  const time = `${period.startTime.slice(0,5)}–${period.endTime.slice(0,5)} ${timezone}`;
  return (["BEFORE", "END"] as const).flatMap(trigger => {
    const start = +new Date(period.startAt), end = +new Date(period.endAt);
    const due = trigger === "BEFORE" ? start - 300_000 : end;
    const expires = trigger === "BEFORE" && dispatch ? start : due + 60_000;
    if (+now < due || +now >= expires) return [];
    return [{
      recipientUserId: Number(period.userId), schoolId: Number(period.schoolId),
      subjectClassId: Number(period.classId), category: "ACADEMIC" as const,
      eventKey: `${teacherPeriodPrefix}${period.id}:${period.date}:${trigger}`,
      subject: trigger === "BEFORE" ? "Teaching period starts in five minutes" : "Teaching period ended",
      body: `${period.subject} · ${period.className}${period.section ? ` (${period.section})` : ""} · ${period.date} · ${time}. Scheduled ${trigger === "BEFORE" ? "start" : "end"}: ${trigger === "BEFORE" ? period.startTime.slice(0,5) : period.endTime.slice(0,5)}.`,
      link: null, channels: ["IN_APP", "PUSH", "TELEGRAM"] as Array<"IN_APP" | "PUSH" | "TELEGRAM">,
      useSchoolDefaults: false,
    }];
  });
}

async function currentNotices(db: CommunicationQueryClient, schoolId: number, now: Date, dispatch = false) {
  const { schedule } = await readAttendanceSchedule(db,schoolId);
  const result = await db.query<Period>(teacherPeriodsSql,[schoolId,now.toISOString(),schedule.timezone]);
  return result.rows.flatMap(period => periodNotices(period,schedule.timezone,now,dispatch));
}

/** Recheck timetable, assignment, calendar, timezone and expiry on every push attempt.
 * No backlog replay after a cancelled/changed period or a held worker resumes. */
export async function teacherPeriodStillCurrent(db: CommunicationQueryClient, record: {
  eventKey: string | null; schoolId: number | string | null; recipientUserId: number | string;
  body: string; subject: string | null;
}, now: Date) {
  if (!ownerNotificationDevelopment() || developmentPaymentNotificationsSuppressed() || record.schoolId === null) return false;
  const notices = await currentNotices(db,Number(record.schoolId),now,true);
  return notices.some(n => n.eventKey===record.eventKey && n.recipientUserId===Number(record.recipientUserId)
    && n.body===record.body && n.subject===record.subject);
}

/** Called by the existing 15-second worker only; no timer or provider here. */
export async function queueTeacherPeriodNotifications(pool: CommunicationDispatchPool, now = new Date()) {
  if (!ownerNotificationDevelopment() || developmentPaymentNotificationsSuppressed()) return;
  const controls = await loadOwnerDeliveryControls(pool);
  if (controls.paused || !controls.activatedAt) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Concurrent ticks/processes cannot create new channels or duplicate audits.
    const lock = await db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(31977,1) AS locked");
    if (!lock.rows[0]?.locked) { await db.query("ROLLBACK"); return; }
    const schools = await db.query<{id:number}>("SELECT DISTINCT school_id AS id FROM academic_timetable_entries WHERE status='ACTIVE'");
    for (const school of schools.rows) {
      for (const notice of await currentNotices(db,Number(school.id),now)) {
        const existing = await db.query(`SELECT id FROM communication_notifications
          WHERE school_id=$1 AND recipient_user_id=$2 AND event_key=$3`,
          [notice.schoolId,notice.recipientUserId,notice.eventKey]);
        if (existing.rows.length) continue;
        const id = await queueCommunicationNotification(db,notice);
        if (id !== null) await db.query(`INSERT INTO audit_logs
          ("user",role,school_id,action,module,event_type,result,metadata)
          VALUES ('System','SYSTEM',$1,'Queued teacher period notification','Communication',
            'TEACHER_PERIOD_QUEUED','SUCCESS',$2::jsonb)`,
          [notice.schoolId,JSON.stringify({notificationId:id,eventKey:notice.eventKey,recipientUserId:notice.recipientUserId})]);
      }
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
