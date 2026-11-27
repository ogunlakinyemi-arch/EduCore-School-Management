import {beforeEach,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({queued:[] as any[],saved:[] as any[],fee:null as any,eligible:true}));
vi.mock("@workspace/db",()=>({pool:{query:()=>{throw Error("Application database access forbidden");}}}));
vi.mock("./communication-service",()=>({queueCommunicationNotification:vi.fn(async(_c:any,input:any)=>{
 f.queued.push(input);f.saved.push(input);return f.saved.length;
})}));
vi.mock("./student-platform-rollout",async original=>({...await original<any>(),readStudentUsageRollout:vi.fn(async()=>({chargeable:false}))}));
vi.mock("./subscription-enforcement",()=>({readSchoolSubscription:vi.fn()}));
vi.mock("./staff-subscription-access",()=>({readStaffSubscriptionAccess:vi.fn()}));
import {queueWeeklyFinancialReminders} from "./financial-reminder-worker";
import {feeReminderDigest,financialReminderStillCurrent,guardianSchoolFeeSql,staffNfcReminderSnapshot} from "./financial-reminder-eligibility";
import {readStaffSubscriptionAccess} from "./staff-subscription-access";
import {financialReminderScope,financialReminderChannels} from "./financial-reminder-policy";
import {defaultNotificationPolicy,financialReminderSelectedChannels} from "./notification-channel-policy";
import {smsNotificationAllowed,smsEventAllowed} from "./sms-event-policy";
const row=(school=1)=>({id:44,schoolId:school,studentId:71,termId:9,number:"SCHOOL-44",due:"2027-01-01",
 total:900000,paid:200000,outstanding:700000,discount:0,waiver:0,currency:"NGN",status:"PARTIALLY_PAID",
 schoolName:"Fictional school",studentName:"Fictional child",recipientUserId:4});
beforeEach(()=>{f.queued=[];f.saved=[];f.fee=row();f.eligible=true;});
function fakePool(){
 const statements:string[]=[];
 const query=vi.fn(async(sql:string,v:any[]=[])=>{
  statements.push(sql);
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{held:true}]};
  if(sql.includes("SELECT id,name FROM schools"))return {rows:[{id:1,name:"Fictional school"}]};
  if(sql===guardianSchoolFeeSql)return {rows:f.eligible?[f.fee]:[]};
  if(sql.includes("SELECT 1 FROM communication_notifications"))return {rows:f.saved.filter(r=>
   r.schoolId===v[0]&&r.recipientUserId===v[1]&&r.eventKey.startsWith(v[2].slice(0,-1)))};
  return {rows:[]};
 });
 const release=vi.fn();return {pool:{connect:async()=>({query,release})} as any,statements,query,release};
}
it("queues guardians' real school balance on Monday, never student remittance or BRO amounts",async()=>{
 const {pool}=fakePool();
 expect(await queueWeeklyFinancialReminders(pool,new Date("2027-01-25T08:00:00Z"))).toEqual({queued:1});
 expect(f.queued[0]).toMatchObject({schoolId:1,recipientUserId:4,subjectStudentId:71,category:"FINANCE",
  link:"/parent/fees/71",useSchoolDefaults:false,channels:[...financialReminderChannels]});
 expect(f.queued[0].body).toContain("₦7,000");expect(f.queued[0].body).toContain("due 2027-01-01");
 expect(f.queued[0].body).not.toMatch(/3,200|₦150|BRO|platform|remittance|commission/i);
});
it("does not duplicate after another tick or a same-day partial payment; Friday is separate",async()=>{
 const {pool}=fakePool(),monday=new Date("2027-01-25T08:00:00Z");
 await queueWeeklyFinancialReminders(pool,monday);await queueWeeklyFinancialReminders(pool,monday);
 f.fee={...f.fee,paid:300000,outstanding:600000};
 await queueWeeklyFinancialReminders(pool,monday);expect(f.queued).toHaveLength(1);
 await queueWeeklyFinancialReminders(pool,new Date("2027-01-29T08:00:00Z"));expect(f.queued).toHaveLength(2);
});
it("does no database work on other days and queues no paid/ineligible recipient",async()=>{
 const p=fakePool(),connect=vi.spyOn(p.pool,"connect");
 await queueWeeklyFinancialReminders(p.pool,new Date("2027-01-26T08:00:00Z"));expect(connect).not.toHaveBeenCalled();
 f.eligible=false;await queueWeeklyFinancialReminders(p.pool,new Date("2027-01-25T08:00:00Z"));
 expect(f.queued).toHaveLength(0);
});
it("uses one transaction and releases its client on a producer error",async()=>{
 const p=fakePool();p.query.mockRejectedValueOnce(Error("fictional query failure"));
 await expect(queueWeeklyFinancialReminders(p.pool,new Date("2027-01-25T08:00:00Z"))).rejects.toThrow("fictional");
 expect(p.statements).toContain("ROLLBACK");expect(p.release).toHaveBeenCalledTimes(1);
});
it("revalidates balance, child, term, guardian/school and day before sending",async()=>{
 const record={eventKey:financialReminderScope("2027-01-25","FEE",44,9)+feeReminderDigest(f.fee),
  schoolId:1,recipientUserId:4,subjectStudentId:71};
 const query=vi.fn(async(_sql:string,values:any[])=>({rows:f.eligible&&values[0]===1&&values[3]===4?[f.fee]:[]}));
 const db={query},now=new Date("2027-01-25T10:00:00Z");
 expect(await financialReminderStillCurrent(db,record,now)).toBe(true);
 f.fee={...f.fee,outstanding:100};expect(await financialReminderStillCurrent(db,record,now)).toBe(false);
 f.fee=row();f.eligible=false;expect(await financialReminderStillCurrent(db,record,now)).toBe(false);
 f.eligible=true;expect(await financialReminderStillCurrent(db,{...record,schoolId:2},now)).toBe(false);
 expect(await financialReminderStillCurrent(db,{...record,subjectStudentId:72},now)).toBe(false);
 expect(await financialReminderStillCurrent(db,record,new Date("2027-01-26T10:00:00Z"))).toBe(false);
 expect(guardianSchoolFeeSql).toMatch(/outstanding_minor>0/);expect(guardianSchoolFeeSql).toMatch(/rel.status/);
 expect(guardianSchoolFeeSql).toMatch(/published_by IS NOT NULL/);
});
it("ignores school campaign switches but preserves Owner ceilings and narrow SMS scope",()=>{
 const policy=defaultNotificationPolicy();policy.schools["1"]={enabled:false,allowed:[]};
 expect(financialReminderSelectedChannels(policy,"FINANCE")).toEqual([...financialReminderChannels]);
 policy.events.FINANCE!.allowed=["IN_APP"];
 expect(financialReminderSelectedChannels(policy,"FINANCE")).toEqual(["IN_APP"]);
 const key=financialReminderScope("2027-01-25","FEE",44,9)+feeReminderDigest(row());
 expect(smsNotificationAllowed("FINANCE",key,71)).toBe(true);
 expect(smsNotificationAllowed("FINANCE","ORDINARY_FINANCE:44",71)).toBe(false);
 expect(smsEventAllowed("FINANCIAL_WEEKLY")).toBe(true);expect(smsEventAllowed("FINANCE")).toBe(false);
});
it("cancels employee reminders after payment, deactivation or an independent Owner lock",async()=>{
 let locked=false,employed=true;
 const db={query:vi.fn(async(sql:string)=>{
  if(sql.includes("FROM employees"))return {rows:employed?[{id:8}]:[]};
  if(sql.includes("school_subscription_manual_locks"))return {rows:[{schoolLocked:locked}]};
  if(sql.includes("FROM schools"))return {rows:[{id:1}]};
  return {rows:[]};
 })};
 const staff=vi.mocked(readStaffSubscriptionAccess);
 const access={schoolId:1,restricted:true,status:"UNPAID" as const,termId:9,subscriptionId:12,priceMinor:200000,renewalPath:"/my-nfc-subscription"};
 staff.mockResolvedValue(access);
 const digest=await staffNfcReminderSnapshot(db,1,8,9,4);
 expect(digest).toMatch(/^[a-f0-9]{64}$/);
 const record={schoolId:1,recipientUserId:4,subjectStudentId:null,
  eventKey:financialReminderScope("2027-01-25","STAFF_NFC",8,9)+digest},now=new Date("2027-01-25T10:00:00Z");
 expect(await financialReminderStillCurrent(db,record,now)).toBe(true);
 staff.mockResolvedValue({...access,status:"PAID",restricted:false});
 expect(await financialReminderStillCurrent(db,record,now)).toBe(false);
 staff.mockResolvedValue(access);employed=false;
 expect(await financialReminderStillCurrent(db,record,now)).toBe(false);
 employed=true;locked=true;staff.mockClear();
 expect(await financialReminderStillCurrent(db,record,now)).toBe(false);
 expect(staff).not.toHaveBeenCalled();
});
