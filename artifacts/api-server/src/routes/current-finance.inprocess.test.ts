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
const assistanceHandler=(router as any).stack.find((l:any)=>l.route?.path==="/current-finance/school-assistance").route.stack[0].handle;
it("accepts the Owner, coerces filter/page inputs and validates the returned request document",async()=>{
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes("FROM app_users u WHERE"))return {rows:[{id:1,owner:true,partner_id:null}]};
  if(sql.includes("FROM schools s ORDER"))return {rows:[{id:4,name:"Fictional school"}]};
  if(sql.includes("to_regclass"))return {rows:[{available:true,credits:false}]};
  if(sql.includes("count(*) AS total"))return {rows:[{total:"7"}]};
  return {rows:[]};
 });
 calls.pool.connect.mockResolvedValueOnce({query,release:vi.fn()});
 const res:any={statusCode:200,status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;}};
 await assistanceHandler({testRole:"PLATFORM_OWNER",query:{schoolId:"4",page:"2",pageSize:"5"}},res);
 expect(res.statusCode).toBe(200);
 expect(res.body).toMatchObject({page:2,pageSize:5,total:7,storageAvailable:true,batches:[]});
 expect(query.mock.calls.some(call=>call[0].includes("LIMIT $2 OFFSET $3"))).toBe(true);
 const listCall=(query.mock.calls as any[]).find(call=>call[0].includes("LIMIT $2 OFFSET $3"));
 expect(listCall[1]).toEqual([4,5,5]);
});
it.each(["PARTNER","SCHOOL_ADMIN","ACCOUNTANT","PARENT","TEACHER"])("denies school-assistance listing to %s before database access",async role=>{
 calls.pool.connect.mockClear();
 const res:any={status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;}};
 await assistanceHandler({testRole:role,query:{}},res);
 expect(res.statusCode).toBe(403);expect(calls.pool.connect).not.toHaveBeenCalled();
});
it.each([{schoolId:"no"},{schoolId:"0"},{schoolId:"1.5"},{page:"0"},{pageSize:"101"},{page:"1000001"}])(
 "rejects invalid assistance filters/pagination %j before database access",async query=>{
 calls.pool.connect.mockClear();
 const res:any={status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;}};
 await assistanceHandler({testRole:"PLATFORM_OWNER",query},res);
 expect(res.statusCode).toBe(400);expect(calls.pool.connect).not.toHaveBeenCalled();
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
it.each(["PARTNER","SCHOOL_ADMIN","ACCOUNTANT","TEACHER","PARENT"])("blocks bank reveal and external payout recording for %s before any database or provider access",async role=>{
 for(const command of [
   {action:"PAYOUT_BANK_REVEAL",payload:{id:1,key:"fictional_reveal_key",reason:"Check beneficiary"}},
   {action:"PAYOUT_RECORD_EXTERNAL",payload:{ids:[1],amountMinor:15000,key:"fictional_external_key",
     reason:"Reviewed bank statement",transferReference:"FICTIONAL-TRANSFER",statementReference:"FICTIONAL-STATEMENT",
     transferDate:"2026-11-01",confirmExternalTransfer:true,independentlyChecked:true}}
 ]){
   calls.pool.connect.mockClear();
   expect((await invoke(role,command)).statusCode).toBe(403);
   expect(calls.pool.connect).not.toHaveBeenCalled();
 }
});
