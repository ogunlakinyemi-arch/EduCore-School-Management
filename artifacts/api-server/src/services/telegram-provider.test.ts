import {describe,it,expect,vi} from "vitest";
const diagnostics=vi.hoisted(()=>({warn:vi.fn()}));
vi.mock("../lib/logger",()=>({logger:diagnostics}));
import {refreshTelegramHealth,getTelegramHealth,createTelegramProvider,diagnoseTelegramBot,telegramApi} from "./telegram-provider";
const env={NODE_ENV:"test",TELEGRAM_BOT_TOKEN:"123456:fixture_token_not_real",SESSION_SECRET:"fixture-encryption-key-01234567890123456789"};
const ok=(method:string)=>new Response(JSON.stringify({ok:true,result:method==="getMe"
  ?{id:123456,is_bot:true,username:"FixtureBot"}:{url:""}}),{status:200});
const healthy=vi.fn(async(url:any)=>ok(String(url).split("/").at(-1)!));
describe("Telegram transport/configuration (fake HTTP only)",()=>{
  it.each([
    [403,"PROVIDER_FORBIDDEN"],[429,"RATE_LIMITED"],[503,"PROVIDER_UNAVAILABLE"],
  ])("classifies HTTP %s without exposing provider descriptions",async(status,reason)=>{
    const result=await refreshTelegramHealth(true,env,vi.fn(async()=>new Response(
      JSON.stringify({ok:false,error_code:status,description:env.TELEGRAM_BOT_TOKEN}),{status})) as any);
    expect(result.reason).toBe(reason);
    expect(JSON.stringify(result)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });
  it("distinguishes timeout, network and invalid JSON without leaking caught messages",async()=>{
    for(const [failure,reason] of [
      [new DOMException(env.TELEGRAM_BOT_TOKEN,"TimeoutError"),"TIMEOUT"],
      [new Error(env.TELEGRAM_BOT_TOKEN),"NETWORK_UNAVAILABLE"],
    ] as const){
      const result=await refreshTelegramHealth(true,env,vi.fn(async()=>{throw failure;}) as any);
      expect(result.reason).toBe(reason);expect(JSON.stringify(result)).not.toContain(env.TELEGRAM_BOT_TOKEN);
    }
    expect((await refreshTelegramHealth(true,env,vi.fn(async()=>new Response("sensitive html")) as any)).reason).toBe("INVALID_RESPONSE");
    expect(JSON.stringify(diagnostics.warn.mock.calls)).not.toContain(env.TELEGRAM_BOT_TOKEN);
    expect(JSON.stringify(diagnostics.warn.mock.calls)).not.toContain("sensitive html");
    expect(diagnostics.warn).toHaveBeenCalledWith(expect.objectContaining({
      event:"TELEGRAM_HEALTH_CHECK_FAILED",stage:"getMe",reason:"INVALID_RESPONSE",
    }),expect.any(String));
  });
  it("records the failed read-only method without exposing webhook response data",async()=>{
    const transport=vi.fn(async(url:any)=>String(url).endsWith("getMe")?ok("getMe"):
      new Response("sensitive webhook body",{status:502}));
    expect((await refreshTelegramHealth(true,env,transport as any)).reason).toBe("PROVIDER_UNAVAILABLE");
    expect(diagnostics.warn).toHaveBeenLastCalledWith(expect.objectContaining({
      stage:"getWebhookInfo",reason:"PROVIDER_UNAVAILABLE",status:502,
    }),expect.any(String));
    expect(JSON.stringify(diagnostics.warn.mock.calls)).not.toContain("sensitive webhook body");
  });
  it("never enables a missing token, unapproved Production or missing encryption",async()=>{
    expect(getTelegramHealth({NODE_ENV:"test"}).reason).toBe("TOKEN_MISSING");
    expect(getTelegramHealth({...env,NODE_ENV:"production"}).ready).toBe(false);
    expect(getTelegramHealth({...env,SESSION_SECRET:""}).ready).toBe(false);
  });
  it("permits Production diagnostics with delivery disabled, without changing readiness",async()=>{
    const production={...env,NODE_ENV:"production",REPLIT_DEPLOYMENT:"1",TELEGRAM_BOT_TOKEN:"222222:diagnostic_fixture"};
    const transport=vi.fn(async(url:any)=>ok(String(url).split("/").at(-1)!));
    const before=getTelegramHealth(production);
    expect(await diagnoseTelegramBot(production,transport as any)).toMatchObject({diagnosticOk:true,configured:true});
    expect(transport.mock.calls.map(([url])=>String(url).split("/").at(-1))).toEqual(["getMe","getWebhookInfo"]);
    expect(getTelegramHealth(production)).toEqual(before);
    expect(createTelegramProvider(production)).toBeUndefined();
    await expect(telegramApi("sendMessage",{},production,transport as any)).rejects.toThrow("Telegram request failed");
    await expect(telegramApi("getUpdates",{},production,transport as any)).rejects.toThrow("Telegram request failed");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("requires Production opt-in, encryption, schema and worker validation; diagnostic success is insufficient",async()=>{
    const production={...env,NODE_ENV:"production",REPLIT_DEPLOYMENT:"1",EDUCORE_PRODUCTION_TELEGRAM_ENABLED:"true"};
    expect((await refreshTelegramHealth(false,production,healthy as any)).reason).toBe("SCHEMA_NOT_READY");
    expect(createTelegramProvider(production)).toBeUndefined();
    await diagnoseTelegramBot(production,healthy as any);
    expect(getTelegramHealth(production).reason).toBe("SCHEMA_NOT_READY");
    expect(createTelegramProvider(production)).toBeUndefined();
    await refreshTelegramHealth(true,production,healthy as any);
    expect(getTelegramHealth(production).ready).toBe(true);
    const before=getTelegramHealth(production);
    const failed=await diagnoseTelegramBot(production,vi.fn(async()=>{throw new Error(env.TELEGRAM_BOT_TOKEN)}) as any);
    expect(failed.diagnosticReason).toBe("NETWORK_UNAVAILABLE");
    expect(getTelegramHealth(production)).toEqual(before);
    expect(getTelegramHealth({...production,SESSION_SECRET:"changed-valid-encryption-key-0123456789"}).ready).toBe(false);
    expect(getTelegramHealth({...production,EDUCORE_PRODUCTION_TELEGRAM_ENABLED:"false"}).ready).toBe(false);
    expect(getTelegramHealth({...production,SESSION_SECRET:"short"}).ready).toBe(false);
    const transport=vi.fn(async()=>new Response(JSON.stringify({ok:true,result:{message_id:781}})));
    const result=await createTelegramProvider(production,transport as any)!.send({
      to:"999001",body:"Consented fixture notification",idempotencyKey:"production-fixture",
    });
    expect(result).toMatchObject({accepted:true,delivered:false,status:"ACCEPTED"});
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([failed,diagnostics.warn.mock.calls])).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });
  it("checks getMe/getWebhookInfo only, and reports an existing webhook without changing it",async()=>{
    const transport=vi.fn(async(url:any)=>String(url).endsWith("getMe")?ok("getMe"):
      new Response(JSON.stringify({ok:true,result:{url:"https://example.invalid/existing"}})));
    const health=await refreshTelegramHealth(true,env,transport as any);
    expect(health).toMatchObject({configured:true,ready:false,reason:"WEBHOOK_CONFLICT"});
    expect(transport).toHaveBeenCalledTimes(2);expect(JSON.stringify(health)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });
  it("reports invalid credentials safely and cannot create an active provider",async()=>{
    const health=await refreshTelegramHealth(true,env,vi.fn(async()=>new Response(JSON.stringify({ok:false,error_code:401,description:env.TELEGRAM_BOT_TOKEN}),{status:401})) as any);
    expect(health.reason).toBe("INVALID_TOKEN");expect(JSON.stringify(health)).not.toContain(env.TELEGRAM_BOT_TOKEN);
    expect(createTelegramProvider(env)).toBeUndefined();
  });
  it("preserves the existing Development send lock while still checking credential health",async()=>{
    const locked={...env,NODE_ENV:"development",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true"};
    expect((await refreshTelegramHealth(true,locked,healthy as any)).reason).toBe("DEVELOPMENT_SEND_LOCK");
    expect(createTelegramProvider(locked)).toBeUndefined();
  });
  it("permits only an explicit Development Telegram opt-in without altering old send locks",async()=>{
    const scoped={...env,NODE_ENV:"development",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true",
      EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED:"true",EDUCORE_DEVELOPMENT_TELEGRAM_ENABLED:"true"};
    expect((await refreshTelegramHealth(true,scoped,healthy as any)).ready).toBe(true);
    expect(getTelegramHealth({...scoped,REPLIT_DEPLOYMENT:"1"}).ready).toBe(false);
    expect(scoped.EDUCORE_DEVELOPMENT_WORKERS_PAUSED).toBe("true");
  });
  it("uses HTTPS, no redirects/formatting/previews and distinguishes acknowledgement from delivery",async()=>{
    await refreshTelegramHealth(true,env,healthy as any);
    const transport=vi.fn(async()=>new Response(JSON.stringify({ok:true,result:{message_id:17}})));
    const result=await createTelegramProvider(env,transport as any)!.send({to:"777001",body:"Fixture",idempotencyKey:"fixture"});
    expect(result).toMatchObject({accepted:true,delivered:false,status:"ACCEPTED",providerMessageId:"17"});
    const args=transport.mock.calls[0] as any;expect(args[0]).toMatch(/^https:\/\/api\.telegram\.org\//);
    expect(args[1].redirect).toBe("error");
    expect(JSON.parse(args[1].body)).toMatchObject({chat_id:"777001",protect_content:true,link_preview_options:{is_disabled:true}});
  });
  it("treats a lost HTTP response as unknown and never reports delivery",async()=>{
    await refreshTelegramHealth(true,env,healthy as any);
    const result=await createTelegramProvider(env,vi.fn(async()=>{throw new Error(env.TELEGRAM_BOT_TOKEN);}) as any)!
      .send({to:"777002",body:"Fixture",idempotencyKey:"fixture"});
    expect(result).toMatchObject({accepted:false,delivered:false,failure:{category:"UNKNOWN",retryable:false}});
    expect(JSON.stringify(result)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });
});
