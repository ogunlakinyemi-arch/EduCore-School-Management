import {describe,it,expect,vi} from "vitest";
import {refreshTelegramHealth,getTelegramHealth,createTelegramProvider} from "./telegram-provider";
const env={NODE_ENV:"test",TELEGRAM_BOT_TOKEN:"123456:fixture_token_not_real",SESSION_SECRET:"fixture-encryption-key-01234567890123456789"};
const ok=(method:string)=>new Response(JSON.stringify({ok:true,result:method==="getMe"
  ?{id:123456,is_bot:true,username:"FixtureBot"}:{url:""}}),{status:200});
const healthy=vi.fn(async(url:any)=>ok(String(url).split("/").at(-1)!));
describe("Telegram transport/configuration (fake HTTP only)",()=>{
  it("never enables a missing token, Production or missing encryption",async()=>{
    expect(getTelegramHealth({NODE_ENV:"test"}).reason).toBe("TOKEN_MISSING");
    expect(getTelegramHealth({...env,NODE_ENV:"production"}).ready).toBe(false);
    expect(getTelegramHealth({...env,SESSION_SECRET:""}).ready).toBe(false);
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
