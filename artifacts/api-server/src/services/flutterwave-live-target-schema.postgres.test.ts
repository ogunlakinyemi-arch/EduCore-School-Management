import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {DatabasePool,type DatabasePoolClient} from "@workspace/db/driver";
import {beforeAll,afterAll,describe,it,expect} from "vitest";

const root=fileURLToPath(new URL("../../../../",import.meta.url));
const names=["flutterwave-live-webhook-inbox","flutterwave-live-finalization","flutterwave-live-workflow","flutterwave-live-readiness"];
let directory:string,postgres:ChildProcess,pool:InstanceType<typeof DatabasePool>;
let client:DatabasePoolClient;
let manifest:any,rawResult:string,sharedBefore:unknown,schemaBefore:unknown,liveSchema:unknown;
const ups:string[]=[],downs:string[]=[];
const rows=async(sql:string,values?:unknown[])=>(await client.query(sql,values)).rows;
async function shared(){
  return rows(`SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app_users u),
    'schools',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM schools s),
    'students',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM students s),
    'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM subscriptions s)) AS snapshot`);
}
async function catalog(live=false) {
  const columns=await rows(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
      AND (c.relname LIKE 'flutterwave_live_%')=$1 ORDER BY c.relname,a.attnum`,[live]);
  const constraints=await rows(`SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) AS definition,c.convalidated
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace='public'::regnamespace
     AND (t.relname LIKE 'flutterwave_live_%')=$1 ORDER BY t.relname,c.conname`,[live]);
  const indexes=await rows(`SELECT tablename AS relname,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    AND (tablename LIKE 'flutterwave_live_%')=$1 ORDER BY tablename,indexname`,[live]);
  return [...columns,...constraints,...indexes];
}
async function failed(sql:string,pattern:RegExp){
  // A pinned session is essential: expected errors inside BEGIN must be rolled
  // back on the same connection, not handed to another pooled connection.
  await expect(client.query(sql)).rejects.toThrow(pattern);
  await client.query("ROLLBACK");
}
beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"educore-live-target-pg-"));
  const minimal={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"};
  const target=path.join(directory,"representative.sql");
  execFileSync("pnpm",["--filter","@workspace/scripts","exec","tsx","src/live-readiness-target-schema.mjs","--out",target],
    {cwd:root,env:minimal,stdio:"pipe",timeout:90000});
  manifest=JSON.parse(await readFile(target+".json","utf8"));
  execFileSync("initdb",["-D",path.join(directory,"data"),"-U","live_target_test","-A","trust","--no-locale"],
    {env:minimal,stdio:"ignore"});
  postgres=spawn("postgres",["-D",path.join(directory,"data"),"-k",directory,"-h","","-p","5432"],{env:minimal,stdio:"ignore"});
  pool=new DatabasePool({host:directory,port:5432,database:"postgres",user:"live_target_test",max:2,connectionTimeoutMillis:1000});
  for(let attempt=0;attempt<100;attempt++){
    try{client=await pool.connect();break;}catch{await new Promise(r=>setTimeout(r,30));}
  }
  if(!client)throw new Error("Disposable PostgreSQL unavailable; no application target fallback");
  await client.query("BEGIN");
  try{await client.query(await readFile(target+".raw.sql","utf8"));rawResult="PASS";}
  catch(error){rawResult=String((error as Error).message);}
  await client.query("ROLLBACK");
  await client.query(await readFile(target,"utf8"));
  await client.query(`INSERT INTO app_users(id,clerk_user_id,email) VALUES(7,'fictional_target_owner','target@example.invalid');
    INSERT INTO schools(id,code,name,city,state) VALUES(10,'FIXTURE-TARGET','Fictional target school','Fixture City','Fixture State');
    INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section)
     VALUES(1,10,'TARGET-1','Fictional','Student','other','Fixture Class','A');
    INSERT INTO subscriptions(id,school_id,student_id,term,status,verification_status,provider,provider_reference,expires_at)
     VALUES(1,10,1,'Historical term','active','verified','test','SCV2_representative_unchanged',now()+interval '30 days')`);
  sharedBefore=await shared();schemaBefore=await catalog();
  for(const name of names){
    ups.push(await readFile(path.join(root,"lib/db/dev-reconciliation",name+".up.sql"),"utf8"));
    downs.push(await readFile(path.join(root,"lib/db/dev-reconciliation",name+".down.sql"),"utf8"));
  }
},120000);
afterAll(async()=>{
  client?.release();await pool?.end();
  if(postgres?.exitCode===null)await new Promise<void>(resolve=>{postgres.once("exit",()=>resolve());postgres.kill("SIGTERM");});
  if(directory)await rm(directory,{recursive:true,force:true});
},60000);

describe.sequential("source-derived representative target; disposable only, never app-target approval",()=>{
  it("initializes the complete current source schema and exposes exporter ownership drift",async()=>{
    expect(manifest.tables).toBe(184);expect(manifest.foreignKeys).toBe(690);
    expect(manifest.statements).toBe(1241);expect(manifest.applicationTargetVerified).toBe(false);
    expect((await rows("SELECT count(*)::integer n FROM pg_tables WHERE schemaname='public'"))[0].n).toBe(manifest.tables);
    expect((await rows("SELECT count(*)::integer n FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND convalidated"))[0].n).toBe(manifest.foreignKeys);
    expect(manifest.historicalOwnershipGuard).toBe("PASS");
    expect(manifest.keyOwnership.filter((k:any)=>k.expectedKind!==k.actualKind)).toHaveLength(0);
    expect(manifest.keyOwnership.filter((k:any)=>k.historicalKind!==k.actualKind)).toHaveLength(3);
    // Report untouched raw execution separately from the reordered same-multiset
    // target, rather than claiming this audit fixed the original exporter.
    console.info("LIVE_TARGET_SCHEMA_REHEARSAL",JSON.stringify({...manifest,rawExecution:rawResult}));
  });
  it("refuses wrong stage ordering atomically",async()=>{
    await failed(ups[3],/does not exist/);
    expect((await rows("SELECT to_regclass('flutterwave_live_operator_reviews') AS name"))[0].name).toBeNull();
    expect(await shared()).toEqual(sharedBefore);
  });
  it("applies all four stages; validates every FK and expected index",async()=>{
    for(const sql of ups)await client.query(sql);
    expect(await catalog()).toEqual(schemaBefore);expect(await shared()).toEqual(sharedBefore);
    const foreignKeys=await rows(`SELECT conname,convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE c.contype='f' AND t.relname LIKE 'flutterwave_live_%' ORDER BY conname`);
    expect(foreignKeys.length).toBeGreaterThan(15);expect(foreignKeys.every(k=>k.convalidated)).toBe(true);
    expect(foreignKeys.map(k=>k.conname)).toEqual(expect.arrayContaining([
      "live_intent_review_scope_fk","live_collection_verified_identity_fk","live_event_authenticated_source_fk"]));
    const indexes=await rows("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'flutterwave_live_%'");
    expect(indexes.map(i=>i.indexname)).toEqual(expect.arrayContaining(["live_application_scope_idx",
      "live_operator_receipt_idx","live_authority_lookup_idx","live_receipt_result_event_idx","live_event_source_idx","live_family_receipt_reference_idx"]));
    liveSchema=await catalog(true);
    console.info("LIVE_TARGET_ADDITIONS",JSON.stringify({tables:new Set((liveSchema as any[]).map(r=>r.relname)).size,
      foreignKeys:foreignKeys.length,indexes:indexes.length}));
  });
  it("one-shot up drafts refuse duplicate apply without partial DDL or row changes",async()=>{
    for(const sql of ups)await failed(sql,/already exists/);
    expect(await catalog(true)).toEqual(liveSchema);expect(await catalog()).toEqual(schemaBefore);
    expect(await shared()).toEqual(sharedBefore);
  });
  it("empty reverse all stages and reapply preserves canonical schema and shared history",async()=>{
    for(const sql of [...downs].reverse())await client.query(sql);
    expect(await catalog(true)).toEqual([]);expect(await catalog()).toEqual(schemaBefore);
    expect(await shared()).toEqual(sharedBefore);
    for(const sql of ups)await client.query(sql);
    expect(await catalog(true)).toEqual(liveSchema);
  });
  it("upgrades populated earlier drafts without promoting or rewriting retained evidence",async()=>{
    for(const sql of [...downs].reverse())await client.query(sql);
    await client.query(ups[0]);
    await client.query(`INSERT INTO flutterwave_live_webhook_receipts(payload_sha256,payload_bytes,claims,signature_verified)
      VALUES(repeat('a',64),10,'{"shape":"FICTIONAL_RETAINED"}',true)`);
    await client.query(ups[1]);
    await client.query(`INSERT INTO flutterwave_live_subscription_intents(merchant_scope,reference,school_id,student_id,session_id,
      term_id,term_end_date,school_subaccount_id,partner_accrual_minor)
      VALUES('merchant_fixture_live','SCV3_retained_target_design_123',10,1,1,1,CURRENT_DATE+30,'RS_FictionalSchool123',0)`);
    const before=await rows("SELECT to_jsonb(i) AS snapshot FROM flutterwave_live_subscription_intents i");
    await client.query(ups[2]);await client.query(ups[3]);
    expect(await rows(`SELECT to_jsonb(i)-'issued_by'-'issuer_key'-'authority_review_id'-'authority_snapshot' AS snapshot
      FROM flutterwave_live_subscription_intents i`)).toEqual(before);
    expect((await rows("SELECT issued_by,authority_review_id,authority_snapshot,state FROM flutterwave_live_subscription_intents"))[0])
      .toEqual({issued_by:null,authority_review_id:null,authority_snapshot:null,state:"PENDING"});
    expect(await shared()).toEqual(sharedBefore);expect(await catalog()).toEqual(schemaBefore);
  });
  it("rejects cross-school authority and invalid fixed-money/environment values",async()=>{
    await client.query(`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,
      evidence_sha256,reviewed_by,expires_at) VALUES('merchant_fixture_live',10,'RS_FictionalSchool123',repeat('b',64),7,now()+interval '1 day')`);
    await failed(`INSERT INTO flutterwave_live_subscription_intents(merchant_scope,reference,school_id,student_id,session_id,term_id,
      term_end_date,school_subaccount_id,partner_accrual_minor,issued_by,issuer_key,authority_review_id,authority_snapshot)
      VALUES('merchant_fixture_live','SCV3_wrong_tenant_target_123',20,1,1,1,CURRENT_DATE+30,'RS_FictionalSchool123',0,
       7,'target-scope-key-0001',1,'{}')`,/live_intent_review_scope_fk/);
    for(const [column,value] of [["environment","'SANDBOX'"],["gross_minor","400000"],["school_minor","200000"],
      ["merchant_gross_minor","300000"],["partner_accrual_minor","20000"]]){
      await failed(`UPDATE flutterwave_live_subscription_intents SET ${column}=${value}`,/immutable|check constraint/);
    }
  });
  it("retained evidence blocks every down draft and audit history cannot be rewritten",async()=>{
    await client.query(`INSERT INTO flutterwave_live_operator_reviews(merchant_scope,receipt_id,actor_id,idempotency_key,request_hash,
      action,reason,outcome) VALUES('merchant_fixture_live',1,7,'target-review-key-0001',repeat('c',64),'REVIEW','PENDING','REVIEW_RECORDED')`);
    await failed("UPDATE flutterwave_live_operator_reviews SET outcome='EVIDENCE_REQUIRED'",/Retain immutable/);
    await failed("DELETE FROM flutterwave_live_operator_reviews",/Retain immutable/);
    for(const sql of [...downs].reverse())await failed(sql,/retained/);
    expect(await catalog()).toEqual(schemaBefore);expect(await shared()).toEqual(sharedBefore);
    expect((await rows("SELECT count(*)::integer n FROM flutterwave_live_operator_reviews"))[0].n).toBe(1);
  });
});
