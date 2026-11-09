import {afterEach,describe,it,expect,vi} from "vitest";
import {disabledDeliveryControls,loadOwnerDeliveryControls,withOwnerNotificationScope,financialNotification,
  ownerDeliveryClaimSql,ownerTransportAllowed} from "./owner-notification-controls";
import {notificationTransportSuppressed} from "../lib/owner-notification-transport";
import {developmentPaymentNotificationsSuppressed} from "../lib/development-payment-notification-policy";
import {developmentPushAllowed} from "../lib/development-push-policy";
const active=()=>({...disabledDeliveryControls(),paused:false,smsEnabled:true,pushEnabled:true,telegramEnabled:true,
  pushParentIds:[17],version:1,activatedAt:"2026-11-10T00:00:00.000Z"});
afterEach(()=>vi.unstubAllEnvs());
describe("Owner notification-only delivery boundary",()=>{
  it("defaults to paused with every channel disabled and no invented parent",async()=>{
    expect(await loadOwnerDeliveryControls({query:vi.fn(async()=>({rows:[]}))})).toEqual(disabledDeliveryControls());
  });
  it("fails closed on malformed stored controls",async()=>{
    expect((await loadOwnerDeliveryControls({query:vi.fn(async()=>({rows:[{id:1,metadata:{controls:{paused:false}}}]}))})).paused).toBe(true);
  });
  it("isolates nonfinancial transport permission without clearing either protective pause",async()=>{
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
    vi.stubEnv("EDUCORE_DEVELOPMENT_WORKERS_PAUSED","true");
    vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED","true");
    expect(notificationTransportSuppressed("SMS")).toBe(true);
    await withOwnerNotificationScope(active(),async()=>{
      expect(notificationTransportSuppressed("SMS")).toBe(false);
      expect(developmentPushAllowed(17)).toBe(true);expect(developmentPushAllowed(18)).toBe(false);
      expect(developmentPaymentNotificationsSuppressed()).toBe(true);
      expect(process.env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED).toBe("true");
    });
    expect(notificationTransportSuppressed("SMS")).toBe(true);
  });
  it("pause and each channel switch remain effective inside the isolated scope",async()=>{
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
    await withOwnerNotificationScope({...active(),paused:true},async()=>expect(ownerTransportAllowed("SMS")).toBe(false));
    await withOwnerNotificationScope({...active(),smsEnabled:false},async()=>{
      expect(ownerTransportAllowed("SMS")).toBe(false);expect(ownerTransportAllowed("TELEGRAM")).toBe(true);
    });
  });
  it("requires explicit Production controls and a scope for deployed delivery",async()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("REPLIT_DEPLOYMENT","1");
    expect(await loadOwnerDeliveryControls({query:vi.fn(async()=>({rows:[]}))})).toEqual(disabledDeliveryControls());
    expect(ownerTransportAllowed("SMS")).toBe(false);
    await withOwnerNotificationScope(active(),async()=>expect(ownerTransportAllowed("SMS")).toBe(true));
    expect(ownerTransportAllowed("SMS")).toBe(false);
  });
  it.each([["FINANCE","invoice:1"],["PAYMENT","receipt"],["SUBSCRIPTION","term:1"],["SYSTEM","NFC_CARD_REMINDER"],
    ["ANNOUNCEMENT","manual:FEE:1"],["PARTNER","commission"]])("holds financial event %s %s", (category,key)=>{
      expect(financialNotification(category,key)).toBe(true);
    });
  it("retains fresh-message and push-recipient restrictions in executable claim predicates",()=>{
    const sql=ownerDeliveryClaimSql("$7","$8");
    expect(sql).toContain("d.created_at>=$7");expect(sql).toContain("owner_n.created_at>=$7");
    expect(sql).toContain("recipient_user_id=ANY($8::int[])");
    expect(sql).toContain("NOT IN ('FINANCE','PAYMENT','SUBSCRIPTION','PARTNER')");
    expect(financialNotification("ATTENDANCE","attendance:1:ABSENT")).toBe(false);
  });
});
