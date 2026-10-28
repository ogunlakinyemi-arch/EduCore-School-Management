import {describe,expect,it,vi} from "vitest";
import {assertVerifiedStudentNfcPayment} from "./student-nfc-payment-evidence";
describe("student NFC activation evidence boundary",()=>{
  it.each(["CASH","BANK_TRANSFER","BANK_VERIFIED","REQUESTED","FAILED","PENDING","UNVERIFIED","MISMATCHED"])(
    "rejects %s without independent direct checkout evidence",async channel=>{
      const query=vi.fn(async()=>({rows:[{nfc_payment_verified:false,channel}]}));
      await expect(assertVerifiedStudentNfcPayment({query},7,31)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
      expect(query).toHaveBeenCalledOnce();
    });
  it("permits the existing NFC activation path only after matching verified checkout proof",async()=>{
    const query=vi.fn(async()=>({rows:[{nfc_payment_verified:true}]}));
    await expect(assertVerifiedStudentNfcPayment({query},7,31)).resolves.toBeUndefined();
    const [sql,values]=query.mock.calls[0] as unknown as [string,unknown[]];
    expect(values.slice(0,2)).toEqual([7,31]);
    for(const evidence of ["o.amount_minor=320000","o.currency='NGN'","o.school_share_minor=0",
      "o.bro_share_minor=0","a.state='PAID'","a.verified_at IS NOT NULL","PROVIDER_PAYMENT_VERIFIED",
      "ev.details->>'transactionId'=a.provider_transaction_id","t.is_current=true","ses.is_current=true"])
      expect(sql).toContain(evidence);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(sql).not.toContain("subscription_payment_assistance_requests");
  });
  it("fails closed when the database is unavailable",async()=>{
    await expect(assertVerifiedStudentNfcPayment({query:vi.fn().mockRejectedValue(new Error("fixture database unavailable"))},7,31))
      .rejects.toThrow("fixture database unavailable");
  });
});
