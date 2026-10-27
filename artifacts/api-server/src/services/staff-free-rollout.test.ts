import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readStaffCollection} from "./staff-free-rollout";
import {readStaffSubscriptionAccess} from "./staff-subscription-access";
import {generateStaffNfcTermSubscriptions} from "../routes/staff-nfc-billing-service";
const state=vi.hoisted(()=>({locked:false}));
vi.mock("./school-subscription-lock",()=>({assertManualSchoolUnlocked:vi.fn(async()=>{
  if(state.locked)throw Object.assign(new Error("Locked"),{eventType:"SCHOOL_SUBSCRIPTION_LOCKED"});
})}));
const term={id:11,schoolId:1,name:"Second Term",startDate:"2027-01-11",endDate:"2027-04-09",
  isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"};
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));state.locked=false;});
afterEach(()=>vi.useRealTimers());
describe("Teacher/Staff free launch policy",()=>{
  it("does not create any subscription, audit write or provider action in the free term",async()=>{
    const query=vi.fn().mockRejectedValue(new Error("No SQL should run"));
    expect(await generateStaffNfcTermSubscriptions({query},1,1,11,9)).toEqual({
      eligibleCount:0,generatedCount:0,unchangedCount:0,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it.each(["UNPAID","PENDING","FAILED","PAID","REFUNDED"])("does not rewrite a historical %s record or demand payment",async(status)=>{
    const saved={employeeId:8,termId:10,subscriptionId:14,status,verified:false};
    const query=vi.fn().mockResolvedValue({rows:[saved]});
    expect(await readStaffSubscriptionAccess({query},9,1)).toMatchObject({
      status:"NOT_REQUIRED",restricted:false,priceMinor:0,subscriptionId:14,
    });
    expect(saved.status).toBe(status);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
  });
  it("does not grant access without an active employee in this school",async()=>{
    expect(await readStaffSubscriptionAccess({query:vi.fn().mockResolvedValue({rows:[]})},9,2))
      .toMatchObject({restricted:true});
  });
  it("preserves explicit Owner manual locks",async()=>{
    state.locked=true;
    await expect(readStaffSubscriptionAccess({query:vi.fn().mockResolvedValue({rows:[{employeeId:8}]})},9,1))
      .rejects.toMatchObject({eventType:"SCHOOL_SUBSCRIPTION_LOCKED"});
  });
  it.each([
    ["2027-01-10", [term], false],
    ["2027-01-11", [term], true],
    ["2027-01-11", [], false],
    ["2027-01-11", [term,{...term,id:12}], false],
    ["2027-01-11", [{...term,schoolId:2}], false],
    ["2027-01-11", [{...term,name:"First Term"}], false],
    ["2027-01-11", [{...term,status:"CANCELLED"}], false],
    ["2027-04-10", [term], false],
  ])("uses the school's real calendar on %s",async(date,rows,chargeable)=>{
    vi.setSystemTime(new Date(`${date}T12:00:00Z`));
    expect((await readStaffCollection({query:vi.fn().mockResolvedValue({rows})},1)).chargeable).toBe(chargeable);
  });
  it("never rebills the old free term during a later payable term",async()=>{
    vi.setSystemTime(new Date("2027-01-12T12:00:00Z"));
    const rows=[term,{...term,id:10,name:"First Term",startDate:"2026-09-07",endDate:"2026-12-18",isCurrent:false}];
    expect((await readStaffCollection({query:vi.fn().mockResolvedValue({rows})},1,10)).chargeable).toBe(false);
  });
});
