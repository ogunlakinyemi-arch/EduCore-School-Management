import express from "express";
import type {Server} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import pg from "pg";
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{connect:()=>{throw Error("Application databases forbidden in this suite");}}}));
vi.mock("../middlewares/auth",()=>{
  class AuthError extends Error{constructor(public statusCode:number,message:string){super(message);}}
  return {AuthError,getUserContext:(req:any)=>({user:{id:Number(req.header("x-actor")??2)}}),
    requireAuthentication:()=>(req:any,res:any,next:any)=>req.header("x-anonymous")?res.sendStatus(401):next()};
});
import {createLiveSchoolOnboardingRouter} from "./flutterwave-live-school-onboarding";
import {reviewLiveSchoolOnboarding,liveOnboardingReview} from "../services/flutterwave-live-school-onboarding";
import {encryptPayrollBankValue} from "../lib/payroll-bank-encryption";
import {LIVE_ONBOARDING_RELEASE,onboardingConfiguration} from "../lib/flutterwave-live-onboarding-gate";

// Every identity, document digest, account and credential below is fictional.
// Never read DATABASE_URL/PG* or import the application's database connection.
const root=mkdtempSync(join(tmpdir(),"educore-live-onboarding-")),data=join(root,"data");
const cleanEnv={PATH:process.env.PATH,LANG:"C.UTF-8",LC_ALL:"C.UTF-8",HOME:root};
let db:pg.Pool,server:Server,url:string,env:NodeJS.ProcessEnv;
const bank={bankCode:"044",accountNumber:"0000000002",accountName:"Fixture School Holder",businessName:"Fixture School",
  bankName:"Fixture Bank",businessEmail:"school@example.invalid",businessPhone:"08000000002"};
const providerRecord={id:701,subaccount_id:"RS_FICTIONALLIVEFIXTURE0001",account_bank:bank.bankCode,account_number:bank.accountNumber,
  full_name:bank.businessName,business_email:bank.businessEmail,split_type:"flat",split_value:3100};
let created=false,mode="ok",calls:{path:string;method:string;body:any;authorization:string}[];
const ok=(data:any)=>new Response(JSON.stringify({status:"success",data}),{status:200});
const provider=vi.fn(async(input:any,init:any)=>{
  const path=new URL(String(input)).pathname.replace("/v3/",""),method=init.method;
  calls.push({path,method,body:init.body?JSON.parse(init.body):null,authorization:init.headers.authorization});
  if(mode==="permission")return new Response("provider details must never leak",{status:403});
  if(path==="accounts/resolve")return ok({account_number:bank.accountNumber,account_name:mode==="name-mismatch"?"Different Holder":bank.accountName});
  if(path==="subaccounts"&&method==="GET"){
    if(mode==="no-subaccounts"&&!created)return new Response(JSON.stringify({status:"error",message:"Subaccounts not found",data:null}),{status:400});
    if(mode==="incomplete")return new Response(JSON.stringify({status:"success",data:[],meta:{page_info:{total_pages:2}}}));
    if(mode==="ambiguous")return ok([providerRecord,{...providerRecord,id:702}]);
    return ok(created?[providerRecord]:[]);
  }
  if(path==="subaccounts"&&method==="POST"){
    created=true;
    if(mode==="change-during-create")await db.query("UPDATE settlement_payroll_profiles SET business_registration_number='CHANGED_DURING_CREATE' WHERE id=10");
    if(mode==="accepted-lost")throw Error("SECRET-RAW-PROVIDER-DETAILS");
    if(mode==="concurrent")await new Promise(r=>setTimeout(r,50));
    return ok(providerRecord);
  }
  if(path==="subaccounts/701")return ok(mode==="readback-mismatch"?{...providerRecord,account_number:"0000000999"}:providerRecord);
  throw Error(`Unexpected provider operation: ${method} ${path}`);
}) as unknown as typeof fetch;
const approval=()=>({action:"APPROVE_AND_CREATE",note:"Fixture Owner reviewed independent documents.",
  ownershipConfirmed:true,distinctFromPlatformAccountConfirmed:true,merchantOwnershipConfirmed:true,kycConfirmed:true,
  feeBearer:"MERCHANT",ownershipEvidenceSha256:"a".repeat(64),merchantEvidenceSha256:"b".repeat(64),
  feeBearerEvidenceSha256:"c".repeat(64),splitPolicyEvidenceSha256:"d".repeat(64)});
async function http(path:string,actor=2,body?:object){
  const response=await fetch(`${url}${path}`,{method:body?"POST":"GET",
    headers:{"x-actor":String(actor),"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json() as any};
}
async function submit(){const r=await http("/schools/10/finance/live-subaccount-onboarding",2,{});expect(r.status).toBe(200);return r.body;}
const review=(id:number,body=approval())=>http(`/platform/flutterwave/live/school-subaccounts/${id}/review`,1,body);
const posts=()=>calls.filter(c=>c.path==="subaccounts"&&c.method==="POST");
const onboardingDraft=(direction:"up"|"down")=>readFileSync(
  resolve(`../../lib/db/dev-reconciliation/flutterwave-live-school-onboarding.${direction}.sql`),"utf8");
async function rollbackOnboardingFixture(){
  // Pin the connection: a failed multi-statement transaction must be rolled back
  // on the same client, never on an arbitrary pooled connection.
  const client=await db.connect();
  try{await client.query(onboardingDraft("down"));}
  catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
async function seedProfile(scope:string,schoolId:number|null,accountNumber:string,id:number){
  const aad=(f:string)=>scope==="SCHOOL"?`settlement:school:${schoolId}:${f}`:`settlement:yemait-company:${f}`;
  const encrypt=(v:string,f:string)=>encryptPayrollBankValue(v,aad(f)).ciphertext;
  await db.query(`INSERT INTO settlement_payroll_profiles(id,scope,school_id,business_name,settlement_contact_email,settlement_contact_phone,
    bank_name_encrypted,bank_code_encrypted,account_name_encrypted,account_number_encrypted,encryption_key_version,account_last4)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'fixture-v1',$11)`,
  [id,scope,schoolId,bank.businessName,bank.businessEmail,bank.businessPhone,encrypt(bank.bankName,"bankName"),
    encrypt(bank.bankCode,"bankCode"),encrypt(bank.accountName,"accountName"),encrypt(accountNumber,"accountNumber"),accountNumber.slice(-4)]);
}
it("rolls back and reapplies an unused onboarding schema without changing school profiles",async()=>{
  const before=(await db.query("SELECT id,scope,school_id FROM settlement_payroll_profiles ORDER BY id")).rows;
  // Only this disposable cluster's synthetic release fixture is removed.
  await db.query("DELETE FROM flutterwave_live_school_onboarding_releases");
  await rollbackOnboardingFixture();
  expect((await db.query("SELECT to_regclass('flutterwave_live_school_onboarding') AS relation")).rows[0].relation).toBeNull();
  await db.query(onboardingDraft("up"));
  expect((await db.query("SELECT id,scope,school_id FROM settlement_payroll_profiles ORDER BY id")).rows).toEqual(before);
  expect(posts()).toHaveLength(0);
});
it("refuses rollback when a release review exists and leaves the database usable",async()=>{
  await expect(rollbackOnboardingFixture()).rejects.toThrow("LIVE onboarding evidence retained");
  expect((await db.query("SELECT count(*)::int AS count FROM flutterwave_live_school_onboarding_releases")).rows[0].count).toBe(1);
  expect((await db.query("SELECT to_regclass('flutterwave_live_school_onboarding') AS relation")).rows[0].relation).not.toBeNull();
});
it("refuses rollback for bank verification history even without a release review",async()=>{
  const saved=await submit();
  await db.query("DELETE FROM flutterwave_live_school_onboarding_releases");
  await expect(rollbackOnboardingFixture()).rejects.toThrow("LIVE onboarding evidence retained");
  expect((await db.query("SELECT status FROM flutterwave_live_school_onboarding WHERE id=$1",[saved.id])).rows[0].status).toBe("BANK_VERIFIED");
  expect((await db.query("SELECT count(*)::int AS count FROM flutterwave_live_school_onboarding_audits")).rows[0].count).toBeGreaterThan(0);
  expect(posts()).toHaveLength(0);
});
beforeAll(async()=>{
  execFileSync("initdb",["-D",data,"-U","fixture_owner","-A","trust","--no-locale","--encoding=UTF8"],{env:cleanEnv,stdio:"ignore"});
  execFileSync("pg_ctl",["-D",data,"-l",join(root,"server.log"),"-o",`-c listen_addresses='' -c unix_socket_directories='${root}' -p 55433`,"-w","start"],{env:cleanEnv,stdio:"ignore"});
  db=new pg.Pool({host:root,port:55433,user:"fixture_owner",password:"",database:"postgres",max:10,connectionTimeoutMillis:3000});
  const identity=(await db.query("SELECT current_setting('data_directory') AS dir,inet_server_addr() AS addr,current_user AS who")).rows[0];
  expect(identity).toEqual({dir:data,addr:null,who:"fixture_owner"});
  await db.query(`CREATE TABLE app_users(id integer PRIMARY KEY,status text);
    CREATE TABLE schools(id integer PRIMARY KEY,name text,status text);
    CREATE TABLE school_memberships(id serial PRIMARY KEY,user_id integer REFERENCES app_users(id),school_id integer REFERENCES schools(id),role text,status text);
    CREATE TABLE settlement_payroll_profiles(id integer PRIMARY KEY,scope text,school_id integer REFERENCES schools(id),business_name text,
      business_registration_number text,settlement_contact_email text,settlement_contact_phone text,
      bank_name_encrypted text,bank_code_encrypted text,account_name_encrypted text,account_number_encrypted text,encryption_key_version text,account_last4 text);
    INSERT INTO app_users VALUES(1,'ACTIVE'),(2,'ACTIVE'),(3,'ACTIVE'),(4,'ACTIVE'),(5,'INACTIVE'),(6,'ACTIVE');
    INSERT INTO schools VALUES(10,'Fixture School','active'),(20,'Other Fixture','active');
    INSERT INTO school_memberships(user_id,school_id,role,status) VALUES
      (1,NULL,'PLATFORM_OWNER','ACTIVE'),(2,10,'SCHOOL_ADMIN','ACTIVE'),(3,20,'SCHOOL_ADMIN','ACTIVE'),
      (4,10,'TEACHER','ACTIVE'),(5,NULL,'PLATFORM_OWNER','ACTIVE'),(6,NULL,'PLATFORM_OWNER','ACTIVE'),(6,10,'SCHOOL_ADMIN','ACTIVE');`);
  // This is the only database target receiving the draft.
  await db.query(readFileSync(resolve("../../lib/db/dev-reconciliation/flutterwave-live-school-onboarding.up.sql"),"utf8"));
},30000);
afterAll(async()=>{
  await db?.end();
  try{execFileSync("pg_ctl",["-D",data,"-m","immediate","-w","stop"],{env:cleanEnv,stdio:"ignore"});}finally{rmSync(root,{recursive:true,force:true});}
});
beforeEach(async()=>{
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION","fixture-v1");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY_VERSION","fixture-v1");
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEY","11".repeat(32));
  vi.stubEnv("PAYROLL_BANK_ENCRYPTION_KEYS","");
  env={NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED:"true",
    EDUCORE_FLUTTERWAVE_ONBOARDING_RELEASE:LIVE_ONBOARDING_RELEASE,EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE:"fixture_merchant",
    FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fictional-live-fixture-not-real",
    FLUTTERWAVE_KYC_APPROVED:"true",FLUTTERWAVE_SUBACCOUNT_CREATION_CONFIRMED:"true",FLUTTERWAVE_SUBACCOUNT_DEFAULTS_CONFIRMED:"true",
    FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"fictional-live-webhook-fixture",FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fictional-test-webhook-fixture",
    EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"LIVE",PUBLIC_APP_URL:"https://fixture.example.invalid",
    PAYROLL_BANK_ENCRYPTION_ACTIVE_VERSION:"fixture-v1",PAYROLL_BANK_ENCRYPTION_KEY_VERSION:"fixture-v1",PAYROLL_BANK_ENCRYPTION_KEY:"11".repeat(32),
    EDUCORE_FLUTTERWAVE_LIVE_ENABLED:"false"};
  await db.query("TRUNCATE flutterwave_live_school_onboarding_audits,flutterwave_live_school_onboarding,flutterwave_live_school_onboarding_releases RESTART IDENTITY");
  await db.query("DELETE FROM settlement_payroll_profiles");
  await db.query("UPDATE schools SET status='active'");
  await seedProfile("SCHOOL",10,bank.accountNumber,10);await seedProfile("SCHOOL",20,"0000000003",20);
  await seedProfile("YEMAIT_COMPANY",null,"0000000001",100);
  await db.query(`INSERT INTO flutterwave_live_school_onboarding_releases VALUES($1,'fixture_merchant',true,1,$2,1,now())`,[LIVE_ONBOARDING_RELEASE,"e".repeat(64)]);
  created=false;mode="ok";calls=[];
  const app=express();app.use(express.json());app.use(createLiveSchoolOnboardingRouter({pool:db as any,env,fetcher:provider}));
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});
  url=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs();vi.useRealTimers();});

it("denies anonymous, inactive, cross-school, teacher and dual-role Owner school operations",async()=>{
  expect((await fetch(`${url}/flutterwave/live/school-subaccounts`,{headers:{"x-anonymous":"yes"}})).status).toBe(401);
  for(const actor of [1,3,4,5,6])expect((await http("/schools/10/finance/live-subaccount-onboarding",actor,{})).status).toBe(403);
  expect((await http("/flutterwave/live/school-subaccounts?schoolId=10",3)).status).toBe(403);
  expect((await http("/flutterwave/live/school-subaccounts",2)).status).toBe(403);
  expect((await http("/flutterwave/live/school-subaccounts?schoolId=10&mode=TEST",2)).status).toBe(400);
  expect((await http("/schools/10/finance/live-subaccount-onboarding",2,{providerId:123})).status).toBe(400);
  expect(calls).toHaveLength(0);
});
it("independently resolves LIVE bank ownership, freezes encrypted input and deduplicates submissions",async()=>{
  const first=await submit(),second=await submit();expect(second.id).toBe(first.id);
  expect(first).toMatchObject({status:"BANK_VERIFIED",maskedAccount:"••••0002",checkoutEnabled:false,canApprove:true});
  expect(JSON.stringify(first)).not.toContain(bank.accountNumber);expect(calls).toHaveLength(1);expect(posts()).toHaveLength(0);
  const row=(await db.query("SELECT * FROM flutterwave_live_school_onboarding")).rows[0];
  expect(row.environment).toBe("LIVE");expect(row.snapshot_ciphertext).not.toContain(bank.accountNumber);
  expect(row.provider_subaccount_id).toBeNull();expect(row.approved_by).toBeNull();
  expect(calls[0].authorization).toBe(`Bearer ${env.FLUTTERWAVE_LIVE_SECRET_KEY}`);
});
it("requires every Owner evidence commitment and confirmation before provider creation",async()=>{
  const item=await submit();calls=[];
  for(const key of ["ownershipConfirmed","distinctFromPlatformAccountConfirmed","merchantOwnershipConfirmed","kycConfirmed","feeBearer",
    "ownershipEvidenceSha256","merchantEvidenceSha256","feeBearerEvidenceSha256","splitPolicyEvidenceSha256"]){
    const body:any=approval();delete body[key];expect((await review(item.id,body)).status).toBe(503);
  }
  for(const actor of [2,3,4,5])expect((await http(`/platform/flutterwave/live/school-subaccounts/${item.id}/review`,actor,approval())).status).toBe(403);
  expect(posts()).toHaveLength(0);
});
it("creates one real-response LIVE ID, verifies readback and retains auditable status without enabling checkout",async()=>{
  const item=await submit(),r=await review(item.id);
  expect(r.status).toBe(200);expect(r.body).toMatchObject({status:"LIVE_VERIFIED",providerSubaccountId:providerRecord.subaccount_id,checkoutEnabled:false});
  expect(posts()).toHaveLength(1);expect(posts()[0].body).toMatchObject({account_bank:bank.bankCode,account_number:bank.accountNumber,split_type:"flat",split_value:3100});
  const row=(await db.query("SELECT * FROM flutterwave_live_school_onboarding")).rows[0];
  expect(Number(row.provider_id)).toBe(701);expect(row.provider_subaccount_id).toBe(providerRecord.subaccount_id);expect(row.approved_by).toBe(1);
  expect((await db.query("SELECT status,actor_id FROM flutterwave_live_school_onboarding_audits ORDER BY id")).rows)
    .toEqual(expect.arrayContaining([{status:"BANK_VERIFIED",actor_id:2},{status:"CREATING",actor_id:1},{status:"LIVE_VERIFIED",actor_id:1}]));
  expect(env.EDUCORE_FLUTTERWAVE_LIVE_ENABLED).toBe("false");
  expect((await db.query("SELECT to_regclass('flutterwave_split_recipients') AS test,to_regclass('flutterwave_live_school_configuration') AS billing")).rows[0])
    .toEqual({test:null,billing:null});
  expect((await review(item.id)).body.status).toBe("LIVE_VERIFIED");expect(posts()).toHaveLength(1);
});
it("serializes concurrent Owner approvals so only the durable claim winner can POST",async()=>{
  const item=await submit();mode="concurrent";
  const results=await Promise.all([review(item.id),review(item.id),review(item.id)]);
  expect(results.every(r=>r.status===200)).toBe(true);expect(posts()).toHaveLength(1);
  expect((await db.query("SELECT status FROM flutterwave_live_school_onboarding")).rows[0].status).toBe("LIVE_VERIFIED");
});
it("recovers accepted-but-lost creation by GET only, and never leaks raw provider errors",async()=>{
  const item=await submit();mode="accepted-lost";
  const unknown=await review(item.id);expect(unknown.body.status).toBe("CREATION_UNKNOWN");
  expect(JSON.stringify(unknown.body)).not.toContain("SECRET-RAW");
  expect((await review(item.id)).body.status).toBe("CREATION_UNKNOWN");expect(posts()).toHaveLength(1);
  mode="ok";const recovery=await review(item.id,{action:"RECOVER",note:"Read-only fixture recovery."} as any);
  expect(recovery.body.status).toBe("LIVE_VERIFIED");expect(posts()).toHaveLength(1);
});
it("retains a candidate ID after mismatching readback and recovers without another create",async()=>{
  const item=await submit();mode="readback-mismatch";const unknown=await review(item.id);
  expect(unknown.body).toMatchObject({status:"CREATION_UNKNOWN",errorCode:"LIVE_SUBACCOUNT_READBACK_MISMATCH"});
  expect(Number((await db.query("SELECT provider_id FROM flutterwave_live_school_onboarding")).rows[0].provider_id)).toBe(701);
  mode="ok";expect((await review(item.id,{action:"RECOVER",note:"Read-only corrected evidence."} as any)).body.status).toBe("LIVE_VERIFIED");
  expect(posts()).toHaveLength(1);
});
it("adopts a uniquely owned existing provider record by readback without POST",async()=>{
  const item=await submit();created=true;
  const r=await review(item.id);expect(r.body.status).toBe("LIVE_VERIFIED");expect(posts()).toHaveLength(0);
});
it("automates the merchant's first school using the exact provider no-subaccounts contract",async()=>{
  const item=await submit();mode="no-subaccounts";
  expect((await review(item.id)).body.status).toBe("LIVE_VERIFIED");expect(posts()).toHaveLength(1);
});
it.each(["permission","incomplete","ambiguous"])("fails closed before claiming creation for %s",async(value)=>{
  const item=await submit();mode=value;
  expect((await review(item.id)).status).toBe(503);expect(posts()).toHaveLength(0);
  expect((await db.query("SELECT creation_claimed_at FROM flutterwave_live_school_onboarding")).rows[0].creation_claimed_at).toBeNull();
});
it("does not use a generic or TEST VERIFIED flag as LIVE ownership proof",async()=>{
  mode="name-mismatch";const item=await submit();
  expect(item).toMatchObject({status:"ACTION_REQUIRED",errorCode:"LIVE_BANK_ACCOUNT_HOLDER_MISMATCH",canApprove:false});
  expect((await review(item.id)).status).toBe(503);expect(posts()).toHaveLength(0);
  mode="ok";expect((await submit()).status).toBe("BANK_VERIFIED");
});
it("retains sanitized bank-resolution HTTP diagnostics without claiming mismatch or success",async()=>{
  mode="permission";const item=await submit();
  expect(item).toMatchObject({status:"SUBMITTED",errorCode:"LIVE_SUBACCOUNT_API_PERMISSION_REQUIRED",providerHttpStatus:403,canApprove:false});
  expect(JSON.stringify(item)).not.toContain("provider details must never leak");
  expect((await db.query("SELECT bank_verified_at FROM flutterwave_live_school_onboarding")).rows[0].bank_verified_at).toBeNull();
  mode="ok";expect((await submit()).status).toBe("BANK_VERIFIED");
});
it("stales changed submissions, prevents old-snapshot approval and retains earlier history",async()=>{
  const old=await submit();await db.query("UPDATE settlement_payroll_profiles SET business_registration_number='FIXTURE_CHANGED' WHERE id=10");
  expect((await review(old.id)).status).toBe(503);expect(posts()).toHaveLength(0);
  const next=await submit();expect(next.id).not.toBe(old.id);
  expect((await db.query("SELECT status FROM flutterwave_live_school_onboarding WHERE id=$1",[old.id])).rows[0].status).toBe("STALE");
});
it("prevents school accounts matching the platform's bank account",async()=>{
  await db.query("DELETE FROM settlement_payroll_profiles WHERE id=100");await seedProfile("YEMAIT_COMPANY",null,bank.accountNumber,100);
  expect((await http("/schools/10/finance/live-subaccount-onboarding",2,{})).body.code).toBe("SCHOOL_ACCOUNT_MUST_DIFFER_FROM_PLATFORM");
  expect(calls).toHaveLength(0);
});
it("does not POST when durable claim COMMIT succeeds but its acknowledgement is lost",async()=>{
  const item=await submit();let committed=false;
  const uncertainPool={connect:async()=>{
    const c=await db.connect();let claiming=false;
    return {release:()=>c.release(),query:async(sql:string,values?:any[])=>{
      if(sql.includes("creation_claimed_at=now()"))claiming=true;
      const result=await c.query(sql,values);
      if(sql==="COMMIT"&&claiming&&!committed){committed=true;throw Error("fixture lost commit acknowledgement");}
      return result;
    }};
  }};
  await expect(reviewLiveSchoolOnboarding(uncertainPool as any,1,item.id,liveOnboardingReview.parse(approval()),env,provider)).rejects.toThrow();
  expect(posts()).toHaveLength(0);expect((await review(item.id)).body.status).toBe("CREATING");
  expect(posts()).toHaveLength(0);
});
it("preserves claims, snapshots, provider identities and audit history in actual PostgreSQL",async()=>{
  const item=await submit();await review(item.id);
  for(const sql of [
    "UPDATE flutterwave_live_school_onboarding SET creation_claimed_at=NULL",
    "UPDATE flutterwave_live_school_onboarding SET school_id=20",
    "UPDATE flutterwave_live_school_onboarding SET provider_subaccount_id='RS_OTHER_FIXTURE_000000'",
    "DELETE FROM flutterwave_live_school_onboarding",
    "DELETE FROM flutterwave_live_school_onboarding_audits",
  ])await expect(db.query(sql)).rejects.toThrow();
});
it("keeps a rejection auditable and cannot create from it",async()=>{
  const item=await submit();
  expect((await review(item.id,{action:"REJECT",note:"Fixture ownership evidence rejected."} as any)).body.status).toBe("REJECTED");
  expect((await review(item.id)).status).toBe(503);expect(posts()).toHaveLength(0);
});
it("reports a missing target release and never sends external requests",async()=>{
  await db.query("UPDATE flutterwave_live_school_onboarding_releases SET enabled=false");
  const r=await http("/flutterwave/live/school-subaccounts",1);
  expect(r.body.blockers).toContain("LIVE_ONBOARDING_TARGET_RELEASE_APPROVAL_REQUIRED");
  expect((await http("/schools/10/finance/live-subaccount-onboarding",2,{})).status).toBe(503);
  expect(calls).toHaveLength(0);
});
it("requires a canonical active Owner as the target release reviewer",async()=>{
  await db.query("UPDATE flutterwave_live_school_onboarding_releases SET reviewed_by=4");
  expect((await http("/flutterwave/live/school-subaccounts",1)).body.blockers).toContain("LIVE_ONBOARDING_TARGET_RELEASE_APPROVAL_REQUIRED");
  expect((await http("/schools/10/finance/live-subaccount-onboarding",2,{})).status).toBe(503);expect(calls).toHaveLength(0);
});
it("shows verification expiry and refreshes it without creating a second submission",async()=>{
  const item=await submit();await db.query("UPDATE flutterwave_live_school_onboarding SET bank_verified_at=now()-interval '25 hours'");
  const listed=await http("/flutterwave/live/school-subaccounts",1);
  expect(listed.body.items[0]).toMatchObject({canApprove:false,errorCode:"FRESH_INDEPENDENT_LIVE_BANK_VERIFICATION_REQUIRED"});
  expect((await review(item.id)).status).toBe(503);expect(posts()).toHaveLength(0);
  const refreshed=await submit();expect(refreshed.id).toBe(item.id);expect(refreshed.canApprove).toBe(true);
});
it("keeps Owner history readable for deactivated schools but blocks school operations",async()=>{
  await submit();await db.query("UPDATE schools SET status='inactive' WHERE id=10");
  const listed=await http("/flutterwave/live/school-subaccounts",1);
  expect(listed.status).toBe(200);expect(listed.body.items[0]).toMatchObject({canApprove:false,errorCode:"SCHOOL_PROFILE_CHANGED"});
  expect((await http("/flutterwave/live/school-subaccounts?schoolId=10",2)).status).toBe(403);
});
it("preserves provider identity but blocks readiness when a profile changes during creation",async()=>{
  const item=await submit();mode="change-during-create";const result=await review(item.id);
  expect(result.body).toMatchObject({status:"CREATION_UNKNOWN",errorCode:"SCHOOL_PROFILE_CHANGED",canApprove:false,checkoutEnabled:false});
  const row=(await db.query("SELECT provider_subaccount_id FROM flutterwave_live_school_onboarding")).rows[0];
  expect(row.provider_subaccount_id).toBe(providerRecord.subaccount_id);
  expect((await submit()).id).toBe(item.id);expect(posts()).toHaveLength(1);
});
it("does not reassign a pre-existing LIVE authority from another school",async()=>{
  await db.query(`CREATE TABLE flutterwave_live_authority_reviews(id serial,school_id integer,merchant_scope text,school_subaccount_id text)`);
  try{
    await db.query("INSERT INTO flutterwave_live_authority_reviews(school_id,merchant_scope,school_subaccount_id) VALUES(20,'fixture_merchant',$1)",[providerRecord.subaccount_id]);
    const item=await submit();created=true;const r=await review(item.id);
    expect(r.body.code).toBe("LIVE_SUBACCOUNT_BOUND_TO_ANOTHER_SCHOOL");expect(posts()).toHaveLength(0);
  }finally{await db.query("DROP TABLE flutterwave_live_authority_reviews");}
});
it("checks each independent configuration prerequisite without enabling checkout",()=>{
  expect(onboardingConfiguration(env).blockers).toEqual([]);
  for(const key of ["NODE_ENV","EDUCORE_FLUTTERWAVE_MODE","EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED",
    "EDUCORE_FLUTTERWAVE_ONBOARDING_RELEASE","EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE","FLUTTERWAVE_LIVE_SECRET_KEY",
    "FLUTTERWAVE_KYC_APPROVED","FLUTTERWAVE_SUBACCOUNT_CREATION_CONFIRMED","FLUTTERWAVE_SUBACCOUNT_DEFAULTS_CONFIRMED",
    "EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT","FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH","PUBLIC_APP_URL"]){
    expect(onboardingConfiguration({...env,[key]:undefined}).blockers.length,key).toBeGreaterThan(0);
  }
  expect(onboardingConfiguration({...env,FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-TEST-fictional"}).blockers).toContain("DEDICATED_LIVE_CREDENTIAL_REQUIRED");
  expect(onboardingConfiguration({...env,FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH}).blockers).toContain("DISTINCT_TEST_WEBHOOK_BINDING_REQUIRED");
});
