import { attendanceDayOpen, readAttendanceSchedule, schoolClock, type AttendanceDb } from "./attendance-schedule";

export type AttendanceReviewNotice = (db: AttendanceDb, input: {
  schoolId: number; studentId: number; eventKey: string; subject: string; body: string;
}) => Promise<void>;

/** Runs inside the caller's transaction. Reviews are not authoritative ABSENT events. */
export async function assessAttendanceDay(db: AttendanceDb, schoolId: number, now: Date,
  afterStudentId = 0, notify?: AttendanceReviewNotice) {
  await db.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
    [`attendance-schedule:${schoolId}`]);
  const { schedule: s, revision } = await readAttendanceSchedule(db, schoolId);
  const clock = schoolClock(now, s.timezone);
  const result = { date: clock.date, reviewed: 0, created: 0, nextAfterStudentId: null as number | null };
  if (!attendanceDayOpen(s, clock.date, clock.weekday)) return result;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`attendance-assessment:${schoolId}:${clock.date}`]);
  const students = await db.query(`SELECT id FROM students
    WHERE school_id=$1 AND UPPER(status)='ACTIVE' AND id>$2 ORDER BY id LIMIT 501`,
  [schoolId, afterStudentId]);
  const page = students.rows.slice(0, 500);
  if (students.rows.length > 500) result.nextAfterStudentId = Number(page[499].id);
  for (const student of page) {
    const studentId = Number(student.id);
    if (!attendanceDayOpen(s, clock.date, clock.weekday, studentId)) continue;
    // Same subject/day lock as scanning; a simultaneous scan cannot race an
    // absence assessment. Re-read evidence only after acquiring it.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`attendance-state:${schoolId}:${studentId}:${clock.date}`]);
    const events = (await db.query(`SELECT id,event_type AS "eventType",attendance_status AS status,
      identification_method AS method,occurred_at AS "occurredAt" FROM attendance_events
      WHERE school_id=$1 AND student_id=$2 AND event_date=$3 AND result='ACCEPTED'
        AND occurred_at<=$4 ORDER BY occurred_at,id`, [schoolId, studentId, clock.date, now])).rows;
    result.reviewed++;
    const present = events.some(e => ["PRESENT", "LATE"].includes(e.status)
      && ["SCHOOL_ENTRY", "CLASSROOM_ENTRY"].includes(e.eventType));
    // Device ingestion cannot create ABSENT/EXCUSED; either value is manual
    // or an authorized correction, even when original NFC provenance remains.
    const approvedAbsent = events.some(e => ["ABSENT","EXCUSED"].includes(e.status));
    const gates = events.filter(e => ["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(e.eventType)
      && ["PRESENT", "LATE"].includes(e.status));
    const lastGate = gates.at(-1);
    const entry = gates.find(e => e.eventType === "SCHOOL_ENTRY");
    const classroom = events.some(e => e.eventType === "CLASSROOM_ENTRY" && e.method !== "NFC_GATE_AUTO"
      && ["PRESENT", "LATE"].includes(e.status));
    // Late synchronized evidence can resolve only our own still-open reviews.
    // Approved/dismissed corrections are never reopened or overwritten.
    await db.query(`UPDATE attendance_discrepancies SET status='RESOLVED',resolved_at=NOW(),
      details=details || '{"resolution":"Later attendance evidence received; not a physical-presence guarantee"}'::jsonb
      WHERE school_id=$1 AND student_id=$2 AND status='OPEN'
        AND details->>'assessmentDate'=$3 AND details->>'source'='SCHOOL_SCHEDULE'
        AND ((discrepancy_type='ABSENCE_REVIEW' AND $4::boolean)
          OR (discrepancy_type='MISSING_TAG_OUT' AND $5::boolean)
          OR (discrepancy_type='SCHOOL_PRESENT_CLASS_MISSING' AND $6::boolean))`,
    [schoolId, studentId, clock.date, present || approvedAbsent,
      lastGate?.eventType === "SCHOOL_EXIT", classroom]);
    const kinds: Array<{ kind: string; eventId: number | null; note: string }> = [];
    if (s.rules.absenceReview && clock.time >= s.absenceAssessment && !present && !approvedAbsent)
      kinds.push({ kind: "ABSENCE_REVIEW", eventId: null,
        note: "No arrival/classroom evidence received by assessment time. Offline data, exemption or a correction may be pending; physical absence is not proven." });
    const reviewStart = clock.weekday === 5 ? s.fridayMissingTagOut : s.missingTagOutStart;
    if (s.rules.missingTagOut && clock.time >= reviewStart && lastGate?.eventType === "SCHOOL_ENTRY")
      kinds.push({ kind: "MISSING_TAG_OUT", eventId: Number(lastGate.id),
        note: `Exit scan not recorded. Review window ${reviewStart}–${clock.weekday === 5 ? s.fridayMissingTagOut : s.missingTagOutEnd}; location is unknown, not absent.` });
    if (s.rules.classroomAnomalies && clock.time >= s.classroomDeadline && entry && !classroom && !approvedAbsent)
      kinds.push({ kind: "SCHOOL_PRESENT_CLASS_MISSING", eventId: Number(entry.id),
        note: "Gate entry exists without classroom evidence. Provisional NFC class presence is not teacher or biometric confirmation." });
    for (const item of kinds) {
      const key = `attendance-review:v1:${schoolId}:${studentId}:${clock.date}:${item.kind}`;
      const inserted = await db.query(`INSERT INTO attendance_discrepancies
        (school_id,student_id,attendance_event_id,discrepancy_type,status,details)
        SELECT $1,$2,$3,$4,'OPEN',$5::jsonb WHERE NOT EXISTS (
          SELECT 1 FROM attendance_discrepancies WHERE school_id=$1 AND student_id=$2
            AND discrepancy_type=$4 AND (details->>'assessmentDate'=$6 OR attendance_event_id=$3))
        ON CONFLICT DO NOTHING RETURNING id`,
      [schoolId, studentId, item.eventId, item.kind, JSON.stringify({
        source: "SCHOOL_SCHEDULE", assessmentDate: clock.date, revision, note: item.note, eventKey: key,
      }), clock.date]);
      if (!inserted.rows[0]) continue;
      result.created++;
      await db.query(`INSERT INTO audit_logs
        ("user",role,school_id,action,module,record_id,metadata)
        VALUES('Attendance scheduler','SYSTEM',$1,'Created attendance review','Attendance',$2,$3::jsonb)`,
      [schoolId, inserted.rows[0].id, JSON.stringify({ kind: item.kind, date: clock.date, revision })]);
      if (s.rules.notifications && notify) await notify(db, {
        schoolId, studentId, eventKey: key, subject: "Attendance needs review",
        body: item.note,
      });
    }
  }
  return result;
}
