import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFile } from "node:fs/promises";
const state=vi.hoisted(()=>({owner:true}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (_req:any,_res:any,next:any)=>next(),
    getUserContext:()=>({user:{id:1},roles:[]}),isPlatformOwner:()=>state.owner};
});
import { persistAuthenticatedLiveWebhookReceipt } from "./flutterwave-live-webhook-inbox";
import { processLiveWorkflow } from "./flutterwave-live-lifecycle";
import { createLiveReadinessRouter } from "../routes/flutterwave-live-readiness";
import { livePreviewColumns } from "./flutterwave-live-evidence-preview";

describe("LIVE receipt persistence and finalization gates — mocked storage only",()=>{
  it("counts identical delivery retries without creating a second receipt or any financial effect",async()=>{
    const receipts=new Map<string,{id:number;deliveries:number}>();
    const query=vi.fn(async(sql:string,v:any[]=[])=>{
      if(sql.includes("INSERT INTO flutterwave_live_webhook_receipts")){
        const row=receipts.get(v[0])??{id:1,deliveries:0};
        row.deliveries++;receipts.set(v[0],row);return {rows:[{id:row.id}]};
      }
      return {rows:[]};
    });
    const release=vi.fn();const pool={connect:async()=>({query,release})};
    const bytes=Buffer.from(JSON.stringify({event:"charge.completed",data:{id:123,tx_ref:"fictional_ref"}}));
    expect(await persistAuthenticatedLiveWebhookReceipt(pool,bytes)).toBe(1);
    expect(await persistAuthenticatedLiveWebhookReceipt(pool,bytes)).toBe(1);
    expect([...receipts.values()]).toEqual([{id:1,deliveries:2}]);
    expect(query.mock.calls.filter(([sql])=>/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))
      .every(([sql])=>sql.includes("flutterwave_live_webhook_receipts"))).toBe(true);
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("does not acknowledge an uncertain commit; redelivery can recover the same receipt",async()=>{
    let fail=true;let persisted=false;
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes("INSERT INTO flutterwave_live_webhook_receipts")){persisted=true;return {rows:[{id:7}]};}
      if(sql==="COMMIT"&&fail){fail=false;throw Object.assign(new Error("synthetic lost commit response"),{code:"08006"});}
      return {rows:[]};
    });
    const pool={connect:async()=>({query,release:vi.fn()})};
    await expect(persistAuthenticatedLiveWebhookReceipt(pool,Buffer.from("{}"))).rejects.toThrow("synthetic");
    expect(persisted).toBe(true);expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(await persistAuthenticatedLiveWebhookReceipt(pool,Buffer.from("{}"))).toBe(7);
  });
  it("cannot finalize or reconcile a receipt through the released runtime without a release capability",async()=>{
    const connect=vi.fn();
    await expect(processLiveWorkflow({connect} as any,1,Buffer.from("{}")))
      .rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("authenticated Owner review HTTP boundary — fixture identity, no provider",()=>{
  let server: ReturnType<ReturnType<typeof express>["listen"]>;let base="";
  const query=vi.fn(async(_sql:string,_values?:any[])=>({rows:[]}));
  const connect=vi.fn(async()=>({query,release:vi.fn()}));
  beforeAll(async()=>{
    const app=express();app.use(express.json());
    app.use(createLiveReadinessRouter({pool:{connect},development:true}));
    app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??500).json({error:e.message}));
    server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
    const address=server.address() as any;base=`http://127.0.0.1:${address.port}`;
  });
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
  beforeEach(()=>{state.owner=true;vi.clearAllMocks();});
  const preview=()=>fetch(`${base}/platform/live-readiness/evidence-preview`,{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({
      merchantScope:"fictional_scope",schoolId:1,reviewId:1,authorityEvidence:{}})});
  it("denies non-Owners before any database access",async()=>{
    state.owner=false;expect((await preview()).status).toBe(403);expect(connect).not.toHaveBeenCalled();
  });
  it("lets an Owner observe missing schema, without approving or activating anything",async()=>{
    const res=await preview();expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({previewOnly:true,persisted:false,approved:false,activationReady:false});
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  });
  it("keeps operational Owner receipt review hard-disabled before database access",async()=>{
    const res=await fetch(`${base}/platform/live-readiness/receipts?merchantScope=fictional_scope`);
    expect(res.status).toBe(503);expect(connect).not.toHaveBeenCalled();
  });
});

describe("offline migration draft review — reads SQL only, no database or migration runner",()=>{
  const order=["webhook-inbox","finalization","workflow","readiness"];
  it("retains four isolated, unjournalled drafts and their dependency order",async()=>{
    const files=await Promise.all(order.map(n=>readFile(new URL(
      `../../../../lib/db/dev-reconciliation/flutterwave-live-${n}.up.sql`,import.meta.url),"utf8")));
    const combined=files.join("\n");
    const journal=await readFile(new URL("../../../../lib/db/drizzle/meta/_journal.json",import.meta.url),"utf8");
    expect(journal).not.toMatch(/flutterwave[-_]live/i);
    const created=new Set<string>();
    for(const file of files){
      for(const match of file.matchAll(/CREATE TABLE\s+(\w+)|REFERENCES\s+(\w+)/g)){
        if(match[1]){expect(match[1].startsWith("flutterwave_live_")).toBe(true);created.add(match[1]);}
        else expect(created.has(match[2]),`referenced table must already exist: ${match[2]}`).toBe(true);
      }
      expect(file).not.toMatch(/\b(?:ALTER|UPDATE|DELETE FROM|INSERT INTO)\s+(?:student_subscription|school_payment|fee_payment)/i);
    }
    for(const [table,columns] of Object.entries(livePreviewColumns)){
      const declaration=combined.match(new RegExp(`CREATE TABLE ${table}\\s*\\(([\\s\\S]*?)\\n\\);`))?.[1]??"";
      const alterations=[...combined.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)]
        .filter(m=>m[1]===table).map(m=>m[2]).join("\n");
      for(const column of columns)expect(declaration+"\n"+alterations,`${table}.${column}`)
        .toMatch(new RegExp(`\\b${column}\\b`));
      expect(declaration.length).toBeGreaterThan(0);
    }
    // Applying any draft is outside this test; no app schema/ledger is inspected.
    expect(files[3].indexOf("ALTER TABLE flutterwave_live_authority_reviews"))
      .toBeLessThan(files[3].indexOf("ALTER TABLE flutterwave_live_subscription_intents"));
  });
});
