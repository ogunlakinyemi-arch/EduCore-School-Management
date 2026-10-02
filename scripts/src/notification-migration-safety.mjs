import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(process.cwd() + "/lib/db/package.json");
const { Client } = require("pg");
const sql = await readFile("lib/db/drizzle/0048_communication_external_channels.sql", "utf8");
const baseline = JSON.parse(await readFile("/tmp/educore-notification-baseline.json", "utf8"));
const local = process.argv.includes("--local");
const apply = process.argv.includes("--apply-confirmed-development-only");
if (!local && !apply && !process.argv.includes("--verify-development")) throw Error("Explicit mode required");
if (!local && (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))) throw Error("Development only");
const c = new Client(local ? { host: "/tmp", port: 55433, user: "postgres", database: "postgres" } : { connectionString: process.env.DATABASE_URL });
await c.connect();
const metadataSql = `SELECT 'column' kind,table_name,column_name name, concat_ws('|',data_type,is_nullable,column_default) definition
  FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'constraint',cl.relname,con.conname,pg_get_constraintdef(con.oid,true)
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE ns.nspname='public'
  UNION ALL SELECT 'trigger',cl.relname,t.tgname,pg_get_triggerdef(t.oid,true)||p.prosrc
  FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal`;
async function verifyRows() {
  const identity = (await c.query("SELECT current_database() db,pg_postmaster_start_time()::text started")).rows[0];
  if (JSON.stringify(identity) !== JSON.stringify(baseline.identity)) throw Error("Independent Development identity mismatch");
  for (const [t, expected] of Object.entries(baseline.tables)) {
    if (!/^[a-z_]+$/.test(t)) throw Error("Unsafe identifier");
    const rows = (await c.query(`SELECT md5((SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(t))
      WHERE key=ANY($1::text[]))::text) hash,count(*)::int count FROM "${t}" t GROUP BY hash`, [expected.cols])).rows;
    const actual = new Map(rows.map(r => [r.hash,r.count]));
    for (const r of expected.hashes) if ((actual.get(r.hash) ?? 0) < r.count) throw Error(`Preserved record changed in ${t}`);
  }
}
try {
  const old = (await c.query(metadataSql)).rows;
  if (local) {
    const identity = (await c.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
    if (identity.host !== null || identity.dir !== "/tmp/educore-notification-postgres") throw Error("Disposable PostgreSQL only");
    await c.query("BEGIN"); await c.query(sql); await c.query("ROLLBACK");
    if (JSON.stringify((await c.query(metadataSql)).rows) !== JSON.stringify(old)) throw Error("DDL rollback mismatch");
    await c.query(sql); await c.query(sql);
  } else {
    await verifyRows();
    if (apply) {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
      const previous = (await c.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")).rows[0]?.hash;
      const priorFile = await readFile("lib/db/drizzle/0047_parent_communication_extensions.sql","utf8");
      if (previous !== createHash("sha256").update(priorFile).digest("hex")) throw Error("Unexpected historical ledger");
      await c.query(sql);
      await verifyRows();
      const after = new Map((await c.query(metadataSql)).rows.map(r => [`${r.kind}:${r.table_name}:${r.name}`,r.definition]));
      for (const r of old) if (after.get(`${r.kind}:${r.table_name}:${r.name}`) !== r.definition) throw Error("Existing DDL changed");
      await c.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)",
        [createHash("sha256").update(sql).digest("hex"),1790977200000]);
      await c.query("COMMIT");
    }
  }
  const after = new Map((await c.query(metadataSql)).rows.map(r => [`${r.kind}:${r.table_name}:${r.name}`,r.definition]));
  for (const r of old) if (after.get(`${r.kind}:${r.table_name}:${r.name}`) !== r.definition) throw Error("Existing DDL changed");
  const report = { mode:local ? "disposable" : "development", preservedTables: Object.keys(baseline.tables).length,
    preservedColumns:Object.values(baseline.tables).reduce((n,t)=>n+t.cols.length,0),
    preservedRows:local ? 0 : Object.values(baseline.tables).reduce((n,t)=>n+t.hashes.reduce((m,r)=>m+r.count,0),0),
    originalMetadataUnchanged:true, migrationRollback:local, migrationReplay:local };
  await writeFile(`/tmp/educore-notification-${local ? "native" : "development"}-preservation.json`,JSON.stringify(report));
  console.log(JSON.stringify(report));
} catch(e) { await c.query("ROLLBACK").catch(()=>undefined); throw e; } finally { await c.end(); }