import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {pool} from "@workspace/db";
process.chdir(fileURLToPath(new URL("../../../../",import.meta.url)));
const path=".local/partner-nfc-preservation.json";
const expected={db:"heliumdb",addr:null,port:null,started:"2026-10-06 07:47:09.712895+00"};
async function fingerprint(){
  const r=await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS addr,inet_server_port() AS port,pg_postmaster_start_time()::text AS started");
  if(JSON.stringify(r.rows[0])!==JSON.stringify(expected))throw new Error("Development identity changed; independently revalidate before writes.");
}
async function snapshot(previous?:any){
  const tables=previous?Object.keys(previous):(await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    AND table_type='BASE TABLE' AND table_name ~ '^(fee_|subscriptions$|student_subscription_|staff_subscription_|commission_|payout_|payroll_|wallet_|nfc_|partner_|school_partner_|platform_devices$|device_|students$|schools$)' ORDER BY table_name`)).rows.map(r=>r.table_name);
  const result:Record<string,any>={};
  for(const table of tables){
    if(!/^[a-z_]+$/.test(table))throw new Error("Unsafe table");
    const columns=previous?.[table].columns??(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table])).rows.map(r=>r.column_name);
    if(columns.some((c:string)=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)))throw new Error("Unsafe column");
    const hasId=columns.includes("id");
    const max=hasId?(previous?.[table].max??Number((await pool.query(`SELECT coalesce(max(id),0) AS max FROM "${table}"`)).rows[0].max)):null;
    const r=await pool.query(`SELECT count(*)::int AS count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${hasId?"t.id":"to_jsonb(t)::text"})::text,'[]')) AS hash FROM (SELECT ${columns.map((c:string)=>`"${c}"`).join(",")} FROM "${table}" ${hasId?"WHERE id<=$1":""})t`,hasId?[max]:[]);
    result[table]={columns,max,...r.rows[0]};
  }
  return result;
}
try{
  await fingerprint();
  const mode=process.argv[2];
  if(mode==="baseline"){
    try{readFileSync(path);throw new Error("Preservation baseline already exists; refusing overwrite.");}catch(e:any){if(e.code!=="ENOENT")throw e;}
    const data=await snapshot();writeFileSync(path,JSON.stringify(data,null,2));console.log(`Captured ${Object.keys(data).length} original-table hashes.`);
  }else if(mode==="apply"){
    readFileSync(path);
    const c=await pool.connect();try{await c.query("BEGIN");await c.query(readFileSync("lib/db/drizzle/0059_partner_nfc_permission.sql","utf8"));await c.query("COMMIT");console.log("Development-only default-off permission columns applied.");}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }else if(mode==="schema-snapshot"){
    const ddl=execFileSync("pg_dump",["--schema-only","--no-owner","--no-privileges",process.env.DATABASE_URL!],{maxBuffer:16*1024*1024});
    writeFileSync("/tmp/partner-nfc-schema.sql",ddl);console.log("Development schema-only snapshot saved for disposable PostgreSQL tests.");
  }else if(mode==="verify"){
    const before=JSON.parse(readFileSync(path,"utf8")),after=await snapshot(before);
    const changed=Object.keys(before).filter(t=>JSON.stringify(before[t])!==JSON.stringify(after[t]));
    if(changed.length)throw new Error(`Original data changed: ${changed.join(",")}`);
    console.log(`All original fields/rows preserved across ${Object.keys(before).length} tables; additive columns excluded by recorded original-column projection.`);
  }else throw new Error("Use baseline, apply or verify; never run as a startup migration.");
}finally{await pool.end();}
