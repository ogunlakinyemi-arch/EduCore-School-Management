import {AuthError} from "../middlewares/auth";
type Db={query(sql:string,values?:any[]):Promise<{rows:any[]}>};

/** All callers authorize/lock their scope and eligible reader before calling.
 * Partner assignment never activates/unlocks; officer mode retains its existing
 * activation semantics. Reader context is audit context, not card ownership.
 */
export async function assignAvailableStudentCard(db:Db,input:{
  schoolId:number;studentId:number;cardNumber:string;activate?:boolean;
  deviceId?:number;allowCreate?:boolean;preparedCardAlreadyLocked?:boolean;
}){
  const {schoolId,studentId,cardNumber}=input;
  // Owner reassignment already holds the prepared card row. Acquiring a UID
  // advisory lock after that row would invert Partner/officer lock ordering.
  if(!input.preparedCardAlreadyLocked)await db.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))",[cardNumber]);
  const existing=await db.query(`SELECT id,school_id AS "schoolId",student_id AS "studentId",status
    FROM nfc_cards WHERE lower(uid)=lower($1) FOR UPDATE`,[cardNumber]);
  if(existing.rows.length>1)throw new AuthError(409,"This card identifier requires Owner reconciliation");
  const old=existing.rows[0];
  if(old && (Number(old.schoolId)!==schoolId || old.studentId!==null || String(old.status).toLowerCase()!=="unassigned")){
    throw new AuthError(409,"This NFC card is already bound, unavailable or belongs to another school");
  }
  if(!old && input.allowCreate===false)throw new AuthError(404,"Available NFC card not found");
  if(old && (await db.query(`SELECT id FROM employee_nfc_card_bindings WHERE nfc_card_id=$1 LIMIT 1`,[old.id])).rows.length){
    throw new AuthError(409,"Employee-bound cards cannot be assigned to students");
  }
  const student=await db.query(`SELECT id,admission_no AS "admissionNo",first_name AS "firstName",
    middle_name AS "middleName",last_name AS "lastName",class_name AS "className",section,photo
    FROM students WHERE id=$1 AND school_id=$2 AND upper(status)='ACTIVE' FOR NO KEY UPDATE`,[studentId,schoolId]);
  if(!student.rows[0])throw new AuthError(404,"Active student not found in this school");
  const duplicate=await db.query(`SELECT id FROM nfc_cards WHERE school_id=$1 AND student_id=$2
    AND lower(status) IN ('active','locked') LIMIT 1`,[schoolId,studentId]);
  if(duplicate.rows[0])throw new AuthError(409,"Student already has an active or prepared NFC card");
  if((await db.query("SELECT id FROM nfc_cards WHERE school_id=$1 AND student_id=$2 AND lower(status)='lost' LIMIT 1",[schoolId,studentId])).rows.length){
    throw new AuthError(409,"Use the existing paid replacement request for a lost card");
  }
  const status=input.activate?"active":"locked";
  const card=old?await db.query(`UPDATE nfc_cards SET student_id=$1,status=$2,
      activated_at=CASE WHEN $2='active' THEN NOW() ELSE activated_at END,
      deactivated_at=CASE WHEN $2='active' THEN NULL ELSE deactivated_at END,
      last_device_id=COALESCE($3,last_device_id)
    WHERE id=$4 AND school_id=$5 AND student_id IS NULL AND lower(status)='unassigned'
    RETURNING id,school_id AS "schoolId",uid,student_id AS "studentId",status,scans,last_scan AS "lastScan",activated_at AS "activatedAt"`,
    [studentId,status,input.deviceId??null,old.id,schoolId]):
    await db.query(`INSERT INTO nfc_cards(school_id,uid,student_id,status,issued_at,activated_at,last_device_id)
      VALUES($1,$2,$3,$4,NOW(),CASE WHEN $4='active' THEN NOW() ELSE NULL END,$5)
      RETURNING id,school_id AS "schoolId",uid,student_id AS "studentId",status,scans,last_scan AS "lastScan",activated_at AS "activatedAt"`,
      [schoolId,cardNumber,studentId,status,input.deviceId??null]);
  if(!card.rows[0])throw new AuthError(409,"Card availability changed");
  return{card:card.rows[0],student:student.rows[0],previousStatus:old?.status??null};
}
