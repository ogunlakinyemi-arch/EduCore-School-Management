import {afterEach,describe,expect,it,vi} from "vitest";
import {BulkSmsNigeriaProvider,bulkSmsConfigurationReady} from "./bulksmsnigeria-provider";
import {createSmsProvider} from "./communication-providers";
import {smsNotificationAllowed} from "./sms-event-policy";
import {defaultNotificationPolicy,allowedNotificationChannels,notificationChannelAvailability} from "./notification-channel-policy";

const env={COMMUNICATION_SMS_PROVIDER:"bulksmsnigeria",BULKSMSNIGERIA_API_TOKEN:"synthetic-token",
  BULKSMSNIGERIA_SENDER_ID:"FixtureSMS"};
afterEach(()=>vi.unstubAllEnvs());
describe("BulkSMSNigeria scoped SMS, no external network",()=>{
  it("validates exact configuration names and never falls back to Termii",()=>{
    expect(bulkSmsConfigurationReady(env)).toBe(true);
    expect(createSmsProvider(env).provider).toBe("bulksmsnigeria");
    expect(()=>createSmsProvider({...env,BULKSMSNIGERIA_API_TOKEN:""})).toThrow();
    expect(bulkSmsConfigurationReady({...env,BULKSMSNIGERIA_SENDER_ID:"too-long-sender"})).toBe(false);
  });
  it.each(["EMERGENCY","ATTENDANCE_ABSENCE"])("accepts only the v2 contract for %s without claiming delivery",async event=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({status:"success",code:"BSNG-0000",data:{message_id:"fixture-123"}})));
    const provider=createSmsProvider(env,{fetch:transport as any});
    const result=await provider.send({to:"08012345678",body:"Fictional alert",event});
    expect(result).toMatchObject({accepted:true,delivered:false,status:"ACCEPTED",providerMessageId:"fixture-123"});
    expect(transport).toHaveBeenCalledOnce();
    const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://www.bulksmsnigeria.com/api/v2/sms");
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({Authorization:"Bearer synthetic-token"});
    expect(JSON.parse(options.body as string)).toEqual({from:"FixtureSMS",to:"2348012345678",body:"Fictional alert",gateway:"direct-refund"});
  });
  it.each(["ATTENDANCE_ENTRY","ATTENDANCE_EXIT","LATE_ENTRY","FINANCE","PAYMENT","ANNOUNCEMENT","SYSTEM","SECURITY","MARKETING",""])(
    "blocks direct adapter sends for %s",async event=>{
      const transport=vi.fn();
      expect((await createSmsProvider(env,{fetch:transport}).send({to:"08012345678",body:"Do not send",event})).accepted).toBe(false);
      expect(transport).not.toHaveBeenCalled();
      expect(allowedNotificationChannels(defaultNotificationPolicy(),event,1)).not.toContain("SMS");
    });
  it("requires a genuine student absence or explicit emergency marker, not discrepancy/late/general attendance",()=>{
    expect(smsNotificationAllowed("ATTENDANCE","attendance:1:ABSENT",7)).toBe(true);
    expect(smsNotificationAllowed("ATTENDANCE","attendance:1:ABSENT",null)).toBe(false);
    expect(smsNotificationAllowed("ATTENDANCE","attendance:1:DISCREPANCY",7)).toBe(false);
    expect(smsNotificationAllowed("SECURITY","COMMUNICATION_CAMPAIGN:1:EMERGENCY",null)).toBe(true);
    expect(smsNotificationAllowed("ANNOUNCEMENT","ordinary:1",7)).toBe(false);
  });
  it.each(["EDUCORE_DEVELOPMENT_WORKERS_PAUSED","EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED"])(
    "preserves %s even for direct real-provider calls",async key=>{
      vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");vi.stubEnv(key,"true");
      const transport=vi.fn();
      const provider=new BulkSmsNigeriaProvider("synthetic-token","FixtureSMS",{fetch:transport});
      expect((await provider.send({to:"08012345678",body:"Do not send",event:"EMERGENCY"})).failure?.category).toBe("CONFIGURATION");
      expect(notificationChannelAvailability({...env,NODE_ENV:"development",[key]:"true"}).SMS).toBe(false);
      expect(transport).not.toHaveBeenCalled();
    });
  it.each(["bad-number","08012345678,08099999999","+15555550101"])("rejects invalid, bulk or non-Nigerian recipient %s",async to=>{
    const transport=vi.fn();
    await createSmsProvider(env,{fetch:transport}).send({to,body:"Fictional",event:"EMERGENCY"});
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([401,403,409,429,500])("classifies HTTP %s without returning response bodies",async status=>{
    const transport=vi.fn(async()=>new Response("private provider response",{status,headers:{"retry-after":"60"}}));
    const result=await createSmsProvider(env,{fetch:transport as any}).send({to:"08012345678",body:"Fictional",event:"EMERGENCY"});
    expect(result.failure?.category).toBe(status===429?"RATE_LIMITED":status>=500?"UNKNOWN":status===401||status===403?"AUTHENTICATION":"PROVIDER_REJECTED");
    expect(JSON.stringify(result)).not.toContain("private provider response");
  });
});
