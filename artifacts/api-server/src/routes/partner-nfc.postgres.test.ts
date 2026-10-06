/** Native SQL/routed tests restore schema only into a disposable local cluster.
 * All authentication headers below exist ONLY in this test module, not the app.
 */
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import express from "express";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {createServer} from "node:net";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
const state=vi.hoisted(()=>({db:null as any,pendingAudits:[] as Promise<any>[],initialDefaults:false}));
vi.mock("@workspace/db",()=>({pool:{query:(...a:any[])=>{
  const p=state.db.query(...a);if(String(a[0]).includes("INSERT INTO audit_logs"))state.pendingAudits.push(p);return p;
},connect:()=>state.db.connect()}}));
vi.mock("../middlewares/auth",async original=>{
  const real=await original<typeof import("../middlewares/auth")>();
  return{...real,requireAuthentication:()=> (req:any,_res:any,next:any)=>{
    const user=Number(req.headers["x-fixture-user"]??2),role=String(req.headers["x-fixture-role"]??"PARTNER");
    req.edupulseUser={user:{id:user,clerkUserId:`partner-native-${user}`,email:`native-${user}@example.invalid`,firstName:"Native",lastName:"Test",status:"ACTIVE",phone:null},
      roles:[{id:user,role,schoolId:role==="SCHOOL_ADMIN"?1:null,status:"ACTIVE"}]};next();
  }};
});
import router from "./partner-nfc";
import ownerRouter from "./edupulse";
import platformRouter from "./platform";
import {handleAuthError,AuthError} from "../middlewares/auth";
import {assignAvailableStudentCard} from "../services/student-card-assignment";
import {partnerNfcSchool} from "../services/partner-nfc-access";
import {studentNfcCardLookupSql,activeSchoolNfcDevicesSql} from "../lib/nfc-device-first";
const snapshot=process.env.EDUCORE_PARTNER_NFC_SCHEMA;
let directory:string,postgres:ChildProcess,server:any,base:string;
const q=(s:string,v?:any[])=>state.db.query(s,v);
const test=it.skipIf(!snapshot);
async function call(path:string,body?:any,{user=2,role="PARTNER",method=body===undefined?"GET":"POST"}={}){
  const r=await fetch(`${base}/api${path}`,{method,headers:{"Content-Type":"application/json","x-fixture-user":String(user),"x-fixture-role":role},body:body===undefined?undefined:JSON.stringify(body)});
  return{status:r.status,body:await r.json() as any};
}
const owner=(path:string,body?:any)=>call(path,body,{user:1,role:"PLATFORM_OWNER",method:body?"PATCH":"GET"});
const assign=(studentId=1,cardNumber="NATIVE-CARD-1",opts={})=>call("/partner/nfc/schools/1/assign",{studentId,cardNumber},opts);
beforeAll(async()=>{
  if(!snapshot)return;
  directory=mkdtempSync(join(tmpdir(),"partner-nfc-pg-"));execFileSync("initdb",["-D",directory,"-A","trust","--no-locale"],{stdio:"ignore"});
  const socket=createServer();await new Promise<void>(r=>socket.listen(0,"127.0.0.1",()=>r()));
  const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
  postgres=spawn("postgres",["-D",directory,"-p",String(port),"-h","127.0.0.1","-k",directory],{stdio:"ignore"});
  const {default:pg}=await import(new URL("../../../../lib/db/node_modules/pg/lib/index.js",import.meta.url).href);
  state.db=new pg.Pool({host:"127.0.0.1",port,user:userInfo().username,database:"postgres"});
  for(let n=0;;n++){try{await q("SELECT 1");break;}catch(e){if(n>100)throw e;await new Promise(r=>setTimeout(r,50));}}
  await q(readFileSync(snapshot,"utf8").replace(/^\\(?:un)?restrict .*$/gm,""));await q("SET search_path TO public");
  await q("ALTER TABLE partner_profiles DROP COLUMN nfc_activation_enabled; ALTER TABLE partner_profile_users DROP COLUMN nfc_activation_enabled;");
  await q(`
    INSERT INTO app_users(id,clerk_user_id,email) SELECT n,'partner-native-'||n,'native-'||n||'@example.invalid' FROM generate_series(1,8)n;
    INSERT INTO schools(id,code,name,city,state,status) VALUES(1,'PARTNER_NATIVE_A','Native A','Test','Test','active'),
      (2,'PARTNER_NATIVE_B','Native B','Test','Test','active'),(3,'PARTNER_NATIVE_NO_READER','Native no reader','Test','Test','active');
    INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section,status) VALUES
      (1,1,'NATIVE-1','First','Student','Male','SS2','A','active'),(2,1,'NATIVE-2','Second','Student','Female','SS2','A','active'),
      (3,2,'NATIVE-3','Other','Student','Male','SS2','A','active'),(4,1,'NATIVE-4','Inactive','Student','Female','SS2','A','inactive');
    INSERT INTO partner_profiles(id,user_id,partner_code,full_name,email,status) VALUES
      (1,2,'PARTNER_NATIVE_A','Native Partner A','native-2@example.invalid','ACTIVE'),(2,3,'PARTNER_NATIVE_B','Native Partner B','native-3@example.invalid','ACTIVE');
    INSERT INTO partner_profile_users(id,partner_profile_id,user_id,role,status) VALUES
      (1,1,4,'PARTNER_STAFF','ACTIVE'),(2,1,5,'PARTNER_ADMIN','ACTIVE'),(3,2,6,'PARTNER_STAFF','ACTIVE');
    INSERT INTO school_partner_attributions(id,school_id,partner_profile_id,source,status,is_current) VALUES
      (1,1,1,'PARTNER_DIRECT','ACTIVE',true),(2,2,2,'REFERRAL','ACTIVE',true),(3,3,1,'REFERRAL','ACTIVE',true);
    INSERT INTO platform_devices(id,serial_number,name,device_type,status,configuration_status,school_id) VALUES
      (1,'PARTNER-NATIVE-DEV1','Native Reader A','NFC','ACTIVE','CONFIGURED',1),
      (2,'PARTNER-NATIVE-DEV2','Native Reader B','HYBRID','ACTIVE','CONFIGURED',2);
    INSERT INTO device_school_bindings(device_id,school_id) VALUES(1,1),(2,2);
  `);
  await q(readFileSync(new URL("../../../../lib/db/drizzle/0059_partner_nfc_permission.sql",import.meta.url),"utf8"));
  state.initialDefaults=(await q(`SELECT nfc_activation_enabled FROM partner_profiles UNION ALL SELECT nfc_activation_enabled FROM partner_profile_users`)).rows.every((r:any)=>r.nfc_activation_enabled===false);
  const app=express();app.use(express.json());app.use("/api",router);app.use("/api",ownerRouter);app.use("/api",platformRouter);
  app.use((error:any,req:any,res:any,next:any)=>{if(error instanceof AuthError)return handleAuthError(error,req,res,next);res.status(500).json({error:String(error.message)});});
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",()=>r()));base=`http://127.0.0.1:${server.address().port}`;
},60000);
beforeEach(async()=>{
  if(!snapshot)return;
  await Promise.all(state.pendingAudits);state.pendingAudits=[];
  await q("DELETE FROM nfc_card_history; DELETE FROM audit_logs; DELETE FROM nfc_cards;");
  await q("UPDATE partner_profiles SET status='ACTIVE',nfc_activation_enabled=true; UPDATE partner_profile_users SET status='ACTIVE',nfc_activation_enabled=false;");
  await q("UPDATE app_users SET status='ACTIVE'; UPDATE schools SET status='active'; UPDATE platform_devices SET status='ACTIVE',configuration_status='CONFIGURED';");
  await q("UPDATE school_partner_attributions SET status='ACTIVE',is_current=true;");
  await q(`INSERT INTO nfc_cards(id,school_id,uid,status) VALUES(1,1,'NATIVE-CARD-1','unassigned'),(2,1,'NATIVE-CARD-2','unassigned'),(3,2,'NATIVE-CARD-3','unassigned');
    SELECT setval(pg_get_serial_sequence('nfc_cards','id'),3);`);
});
afterAll(async()=>{
  if(!snapshot)return;if(server)await new Promise<void>(r=>server.close(()=>r()));
  if(state.db)await state.db.end();if(postgres){postgres.kill("SIGTERM");await new Promise(r=>postgres.once("exit",r));}
  if(directory)rmSync(directory,{recursive:true,force:true});
});
test("default-off migration applies to existing and future Partner/staff rows",async()=>{
  const cols=await q(`SELECT table_name,column_default,is_nullable FROM information_schema.columns WHERE table_name IN ('partner_profiles','partner_profile_users') AND column_name='nfc_activation_enabled' ORDER BY table_name`);
  expect(cols.rows).toHaveLength(2);expect(cols.rows.every((r:any)=>r.column_default==="false"&&r.is_nullable==="NO")).toBe(true);
  expect(state.initialDefaults).toBe(true);
  await q(`INSERT INTO partner_profiles(id,partner_code,full_name,email) VALUES(99,'DEFAULT_NATIVE','Default','default@example.invalid') RETURNING id`);
  expect((await q("SELECT nfc_activation_enabled FROM partner_profiles WHERE partner_code='DEFAULT_NATIVE'")).rows[0].nfc_activation_enabled).toBe(false);
  await q("INSERT INTO partner_profile_users(id,partner_profile_id,user_id,role) VALUES(99,1,7,'PARTNER_STAFF')");
  expect((await q("SELECT nfc_activation_enabled FROM partner_profile_users WHERE id=99")).rows[0].nfc_activation_enabled).toBe(false);
});
test("Owner grant/revoke audited and immediately caps Partner access without changing referral",async()=>{
  expect((await owner("/partners/1/nfc-permission",{enabled:true})).status).toBe(200);
  expect((await call("/partner/nfc/access")).body.enabled).toBe(true);
  expect((await owner("/partners/1/nfc-permission",{enabled:false})).status).toBe(200);
  expect((await call("/partner/nfc/access")).body.enabled).toBe(false);
  expect((await assign()).status).toBe(403);
  const history=(await owner("/partners/1/nfc-permission")).body.history;
  expect(history).toHaveLength(2);expect(history[0]).toMatchObject({actorUserId:1,previousValue:true,newValue:false});
  expect((await q("SELECT source,is_current FROM school_partner_attributions WHERE id=1")).rows[0]).toEqual({source:"PARTNER_DIRECT",is_current:true});
});
test.each(["PARTNER","SCHOOL_ADMIN","DEVICE_ACTIVATION_OFFICER","TEACHER"])("%s cannot grant Owner permission",async role=>{
  expect((await call("/partners/1/nfc-permission",{enabled:true},{role,user:2,method:"PATCH"})).status).toBe(403);
});
test("extra authority fields and manipulated Partner/referral/device/card IDs fail closed",async()=>{
  for(const field of ["partnerId","referralId","deviceId","deviceIds","device_id","cardId","schoolId","enabled","nfcActivationEnabled"]){
    expect((await call("/partner/nfc/schools/1/assign",{studentId:1,cardNumber:"NATIVE-CARD-1",[field]:2})).status).toBe(400);
  }
  expect((await call("/partner/nfc/schools?partnerId=2")).status).toBe(400);
  expect((await call("/partner/nfc/schools/2/assign",{studentId:3,cardNumber:"NATIVE-CARD-3"})).status).toBe(404);
  expect((await assign(3)).status).toBe(404);expect((await assign(4)).status).toBe(404);
  expect((await assign(1,"NATIVE-CARD-3")).status).toBe(409);
});
test("only authoritative referred schools listed; no-reader referred school visible but unavailable",async()=>{
  const r=await call("/partner/nfc/schools");expect(r.body.map((s:any)=>s.schoolId)).toEqual([1,3]);
  expect(r.body[1]).toMatchObject({eligible:false,activeDeviceCount:0});expect(r.body[1].unavailableReason).toContain("Platform Owner");
  expect((await call("/partner/nfc/schools/3/students")).status).toBe(409);
  expect((await call("/partner/nfc/schools/2/students")).status).toBe(404);
  await q("UPDATE school_partner_attributions SET status='ENDED',is_current=false WHERE id=1");
  expect((await assign()).status).toBe(404);
});
test("last-reader deactivation/configuration removal blocks; reader restoration permits assignment",async()=>{
  await q("UPDATE platform_devices SET status='INACTIVE' WHERE id=1");expect((await assign()).status).toBe(409);
  await q("UPDATE platform_devices SET status='ACTIVE',configuration_status='PENDING' WHERE id=1");expect((await assign()).status).toBe(409);
  await q("UPDATE platform_devices SET configuration_status='CONFIGURED' WHERE id=1");expect((await assign()).status).toBe(201);
});
test("inactive Partner/account/staff/school deny writes",async()=>{
  await q("UPDATE partner_profiles SET status='INACTIVE' WHERE id=1");expect((await assign()).status).toBe(403);
  await q("UPDATE partner_profiles SET status='ACTIVE';UPDATE app_users SET status='INACTIVE' WHERE id=2");expect((await assign()).status).toBe(403);
  await q("UPDATE app_users SET status='ACTIVE';UPDATE schools SET status='inactive' WHERE id=1");expect((await assign()).status).toBe(404);
});
test("existing school inventory card assigned as locked with actual actor/history; duplicate/missing/cross-school denied",async()=>{
  const r=await assign();expect(r.status).toBe(201);expect(r.body).toMatchObject({schoolId:1,studentId:1,cardId:1,status:"locked"});
  expect((await q("SELECT student_id,status,last_device_id,activated_at FROM nfc_cards WHERE id=1")).rows[0]).toEqual({student_id:1,status:"locked",last_device_id:null,activated_at:null});
  expect((await q("SELECT actor_user_id,metadata FROM audit_logs WHERE event_type='PARTNER_NFC_CARD_ASSIGNED'")).rows[0]).toMatchObject({actor_user_id:2,metadata:{actorType:"Partner",partnerId:1,studentId:1,permissionEnabled:true,activeDeviceCount:1,unlocked:false}});
  expect((await q("SELECT actor_user_id,new_status FROM nfc_card_history")).rows[0]).toEqual({actor_user_id:2,new_status:"locked"});
  expect((await assign(2)).status).toBe(409);expect((await assign(1,"NATIVE-CARD-2")).status).toBe(409);expect((await assign(2,"UNKNOWN-CARD")).status).toBe(404);
});
test("lost/revoked/blocked/replaced/expired and existing prepared student retain lifecycle protection",async()=>{
  for(const status of ["lost","blocked","replaced","expired","suspended"]){
    await q("UPDATE nfc_cards SET status=$1 WHERE id=1",[status]);expect((await assign()).status).toBe(409);
  }
  await q("UPDATE nfc_cards SET status='lost',student_id=1 WHERE id=1");expect((await assign(1,"NATIVE-CARD-2")).status).toBe(409);
});
test("explicit staff authorization is capped; staff/Admin cannot self-elevate; actual staff audited",async()=>{
  expect((await assign(1,"NATIVE-CARD-1",{user:4})).status).toBe(403);
  expect((await call("/partner/staff/4/nfc-permission",{enabled:true},{method:"PATCH"})).status).toBe(200);
  for(const user of [4,5,6])expect((await call(`/partner/staff/${user}/nfc-permission`,{enabled:true},{user,method:"PATCH"})).status).toBe(403);
  expect((await assign(1,"NATIVE-CARD-1",{user:4})).status).toBe(201);
  expect((await q("SELECT actor_user_id,metadata FROM audit_logs WHERE event_type='PARTNER_NFC_CARD_ASSIGNED'")).rows[0]).toMatchObject({actor_user_id:4,metadata:{actorType:"Partner Staff"}});
  expect((await owner("/partners/1/nfc-permission",{enabled:false})).status).toBe(200);
  expect((await call("/partner/nfc/access",undefined,{user:4})).body.enabled).toBe(false);
  expect((await assign(2,"NATIVE-CARD-2",{user:4})).status).toBe(403);
  expect((await q("SELECT student_id,status FROM nfc_cards WHERE id=1")).rows[0]).toEqual({student_id:1,status:"locked"});
});
test("denials use existing Security/DENIED audit framework",async()=>{
  await q("UPDATE partner_profiles SET nfc_activation_enabled=false WHERE id=1");expect((await assign()).status).toBe(403);
  for(let n=0;n<10;n++){const r=await q("SELECT actor_user_id,result FROM audit_logs WHERE module='Security'");if(r.rows.length){expect(r.rows[0]).toEqual({actor_user_id:2,result:"DENIED"});return;}await new Promise(r=>setTimeout(r,20));}throw new Error("No security audit");
});
test("concurrent cards for same student and same UID for different students serialize",async()=>{
  const results=await Promise.all([assign(1,"NATIVE-CARD-1"),assign(1,"NATIVE-CARD-2")]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  await q("DELETE FROM nfc_card_history;DELETE FROM audit_logs;UPDATE nfc_cards SET student_id=NULL,status='unassigned' WHERE id IN (1,2)");
  const again=await Promise.all([assign(1),assign(2)]);expect(again.map(r=>r.status).sort()).toEqual([201,409]);
});
test("concurrent permission revoke and reader deactivation cannot commit ahead of a locked assignment",async()=>{
  const c=await state.db.connect();try{
    await c.query("BEGIN");
    const req:any={edupulseUser:{user:{id:2,status:"ACTIVE"},roles:[{role:"PARTNER",status:"ACTIVE",schoolId:null}]}};
    await partnerNfcSchool(req,1,c,true);
    let revoked=false,removed=false;
    const revoke=owner("/partners/1/nfc-permission",{enabled:false}).then(r=>{revoked=true;return r;});
    const removal=q("UPDATE platform_devices SET status='INACTIVE' WHERE id=1").then(()=>{removed=true;});
    await new Promise(r=>setTimeout(r,100));expect(revoked).toBe(false);expect(removed).toBe(false);
    await assignAvailableStudentCard(c,{schoolId:1,studentId:1,cardNumber:"NATIVE-CARD-1",allowCreate:false});await c.query("COMMIT");
    expect((await revoke).status).toBe(200);await removal;expect((await assign(2,"NATIVE-CARD-2")).status).toBe(403);
    expect((await q("SELECT student_id,status FROM nfc_cards WHERE id=1")).rows[0]).toEqual({student_id:1,status:"locked"});
  }finally{await c.query("ROLLBACK");c.release();}
});
test("Owner prepared assignment uses shared lifecycle; School Admin and Partner cannot use Owner route",async()=>{
  for(const role of ["PARTNER","SCHOOL_ADMIN"])expect((await call("/cards/1/reassign",{studentId:1},{role,user:2,method:"PATCH"})).status).toBe(403);
  const r=await call("/cards/1/reassign",{studentId:1},{role:"PLATFORM_OWNER",user:1,method:"PATCH"});expect(r.status).toBe(200);expect(r.body.status).toBe("locked");
  const created=await call("/cards?schoolId=1",{uid:"NATIVE-NEW-OWNER-CARD",studentId:2},{role:"PLATFORM_OWNER",user:1});expect(created.status).toBe(201);expect(created.body.status).toBe("locked");
});
test("NFC permission never grants Partner/staff device linking, management or credentials",async()=>{
  await q("UPDATE partner_profile_users SET nfc_activation_enabled=true WHERE id=1");
  for(const user of [2,4]){
    for(const path of ["/platform/devices/1/assign","/platform/devices/1/credentials","/platform/devices/1/suspend","/platform/devices"]){
      expect((await call(path,{schoolId:2},{user})).status).toBe(403);
    }
  }
  expect((await q("SELECT school_id,status FROM platform_devices WHERE id=1")).rows[0]).toEqual({school_id:1,status:"ACTIVE"});
});
test("internal officer lifecycle mode retains active cards and selected reader audit context",async()=>{
  const c=await state.db.connect();try{
    await c.query("BEGIN");
    const r=await assignAvailableStudentCard(c,{schoolId:1,studentId:1,cardNumber:"NATIVE-CARD-1",activate:true,deviceId:1});
    expect(r.card.status).toBe("active");expect(r.card.activatedAt).not.toBeNull();
    await c.query("COMMIT");expect((await q("SELECT last_device_id FROM nfc_cards WHERE id=1")).rows[0].last_device_id).toBe(1);
  }finally{await c.query("ROLLBACK");c.release();}
});
test("unchanged scan predicate inherits every current same-school reader and excludes other school; new reader needs no card reassignment",async()=>{
  await assign();expect((await q(studentNfcCardLookupSql,["NATIVE-CARD-1",1])).rows).toHaveLength(0);
  // Simulate pre-existing lawful Owner/lifecycle activation; Partner did not unlock.
  await q("UPDATE nfc_cards SET status='active',activated_at=NOW() WHERE id=1");
  expect((await q(studentNfcCardLookupSql,["NATIVE-CARD-1",1])).rows).toHaveLength(1);
  expect((await q(studentNfcCardLookupSql,["NATIVE-CARD-1",2])).rows).toHaveLength(0);
  await q(`INSERT INTO platform_devices(id,serial_number,name,device_type,status,configuration_status,school_id)
    VALUES(3,'PARTNER-NATIVE-DEV3','Native new reader','HYBRID','ACTIVE','CONFIGURED',1);
    INSERT INTO device_school_bindings(device_id,school_id) VALUES(3,1);`);
  expect((await q(activeSchoolNfcDevicesSql,[1])).rows).toHaveLength(2);
  expect((await q("SELECT student_id,school_id,uid FROM nfc_cards WHERE id=1")).rows[0]).toEqual({student_id:1,school_id:1,uid:"NATIVE-CARD-1"});
  expect((await assign(2,"NATIVE-CARD-2")).status).toBe(201);
  expect((await q("SELECT metadata FROM audit_logs WHERE event_type='PARTNER_NFC_CARD_ASSIGNED' ORDER BY id DESC LIMIT 1")).rows[0].metadata.activeDeviceCount).toBe(2);
});
