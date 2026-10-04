import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requestReplacement, readReplacement, issueReplacement, listReplacements, verifyReplacementPayment } from "../services/student-card-replacement";
import { FlutterwaveTestAdapter } from "../lib/fee-providers";
import type { Request } from "express";

const provider = vi.hoisted(() => ({ reference: "", transactionId: "0", status: "successful" }));
vi.mock("../lib/fee-providers/factory", async original => ({
  ...await original<any>(),
  configuredTestAdapter: () => new FlutterwaveTestAdapter({
    secretKey: "FLWSECK_TEST-fixture-only",
  }, {
    fetch: async () => new Response(JSON.stringify({ status:"success",data:{
      id:Number(provider.transactionId),tx_ref:provider.reference,amount:2000,currency:"NGN",status:provider.status,
    }}),{status:200,headers:{"content-type":"application/json"}}),
  }),
}));

const enabled = process.env.RUN_CARD_REPLACEMENT_DEV === "1";
describe.skipIf(!enabled)("Development replacement PostgreSQL / simulated identity and provider boundary", () => {
  let f: any, replacement: any, goodUid: string, foreignUid: string, assignedUid: string, newCardId: number;
  let admin: Request, parent: Request, student: Request, teacher: Request, stranger: Request, owner: Request;
  let protectedDigest: string;
  const preservedTables = ["students","parents","parent_student_relationships","transport_student_assignments","subscriptions","attendance_events"];
  const financeBaseline: Record<string,any> = {};
  async function digest() {
    const values: string[] = [];
    for (const t of preservedTables) {
      const r = await pool.query(`SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY id),'')) AS hash FROM ${t} x`);
      values.push(r.rows[0].hash);
    }
    return values.join(":");
  }
  async function actor(userId: number) {
    const u=(await pool.query("SELECT * FROM app_users WHERE id=$1",[userId])).rows[0];
    const roles=(await pool.query('SELECT id,role,school_id AS "schoolId",status FROM school_memberships WHERE user_id=$1 AND status=\'ACTIVE\'',[userId])).rows;
    return { edupulseUser:{user:{id:u.id,clerkUserId:u.clerk_user_id,email:u.email,status:u.status,firstName:u.first_name,lastName:u.last_name},roles} } as unknown as Request;
  }
  beforeAll(async () => {
    f=JSON.parse(await readFile(new URL("../../.local/test-fixtures/targeted-transport.json",import.meta.url),"utf8"));
    const db=(await pool.query("SELECT current_database() db,pg_postmaster_start_time() started")).rows[0];
    if(db.db!=="heliumdb" || new Date(db.started).toISOString()!=="2026-10-04T07:06:39.585Z" ||
      (await pool.query("SELECT id FROM schools WHERE id=$1 AND name=$2",[f.schoolId,f.label])).rows.length!==1) throw Error("Unverified Development fixture");
    if(process.env.REPLIT_DEPLOYMENT) throw Error("No deployment tests");
    for(const t of ["fee_invoices","fee_invoice_lines","fee_payments","fee_receipts","fee_provider_checkout_sessions"]) {
      const key = t==="fee_provider_checkout_sessions" ? "payment_id" : "id";
      const row=(await pool.query(`SELECT COALESCE(max(${key}),0) max,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY ${key}),'')) digest FROM ${t} x`)).rows[0];
      row.key=key;
      financeBaseline[t]=row;
    }
    await writeFile(new URL("../../.local/test-fixtures/replacement-finance-baseline.json",import.meta.url),JSON.stringify(financeBaseline));
    admin=await actor(f.actors.admin.userId); parent=await actor(f.actors.parent.userId); student=await actor(f.actors.student1.userId);
    teacher=await actor(f.actors.teacher.userId); stranger=await actor(f.actors.otherParent.userId);
    const o=(await pool.query("SELECT user_id FROM school_memberships WHERE role='PLATFORM_OWNER' AND school_id IS NULL AND status='ACTIVE' ORDER BY id LIMIT 1")).rows[0];
    if(!o) throw Error("No existing Owner for simulated identity test");
    owner=await actor(o.user_id);
    protectedDigest=await digest();
    const unreported=(await pool.query("SELECT id FROM nfc_cards WHERE school_id=$1 AND student_id=$2 AND uid LIKE 'QA-LOST-%' AND status='active' ORDER BY id DESC LIMIT 1",
      [f.schoolId,f.actors.student1.studentId])).rows[0];
    f.cardId=unreported?.id ?? (await pool.query("INSERT INTO nfc_cards(school_id,uid,student_id,status) VALUES($1,$2,$3,'active') RETURNING id",
      [f.schoolId,`QA-LOST-${randomUUID()}`,f.actors.student1.studentId])).rows[0].id;
    goodUid=`QA-REPLACEMENT-${randomUUID()}`; foreignUid=`QA-FOREIGN-${randomUUID()}`; assignedUid=`QA-ASSIGNED-${randomUUID()}`;
    newCardId=(await pool.query("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,$2,'unassigned') RETURNING id",[f.schoolId,goodUid])).rows[0].id;
    await pool.query("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,$2,'unassigned')",[f.otherSchoolId,foreignUid]);
    await pool.query("INSERT INTO nfc_cards(school_id,uid,student_id,status) VALUES($1,$2,$3,'locked')",[f.schoolId,assignedUid,f.actors.student2.studentId]);
  });
  afterAll(async () => {
    for(const [t,b] of Object.entries(financeBaseline)) {
      const actual=(await pool.query(`SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY ${b.key}),'')) digest FROM ${t} x WHERE ${b.key}<=$1`,[b.max])).rows[0];
      expect(actual.digest,t).toBe(b.digest);
    }
    await pool.end();
  });
  it("creates a separate NGN 2000 request with an existing student/card",async()=>{
    replacement=await requestReplacement(admin,f.cardId,"QA final Development replacement");
    expect(replacement.amountMinor).toBe(200000); expect(replacement.paymentStatus).toBe("UNPAID");
    expect(replacement.studentId).toBe(f.actors.student1.studentId);
    await writeFile(new URL("../../.local/test-fixtures/replacement-browser.json",import.meta.url),
      JSON.stringify({schoolId:f.schoolId,requestId:replacement.id,invoiceId:replacement.invoiceId,newCardId,uid:goodUid}));
  });
  it("reuses the same request and invoice on retry",async()=>{
    const r=await requestReplacement(parent,f.cardId,"Duplicate retry");
    expect(r.id).toBe(replacement.id); expect(r.invoiceId).toBe(replacement.invoiceId);
  });
  it("persists across a fresh database connection",async()=>{
    const c=await pool.connect(); try {expect((await c.query("SELECT invoice_id FROM student_nfc_replacement_requests WHERE id=$1",[replacement.id])).rows[0].invoice_id).toBe(replacement.invoiceId);} finally {c.release();}
  });
  it("allows only linked family reads",async()=>{
    expect((await readReplacement(parent,replacement.id)).studentId).toBe(replacement.studentId);
    expect((await readReplacement(student,replacement.id)).id).toBe(replacement.id);
    await expect(readReplacement(stranger,replacement.id)).rejects.toMatchObject({statusCode:404});
    await expect(readReplacement(teacher,replacement.id)).rejects.toMatchObject({statusCode:404});
  });
  it("rejects wrong-parent card reports",async()=>{
    await expect(requestReplacement(stranger,f.cardId,"Wrong parent")).rejects.toMatchObject({statusCode:404});
  });
  it("blocks unpaid Owner issuance",async()=>{
    await expect(issueReplacement(owner,replacement.id,goodUid)).rejects.toMatchObject({statusCode:409});
  });
  it.each(["admin","parent","teacher","student"])("denies %s issuance",async role=>{
    const req={admin,parent,teacher,student}[role]!;
    await expect(issueReplacement(req,replacement.id,goodUid)).rejects.toMatchObject({statusCode:403});
  });
  it("settles independently verified simulated Flutterwave payment using existing finance tables",async()=>{
    provider.reference=`QA-PAY-${randomUUID()}`; provider.transactionId=String(Date.now());
    const payment=(await pool.query(`INSERT INTO fee_payments(school_id,invoice_id,student_id,parent_id,reference,idempotency_key,
      amount_minor,currency,method,provider,submitted_by) VALUES($1,$2,$3,$4,$5,$5,200000,'NGN','FLUTTERWAVE','FLUTTERWAVE',$6) RETURNING id`,
    [f.schoolId,replacement.invoiceId,replacement.studentId,f.actors.parent.parentId,provider.reference,f.actors.parent.userId])).rows[0];
    await pool.query(`INSERT INTO fee_provider_checkout_sessions(payment_id,school_id,invoice_id,provider,reference,idempotency_key,state,checkout_url)
      VALUES($1,$2,$3,'FLUTTERWAVE',$4,$4,'READY','https://checkout.flutterwave.com/fixture')`,
    [payment.id,f.schoolId,replacement.invoiceId,provider.reference]);
    const r=await verifyReplacementPayment(parent,replacement.id,provider.transactionId);
    expect(r.paymentStatus).toBe("PAID");
  });
  it("does not credit the same payment twice",async()=>{
    await verifyReplacementPayment(parent,replacement.id,provider.transactionId);
    expect((await pool.query("SELECT paid_minor FROM fee_invoices WHERE id=$1",[replacement.invoiceId])).rows[0].paid_minor).toBe(200000);
    expect((await pool.query("SELECT count(*)::int n FROM fee_receipts WHERE invoice_id=$1",[replacement.invoiceId])).rows[0].n).toBe(1);
  });
  it("rejects a cross-school prepared UID",async()=>{await expect(issueReplacement(owner,replacement.id,foreignUid)).rejects.toMatchObject({statusCode:409});});
  it("rejects an already assigned UID",async()=>{await expect(issueReplacement(owner,replacement.id,assignedUid)).rejects.toMatchObject({statusCode:409});});
  it("rejects reusing the revoked UID",async()=>{
    const uid=(await pool.query("SELECT uid FROM nfc_cards WHERE id=$1",[f.cardId])).rows[0].uid;
    await expect(issueReplacement(owner,replacement.id,uid)).rejects.toMatchObject({statusCode:409});
  });
  it("issues a prepared UID with same person and complete relationship/history",async()=>{
    const r=await issueReplacement(owner,replacement.id,goodUid);
    expect(r.status).toBe("ISSUED"); expect(r.newCardId).toBe(newCardId);
    const old=(await pool.query("SELECT status,replaced_by_card_id FROM nfc_cards WHERE id=$1",[f.cardId])).rows[0];
    expect(old.status).toBe("replaced"); expect(old.replaced_by_card_id).toBe(newCardId);
    const card=(await pool.query("SELECT status,student_id,school_id FROM nfc_cards WHERE id=$1",[newCardId])).rows[0];
    expect(card).toMatchObject({status:"active",student_id:replacement.studentId,school_id:f.schoolId});
    expect((await pool.query("SELECT count(*)::int n FROM nfc_card_history WHERE nfc_card_id=ANY($1::int[]) AND action IN ('REPLACED','ASSIGNED_AS_REPLACEMENT')",[[f.cardId,newCardId]])).rows[0].n).toBe(2);
  });
  it("Owner issuance retries are idempotent and a different UID is rejected",async()=>{
    expect((await issueReplacement(owner,replacement.id,goodUid)).newCardId).toBe(newCardId);
    await expect(issueReplacement(owner,replacement.id,foreignUid)).rejects.toMatchObject({statusCode:409});
  });
  it("family sees issued state after reload",async()=>{
    expect((await readReplacement(parent,replacement.id)).status).toBe("ISSUED");
    expect((await listReplacements(student)).requests.some((r:any)=>r.id===replacement.id && r.newCardId===newCardId)).toBe(true);
  });
  it("preserves student/parent/transport/subscription/attendance records and appends audit",async()=>{
    expect(await digest()).toBe(protectedDigest);
    expect((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE record_id=$1 AND event_type IN ('NFC_REPLACEMENT_REQUESTED','NFC_REPLACEMENT_ISSUED')",[replacement.id])).rows[0].n).toBe(2);
  });
});