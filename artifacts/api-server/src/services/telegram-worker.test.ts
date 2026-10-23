import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({
  ready:true,api:vi.fn(),health:vi.fn(),accept:vi.fn(),dispatch:vi.fn(),query:vi.fn(),connect:vi.fn(),
}));
vi.mock("@workspace/db",()=>({pool:{connect:()=>state.connect(),query:(...args:any[])=>state.query(...args)}}));
vi.mock("../lib/logger",()=>({logger:{info:vi.fn(),warn:vi.fn()}}));
vi.mock("./telegram-provider",async original=>({
  ...await original<typeof import("./telegram-provider")>(),
  getTelegramHealth:()=>({configured:true,ready:state.ready,reason:state.ready?"READY":"SCHEMA_NOT_READY",botId:"123456"}),
  telegramApi:(...args:any[])=>state.api(...args),
}));
vi.mock("./telegram-links",()=>({
  checkTelegramRuntimeHealth:()=>state.health(),acceptTelegramUpdate:(...args:any[])=>state.accept(...args),
}));
vi.mock("./communication-service",()=>({dispatchCommunicationDeliveries:(...args:any[])=>state.dispatch(...args)}));
beforeEach(()=>{
  vi.resetModules();
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("REPLIT_DEPLOYMENT","1");
  vi.stubEnv("EDUCORE_PRODUCTION_TELEGRAM_ENABLED","true");
  state.ready=true;state.api.mockReset().mockResolvedValue([{update_id:8,message:{text:"fixture"}}]);
  state.health.mockReset().mockResolvedValue({ready:true});
  state.accept.mockReset();state.dispatch.mockReset();state.query.mockReset();
  state.query.mockImplementation(async(sql:string)=>{
    if(sql.includes("pg_try_advisory_lock"))return {rows:[{acquired:true}]};
    if(sql.includes("SELECT last_update_id"))return {rows:[{last_update_id:7}]};
    return {rows:[]};
  });
  state.connect.mockReset().mockResolvedValue({query:state.query,release:vi.fn()});
});
afterEach(()=>vi.unstubAllEnvs());
describe("Production Telegram worker (mocked, no timers or network)",()=>{
  it("cannot poll or claim a queue without explicit Production enablement",async()=>{
    vi.stubEnv("EDUCORE_PRODUCTION_TELEGRAM_ENABLED","false");
    const {telegramWorkerTick}=await import("./telegram-worker");
    await telegramWorkerTick();
    expect(state.connect).not.toHaveBeenCalled();expect(state.health).not.toHaveBeenCalled();
    expect(state.api).not.toHaveBeenCalled();expect(state.dispatch).not.toHaveBeenCalled();
  });
  it("does not poll or dispatch when schema/credential validation is unavailable",async()=>{
    state.ready=false;
    const {telegramWorkerTick}=await import("./telegram-worker");await telegramWorkerTick();
    expect(state.api).not.toHaveBeenCalled();expect(state.dispatch).not.toHaveBeenCalled();
  });
  it("polls verified updates, commits their cursor and dispatches only Telegram",async()=>{
    const {telegramWorkerTick}=await import("./telegram-worker");await telegramWorkerTick();
    expect(state.health).toHaveBeenCalledTimes(1);
    expect(state.api).toHaveBeenCalledWith("getUpdates",expect.objectContaining({offset:8}));
    expect(state.accept).toHaveBeenCalledTimes(1);
    expect(state.query).toHaveBeenCalledWith("UPDATE telegram_poll_state SET last_update_id=$1 WHERE id=1",[8]);
    expect(state.dispatch).toHaveBeenCalledWith(expect.anything(),10,{allowConfiguredProviders:true,channels:["TELEGRAM"]});
  });
});
