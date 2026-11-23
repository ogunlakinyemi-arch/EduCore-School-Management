import {it,expect,vi} from "vitest";
const calls=vi.hoisted(()=>({pool:{connect:vi.fn()}}));
vi.mock("@workspace/db",()=>({pool:calls.pool}));
vi.mock("../middlewares/auth",()=>({
 requireAuthentication:()=> (_req:any,_res:any,next:any)=>next(),
 assertRoles:(req:any,roles:string[])=>{
   if(!roles.includes(req.testRole))throw Object.assign(new Error("ACCESS_DENIED"),{statusCode:403});
   return {user:{id:1},roles:[]};
 },
 AuthError:class extends Error{},
}));
import {createCurrentFinanceRouter} from "./current-finance";
const router=createCurrentFinanceRouter(calls.pool);
const handler=(router as any).stack.find((l:any)=>l.route?.path==="/current-finance/actions").route.stack[0].handle;
async function invoke(role:string,body:any){
 const res:any={locals:{currentActorId:1},statusCode:200,status(n:number){this.statusCode=n;return this;},
  json(v:any){this.body=v;return this;}};
 await handler({testRole:role,body},res);return res;
}
it.each(["PARTNER","SCHOOL_ADMIN","ACCOUNTANT","PARENT"])("rejects Owner-only actions for %s before touching the database",async role=>{
 calls.pool.connect.mockClear();
 const res=await invoke(role,{action:"REFUND_REQUEST",payload:{source:"DIRECT",sourceId:1,amountMinor:10000,
  key:"fictional_request_00001",reason:"Fictional reason"}});
 expect(res.statusCode).toBe(403);expect(calls.pool.connect).not.toHaveBeenCalled();
});
it("rejects unknown commands and client-supplied settlement evidence before any service",async()=>{
 calls.pool.connect.mockClear();
 for(const body of [{action:"MARK_PAID",payload:{}},{action:"REFUND_REQUEST",payload:{source:"DIRECT",sourceId:1,amountMinor:10000,
  key:"fictional_request_00001",reason:"Fictional reason",settled:true}},
 {action:"WITHDRAW_REQUEST",payload:{entitlementKeys:["D:1"],key:"fictional_request_00001",reason:"Fictional reason"}}]){
  const r=await invoke("PLATFORM_OWNER",body);expect([400,403]).toContain(r.statusCode);
 }
 expect(calls.pool.connect).not.toHaveBeenCalled();
});
it("rejects the provider's unsupported sub-minimum refund before creating a protective hold",async()=>{
 calls.pool.connect.mockClear();
 const r=await invoke("PLATFORM_OWNER",{action:"REFUND_REQUEST",payload:{source:"DIRECT",sourceId:1,amountMinor:50,
  key:"fictional_request_00001",reason:"Fictional reason"}});
 expect(r.body.error).toBe("REFUND_MINIMUM_NGN_100");expect(calls.pool.connect).not.toHaveBeenCalled();
});
