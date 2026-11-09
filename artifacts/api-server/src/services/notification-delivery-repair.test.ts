import {afterEach,describe,it,expect,vi} from "vitest";
import {dispatchCommunicationDeliveries} from "./communication-service";
import {createDevelopmentCommunicationProviders} from "./communication-providers";
import {notificationChannelReadiness} from "./notification-channel-policy";
import {WebPushProvider} from "./web-push-provider";
import {createECDH} from "node:crypto";
const smsEnv={NODE_ENV:"development",COMMUNICATION_SMS_PROVIDER:"bulksmsnigeria",
  BULKSMSNIGERIA_API_TOKEN:"synthetic-token",BULKSMSNIGERIA_SENDER_ID:"FixtureSMS"};
afterEach(()=>vi.unstubAllEnvs());
describe("targeted Development delivery repair, no external requests",()=>{
  it("selects actual scoped SMS without sender-list discovery, retaining other Development transports",()=>{
    const transport=vi.fn();
    const providers=createDevelopmentCommunicationProviders(smsEnv,{fetch:transport});
    expect(providers.sms.provider).toBe("bulksmsnigeria");
    expect(providers.email.provider).not.toBe("resend");
    expect(notificationChannelReadiness(smsEnv).SMS.configurationDetail).toContain("confirmed by the Owner");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["EDUCORE_DEVELOPMENT_WORKERS_PAUSED","EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED","NO_OPT_IN","NO_RECIPIENTS"])(
    "does not claim or exhaust push while held by %s",async hold=>{
      vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
      vi.stubEnv("EDUCORE_DEVELOPMENT_WORKERS_PAUSED",hold==="EDUCORE_DEVELOPMENT_WORKERS_PAUSED"?"true":"false");
      vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED",hold==="EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED"?"true":"false");
      vi.stubEnv("EDUCORE_DEVELOPMENT_PUSH_ENABLED",hold==="NO_OPT_IN"?"":"true");
      vi.stubEnv("EDUCORE_DEVELOPMENT_PUSH_USER_IDS",hold==="NO_RECIPIENTS"?"":"17");
      const pool={query:vi.fn(),connect:vi.fn()},send=vi.fn();
      const result=await dispatchCommunicationDeliveries(pool as any,1,{channels:["PUSH"],providers:{
        sms:{provider:"fixture",channel:"sms",send},email:{provider:"fixture",channel:"email",send},
        push:{provider:"web-push",channel:"push",send},
      }});
      expect(result.claimed).toBe(0);
      expect(pool.connect).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
    });
  it("adds only a WAT created-time label to privacy-preserving push payloads; acceptance is not receipt",async()=>{
    vi.stubEnv("NODE_ENV","test");
    const signing=createECDH("prime256v1");signing.generateKeys();
    const device=createECDH("prime256v1");device.generateKeys();
    const transport=vi.fn(async()=>({statusCode:201,body:"",headers:{}}));
    const provider=new WebPushProvider({publicKey:signing.getPublicKey().toString("base64url"),
      privateKey:signing.getPrivateKey().toString("base64url"),subject:"mailto:fixture@example.invalid"},transport as any);
    const result=await provider.send({subscription:{endpoint:"https://fcm.googleapis.com/synthetic",
      keys:{p256dh:device.getPublicKey().toString("base64url"),auth:Buffer.alloc(16).toString("base64url")}},
      idempotencyKey:"communication-1-push-1",createdAt:"2026-11-09T06:53:59Z"});
    expect(result).toMatchObject({accepted:true,delivered:false});
    const payload=JSON.parse((transport.mock.calls[0] as unknown as [unknown,string])[1]);
    expect(payload.createdAtWAT).toBe("09 Nov 2026, 07:53:59 WAT");
    expect(payload.body).toBe("You have a new notification. Open EduCore for details.");
  });
});
