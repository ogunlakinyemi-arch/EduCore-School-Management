import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

describe.skipIf(process.env.FEE_STRUCTURE_QA_READONLY!=="1")("Mercyland fee structure configuration and genuine browser persistence",()=>{
  const connect=()=>pool.connect();
  let client:Awaited<ReturnType<typeof connect>>;
  let periodSql:string;
  beforeAll(async()=>{
    client=await connect();await client.query("BEGIN READ ONLY");
    const identity=(await client.query("SELECT current_database() name,inet_server_addr() host")).rows[0];
    if(process.env.REPLIT_DEPLOYMENT || identity.name!=="heliumdb" || identity.host!==null)throw Error("Not local Development");
    const source=readFileSync(new URL("../routes/finance.ts",import.meta.url),"utf8");
    const match=source.match(/const validPeriod = await client\.query\(`([^`]+)`/);
    expect(match).not.toBeNull();periodSql=match![1];
  });
  afterAll(async()=>{if(client){await client.query("ROLLBACK");client.release();}await pool.end();});
  it("accepts the existing school/session/term/class, without creating configuration",async()=>{
    expect((await client.query(periodSql,[1393,20,358,571])).rowCount).toBe(1);
  });
  it.each([
    ["foreign class",[1393,20,358,580]],["foreign session",[1393,20,386,571]],
    ["foreign term",[1393,27,358,571]],["wrong school",[1,20,358,571]],
  ])("rejects %s in the routed native period predicate",async(_label,params)=>{
    expect((await client.query(periodSql,params as number[])).rowCount).toBe(0);
  });
  it("retains the requested unissued Tuition draft and exact ₦8,000 line created through the genuine browser",async()=>{
    const result=await client.query(`SELECT fs.id,fs.status,fs.section,fs.created_by,
      fl.amount_minor,fl.category_name_snapshot
      FROM fee_structures fs JOIN fee_structure_lines fl ON fl.structure_id=fs.id AND fl.school_id=fs.school_id
      JOIN fee_categories fc ON fc.id=fl.category_id AND fc.school_id=fs.school_id
      WHERE fs.school_id=1393 AND fs.academic_session_id=358 AND fs.academic_term_id=20 AND fs.school_class_id=571
        AND fs.section='Science' AND fc.name='Tuition' AND fl.amount_minor=800000`);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toMatchObject({status:"DRAFT",section:"Science",amount_minor:800000,category_name_snapshot:"Tuition"});
    expect(Number(result.rows[0].created_by)).toBeGreaterThan(0);
  });
});