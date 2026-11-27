/** Authored service orchestration regressions. No DB/provider or fake clock. */
import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({
 validate:vi.fn(),authority:vi.fn(),state:"FAILED",events:[] as any[],sql:[] as string[],
 attempt:null as any,prior:null as any,baseline:null as any,
 batch:{id:1,school_id:1,academic_term_id:1,amount_minor:320000,reference:"SCV4_live_bulk_original_000001",
  snapshot:{email:"fictional@example.invalid"}},
}));
vi.mock("./bulk-retry-authorization",()=>({revalidateBulkRetry:m.validate}));
vi.mock("./current-finance-access",()=>({currentSchoolAuthority:m.authority,requireCurrentExtensions:vi.fn()}));
vi.mock("./current-payment-evidence",()=>({requireBankWorkflow:vi.fn(),bulkProof:vi.fn(async()=>false)}));
vi.mock("../lib/flutterwave-live-transport",()=>({FlutterwaveLiveTransport:class{
 constructor(){throw Error("Real provider transport forbidden in this test");}
}}));
vi.mock("./current-bulk-subscriptions",()=>({
 batchRoot:vi.fn(async()=>structuredClone(m.batch)),batchState:vi.fn(async()=>m.state),
 bulkView:vi.fn(async()=>({state:m.state})),recordCheckoutOutcome:vi.fn(async(_p,_id,_actor,state)=>{m.state=state;}),
 bulkEvent:vi.fn(async(_c,_id,_actor,state,key,details)=>{m.events.push({state,key,details});m.state=state;}),
}));
import {retryCurrentBulk} from "./current-bulk-retry";
const input={id:1,key:"retry_fixture_0000000001",reason:"Fictional retry request"};
const facts={transactionId:"12345",reference:m.batch.reference,amountMinor:320000,currency:"NGN",
 providerReference:"fictional-proof",status:"failed" as const,chargedAmountMinor:0,providerFeeMinor:0,additionalFeeMinor:0};
function fixture(){
 const c={release:vi.fn(),query:vi.fn(async(sql:string)=>{
  m.sql.push(sql);
  if(sql==="BEGIN")m.baseline=structuredClone({state:m.state,events:m.events,attempt:m.attempt});
  if(sql==="ROLLBACK"&&m.baseline)Object.assign(m,structuredClone(m.baseline));
  if(sql.includes("SELECT details FROM current_bulk_events"))return {rows:[{details:{transactionId:"12345",reference:m.batch.reference}}]};
  if(sql.includes("SELECT * FROM current_bulk_checkout_attempts"))return {rows:m.prior?[m.prior]:[]};
  if(sql.includes("SELECT reference FROM current_bulk_checkout_attempts"))return {rows:m.attempt?[{reference:m.attempt.reference}]:[]};
  if(sql.includes("INSERT INTO current_bulk_checkout_attempts")){
   m.attempt={id:1,reference:"SCV4_live_bulk_retry_000001"};return {rows:[m.attempt]};
  }
  return {rows:[]};
 })};
 return {pool:{connect:async()=>c},verify:vi.fn(async()=>({...facts})),
  checkout:vi.fn(async()=>"https://checkout.flutterwave.com/fictional"),c};
}
beforeEach(()=>{
 vi.clearAllMocks();m.validate.mockResolvedValue(undefined);m.authority.mockResolvedValue(undefined);
 Object.assign(m,{state:"FAILED",events:[],sql:[],attempt:null,prior:null,baseline:null});
});
const staleReasons=["WITHDRAWN","EXPIRED","SUPERSEDED","CALENDAR_CHANGED","ROSTER_CHANGED",
 "RECONCILIATION_CHANGED","PRICING_CHANGED","MERCHANT_CHANGED","ENDPOINT_CHANGED"];
it.each(staleReasons)("blocks known %s authorization before any provider request or retry insert",async reason=>{
 const f=fixture();m.validate.mockRejectedValue(Error(reason));
 await expect(retryCurrentBulk(f.pool,2,input,f)).rejects.toThrow(reason);
 expect(f.verify).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();expect(m.attempt).toBeNull();
});
it.each(staleReasons)("revalidates %s changes during verification before creating a retry attempt",async reason=>{
 const f=fixture();m.validate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error(reason));
 await expect(retryCurrentBulk(f.pool,2,input,f)).rejects.toThrow(reason);
 expect(f.verify).toHaveBeenCalledTimes(1);expect(f.checkout).not.toHaveBeenCalled();expect(m.attempt).toBeNull();
});
it("rechecks after reservation and retains a no-send failure when withdrawal precedes final dispatch authorization",async()=>{
 const f=fixture();m.validate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("WITHDRAWN"));
 await expect(retryCurrentBulk(f.pool,2,input,f)).rejects.toThrow("WITHDRAWN");
 expect(m.attempt).not.toBeNull();expect(f.checkout).not.toHaveBeenCalled();
 expect(m.events.at(-1).details).toMatchObject({providerDispatch:"NOT_SENT",automaticResend:false,moneyMoved:false});
});
it("checks three times and sends exactly one POST only after final authorization commits",async()=>{
 const f=fixture();
 f.checkout.mockImplementationOnce(async()=>{
  expect(m.validate).toHaveBeenCalledTimes(3);
  expect(m.sql.at(-1)).toBe("COMMIT");
  expect(m.events.at(-1).key).toBe("retry-dispatch-authorized:1");
  return "https://checkout.flutterwave.com/fictional";
 });
 await retryCurrentBulk(f.pool,2,input,f);expect(f.verify).toHaveBeenCalledTimes(1);expect(f.checkout).toHaveBeenCalledTimes(1);
});
it.each([undefined,null,"0",1,-1,0.001])("rejects non-exact zero-charge provider evidence %s",async value=>{
 const f=fixture();f.verify.mockResolvedValueOnce({...facts,chargedAmountMinor:value as any});
 await expect(retryCurrentBulk(f.pool,2,input,f)).rejects.toThrow("FRESH_INDEPENDENT_ZERO_CHARGE_EVIDENCE_REQUIRED");
 expect(f.checkout).not.toHaveBeenCalled();expect(m.attempt).toBeNull();
});
it("never redispatches a matching idempotent replay",async()=>{
 const f=fixture();m.prior={batch_id:1,created_by:2,reason:input.reason};
 await retryCurrentBulk(f.pool,2,input,f);
 expect(f.verify).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
});
