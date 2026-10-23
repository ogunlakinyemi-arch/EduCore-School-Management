import {createECDH} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const health=vi.hoisted(()=>({ready:true,reason:"READY"}));
vi.mock("./telegram-provider",()=>({getTelegramHealth:()=>({...health})}));
import {notificationChannelReadiness,notificationChannelAvailability,notificationChannelConfiguration,
  defaultNotificationPolicy,policyValidationIssue} from "./notification-channel-policy";
const pair=createECDH("prime256v1");pair.generateKeys();
const configured:NodeJS.ProcessEnv={NODE_ENV:"production",REPLIT_DEPLOYMENT:"1",
  COMMUNICATION_EMAIL_PROVIDER:"resend",EMAIL_FROM:"Fixture <fixture@example.invalid>",
  RESEND_API_KEY:"fixture-only-not-a-real-key",VAPID_PUBLIC_KEY:pair.getPublicKey().toString("base64url"),
  VAPID_PRIVATE_KEY:pair.getPrivateKey().toString("base64url"),VAPID_SUBJECT:"mailto:fixture@example.invalid"};
beforeEach(()=>{health.ready=true;health.reason="READY";vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("No network authorized");}));});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("Owner channel diagnostics without sending or changing launch authorization",()=>{
  it("allows all three supported channels in code when configuration and a synthetic launch boundary are valid",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const env={...configured,EDUCORE_NOTIFICATION_LIVE_FROM:"2026-10-23T12:34:38.000Z"};
    const status=notificationChannelReadiness(env);
    for(const channel of ["EMAIL","PUSH","TELEGRAM"] as const){
      expect(status[channel]).toMatchObject({configurationReady:true,deliveryReady:true,deliveryHold:null});
    }
    expect(status.SMS.deliveryReady).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [{COMMUNICATION_EMAIL_PROVIDER:"mock"},"mock/test"],
    [{COMMUNICATION_EMAIL_PROVIDER:"unsupported"},"supported provider"],
    [{COMMUNICATION_EMAIL_PROVIDER:"http",COMMUNICATION_EMAIL_ENDPOINT:undefined},"COMMUNICATION_EMAIL_ENDPOINT"],
    [{COMMUNICATION_EMAIL_PROVIDER:"http",COMMUNICATION_EMAIL_ENDPOINT:"https://fixture.example.invalid"},"COMMUNICATION_EMAIL_API_KEY"],
    [{EMAIL_FROM:"not an email sender"},"EMAIL_FROM"],
    [{EMAIL_FROM:"Company <fixture@gmail.com>"},"Gmail/Googlemail"],
    [{RESEND_API_KEY:undefined},"Resend credential"],
  ])("reports a precise Email configuration blocker without selecting a fallback (%j)",(overrides,detail)=>{
    const status=notificationChannelReadiness({...configured,...overrides});
    expect(status.EMAIL.configurationReady).toBe(false);
    expect(status.EMAIL.configurationDetail).toContain(detail);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("distinguishes invalid Push encoding, mismatched keys and missing contact without exposing values",()=>{
    const other=createECDH("prime256v1");other.generateKeys();
    expect(notificationChannelReadiness({...configured,VAPID_PUBLIC_KEY:"invalid"}).PUSH.configurationDetail)
      .toContain("VAPID_PUBLIC_KEY");
    expect(notificationChannelReadiness({...configured,VAPID_PUBLIC_KEY:other.getPublicKey().toString("base64url")}).PUSH.configurationDetail)
      .toContain("matching key pair");
    expect(notificationChannelReadiness({...configured,VAPID_SUBJECT:undefined}).PUSH.configurationDetail)
      .toContain("VAPID_SUBJECT");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports configuration ready separately from the exact unset-cutoff hold for all external channels",()=>{
    const status=notificationChannelReadiness(configured);
    for(const channel of ["EMAIL","PUSH","TELEGRAM"] as const){
      expect(status[channel].configurationReady).toBe(true);
      expect(status[channel].deliveryReady).toBe(false);
      expect(status[channel].deliveryHold).toContain("EDUCORE_NOTIFICATION_LIVE_FROM is not set");
    }
    expect(status.IN_APP.deliveryReady).toBe(true);
    expect(status.SMS.deliveryReady).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toContain(configured.RESEND_API_KEY);
    expect(JSON.stringify(status)).not.toContain(configured.VAPID_PRIVATE_KEY);
  });
  it("reports missing Email selection despite a credential, without silently selecting a provider",()=>{
    const status=notificationChannelReadiness({...configured,COMMUNICATION_EMAIL_PROVIDER:undefined});
    expect(status.EMAIL.configurationReady).toBe(false);
    expect(status.EMAIL.configurationDetail).toContain("COMMUNICATION_EMAIL_PROVIDER");
    expect(status.EMAIL.deliveryHold).toContain("not set");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports missing sender and invalid Push configuration without revealing values",()=>{
    const status=notificationChannelReadiness({...configured,EMAIL_FROM:undefined,VAPID_PUBLIC_KEY:"invalid-synthetic-key"});
    expect(status.EMAIL.configurationDetail).toContain("EMAIL_FROM");
    expect(status.PUSH.configurationReady).toBe(false);
    expect(status.PUSH.configurationDetail).toContain("validation failed");
    expect(JSON.stringify(status)).not.toContain("invalid-synthetic-key");
  });
  it("reports transient Telegram health separately from the launch hold",()=>{
    health.ready=false;health.reason="TIMEOUT";
    const status=notificationChannelReadiness(configured);
    expect(status.TELEGRAM.configurationDetail).toContain("TIMEOUT");
    expect(status.TELEGRAM.configurationReady).toBe(false);
    expect(status.TELEGRAM.deliveryHold).toContain("not set");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not change availability, defaults validation, environment, or policy",()=>{
    const env={...configured};
    const before=notificationChannelAvailability(env);
    const policy=defaultNotificationPolicy();
    const original=structuredClone(policy);
    notificationChannelReadiness(env);
    expect(notificationChannelAvailability(env)).toEqual(before);
    expect(notificationChannelConfiguration(env)).toMatchObject({EMAIL:true,PUSH:true,TELEGRAM:true});
    expect(env).toEqual(configured);
    expect(policy).toEqual(original);
    const next=structuredClone(policy);next.events.SYSTEM!.defaults.push("EMAIL");
    expect(policyValidationIssue(next,policy,before)).toBe("UNAVAILABLE_DEFAULT");
    expect(fetch).not.toHaveBeenCalled();
  });
});
