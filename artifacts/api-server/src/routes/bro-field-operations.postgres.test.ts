import {beforeAll,afterAll,beforeEach,it,expect,vi} from "vitest";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {DatabasePool} from "@workspace/db/driver";
const state=vi.hoisted(()=>({db:null as any}));
vi.mock("@workspace/db",()=>({pool:{query:(...args:any[])=>state.db.query(...args),connect:()=>state.db.connect()}}));
vi.mock("../services/test-account-archive-access",()=>({assertTestArchiveAccess:async()=>undefined}));
vi.mock("../middlewares/auth",()=>{
  class AuthError extends Error{constructor(readonly statusCode:number,message:string){super(message);}}
  const ctx=(req:any)=>{const id=Number(req.headers["x-fixture-user"]??1);return {user:{id,email:`fixture-${id}@example.invalid`},
    roles:[{role:id===3?"PLATFORM_OWNER":id===4?"SCHOOL_ADMIN":id===5?"PARENT":"PARTNER",status:"ACTIVE"}]};};
  return {AuthError,getUserContext:ctx,requireAuthentication:()=> (req:any,res:any,next:any)=>
    Number(req.headers["x-fixture-user"]??1)===0?res.status(401).end():next(),
    assertRoles:(req:any,allowed:string[])=>{const c=ctx(req);if(!allowed.includes(c.roles[0].role))throw new AuthError(403,"Denied");return c;}};
});
import router from "./bro-field-operations";
let dir:string,postgres:ChildProcess,server:any,base:string,db:any;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"bro-field-test-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","bro_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  db=state.db=new DatabasePool({host:dir,port:5432,user:"bro_fixture",database:"postgres",connectionTimeoutMillis:500,max:5});
  for(let i=0;i<100;i++){try{await db.query("SELECT 1");break;}catch{if(i===99)throw new Error("Isolated fixture unavailable");await new Promise(r=>setTimeout(r,30));}}
  await db.query(`CREATE TABLE app_users(id int PRIMARY KEY,status text);
    CREATE TABLE schools(id int PRIMARY KEY,name text,address text,phone text);
    CREATE TABLE partner_profiles(id int PRIMARY KEY,user_id int,status text);
    CREATE TABLE partner_profile_users(partner_profile_id int,user_id int,status text);
    CREATE TABLE school_memberships(user_id int,role text,status text);
    CREATE TABLE school_partner_attributions(school_id int,partner_profile_id int,status text);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,actor_user_id int,"user" text NOT NULL,role text,action text,
      module text,event_type text,result text,metadata jsonb,"timestamp" timestamptz NOT NULL DEFAULT now());`);
  await db.query(await readFile(new URL("../../../../lib/db/dev-reconciliation/bro-field-operations.sql",import.meta.url),"utf8"));
  const app=express().use(express.json()).use(router);
  server=await new Promise<any>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  base=`http://127.0.0.1:${server.address().port}/bro-field`;
},30000);
afterAll(async()=>{
  if(server)await new Promise<void>(r=>server.close(()=>r()));
  await db?.end();if(postgres?.exitCode===null){postgres.kill("SIGTERM");await new Promise<void>(r=>postgres.once("exit",()=>r()));}
  if(dir)await rm(dir,{recursive:true,force:true});vi.unstubAllEnvs();
});
beforeEach(async()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  await db.query(`TRUNCATE bro_field_transfers,bro_field_claims,bro_field_leads,audit_logs,school_partner_attributions,
    partner_profile_users,partner_profiles,school_memberships,schools,app_users RESTART IDENTITY CASCADE;
    INSERT INTO app_users VALUES(1,'ACTIVE'),(2,'ACTIVE'),(3,'ACTIVE'),(4,'ACTIVE'),(5,'ACTIVE'),(6,'ACTIVE');
    INSERT INTO partner_profiles VALUES(1,1,'ACTIVE'),(2,2,'ACTIVE'),(6,6,'INACTIVE');
    INSERT INTO school_memberships VALUES(1,'PARTNER','ACTIVE'),(2,'PARTNER','ACTIVE'),(3,'PLATFORM_OWNER','ACTIVE'),
      (4,'SCHOOL_ADMIN','ACTIVE'),(5,'PARENT','ACTIVE'),(6,'PARTNER','ACTIVE');
    INSERT INTO schools VALUES(10,'Registered Academy','10 Registry Road','08020000001'),
      (20,'Another Academy','20 Registry Road','08020000002');
    INSERT INTO school_partner_attributions VALUES(20,2,'ACTIVE');`);
});
const input=(extra:any={})=>({schoolName:"Alpha Academy",address:"1 Example Road",contactPerson:null,contactPhone:"08010000001",
  visitDate:"2026-11-09",personMet:"Head teacher",notes:"Development fixture only",interestLevel:"Medium",status:"Visited",
  nextFollowUpDate:"2026-11-20",schoolId:null,expectedVersion:0,...extra});
const call=(method:string,url:string,body?:any,user=1)=>fetch(base+url,{method,
  headers:{"content-type":"application/json","x-fixture-user":String(user)},...(body?{body:JSON.stringify(body)}:{})});
const create=async(extra:any={},user=1)=>{const r=await call("POST","/leads",input(extra),user);expect(r.status).toBe(200);return r.json() as Promise<any>;};
it("loads Owner and BRO options, lists and dated visit history with the real audit timestamp column",async()=>{
  const lead=await create();
  expect((await call("PUT",`/leads/${lead.id}`,input({notes:"Second visit"}))).status).toBe(200);
  expect((await call("POST","/leads",input(),2)).status).toBe(409);
  const saved=(await db.query(`SELECT action,"timestamp" FROM audit_logs ORDER BY id`)).rows;
  for(const user of [1,3]){
    const optionsResponse=await call("GET","/options",undefined,user);
    expect(optionsResponse.status).toBe(200);
    const options:any=await optionsResponse.json();
    expect(options.isOwner).toBe(user===3);
    expect(Array.isArray(options.schools)).toBe(true);
    if(user===3){
      expect(options.conflicts).toHaveLength(1);
      expect(options.conflicts[0].createdAt).toBe(saved.find((r:any)=>r.action==="DUPLICATE_CONFLICT").timestamp.toISOString());
    }else expect(options.conflicts).toEqual([]);
    const listResponse=await call("GET","/leads",undefined,user);
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as any[]).map(r=>r.id)).toEqual([lead.id]);
    const detailResponse=await call("GET",`/leads/${lead.id}`,undefined,user);
    expect(detailResponse.status).toBe(200);
    const detail:any=await detailResponse.json();
    expect(detail.history.map((h:any)=>h.action)).toEqual(["VISIT_UPDATED","LEAD_CREATED"]);
    for(const h of detail.history){
      expect(h.createdAt).toBe(saved.find((r:any)=>r.action===h.action).timestamp.toISOString());
      expect(h).not.toHaveProperty("timestamp");
    }
    expect(detail.history.map((h:any)=>h.snapshot.notes)).toEqual(["Second visit","Development fixture only"]);
  }
});
it("isolates BRO lists, details and edits; rejects arbitrary ownership fields",async()=>{
  const lead=await create();
  expect(await (await call("GET","/leads",undefined,2)).json()).toEqual([]);
  expect((await call("GET",`/leads/${lead.id}`,undefined,2)).status).toBe(404);
  expect((await call("PUT",`/leads/${lead.id}`,input({notes:"Overwrite"}),2)).status).toBe(404);
  expect((await call("POST","/leads",input({currentOwnerId:2}))).status).toBe(400);
  expect((await call("PUT",`/leads/${lead.id}`,input({notes:"Own update"}))).status).toBe(200);
  expect((await call("PUT",`/leads/${lead.id}`,input({notes:"Stale"}))).status).toBe(409);
  const historical:any=await (await call("GET","/leads?q=Development%20fixture%20only",undefined,3)).json();
  expect(historical.map((r:any)=>r.id)).toEqual([lead.id]);
});
it("is unique-safe under simultaneous BRO claims and retains old aliases after edits",async()=>{
  const responses=await Promise.all([call("POST","/leads",input()),call("POST","/leads",
    input({schoolName:" ALPHA ACADEMY!! ",contactPhone:"+2348010000001"}),2)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const lead=(await db.query("SELECT * FROM bro_field_leads")).rows[0];
  expect((await db.query("SELECT count(*)::int AS n FROM bro_field_leads")).rows[0].n).toBe(1);
  expect((await call("PUT",`/leads/${lead.id}`,input({schoolName:"Renamed Academy",address:"Changed Road",contactPhone:null}),
    lead.current_owner_id)).status).toBe(200);
  expect((await call("POST","/leads",input(),lead.current_owner_id===1?2:1)).status).toBe(409);
  expect((await call("GET","/options",undefined,3)).status).toBe(200);
  const options:any=await (await call("GET","/options",undefined,3)).json();
  expect(options.conflicts.length).toBeGreaterThan(0);
  expect((await (await call("GET","/options")).json() as any).conflicts).toEqual([]);
});
it("links Adopted to existing registry without creating schools or changing attribution",async()=>{
  expect((await call("POST","/leads",input({status:"Adopted"}))).status).toBe(400);
  const lead=await create({schoolName:"Registered Academy",address:"10 Registry Road",contactPhone:null,status:"Adopted",schoolId:10});
  expect(lead.schoolId).toBe(10);
  expect((await db.query("SELECT count(*)::int AS n FROM schools")).rows[0].n).toBe(2);
  expect((await db.query("SELECT count(*)::int AS n FROM school_partner_attributions")).rows[0].n).toBe(1);
  expect((await call("POST","/leads",input({schoolName:"Another Academy",address:"20 Registry Road",
    contactPhone:null,status:"Adopted",schoolId:20}))).status).toBe(403);
});
it("Owner approves transfers with reason, preserves original ownership and immutable audit",async()=>{
  const lead=await create();
  const t:any=await (await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:2,reason:"Reassign this territory"})).json();
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:"Owner reviewed transfer"})).status).toBe(403);
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:""},3)).status).toBe(400);
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:"Owner reviewed transfer"},3)).status).toBe(200);
  expect((await call("GET",`/leads/${lead.id}`)).status).toBe(404);
  const detail:any=await (await call("GET",`/leads/${lead.id}`,undefined,2)).json();
  expect(detail.lead).toMatchObject({originalOwnerId:1,currentOwnerId:2});
  expect(detail.history.map((h:any)=>h.action)).toContain("TRANSFER_APPROVED");
  await expect(db.query("UPDATE bro_field_leads SET original_owner_id=2,version=version+1 WHERE id=$1",[lead.id])).rejects.toThrow();
  await expect(db.query("DELETE FROM audit_logs WHERE module='BROFieldOperations'")).rejects.toThrow();
  await expect(db.query("UPDATE bro_field_transfers SET decision_reason='Changed' WHERE id=$1",[t.id])).rejects.toThrow();
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:"Replay attempt"},3)).status).toBe(409);
});
it("Owner can reject, approve release, and reassign a released lead without automatic release",async()=>{
  const lead=await create();
  let t:any=await (await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:null,reason:"Request release review"})).json();
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"REJECTED",reason:"Keep current territory"},3)).status).toBe(200);
  expect((await db.query("SELECT current_owner_id FROM bro_field_leads")).rows[0].current_owner_id).toBe(1);
  t=await (await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:null,reason:"Request release again"})).json();
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:"Release explicitly approved"},3)).status).toBe(200);
  expect((await call("POST","/leads",input(),2)).status).toBe(409);
  t=await (await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:2,reason:"Assign released territory"},3)).json();
  expect((await call("POST",`/transfers/${t.id}/decision`,{decision:"APPROVED",reason:"Assignment explicitly approved"},3)).status).toBe(200);
  expect((await db.query("SELECT original_owner_id,current_owner_id FROM bro_field_leads")).rows[0])
    .toEqual({original_owner_id:1,current_owner_id:2});
});
it("supports Owner search/status/follow-up oversight and denies other roles/inactive BROs",async()=>{
  const lead=await create();
  const rows:any=await (await call("GET","/leads?q=Alpha&status=Visited&ownerId=1&followUp=2026-11-21",undefined,3)).json();
  expect(rows.map((r:any)=>r.id)).toEqual([lead.id]);
  expect(await (await call("GET","/leads?followUp=2026-11-19",undefined,3)).json()).toEqual([]);
  for(const user of [4,5,6])expect((await call("GET","/leads",undefined,user)).status).toBe(403);
  expect((await call("GET","/leads",undefined,0)).status).toBe(401);
  expect((await call("POST","/leads",input(),3)).status).toBe(403);
});
it("allows existing BRO and Owner roles in Production while retaining cross-BRO ownership and transfer authority",async()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("REPLIT_DEPLOYMENT","1");
  const lead=await create();
  for(const user of [1,3]){
    expect((await call("GET","/options",undefined,user)).status).toBe(200);
    expect((await call("GET",`/leads/${lead.id}`,undefined,user)).status).toBe(200);
  }
  expect((await call("GET",`/leads/${lead.id}`,undefined,2)).status).toBe(404);
  expect((await call("PUT",`/leads/${lead.id}`,input({notes:"Other BRO"}),2)).status).toBe(404);
  for(const user of [4,5,6])expect((await call("GET","/leads",undefined,user)).status).toBe(403);
  expect((await call("GET","/leads",undefined,0)).status).toBe(401);
  expect((await call("POST","/leads",input(),3)).status).toBe(403);
  const transfer:any=await (await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:2,reason:"Controlled fixture reassignment"})).json();
  expect((await call("POST",`/transfers/${transfer.id}/decision`,{decision:"APPROVED",reason:"Unauthorized BRO approval"},1)).status).toBe(403);
  expect((await call("POST",`/transfers/${transfer.id}/decision`,{decision:"APPROVED",reason:"Reviewed by fixture Owner"},3)).status).toBe(200);
  expect((await call("GET",`/leads/${lead.id}`,undefined,1)).status).toBe(404);
  expect((await call("GET",`/leads/${lead.id}`,undefined,2)).status).toBe(200);
});
it("installs only missing procedures/triggers, preserves populated records, repeats safely and refuses drift",async()=>{
  const lead=await create();
  await call("POST",`/leads/${lead.id}/transfers`,{targetOwnerId:2,reason:"Fixture pending transfer"});
  const snapshot=async()=>JSON.stringify((await db.query(`SELECT * FROM (SELECT 'leads' AS kind,to_jsonb(l) AS row FROM bro_field_leads l
    UNION ALL SELECT 'claims',to_jsonb(c) FROM bro_field_claims c
    UNION ALL SELECT 'transfers',to_jsonb(t) FROM bro_field_transfers t
    UNION ALL SELECT 'audit',to_jsonb(a) FROM audit_logs a) records ORDER BY kind,row::text`)).rows);
  const saved=await snapshot();
  const functions=["bro_field_immutable","bro_field_owner_guard","bro_field_transfer_guard","bro_field_audit_guard"];
  const definitions=await db.query(`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname`,[functions]);
  // Disposable local fixture ONLY: reproduce the observed Production catalog gap.
  await db.query(`DROP TRIGGER bro_field_claim_history ON bro_field_claims;
    DROP TRIGGER bro_field_ownership ON bro_field_leads;
    DROP TRIGGER bro_field_transfer_history ON bro_field_transfers;
    DROP TRIGGER bro_field_audit_history ON audit_logs;
    DROP FUNCTION bro_field_immutable(),bro_field_owner_guard(),bro_field_transfer_guard(),bro_field_audit_guard();`);
  const migration=await readFile(new URL("../../../../lib/db/reviewed-releases/bro-field-protections.sql",import.meta.url),"utf8");
  await db.query(migration);await db.query(migration);
  expect(await snapshot()).toBe(saved);
  expect((await db.query(`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY proname`,[functions])).rows).toEqual(definitions.rows);
  await expect(db.query("UPDATE bro_field_claims SET claim_key='tampered'")).rejects.toThrow();
  await expect(db.query("UPDATE bro_field_leads SET current_owner_id=2,version=version+1")).rejects.toThrow();
  await expect(db.query("DELETE FROM bro_field_leads")).rejects.toThrow();
  await expect(db.query("DELETE FROM bro_field_transfers")).rejects.toThrow();
  await expect(db.query("DELETE FROM audit_logs WHERE module='BROFieldOperations'")).rejects.toThrow();
  // A disabled or altered protection must be reviewed, never silently replaced.
  await db.query("ALTER TABLE bro_field_claims DISABLE TRIGGER bro_field_claim_history");
  const c=await db.connect();
  try{
    await expect(c.query(migration)).rejects.toThrow("differs from approved definition");
    await c.query("ROLLBACK");
  }finally{c.release();}
  await db.query("ALTER TABLE bro_field_claims ENABLE TRIGGER bro_field_claim_history");
  expect(await snapshot()).toBe(saved);
});
