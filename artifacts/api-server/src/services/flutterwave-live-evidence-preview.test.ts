import {describe,it,expect,vi} from "vitest";
import {previewLiveEvidence,livePreviewTables,livePreviewColumns} from "./flutterwave-live-evidence-preview";

const input={merchantScope:"fictional_merchant",schoolId:10,reviewId:1,authorityEvidence:{}};
const authorityColumns=["id","environment","merchant_scope","school_id","school_subaccount_id","evidence_sha256","expires_at","reviewed_by"];
function fake(metadata:any[],review:any[]=[],fail=false){
  const release=vi.fn();
  const query=vi.fn(async(sql:string)=>{
    if(/^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)/.test(sql))throw new Error("Writes forbidden");
    if(sql.includes("information_schema")){if(fail)throw new Error("Fictional schema read failure");return {rows:metadata};}
    if(sql.includes("FROM flutterwave_live_authority_reviews"))return {rows:review};
    return {rows:[]};
  });
  return {pool:{connect:vi.fn(async()=>({query,release}))},query,release};
}
describe("LIVE preview is read-only and never infers target approval from partial schema",()=>{
  it("reports absent schema without querying a nonexistent authority table or persisting anything",async()=>{
    const f=fake([]);
    const report=await previewLiveEvidence(f.pool,input);
    expect(report).toMatchObject({previewOnly:true,approved:false,persisted:false,activationReady:false,evidenceValid:false,
      evidenceStatus:"AUTHORITY_SCHEMA_UNAVAILABLE",allocationPreview:null,missingTables:[...livePreviewTables]});
    expect(f.query.mock.calls.some(([sql])=>sql.includes("FROM flutterwave_live_authority_reviews"))).toBe(false);
    expect(f.query.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("does not query partially created authority columns",async()=>{
    const f=fake([{table_name:"flutterwave_live_authority_reviews",column_name:"id"}]);
    expect(await previewLiveEvidence(f.pool,input)).toMatchObject({evidenceValid:false,evidenceStatus:"AUTHORITY_SCHEMA_UNAVAILABLE"});
    expect(f.query.mock.calls.some(([sql])=>sql.includes("FROM flutterwave_live_authority_reviews"))).toBe(false);
  });
  it("never labels mere table existence as migration approval or webhook authentication",async()=>{
    const metadata=livePreviewTables.flatMap(name=>livePreviewColumns[name]
      .map(column_name=>({table_name:name,column_name})));
    const f=fake(metadata);
    const report=await previewLiveEvidence(f.pool,input);
    expect(report.missingTables).toEqual([]);
    expect(report.evidenceStatus).toBe("AUTHORITY_REVIEW_NOT_FOUND");
    for(const key of ["MIGRATION_APPROVAL","WEBHOOK_ENVIRONMENT_AUTHENTICATION"])
      expect(report.checks).toContainEqual(expect.objectContaining({key,status:"UNVERIFIED"}));
    expect(report.checks).toContainEqual(expect.objectContaining({key:"TARGET_SCHEMA",status:"TABLES_OBSERVED_ONLY"}));
    expect(report.approved).toBe(false);
  });
  it("reports partial non-authority tables as incomplete, without treating table presence as release evidence",async()=>{
    const metadata=livePreviewTables.flatMap(table=>livePreviewColumns[table]
      .filter(column=>!(table==="flutterwave_live_webhook_receipts"&&column==="signature_verified"))
      .map(column_name=>({table_name:table,column_name})));
    const report=await previewLiveEvidence(fake(metadata).pool,input);
    expect(report.missingTables).toEqual([]);
    expect(report.checks).toContainEqual(expect.objectContaining({key:"TARGET_SCHEMA",status:"INCOMPLETE",
      detail:expect.stringContaining("flutterwave_live_webhook_receipts.signature_verified")}));
    expect(report.activationReady).toBe(false);
  });
  it("fails rather than returning a successful report after a schema read failure",async()=>{
    const f=fake([],[],true);
    await expect(previewLiveEvidence(f.pool,input)).rejects.toThrow("Fictional schema read failure");
    expect(f.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(f.release).toHaveBeenCalledOnce();
  });
});
