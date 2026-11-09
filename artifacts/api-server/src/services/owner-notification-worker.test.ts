import {beforeEach,afterEach,it,expect,vi} from "vitest";
const fixture=vi.hoisted(()=>({dispatch:vi.fn(),controls:null as any}));
vi.mock("./communication-service",()=>({dispatchCommunicationDeliveries:(...args:any[])=>fixture.dispatch(...args)}));
vi.mock("./owner-notification-controls",async original=>({
  ...await original<typeof import("./owner-notification-controls")>(),
  loadOwnerDeliveryControls:async()=>fixture.controls,
}));
import {ownerNotificationWorkerTick} from "./owner-notification-worker";
import {disabledDeliveryControls,ownerNotificationScope} from "./owner-notification-controls";
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  vi.stubEnv("EDUCORE_DEVELOPMENT_WORKERS_PAUSED","true");
  vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED","true");
  fixture.controls=disabledDeliveryControls();fixture.dispatch.mockReset();
});
afterEach(()=>vi.unstubAllEnvs());
it("starts no provider/claim work until the Owner explicitly resumes a channel",async()=>{
  await ownerNotificationWorkerTick({} as any);expect(fixture.dispatch).not.toHaveBeenCalled();
});
it("runs only selected notification transports without invoking protected workers",async()=>{
  fixture.controls={...disabledDeliveryControls(),paused:false,smsEnabled:true,activatedAt:"2026-11-10T00:00:00Z"};
  fixture.dispatch.mockImplementation(async(_pool,_limit,options)=>{
    expect(options.channels).toEqual(["SMS"]);expect(options.allowConfiguredProviders).toBe(true);
    expect(ownerNotificationScope()?.smsEnabled).toBe(true);
  });
  await ownerNotificationWorkerTick({} as any);
  expect(fixture.dispatch).toHaveBeenCalledOnce();
  expect(process.env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED).toBe("true");
  expect(process.env.EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED).toBe("true");
});
it("does not run the Development worker against Production",async()=>{
  vi.stubEnv("REPLIT_DEPLOYMENT","1");
  fixture.controls={...disabledDeliveryControls(),paused:false,smsEnabled:true};
  await ownerNotificationWorkerTick({} as any);expect(fixture.dispatch).not.toHaveBeenCalled();
});
