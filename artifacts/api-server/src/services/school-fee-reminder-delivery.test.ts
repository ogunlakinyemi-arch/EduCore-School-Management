import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{query:()=>{throw Error("Application database forbidden");}}}));
import {queueCommunicationNotification,dispatchCommunicationDeliveries} from "./communication-service";
import {defaultNotificationPolicy} from "./notification-channel-policy";
import {feeReminderDigest,guardianSchoolFeeSql} from "./financial-reminder-eligibility";
import {financialReminderChannels,financialReminderScope} from "./financial-reminder-policy";

const now=()=>new Date("2027-01-25T08:00:00Z");
const row=()=>({id:44,schoolId:9,studentId:321,termId:7,number:"FICTIONAL-44",due:"2026-10-01",
 total:85000,paid:25000,outstanding:60000,discount:10000,waiver:5000,currency:"NGN",
 status:"PARTIALLY_PAID",schoolName:"Fictional school",studentName:"Linked child",recipientUserId:17});
function input(){
 return {schoolId:9,recipientUserId:17,subjectStudentId:321,category:"FINANCE" as const,
  subject:"School payment reminder",body:"Fictional linked child's original invoice has ₦600 outstanding.",
  link:"/parent/fees/321",eventKey:financialReminderScope("2027-01-25","FEE",44,7)+feeReminderDigest(row()),
  channels:[...financialReminderChannels],useSchoolDefaults:false};
}
function fixture(){
 const f={live:row() as any,preferences:[] as {channel:string;enabled:boolean}[],policy:defaultNotificationPolicy(),
  authorized:true,claimed:false,calls:[] as {sql:string;values:any[]}[]};
 const query=vi.fn(async(sql:string,values:any[]=[])=>{
  f.calls.push({sql,values});
  if(sql.startsWith(guardianSchoolFeeSql))return {rows:f.live?[f.live]:[]};
  if(sql.includes("FROM audit_logs"))return {rows:[{policy:f.policy}]};
  if(sql.includes("SELECT communication_defaults"))return {rows:[{defaults:{FINANCE:[]}}]};
  if(sql.includes("SELECT u.id")&&sql.includes("FROM app_users u"))return {rows:f.authorized?[{id:17,isParent:true}]:[]};
  if(sql.includes("FROM students subject")&&!sql.includes("FROM communication_deliveries d"))return {rows:f.authorized?[{id:321}]:[]};
  if(sql.includes("FROM communication_preferences"))return {rows:f.preferences.filter(p=>!/channel\s*=\s*'SMS'/.test(sql)||p.channel==="SMS")};
  if(sql.includes("INSERT INTO communication_notifications"))return {rows:[{id:51}]};
  if(sql.includes("RETURNING d.id, d.channel, d.attempts")){
   if(f.claimed||!values[3]?.includes("SMS"))return {rows:[]};f.claimed=true;return {rows:[{id:42,channel:"SMS",attempts:1}]};
  }
  if(sql.includes("FROM communication_deliveries d"))return {rows:[{...input(),id:42,notificationId:51,
   subjectClassId:null,channel:"SMS",phone:"+2348000000000",email:"fixture@example.invalid",
   schoolAuthorized:f.authorized,userStatus:"ACTIVE"}]};
  return {rows:[]};
 });
 const pool={query,connect:async()=>({query,release:vi.fn()})} as any;
 const send=vi.fn(async()=>({provider:"fictional-no-network",channel:"sms" as const,status:"SIMULATED" as const,
  accepted:false,delivered:false}));
 const providers={sms:{provider:"fictional-no-network",channel:"sms" as const,send},
  email:{provider:"fictional-email",channel:"email" as const,send:vi.fn()}};
 const channels=()=>f.calls.filter(c=>c.sql.includes("INSERT INTO communication_deliveries"))
  .map(c=>c.sql.includes("'IN_APP'")?"IN_APP":c.values[1]);
 return {f,pool,providers,send,channels};
}
beforeEach(()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now());vi.stubEnv("REPLIT_DEPLOYMENT","");
 vi.stubEnv("COMMUNICATION_SMS_PROVIDER","bulksmsnigeria");
 vi.stubEnv("BULKSMSNIGERIA_API_TOKEN","synthetic-unit-token");vi.stubEnv("BULKSMSNIGERIA_SENDER_ID","FixtureSMS");
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it.each([true,false,undefined])("keeps each recipient's SMS consent and optional-channel opt-outs for fee reminders: %s",async consent=>{
 const t=fixture();
 t.f.preferences=[{channel:"EMAIL",enabled:false},{channel:"TELEGRAM",enabled:false},
  ...(consent===undefined?[]:[{channel:"SMS",enabled:consent}])];
 await queueCommunicationNotification(t.pool,input());
 expect(t.channels()).toEqual(consent?["IN_APP","PUSH","SMS"]:["IN_APP","PUSH"]);
 expect(t.send).not.toHaveBeenCalled();
});
it("retains the Owner channel ceiling even for the fixed financial schedule",async()=>{
 const t=fixture();t.f.policy.events.FINANCE={allowed:["IN_APP"],defaults:["IN_APP"]};
 t.f.preferences=[{channel:"SMS",enabled:true}];
 await queueCommunicationNotification(t.pool,input());
 expect(t.channels()).toEqual(["IN_APP"]);
});
it("does not persist a fee notification for a child/recipient who lost authorization",async()=>{
 const t=fixture();t.f.authorized=false;
 expect(await queueCommunicationNotification(t.pool,input())).toBeNull();
 expect(t.channels()).toEqual([]);
});
it.each(["paid","balance changed","relationship removed","other child","authorization removed","next WAT day"] as const)
 ("cancels a queued fee reminder before any provider call when %s",async change=>{
 const t=fixture();t.f.preferences=[{channel:"SMS",enabled:true}];
 if(change==="paid")t.f.live={...row(),status:"PAID",outstanding:0,paid:85000};
 if(change==="balance changed")t.f.live={...row(),outstanding:50000,paid:35000};
 if(change==="relationship removed")t.f.live=null;
 if(change==="other child")t.f.live={...row(),studentId:999};
 if(change==="authorization removed")t.f.authorized=false;
 const summary=await dispatchCommunicationDeliveries(t.pool,5,{providers:t.providers,
  now:()=>change==="next WAT day"?new Date("2027-01-25T23:00:00Z"):now()});
 expect(summary.skipped).toBe(1);expect(t.send).not.toHaveBeenCalled();
});
it("stops queued fee SMS if the recipient withdraws consent",async()=>{
 const t=fixture();t.f.preferences=[{channel:"SMS",enabled:false}];
 expect((await dispatchCommunicationDeliveries(t.pool,5,{providers:t.providers,now})).skipped).toBe(1);
 expect(t.send).not.toHaveBeenCalled();
 expect(t.f.calls.some(c=>c.sql.includes("SMS requires an approved event and explicit recipient consent"))).toBe(true);
});
it("routes a fresh authorized and consented fee reminder through the existing engine to a no-network adapter only",async()=>{
 const t=fixture();t.f.preferences=[{channel:"SMS",enabled:true}];
 const result=await dispatchCommunicationDeliveries(t.pool,5,{providers:t.providers,now});
 expect(t.send).toHaveBeenCalledTimes(1);
 expect(result).toMatchObject({simulated:1,accepted:0,delivered:0});
});
it("leaves unavailable SMS unclaimed instead of attempting or exhausting it",async()=>{
 const t=fixture();vi.stubEnv("BULKSMSNIGERIA_API_TOKEN","");
 expect((await dispatchCommunicationDeliveries(t.pool,5,{providers:t.providers,now})).claimed).toBe(0);
 expect(t.send).not.toHaveBeenCalled();
});
it("does not claim fee reminders while the existing launch hold applies, even with an injected adapter",async()=>{
 const t=fixture();vi.stubEnv("NODE_ENV","production");vi.stubEnv("EDUCORE_NOTIFICATION_LIVE_FROM","");
 expect((await dispatchCommunicationDeliveries(t.pool,5,{providers:t.providers,now})).claimed).toBe(0);
 expect(t.f.calls).toEqual([]);expect(t.send).not.toHaveBeenCalled();
});
