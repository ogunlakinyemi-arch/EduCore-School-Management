// Temporary Development fixtures only. Require independently verified target
// identity arguments; all inserts commit together or roll back together.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const { Client } = createRequire(process.cwd() + "/lib/db/package.json")("pg");
const [expectedDatabase, expectedStart, expectedSchoolsHash] = process.argv.slice(2);
if (!expectedDatabase || !expectedStart || !expectedSchoolsHash) throw Error("Supply independently verified Development identity");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
  const identity = await row("SELECT current_database() AS db,pg_postmaster_start_time()::text AS started,md5(string_agg(id::text,',' ORDER BY id)) AS school_ids_hash FROM schools");
  if (identity.db !== expectedDatabase || identity.started !== expectedStart || identity.school_ids_hash !== expectedSchoolsHash) throw Error("Development target changed");
  const tag = "TEST-NFC-PRINT-" + randomBytes(4).toString("hex");
  const school = await row("INSERT INTO schools(code,name,city,state,address,phone,email,status) VALUES($1,$1,'Lagos','Lagos','Development test - not a real school','00000000000','nfc-print@example.test','ACTIVE') RETURNING id", [tag]);
  const sid = school.id;
  const session = await row("INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current) VALUES($1,'2026/2027','2026-01-01','2027-12-31','ACTIVE',true) RETURNING id", [sid]);
  const term = await row("INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current) VALUES($1,$2,'First Term','2026-01-01','2027-12-31','ACTIVE',true) RETURNING id", [sid, session.id]);
  const classes = [];
  for (const [name, section] of [["JSS1", "A"], ["JSS2", "B"]]) classes.push((await row("INSERT INTO school_classes(school_id,name,section) VALUES($1,$2,$3) RETURNING id", [sid, name, section])).id);
  const students = [];
  for (const suffix of ["Permanent", "Reassigned"]) students.push((await row("INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,status) VALUES($1,$2,'TEST',$3,'male','JSS1','A','active') RETURNING id", [sid, tag + "-" + suffix, "NFC Student " + suffix])).id);
  const assignment = await row("INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,is_current) VALUES($1,$2,$3,$4,$5,'A','ACTIVE',true) RETURNING id", [sid, students[0], session.id, term.id, classes[0]]);
  const employee = await row("INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type,employment_status) VALUES($1,$2,'TEST Ọlámidé','NFC Teacher','TEACHER','ACTIVE') RETURNING id", [sid, tag + "-TEACHER"]);
  const cards = [];
  for (let i = 0; i < 2; i++) cards.push(await row("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,$2,$3) RETURNING id,uid", [sid, randomBytes(7).toString("hex").toUpperCase(), i === 0 ? "active" : "unassigned"]));
  const device = await row("INSERT INTO platform_devices(serial_number,name,device_type,school_id,status,configuration_status) VALUES($1,$1,'NFC',$2,'ACTIVE','CONFIGURED') RETURNING id", [tag + "-DEVICE", sid]);
  await db.query("INSERT INTO device_school_bindings(device_id,school_id) VALUES($1,$2)", [device.id, sid]);
  await db.query("INSERT INTO attendance_settings(school_id,duplicate_suppression_seconds) VALUES($1,0)", [sid]);
  const fixture = { tag, schoolId: sid, sessionId: session.id, termId: term.id, classIds: classes, studentIds: students, assignmentId: assignment.id, employeeId: employee.id, cards, deviceId: device.id, identity };
  await writeFile("/tmp/nfc-print-fixture.json", JSON.stringify(fixture));
  await db.query("COMMIT");
  console.log({ schoolId: sid, tag, studentIds: students, teacherId: employee.id, cardIds: cards.map(c => c.id), deviceId: device.id, existingRecordsChanged: 0 });
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}