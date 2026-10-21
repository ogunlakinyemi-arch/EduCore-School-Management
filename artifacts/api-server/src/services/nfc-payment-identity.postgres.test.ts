import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabasePool} from "@workspace/db/driver";
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from "vitest";

const state=vi.hoisted(()=>({pool:null as any}));
vi.mock("@workspace/db",()=>({pool:{connect:()=>state.pool.connect()}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,getUserContext:()=>({user:{id:1},roles:[{role:"SCHOOL_ADMIN",status:"ACTIVE",schoolId:1}]}),
    assertSchoolOperationalAccess:(_req:unknown,schoolId:number)=>{
      if(schoolId!==1)throw new actual.AuthError(404,"School not found");
    }};
});
vi.mock("../lib/student-subscription-return-url",()=>({
  configuredStudentSubscriptionCheckoutBaseUrl:()=>"https://development.example.invalid",
}));
vi.mock("./nfc-payment-links",async original=>({
  ...await original<typeof import("./nfc-payment-links")>(),expectedNfcAllocations:async()=>[],
}));
import {createBoundNfcPaymentLink} from "../routes/nfc-payment-links";
import {publicLinkSql,publicNfcLink,nfcLinkTokenHash} from "./nfc-payment-links";
let dir:string,server:ChildProcess;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"nfc-identity-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","identity_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  server=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  state.pool=new DatabasePool({host:dir,port:5432,database:"postgres",user:"identity_fixture",max:3,connectionTimeoutMillis:500});
  let ready=false;
  for(let i=0;i<100;i++){try{await state.pool.query("SELECT 1");ready=true;break;}catch{await new Promise(r=>setTimeout(r,30));}}
  if(!ready)throw new Error("Disposable database unavailable; application DB fallback forbidden");
  await state.pool.query(`
    CREATE TABLE schools(id int PRIMARY KEY,name text,status text);
    CREATE TABLE students(id int PRIMARY KEY,school_id int,first_name text,last_name text,admission_no text,status text,
      guardian_email text,date_of_birth date);
    CREATE TABLE academic_sessions(id int PRIMARY KEY,school_id int,name text);
    CREATE TABLE academic_terms(id int PRIMARY KEY,school_id int,academic_session_id int,name text);
    CREATE TABLE subscriptions(id int PRIMARY KEY,school_id int,student_id int,amount int,term text,status text,verification_status text);
    CREATE TABLE student_subscription_terms(school_id int,student_id int,subscription_id int UNIQUE,
      academic_session_id int,academic_term_id int,legacy_invoice_id int,
      UNIQUE(school_id,student_id,academic_session_id,academic_term_id));
    CREATE TABLE student_subscription_payments(id int PRIMARY KEY,subscription_id int,school_id int,student_id int,
      academic_session_id int,academic_term_id int,provider text,provider_mode text,status text,
      reconciliation_status text,checkout_url text,reference text,receipt_snapshot jsonb);
    CREATE TABLE nfc_payment_links(id serial PRIMARY KEY,school_id int,student_id int,subscription_id int,academic_session_id int,
      academic_term_id int,created_by int,reference text UNIQUE,token_hash text UNIQUE,mode text,payment_id int,
      expected_allocations jsonb,expires_at timestamptz,status text DEFAULT 'PENDING');`);
},30000);
afterAll(async()=>{
  await state.pool?.end();
  if(server&&server.exitCode===null){server.kill("SIGTERM");await new Promise<void>(r=>server.once("exit",()=>r()));}
  if(dir)await rm(dir,{recursive:true,force:true});
});
beforeEach(async()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  vi.stubEnv("SESSION_SECRET","isolated-fictional-identity-fixture");
  await state.pool.query(`TRUNCATE schools,students,academic_sessions,academic_terms,subscriptions,
    student_subscription_terms,student_subscription_payments,nfc_payment_links RESTART IDENTITY;
    INSERT INTO schools VALUES(1,'Fictional School','active'),(2,'Other School','active');
    INSERT INTO students VALUES(1,1,'Ada','Example','ADM-000004','active','private@example.invalid','2000-01-01'),
      (2,1,'Bola','Example','ADM-000003','active',NULL,NULL),(3,2,'Other','Student','OTHER-1','active',NULL,NULL);
    INSERT INTO academic_sessions VALUES(1,1,'Session'),(2,2,'Other session');
    INSERT INTO academic_terms VALUES(1,1,1,'Term'),(2,2,2,'Other term');
    INSERT INTO subscriptions VALUES(1,1,1,5000,'FIRST','pending','pending'),(2,1,2,5000,'FIRST','pending','pending');
    INSERT INTO student_subscription_terms VALUES(1,1,1,1,1,NULL),(1,2,2,1,1,NULL);`);
});
afterEach(()=>vi.unstubAllEnvs());
const create=(id=1,expected={schoolId:1,studentId:id,sessionId:1,termId:1})=>
  createBoundNfcPaymentLink({} as any,id,{termId:1,mode:"DEVELOPMENT_SIMULATION"},expected);
const lookup=async(url:string)=>(await state.pool.query(publicLinkSql,[nfcLinkTokenHash(new URL(url).hash.slice(1))])).rows;
describe("canonical NFC payment identity in isolated PostgreSQL",()=>{
  it("creation and public token resolve the same canonical name, identifier and period for two students",async()=>{
    for(const [id,name,identifier] of [[1,"Ada Example","ADM-000004"],[2,"Bola Example","ADM-000003"]] as const){
      const created=await create(id),rows=await lookup(created.paymentUrl);
      expect(rows).toHaveLength(1);
      const viewed=publicNfcLink(rows[0]);
      expect(viewed).toMatchObject({studentName:name,studentIdentifier:identifier,schoolName:"Fictional School",
        reference:created.reference,termName:created.termName,sessionName:created.sessionName,expiresAt:created.expiresAt,
        status:"PENDING",subscriptionActivated:false});
      expect(created.studentName).toBe(viewed.studentName);
      expect(created.studentIdentifier).toBe(viewed.studentIdentifier);
      expect(Object.keys(viewed)).toEqual(["reference","schoolName","studentName","studentIdentifier","termName","sessionName",
        "amountMinor","amountDueMinor","currency","mode","status","expiresAt","settlementStatus","subscriptionActivated",
        "checkoutUrl","receiptReference","expectedAllocations"]);
      expect(JSON.stringify(viewed)).not.toMatch(/private@example|guardian_email|date_of_birth|student_id|token_hash/);
    }
    expect((await state.pool.query("SELECT count(*)::int AS n FROM student_subscription_payments")).rows[0].n).toBe(0);
  });
  it.each([["student_id",2],["school_id",2],["academic_term_id",2],["academic_session_id",2]])(
    "fails closed for tampered %s without showing another student's name",async(field,value)=>{
      const created=await create();
      await state.pool.query(`UPDATE nfc_payment_links SET ${field}=$1`,[value]);
      expect(await lookup(created.paymentUrl)).toHaveLength(0);
      await expect(create()).rejects.toThrow();
    });
  it("rejects a missing student or a blank canonical name",async()=>{
    const created=await create();
    await state.pool.query("UPDATE students SET first_name='',last_name=' ' WHERE id=1");
    await expect(Promise.resolve().then(async()=>publicNfcLink((await lookup(created.paymentUrl))[0]))).rejects.toThrow();
    await state.pool.query("DELETE FROM students WHERE id=1");
    expect(await lookup(created.paymentUrl)).toHaveLength(0);
  });
  it("does not trust a mismatched assisted-request binding",async()=>{
    await expect(create(1,{schoolId:1,studentId:2,sessionId:1,termId:1})).rejects.toThrow();
    expect((await state.pool.query("SELECT count(*)::int AS n FROM nfc_payment_links")).rows[0].n).toBe(0);
  });
});
