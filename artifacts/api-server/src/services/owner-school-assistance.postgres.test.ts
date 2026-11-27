import {readFileSync} from "node:fs";
import {join} from "node:path";
import {beforeAll,afterAll,beforeEach,expect,it,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{query:()=>{throw Error("Application database forbidden");}}}));
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {readOwnerSchoolAssistance} from "./owner-school-assistance";
let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
const calls:string[]=[];
const pool={connect:async()=>{
 const c=await f.pool.connect();
 return {release:()=>c.release(),query:async(sql:string,values?:any[])=>{calls.push(sql);return c.query(sql,values);}};
}};
beforeAll(async()=>{
 f=await currentFinancialFixture();
 await f.pool.query(`ALTER TABLE schools ADD COLUMN name text DEFAULT 'Fictional school';
  ALTER TABLE partner_profiles ADD COLUMN user_id integer;
  INSERT INTO schools(id,name) VALUES(3,'Empty fictional school');`);
},60000);
afterAll(async()=>{await f?.stop();});
beforeEach(()=>{calls.length=0;});
it("loads school options and explicitly distinguishes absent request storage from an empty list",async()=>{
 expect(await readOwnerSchoolAssistance(pool,1)).toMatchObject({
  storageAvailable:false,total:0,batches:[],page:1,pageSize:20,schools:expect.arrayContaining([{id:3,name:"Empty fictional school"}]),
 });
 expect(calls.join("\n")).not.toMatch(/pg_trigger|FROM current_subscription_operations/);
});
it("reads real PostgreSQL all-school requests without write-readiness or BRO ledger dependencies",async()=>{
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql"),"utf8"));
 await f.pool.query(`INSERT INTO student_direct_live_reviews(id,school_id,academic_term_id,rule_id,report_digest,
   merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
  VALUES(1,1,1,1,repeat('a',64),'fixture',true,1,now()+interval '1 year','Fictional request fixture'),
        (2,2,2,1,repeat('b',64),'fixture',true,1,now()+interval '1 year','Fictional request fixture');
  INSERT INTO students(id,school_id,status,admission_status)
   SELECT n,CASE WHEN n<30 THEN 1 ELSE 2 END,'ACTIVE','ADMITTED' FROM generate_series(10,32) n;
  INSERT INTO current_payment_batches(id,school_id,academic_term_id,reference,request_key,amount_minor,created_by,snapshot)
   SELECT n,CASE WHEN n<30 THEN 1 ELSE 2 END,CASE WHEN n<30 THEN 1 ELSE 2 END,
    'FICTIONAL-REQUEST-'||n,'fictional-request-key-'||n,320000,1,
    jsonb_build_object('method','COMPANY_BANK','students',jsonb_build_array(
     jsonb_build_object('studentId',n,'reviewId',CASE WHEN n<30 THEN 1 ELSE 2 END,
      'studentName','Fictional student '||n))) FROM generate_series(10,32) n;
  INSERT INTO current_bulk_allocations(batch_id,school_id,student_id,academic_term_id,review_id)
   SELECT id,school_id,id,academic_term_id,school_id FROM current_payment_batches;
  INSERT INTO current_bulk_events(batch_id,event_key,state,actor_user_id)
   SELECT id,'fictional-request-'||id,'REQUESTED',1 FROM current_payment_batches;
  INSERT INTO current_payment_batches(school_id,academic_term_id,reference,request_key,amount_minor,created_by,snapshot)
   VALUES(1,1,'FICTIONAL-ONLINE','fictional-online-key',320000,1,'{"method":"FLUTTERWAVE","students":[]}');`);
 const result=await readOwnerSchoolAssistance(pool,1);
 expect(result).toMatchObject({storageAvailable:true,total:23,page:1,pageSize:20});
 expect(result.batches).toHaveLength(20);
 expect(new Set(result.batches.map(b=>b.schoolId))).toEqual(new Set([1,2]));
 expect(result.batches.every(b=>b.method==="COMPANY_BANK"&&b.state==="REQUESTED"&&!b.bankProof&&b.checkoutUrl===null)).toBe(true);
 expect(result.batches[0].items[0]).toMatchObject({state:"UNRESOLVED",studentName:"Fictional student 32"});
 expect(JSON.stringify(result)).not.toMatch(/broAccrualPending|commission|earnedMinor|platformFee|broShare/);
 expect(calls.every(s=>/^(BEGIN|SET LOCAL|SELECT|COMMIT|ROLLBACK)\b/.test(s))).toBe(true);
 expect(calls.join("\n")).not.toMatch(/pg_trigger|FROM current_subscription_operations/);
});
it("paginates deterministically across all schools without duplicates",async()=>{
 const a=await readOwnerSchoolAssistance(pool,1,undefined,1,20),b=await readOwnerSchoolAssistance(pool,1,undefined,2,20);
 expect(b).toMatchObject({total:23,page:2,pageSize:20});
 expect(b.batches).toHaveLength(3);
 expect(new Set([...a.batches,...b.batches].map(b=>b.id)).size).toBe(23);
 expect(b.batches.map(b=>b.id)).toEqual([12,11,10]);
});
it("filters server-side while preserving the full school selector",async()=>{
 const result=await readOwnerSchoolAssistance(pool,1,2,1,2);
 expect(result).toMatchObject({total:3,pageSize:2});
 expect(result.batches).toHaveLength(2);
 expect(result.batches.every(b=>b.schoolId===2)).toBe(true);
 expect(result.schools).toHaveLength(3);
 expect((await readOwnerSchoolAssistance(pool,1,2,2,2)).batches).toHaveLength(1);
});
it("returns a genuine empty school and an out-of-range page without inventing requests",async()=>{
 expect(await readOwnerSchoolAssistance(pool,1,3)).toMatchObject({storageAvailable:true,total:0,batches:[]});
 expect(await readOwnerSchoolAssistance(pool,1,2,99)).toMatchObject({total:3,batches:[]});
 await expect(readOwnerSchoolAssistance(pool,1,999)).rejects.toMatchObject({code:"SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED"});
});
it.each([2,3,4,5])("denies non-Owner actor %s before listing requests",async actor=>{
 await expect(readOwnerSchoolAssistance(pool,actor)).rejects.toMatchObject({code:"OWNER_ASSISTANCE_ACCESS_DENIED"});
 expect(calls.some(s=>s.includes("FROM current_payment_batches"))).toBe(false);
});
it("rejects an inactive Owner and surfaces actual query failures instead of returning an empty list",async()=>{
 await f.pool.query(`INSERT INTO app_users(id,status) VALUES(8,'INACTIVE');
  INSERT INTO school_memberships VALUES(8,NULL,'PLATFORM_OWNER','ACTIVE');`);
 await expect(readOwnerSchoolAssistance(pool,8)).rejects.toMatchObject({code:"CURRENT_FINANCE_ACCESS_DENIED"});
 const broken={connect:async()=>{const c=await pool.connect();return {...c,query:async(sql:string,v?:any[])=>{
  if(sql.includes("count(*) AS total"))throw Error("Fictional unavailable query");return c.query(sql,v);
 }};}};
 await expect(readOwnerSchoolAssistance(broken,1)).rejects.toThrow("Fictional unavailable query");
 expect(calls.at(-1)).toBe("ROLLBACK");
});
