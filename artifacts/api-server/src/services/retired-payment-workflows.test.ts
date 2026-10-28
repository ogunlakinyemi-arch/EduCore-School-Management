import express from "express";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { retiredPaymentWorkflow,rejectRetiredPaymentWorkflows } from "./retired-payment-workflows";
describe("archived financial workflow boundary",()=>{
  it.each([
    ["/api/hosted-payments/config","GET"],["/api/hosted-payments/checkout","POST"],
    ["/api/hosted-payments/orders/old/settle","POST"],["/api/flutterwave/split-dashboard","GET"],
    ["/api/flutterwave/split-recipients","POST"],["/api/flutterwave/split-schools/7/configuration","PATCH"],
    ["/api/flutterwave/live/checkout","POST"],["/api/schools/4/finance/live-subaccount-onboarding","POST"],
    ["/api/subscriptions/9/checkout","POST"],["/api/public/nfc-payment-links/checkout","POST"],
    ["/api/student-nfc/assisted-requests","POST"],["/api/subscriptions/7/payment-link","POST"],
    ["/API/HOSTED-PAYMENTS/CHECKOUT","POST"],["/api/subscriptions/%37/checkout","POST"],
    ["/api/flutterwave/live/release-check","GET"],["/api/flutterwave/live/billing-context","GET"],
    ["/api/platform/live-readiness/evidence-preview","POST"],
    ["/api/platform/live-readiness/receipts/7/reviews","POST"],
    ["/api/platform/live-readiness/receipts/%37/reviews/","POST"],
    ["/api/flutterwave/live/school-configuration","POST"],["/api/flutterwave/live/allocation-review","POST"],
    ["/api/flutterwave/local-split-simulation","GET"],["/api/flutterwave/local-split-simulation","POST"],
    ["/api/flutterwave/local-split-simulation/reset","POST"],
    ["/api/platform/live-readiness/receipts/%2B7/reviews","POST"],
    ["/api/platform/live-readiness/receipts/7e0/reviews","POST"],
    ["/api/subscriptions/%2B7/checkout","POST"],["/api/subscriptions/7.0/payment-link","POST"],
    ["/api/schools/7e0/finance/live-subaccount-onboarding","POST"],
    ["/api/platform/finance/payment-settlement/schools/0x7/review","POST"],
    ...["POST","PUT","PATCH","DELETE"].map(method=>["/api/schools/7/finance/payment-settlement",method]),
    ["/api/schools/%37/finance/payment-settlement/","PUT"],
  ])("retires %s %s without invoking provider or storage", (path,method)=>expect(retiredPaymentWorkflow(path,method)).toBe(true));
  it.each([
    ["/api/webhooks/flutterwave/hosted-manual","POST"],["/api/webhooks/flutterwave/student-subscriptions","POST"],
    ["/api/subscriptions/7/payments/9","GET"],["/api/student-nfc/obligations","GET"],
    ["/api/owner/finance/student-nfc-reconciliation","GET"],["/api/platform/subscription-payment-rules","POST"],
    ["/api/staff-nfc/checkout","POST"],["/api/parent/fees/invoices/7/providers/FLUTTERWAVE/initialize","POST"],
    ["/api/schools/7/finance/payment-settlement/history","GET"],
    ["/api/public/nfc-payment-links/verify","POST"],
    ["/api/schools/7/finance/payment-settlement","GET"],
    ["/api/platform/finance/payment-settlement","PUT"],
    ["/api/platform/finance/payment-settlement","GET"],
    ["/api/schools/7/finance/settings","PUT"],
    ["/api/schools/7/platform-subscriptions/transfer-instructions","GET"],
    ["/api/schools/7/platform-subscriptions/assistance","POST"],
    ["/api/schools/7/platform-subscriptions/checkout","POST"],
    ["/api/flutterwave/split-payments/7/transaction-evidence","GET"],
    ["/api/platform/live-readiness/receipts","GET"],
    ["/api/platform/live-readiness/receipts/7/official-receipt","GET"],
  ])("preserves separately authorized historical/essential flow %s", (path,method)=>expect(retiredPaymentWorkflow(path,method)).toBe(false));
  let server:ReturnType<ReturnType<typeof express>["listen"]>,base="";
  let downstream=0;
  beforeAll(async()=>{
    const app=express();app.use("/api",rejectRetiredPaymentWorkflows);
    app.use((_req,res)=>{downstream++;res.json({ok:true});});
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>{
      const address=server.address();if(!address || typeof address==="string")throw Error("No address");
      base=`http://127.0.0.1:${address.port}`;resolve();
    });});
  });
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  it("returns an uncached 410 before any downstream payment handler, regardless of role claims",async()=>{
    for(const role of ["PLATFORM_OWNER","SCHOOL_ADMIN","PARENT","STUDENT"]){
      for(const [path,method] of [["/api/hosted-payments/checkout","POST"],
        ["/api/schools/7/finance/payment-settlement","PUT"],
        ["/api/schools/7/finance/payment-settlement","DELETE"]]){
        const response=await fetch(`${base}${path}`,{method,headers:{"x-role":role}});
        expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:"PAYMENT_WORKFLOW_ARCHIVED"});
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(downstream).toBe(0);
  });
});
