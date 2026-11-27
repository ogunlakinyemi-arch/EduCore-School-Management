import {afterEach,beforeEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({
 start:"2027-01-18",free:false,excluded:false,available:true,authorized:true,statusOverride:null as string|null,
 finance:[] as number[],employees:[] as {id:number;userId:number}[],
 guardians:[{studentId:71,schoolId:1,recipientUserId:4}],
 notifications:[] as any[],deliveries:new Set<string>(),calls:[] as {sql:string;v:any[]}[],
 preferences:[] as any[],policy:null as any,beforeQueue:null as null|(()=>void),dispatch:null as any,
 claimed:false,holdLock:false,
}));
vi.mock("@workspace/db",()=>({pool:{query:()=>{throw Error("Application database forbidden");}}}));
vi.mock("./student-platform-rollout",async original=>{
 const real=await original<any>();
 return {...real,readStudentUsageRollout:vi.fn(async(_db:any,schoolId:number,_term?:number,today=real.lagosDate())=>{
  const r=real.studentRolloutDecision([{id:9,schoolId:1,name:"Any school term",startDate:f.start,
   endDate:"2027-04-30",isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"}],schoolId,undefined,today);
  return f.free?{...r,chargeable:false,freeAccess:true}:r;
 })};
});
vi.mock("./subscription-enforcement",()=>({readSchoolSubscription:vi.fn(async()=>({
 termId:9,status:f.statusOverride??(f.available?"OVERDUE":"UNAVAILABLE"),inGracePeriod:false,
 restrictedStudentIds:f.excluded?[]:[71],studentsAffected:f.excluded?0:1,outstandingMinor:f.excluded?0:320000,
}))}));
vi.mock("./staff-subscription-access",()=>({readStaffSubscriptionAccess:vi.fn(async()=>({
 termId:9,restricted:true,status:"UNPAID",priceMinor:200000,subscriptionId:81,
}))}));
vi.mock("./telegram-delivery-continuity",async original=>({...await original<any>(),
 missingTelegramDestination:vi.fn(async()=>"TELEGRAM_WAITING_FOR_LINK")}));
import {queueWeeklyFinancialReminders} from "./financial-reminder-worker";
import {financialReminderStillCurrent,guardianNfcReminderSnapshot,guardianStudentNfcSql} from "./financial-reminder-eligibility";
import {financialReminderScope,guardianNfcReminderContent,financialReminderChannels,parseFinancialReminder} from "./financial-reminder-policy";
import {defaultNotificationPolicy,notificationEvent} from "./notification-channel-policy";
import {queueCommunicationNotification,dispatchCommunicationDeliveries} from "./communication-service";
import {smsNotificationAllowed} from "./sms-event-policy";
const monday=()=>new Date("2027-01-25T08:00:00Z");
const forbidden=/₦|\bNGN\b|\bnaira\b|3,?200|\bBRO\b|commission|remittance|revenue|ledger|platform|Yetenia|https?:\/\/|\/(?:finance|fees|payments?|checkout)\b/i;

beforeEach(()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(monday());
 vi.stubEnv("NODE_ENV","test");vi.stubEnv("REPLIT_DEPLOYMENT","");
 vi.stubEnv("COMMUNICATION_SMS_PROVIDER","bulksmsnigeria");
 vi.stubEnv("BULKSMSNIGERIA_API_TOKEN","synthetic-unit-token");vi.stubEnv("BULKSMSNIGERIA_SENDER_ID","FixtureSMS");
 Object.assign(f,{start:"2027-01-18",free:false,excluded:false,available:true,authorized:true,statusOverride:null,finance:[],employees:[],
  guardians:[{studentId:71,schoolId:1,recipientUserId:4}],notifications:[],deliveries:new Set(),calls:[],
  preferences:[],policy:defaultNotificationPolicy(),beforeQueue:null,dispatch:null,claimed:false,holdLock:false});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function poolFixture(){
 const query=vi.fn(async(sql:string,v:any[]=[])=>{
  f.calls.push({sql,v});
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{held:!f.holdLock}]};
  if(sql.includes("SELECT id,name FROM schools"))return {rows:[{id:1,name:"School with private accounts"}]};
  if(sql.startsWith(guardianStudentNfcSql)){
   const scoped=f.authorized?f.guardians.filter(g=>g.schoolId===v[0]&&
    (v.length===1||(g.studentId===v[1]&&g.recipientUserId===v[2]))):[];
   return {rows:scoped};
  }
  if(sql.startsWith("SELECT 1 FROM communication_notifications")){
   f.beforeQueue?.();f.beforeQueue=null;
   return {rows:f.notifications.filter(n=>n.schoolId===v[0]&&n.recipientUserId===v[1]&&n.eventKey.startsWith(v[2].slice(0,-1)))};
  }
  if(sql.includes("RETURNING d.id, d.channel, d.attempts")){
   if(f.claimed||!f.dispatch)return {rows:[]};
   f.claimed=true;return {rows:[{id:42,channel:f.dispatch.channel,attempts:1}]};
  }
  if(sql.includes("FROM communication_deliveries d"))return {rows:f.dispatch?[f.dispatch]:[]};
  if(sql.includes("SELECT u.id")&&sql.includes("FROM app_users u"))return {rows:f.authorized?[{id:v[0],isParent:f.guardians.some(g=>g.recipientUserId===v[0])}]:[]};
  if(sql.includes("FROM students subject"))return {rows:f.authorized?[{id:71}]:[]};
  if(sql.startsWith("SELECT id FROM schools"))return {rows:v[0]===1?[{id:1}]:[]};
  if(sql.startsWith("SELECT 1 FROM school_memberships"))return {rows:v[1]===1&&f.finance.includes(v[0])?[{id:1}]:[]};
  if(sql.startsWith("SELECT DISTINCT m.user_id"))return {rows:f.finance.map(id=>({id}))};
  if(sql.startsWith("SELECT e.id,e.user_id"))return {rows:f.employees};
  if(sql.startsWith("SELECT id FROM employees"))return {rows:f.employees.filter(e=>e.id===v[0]&&v[1]===1&&e.userId===v[2])};
  if(sql.includes("INSERT INTO communication_notifications")){
   const [recipientUserId,schoolId,subjectStudentId,subjectClassId,category,eventKey,subject,body,link]=v;
   if(f.notifications.some(n=>n.schoolId===schoolId&&n.recipientUserId===recipientUserId&&n.eventKey===eventKey))return {rows:[]};
   const n={id:f.notifications.length+1,recipientUserId,schoolId,subjectStudentId,subjectClassId,category,eventKey,subject,body,link};
   f.notifications.push(n);return {rows:[{id:n.id}]};
  }
  if(sql.includes("INSERT INTO communication_deliveries")){
   f.deliveries.add(`${v[0]}:${sql.includes("'IN_APP'")?"IN_APP":v[1]}`);return {rows:[]};
  }
  if(sql.includes("FROM audit_logs"))return {rows:[{policy:f.policy}]};
  if(sql.includes("SELECT communication_defaults"))return {rows:[{defaults:{}}]};
  if(sql.includes("FROM communication_preferences"))return {rows:sql.includes("channel='SMS'")?
   f.preferences.filter(p=>p.channel==="SMS"||p.channel===undefined):f.preferences};
  return {rows:[]};
 });
 return {query,connect:async()=>({query,release:vi.fn()})} as any;
}
async function notice(pool=poolFixture()){
 const digest=await guardianNfcReminderSnapshot(pool,1,71,9,4);
 return {...guardianNfcReminderContent,schoolId:1,recipientUserId:4,subjectStudentId:71,subjectClassId:null,
  eventKey:financialReminderScope("2027-01-25","GUARDIAN_NFC",71,9)+digest,
  channels:[...financialReminderChannels],useSchoolDefaults:false};
}
it("queues a non-financial guardian notice at D+7 through the real queue without changing fees",async()=>{
 const pool=poolFixture();
 expect(await queueWeeklyFinancialReminders(pool,monday())).toEqual({queued:1});
 expect(f.notifications[0]).toMatchObject({...guardianNfcReminderContent,subjectStudentId:71,recipientUserId:4});
 expect(parseFinancialReminder(f.notifications[0].eventKey)).toMatchObject({kind:"GUARDIAN_NFC",entity:71,term:9,day:"2027-01-25"});
 expect(f.notifications[0].eventKey).toMatch(/^GUARDIAN_NFC_WEEKLY:/);
 expect(JSON.stringify(f.notifications)).not.toMatch(forbidden);
 expect([...f.deliveries].map(x=>x.split(":")[1]).sort()).toEqual(["EMAIL","IN_APP","PUSH","TELEGRAM"]);
 expect(f.calls.some(c=>/\b(?:INSERT INTO|UPDATE) fee_/.test(c.sql))).toBe(false);
});
it.each([0,1,2,3,4,5,6])("rejects grace day D+%s using that school's saved start",async day=>{
 f.start=new Date(Date.parse("2027-01-25T00:00:00Z")-day*86400000).toISOString().slice(0,10);
 const pool=poolFixture();
 expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
 expect(await queueWeeklyFinancialReminders(pool,monday())).toEqual({queued:0});
});
it("requires the child's own school and term, not another school's expired grace",async()=>{
 const pool=poolFixture();
 expect(await guardianNfcReminderSnapshot(pool,2,71,9,4)).toBeNull();
 expect(await guardianNfcReminderSnapshot(pool,1,71,10,4)).toBeNull();
 f.start="2027-01-25";expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
});
it.each(["PAID","WAIVED","VOIDED","CREDITED","OTHERWISE_NOT_OUTSTANDING"])("suppresses canonical entitlement exclusion %s",async()=>{
 // The canonical reader owns these decisions; the reminder never interprets
 // a payment/waiver itself or creates a new entitlement calculation.
 f.excluded=true;const pool=poolFixture();
 expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
 await queueWeeklyFinancialReminders(pool,monday());expect(f.notifications).toHaveLength(0);
});
it.each(["PAID","WAIVED","VOIDED","CREDITED","NOT_REQUIRED","UNAVAILABLE"])("fails closed on %s even with stale restricted IDs",async status=>{
 f.statusOverride=status;
 expect(await guardianNfcReminderSnapshot(poolFixture(),1,71,9,4)).toBeNull();
});
it("suppresses a granted free term and unavailable entitlement evidence",async()=>{
 const pool=poolFixture();f.free=true;
 expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
 f.free=false;f.available=false;
 expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
});
it("checks active guardian, role, relationship, account, school and child scope",async()=>{
 const pool=poolFixture();
 expect(await guardianNfcReminderSnapshot(pool,1,71,9,5)).toBeNull();
 expect(await guardianNfcReminderSnapshot(pool,1,72,9,4)).toBeNull();
 f.authorized=false;expect(await guardianNfcReminderSnapshot(pool,1,71,9,4)).toBeNull();
 expect(guardianStudentNfcSql).toMatch(/rel.status\)='ACTIVE'/);
 expect(guardianStudentNfcSql).toMatch(/p.status\)='ACTIVE'/);
 expect(guardianStudentNfcSql).toMatch(/u.status\)='ACTIVE'/);
 expect(guardianStudentNfcSql).toMatch(/guardian_role.role='PARENT'/);
 expect(guardianStudentNfcSql).toMatch(/guardian_role.status\)='ACTIVE'/);
 expect(guardianStudentNfcSql).toMatch(/st.school_id/);
 expect(guardianStudentNfcSql).not.toMatch(/amount|invoice|ledger|remittance/i);
});
it.each(["authorization","entitlement"])("rechecks %s between selection and insertion",async changed=>{
 const pool=poolFixture();f.beforeQueue=()=>{if(changed==="authorization")f.authorized=false;else f.excluded=true;};
 await queueWeeklyFinancialReminders(pool,monday());expect(f.notifications).toHaveLength(0);
 expect(f.deliveries.size).toBe(0);
});
it("is idempotent per guardian/student/term/channel/day, with a separate Friday",async()=>{
 f.guardians.push({studentId:71,schoolId:1,recipientUserId:5});
 const pool=poolFixture();
 await queueWeeklyFinancialReminders(pool,monday());await queueWeeklyFinancialReminders(pool,monday());
 expect(f.notifications).toHaveLength(2);expect(f.deliveries.size).toBe(8);
 vi.setSystemTime(new Date("2027-01-29T08:00:00Z"));
 await queueWeeklyFinancialReminders(pool,new Date());expect(f.notifications).toHaveLength(4);
 expect(f.deliveries.size).toBe(16);
});
it("honors the existing advisory lock, other weekdays and WAT rollover",async()=>{
 const pool=poolFixture();f.holdLock=true;
 expect(await queueWeeklyFinancialReminders(pool,monday())).toEqual({queued:0});
 f.holdLock=false;
 expect(await queueWeeklyFinancialReminders(pool,new Date("2027-01-26T08:00:00Z"))).toEqual({queued:0});
 vi.setSystemTime(new Date("2027-01-24T23:05:00Z"));
 await queueWeeklyFinancialReminders(pool,new Date());
 expect(f.notifications[0].eventKey).toContain(":2027-01-25:");
});
it.each([true,false,undefined])("requires explicit SMS consent and keeps standard Push selected despite retired preference %s",async enabled=>{
 const pool=poolFixture();
 f.preferences=[{channel:"EMAIL",enabled:false},{channel:"PUSH",enabled:false},{channel:"TELEGRAM",enabled:false},
  ...(enabled===undefined?[]:[{channel:"SMS",enabled}])];
 await queueWeeklyFinancialReminders(pool,monday());
 expect([...f.deliveries].map(x=>x.split(":")[1]).sort()).toEqual(enabled?["IN_APP","PUSH","SMS"]:["IN_APP","PUSH"]);
});
it("retains Owner ceilings and the narrow scheduled NFC SMS purpose",async()=>{
 const pool=poolFixture();f.policy.events.NFC_REMINDER.allowed=["IN_APP"];f.policy.events.NFC_REMINDER.defaults=["IN_APP"];
 await queueWeeklyFinancialReminders(pool,monday());
 expect([...f.deliveries]).toEqual(["1:IN_APP"]);
 const n=f.notifications[0];
 expect(notificationEvent(n.category,n.eventKey)).toBe("NFC_REMINDER");
 expect(smsNotificationAllowed(n.category,n.eventKey,71)).toBe(true);
 expect(smsNotificationAllowed("FINANCE",n.eventKey,71)).toBe(false);
 expect(smsNotificationAllowed(n.category,n.eventKey,72)).toBe(false);
 expect(smsNotificationAllowed(n.category,"UNSCHEDULED_NFC",71)).toBe(false);
});
it("keeps guardian, internal finance and the teacher's own reminders separate",async()=>{
 f.finance=[7];f.employees=[{id:80,userId:8}];
 await queueWeeklyFinancialReminders(poolFixture(),monday());
 expect(f.notifications).toHaveLength(3);
 const guardian=f.notifications.find(n=>n.recipientUserId===4);
 const finance=f.notifications.find(n=>n.recipientUserId===7);
 const teacher=f.notifications.find(n=>n.recipientUserId===8);
 expect(guardian).toMatchObject({...guardianNfcReminderContent,subjectStudentId:71});
 expect(JSON.stringify(guardian)).not.toMatch(forbidden);
 expect(parseFinancialReminder(finance.eventKey)?.kind).toBe("STUDENT_NFC");
 expect(finance).toMatchObject({category:"FINANCE",subjectStudentId:null,link:"/finance"});
 expect(finance.body).toContain("remittance");
 expect(parseFinancialReminder(teacher.eventKey)?.kind).toBe("STAFF_NFC");
 expect(teacher).toMatchObject({recipientUserId:8,subjectStudentId:null,link:"/my-nfc-subscription"});
});
it.each([
 {body:"Please pay ₦3,200 to Yetenia; BRO commission ₦150"},
 {subject:"School remittance outstanding"},{link:"/finance"},{category:"FINANCE"},{subjectStudentId:72},{subjectClassId:10},
])("rejects financial or incorrectly scoped payloads before persistence %j",async mutation=>{
 const pool=poolFixture(),input=await notice(pool);
 expect(await queueCommunicationNotification(pool,{...input,...mutation} as any)).toBeNull();
 expect(f.notifications).toHaveLength(0);expect(f.deliveries.size).toBe(0);
});
it("rechecks scheduled day, free access, entitlement and guardian status on an existing notice",async()=>{
 const pool=poolFixture(),input=await notice(pool);
 expect(await financialReminderStillCurrent(pool,input)).toBe(true);
 f.excluded=true;expect(await financialReminderStillCurrent(pool,input)).toBe(false);
 f.excluded=false;f.authorized=false;expect(await financialReminderStillCurrent(pool,input)).toBe(false);
 f.authorized=true;f.free=true;expect(await financialReminderStillCurrent(pool,input)).toBe(false);
 f.free=false;
 expect(await financialReminderStillCurrent(pool,input,new Date("2027-01-26T08:00:00Z"))).toBe(false);
});
it.each(["SMS","EMAIL"] as const)("delivers only the fixed non-financial %s payload using a mock adapter",async channel=>{
 const pool=poolFixture(),input=await notice(pool);
 f.preferences=[{enabled:true}];
 f.dispatch={...input,id:42,channel,notificationId:1,email:"fixture@example.invalid",phone:"+2348011111111",
  schoolAuthorized:true,userStatus:"ACTIVE"};
 const send=vi.fn(async()=>({provider:"fixture",channel:channel.toLowerCase(),status:"ACCEPTED",accepted:true,delivered:false}));
 await dispatchCommunicationDeliveries(pool,1,{channels:[channel],providers:{
  sms:{provider:"fixture",channel:"sms",send},email:{provider:"fixture",channel:"email",send},
 } as any});
 expect(send).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(send.mock.calls)).not.toMatch(forbidden);
 expect((send.mock.calls[0] as any)[0].body).toBe(guardianNfcReminderContent.body);
});
it.each(["paid","guardian removed","tampered body"] as const)("cancels before transport when %s",async change=>{
 const pool=poolFixture(),input=await notice(pool);
 f.dispatch={...input,id:42,channel:"EMAIL",notificationId:1,email:"fixture@example.invalid",
  schoolAuthorized:true,userStatus:"ACTIVE"};
 if(change==="paid")f.excluded=true;
 if(change==="guardian removed")f.authorized=false;
 if(change==="tampered body")f.dispatch.body="Internal ledger: ₦3,200; remittance /finance";
 const send=vi.fn();
 await dispatchCommunicationDeliveries(pool,1,{channels:["EMAIL"],providers:{
  sms:{provider:"fixture",channel:"sms",send},email:{provider:"fixture",channel:"email",send},
 } as any});
 expect(send).not.toHaveBeenCalled();
 expect(f.calls.some(c=>c.v.includes("NFC_REMINDER_NO_LONGER_CURRENT"))).toBe(true);
});
