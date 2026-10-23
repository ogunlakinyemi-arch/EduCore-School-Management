import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m=vi.hoisted(()=>({finalize:vi.fn()}));
vi.mock("./flutterwave-live-finalization-design",()=>({finalizeLiveSubscriptionDesign:m.finalize}));
import { processLiveWorkflow } from "./flutterwave-live-lifecycle";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

describe("mocked LIVE reconciliation persistence contract",()=>{
  const bytes=Buffer.from('{"event":"charge.completed","data":{"id":123}}');
  const verifier={enabled:true,environment:"LIVE",merchantScope:"fictional_scope",verify:vi.fn()};
  beforeEach(()=>{vi.clearAllMocks();m.finalize.mockReset();});
  function fixture(){
    const query=vi.fn(async(_sql:string,_values?:unknown[])=>({rows:[]}));
    const release=vi.fn(),connect=vi.fn(async()=>({query,release}));
    return {query,release,connect};
  }
  it("does not write reconciliation or retry finalization on the blocked runtime path",async()=>{
    const f=fixture();
    await expect(processLiveWorkflow(f as any,1,bytes)).rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    expect(f.connect).not.toHaveBeenCalled();expect(m.finalize).not.toHaveBeenCalled();
  });
  it("binds unresolved reconciliation to authenticated original-byte fingerprint and receipt, then rethrows",async()=>{
    const f=fixture();const failure=new Error("synthetic finalization uncertainty");
    m.finalize.mockRejectedValue(failure);
    await expect(processLiveWorkflow(f as any,7,bytes,verifier,{enabled:true})).rejects.toBe(failure);
    const call=f.query.mock.calls.find(([sql])=>sql.includes("INSERT INTO flutterwave_live_reconciliation_cases"));
    expect(call?.[0]).toContain("signature_verified=true AND payload_sha256=$2");
    expect(call?.[0]).toContain("ON CONFLICT(receipt_id) DO NOTHING");
    expect(call?.[1]).toEqual([7,createHash("sha256").update(bytes).digest("hex")]);
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(m.finalize).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledOnce();
  });
  it("reports unavailable reconciliation when its COMMIT becomes uncertain, without replay",async()=>{
    const f=fixture();m.finalize.mockRejectedValue(new Error("synthetic"));
    f.query.mockImplementation(async sql=>{if(sql==="COMMIT")throw new Error("synthetic lost response");return {rows:[]};});
    await expect(processLiveWorkflow(f as any,7,bytes,verifier,{enabled:true}))
      .rejects.toMatchObject({code:"LIVE_RECONCILIATION_PERSISTENCE_UNAVAILABLE"});
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(m.finalize).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledOnce();
  });
  it("does not manufacture a reconciliation case when independent transport is disabled",async()=>{
    const f=fixture();m.finalize.mockRejectedValue(new LiveFinalizationBlocked("LIVE_VERIFICATION_TRANSPORT_DISABLED"));
    await expect(processLiveWorkflow(f as any,7,bytes,verifier,{enabled:true}))
      .rejects.toMatchObject({code:"LIVE_VERIFICATION_TRANSPORT_DISABLED"});
    expect(f.connect).not.toHaveBeenCalled();
  });
});
