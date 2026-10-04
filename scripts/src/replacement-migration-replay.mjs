// Read-only Development schema clone; all rehearsal DDL runs on a guarded disposable server.
import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const require=createRequire(process.cwd()+"/lib/db/package.json");
const {Client}=require("pg");
if(process.env.REPLIT_DEPLOYMENT || process.argv[2]!=="--verified-development-schema-clone") throw Error("Explicit Development clone mode required");
const dev=new Client({connectionString:process.env.DATABASE_URL});
const local=new Client({host:"/tmp",port:55434,user:"postgres",database:"postgres"});
const metadata=`SELECT c.relname,t.conname,pg_get_constraintdef(t.oid,true) definition
  FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname<>'student_nfc_replacement_requests'
  UNION ALL SELECT table_name,column_name,concat_ws('|',data_type,is_nullable,column_default)
  FROM information_schema.columns WHERE table_schema='public' AND table_name<>'student_nfc_replacement_requests'
  ORDER BY 1,2,3`;
try {
  await dev.connect(); await local.connect();
  const identity=(await dev.query("SELECT current_database() db,pg_postmaster_start_time()::text started")).rows[0];
  if(identity.db!=="heliumdb" || identity.started!==process.argv[3] ||
    (await dev.query("SELECT id FROM schools WHERE id=1448 AND name='TRANSPORT-QA-8F79E940266A4C58'")).rows.length!==1) throw Error("Unverified Development schema source");
  const target=(await local.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
  if(target.dir!=="/tmp/educore-replacement-pgdata" || target.host!==null) throw Error("Disposable PostgreSQL only");
  const dump=spawnSync("pg_dump",["--schema-only","--no-owner","--no-privileges","--schema=public","--schema=drizzle",
    "--exclude-table=public.student_nfc_replacement_requests","--dbname",process.env.DATABASE_URL],{encoding:"utf8",maxBuffer:20_000_000});
  if(dump.status!==0) throw Error("Development schema-only dump failed (connection details suppressed)");
  await local.query("DROP SCHEMA public CASCADE");
  await local.query(dump.stdout.replace(/^\\(?:un)?restrict .*$/gm,""));
  await local.query("SET search_path TO public");
  const before=JSON.stringify((await local.query(metadata)).rows);
  const ddl=await readFile("lib/db/drizzle/0052_student_nfc_replacement_requests.sql","utf8");
  await local.query("BEGIN"); await local.query(ddl); await local.query("ROLLBACK");
  if((await local.query("SELECT to_regclass('public.student_nfc_replacement_requests') name")).rows[0].name!==null) throw Error("DDL rollback failed");
  await local.query(ddl); await local.query(ddl);
  if(JSON.stringify((await local.query(metadata)).rows)!==before) throw Error("Existing schema definitions changed");
  const constraints=(await local.query(`SELECT pg_get_constraintdef(oid,true) d FROM pg_constraint WHERE conrelid='student_nfc_replacement_requests'::regclass`)).rows;
  if(constraints.filter(x=>x.d.includes("FOREIGN KEY")).length!==7 || constraints.filter(x=>x.d.includes("CHECK")).length!==3) throw Error("Replacement relationship constraints missing");
  const report={developmentReadOnly:true,disposableRollback:"PASS",disposableReplayTwice:"PASS",
    existingSchemaUnchanged:true,relationshipConstraints:constraints.length,migrationSha256:createHash("sha256").update(ddl).digest("hex")};
  await writeFile("/tmp/educore-replacement-migration-replay.json",JSON.stringify(report));
  console.log(JSON.stringify(report));
} finally {await dev.end(); await local.end();}