import {describe,it,expect} from "vitest";
import {parseLiveFinalizationEvent} from "./flutterwave-live-finalization-event";
const refund=(extra:Record<string,unknown>={})=>({id:987654,TransactionId:123456,
  AmountRefunded:"100",status:"completed",FlwRef:"original-reference",...extra});
const parse=(value:unknown)=>parseLiveFinalizationEvent(Buffer.from(JSON.stringify(value)));
describe("V3 refund identity is not collection identity",()=>{
  it("accepts distinct IDs for standalone and enveloped refund notifications",()=>{
    for(const event of [refund(),{event:"refund.completed",data:refund()}]){
      expect(parse(event)).toMatchObject({kind:"ADVERSE_HOLD",transactionId:"123456",providerReference:"original-reference"});
    }
  });
  it.each([{TransactionId:undefined},{TransactionId:"invalid"},{id:"invalid"},{id:0}])("rejects malformed or missing original identity: %j",fields=>{
    expect(()=>parse(refund(fields))).toThrow();
  });
  it("does not relax conflicting original transaction identifiers on collection/reversal events",()=>{
    expect(()=>parse({event:"charge.completed",data:{id:123456,TransactionId:999999,status:"reversed"}})).toThrow();
  });
});
