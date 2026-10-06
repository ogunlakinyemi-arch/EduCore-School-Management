import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {pool} from "@workspace/db";
import {ensureClassNfcSubscriptions} from "../lib/student-nfc-obligations";

const baselinePath=".local/nfc-fees-preservation-before.json";
process.chdir(fileURLToPath(new URL("../../../../",import.meta.url)));
const expected={db:"heliumdb",addr:null,port:null,started:"2026-10-06 07:47:09.712895+00"};
async function fingerprint(){
  const result=await pool.query("SELECT current_database() AS db,inet_server_addr()::text AS addr,inet_server_port() AS port,pg_postmaster_start_time()::text AS started");
  if(JSON.stringify(result.rows[0])!==JSON.stringify(expected)) throw new Error("Development identity changed; independently revalidate before any writes.");
}
async function financialSnapshot(previous?:any){
  const names=previous?Object.keys(previous):(await pool.query(`SELECT t.table_name FROM information_schema.tables t
    WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
      AND t.table_name ~ '^(fee_|subscriptions$|student_subscription_|staff_subscription_|commission_|payout_|payroll_|wallet_|nfc_cards$)'
    ORDER BY t.table_name`)).rows.map(r=>r.table_name);
  const output:Record<string,any>={};
  for(const name of names){
    if(!/^[a-z_]+$/.test(name))throw new Error("Unsafe table name");
    const hasId=(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'",[name])).rows.length>0;
    const max=hasId?(previous?.[name].max??Number((await pool.query(`SELECT COALESCE(max(id),0) AS max FROM "${name}"`)).rows[0].max)):null;
    const result=await pool.query(`SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY ${hasId?"t.id":"to_jsonb(t)::text"})::text,'[]')) AS hash
      FROM "${name}" t ${hasId?"WHERE t.id<=$1":""}`,hasId?[max]:[]);
    output[name]={max,...result.rows[0]};
  }
  return output;
}
try{
  await fingerprint();
  const mode=process.argv[2];
  if(mode==="baseline"){
    const snapshot=await financialSnapshot();
    writeFileSync(baselinePath,JSON.stringify(snapshot,null,2));
    console.log(`Captured original-row hashes for ${Object.keys(snapshot).length} financial/card tables.`);
  } else if(mode==="apply"){
    const c=await pool.connect();
    try{
      await c.query("BEGIN");
      if((await c.query("SELECT to_regclass('public.student_subscription_terms') AS found")).rows[0].found)throw new Error("Binding migration already applied; refusing replay.");
      await c.query(readFileSync("lib/db/drizzle/0058_student_subscription_terms.sql","utf8"));
      const classes=await c.query(`SELECT DISTINCT fs.school_id,fs.academic_session_id,fs.academic_term_id,fs.school_class_id,fs.section
        FROM fee_structures fs JOIN academic_terms t ON t.id=fs.academic_term_id AND t.school_id=fs.school_id
        JOIN academic_sessions ses ON ses.id=fs.academic_session_id AND ses.school_id=fs.school_id AND ses.id=t.academic_session_id
        WHERE fs.status IN ('DRAFT','PUBLISHED') AND t.end_date>=CURRENT_DATE
          AND upper(t.status) IN ('ACTIVE','PLANNED') AND upper(ses.status) IN ('ACTIVE','PLANNED')
          AND EXISTS(SELECT 1 FROM fee_structure_lines fl WHERE fl.structure_id=fs.id AND fl.school_id=fs.school_id
            AND fl.amount_minor>0 AND fl.category_name_snapshot !~* '(nfc.*subscription|subscription.*nfc)'
            AND fl.description_snapshot !~* '(nfc.*subscription|subscription.*nfc)')
        ORDER BY fs.school_id,fs.academic_session_id,fs.academic_term_id,fs.school_class_id,fs.section`);
      for(const cls of classes.rows)await ensureClassNfcSubscriptions(c,cls.school_id,cls.academic_session_id,cls.academic_term_id,cls.school_class_id,cls.section);
      await c.query("COMMIT");
      console.log(`Development-only period binding applied to ${classes.rows.length} existing ordinary-fee cohorts.`);
    }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  } else if(mode==="verify"){
    const before=JSON.parse(readFileSync(baselinePath,"utf8"));
    const after=await financialSnapshot(before);
    const changed=Object.keys(before).filter(name=>JSON.stringify(before[name])!==JSON.stringify(after[name]));
    if(changed.length)throw new Error(`Original records changed in: ${changed.join(",")}`);
    console.log(`Preserved all original rows across ${Object.keys(before).length} financial/card tables.`);
    console.log((await pool.query(`SELECT count(*) AS bindings,count(subscription_id) AS ledger_bindings,count(legacy_invoice_id) AS legacy_reviews FROM student_subscription_terms`)).rows[0]);
  } else throw new Error("Use baseline, apply or verify. This is not a startup/deploy migration.");
}finally{await pool.end();}
