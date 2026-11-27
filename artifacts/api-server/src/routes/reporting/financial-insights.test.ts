import {beforeEach,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({query:vi.fn(),run:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:f.query}}));
vi.mock("./business",()=>({finance:{filters:["schoolId","from","to","sessionId","termId","limit","offset"],run:f.run}}));
import {financialInsights} from "./financial-insights";
beforeEach(()=>{
 f.query.mockReset();f.run.mockReset();
 f.query.mockImplementation(async(sql:string)=>({rows:sql.includes("count(*)")?[{total:2}]:[{id:8,name:"School A"},{id:9,name:"School B"}]}));
 f.run.mockImplementation(async(context:any)=>({summary:{totalCollectedMinor:context.schoolId===8?"1000":context.schoolId===9?"2000":"3000",
   totalOutstandingMinor:"9000",totalWaiverMinor:"500"},rows:[],columns:[],total:0,title:"Existing fee report"}));
});
it("reuses the same source definitions for full-scope totals and each school's breakdown with every filter preserved",async()=>{
 const filters={from:"2026-01-01",to:"2026-03-31",sessionId:2,termId:3,limit:20,offset:0};
 const r=await financialInsights.run({role:"OWNER",userId:1,schoolId:null,req:{}} as any,filters);
 expect(r.summary?.totalCollectedMinor).toBe("3000");
 expect(r.rows.map(row=>row.totalCollectedMinor)).toEqual(["1000","2000"]);
 expect(r.total).toBe(2);
 for(const call of f.run.mock.calls)expect(call[1]).toMatchObject({...filters,limit:1,offset:0});
 expect(f.run.mock.calls.map(call=>call[0].schoolId)).toEqual([null,8,9]);
 expect(financialInsights.roles).toEqual(["OWNER"]);
});
it("does not infer zero when source evidence is unavailable, nor execute queries for another role",async()=>{
 f.run.mockResolvedValue({rows:[]});
 await expect(financialInsights.run({role:"OWNER",schoolId:null} as any,{limit:20,offset:0})).rejects.toThrow("could not be confirmed");
 f.run.mockClear();f.query.mockClear();
 await expect(financialInsights.run({role:"ADMIN",schoolId:8} as any,{limit:20,offset:0})).rejects.toThrow("Platform Owner");
 expect(f.run).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
});
