import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createSchoolRows } from "./educore-expansion-browser-fixtures";
const require = createRequire(process.cwd() + "/lib/db/package.json");
const { Client } = require("pg");
const file = "/tmp/educore-notification-browser-fixtures.json";
const mode = process.argv[2];
if (!["--provision","--retire","--ticket"].includes(mode ?? "") || !process.env.REPLIT_DEV_DOMAIN ||
  process.env.REPLIT_DEPLOYMENT || !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw Error("Explicit Development-only operation required");
const apiRequire = createRequire(process.cwd() + "/artifacts/api-server/package.json");
const { clerkClient: clerk } = await import(apiRequire.resolve("@clerk/express"));
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const baseline = JSON.parse(await readFile("/tmp/educore-notification-baseline.json","utf8"));
  const identity = (await c.query("SELECT current_database() db,pg_postmaster_start_time()::text started")).rows[0];
  if (JSON.stringify(identity) !== JSON.stringify(baseline.identity)) throw Error("Independent Development identity mismatch");
  if (mode === "--provision") {
    if (await readFile(file).then(()=>true).catch(()=>false)) throw Error("Fixture already exists; do not provision twice");
    const nonce = randomUUID().replaceAll("-","");
    const m = { nonce, label:`NOTIFICATION QA ${nonce}`, state:"PREPARING", developmentIdentity:identity, ids:{},
      fixtureIdentities:["parent1","student1","parent2","teacher","schoolAdmin","accountant","partner"].map(role=>({
        role, firstName:"Notification",lastName:role,email:`notification-${role}-${nonce}@example.com`,
        clerkUserId:null as string|null,appUserId:null as number|null,
      })) };
    await writeFile(file,JSON.stringify(m),{mode:0o600});
    for (const u of m.fixtureIdentities) {
      const user = await clerk.users.createUser({emailAddress:[u.email],firstName:u.firstName,lastName:u.lastName,
        skipPasswordRequirement:true, privateMetadata:{purpose:"notification-development-test",nonce}});
      u.clerkUserId = user.id;
      await writeFile(file,JSON.stringify(m),{mode:0o600});
    }
    await c.query("BEGIN");
    await createSchoolRows(c,m,false);
    await c.query("COMMIT");
    m.state="READY";
    await writeFile(file,JSON.stringify(m),{mode:0o600});
    console.log(JSON.stringify({state:m.state,users:m.fixtureIdentities.length,schoolId:(m.ids as any).schoolId}));
  } else {
    const m = JSON.parse(await readFile(file,"utf8"));
    if (JSON.stringify(m.developmentIdentity)!==JSON.stringify(identity)) throw Error("Fixture database mismatch");
    if (mode === "--ticket") {
      if (m.state !== "READY") throw Error("Fixture is not active");
      const u = m.fixtureIdentities.find((u:any)=>u.role===process.argv[3]);
      if (!u?.clerkUserId) throw Error("Unknown fixture role");
      const ticket = await clerk.signInTokens.createSignInToken({userId:u.clerkUserId,expiresInSeconds:120});
      const out = `/tmp/educore-notification-ticket-${u.role}.json`;
      await writeFile(out,JSON.stringify({ticket:ticket.token,role:u.role}),{mode:0o600});
      console.log(JSON.stringify({ticketFile:out}));
    } else {
      await c.query("BEGIN");
      const id = Number(m.ids.schoolId);
      const owned = await c.query("SELECT id FROM schools WHERE id=$1 AND code=$2 FOR UPDATE",[id,m.label]);
      if (!owned.rows[0]) throw Error("Owned fixture school mismatch");
      const ids = m.fixtureIdentities.map((u:any)=>u.appUserId).filter(Number.isSafeInteger);
      if ((await c.query("SELECT 1 FROM school_memberships WHERE user_id=ANY($1) AND role='PLATFORM_OWNER'",[ids])).rows.length) throw Error("Owner cannot be retired");
      await c.query("UPDATE schools SET status='inactive' WHERE id=$1",[id]);
      await c.query("UPDATE school_memberships SET status='INACTIVE' WHERE school_id=$1 AND user_id=ANY($2)",[id,ids]);
      await c.query("UPDATE app_users SET status='INACTIVE' WHERE id=ANY($1)",[ids]);
       await c.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW()
         WHERE school_id=$1 AND device_id=$2 AND status='ACTIVE'`,[id,m.ids.deviceId]);
       await c.query(`UPDATE platform_devices SET status='INACTIVE'
         WHERE id=$1 AND school_id=$2 AND serial_number=$3`,[m.ids.deviceId,id,`${m.label}-GATE`]);
      await c.query("UPDATE communication_push_devices SET status='REVOKED',revoked_at=NOW() WHERE user_id=ANY($1) AND status='ACTIVE'",[ids]);
      await c.query("UPDATE communication_deliveries SET status='CANCELLED',error_code='TEST_FIXTURE_RETIRED' WHERE status IN('QUEUED','PROCESSING','FAILED') AND notification_id IN(SELECT id FROM communication_notifications WHERE school_id=$1)",[id]);
      await c.query("COMMIT");
      let deleted=0;
      for(const u of m.fixtureIdentities) if(u.clerkUserId) { await clerk.users.deleteUser(u.clerkUserId); deleted++; }
      m.state="RETIRED"; await writeFile(file,JSON.stringify(m),{mode:0o600});
      console.log(JSON.stringify({state:m.state,deletedClerkUsers:deleted,schoolHistoryRetained:true}));
    }
  }
} catch(e) { await c.query("ROLLBACK").catch(()=>undefined); throw e; } finally { await c.end(); }