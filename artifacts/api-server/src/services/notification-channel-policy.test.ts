import {describe,it,expect,vi} from "vitest";
import {defaultNotificationPolicy,allowedNotificationChannels,notificationEvent,notificationChannelAvailability,
  loadNotificationPolicy,notificationPolicySchema} from "./notification-channel-policy";
import {queueCommunicationNotification} from "./communication-service";
function fixture(options:{policy?:unknown;choices?:Record<string,string[]>;consent?:boolean}={}){
  const deliveries:string[]=[];
  const db={query:vi.fn(async(sql:string,values?:unknown[])=>{
    if(sql.includes("FROM audit_logs"))return {rows:options.policy?[{policy:options.policy}]:[]};
    if(sql.includes("communication_defaults"))return {rows:[{defaults:options.choices??{}}]};
    if(sql.includes("FROM app_users u"))return {rows:[{id:17,isParent:false}]};
    if(sql.includes("INSERT INTO communication_notifications"))return {rows:[{id:51}]};
    if(sql.includes("FROM communication_preferences"))return {rows:[{channel:"SMS",enabled:options.consent!==false}]};
    if(sql.includes("INSERT INTO communication_deliveries"))deliveries.push(values?.[1] as string??"IN_APP");
    return {rows:[]};
  })};
  return {db:db as any,deliveries};
}
async function queue(f:ReturnType<typeof fixture>,category="FINANCE",eventKey="invoice:1"){
  await queueCommunicationNotification(f.db,{recipientUserId:17,schoolId:9,category:category as any,eventKey,
    subject:"Fictional fixture",body:"No real recipient or provider",link:null,channels:["IN_APP","SMS"],useSchoolDefaults:false});
}
describe("Owner notification channel governance",()=>{
  it.each(["FINANCE","PAYMENT","SUBSCRIPTION","NFC_REMINDER","ACADEMIC","ANNOUNCEMENT","SECURITY"])("blocks default SMS for %s",event=>{
    expect(allowedNotificationChannels(defaultNotificationPolicy(),event,9)).not.toContain("SMS");
  });
  it.each(["ATTENDANCE_ENTRY","ATTENDANCE_EXIT","ATTENDANCE_ABSENCE","EMERGENCY"])("keeps SMS disabled for %s",event=>{
    expect(allowedNotificationChannels(defaultNotificationPolicy(),event,9)).not.toContain("SMS");
  });
  it("maps gate entry/exit, absence, card/subscription and emergency events separately",()=>{
    expect(notificationEvent("SECURITY","PARENT_EVENT:SECURITY_ENTRY:1")).toBe("ATTENDANCE_ENTRY");
    expect(notificationEvent("SECURITY","PARENT_EVENT:SECURITY_EXIT:1")).toBe("ATTENDANCE_EXIT");
    expect(notificationEvent("ATTENDANCE","attendance:1:ABSENT")).toBe("ATTENDANCE_ABSENCE");
    expect(notificationEvent("FINANCE","NFC_CARD_REMINDER:1")).toBe("NFC_REMINDER");
    expect(notificationEvent("SUBSCRIPTION","subscription:1")).toBe("SUBSCRIPTION");
    expect(notificationEvent("ANNOUNCEMENT","campaign:1:EMERGENCY")).toBe("EMERGENCY");
  });
  it("retains saved SMS permission without making it operational; school cannot expand it",()=>{
    const p=defaultNotificationPolicy();p.events.FINANCE!.allowed.push("SMS");
    expect(allowedNotificationChannels(p,"FINANCE",9)).not.toContain("SMS");
    p.schools["9"]={enabled:true,allowed:["IN_APP"]};
    expect(allowedNotificationChannels(p,"FINANCE",9)).not.toContain("SMS");
    expect(allowedNotificationChannels(p,"FINANCE",10)).not.toContain("SMS");
    p.schools["9"].enabled=false;expect(allowedNotificationChannels(p,"FINANCE",9)).toEqual([]);
  });
  it("blocks SMS queueing even when requested and consented",async()=>{
    const f=fixture();await queue(f);expect(f.deliveries).not.toContain("SMS");
  });
  it("blocks attendance SMS intents even when requested",async()=>{
    const a=fixture();await queue(a,"ATTENDANCE","attendance:1:SCHOOL_ENTRY");expect(a.deliveries).not.toContain("SMS");
    const b=fixture({choices:{ATTENDANCE_ENTRY:["IN_APP"]}});await queue(b,"ATTENDANCE","attendance:1:SCHOOL_ENTRY");expect(b.deliveries).not.toContain("SMS");
    const c=fixture({consent:false});await queue(c,"ATTENDANCE","attendance:1:SCHOOL_ENTRY");expect(c.deliveries).not.toContain("SMS");
  });
  it("unknown or corrupt persisted policy fails closed",async()=>{
    expect(notificationPolicySchema.safeParse({events:{UNKNOWN:{allowed:["SMS"],defaults:[]}},schools:{}}).success).toBe(false);
    await expect(loadNotificationPolicy(fixture({policy:{bad:"policy"}}).db)).rejects.toThrow();
    expect(allowedNotificationChannels(defaultNotificationPolicy(),"unknown",9)).toEqual([]);
  });
  it("rejects defaults outside Owner allowed channels",()=>{
    const p=defaultNotificationPolicy();p.events.FINANCE!.defaults=["SMS"];
    expect(notificationPolicySchema.safeParse(p).success).toBe(false);
  });
  it("unconfigured/simulated providers and Telegram are unavailable, not delivered",()=>{
    expect(notificationChannelAvailability({})).toEqual({IN_APP:true,SMS:false,EMAIL:false,PUSH:false,TELEGRAM:false});
    expect(notificationChannelAvailability({COMMUNICATION_SMS_PROVIDER:"mock",COMMUNICATION_EMAIL_PROVIDER:"mock"}).SMS).toBe(false);
  });
  it("Development send locks keep even configured channels unavailable",()=>{
    const result=notificationChannelAvailability({NODE_ENV:"development",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true",
      COMMUNICATION_SMS_PROVIDER:"termii",VAPID_PUBLIC_KEY:"fictional",VAPID_PRIVATE_KEY:"fictional",VAPID_SUBJECT:"mailto:fixture@example.invalid"});
    expect(result).toEqual({IN_APP:true,SMS:false,EMAIL:false,PUSH:false,TELEGRAM:false});
  });
  it("permits non-SMS channels across every default category without making them defaults",()=>{
    for(const rule of Object.values(defaultNotificationPolicy().events)){
      expect(rule?.allowed).toEqual(["IN_APP","EMAIL","PUSH","TELEGRAM"]);
      expect(rule?.defaults).toEqual(["IN_APP"]);
    }
  });
});
