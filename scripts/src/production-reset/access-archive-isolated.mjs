import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { activeAccessArchives, assertArchiveAccess, prepareAccessArchive, applyAccessArchive } from "./access-archive.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
export async function isolatedAccessArchiveTests({ data, socket }) {
  const base = path.dirname(data);
  assert.match(base, /^\/tmp\/educore-reset-rehearsal\.[A-Za-z0-9]+$/);
  assert.equal(data, path.join(base, "data")); assert.equal(socket, path.join(base, "socket"));
  for (const name of [base, data, socket]) {
    const stat = await fs.lstat(name);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0 && await fs.realpath(name) === name);
  }
  const stat = await fs.lstat(path.join(socket, ".s.PGSQL.55483"));
  assert.ok(stat.isSocket() && !stat.isSymbolicLink() && stat.uid === process.getuid());
  const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
  const make = database => new Client({ host: socket, port: 55483, database, user: "rehearsal_admin",
    password: () => "", ssl: false, connectionTimeoutMillis: 5000,
    options: "-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=2000" });
  const admin = make("postgres");
  await admin.connect();
  try {
    const row = (await admin.query(`SELECT current_setting('data_directory') AS data,
      current_setting('unix_socket_directories') AS socket,inet_server_addr() AS address,
      current_setting('listen_addresses') AS listeners,current_setting('server_version') AS version`)).rows[0];
    assert.equal(row.data, data); assert.equal(row.socket, socket);
    assert.equal(row.address, null); assert.equal(row.listeners, "");
    assert.match(row.version, /^16\.10/);
    assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname='access_archive_rehearsal'")).rowCount, 0);
    await admin.query("CREATE DATABASE access_archive_rehearsal TEMPLATE template0");
  } finally { await admin.end(); }
  const c = make("access_archive_rehearsal");
  await c.connect();
  const passed = [];
  try {
    await c.query(`CREATE TABLE schools(id int PRIMARY KEY,status text NOT NULL DEFAULT 'active');
      CREATE TABLE app_users(id int PRIMARY KEY,email text UNIQUE NOT NULL,status text NOT NULL DEFAULT 'ACTIVE');
      CREATE TABLE school_memberships(id int PRIMARY KEY,user_id int NOT NULL REFERENCES app_users,
        school_id int REFERENCES schools,role text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE');
      CREATE TABLE students(id int PRIMARY KEY,user_id int REFERENCES app_users,school_id int NOT NULL REFERENCES schools,email text);
      CREATE TABLE parents(id int PRIMARY KEY,user_id int REFERENCES app_users,school_id int NOT NULL REFERENCES schools,email text);
      CREATE TABLE employees(id int PRIMARY KEY,user_id int REFERENCES app_users,school_id int NOT NULL REFERENCES schools,email text);
      CREATE TABLE parent_student_relationships(id int PRIMARY KEY,parent_id int REFERENCES parents,student_id int REFERENCES students);
      CREATE TABLE partner_profiles(id int PRIMARY KEY,user_id int REFERENCES app_users,email text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE');
      CREATE TABLE partner_profile_users(partner_profile_id int REFERENCES partner_profiles,user_id int REFERENCES app_users,role text,status text DEFAULT 'ACTIVE');
      CREATE TABLE partner_invitations(id int PRIMARY KEY,partner_profile_id int REFERENCES partner_profiles,invited_email text,status text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int REFERENCES app_users,
        school_id int REFERENCES schools,action text,module text,severity text,event_type text,result text,metadata jsonb);
      CREATE TABLE fee_payments(id int PRIMARY KEY,school_id int REFERENCES schools,student_id int REFERENCES students,amount int);
      CREATE TABLE nfc_cards(id int PRIMARY KEY,school_id int REFERENCES schools,student_id int REFERENCES students,uid text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int REFERENCES schools);
      CREATE TABLE device_credentials(id int PRIMARY KEY,device_id int REFERENCES platform_devices,school_id int REFERENCES schools);
      CREATE TABLE device_assignment_history(id int PRIMARY KEY,device_id int REFERENCES platform_devices,school_id int REFERENCES schools);
      INSERT INTO schools(id) VALUES(9),(77);
      INSERT INTO app_users(id,email) VALUES(1,'owner@fictional.invalid'),(2,'teacher@fictional.invalid'),
        (3,'parent@fictional.invalid'),(4,'partner@fictional.invalid'),(5,'real@fictional.invalid'),
        (6,'student@fictional.invalid'),(7,'invitee@fictional.invalid'),(8,'staff@fictional.invalid'),
        (9,'realpartner@fictional.invalid'),(10,'former@fictional.invalid');
      INSERT INTO school_memberships(id,user_id,school_id,role) VALUES(1,1,NULL,'PLATFORM_OWNER'),
        (2,1,9,'SCHOOL_ADMIN'),(3,2,9,'TEACHER'),(4,5,77,'TEACHER'),(5,4,NULL,'PARTNER'),(6,9,NULL,'PARTNER');
      INSERT INTO students VALUES(1,6,9,'roster-student@fictional.invalid');
      INSERT INTO parents VALUES(1,3,9,'parent@fictional.invalid');
      INSERT INTO employees VALUES(1,10,9,'former@fictional.invalid');
      INSERT INTO parent_student_relationships VALUES(1,1,1);
      INSERT INTO partner_profiles(id,user_id,email) VALUES(3,4,'partner@fictional.invalid'),(4,9,'realpartner@fictional.invalid');
      INSERT INTO partner_profile_users VALUES(3,8,'PARTNER_STAFF','ACTIVE');
      INSERT INTO partner_invitations VALUES(1,3,'invitee@fictional.invalid','ACTIVE');
      INSERT INTO fee_payments VALUES(1,9,1,1900);
      INSERT INTO nfc_cards VALUES(1,9,1,'fictional-history');
      INSERT INTO platform_devices VALUES(1,9);
      INSERT INTO device_credentials VALUES(1,1,9);
      INSERT INTO device_assignment_history VALUES(1,1,9);
      INSERT INTO audit_logs("user",role,school_id,action,module,event_type,metadata)
        VALUES('Fictional actor','SCHOOL_ADMIN',9,'Existing history','School','HISTORICAL_EVENT','{"fixture":true}');`);
    const tables = ["schools","app_users","school_memberships","students","parents","employees",
      "parent_student_relationships","partner_profiles","partner_profile_users","partner_invitations",
      "fee_payments","nfc_cards","platform_devices","device_credentials","device_assignment_history"];
    const snapshot = async () => {
      const result = {};
      for (const table of tables) result[table] = (await c.query(`SELECT md5(COALESCE(
        string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS h FROM "${table}" t`)).rows[0].h;
      result.audit = (await c.query("SELECT to_jsonb(a) AS original FROM audit_logs a WHERE id=1")).rows[0];
      return result;
    };
    const before = await snapshot();
    const plan = await prepareAccessArchive(c, { schoolIds: [9], partnerIds: [3] });
    assert.deepEqual(plan.userIds, [2,3,4,6,7,8,10]);
    assert.deepEqual(plan.protectedOwners, [1]);
    assert.ok(!plan.emails.includes("owner@fictional.invalid"));
    passed.push("EXACT_ASSOCIATIONS_OWNER_EXEMPT_AND_OUT_OF_SCOPE_NOT_SELECTED");
    const batchId = sha("fictional archive batch");

    await c.query("BEGIN");
    await applyAccessArchive(c, { plan, actorUserId: 1, batchId });
    await assert.rejects(assertArchiveAccess(c, { userId: 2, email: "teacher@fictional.invalid" }),
      /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await c.query("ROLLBACK");
    assert.equal((await activeAccessArchives(c)).length, 0);
    assert.deepEqual(await snapshot(), before);
    passed.push("ARCHIVE_APPEND_ROLLBACK_RESTORES_ACCESS_AND_ALL_PROTECTED_ROWS");

    const peer = make("access_archive_rehearsal");
    await peer.connect();
    try {
      await peer.query("BEGIN");
      await peer.query("LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE");
      await c.query("BEGIN");
      await assert.rejects(applyAccessArchive(c, { plan, actorUserId: 1, batchId }),
        error => error.code === "55P03");
      await c.query("ROLLBACK");
      await peer.query("ROLLBACK");
    } finally { await peer.end(); }
    assert.equal((await activeAccessArchives(c)).length, 0);
    passed.push("COMPETING_SESSION_LOCK_FAILS_WITHOUT_PARTIAL_ARCHIVE");

    await c.query("BEGIN");
    await c.query(`CREATE FUNCTION fictional_audit_effect() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER fictional_audit_effect BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fictional_audit_effect()`);
    await assert.rejects(applyAccessArchive(c, { plan, actorUserId: 1, batchId }), /UNREVIEWED_AUDIT_WRITE_EFFECTS/);
    await c.query("ROLLBACK");
    assert.equal((await activeAccessArchives(c)).length, 0);
    passed.push("UNREVIEWED_AUDIT_TRIGGER_REFUSED_WITHOUT_ARCHIVING");

    await c.query("BEGIN");
    await applyAccessArchive(c, { plan, actorUserId: 1, batchId });
    await c.query("COMMIT");
    for (const id of plan.userIds) {
      await assert.rejects(assertArchiveAccess(c, { userId: id }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    }
    for (const id of [1,5,9]) await assertArchiveAccess(c, { userId: id });
    passed.push("EXISTING_TEST_SCHOOL_PARTNER_STAFF_AND_FORMER_ACCOUNTS_DENIED");
    passed.push("PLATFORM_OWNER_AND_REAL_SCHOOL_PARTNER_ACCOUNTS_ALLOWED");
    await assert.rejects(assertArchiveAccess(c, { email: "STUDENT@fictional.invalid" }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await assert.rejects(assertArchiveAccess(c, { userId: 100, email: "invitee@fictional.invalid" }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await assert.rejects(assertArchiveAccess(c, { schoolId: 9 }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await assert.rejects(assertArchiveAccess(c, { partnerId: 3 }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await assertArchiveAccess(c, { schoolId: 77 });
    await assertArchiveAccess(c, { partnerId: 4 });
    passed.push("SAME_EMAIL_NEW_IDENTITY_INVITATIONS_AND_PARTNER_LINK_REENTRY_DENIED");
    await c.query("BEGIN");
    await c.query("INSERT INTO app_users(id,email) VALUES(100,'new-identity@fictional.invalid')");
    await c.query("INSERT INTO school_memberships(id,user_id,school_id,role) VALUES(100,100,9,'SCHOOL_ADMIN')");
    await assert.rejects(assertArchiveAccess(c, { userId: 100, email: "new-identity@fictional.invalid" }), /ARCHIVED_TEST_ACCESS_BLOCKED/);
    await c.query("ROLLBACK");
    passed.push("LATER_MEMBERSHIP_CANNOT_REENABLE_ARCHIVED_SCHOOL_ACCESS");
    assert.deepEqual(await snapshot(), before);
    passed.push("AUDIT_FINANCE_MEMBERSHIPS_DEVICE_CARD_PROVENANCE_UNCHANGED");

    await c.query("BEGIN");
    await applyAccessArchive(c, { actorUserId: 1, batchId, restore: true });
    await c.query("COMMIT");
    for (const id of [1,2,3,4,5,6,7,8,9,10]) await assertArchiveAccess(c, { userId: id });
    assert.equal((await activeAccessArchives(c)).length, 0);
    assert.deepEqual(await snapshot(), before);
    passed.push("OWNER_RESTORE_IS_APPEND_ONLY_AND_REVERSIBLE");
    await c.query("BEGIN");
    await c.query("INSERT INTO school_memberships(id,user_id,school_id,role) VALUES(99,2,77,'TEACHER')");
    await assert.rejects(prepareAccessArchive(c, { schoolIds: [9], partnerIds: [3] }), /ARCHIVE_ACCOUNT_HAS_OUT_OF_SCOPE_ACCESS/);
    await c.query("ROLLBACK");
    passed.push("MIXED_LEGITIMATE_TENANT_ACCOUNT_STOPS_ENTIRE_BATCH");
    await c.query("BEGIN");
    await assert.rejects(applyAccessArchive(c, { plan, actorUserId: 2, batchId: sha("non-owner") }),
      /ACTIVE_PLATFORM_OWNER_REQUIRED/);
    await c.query("ROLLBACK");
    passed.push("NON_OWNER_CANNOT_ARCHIVE_OR_RESTORE");
    const orphans = (await c.query(`SELECT count(*)::int AS n FROM pg_constraint
      WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated`)).rows[0].n;
    assert.equal(orphans, 0);
    return { status: "PASS", scope: "FICTIONAL_SOCKET_ONLY_POSTGRESQL_16_10", passed,
      productionConnections: 0, productionMutations: 0, externalClerkMutations: 0,
      protectedBusinessRowsChanged: 0, productionExecutionAuthorized: false,
      accessModuleSha256: sha(await fs.readFile(new URL("./access-archive.mjs", import.meta.url), "utf8")) };
  } finally { await c.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--socket-dir") {
    console.error("EXPLICIT_FRESH_LOCAL_REHEARSAL_PATHS_REQUIRED"); process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await isolatedAccessArchiveTests({ data: args[1], socket: args[3] }), null, 2)); }
    catch (error) { console.error(JSON.stringify({ status: "FAIL", error: error.code ?? error.message, productionConnections: 0 })); process.exitCode = 2; }
  }
}
