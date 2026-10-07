import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { queueCommunicationNotification, type QueueCommunicationNotificationInput } from "./communication-service";

const socket = process.env.RESEND_TEST_PG_SOCKET;
describe.skipIf(!socket)("parent email recipient selection — disposable PostgreSQL", () => {
  let pg: any;
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/resend-notifications.")) throw new Error("Private PostgreSQL socket required");
    const { Pool } = createRequire(new URL("../../../../lib/db/package.json", import.meta.url))("pg");
    pg = new Pool({ host: socket, database: "resend_notification_test", user: userInfo().username });
    const identity = await pg.query(`SELECT current_database() AS name,inet_server_addr() AS tcp,
      current_setting('data_directory') AS data,current_setting('unix_socket_directories') AS sockets`);
    expect(identity.rows[0]).toEqual({
      name: "resend_notification_test", tcp: null, data: `${socket}/data`, sockets: socket,
    });
    await pg.query(`
      CREATE TABLE app_users(id int PRIMARY KEY,status text);
      CREATE TABLE schools(id int PRIMARY KEY,communication_defaults jsonb DEFAULT '{}');
      CREATE TABLE school_memberships(user_id int,school_id int,role text,status text);
      CREATE TABLE parents(id int PRIMARY KEY,user_id int,school_id int,status text);
      CREATE TABLE students(id int PRIMARY KEY,user_id int,school_id int,status text);
      CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
      CREATE TABLE communication_preferences(user_id int,school_id int,category text,channel text,enabled boolean);
      CREATE TABLE communication_notifications(
        id serial PRIMARY KEY,recipient_user_id int,school_id int,subject_student_id int,
        subject_class_id int,category text,event_key text,subject text,body text,link text
      );
      CREATE UNIQUE INDEX notification_school_key
        ON communication_notifications(school_id,event_key,recipient_user_id)
        WHERE school_id IS NOT NULL AND event_key IS NOT NULL;
      CREATE UNIQUE INDEX notification_global_key
        ON communication_notifications(event_key,recipient_user_id)
        WHERE school_id IS NULL AND event_key IS NOT NULL;
      CREATE TABLE communication_deliveries(
        id serial PRIMARY KEY,notification_id int,channel text,status text,
        sent_at timestamptz,next_attempt_at timestamptz,UNIQUE(notification_id,channel)
      );
    `);
  });
  beforeEach(async () => {
    await pg.query(`
      TRUNCATE communication_deliveries,communication_notifications,communication_preferences,
        parent_student_relationships,parents,students,school_memberships,schools,app_users RESTART IDENTITY;
      INSERT INTO schools(id) VALUES(1),(2);
      INSERT INTO app_users VALUES(17,'ACTIVE'),(18,'ACTIVE'),(19,'ACTIVE');
      INSERT INTO parents VALUES(31,17,1,'ACTIVE'),(32,19,1,'ACTIVE');
      INSERT INTO students VALUES(321,NULL,1,'ACTIVE'),(322,NULL,2,'ACTIVE');
      INSERT INTO parent_student_relationships VALUES(31,321,'ACTIVE'),(32,322,'ACTIVE');
      INSERT INTO school_memberships VALUES(18,1,'SCHOOL_ADMIN','ACTIVE');
    `);
  });
  afterAll(async () => { await pg?.end(); });
  const input = (overrides: Partial<QueueCommunicationNotificationInput> = {}): QueueCommunicationNotificationInput => ({
    recipientUserId: 17, schoolId: 1, subjectStudentId: 321, category: "ACADEMIC",
    eventKey: "test-result-publication-1", subject: "Result available", body: "Test result is available.",
    link: "/results", channels: ["IN_APP"], ...overrides,
  });
  const emails = async () => (await pg.query(
    "SELECT * FROM communication_deliveries WHERE channel='EMAIL' ORDER BY id",
  )).rows;

  it("queues one email for the linked parent and no duplicate on publication retry", async () => {
    const first = await queueCommunicationNotification(pg, input());
    expect(first).toBeGreaterThan(0);
    expect(await queueCommunicationNotification(pg, input())).toBe(first);
    expect(await emails()).toHaveLength(1);
    expect((await pg.query("SELECT count(*)::int AS n FROM communication_notifications")).rows[0].n).toBe(1);
  });
  it("does not copy the parent's academic email to an authorized staff recipient", async () => {
    expect(await queueCommunicationNotification(pg, input({ recipientUserId: 18, subjectStudentId: undefined }))).toBeGreaterThan(0);
    expect(await emails()).toHaveLength(0);
  });
  it("denies an unrelated parent and a cross-school child without Parent membership", async () => {
    expect(await queueCommunicationNotification(pg, input({ recipientUserId: 19 }))).toBeNull();
    expect(await queueCommunicationNotification(pg, input({ recipientUserId: 19, schoolId: 2, subjectStudentId: 322 }))).toBeNull();
    expect(await emails()).toHaveLength(0);
  });
  it("allows a linked cross-school child only after active Parent membership", async () => {
    await pg.query("INSERT INTO school_memberships VALUES(19,2,'PARENT','ACTIVE')");
    expect(await queueCommunicationNotification(pg, input({ recipientUserId: 19, schoolId: 2, subjectStudentId: 322 }))).toBeGreaterThan(0);
    expect(await emails()).toHaveLength(1);
  });
  it("respects an email preference without losing the in-app notification", async () => {
    await pg.query("INSERT INTO communication_preferences VALUES(17,1,'ACADEMIC','EMAIL',false)");
    expect(await queueCommunicationNotification(pg, input())).toBeGreaterThan(0);
    expect(await emails()).toHaveLength(0);
    expect((await pg.query("SELECT count(*)::int AS n FROM communication_deliveries WHERE channel='IN_APP'")).rows[0].n).toBe(1);
  });
  it("does not email a revoked relationship or inactive child", async () => {
    await pg.query("UPDATE parent_student_relationships SET status='INACTIVE'");
    expect(await queueCommunicationNotification(pg, input())).toBeNull();
    await pg.query("UPDATE parent_student_relationships SET status='ACTIVE'; UPDATE students SET status='INACTIVE'");
    expect(await queueCommunicationNotification(pg, input())).toBeNull();
    expect(await emails()).toHaveLength(0);
  });
});
