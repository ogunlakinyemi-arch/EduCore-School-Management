import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const {Client}=createRequire(process.cwd()+"/lib/db/package.json")("pg");
if(process.env.REPLIT_DEPLOYMENT) throw Error("Development only");
const dev=new Client({connectionString:process.env.DATABASE_URL});
const local=new Client({host:"/tmp",port:55435,user:"postgres",database:"postgres"});
const migrations=["0053_class_transport_fee_applicability","0054_employee_card_replacement_finance"];
try {
  await dev.connect();
  const identity=(await dev.query("SELECT current_database() name,pg_postmaster_start_time() started")).rows[0];
  if(identity.name!=="heliumdb"||new Date(identity.started).toISOString()!=="2026-10-04T08:40:42.935Z") throw Error("Unverified Development target");
  const texts=await Promise.all(migrations.map(n=>readFile(`lib/db/drizzle/${n}.sql`,"utf8")));
  if(process.argv.includes("--apply-verified-development")) {
    if(!(await dev.query("SELECT to_regclass('drizzle.__drizzle_migrations') name")).rows[0].name) throw Error("Migration ledger missing");
    await dev.query("BEGIN");
    for(let i=0;i<texts.length;i++){
      const hash=createHash("sha256").update(texts[i]).digest("hex");
      await dev.query(texts[i]);
      if(!(await dev.query("SELECT id FROM drizzle.__drizzle_migrations WHERE hash=$1",[hash])).rows.length)
        await dev.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)",[hash,1791104400000+i*1000]);
    }
    await dev.query("COMMIT");console.log(JSON.stringify({developmentOnly:true,applied:migrations}));
  } else {
    await local.connect();
    const target=(await local.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
    if(target.dir!=="/tmp/educore-hardening-pgdata"||target.host!==null) throw Error("Disposable PostgreSQL only");
    const dump=spawnSync("pg_dump",["--schema-only","--no-owner","--no-privileges","--schema=public","--dbname",process.env.DATABASE_URL],{encoding:"utf8",maxBuffer:20000000});
    if(dump.status!==0) throw Error("Read-only schema dump failed (connection details suppressed)");
    // Only this guarded disposable server is reset; the Development source is read-only.
    await local.query("DROP SCHEMA public CASCADE");
    await local.query(dump.stdout.replace(/^\\(?:un)?restrict .*$/gm,""));
    await local.query("SET search_path TO public");
    const beforeEmployeeColumns=(await local.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_invoices' AND column_name='employee_id'")).rows[0].n;
    await local.query("BEGIN");
    for(const ddl of texts) await local.query(ddl);
    await local.query("ROLLBACK");
    if((await local.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='fee_invoices' AND column_name='employee_id'")).rows[0].n!==beforeEmployeeColumns) throw Error("DDL rollback failed");
    for(let replay=0;replay<2;replay++) for(const ddl of texts) await local.query(ddl);
    const checks=(await local.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname IN ('fee_invoices_person_check','fee_payments_person_check','replacement_person_check','fee_invoices_employee_school_fk','fee_payments_employee_school_fk','replacement_employee_school_fk')`)).rows[0].n;
    if(checks!==6) throw Error("Person constraints missing");
    const report={developmentReadOnly:true,rollback:"PASS",replayTwice:"PASS",personConstraints:checks,migrations};
    await writeFile("/tmp/educore-hardening-schema-replay.json",JSON.stringify(report));console.log(JSON.stringify(report));
  }
} catch(error){await dev.query("ROLLBACK").catch(()=>{});throw error;}
finally {await dev.end();await local.end();}