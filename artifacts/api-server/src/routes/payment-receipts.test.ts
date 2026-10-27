import express from "express";
import { createServer, type Server } from "node:http";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({
  ctx:{user:{id:20,email:"fixture@example.test",clerkUserId:"fixture",status:"ACTIVE"},
    roles:[{role:"PARENT",schoolId:7,status:"ACTIVE"}]} as any,
  receipts:new Map<string,any>(),files:new Map<string,Buffer>(),calls:[] as string[],audits:[] as unknown[],
  linked:true,paid:true,saveCount:0,
  settlements:[] as any[],
}));
async function query(sql:string,p:any[]=[]):Promise<{rows:any[]}>{
  const s=sql.replace(/\s+/g," ").trim();state.calls.push(s);
  if(["BEGIN","COMMIT","ROLLBACK"].includes(s)||s.includes("pg_advisory_xact_lock"))return{rows:[]};
  if(s.startsWith("INSERT INTO audit_logs")){state.audits.push(p);return{rows:[]};}
  if(s.includes("FROM fee_invoices i JOIN parents"))return{rows:state.linked?[{id:4,school_id:7,student_id:8,academic_term_id:9,outstanding_minor:500000,status:"UNPAID"}]:[]};
  if(s.includes("FROM parents p JOIN parent_student_relationships"))return{rows:state.linked?[{ok:1}]:[]};
  if(s.startsWith("SELECT o.*"))return{rows:[{reference:p[0],school_id:7,student_id:8,term_id:9,bro_profile_id:null,
    snapshot:{studentName:"Fixture",termName:"Term 1"},environment:"TEST",created_at:new Date()}]};
  if(s.startsWith("SELECT c.relname"))return{rows:["hosted_checkout_orders","hosted_checkout_events"].map(relname=>({relname,tgtype:58,prosrc:HOSTED_HISTORY_GUARD_BODY}))};
  if(s.startsWith("SELECT external_reference,proof_sha256"))return{rows:state.settlements.filter(e=>e.order_reference===p[0]&&e.kind===p[1])};
  if(s.startsWith("INSERT INTO hosted_checkout_events")){
    const row={id:p[0],order_reference:p[1],environment:p[2],kind:p[3],actor_id:p[5],amount_minor:p[7],
      external_reference:p[9],proof_sha256:p[10],data:JSON.parse(p[11]),created_at:new Date()};
    state.settlements.push(row);return{rows:[{id:p[0]}]};
  }
  if(s.includes("FROM hosted_checkout_events"))return{rows:state.paid?[{kind:"PAYMENT_VERIFIED",fee_minor:0,created_at:new Date()},...state.settlements]:[]};
  if(s.startsWith("INSERT INTO payment_receipt_uploads")){
    const row={id:p[0],kind:p[1],target_id:p[2],school_id:p[3],student_id:p[4],term_id:p[5],
      amount_minor:p[6],purpose:p[7],transfer_date:p[8],uploaded_by:p[9],state:"STAGED"};
    state.receipts.set(row.id,row);return{rows:[row]};
  }
  if(s.startsWith("SELECT * FROM payment_receipt_uploads WHERE kind="))return{rows:[...state.receipts.values()].filter(r=>r.kind===p[0]&&r.target_id===p[1]&&r.sha256===p[2]&&r.state==="AVAILABLE")};
  if(s.startsWith("SELECT * FROM payment_receipt_uploads WHERE id=")){
    const row=state.receipts.get(p[0]);return{rows:row&&(!s.includes("state='AVAILABLE'")||row.state==="AVAILABLE")?[row]:[]};
  }
  if(s.startsWith("UPDATE payment_receipt_uploads SET state='DUPLICATE'")){
    Object.assign(state.receipts.get(p[0]),{state:"DUPLICATE",canonical_receipt_id:p[1]});return{rows:[]};
  }
  if(s.startsWith("UPDATE payment_receipt_uploads SET state='AVAILABLE'")){
    const row=state.receipts.get(p[0]);Object.assign(row,{state:"AVAILABLE",object_path:p[1],content_type:p[2],
      size_bytes:p[3],sha256:p[4],uploaded_at:new Date()});return{rows:[row]};
  }
  throw new Error(`Unmodelled fixture SQL: ${s.slice(0,90)}`);
}
vi.mock("@workspace/db",()=>({pool:{connect:async()=>({query,release(){}})}}));
vi.mock("../middlewares/auth",()=>({getUserContext:()=>state.ctx,requireAuthentication:()=> (_req:any,_res:any,next:any)=>next()}));
vi.mock("../services/payment-receipt-storage",async()=>{
  const actual=await vi.importActual<any>("../services/payment-receipt-storage");
  return{...actual,privateReceiptStorage:{
    save:async(id:string,bytes:Buffer)=>{state.saveCount++;state.files.set(id,bytes);return`financial-receipts/${id}`;},
    read:async(id:string)=>state.files.get(id),
  }};
});
import { paymentReceiptsRouter } from "./payment-receipts";
import { validateReceiptBytes } from "../services/payment-receipt-storage";
import { requireParentReceipt } from "../services/payment-receipts";
import { HOSTED_HISTORY_GUARD_BODY } from "../lib/hosted-manual-policy";
import { HostedManualPayments } from "../services/hosted-manual-payments";

let server:Server,base:string,png:Buffer;
beforeAll(async()=>{
  png=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();
  const app=express();app.use(express.json());app.use("/api/payment-receipts",paymentReceiptsRouter);
  server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  base=`http://127.0.0.1:${(server.address() as any).port}/api/payment-receipts`;
});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
beforeEach(()=>{
  state.ctx={user:{id:20,email:"fixture@example.test",clerkUserId:"fixture",status:"ACTIVE"},roles:[{role:"PARENT",schoolId:7,status:"ACTIVE"}]};
  state.receipts.clear();state.files.clear();state.calls=[];state.audits=[];state.linked=true;state.paid=true;state.saveCount=0;
  state.settlements=[];
});
const metadata={kind:"PARENT_BANK_TRANSFER",invoiceId:4,amountMinor:100000,purpose:"School invoice payment",transferDate:"2026-01-02"};
async function ticket(input:any=metadata){
  const r=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
  return{status:r.status,body:await r.json() as any};
}
async function upload(id:string,bytes:Buffer=png,type="image/png"){
  const r=await fetch(`${base}/${id}/content`,{method:"PUT",headers:{"Content-Type":type},body:new Uint8Array(bytes)});
  return{status:r.status,body:await r.json() as any};
}
describe("private financial receipts, with fake database/storage only",()=>{
  it("binds parent evidence to authoritative invoice identities without writing any money",async()=>{
    const t=await ticket();expect(t.status).toBe(201);
    const r=state.receipts.get(t.body.id);expect(r).toMatchObject({school_id:7,student_id:8,term_id:9,uploaded_by:20,state:"STAGED"});
    const up=await upload(t.body.id);expect(up.status).toBe(200);expect(up.body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(state.calls.some(s=>/INSERT INTO fee_payments|UPDATE fee_invoices|allocations/i.test(s))).toBe(false);
    expect(state.audits.length).toBe(2);
  });
  it("rejects forged student/school metadata and future or invalid dates",async()=>{
    expect((await ticket({...metadata,schoolId:99})).status).toBe(400);
    expect((await ticket({...metadata,transferDate:"2099-01-01"})).status).toBe(400);
    expect((await ticket({...metadata,transferDate:"2026-02-31"})).status).toBe(400);
  });
  it("checks ownership before accepting someone else's upload",async()=>{
    const t=await ticket();state.ctx.user.id=88;
    expect((await upload(t.body.id)).status).toBe(404);expect(state.saveCount).toBe(0);
  });
  it("rejects MIME spoofing, unsupported bytes and oversized files",async()=>{
    const t=await ticket();
    expect((await upload(t.body.id,png,"application/pdf")).status).toBe(400);
    await expect(validateReceiptBytes(Buffer.from("<svg/>"),"image/png")).rejects.toThrow();
    await expect(validateReceiptBytes(Buffer.alloc(5*1024*1024+1),"application/pdf")).rejects.toThrow();
    expect(state.saveCount).toBe(0);
  });
  it("serves authenticated downloads, audits them, and denies other schools, owners and unrelated parents",async()=>{
    const t=await ticket();await upload(t.body.id);
    let r=await fetch(`${base}/${t.body.id}/download`);expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    state.ctx={...state.ctx,user:{...state.ctx.user,id:50},roles:[{role:"ACCOUNTANT",schoolId:7,status:"ACTIVE"}]};
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(200);
    state.ctx.roles=[{role:"ACCOUNTANT",schoolId:99,status:"ACTIVE"}];
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(404);
    state.ctx.roles=[{role:"PLATFORM_OWNER",schoolId:null,status:"ACTIVE"}];
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(404);
    state.ctx.roles=[{role:"PARENT",schoolId:7,status:"ACTIVE"}];
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(404);
  });
  it("reuses duplicate own-file evidence and prevents replacing uploaded evidence",async()=>{
    const a=await ticket(),b=await ticket();await upload(a.body.id);
    const dup=await upload(b.body.id);expect(dup.body.canonicalReceiptId).toBe(a.body.id);
    expect(state.saveCount).toBe(1);
    const black=await sharp({create:{width:2,height:2,channels:3,background:"black"}}).png().toBuffer();
    expect((await upload(a.body.id,black)).status).toBe(409);
    expect(state.saveCount).toBe(1);
  });
  it("requires invoice/amount/date/uploader agreement before a receipt can back a pending transfer",async()=>{
    const t=await ticket();await upload(t.body.id);const c={query,release(){}};
    await expect(requireParentReceipt(c,state.ctx,t.body.id,4,100000,"2026-01-02")).resolves.toBeTruthy();
    await expect(requireParentReceipt(c,state.ctx,t.body.id,5,100000,"2026-01-02")).rejects.toThrow();
    await expect(requireParentReceipt(c,state.ctx,t.body.id,4,99999,"2026-01-02")).rejects.toThrow();
    await expect(requireParentReceipt(c,state.ctx,t.body.id,4,100000,"2026-01-03")).rejects.toThrow();
  });
  it("only allows the Owner to upload an already-completed, exact school settlement",async()=>{
    const input={kind:"SCHOOL_SETTLEMENT",orderReference:`HCM1_T_${"a".repeat(32)}`,amountMinor:190000,purpose:"School settlement",
      transferDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date()),transferCompleted:true};
    expect((await ticket(input)).status).toBe(403);
    state.ctx.roles=[{role:"PLATFORM_OWNER",schoolId:null,status:"ACTIVE"}];
    expect((await ticket({...input,transferCompleted:false})).status).toBe(403);
    expect((await ticket({...input,amountMinor:1})).status).toBe(409);
    expect((await ticket({...input,transferDate:"2020-01-01"})).status).toBe(400);
    state.paid=false;expect((await ticket(input)).status).toBe(409);state.paid=true;
    const t=await ticket(input);expect(t.status).toBe(201);await upload(t.body.id);
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(200);
    state.ctx.roles=[{role:"SCHOOL_ADMIN",schoolId:7,status:"ACTIVE"}];
    expect((await fetch(`${base}/${t.body.id}/download`)).status).toBe(404);
  });
  it("accepts a genuine PDF but rejects executable PDF actions",async()=>{
    const doc=await PDFDocument.create();doc.addPage([100,100]);
    await expect(validateReceiptBytes(Buffer.from(await doc.save()),"application/pdf")).resolves.toMatchObject({contentType:"application/pdf"});
    doc.catalog.set(PDFName.of("OpenAction"),doc.context.obj({S:PDFName.of("JavaScript"),JS:PDFString.of("alert(1)")}));
    await expect(validateReceiptBytes(Buffer.from(await doc.save()),"application/pdf")).rejects.toThrow();
  });
  it("attaches the actual file hash/date/uploader to one Owner-confirmed settlement, without a transfer call",async()=>{
    const reference=`HCM1_T_${"b".repeat(32)}`;
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date());
    state.ctx.roles=[{role:"PLATFORM_OWNER",schoolId:null,status:"ACTIVE"}];
    const t=await ticket({kind:"SCHOOL_SETTLEMENT",orderReference:reference,amountMinor:190000,
      purpose:"School settlement",transferDate:today,transferCompleted:true});
    const uploaded=await upload(t.body.id);expect(uploaded.status).toBe(200);
    const noProvider={initialize:vi.fn(),verify:vi.fn(),authenticate:()=>false};
    const env={EDUCORE_HOSTED_PAYMENTS_ENABLED:"true",EDUCORE_HOSTED_PAYMENTS_MODE:"TEST",
      EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL:"https://fixture.example.test",FLUTTERWAVE_SECRET_Test_Key:"fixture-secret",
      FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fixture-hash"};
    const service=new HostedManualPayments({connect:async()=>({query,release(){}})},env,noProvider);
    const actor={id:20,email:"fixture@example.test",owner:true,schoolIds:[]};
    const input={beneficiary:"SCHOOL" as const,externalReference:"actual-external-fixture-reference",
      proofReceiptId:t.body.id,settlementDate:today,ownershipConfirmed:true as const};
    await expect(service.settle({...actor,owner:false},reference,input)).rejects.toThrow("Only the Owner");
    const result=await service.settle(actor,reference,input);
    expect(result).toMatchObject({schoolSettled:true,settlementReceiptId:t.body.id,settlementDate:today,settlementUploadedBy:20});
    await service.settle(actor,reference,input);
    expect(state.settlements).toHaveLength(1);
    expect(state.settlements[0]).toMatchObject({amount_minor:190000,actor_id:20,proof_sha256:uploaded.body.sha256});
    expect(noProvider.initialize).not.toHaveBeenCalled();expect(noProvider.verify).not.toHaveBeenCalled();
    expect(state.calls.some(s=>s.startsWith("UPDATE subscriptions"))).toBe(false);
  });
});
