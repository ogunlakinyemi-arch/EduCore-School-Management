import {createHmac} from "node:crypto";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";

// Real SQL against a disposable local cluster; never uses DATABASE_URL.
const state=vi.hoisted(()=>({db:null as any,marker:null as any,email:"officer@example.test",verified:true,
  acceptedProvider:true,cleanupFails:false,providerUnavailable:false}));
vi.mock("@workspace/db",()=>({pool:{
  query:(sql:string,values?:unknown[])=>state.db.query(sql,values),
  connect:()=>state.db.connect(),
}}));
vi.mock("@clerk/express",()=>({clerkClient:{
  users:{
    getUser:vi.fn(async()=>({primaryEmailAddress:{emailAddress:state.email,verification:{status:state.verified?"verified":"unverified"}},
      publicMetadata:{edupulseInternalEmployeeInvitation:state.marker}})),
    updateUserMetadata:vi.fn(async()=>{
      if(state.cleanupFails) throw new Error("Simulated secondary cleanup outage");
      state.marker=null;
    }),
  },
  invitations:{getInvitationList:vi.fn(async()=>{
    if(state.providerUnavailable) throw new Error("Simulated provider outage");
    return {data:state.acceptedProvider?[{id:"native-invitation",status:"accepted",emailAddress:state.email,
      createdAt:Date.now(),publicMetadata:{edupulseInternalEmployeeInvitation:state.marker}}]:[]};
  })},
}}));
import {activateAcceptedInternalEmployeeInvitation} from "./internal-employee-invitations";

const claimId="4d62c41b-ab5b-4f64-a9fa-ae8210bc91ad";
let directory:string;
let postgres:ChildProcess;
beforeAll(async()=>{
  directory=mkdtempSync(join(tmpdir(),"internal-invitation-pg-"));
  execFileSync("initdb",["-D",directory,"-A","trust","--no-locale"],{stdio:"ignore"});
  const socket=createServer();
  await new Promise<void>(resolve=>socket.listen(0,"127.0.0.1",()=>resolve()));
  const port=(socket.address() as {port:number}).port;
  await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  postgres=spawn("postgres",["-D",directory,"-p",String(port),"-h","127.0.0.1","-k",directory],{stdio:"ignore"});
  const pgPath=new URL("../../../../lib/db/node_modules/pg/lib/index.js",import.meta.url).href;
  const {default:pg}=await import(pgPath);
  state.db=new pg.Pool({host:"127.0.0.1",port,user:userInfo().username,database:"postgres"});
  for(let attempt=0;attempt<100;attempt++){
    try{await state.db.query("SELECT 1");break;}
    catch(error){if(attempt===99) throw error;await new Promise(resolve=>setTimeout(resolve,50));}
  }
  await state.db.query(`
    CREATE TABLE app_users(id integer PRIMARY KEY,clerk_user_id text UNIQUE,email text,status text);
    CREATE TABLE schools(id integer PRIMARY KEY,status text);
    CREATE TABLE platform_company_employees(id integer PRIMARY KEY,email text,status text);
    CREATE TABLE school_memberships(id serial PRIMARY KEY,user_id integer REFERENCES app_users,
      school_id integer REFERENCES schools,role text,status text,UNIQUE(user_id,school_id,role));
    CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id integer REFERENCES app_users,
      clerk_user_id text,school_id integer REFERENCES schools,action text,module text,record_id integer,
      severity text,event_type text,result text,metadata jsonb,timestamp timestamptz DEFAULT now());
  `);
},20000);
afterAll(async()=>{
  await state.db?.end();
  if(postgres && postgres.exitCode===null) {
    const stopped=new Promise<void>(resolve=>postgres.once("exit",()=>resolve()));
    postgres.kill("SIGTERM");await stopped;
  }
  if(directory)rmSync(directory,{recursive:true,force:true});
},15000);
beforeEach(async()=>{
  process.env.CLERK_SECRET_KEY="native-invitation-test-key";
  state.email="officer@example.test";state.verified=true;state.acceptedProvider=true;
  state.cleanupFails=false;state.providerUnavailable=false;
  state.marker={version:1,claimId,employeeId:11,role:"DEVICE_ACTIVATION_OFFICER",schoolId:1,
    signature:createHmac("sha256","native-invitation-test-key")
      .update(["v1",claimId,11,state.email,"DEVICE_ACTIVATION_OFFICER",1].join("|")).digest("hex")};
  await state.db.query(`TRUNCATE audit_logs,school_memberships,platform_company_employees,schools,app_users RESTART IDENTITY;
    INSERT INTO app_users VALUES(77,'native-invitee','officer@example.test','ACTIVE'),
      (78,'other-invitee','other@example.test','ACTIVE');
    INSERT INTO schools VALUES(1,'ACTIVE'),(2,'ACTIVE');
    INSERT INTO platform_company_employees VALUES(11,'officer@example.test','ACTIVE');
    INSERT INTO audit_logs("user",role,action,module,record_id,event_type,result)
      VALUES('Owner','PLATFORM_OWNER','Created company employee','Company Employees',11,'PLATFORM_COMPANY_EMPLOYEE_CREATED','SUCCESS');`);
});
async function pending(expiresAt=new Date(Date.now()+86400000).toISOString()){
  await state.db.query(`INSERT INTO audit_logs("user",role,action,module,record_id,event_type,result,metadata)
    VALUES('Owner','PLATFORM_OWNER','Invited','Company Employees',11,'INTERNAL_EMPLOYEE_INVITED','SUCCESS',$1)`,
    [JSON.stringify({claimId,expiresAt})]);
}
async function counts(){
  return (await state.db.query(`SELECT
    (SELECT count(*)::integer FROM platform_company_employees WHERE id=11) AS employees,
    (SELECT count(*)::integer FROM school_memberships WHERE user_id=77) AS roles,
    (SELECT count(*)::integer FROM audit_logs WHERE event_type='INTERNAL_EMPLOYEE_INVITATION_ACCEPTED') AS accepted`)).rows[0];
}
const activate=()=>activateAcceptedInternalEmployeeInvitation(77,"native-invitee",claimId);
describe("identity-bound internal invitation SQL and concurrency",()=>{
  it("commits exactly one profile/role/receipt and reconciles a metadata-cleared retry",async()=>{
    await pending();expect(await activate()).toBe(true);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
    expect(state.marker).toBeNull();expect(await activate()).toBe(true);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
    expect((await state.db.query("SELECT role,school_id FROM school_memberships")).rows)
      .toEqual([{role:"DEVICE_ACTIVATION_OFFICER",school_id:1}]);
  });
  it("serializes two simultaneous acceptance calls without duplicate roles or receipts",async()=>{
    await pending();expect(await Promise.all([activate(),activate()])).toEqual([true,true]);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
  });
  it("recovers the original omitted claim only with accepted provider evidence and Owner creation",async()=>{
    expect(await activate()).toBe(true);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
    expect((await state.db.query("SELECT metadata FROM audit_logs WHERE event_type='INTERNAL_EMPLOYEE_INVITED'")).rows[0].metadata.reconciled).toBe(true);
  });
  it("rejects missing Owner creation evidence without writing a claim or role",async()=>{
    await state.db.query("DELETE FROM audit_logs");
    await expect(activate()).rejects.toThrow("Owner-created");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("does not recover a pending or revoked provider invitation",async()=>{
    state.acceptedProvider=false;await expect(activate()).rejects.toThrow("No accepted invitation");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("preserves a recoverable account when provider confirmation is unavailable",async()=>{
    state.providerUnavailable=true;await expect(activate()).rejects.toMatchObject({statusCode:503});
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
    state.providerUnavailable=false;expect(await activate()).toBe(true);
  });
  it("rejects an expired pending claim",async()=>{
    await pending(new Date(Date.now()-1000).toISOString());
    await expect(activate()).rejects.toThrow("expired");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("rejects an invalidated local claim even if signed provider metadata remains",async()=>{
    await pending();
    await state.db.query(`INSERT INTO audit_logs(module,record_id,event_type,metadata)
      VALUES('Company Employees',11,'INTERNAL_EMPLOYEE_INVITATION_INVALIDATED',$1)`,[JSON.stringify({claimId})]);
    await expect(activate()).rejects.toThrow("no longer pending");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("rejects a different app account and never matches another identity's accepted receipt",async()=>{
    await pending();await activate();
    await expect(activateAcceptedInternalEmployeeInvitation(78,"other-invitee",claimId)).rejects.toThrow("does not belong");
    expect((await state.db.query("SELECT count(*)::integer AS n FROM school_memberships WHERE user_id=78")).rows[0].n).toBe(0);
  });
  it("rejects a manipulated claim ID before role insertion",async()=>{
    await pending();
    await expect(activateAcceptedInternalEmployeeInvitation(77,"native-invitee","aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).rejects.toThrow("does not match");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("rejects modified role metadata and unverified email",async()=>{
    await pending();state.marker.role="PLATFORM_OWNER";await expect(activate()).rejects.toThrow("invalid");
    state.verified=false;await expect(activate()).rejects.toThrow("Verify");
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
  });
  it("cannot combine officer activation with an Owner or ordinary school role",async()=>{
    await pending();await state.db.query("INSERT INTO school_memberships(user_id,role,status) VALUES(77,'PLATFORM_OWNER','ACTIVE')");
    await expect(activate()).rejects.toThrow("cannot be combined");
    expect((await counts()).accepted).toBe(0);
  });
  it("does not reactivate a deactivated role through an accepted receipt",async()=>{
    await pending();await activate();
    await state.db.query("UPDATE school_memberships SET status='INACTIVE'");
    await expect(activate()).rejects.toThrow("does not belong");
    expect((await state.db.query("SELECT status FROM school_memberships")).rows[0].status).toBe("INACTIVE");
  });
  it("keeps acceptance committed when secondary metadata cleanup fails",async()=>{
    await pending();state.cleanupFails=true;expect(await activate()).toBe(true);
    expect(await activate()).toBe(true);expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
  });
  it("finishes a partial role-before-receipt state without creating another role",async()=>{
    await pending();
    await state.db.query("INSERT INTO school_memberships(user_id,school_id,role,status) VALUES(77,1,'DEVICE_ACTIVATION_OFFICER','ACTIVE')");
    expect(await activate()).toBe(true);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
  });
  it("rolls back role provisioning on receipt-write failure and safely retries",async()=>{
    await pending();
    await state.db.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_receipt CHECK(event_type<>'INTERNAL_EMPLOYEE_INVITATION_ACCEPTED')");
    await expect(activate()).rejects.toThrow();
    expect(await counts()).toEqual({employees:1,roles:0,accepted:0});
    await state.db.query("ALTER TABLE audit_logs DROP CONSTRAINT reject_receipt");
    expect(await activate()).toBe(true);
    expect(await counts()).toEqual({employees:1,roles:1,accepted:1});
  });
});
