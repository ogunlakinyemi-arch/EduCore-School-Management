// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";

const state=vi.hoisted(()=>({
  data:{} as any, mutateAsync:vi.fn(),refetch:vi.fn(),
}));
vi.mock("@workspace/api-client-react",()=>({
  useGetSchoolCommunicationDefaults:()=>({data:state.data,isLoading:false,isError:false,refetch:state.refetch}),
  useUpdateSchoolCommunicationDefaults:()=>({isPending:false,mutateAsync:state.mutateAsync}),
}));
import {SchoolCommunicationDefaultsControl} from "./school-communication-defaults";

let host:HTMLDivElement,root:Root;
async function render(){await act(async()=>root.render(<SchoolCommunicationDefaultsControl schoolId={9}/>));}
function checkbox(channel:string,event="ACADEMIC"){
  const field=[...host.querySelectorAll("fieldset")].find(item=>item.querySelector("legend")?.textContent===event)!;
  return [...field.querySelectorAll("label")].find(label=>label.textContent?.startsWith(channel))!
    .querySelector("input") as HTMLInputElement;
}
async function clickButton(text:string){
  const button=[...host.querySelectorAll("button")].find(item=>item.textContent===text)!;
  await act(async()=>button.click());
}
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  state.data={
    defaults:{},effectiveDefaults:{ACADEMIC:["EMAIL"]},canWrite:true,
    allowed:{ACADEMIC:["IN_APP","EMAIL"],ATTENDANCE_ENTRY:["IN_APP"]},
    availability:{IN_APP:true,EMAIL:false,PUSH:false,SMS:false,TELEGRAM:false},
  };
  state.mutateAsync.mockResolvedValue({});state.refetch.mockResolvedValue({});
  host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

describe("school effective notification selections",()=>{
  it("shows inherited Email selected, In-App unselected, and permission without a delivery claim",async()=>{
    await render();
    expect(checkbox("EMAIL").checked).toBe(true);
    expect(checkbox("IN APP").checked).toBe(false);
    expect(checkbox("EMAIL").closest("label")?.textContent).toContain("Permitted, not yet deliverable");
    expect(host.textContent).toContain("Checked channels are effective selections, not delivered messages");
  });
  it("does not check Email merely because it is allowed and configured",async()=>{
    state.data.effectiveDefaults.ACADEMIC=["IN_APP"];state.data.availability.EMAIL=true;
    await render();
    expect(checkbox("EMAIL").checked).toBe(false);expect(checkbox("IN APP").checked).toBe(true);
  });
  it("keeps an explicit empty school selection disabled rather than inheriting Owner defaults",async()=>{
    state.data.defaults.ACADEMIC=[];state.data.effectiveDefaults.ACADEMIC=[];
    await render();
    expect(checkbox("EMAIL").checked).toBe(false);expect(checkbox("IN APP").checked).toBe(false);
  });
  it("does not present a stale Owner-disallowed Email override as selected",async()=>{
    state.data.defaults.ACADEMIC=["EMAIL"];state.data.allowed.ACADEMIC=["IN_APP"];
    state.data.effectiveDefaults.ACADEMIC=[];
    await render();
    expect(checkbox("EMAIL").checked).toBe(false);expect(checkbox("EMAIL").disabled).toBe(true);
    expect(checkbox("EMAIL").closest("label")?.textContent).toContain("Owner restricted");
  });
  it("allows removing a held inherited selection without creating overrides for other events",async()=>{
    await render();
    expect(checkbox("EMAIL").disabled).toBe(false);
    await act(async()=>checkbox("EMAIL").click());
    await clickButton("Save school defaults");
    expect(state.mutateAsync).toHaveBeenCalledWith({schoolId:9,data:{ACADEMIC:[]}});
  });
  it("clears unavailable inherited selections and preserves unrelated explicit selections",async()=>{
    state.data.defaults.ATTENDANCE_ENTRY=["IN_APP"];
    await render();
    await clickButton("Clear blocked selections");
    expect(checkbox("EMAIL").checked).toBe(false);
    await clickButton("Save school defaults");
    expect(state.mutateAsync).toHaveBeenCalledWith({schoolId:9,data:{ATTENDANCE_ENTRY:["IN_APP"],ACADEMIC:[]}});
  });
});
