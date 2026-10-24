import type { Request } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext } from "../middlewares/auth";
import { assertSchoolHasActiveNfcDevice } from "../lib/nfc-device-first";
import { OWNER_UID_ACTION, type ReaderDb } from "./owner-uid-reader";

export function capturedUid(value: unknown) {
  if (typeof value !== "string" || !/^(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{14}|[a-fA-F0-9]{20})$/.test(value))
    throw new AuthError(400, "Select a valid captured card UID");
  return value.toUpperCase();
}

/** Always called inside the writer's transaction. Same lock as legacy provisioning. */
export async function prepareCapturedUid(db: ReaderDb, value: unknown, schoolId: number) {
  const uid = capturedUid(value);
  await db.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))", [uid]);
  const capture = await db.query(`SELECT id FROM audit_logs WHERE module='UIDInventory'
    AND action=$1 AND metadata->>'uid'=$2 AND event_type='OWNER_UID_CAPTURE' AND result='SUCCESS'
    ORDER BY id DESC LIMIT 1`, [OWNER_UID_ACTION, uid]);
  if (!capture.rows[0]) throw new AuthError(409, "UID has not been captured by an authenticated Owner reader");
  const prior = await db.query("SELECT id FROM nfc_cards WHERE lower(uid)=lower($1) FOR UPDATE", [uid]);
  if (prior.rows[0]) throw new AuthError(409, "UID is assigned, reserved or retired; select another available captured UID");
  const result = await db.query(`INSERT INTO nfc_cards(school_id,uid,status)
    VALUES($1,$2,'unassigned') RETURNING id,uid,school_id`, [schoolId, uid]);
  return result.rows[0];
}

export async function assignCapturedUid(req: Request, schoolId: number, studentId: number, value: unknown) {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const student = await db.query(`SELECT id,status FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE`, [studentId,schoolId]);
    if (!student.rows[0]) throw new AuthError(404, "Student not found in the selected school");
    if (String(student.rows[0].status).toUpperCase() !== "ACTIVE") throw new AuthError(409, "Select an active student");
    await assertSchoolHasActiveNfcDevice(db, schoolId);
    const prior = await db.query(`SELECT id FROM nfc_cards WHERE school_id=$1 AND student_id=$2 LIMIT 1`, [schoolId,studentId]);
    if (prior.rows[0]) throw new AuthError(409, "Student has card history. Explicitly unlink and use the paid replacement workflow instead");
    const card = await prepareCapturedUid(db, value, schoolId);
    const actor = getUserContext(req).user.id;
    // Initial assignment stays locked; this operation never bypasses activation/payment.
    await db.query(`UPDATE nfc_cards SET student_id=$1,status='locked',issued_at=NOW() WHERE id=$2`, [studentId,card.id]);
    await db.query(`INSERT INTO nfc_card_history
      (school_id,nfc_card_id,student_id,action,previous_status,new_status,reason,actor_user_id)
      VALUES($1,$2,$3,'ASSIGNED','unassigned','locked','Confirmed captured UID assignment',$4)`, [schoolId,card.id,studentId,actor]);
    await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
      VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Captured UID assigned','Cards',$3,'CAPTURED_UID_ASSIGNED','SUCCESS',$4::jsonb)`,
    [actor,schoolId,card.id,JSON.stringify({uid:card.uid,studentId,schoolId,source:"AUTHENTICATED_OWNER_READER",confirmed:true})]);
    await db.query("COMMIT");
    return { cardId:card.id,uid:card.uid,schoolId,studentId,status:"locked" };
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); }
}
