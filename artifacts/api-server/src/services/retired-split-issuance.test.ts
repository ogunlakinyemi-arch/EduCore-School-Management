import {describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:f}));
import {initializeLiveSubscriptionCheckout} from "./flutterwave-live-runtime";
import {saveLiveSchoolConfiguration} from "./flutterwave-live-configuration";
import {prepareSplitCheckout} from "./flutterwave-split-checkout";
describe("retired split service entry points",()=>{
  it("cannot reserve or initialize an old LIVE checkout even if called without the HTTP retirement layer",async()=>{
    const fetcher=vi.fn();
    await expect(initializeLiveSubscriptionCheckout(f as any,{
      actorId:1,schoolId:1,studentId:31,termId:4,email:"fictional@example.test",idempotencyKey:"fictional-key-123456",
    },{},fetcher)).rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(f.connect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cannot save a new legacy school/subaccount release authority",async()=>{
    await expect(saveLiveSchoolConfiguration(f as any,{
      actorId:1,evidence:{},expiresAt:"2027-01-20T12:00:00Z",
    })).rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(f.connect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it("cannot prepare frozen split instructions or attribution for a new checkout",async()=>{
    await expect(prepareSplitCheckout(7)).rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(f.connect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
});
