import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "@workspace/db";
import { securityDashboardActivitySql } from "./school-security-core-service";
import { readFile } from "node:fs/promises";
const guardPath = new URL("../../../../scripts/src/fixture-retention-guard.ts", import.meta.url).pathname;
const { captureOriginalRows, verifyOriginalRows, retireFixture,
  immutableGuards } = await import(guardPath);

const enabled = process.env.FIXTURE_GUARD_PG_INTEGRATION === "1";
const connect = () => pool.connect();
let client: Awaited<ReturnType<typeof connect>>;
describe.skipIf(!enabled)("fixture retention on disposable PostgreSQL, with all protections active", () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL !== "postgresql://postgres@127.0.0.1:55433/educore_expansion_test") {
      throw new Error("Only the explicitly named disposable database is allowed.");
    }
    client = await pool.connect();
  });
  afterAll(async () => { if (enabled && client) client.release(); });
  it("prepares the real nullable campaign-recipient insert without an untyped parameter", async () => {
    const source = await readFile(new URL("../routes/communication-campaigns.ts", import.meta.url), "utf8");
    const sql = source.match(/`(INSERT INTO communication_campaign_recipients[\s\S]*?)`/)?.[1];
    expect(sql).toBeTruthy();
    await client.query(`PREPARE campaign_recipient_regression AS ${sql}`);
    await client.query("DEALLOCATE campaign_recipient_regression");
    const simulated = source.match(/'simulated',(.+),\n/)?.[1];
    expect(simulated).toBeTruthy();
    const flags = await client.query(`SELECT ${simulated} AS simulated
      FROM (VALUES (NULL::text),('SIMULATED'),('NETWORK')) d(error_code)`);
    expect(flags.rows.map(r => r.simulated)).toEqual([false, true, false]);
  });
  it("deduplicates identical recipient contexts without losing a parent's other child", async () => {
    const source = await readFile(new URL("../routes/communication-campaigns.ts", import.meta.url), "utf8");
    const deduplicate = source.match(/recipients AS \(\n([\s\S]*?)\n\s+\)\n\s+SELECT recipients\./)?.[1];
    expect(deduplicate).toBeTruthy();
    const result = await client.query(`WITH candidates("userId",role,"studentName","parentName",
      "className","subjectStudentId","subjectClassId") AS (
        VALUES (805,'PARENT'::text,'One'::text,'Parent'::text,'A'::text,650,483),
          (805,'PARENT','Three','Parent','A',652,483),
          (805,'PARENT','One','Parent','A',650,483)
      ) ${deduplicate}`);
    expect(result.rows.map(r => r.subjectStudentId)).toEqual([650, 652]);
  });
  it("matches the student's displayed full name without dropping middle names", async () => {
    const source = await readFile(new URL("../routes/edupulse.ts", import.meta.url), "utf8");
    const clause = source.match(/conditions\.push\(`(\(st\.first_name ILIKE[^`]+)`\)/)?.[1]
      .replaceAll("${values.length}", "1");
    expect(clause).toBeTruthy();
    for (const [middle, search] of [["Student", "Expansion Student One"], ["", "Expansion One"], [null, "Expansion One"]]) {
      const matched = await client.query(`WITH students(first_name,middle_name,last_name,admission_no) AS (
        VALUES ('Expansion'::text,$2::text,'One'::text,'QA'::text)
      ) SELECT st.first_name FROM students st WHERE ${clause}`, [`%${search}%`, middle]);
      expect(matched.rows).toHaveLength(1);
    }
  });
  it.each(immutableGuards)("normal UPDATE/DELETE still fails through %s protection", async (_table, _trigger, fn) => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TEMP TABLE immutable_fixture_probe(id int PRIMARY KEY) ON COMMIT DROP");
      await client.query("INSERT INTO immutable_fixture_probe VALUES(1)");
      await client.query(`CREATE TRIGGER probe_immutable BEFORE UPDATE OR DELETE
        ON immutable_fixture_probe FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      for (const sql of ["UPDATE immutable_fixture_probe SET id=2", "DELETE FROM immutable_fixture_probe"]) {
        await client.query("SAVEPOINT denied");
        await expect(client.query(sql)).rejects.toThrow(/immutable|append-only/);
        await client.query("ROLLBACK TO SAVEPOINT denied");
      }
      expect((await client.query("SELECT count(*)::int AS count FROM immutable_fixture_probe")).rows[0].count).toBe(1);
    } finally { await client.query("ROLLBACK"); }
  });
  it("retires only owned mutable fixture data and preserves another school/baseline", async () => {
    await client.query("BEGIN");
    try {
      const label = "EDUCORE-EXPANSION-TEST-ABCDEF0123456789";
      const original = await captureOriginalRows(client, ["schools", "app_users", "school_memberships", "campus_presence", "security_events"]);
      const school = (await client.query(
        "INSERT INTO schools(code,name,city,state,status) VALUES($1,$1,'Test','Test','ACTIVE') RETURNING id", [label],
      )).rows[0];
      const otherSchool = (await client.query(
        "INSERT INTO schools(code,name,city,state,status) VALUES($1,$1,'Test','Test','ACTIVE') RETURNING id", [`${label}-OTHER`],
      )).rows[0];
      const otherFingerprint = (await client.query(
        "SELECT md5(to_jsonb(s)::text) AS hash FROM schools s WHERE id=$1", [otherSchool.id],
      )).rows[0].hash;
      const device = (await client.query(`INSERT INTO platform_devices
        (serial_number,name,device_type,school_id)
        VALUES($1,'Guard fixture NFC','NFC',$2) RETURNING id`,
      [`${label}-DEVICE`, school.id])).rows[0];
      await client.query("INSERT INTO device_school_bindings(device_id,school_id) VALUES($1,$2)",
        [device.id, school.id]);
      const event = (await client.query(`INSERT INTO security_events
        (school_id,device_id,person_type,event_type,identity_result,reason_code,event_key,occurred_at)
        VALUES($1,$2,'UNKNOWN','ENTRY','REJECTED','UNKNOWN_CARD','fixture-guard-history',now())
        RETURNING id`, [school.id, device.id])).rows[0];
      expect((await client.query(securityDashboardActivitySql,
        [school.id, '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])).rows[0].rejectedAttempts).toBe(1);
      const eventFingerprint = (await client.query(
        "SELECT md5(to_jsonb(e)::text) AS hash FROM security_events e WHERE id=$1", [event.id],
      )).rows[0].hash;
      for (const sql of ["UPDATE security_events SET reason_code='OTHER' WHERE id=$1",
        "DELETE FROM security_events WHERE id=$1"]) {
        await client.query("SAVEPOINT immutable_history");
        await expect(client.query(sql, [event.id])).rejects.toThrow(/immutable/);
        await client.query("ROLLBACK TO SAVEPOINT immutable_history");
      }
      const users = [];
      for (let i = 0; i < 7; i++) {
        const clerkUserId = `fixture_guard_pg_${i}`;
        const email = `role${i}-abcdef0123456789@example.com`;
        const row = (await client.query(
          "INSERT INTO app_users(clerk_user_id,email,status) VALUES($1,$2,'ACTIVE') RETURNING id",
          [clerkUserId, email],
        )).rows[0];
        users.push({ appUserId: row.id, clerkUserId, email });
      }
      await client.query("SAVEPOINT unowned");
      await expect(retireFixture(client, otherSchool.id, label, users)).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT unowned");
      await retireFixture(client, school.id, label, users);
      expect((await client.query("SELECT md5(to_jsonb(e)::text) AS hash FROM security_events e WHERE id=$1",
        [event.id])).rows[0].hash).toBe(eventFingerprint);
      expect((await client.query("SELECT status FROM schools WHERE id=$1", [school.id])).rows[0].status).toBe("INACTIVE");
      expect((await client.query("SELECT status FROM app_users WHERE id=ANY($1::int[])", [users.map(u => u.appUserId)]))
        .rows.every(r => r.status === "INACTIVE")).toBe(true);
      expect((await client.query("SELECT md5(to_jsonb(s)::text) AS hash FROM schools s WHERE id=$1", [otherSchool.id])).rows[0].hash)
        .toBe(otherFingerprint);
      await expect(verifyOriginalRows(client, original)).resolves.toMatchObject({ changed: 0, missing: 0 });
      const guards = await client.query("SELECT tgenabled FROM pg_trigger WHERE tgname=ANY($1::text[])",
        [immutableGuards.map((g: readonly string[]) => g[1])]);
      expect(guards.rows).toHaveLength(3);
      expect(guards.rows.every(r => r.tgenabled === "O")).toBe(true);
    } finally { await client.query("ROLLBACK"); }
  });
});