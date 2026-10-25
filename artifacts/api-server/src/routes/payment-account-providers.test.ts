import express from "express";
import type {Server} from "node:http";
import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("../middlewares/auth",()=>{
  class AuthError extends Error {constructor(readonly status:number,message:string){super(message);}}
  return {AuthError,requireAuthentication:()=>(req:any,res:any,next:any)=>{
    if(req.header("x-anonymous"))res.sendStatus(401);else next();
  }};
});
import {paymentAccountProviders,requireVerifiedPaymentAccountProvider,type PaymentAccountProviderDirectory} from "../lib/nigerian-payment-providers";
import {FlutterwavePayrollV3Client} from "../lib/flutterwave-payroll-v3";
import {createPaymentAccountProvidersRouter} from "./payment-account-providers";

// Synthetic codes belong only to fictional catalogue fixtures; never real routing evidence.
const banks=[{name:"Fictional Commercial Bank",code:"099"},
  {name:"Fictional Microfinance Bank",code:"900001"},{name:"Fictional Digital Provider",code:"900002"}];
let server:Server|undefined;
afterEach(async()=>{
  if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}
});
async function start(listNigerianBanks:ReturnType<typeof vi.fn>){
  const app=express();
  app.use(createPaymentAccountProvidersRouter({listNigerianBanks} as any));
  await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
  return `http://127.0.0.1:${(server!.address() as any).port}/payment-account-providers`;
}
describe("canonical institution directory without fabricated transfer support",()=>{
  it("offers Moniepoint, OPay and PalmPay for discovery with no invented codes",()=>{
    const directory=paymentAccountProviders(null,null);
    expect(directory.status).toBe("UNAVAILABLE");
    for(const id of ["moniepoint","opay","palmpay"]){
      expect(directory.providers.find(p=>p.id===`directory:${id}`))
        .toMatchObject({code:null,transferCodeVerified:false});
    }
    expect(directory.providers.every(p=>p.code===null&&!p.transferCodeVerified)).toBe(true);
  });
  it("keeps every commercial/MFB/digital catalogue entry and its exact stable code",()=>{
    const directory=paymentAccountProviders(banks,"TEST");
    expect(directory).toMatchObject({status:"AVAILABLE",catalogueEnvironment:"TEST"});
    for(const bank of banks)expect(directory.providers.find(p=>p.code===bank.code))
      .toMatchObject({id:`flutterwave:${bank.code}`,name:bank.name,transferCodeVerified:true});
    expect(directory.providers.find(p=>p.code==="099")?.code).toBe("099");
    expect(directory.message).toContain("does not confirm");
  });
  it("does not substitute another provider's long institution code for a compatible transfer code",()=>{
    const entry=paymentAccountProviders([{name:"Fictional Long Code MFB",code:"900000001"}],"TEST")
      .providers.find(p=>p.name==="Fictional Long Code MFB");
    expect(entry).toEqual({id:"flutterwave:900000001",name:"Fictional Long Code MFB",code:null,transferCodeVerified:false});
  });
  it.each([
    [{name:"Fictional Bank",code:99}],
    [{name:"Fictional Bank",code:"bad"}],
    [{name:"Fictional Bank",code:"099"},{name:"Different Fictional Bank",code:"099"}],
  ])("rejects missing-leading-zero guesses and ambiguous catalogue codes",(...entries)=>{
    expect(()=>paymentAccountProviders(entries,"TEST")).toThrow();
  });
  it("deduplicates exact same entries without creating a second institution",()=>{
    const rows=paymentAccountProviders([banks[0],banks[0]],"TEST").providers;
    expect(rows.filter(p=>p.code==="099")).toHaveLength(1);
  });
  it("retains exact provider names and distinct routes instead of merging aliases",()=>{
    const rows=paymentAccountProviders([
      {name:"Fictional PalmPay Business",code:"900003"},
      {name:"Fictional PalmPay Personal",code:"900004"},
      {name:"Fictional KUDA MFB",code:"900005"},
      {name:"Fictional Paga Mobile",code:"900006"},
    ],"TEST").providers;
    for(const [name,code] of [["Fictional PalmPay Business","900003"],["Fictional PalmPay Personal","900004"],
      ["Fictional KUDA MFB","900005"],["Fictional Paga Mobile","900006"]])
      expect(rows.find(p=>p.code===code)).toMatchObject({name,transferCodeVerified:true});
    expect(rows.find(p=>p.id==="directory:palmpay")).toMatchObject({code:null,transferCodeVerified:false});
  });
  it("accepts only the exact provider name/code pair and fails closed on directory loss",async()=>{
    const client={listNigerianBanks:vi.fn(async()=>({banks,environment:"TEST" as const}))};
    await expect(requireVerifiedPaymentAccountProvider({bankName:banks[0].name,bankCode:"099"},client)).resolves.toBeUndefined();
    for(const selection of [{bankName:"Free text",bankCode:"099"},{bankName:banks[0].name,bankCode:"99"},
      {bankName:banks[0].name,bankCode:"900001"},{bankName:"PalmPay",bankCode:"900001"}])
      await expect(requireVerifiedPaymentAccountProvider(selection,client)).rejects.toThrow("confirmed code");
    client.listNigerianBanks.mockRejectedValueOnce(Error("private failure"));
    await expect(requireVerifiedPaymentAccountProvider({bankName:banks[0].name,bankCode:"099"},client))
      .rejects.toThrow("directory is unavailable");
  });
});
describe("authenticated directory HTTP contract, no database/provider mutations",()=>{
  it("does not call the catalogue for anonymous requests",async()=>{
    const read=vi.fn();
    const url=await start(read);
    expect((await fetch(url,{headers:{"x-anonymous":"yes"}})).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("shares one cached read across Owner, Admin, teacher/staff and Partner",async()=>{
    const read=vi.fn(async()=>({banks,environment:"TEST"})),url=await start(read);
    for(const role of ["PLATFORM_OWNER","SCHOOL_ADMIN","TEACHER","STAFF","PARTNER"]){
      const response=await fetch(url,{headers:{"x-role":role}});
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({status:"AVAILABLE",catalogueEnvironment:"TEST"});
    }
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("fails closed on provider errors without exposing upstream secrets or error bodies",async()=>{
    const read=vi.fn(async()=>{throw Error("private upstream failure must not escape");}),url=await start(read);
    const result=await (await fetch(url)).json() as PaymentAccountProviderDirectory;
    expect(result).toMatchObject({status:"UNAVAILABLE",catalogueEnvironment:null});
    expect(JSON.stringify(result)).not.toContain("private upstream");
    expect(result.providers.every((p:any)=>p.code===null&&!p.transferCodeVerified)).toBe(true);
    await fetch(url);expect(read).toHaveBeenCalledTimes(2);
  });
  it("recovers immediately on explicit retry after an unavailable response",async()=>{
    const read=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({banks,environment:"TEST"});
    const url=await start(read);
    expect(await (await fetch(url)).json()).toMatchObject({status:"UNAVAILABLE"});
    expect(await (await fetch(url)).json()).toMatchObject({status:"AVAILABLE"});
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("rejects a malformed upstream catalogue as unavailable rather than partially trusting it",async()=>{
    const url=await start(vi.fn(async()=>({banks:[...banks,{name:"Malformed"}],environment:"LIVE"})));
    const result=await (await fetch(url)).json() as PaymentAccountProviderDirectory;
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.providers.every((p:any)=>p.code===null)).toBe(true);
  });
});
describe("existing Flutterwave transport, fictional HTTP only",()=>{
  const env={NODE_ENV:"development",EDUCORE_FLUTTERWAVE_MODE:"TEST",
    FLUTTERWAVE_SECRET_Test_Key:"FLWSECK_TEST-fictional-bank-directory"};
  it("only GETs the documented bank catalogue and preserves string codes",async()=>{
    const request=vi.fn(async()=>new Response(JSON.stringify({status:"success",data:banks})));
    expect(await new FlutterwavePayrollV3Client(env,request).listNigerianBanks())
      .toEqual({environment:"TEST",banks});
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(["https://api.flutterwave.com/v3/banks/NG?include_provider_type=1",
      expect.objectContaining({method:"GET",redirect:"error",headers:expect.objectContaining({authorization:`Bearer ${env.FLUTTERWAVE_SECRET_Test_Key}`})})]);
  });
  it("reads LIVE metadata with the standard dedicated key without enabling payroll or checkout",async()=>{
    const liveEnv={NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fictional-directory-only"};
    const request=vi.fn(async()=>new Response(JSON.stringify({status:"success",data:banks})));
    const client=new FlutterwavePayrollV3Client(liveEnv,request);
    expect(client.capability().transferCapability).toBe("NOT_CONFIGURED");
    expect(await client.listNigerianBanks()).toEqual({environment:"LIVE",banks});
    expect(request.mock.calls[0]).toEqual([expect.stringContaining("include_provider_type=1"),
      expect.objectContaining({headers:expect.objectContaining({authorization:`Bearer ${liveEnv.FLUTTERWAVE_LIVE_SECRET_KEY}`})})]);
    expect(client.capability().transferCapability).toBe("NOT_CONFIGURED");
  });
  it.each([401,403,429,500])("returns safe actionable diagnostics for provider HTTP %s",async status=>{
    const client=new FlutterwavePayrollV3Client(env,vi.fn(async()=>new Response(JSON.stringify({status:"error",message:"private response"}),{status})));
    const url=await start(vi.fn(()=>client.listNigerianBanks()));
    const result=await (await fetch(url)).json() as PaymentAccountProviderDirectory;
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.message).toContain(status===401||status===403?"authentication":status===429?"rate-limited":"retry");
    expect(JSON.stringify(result)).not.toContain("private response");
    expect(JSON.stringify(result)).not.toContain(env.FLUTTERWAVE_SECRET_Test_Key);
  });
  it("allows dedicated TEST directory reads in Production without activating payments",async()=>{
    const request=vi.fn(async()=>new Response(JSON.stringify({status:"success",data:banks})));
    const client=new FlutterwavePayrollV3Client({...env,NODE_ENV:"production"},request);
    expect(await client.listNigerianBanks()).toEqual({environment:"TEST",banks});
    expect(client.capability().transferCapability).toBe("NOT_CONFIGURED");
  });
  it.each([{}, {...env,EDUCORE_FLUTTERWAVE_MODE:"LIVE"},
    {...env,FLUTTERWAVE_TEST_SECRET_KEY:"FLWSECK_TEST-conflicting-fictional-key"},
    {NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",FLUTTERWAVE_SECRET_KEY:"FLWSECK-fictional-generic-only"}])(
    "never uses a default, TEST-to-LIVE fallback or unapproved live credential",async blocked=>{
      const request=vi.fn();
      await expect(new FlutterwavePayrollV3Client(blocked,request).listNigerianBanks()).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    });
});
