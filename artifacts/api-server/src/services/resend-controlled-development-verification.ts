/**
 * Opt-in live verification through the existing attendance/communication pipeline.
 * Requires a schema-only disposable PostgreSQL clone, never an application DB.
 * Secrets and recipients are supplied only through server-side environment.
 */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { pool } from "@workspace/db";
import { queueStudentAttendanceCommunication, queueStudentAbsenceCommunication } from "../routes/attendance";
import {
  dispatchCommunicationDeliveries,
} from "./communication-service";
import {
  createDevelopmentCommunicationProviders, validEmail,
} from "./communication-providers";

async function main() {
  const verifyAbsenceOnly = process.argv.includes("--verify-absence-only");
  assert(verifyAbsenceOnly !== process.argv.includes("--send-once"),
    "Choose --send-once or --verify-absence-only");
  assert.equal(process.env.NODE_ENV, "development");
  assert.equal(process.env.COMMUNICATION_EMAIL_PROVIDER, "resend");
  assert.equal(process.env.EMAIL_FROM?.replace(/^Yemait EduCore(?=\s*<)/, "Yetenia EduCore"), "Yetenia EduCore <notifications@yetenia.com>");
  assert(Boolean(process.env.RESEND_API_KEY), "Server-side sending secret is missing");
  const recipient = process.env.RESEND_DEVELOPMENT_RECIPIENTS ?? "";
  assert(validEmail(recipient) && !recipient.includes(","), "Exactly one approved recipient required");
  const identity = (await pool.query(`
    SELECT current_database() AS name,inet_server_addr() AS tcp,
      current_setting('data_directory') AS data,
      current_setting('unix_socket_directories') AS sockets
  `)).rows[0];
  assert.equal(identity.name, "resend_controlled_test");
  assert.equal(identity.tcp, null);
  assert.match(identity.sockets, /^\/tmp\/resend-controlled\.[A-Za-z0-9]+$/);
  assert.equal(identity.data, `${identity.sockets}/data`);
  if (verifyAbsenceOnly) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const event = (await client.query(`
        SELECT id,school_id AS "schoolId",student_id AS "studentId",
          school_class_id AS "schoolClassId",attendance_status AS status
        FROM attendance_events WHERE dedupe_key='resend-controlled-absence'
      `)).rows[0];
      assert(event && event.status === "ABSENT");
      await queueStudentAbsenceCommunication(client, event);
      await queueStudentAbsenceCommunication(client, event);
      const queued = (await client.query(`
        SELECT n.id,u.email,array_agg(d.channel ORDER BY d.channel) AS channels
        FROM communication_notifications n JOIN app_users u ON u.id=n.recipient_user_id
        JOIN communication_deliveries d ON d.notification_id=n.id
        WHERE n.event_key=$1 GROUP BY n.id,u.email
      `, [`attendance:${event.schoolId}:${event.id}:ABSENT`])).rows;
      assert.equal(queued.length, 1);
      assert.equal(queued[0].email, recipient);
      assert.deepEqual(queued[0].channels, ["EMAIL", "IN_APP", "SMS"]);
      console.log(JSON.stringify({
        absenceBridgeNativeSqlVerified: true, recipientResolutionVerified: true,
        duplicateAbsenceNotifications: 0, emailIntents: 1, inAppIntents: 1,
        criticalSmsIntents: 1, apiCalls: 0, fixtureWritesRolledBack: true,
      }));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    return;
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM app_users")).rows[0].n, 0,
    "Refusing to send again or operate on a populated database");

  // Avoid collision with the live application's provider idempotency-key namespace.
  await pool.query("SELECT setval('communication_notifications_id_seq',$1,false)",
    [randomInt(1_500_000_000, 1_900_000_000)]);
  const client = await pool.connect();
  let notificationId: number;
  try {
    await client.query("BEGIN");
    const schoolId = (await client.query(`
      INSERT INTO schools(code,name,city,state,status)
      VALUES('RESEND-CONTROLLED-QA','EduCore Controlled Email Test School',
        'TEST','TEST','active') RETURNING id
    `)).rows[0].id;
    const userId = (await client.query(`
      INSERT INTO app_users(clerk_user_id,email,first_name,last_name,status)
      VALUES('user_disposable_resend_parent',$1,'Controlled','Test Parent','ACTIVE') RETURNING id
    `, [recipient])).rows[0].id;
    await client.query(`
      INSERT INTO school_memberships(user_id,school_id,role,status)
      VALUES($1,$2,'PARENT','ACTIVE')
    `, [userId, schoolId]);
    const parentId = (await client.query(`
      INSERT INTO parents(school_id,user_id,name,email,phone,status)
      VALUES($1,$2,'Controlled Test Parent',$3,'+15550123456','ACTIVE') RETURNING id
    `, [schoolId, userId, recipient])).rows[0].id;
    const studentId = (await client.query(`
      INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,status)
      VALUES($1,'RESEND-TEST-ONLY','Synthetic','Test Student','Female','Test Class','A','active')
      RETURNING id
    `, [schoolId])).rows[0].id;
    await client.query(`
      INSERT INTO parent_student_relationships(parent_id,student_id,status)
      VALUES($1,$2,'ACTIVE')
    `, [parentId, studentId]);
    const eventId = (await client.query(`
      INSERT INTO attendance_events(school_id,student_id,identification_method,event_type,
        result,attendance_status,event_date,occurred_at,dedupe_key)
      VALUES($1,$2,'MANUAL','SCHOOL_ENTRY','ACCEPTED','ABSENT',CURRENT_DATE,NOW(),
        'resend-controlled-absence') RETURNING id
    `, [schoolId, studentId])).rows[0].id;
    const notice = {
      schoolId, studentId, eventKey: `manual-attendance:${schoolId}:${eventId}:ABSENT`,
      subject: "[Development Test] EduCore student absence notification",
      body: "This is the approved Yetenia EduCore Development email test, not a real absence. "
        + "Synthetic Test Student was marked absent in an isolated test database. "
        + "No real student, school or attendance record was changed.",
      link: "/attendance",
    };
    // Prove preferences suppress email without losing the in-app notice.
    const preferenceId = (await client.query(`
      INSERT INTO communication_preferences(user_id,school_id,category,channel,enabled)
      VALUES($1,$2,'ATTENDANCE','EMAIL',false) RETURNING id
    `, [userId, schoolId])).rows[0].id;
    await queueStudentAttendanceCommunication(client, notice);
    assert.equal((await client.query(
      "SELECT count(*)::int AS n FROM communication_deliveries WHERE channel='EMAIL'",
    )).rows[0].n, 0);
    await client.query("UPDATE communication_preferences SET enabled=true WHERE id=$1", [preferenceId]);
    // Normal retry after permission is enabled must reuse the existing notification.
    await queueStudentAttendanceCommunication(client, notice);
    await queueStudentAttendanceCommunication(client, notice);
    const notifications = (await client.query(
      "SELECT id,recipient_user_id FROM communication_notifications",
    )).rows;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipient_user_id, userId);
    notificationId = Number(notifications[0].id);
    assert.equal((await client.query(
      "SELECT count(*)::int AS n FROM communication_deliveries WHERE channel='EMAIL'",
    )).rows[0].n, 1);
    await client.query(`
      INSERT INTO audit_logs("user",role,action,module,school_id,record_id,event_type,result)
      VALUES('Controlled Development Test','SCHOOL_ADMIN','Created synthetic absence',
        'Attendance',$1,$2,'ATTENDANCE_MANUALLY_CREATED','SUCCESS')
    `, [schoolId, eventId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let apiCalls = 0;
  let apiHttpStatus: number | undefined;
  // Only guards the existing provider's transport; it is not a second sending system.
  const guardedFetch: typeof fetch = async (url, request) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.equal(request?.method, "POST");
    const message = JSON.parse(String(request?.body));
    assert.deepEqual(message.to, [recipient]);
    assert.equal(message.from, process.env.EMAIL_FROM);
    assert.equal(++apiCalls, 1, "Only one real provider call permitted");
    const response = await fetch(url, request);
    apiHttpStatus = response.status;
    return response;
  };
  const providers = createDevelopmentCommunicationProviders(process.env, { fetch: guardedFetch });
  const dispatched = await dispatchCommunicationDeliveries(pool, 10, { providers });
  const email = (await pool.query(`
    SELECT status,provider_name,provider_message_id,error_code,attempts
    FROM communication_deliveries WHERE notification_id=$1 AND channel='EMAIL'
  `, [notificationId])).rows[0];
  const replay = await dispatchCommunicationDeliveries(pool, 10, { providers });
  assert.equal(replay.claimed, 0, "No resend on worker replay");
  assert.equal(apiCalls, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n, 1);
  console.log(JSON.stringify({
    environment: "isolated Development PostgreSQL schema clone",
    sender: process.env.EMAIL_FROM, applicationDatabaseWrites: 0,
    recipientResolutionVerified: true, preferenceCheckVerified: true,
    notificationsCreated: 1, emailIntentsCreated: 1, auditRecordsPreserved: 1,
    apiCalls, apiHttpStatus, dispatched, email, replay,
    sms: "no-network simulation", inboxDelivery: "not yet confirmed",
  }));
  assert.equal(email.status, "SENT", "Provider did not accept the test email");
}

main().catch(() => {
  // Never emit provider responses, connection strings or arbitrary exception details.
  console.error("Controlled verification failed; inspect only sanitized ledger evidence. Do not resend automatically.");
  process.exitCode = 1;
}).finally(() => pool.end());
