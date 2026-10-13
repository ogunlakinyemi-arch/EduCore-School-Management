import express from "express";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabasePool as Pool } from "@workspace/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  pool: null as import("@workspace/db").DatabasePool | null,
  options: { host: "helium", port: 5432, database: "heliumdb" },
  fingerprint: "c95705198e31d45bbfbfeb688a774412",
  missingAuditGuard: false,
  calls: [] as string[],
  connections: 0,
}));
vi.mock("@workspace/db", async original => ({
  ...await original<typeof import("@workspace/db")>(),
  pool: {
    get options() { return fixture.options; },
    connect: async () => {
      fixture.connections++;
      const client = await fixture.pool!.connect();
      return {
        query: async (sql: string, args?: unknown[]) => {
          fixture.calls.push(sql);
          // Identity receipt only is stubbed. Profile predicates, locking,
          // DELETE, constraints, audit writes and rollback execute in a NEW,
          // private PostgreSQL cluster containing synthetic records only.
          if (sql.includes("AS development_fingerprint")) {
            return { rows: [{ database_name: "heliumdb", is_replica: false,
              development_fingerprint: fixture.fingerprint }], rowCount: 1 };
          }
          if (fixture.missingAuditGuard && sql.includes("AS audit_guards")) {
            return { rows: [{ incoming_foreign_keys: 0, profile_triggers: 0, audit_guards: 0 }], rowCount: 1 };
          }
          return client.query(sql, args);
        },
        release: () => client.release(),
      };
    },
  },
}));
vi.mock("../middlewares/auth", async (original) => ({
  ...await original<typeof import("../middlewares/auth")>(),
  requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-test-role") ?? "PLATFORM_OWNER";
    const owner = role === "PLATFORM_OWNER" || req.header("x-test-owner") === "true";
    const roles = [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 7),
      status: req.header("x-test-status") ?? "ACTIVE" }];
    if (owner && role !== "PLATFORM_OWNER") roles.push({ id: 2, role: "PLATFORM_OWNER", schoolId: null as any, status: "ACTIVE" });
    (req as any).edupulseUser = {
      user: { id: 99, clerkUserId: "removal-fixture", email: "fixture@example.test",
        firstName: "Synthetic", lastName: "Actor", status: "ACTIVE", phone: null },
      roles,
    };
    next();
  },
}));
import router from "./settlement-payroll";

const app = express();
app.use(express.json());
app.use("/api", router);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.statusCode ?? 500).json({ error: error.message });
});
let server: ReturnType<typeof app.listen>;
let base: string;
let postgres: ChildProcess;
let dir: string;
let admin: Pool;
let caseNumber = 0;
const version = "2026-10-13T12:00:00.123456Z";
const companyPath = "/platform/finance/payment-settlement";
const schoolPath = "/schools/7/finance/payment-settlement";
const input = (id = 11) => ({ expectedProfileId: id, expectedVersion: version, confirmation: `REMOVE PROFILE ${id}` });
async function request(path: string, method = "DELETE", body: unknown = input(), headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
async function snapshot() {
  const tables = ["settlement_payroll_profiles", "settlement_payroll_audit_events", "audit_logs",
    "student_subscription_payments", "fee_payments", "flutterwave_split_recipients", "payroll_payslips"];
  return Object.fromEntries(await Promise.all(tables.map(async t =>
    [t, (await fixture.pool!.query(`SELECT * FROM ${t} ORDER BY id`)).rows])));
}

beforeAll(async () => {
  // No DATABASE_URL, app database, project migrations or network provider is used.
  dir = mkdtempSync(join(tmpdir(), "settlement-removal-fixture-"));
  const data = join(dir, "data");
  execFileSync("initdb", ["-D", data, "--auth=trust", "--no-locale"], { stdio: "ignore" });
  postgres = spawn("postgres", ["-D", data, "-k", dir, "-p", "55371", "-h", ""], { stdio: "ignore" });
  admin = new Pool({ host: dir, port: 55371, user: process.env.USER ?? "runner", database: "postgres" });
  for (let attempt = 0; ; attempt++) {
    try { await admin.query("SELECT 1"); break; }
    catch { if (attempt > 80) throw new Error("Disposable fixture PostgreSQL did not start"); await new Promise(r => setTimeout(r, 50)); }
  }
  await admin.query("CREATE DATABASE removal_fixture");
  const seed = new Pool({ host: dir, port: 55371, user: process.env.USER ?? "runner", database: "removal_fixture" });
  await seed.query(`
    CREATE TABLE settlement_payroll_profiles (
      id integer PRIMARY KEY,scope text NOT NULL,school_id integer,business_name text NOT NULL,
      verification_status text NOT NULL,updated_at timestamptz NOT NULL,verified_at timestamptz,
      verified_by integer,provider_subaccount_id text);
    INSERT INTO settlement_payroll_profiles VALUES
      (11,'YEMAIT_COMPANY',NULL,'Synthetic company','PENDING_VERIFICATION','${version}',NULL,NULL,NULL),
      (12,'SCHOOL',7,'Synthetic school','PENDING_VERIFICATION','${version}',NULL,NULL,NULL),
      (13,'SCHOOL',8,'Unrelated school','PENDING_VERIFICATION','${version}',NULL,NULL,NULL);
    CREATE TABLE settlement_payroll_audit_events (
      id serial PRIMARY KEY,scope text,school_id integer,actor_user_id integer,actor_role text,
      record_type text,record_id integer,action text,amount_minor integer,currency text,
      provider_reference text,previous_status text,new_status text,metadata jsonb);
    INSERT INTO settlement_payroll_audit_events(scope,record_type,record_id,action,metadata)
      VALUES ('YEMAIT_COMPANY','SETTLEMENT_PROFILE',11,'PRIOR_EVENT','{}');
    CREATE FUNCTION prevent_settlement_payroll_audit_mutation() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'Audit is append-only' USING ERRCODE='55000'; END $$;
    CREATE TRIGGER settlement_payroll_audit_append_only BEFORE UPDATE OR DELETE
      ON settlement_payroll_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_settlement_payroll_audit_mutation();
    CREATE TABLE audit_logs (
      id serial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
      school_id integer,action text,module text,severity text,event_type text,result text,metadata jsonb);
    INSERT INTO audit_logs(action) VALUES ('PRIOR_SECURITY_EVENT');
    CREATE TABLE student_subscription_payments (id integer PRIMARY KEY,payload text);
    CREATE TABLE fee_payments (id integer PRIMARY KEY,payload text);
    CREATE TABLE flutterwave_split_recipients (id integer PRIMARY KEY,payload text);
    CREATE TABLE payroll_payslips (id integer PRIMARY KEY,payload text);
    INSERT INTO student_subscription_payments VALUES (1,'unchanged');
    INSERT INTO fee_payments VALUES (1,'unchanged');
    INSERT INTO flutterwave_split_recipients VALUES (1,'unchanged');
    INSERT INTO payroll_payslips VALUES (1,'unchanged');
  `);
  await seed.end();
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
}, 30000);

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
  fixture.options = { host: "helium", port: 5432, database: "heliumdb" };
  fixture.fingerprint = "c95705198e31d45bbfbfeb688a774412";
  fixture.missingAuditGuard = false; fixture.calls = []; fixture.connections = 0;
  const database = `removal_case_${++caseNumber}`;
  await admin.query(`CREATE DATABASE ${database} TEMPLATE removal_fixture`);
  fixture.pool = new Pool({ host: dir, port: 55371, user: process.env.USER ?? "runner", database });
});
afterEach(async () => {
  await fixture.pool?.end();
  await admin.query(`DROP DATABASE removal_case_${caseNumber}`);
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  await admin?.end();
  if (postgres && postgres.exitCode === null) {
    const exited = new Promise<void>(r => postgres.once("exit", () => r()));
    postgres.kill("SIGTERM"); await exited;
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("Development settlement removal against disposable PostgreSQL", () => {
  it("reviews exact microsecond version and identity without bank data, mutation or audit writes", async () => {
    const before = await snapshot();
    const r = await request(`${companyPath}/removal-review`, "GET");
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toMatchObject({ profileId: 11, version, eligible: true, businessName: "Synthetic company" });
    expect(Object.keys(body).sort()).toEqual(["businessName","developmentOnly","eligible","notice","profileId","schoolId","scope","status","version"]);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["SCHOOL_ADMIN", "ACCOUNTANT", "PARENT", "PARTNER_ADMIN"])("denies %s company removal before database access", async role => {
    expect((await request(companyPath, "DELETE", input(), { "x-test-role": role })).status).toBe(403);
    expect(fixture.connections).toBe(0);
  });
  it("denies an inactive Owner", async () => {
    expect((await request(companyPath, "DELETE", input(), { "x-test-status": "INACTIVE" })).status).toBe(403);
    expect(fixture.connections).toBe(0);
  });
  it("removes only the exact company profile and appends both audits, preserving unrelated records", async () => {
    const before = await snapshot();
    expect((await request(companyPath)).status).toBe(200);
    const after = await snapshot();
    expect(after.settlement_payroll_profiles).toEqual(before.settlement_payroll_profiles.filter((r: any) => r.id !== 11));
    expect(after.settlement_payroll_audit_events[0]).toEqual(before.settlement_payroll_audit_events[0]);
    expect(after.audit_logs[0]).toEqual(before.audit_logs[0]);
    expect(after.settlement_payroll_audit_events).toHaveLength(2);
    expect(after.audit_logs).toHaveLength(2);
    expect(after.settlement_payroll_audit_events[1]).toMatchObject({
      record_id: 11,actor_user_id:99,actor_role:"PLATFORM_OWNER",action:"PENDING_SETTLEMENT_PROFILE_REMOVED",
    });
    for (const t of ["student_subscription_payments","fee_payments","flutterwave_split_recipients","payroll_payslips"]) {
      expect(after[t]).toEqual(before[t]);
    }
    expect(fixture.calls.filter(s => /^(DELETE|UPDATE)/.test(s))).toHaveLength(1);
  });
  it("allows only the School Admin's own school and preserves company profile", async () => {
    expect((await request(schoolPath, "DELETE", input(12), { "x-test-role": "SCHOOL_ADMIN" })).status).toBe(200);
    expect((await fixture.pool!.query("SELECT id FROM settlement_payroll_profiles ORDER BY id")).rows).toEqual([{id:11},{id:13}]);
  });
  it("accepts an exact single-digit record ID", async () => {
    await fixture.pool!.query("UPDATE settlement_payroll_profiles SET id=1 WHERE id=11");
    expect((await request(companyPath, "DELETE", input(1))).status).toBe(200);
  });
  it.each([
    { "x-test-role": "SCHOOL_ADMIN", "x-test-school": "8" },
    { "x-test-role": "ACCOUNTANT" },
    { "x-test-role": "PLATFORM_OWNER" },
    { "x-test-role": "SCHOOL_ADMIN", "x-test-owner": "true" },
    { "x-test-role": "SCHOOL_ADMIN", "x-test-status": "INACTIVE" },
  ])("denies wrong tenant/role, inactive and mixed-role Owner school writes: %j", async headers => {
    const cleaned = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) as Record<string, string>;
    const r = await request(schoolPath, "DELETE", input(12), cleaned);
    expect([403,404]).toContain(r.status);
    expect(fixture.connections).toBe(0);
  });
  it.each([["production",""],["development","1"]])("rejects environment %s deployment %s before DB access", async (environment, deployment) => {
    vi.stubEnv("NODE_ENV", environment); vi.stubEnv("REPLIT_DEPLOYMENT", deployment);
    expect((await request(companyPath)).status).toBe(404);
    expect((await request(`${companyPath}/removal-review`, "GET")).status).toBe(404);
    expect(fixture.connections).toBe(0);
  });
  it("rejects a different configured host before any connection", async () => {
    fixture.options.host = "unapproved.invalid";
    expect((await request(companyPath)).status).toBe(503);
    expect(fixture.connections).toBe(0);
  });
  it("rejects a changed database receipt before reading a profile", async () => {
    fixture.fingerprint = "unapproved";
    expect((await request(companyPath)).status).toBe(503);
    expect(fixture.calls.some(s => s.startsWith("SELECT id,scope"))).toBe(false);
    expect(fixture.calls).toContain("ROLLBACK");
  });
  it("rejects unexpected incoming foreign keys instead of cascading", async () => {
    await fixture.pool!.query("CREATE TABLE unexpected_dependency (profile_id integer REFERENCES settlement_payroll_profiles(id))");
    expect((await request(companyPath)).status).toBe(503);
    expect(fixture.calls.some(s => s.startsWith("DELETE"))).toBe(false);
  });
  it("rejects an absent audit guard without disabling any actual guard", async () => {
    fixture.missingAuditGuard = true;
    expect((await request(companyPath)).status).toBe(503);
    expect(fixture.calls.some(s => s.startsWith("DELETE"))).toBe(false);
  });
  it.each([
    "verification_status='VERIFIED'",
    "verification_status='ACTION_REQUIRED'",
    "verified_at=NOW()",
    "verified_by=99",
    "provider_subaccount_id='RS_SYNTHETIC_RECIPIENT'",
  ])("rejects ineligible profile: %s", async change => {
    await fixture.pool!.query(`UPDATE settlement_payroll_profiles SET ${change} WHERE id=11`);
    const before = await snapshot();
    expect((await request(companyPath)).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
  it("rejects stale versions and retains every record", async () => {
    const before = await snapshot();
    expect((await request(companyPath, "DELETE", { ...input(), expectedVersion: "2026-10-13T12:00:00.123455Z" })).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
  it("rejects an ID in another scope", async () => {
    const before = await snapshot();
    expect((await request(companyPath, "DELETE", input(12))).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    { expectedProfileId: 11 }, { ...input(), confirmation: "REMOVE PROFILE 12" },
    { ...input(), unexpected: "field" }, { ...input(), expectedVersion: "invalid" },
  ])("requires the complete exact confirmation: %j", async body => {
    expect((await request(companyPath, "DELETE", body)).status).toBe(400);
    expect(fixture.connections).toBe(0);
  });
  it("rolls back deletion AND the first audit if the second audit fails", async () => {
    await fixture.pool!.query("ALTER TABLE audit_logs ADD CONSTRAINT fixture_reject_removal CHECK(action NOT LIKE '%pending_settlement_profile_removed%')");
    const before = await snapshot();
    expect((await request(companyPath)).status).toBe(500);
    expect(fixture.calls).toContain("ROLLBACK");
    expect(await snapshot()).toEqual(before);
  });
  it("preserves the actual append-only audit trigger", async () => {
    await expect(fixture.pool!.query("DELETE FROM settlement_payroll_audit_events WHERE id=1")).rejects.toMatchObject({ code: "55000" });
    expect((await fixture.pool!.query("SELECT count(*)::int n FROM settlement_payroll_audit_events")).rows[0].n).toBe(1);
  });
});
