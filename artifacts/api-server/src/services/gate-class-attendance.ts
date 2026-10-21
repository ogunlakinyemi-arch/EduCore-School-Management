/** Existing attendance ledger is the source and audit trail; no biometric claim. */
type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
export function isMorningGateEntry(event: { eventType: string; identificationMethod: string; result: string; occurredAt: string | Date },
  start = "05:00:00", end = "12:00:00") {
  const timestamp=new Date(event.occurredAt).getTime();
  if(!Number.isFinite(timestamp))return false;
  const time = new Date(timestamp + 3_600_000).toISOString().slice(11, 19);
  return event.eventType === "SCHOOL_ENTRY" && event.identificationMethod === "NFC" && event.result === "ACCEPTED"
    && time >= start && time <= end && time < "12:00:00";
}
export async function markClassFromGate(db: Db, eventId: number) {
  const found = await db.query(`SELECT e.*,e.event_date::text AS event_date,s.entry_window_start,s.entry_window_end
    FROM attendance_events e LEFT JOIN attendance_settings s ON s.school_id=e.school_id
    WHERE e.id=$1 AND e.student_id IS NOT NULL`, [eventId]);
  const e = found.rows[0];
  if (!e || e.event_type !== "SCHOOL_ENTRY" || e.identification_method !== "NFC" || e.result !== "ACCEPTED") return;
  const key = `nfc-gate-class:v1:${e.school_id}:${e.student_id}:${e.event_date}`;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  const recorded=await db.query(`SELECT id,attendance_status FROM attendance_events WHERE school_id=$1
    AND student_id=$2 AND event_date=$3 AND event_type='CLASSROOM_ENTRY' AND result='ACCEPTED'
    ORDER BY occurred_at DESC NULLS LAST,id DESC LIMIT 1`,[e.school_id,e.student_id,e.event_date]);
  if(recorded.rows[0]){
    if(["ABSENT","MISMATCH"].includes(recorded.rows[0].attendance_status)){
      await db.query(`INSERT INTO attendance_discrepancies(school_id,student_id,attendance_event_id,discrepancy_type,details)
        SELECT $1,$2,$3,'GATE_CLASS_STATUS_MISMATCH',jsonb_build_object('note',
          'Gate entry conflicts with recorded classroom status; teacher review required','classEventId',$4::int)
        WHERE NOT EXISTS(SELECT 1 FROM attendance_discrepancies WHERE school_id=$1
          AND attendance_event_id=$3 AND discrepancy_type='GATE_CLASS_STATUS_MISMATCH')`,
        [e.school_id,e.student_id,e.id,recorded.rows[0].id]);
    }
    return;
  }
  const assignment = await db.query(`SELECT a.school_class_id,c.name,a.section
    FROM student_class_assignments a JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
    WHERE a.school_id=$1 AND a.student_id=$2 AND a.created_at<=$3
      AND (UPPER(a.status)='ACTIVE' OR a.end_date IS NOT NULL)
      AND (a.start_date IS NULL OR a.start_date<=$4::date)
      AND (a.end_date IS NULL OR a.end_date>=$4::date)
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [e.school_id,e.student_id,e.occurred_at,e.event_date]);
  const a = assignment.rows[0];
  const morning = isMorningGateEntry({eventType:e.event_type,identificationMethod:e.identification_method,
    result:e.result,occurredAt:e.occurred_at}, e.entry_window_start ?? undefined,e.entry_window_end ?? undefined);
  if (!a || !morning) {
    await db.query(`INSERT INTO attendance_discrepancies(school_id,student_id,attendance_event_id,discrepancy_type,details)
      SELECT $1,$2,$3,'SCHOOL_WITHOUT_CLASS',jsonb_build_object('note',$4::text)
      WHERE NOT EXISTS(SELECT 1 FROM attendance_events WHERE school_id=$1 AND student_id=$2
        AND event_date=$5 AND event_type='CLASSROOM_ENTRY' AND result='ACCEPTED')
        AND NOT EXISTS(SELECT 1 FROM attendance_discrepancies WHERE school_id=$1 AND attendance_event_id=$3
          AND discrepancy_type='SCHOOL_WITHOUT_CLASS')`,
      [e.school_id,e.student_id,e.id,!a ? "No historical class assignment at gate entry; teacher review required"
        : "Outside morning auto-presence window; teacher roll-call required",e.event_date]);
    return;
  }
  await db.query(`INSERT INTO attendance_events(school_id,student_id,device_id,nfc_card_id,identification_method,
    event_type,result,attendance_status,event_date,occurred_at,academic_session_id,academic_term_id,
    school_class_id,class_name_snapshot,section_snapshot,reason,actor_user_id,dedupe_key)
    SELECT $1,$2,$3,$4,'NFC_GATE_AUTO','CLASSROOM_ENTRY','ACCEPTED','PRESENT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    WHERE NOT EXISTS(SELECT 1 FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND event_date=$5
      AND event_type='CLASSROOM_ENTRY' AND result='ACCEPTED')
    ON CONFLICT(school_id,dedupe_key) DO NOTHING`,
    [e.school_id,e.student_id,e.device_id,e.nfc_card_id,e.event_date,e.occurred_at,
      e.academic_session_id,e.academic_term_id,a.school_class_id,a.name,a.section,
      `Provisional classroom presence from accepted gate event ${e.id}; source=NFC_GATE_AUTO; not biometric or teacher confirmation`,
      e.actor_user_id,key]);
}
