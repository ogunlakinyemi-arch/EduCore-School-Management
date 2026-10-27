import {afterEach,describe,it,expect,vi} from "vitest";
import {readStudentTermPlatformAccess} from "./student-platform-access";
afterEach(()=>vi.useRealTimers());
describe("launch access without a card or payment",()=>{
  it("grants current-term access to the exact active school/student without financial or NFC queries",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const query=vi.fn(async()=>({rows:[{id:31}]}));
    expect(await readStudentTermPlatformAccess({query} as any,1,31)).toMatchObject({
      status:"NOT_REQUIRED",restricted:false,schoolId:1,studentId:31});
    expect(query.mock.calls).toHaveLength(1);
    expect((query.mock.calls as any)[0][1]).toEqual([1,31]);
    expect((query.mock.calls as any)[0][0]).not.toMatch(/subscriptions|payments|nfc|cards/);
  });
  it("does not grant free access to a missing/inactive/wrong-school student",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-27T12:00Z"));
    const query=vi.fn(async()=>({rows:[]}));
    expect(await readStudentTermPlatformAccess({query} as any,2,31)).toMatchObject({restricted:true,status:"UNAVAILABLE"});
  });
  it.each([
    {paid:true,today:"2027-01-26T12:00Z",restricted:false},
    {paid:false,today:"2027-01-26T12:00Z",restricted:true},
    {paid:false,today:"2027-01-24T22:59:59Z",restricted:false},
    {paid:false,today:"2027-01-24T23:00:00Z",restricted:true},
  ])("uses exact direct proof and preserves the Lagos seven-day grace (%j)",async({paid,today,restricted})=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(today));
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes('t.school_id AS "schoolId"'))return{rows:[{id:2,schoolId:1,name:"Second Term",
        startDate:"2027-01-18",endDate:"2027-04-01",isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"}]};
      if(sql.includes("SELECT t.id,t.name"))return{rows:[{id:2,name:"Second Term"}]};
      return{rows:[{paid}]};
    });
    expect(await readStudentTermPlatformAccess({query} as any,1,31)).toMatchObject({
      restricted,status:paid?"VERIFIED":"PAYMENT_REQUIRED",termId:2});
    const proof=(query.mock.calls as any).find(([s]:string[])=>s.includes("SELECT EXISTS"));
    expect(proof[1]).toEqual([1,31,2]);
    expect(proof[0]).toContain("o.amount_minor=320000");
    expect(proof[0]).toContain("o.school_share_minor=0 AND o.bro_share_minor=0");
    expect(proof[0]).toContain("PROVIDER_PAYMENT_VERIFIED");
    expect(proof[0]).not.toContain("student_subscription_payments");
  });
});
