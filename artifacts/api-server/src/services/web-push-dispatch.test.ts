import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@clerk/express",()=>({clerkClient:{sessions:{getSession:vi.fn()}}}));
import { dispatchPushDevices } from "./web-push-dispatch";
import { developmentPushAllowed } from "../lib/development-push-policy";
const record={id:1,recipientUserId:11,schoolId:2,notificationId:3};
function fixture() {
  const attempts:Record<string,any>={};
  const query=vi.fn(async(sql:string,v:any[]=[])=>{
    if(sql.includes("SELECT push_attempts"))return {rows:[{pushAttempts:{...attempts}}]};
    if(sql.includes("SELECT id,subscription"))return {rows:[
      {id:4,subscription:{endpoint:"https://fcm.googleapis.com/synthetic",keys:{auth:"mock",p256dh:"mock"}},sessionId:"synthetic-session"}]};
    if(sql.includes(`'{"status":"PROCESSING"}'`)) {
      if(attempts[v[1]] && attempts[v[1]].status!=="RETRY")return {rows:[]};
      attempts[v[1]]={status:"PROCESSING"};return {rows:[{id:1}]};
    }
    if(sql.includes("SET push_attempts"))attempts[v[1]]=JSON.parse(v[2]);
    return {rows:[]};
  });
  const send=vi.fn(async(_message: any)=>({provider:"mock-push",channel:"push" as const,status:"ACCEPTED" as const,
    accepted:true,delivered:false}));
  const provider={provider:"mock-push",channel:"push" as const,send};
  return {query,attempts,provider,send,db:{query} as any};
}
afterEach(()=>vi.unstubAllEnvs());
describe("push fanout mocked transport and persistence, never network",()=>{
  it("claims once per device and never equates provider acceptance with delivery",async()=>{
    const f=fixture();
    expect(await dispatchPushDevices(f.db,record,f.provider,async()=>true))
      .toMatchObject({status:"ACCEPTED",accepted:true,delivered:false});
    await dispatchPushDevices(f.db,record,f.provider,async()=>true);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]?.[0]).toMatchObject({idempotencyKey:"communication-3-push-4"});
    expect(f.query.mock.calls.find(([sql])=>sql.includes("SELECT id,subscription"))?.[0]).toContain("subscription IS NOT NULL");
  });
  it("uses a conditional claim so simultaneous dispatches cannot both call a provider",async()=>{
    const f=fixture();
    await Promise.all([dispatchPushDevices(f.db,record,f.provider,async()=>true),
      dispatchPushDevices(f.db,record,f.provider,async()=>true)]);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.find(([sql])=>sql.includes(`'{"status":"PROCESSING"}'`))?.[0])
      .toContain("IN ('','RETRY')");
  });
  it("revokes logged-out subscriptions and does not send when session lookup is uncertain",async()=>{
    const f=fixture();
    await dispatchPushDevices(f.db,record,f.provider,async()=>false);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([s])=>s.includes("revoked_at=NOW()"))).toBe(true);
    const g=fixture();
    expect(await dispatchPushDevices(g.db,record,g.provider,async()=>null))
      .toMatchObject({failure:{category:"UNKNOWN",retryable:false}});
    expect(g.send).not.toHaveBeenCalled();
  });
  it("preserves uncertain claims after a lost provider response; no blind resend",async()=>{
    const f=fixture();f.send.mockRejectedValue(new Error("synthetic lost response"));
    await dispatchPushDevices(f.db,record,f.provider,async()=>true);
    await dispatchPushDevices(f.db,record,f.provider,async()=>true);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.attempts["4"].status).toBe("PROCESSING");
  });
  it("blocks real Development sends before looking up devices unless explicitly authorized",async()=>{
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
    vi.stubEnv("EDUCORE_DEVELOPMENT_PUSH_ENABLED","");
    const f=fixture();
    expect(await dispatchPushDevices(f.db,record,{...f.provider,provider:"web-push"},async()=>true))
      .toMatchObject({failure:{category:"CONFIGURATION"}});
    expect(f.query).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  });
  it("requires send opt-in, the approved user allowlist, and unpaused workers together",()=>{
    const env={NODE_ENV:"development",EDUCORE_DEVELOPMENT_PUSH_ENABLED:"true",
      EDUCORE_DEVELOPMENT_PUSH_USER_IDS:"11,12"};
    expect(developmentPushAllowed(11,env)).toBe(true);
    expect(developmentPushAllowed(13,env)).toBe(false);
    expect(developmentPushAllowed(11,{...env,EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true"})).toBe(false);
    expect(developmentPushAllowed(11,{NODE_ENV:"development"})).toBe(false);
  });
});
