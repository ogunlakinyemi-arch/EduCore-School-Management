import {beforeEach,expect,it,vi} from "vitest";
import type {Request} from "express";
const data=vi.hoisted(()=>({present:true,claimed:true,writes:0}));
vi.mock("@workspace/db",()=>({pool:{connect:async()=>({release:()=>{},query:async(sql:string)=>{
  if(sql.includes("SELECT id,status,payment_reference,method"))return {rows:[{id:7,status:"PAID",method:"LEGACY"}]};
  if(sql.includes("to_regclass"))return {rows:[{present:data.present}]};
  if(sql.includes("SELECT operation_id FROM current_subscription_reference_claims"))
    return {rows:data.claimed?[{operation_id:12}]:[]};
  if(sql.startsWith("UPDATE partner_payouts")){data.writes++;return {rows:[{id:7,status:"REVERSED"}]};}
  return {rows:[]};
}})}}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string){super(message);}},
  assertResourceId:()=>7,
}));
import {updateManualPartnerPayout} from "./partner-payout-update";
beforeEach(()=>{data.present=true;data.claimed=true;data.writes=0;});
const req=()=>({params:{payoutId:"7"},body:{status:"REVERSED",paymentReference:"current-bank-reference"}} as unknown as Request);
it("current reference claims block the actual retained manual-payout writer before UPDATE",async()=>{
  await expect(updateManualPartnerPayout(req(),async()=>{})).rejects.toThrow("reserved by a current BRO payout");
  expect(data.writes).toBe(0);
});
it("absence of the unapplied candidate leaves historical manual reversal behaviour intact",async()=>{
  data.present=false;
  await updateManualPartnerPayout(req(),async()=>{});
  expect(data.writes).toBe(1);
});
it("an unrelated reference leaves historical manual reversal behaviour intact",async()=>{
  data.claimed=false;
  await updateManualPartnerPayout(req(),async()=>{});
  expect(data.writes).toBe(1);
});
