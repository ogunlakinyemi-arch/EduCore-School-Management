import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const {Client}=createRequire(process.cwd()+"/lib/db/package.json")("pg");
const ddl=await readFile("lib/db/drizzle/0055_academic_calendar_fee_lines_cash.sql","utf8");
const source=new Client({connectionString:process.env.DATABASE_URL});
const local=new Client({host:"/tmp",port:55435,user:"postgres",database:"postgres"});
const baselinePath="/tmp/educore-academic-preservation.json";
try {
  if(process.env.REPLIT_DEPLOYMENT) throw Error("Development only");
  await source.connect();
  const identity=(await source.query("SELECT current_database() name,pg_postmaster_start_time() started,inet_server_addr() host")).rows[0];
  if(identity.name!=="heliumdb"||new Date(identity.started).toISOString()!=="2026-10-04T10:45:56.703Z"||identity.host!==null) throw Error("Unverified Development target");
  if(process.argv.includes("--prepare-native")) {
    await source.query("BEGIN READ ONLY");
    const original=JSON.parse(await readFile("artifacts/api-server/.local/test-fixtures/hardening-baseline.json","utf8"));
    for(const [t,b] of Object.entries(original.baseline)){
      const fields=b.columns.map(v=>`'${v}',t."${v}"`).join(",");
      const digest=(await source.query(`SELECT md5(COALESCE(string_agg(md5(jsonb_build_object(${fields})::text),'' ORDER BY id),'')) digest FROM "${t}" t WHERE id<=$1`,[b.max])).rows[0].digest;
      if(digest!==b.digest) throw Error(`Original historical records changed: ${t}`);
    }
    const tables=(await source.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id'
      AND data_type IN ('integer','bigint','smallint') AND table_name !~ '^(app_users|sessions|notification|platform_notification|communication)' ORDER BY table_name`)).rows;
    const baseline={};
    for(const {table_name:t} of tables) {
      if(!/^[a-z_]+$/.test(t)) throw Error("Invalid catalog identifier");
      const columns=(await source.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[t])).rows.map(r=>r.column_name);
      const fields=columns.map(v=>`'${v}',t."${v}"`).join(",");
      const row=(await source.query(`SELECT COALESCE(max(id),0) max,md5(COALESCE(string_agg(md5(jsonb_build_object(${fields})::text),'' ORDER BY id),'')) digest FROM "${t}" t`)).rows[0];
      baseline[t]={...row,columns};
    }
    await source.query("ROLLBACK");
    await writeFile(baselinePath,JSON.stringify(baseline));
    await local.connect();
    const target=(await local.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
    if(target.dir!=="/tmp/educore-academic-pgdata"||target.host!==null) throw Error("Disposable PostgreSQL only");
    if(Number((await local.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n)!==0) throw Error("Native preparation requires an empty disposable database; never overwrite existing data");
    const dump=spawnSync("pg_dump",["--schema-only","--no-owner","--no-privileges","--schema=public","--dbname",process.env.DATABASE_URL],{encoding:"utf8",maxBuffer:20000000});
    if(dump.status!==0) throw Error("Read-only schema export failed (connection details suppressed)");
    await local.query(dump.stdout.replace(/^\\(?:un)?restrict .*$/gm,"").replace(/^CREATE SCHEMA public;$/gm,""));
    await local.query("SET search_path TO public");
    await local.query("BEGIN");await local.query(ddl);await local.query("ROLLBACK");
    if((await local.query("SELECT 1 FROM information_schema.columns WHERE table_name='fee_payments' AND column_name='selected_line_ids'")).rows.length) throw Error("Migration rollback failed");
    await local.query(ddl);await local.query(ddl);
    process.stdout.write(JSON.stringify({originalHistoricalTablesPreserved:Object.keys(original.baseline).length,capturedTables:tables.length,migrationRollback:1,migrationDoubleReplay:1,sourceReadOnly:true})+"\n");
  } else if(process.argv.includes("--apply-development")) {
    await source.query("BEGIN");
    await source.query(ddl);
    const hash=createHash("sha256").update(ddl).digest("hex");
    if(!(await source.query("SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1",[hash])).rows.length)
      await source.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)",[hash,1791111600000]);
    await source.query("COMMIT");
    process.stdout.write(JSON.stringify({developmentOnly:true,additiveMigration:"0055",historicalDataRewritten:false})+"\n");
  } else {
    await source.query("BEGIN READ ONLY");
    const baseline=JSON.parse(await readFile(baselinePath,"utf8"));
    for(const [t,b] of Object.entries(baseline)) {
      const fields=b.columns.map(v=>`'${v}',t."${v}"`).join(",");
      const row=(await source.query(`SELECT md5(COALESCE(string_agg(md5(jsonb_build_object(${fields})::text),'' ORDER BY id),'')) digest FROM "${t}" t WHERE id<=$1`,[b.max])).rows[0];
      if(row.digest!==b.digest) throw Error(`Existing records changed: ${t}`);
    }
    await source.query("ROLLBACK");
    process.stdout.write(JSON.stringify({preservedTables:Object.keys(baseline).length,readOnly:true})+"\n");
  }
} finally {await source.end();await local.end();}