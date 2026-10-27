import {beforeAll,afterAll,beforeEach,afterEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),release:vi.fn(),auth:vi.fn(),logs:[] as string[]}));
vi.mock("@workspace/db",async(importOriginal)=>({
  ...await importOriginal<typeof import("@workspace/db")>(),
  pool:{connect:f.connect,targetDiagnostic:{targetFingerprint:"1234567890abcdef12345678"}},
}));
// Fail closed downstream: a misplaced health route must fail this regression.
vi.mock("@clerk/express",()=>({clerkMiddleware:()=>f.auth}));
vi.mock("./routes",async()=>({default:(await import("express")).Router()}));
vi.mock("./lib/logger",async()=>({logger:(await import("pino")).default(
  {level:"info"},{write:(s:string)=>f.logs.push(s)})}));
import app from "./app";
let server:ReturnType<typeof app.listen>,origin:string,clock=0;
beforeAll(async()=>{
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  origin=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(Date.UTC(2026,9,27,12,0,clock+=10)));
  f.connect.mockReset();f.query.mockReset().mockResolvedValue({rows:[{ready:1}]});f.release.mockReset();
  f.connect.mockResolvedValue({query:f.query,release:f.release});
  f.auth.mockReset().mockImplementation((_req:any,res:any)=>res.status(401).json({error:"Authentication required"}));
});
afterEach(()=>vi.useRealTimers());
afterAll(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
describe("public health through the application middleware stack",()=>{
  it("returns real database readiness without entering downstream authentication",async()=>{
    const response=await fetch(`${origin}/api/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ready:true,dependency:"database"});
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.auth).not.toHaveBeenCalled();
    expect(f.query.mock.calls.map(c=>c[0])).toEqual([
      "BEGIN READ ONLY","SET LOCAL statement_timeout='2000ms'","SELECT 1 AS ready","ROLLBACK"]);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("returns only a safe 503 envelope on connection failure",async()=>{
    const secret="postgresql://private-user:private-password@private-host/private-db";
    f.connect.mockRejectedValue(new Error(secret));
    const response=await fetch(`${origin}/api/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ready:false,dependency:"database"});
    expect(f.auth).not.toHaveBeenCalled();
  });
  it("keeps liveness DB-independent and other API routes protected",async()=>{
    expect((await fetch(`${origin}/api/healthz`)).status).toBe(200);
    expect(f.connect).not.toHaveBeenCalled();
    expect((await fetch(`${origin}/api/private-readiness-control`)).status).toBe(401);
    expect(f.auth).toHaveBeenCalledOnce();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("coalesces repeated probes and exposes no identity or timing publicly",async()=>{
    const responses=await Promise.all([fetch(`${origin}/api/readyz`),fetch(`${origin}/api/readyz`)]);
    expect(f.connect).toHaveBeenCalledOnce();
    for(const response of responses)expect(Object.keys(await response.json() as Record<string,unknown>).sort()).toEqual(["dependency","ready"]);
  });
});
