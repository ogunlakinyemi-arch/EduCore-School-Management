import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
const { Client } = createRequire(process.cwd() + "/lib/db/package.json")("pg");
const f = JSON.parse(await readFile("/tmp/nfc-print-fixture.json", "utf8"));
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const identity = (await db.query("SELECT current_database() AS db,pg_postmaster_start_time()::text AS started")).rows[0];
  if (identity.db !== f.identity.db || identity.started !== f.identity.started) throw Error("Development target changed");
  if (!(await db.query("SELECT 1 FROM schools WHERE id=$1 AND code=$2", [f.schoolId, f.tag])).rowCount) throw Error("Fixture ownership lost");
  await db.query("INSERT INTO device_school_bindings(device_id,school_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [f.deviceId, f.schoolId]);
  await db.query("INSERT INTO attendance_settings(school_id,duplicate_suppression_seconds) VALUES($1,0) ON CONFLICT(school_id) DO UPDATE SET duplicate_suppression_seconds=0", [f.schoolId]);
  const identifier = f.tag + "-CREDENTIAL";
  const secret = randomBytes(32).toString("hex");
  await db.query("UPDATE device_credentials SET secret_hash=$1 WHERE credential_identifier=$2 AND school_id=$3", [createHash("sha256").update(secret).digest("hex"), identifier, f.schoolId]);
  const tap = async (extra = {}) => {
    const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/device/attendance/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Device-Credential": identifier + "." + secret },
      body: JSON.stringify({ nfcUid: f.cards[0].uid, eventType: "SCHOOL_ENTRY", identificationMethod: "NFC", occurredAt: new Date().toISOString(), ...extra }),
    });
    return { status: response.status, data: await response.json() };
  };
  const before = await tap();
  if (before.status !== 201 || before.data.className !== "JSS1" || before.data.section !== "A") throw Error("Initial UID-only tap failed: " + JSON.stringify(before));
  await db.query("BEGIN");
  await db.query("UPDATE student_class_assignments SET is_current=false WHERE id=$1 AND school_id=$2 AND student_id=$3", [f.assignmentId, f.schoolId, f.studentIds[0]]);
  await db.query("INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,is_current) VALUES($1,$2,$3,$4,$5,'B','ACTIVE',true)", [f.schoolId, f.studentIds[0], f.sessionId, f.termId, f.classIds[1]]);
  await db.query("UPDATE students SET class_name='JSS2',section='B' WHERE id=$1 AND school_id=$2", [f.studentIds[0], f.schoolId]);
  await db.query("COMMIT");
  await new Promise(resolve => setTimeout(resolve, 10));
  const after = await tap();
  if (after.status !== 201 || after.data.className !== "JSS2" || after.data.section !== "B" || after.data.studentId !== before.data.studentId) throw Error("Same-card transfer proof failed: " + JSON.stringify(after));
  const wrong = await tap({ studentId: f.studentIds[1] });
  if (wrong.status !== 403) throw Error("Mismatched person was not denied");
  const identityRow = (await db.query("SELECT uid,student_id FROM nfc_cards WHERE id=$1 AND school_id=$2", [f.cards[0].id, f.schoolId])).rows[0];
  if (identityRow.uid !== f.cards[0].uid || identityRow.student_id !== f.studentIds[0]) throw Error("Card identity changed");
  const events = (await db.query("SELECT section_snapshot FROM attendance_events WHERE school_id=$1 AND student_id=$2 ORDER BY id", [f.schoolId, f.studentIds[0]])).rows;
  if (events.length !== 2 || events[0].section_snapshot !== "A" || events[1].section_snapshot !== "B") throw Error("Event section history changed");
  const summary = ({ status, data }) => ({ httpStatus: status, class: data.className, section: data.section, session: data.academicSession, term: data.term, attendance: data.status });
  const proof = { before: summary(before), after: summary(after), sameUidAndCard: true, sameStudent: true, preservedEarlierEventSection: true, mismatchedPersonStatus: wrong.status };
  await writeFile("/tmp/nfc-dynamic-live-proof.json", JSON.stringify(proof));
  console.log(proof);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}