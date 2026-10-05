import {AuthError} from "../middlewares/auth";

type Sql = {query(sql:string,values?:unknown[]):Promise<{rows:any[]}>};
export const NO_ACTIVE_NFC_DEVICE =
  "This school has no active NFC device linked. Link an NFC device to this school before assigning NFC cards.";

/** The authenticated reader supplies schoolId; never select a card per reader. */
export const studentNfcCardLookupSql = `
  SELECT nc.id,nc.student_id AS "studentId"
    FROM nfc_cards nc
    JOIN students st ON st.id=nc.student_id AND st.school_id=nc.school_id
   WHERE nc.uid=$1 AND nc.school_id=$2 AND nc.student_id IS NOT NULL
     AND upper(nc.status)='ACTIVE' AND upper(st.status)='ACTIVE'`;

/** Current school is authoritative; durable bindings also retain past schools. */
export const activeSchoolNfcDevicesSql = `
  SELECT d.id,d.serial_number AS "serialNumber",d.name,
         d.device_type AS "deviceType",d.status,d.location
    FROM platform_devices d
   WHERE d.school_id=$1 AND upper(d.status)='ACTIVE'
     AND d.configuration_status='CONFIGURED'
     AND upper(d.device_type) IN ('NFC','HYBRID')
     AND EXISTS (
       SELECT 1 FROM device_school_bindings b
        WHERE b.device_id=d.id AND b.school_id=d.school_id
     )
   ORDER BY d.name,d.id`;

/** Call inside the assignment transaction; moves/deactivation must wait. */
export async function assertSchoolHasActiveNfcDevice(db:Sql,schoolId:number) {
  const school=await db.query("SELECT id FROM schools WHERE id=$1 FOR KEY SHARE",[schoolId]);
  if(!school.rows[0]) throw new AuthError(404,"School not found");
  const devices=await db.query(`${activeSchoolNfcDevicesSql} FOR SHARE OF d`,[schoolId]);
  if(!devices.rows.length) throw new AuthError(409,NO_ACTIVE_NFC_DEVICE,"NFC_DEVICE_REQUIRED");
}

export function rejectManualCardDeviceIds(body:unknown) {
  if(body && typeof body==="object" &&
    Object.keys(body).some(key=>/^device_?ids?$/i.test(key))) {
    throw new AuthError(400,"Do not supply Device IDs when assigning a card. Linked NFC devices are determined by the selected school.");
  }
}
