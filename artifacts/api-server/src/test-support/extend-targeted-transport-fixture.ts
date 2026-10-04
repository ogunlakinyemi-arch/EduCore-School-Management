import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { clerkClient } from "@clerk/express";

const path = new URL("../../.local/test-fixtures/targeted-transport.json", import.meta.url);
const f = JSON.parse(await readFile(path, "utf8"));
const fingerprint = (await pool.query("SELECT current_database() AS name,pg_postmaster_start_time() AS started")).rows[0];
if (fingerprint.name !== "heliumdb" || new Date(fingerprint.started).toISOString() !== "2026-10-03T20:25:42.106Z" ||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") || !/^TRANSPORT-QA-[A-F0-9]{16}$/.test(f.label) || !f.nativeChecked) {
  throw new Error("Verified completed Development fixture required");
}
const school = await pool.query("SELECT id FROM schools WHERE id=$1 AND code=$2 AND name=$2", [f.schoolId, f.label]);
if (school.rows.length !== 1 || f.browserPrepared) throw new Error("Unknown or already prepared fixture");
const nonce = f.label.slice(-16).toLowerCase();
const email = `transport-qa-teacher-${nonce}@example.com`;
const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
const user = existing.data[0] ?? await clerkClient.users.createUser({
  emailAddress: [email], firstName: "Transport QA", lastName: "Teacher",
  skipPasswordRequirement: true, publicMetadata: { transportQaFixture: f.label },
});
if (user.publicMetadata.transportQaFixture !== f.label) throw new Error("Unowned provider identity");
f.actors.teacher = { role: "TEACHER", email, clerkUserId: user.id };
await writeFile(path, JSON.stringify(f, null, 2));
const c = await pool.connect();
try {
  await c.query("BEGIN");
  f.actors.teacher.userId = Number((await c.query(
    `INSERT INTO app_users(clerk_user_id,email,first_name,last_name,status)
     VALUES($1,$2,'Transport QA','Teacher','ACTIVE') RETURNING id`, [user.id, email],
  )).rows[0].id);
  await c.query("INSERT INTO school_memberships(user_id,school_id,role,status) VALUES($1,$2,'TEACHER','ACTIVE')",
    [f.actors.teacher.userId, f.schoolId]);
  f.actors.teacher.employeeId = Number((await c.query(
    `INSERT INTO employees(school_id,user_id,employee_no,first_name,last_name,email,employee_type,employment_status)
     VALUES($1,$2,$3,'Transport QA','Teacher',$4,'TEACHER','ACTIVE') RETURNING id`,
    [f.schoolId, f.actors.teacher.userId, `QA-TEACHER-${nonce}`, email],
  )).rows[0].id);
  await c.query(
    `INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,
      school_class_id,section,status,is_current,start_date)
     SELECT st.school_id,st.id,s.id,t.id,cl.id,'A','ACTIVE',true,CURRENT_DATE
       FROM students st JOIN academic_sessions s ON s.school_id=st.school_id AND s.is_current
       JOIN academic_terms t ON t.academic_session_id=s.id AND t.school_id=s.school_id AND t.is_current
       JOIN school_classes cl ON cl.school_id=st.school_id AND cl.name=st.class_name AND cl.section=st.section
      WHERE st.school_id=$1 AND st.id=ANY($2::int[])`,
    [f.schoolId, [f.actors.student1.studentId, f.actors.student2.studentId]],
  );
  const foreignDriver = Number((await c.query(
    `INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type,employment_status)
     VALUES($1,$2,'Transport QA','Other school driver','DRIVER','ACTIVE') RETURNING id`,
    [f.otherSchoolId, `QA-OTHER-${nonce}`],
  )).rows[0].id);
  const foreignBus = Number((await c.query(
    `INSERT INTO transport_buses(school_id,name,registration_number,capacity,status,created_by)
     VALUES($1,'Other school QA bus',$2,10,'ACTIVE',$3) RETURNING id`,
    [f.otherSchoolId, `QA-OTHER-${nonce}`, f.actors.admin.userId],
  )).rows[0].id);
  f.foreignRouteId = Number((await c.query(
    `INSERT INTO transport_routes(school_id,bus_id,driver_employee_id,name,weekdays,departure_time,arrival_time,status,created_by)
     VALUES($1,$2,$3,'Other school QA route',ARRAY['SUNDAY'],'07:00:00','08:00:00','ACTIVE',$4) RETURNING id`,
    [f.otherSchoolId, foreignBus, foreignDriver, f.actors.admin.userId],
  )).rows[0].id);
  f.cardId = Number((await c.query(
    `INSERT INTO nfc_cards(school_id,student_id,uid,status,activated_at)
     VALUES($1,$2,$3,'active',NOW()) RETURNING id`, [f.schoolId, f.actors.student1.studentId, nonce.toUpperCase()],
  )).rows[0].id);
  await c.query("COMMIT");
  f.browserPrepared = true;
  await writeFile(path, JSON.stringify(f, null, 2));
  console.log(JSON.stringify({ label: f.label, schoolId: f.schoolId, prepared: true }));
} catch (error) { await c.query("ROLLBACK"); throw error; }
finally { c.release(); await pool.end(); }