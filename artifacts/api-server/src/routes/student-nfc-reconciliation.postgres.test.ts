import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { NFC_PREVIEW_SOURCES,previewStudentNfcReconciliation } from "../services/student-nfc-reconciliation";
import { PreviewStudentNfcReconciliationResponse } from "@workspace/api-zod";

const target=vi.hoisted(()=>({pool:null as any,connections:0}));
vi.mock("@workspace/db",()=>({pool:{connect:async()=>{target.connections++;return target.pool.connect();}}}));
vi.mock("../middlewares/auth",async importOriginal=>{
  const actual=await importOriginal<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=>(
    req:express.Request,_res:express.Response,next:express.NextFunction)=>{
      const role=req.header("x-test-role")??"PLATFORM_OWNER";
      (req as any).edupulseUser={user:{id:9,clerkUserId:"nfc-preview-fictional",email:"preview@example.test",
        firstName:"Fictional",lastName:"Reviewer",status:"ACTIVE"},
        roles:[{id:1,role,schoolId:role==="PLATFORM_OWNER"?null:1,status:req.header("x-test-status")??"ACTIVE"}]};
      next();
    }};
});
import router from "./student-nfc-reconciliation";

const root=process.env.EDUCORE_NFC_RECONCILIATION_ROOT;
const suite=root?describe:describe.skip;
suite("Owner reconciliation preview: real read-only SQL on a verified disposable target",()=>{
  let pool:Pool,server:ReturnType<typeof app.listen>,base="";
  const app=express();app.use(router);
  const names=[...Object.keys(NFC_PREVIEW_SOURCES),"flutterwave_live_collection_evidence","flutterwave_live_refund_events"];
  const common=["id","school_id","student_id","academic_session_id","academic_term_id","session_id","term_id",
    "subscription_id","legacy_invoice_id","invoice_id","payment_id","line_id","intent_id","order_reference",
    "reference","payment_reference","receipt_number","name","first_name","last_name","admission_no","admission_status",
    "term","start_date","end_date","expires_at","amount","amount_minor","gross_amount_minor","total_minor","paid_minor",
    "outstanding_minor","category_name_snapshot","description_snapshot","status","verification_status","provider_reference","kind","state","event_type"];
  beforeAll(async()=>{
    assert.equal(process.env.NODE_ENV,"test");
    assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
    assert.match(root!,/^\/tmp\/educore-nfc-reconciliation-[^/]+$/);
    const data=join(root!,"data"),socket=join(root!,"socket"),port=process.env.EDUCORE_NFC_RECONCILIATION_PORT!;
    const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
    const args=readFileSync(`/proc/${pid[0]}/cmdline`,"utf8").split("\0");
    assert.equal(args[args.indexOf("-D")+1],data);assert.equal(args[args.indexOf("-h")+1],"");
    assert.equal(statSync(join(socket,`.s.PGSQL.${port}`)).isSocket(),true);
    pool=new Pool({host:socket,port:Number(port),user:"nfc_reconciliation_qa",database:"postgres",max:2,
      connectionTimeoutMillis:2000,statement_timeout:8000});
    const identity=(await pool.query(`SELECT current_setting('data_directory') AS data,current_setting('listen_addresses') AS listen,
      current_database() AS db,current_user AS role`)).rows[0];
    assert.equal(realpathSync(identity.data),realpathSync(data));assert.equal(identity.listen,"");
    assert.equal(identity.db,"postgres");assert.equal(identity.role,"nfc_reconciliation_qa");
    target.pool=pool;
    // Deliberately minimal fictional source tables, NOT the full application schema.
    for(const name of names){
      const columns=[...new Set([...common,...(NFC_PREVIEW_SOURCES[name]??[])])].filter(c=>c!=="allocation_snapshot");
      await pool.query(`CREATE TABLE public."${name}" (${columns.map(c=>`"${c}" text`).join(",")},allocation_snapshot jsonb,on_hold boolean)`);
    }
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>{
      const address=server.address();assert(address&&typeof address==="object");
      base=`http://127.0.0.1:${address.port}`;resolve();
    });});
  });
  afterAll(async()=>{
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    if(pool)await pool.end();
  });
  beforeEach(async()=>{
    for(const name of names)await pool.query(`DELETE FROM public."${name}"`);
    await pool.query(`
      INSERT INTO schools(id,name,status) VALUES('1','Fictional Reconciliation School','ACTIVE'),('2','Unrelated School','ACTIVE');
      INSERT INTO academic_sessions(id,school_id,status) VALUES('3','1','ACTIVE');
      INSERT INTO academic_terms(id,school_id,academic_session_id,name,status,start_date,end_date)
        VALUES('4','1','3','Fictional Term','ACTIVE',(CURRENT_DATE-1)::text,(CURRENT_DATE+60)::text);
      INSERT INTO students(id,school_id,first_name,last_name,admission_no,status,admission_status)
        VALUES('31','1','Fictional','Student','QA-31','ACTIVE','ADMITTED'),('32','2','Unrelated','Student','QA-32','ACTIVE','ADMITTED');
      INSERT INTO subscriptions(id,school_id,student_id,term,amount,status,verification_status,expires_at)
        VALUES('7','1','31','Fictional Term','5000.00','pending','pending',(CURRENT_DATE+61)::text);
      INSERT INTO student_subscription_terms(school_id,student_id,academic_session_id,academic_term_id,subscription_id)
        VALUES('1','31','3','4','7');
    `);
    target.connections=0;
  });
  const report=()=>previewStudentNfcReconciliation(pool,{schoolId:1,termId:4});
  const dump=async()=>JSON.stringify(await Promise.all(names.map(async name=>[
    name,(await pool.query(`SELECT to_jsonb(r) AS row FROM public."${name}" r ORDER BY to_jsonb(r)::text`)).rows,
  ])));
  it("reads a consistent READ ONLY transaction, proposes separately, and preserves all source data",async()=>{
    const before=await dump(),sql:string[]=[];
    const wrapped={connect:async()=>{
      const c=await pool.connect();
      return{release:()=>c.release(),query:async(text:string,values?:any[])=>{
        sql.push(text);
        const r=await c.query(text,values);
        if(text.startsWith("BEGIN"))expect((await c.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
        return r;
      }};
    }};
    const r=await previewStudentNfcReconciliation(wrapped,{schoolId:1,termId:4});
    expect(PreviewStudentNfcReconciliationResponse.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({readOnly:true,applyAvailable:false,approvalRequired:true,platformAmountMinor:320000,sourceStatus:"COMPLETE"});
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({studentId:31,status:"CANDIDATE_AFTER_REVIEW",originalAmountMinor:500000,originalOutstandingMinor:500000,proposedPlatformAmountMinor:320000});
    expect(sql.every(s=>/^(?:BEGIN|SET LOCAL|SELECT|COMMIT)/.test(s))).toBe(true);
    expect(await dump()).toBe(before);
    expect((await report()).evidenceDigest).toBe(r.evidenceDigest);
  });
  it.each(["SCHOOL_ADMIN","ACCOUNTANT","TEACHER","STAFF","PARENT","STUDENT","PARTNER"])("rejects %s before acquiring a DB connection",async role=>{
    const res=await fetch(`${base}/owner/finance/student-nfc-reconciliation?schoolId=1&termId=4`,{headers:{"x-test-role":role}});
    expect(res.status).toBe(403);expect(target.connections).toBe(0);
  });
  it("rejects inactive ownership, bad scope and nonexistent school/term without writes",async()=>{
    expect((await fetch(`${base}/owner/finance/student-nfc-reconciliation?schoolId=1&termId=4`,{headers:{"x-test-status":"INACTIVE"}})).status).toBe(403);
    expect((await fetch(`${base}/owner/finance/student-nfc-reconciliation?schoolId=no&termId=4`)).status).toBe(400);
    expect(target.connections).toBe(0);
    const res=await fetch(`${base}/owner/finance/student-nfc-reconciliation?schoolId=2&termId=4`);
    expect(res.status).toBe(404);
  });
  it("serves the Owner report with no-store and never provides an apply route",async()=>{
    const r=await fetch(`${base}/owner/finance/student-nfc-reconciliation?schoolId=1&termId=4`);
    expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json() as any).applyAvailable).toBe(false);
    expect((await fetch(`${base}/owner/finance/student-nfc-reconciliation`,{method:"POST"})).status).toBe(404);
  });
  it("holds missing sources instead of assuming no old payment",async()=>{
    await pool.query("ALTER TABLE hosted_checkout_events RENAME TO fixture_saved_hosted_events");
    try{
      const r=await report();expect(r.sourceStatus).toBe("INCOMPLETE");
      expect(r.rows[0].status).toBe("OWNER_REVIEW");expect(r.rows[0].proposedPlatformAmountMinor).toBeNull();
      expect(r.sources.find(s=>s.name==="hosted_checkout_events")?.issues).toContain("TABLE_NOT_AVAILABLE");
    }finally{await pool.query("ALTER TABLE fixture_saved_hosted_events RENAME TO hosted_checkout_events");}
  });
  it("holds schema drift and restores the connection after the read transaction",async()=>{
    await pool.query("ALTER TABLE subscriptions RENAME COLUMN amount TO fixture_saved_amount");
    try{expect((await report()).sourceStatus).toBe("INCOMPLETE");}
    finally{await pool.query("ALTER TABLE subscriptions RENAME COLUMN fixture_saved_amount TO amount");}
    expect((await report()).rows[0].status).toBe("CANDIDATE_AFTER_REVIEW");
  });
  it("finds hosted provider evidence without school_id on the child table",async()=>{
    await pool.query(`INSERT INTO hosted_checkout_orders(reference,school_id,student_id,subscription_id,term_id)
      VALUES('HOSTED-ORIGINAL','1','31','7','4');
      INSERT INTO hosted_checkout_events(order_reference,kind) VALUES('HOSTED-ORIGINAL','PAYMENT_VERIFIED')`);
    const r=await report();expect(r.rows[0].status).toBe("PRESERVE_COMPLETED_HISTORY");
    expect(r.rows[0].proposedPlatformAmountMinor).toBeNull();
  });
  it("discovers LIVE child evidence by intent id without mutating its original reference",async()=>{
    await pool.query(`INSERT INTO flutterwave_live_subscription_intents(id,school_id,student_id,term_id,reference,state)
      VALUES('9','1','31','4','SCV3_ORIGINAL','PENDING');
      INSERT INTO flutterwave_live_refund_events(intent_id,event_type) VALUES('9','DISPUTE')`);
    const before=await dump(),r=await report();
    expect(r.sources.find(s=>s.name==="flutterwave_live_refund_events")?.recordCount).toBe(1);
    expect(r.rows[0].status).toBe("OWNER_REVIEW");expect(r.rows[0].reasons).toContain("REFUND_DISPUTE_OR_ADJUSTMENT_REQUIRES_REVIEW");
    expect(await dump()).toBe(before);
  });
  it("keeps parent cash evidence and outstanding school fee separate from proposed platform debt",async()=>{
    await pool.query(`INSERT INTO fee_invoices(id,school_id,student_id,academic_session_id,academic_term_id,total_minor,paid_minor,outstanding_minor)
      VALUES('11','1','31','3','4','900000','400000','500000');
      INSERT INTO fee_invoice_lines(id,school_id,invoice_id,category_name_snapshot) VALUES('12','1','11','NFC Card & EduCore Subscription Fee');
      INSERT INTO fee_payments(id,school_id,invoice_id,status,amount_minor,reference) VALUES('13','1','11','VERIFIED','400000','PARENT-CASH');
      INSERT INTO fee_receipts(school_id,invoice_id,payment_id,receipt_number) VALUES('1','11','13','KEEP-RECEIPT')`);
    const row=(await report()).rows[0];
    expect(row).toMatchObject({status:"OWNER_REVIEW",schoolFeeTotalMinor:900000,schoolFeePaidMinor:400000,schoolFeeOutstandingMinor:500000,
      originalAmountMinor:500000,originalOutstandingMinor:null,proposedPlatformAmountMinor:null,receiptNumbers:["KEEP-RECEIPT"]});
  });
  it("detects duplicate obligations and digest changes from newly appended history",async()=>{
    const before=await report();
    await pool.query(`INSERT INTO subscriptions(id,school_id,student_id,term,amount,status,verification_status,expires_at)
      SELECT '8',school_id,student_id,term,amount,status,verification_status,expires_at FROM subscriptions WHERE id='7'`);
    const after=await report();
    expect(after.rows[0].reasons).toContain("DUPLICATE_OBLIGATIONS");
    expect(after.evidenceDigest).not.toBe(before.evidenceDigest);
  });
  it("flags orphaned historical obligations instead of dropping them from the report",async()=>{
    await pool.query("DELETE FROM students WHERE id='31'");
    const r=await report();
    expect(r.sourceStatus).toBe("INCOMPLETE");expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({studentId:31,status:"OWNER_REVIEW",proposedPlatformAmountMinor:null});
    expect(r.sources.find(s=>s.name==="students")?.issues).toContain("ORPHANED_FINANCIAL_SUBJECT_REQUIRES_REVIEW");
  });
  it("never issues safe candidates if a source was truncated",async()=>{
    await pool.query(`INSERT INTO flutterwave_live_refund_events(id,school_id,student_id,term_id)
      SELECT n::text,'1','31','4' FROM generate_series(1,5001) n`);
    const r=await report();
    expect(r.sourceStatus).toBe("INCOMPLETE");expect(r.rows[0].status).toBe("OWNER_REVIEW");
    expect(r.sources.find(s=>s.name==="flutterwave_live_refund_events")?.issues).toContain("SOURCE_TRUNCATED_NO_CONVERSION_ALLOWED");
  });
  it("treats row-security-hidden evidence as incomplete, not as a clean unpaid history",async()=>{
    await pool.query(`CREATE ROLE nfc_preview_limited NOLOGIN;
      GRANT USAGE ON SCHEMA public TO nfc_preview_limited;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO nfc_preview_limited;
      ALTER TABLE students ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_hide_students ON students USING(false)`);
    const pinned=await pool.connect();
    try{
      await pinned.query("SET ROLE nfc_preview_limited");
      const r=await previewStudentNfcReconciliation({connect:async()=>({
        query:(sql:string,values?:any[])=>pinned.query(sql,values),release:()=>undefined,
      })},{schoolId:1,termId:4});
      expect(r.sourceStatus).toBe("INCOMPLETE");
      expect(r.sources.find(s=>s.name==="students")?.issues).toContain("ROW_SECURITY_MAY_HIDE_EVIDENCE");
      expect(r.rows[0].status).toBe("OWNER_REVIEW");
    }finally{
      await pinned.query("RESET ROLE");pinned.release();
      await pool.query("DROP POLICY fixture_hide_students ON students; ALTER TABLE students DISABLE ROW LEVEL SECURITY");
    }
  });
});
