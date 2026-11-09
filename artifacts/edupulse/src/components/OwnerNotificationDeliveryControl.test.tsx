// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({mutate:vi.fn(),refetch:vi.fn(),view:null as any}));
vi.mock("@workspace/api-client-react",()=>({
  getGetOwnerNotificationDeliveryControlsQueryKey:()=>["owner-delivery-fixture"],
  useGetOwnerNotificationDeliveryControls:()=>({data:state.view,isLoading:false,isError:false,refetch:state.refetch}),
  useUpdateOwnerNotificationDeliveryControls:()=>({mutate:state.mutate,isPending:false}),
}));
import {OwnerNotificationDeliveryControl} from "./OwnerNotificationDeliveryControl";
let host:HTMLDivElement,root:Root;
beforeEach(async()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  state.mutate.mockReset();state.refetch.mockReset();
  state.view={controls:{paused:true,smsEnabled:false,pushEnabled:false,telegramEnabled:false,pushParentIds:[],version:0,activatedAt:null},
    configuration:{SMS:true,PUSH:true,TELEGRAM:true},worker:{running:true,lastTickAt:null,lastErrorCategory:null},
    protectedWorkersPaused:true,paymentTestNotificationsRestricted:true,queue:[],candidates:[]};
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<OwnerNotificationDeliveryControl/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("shows server-disabled defaults, protective pauses and no invented push recipient or send action",()=>{
  expect((host.querySelector('[aria-label="Push delivery enabled"]') as HTMLInputElement).checked).toBe(false);
  expect(host.textContent).toContain("No eligible push test recipients");
  expect(host.textContent).toContain("Payment test notifications restricted: yes");
  expect([...host.querySelectorAll("button")].some(b=>/send.*test|test.*send/i.test(b.textContent??""))).toBe(false);
  expect(state.mutate).not.toHaveBeenCalled();
});
it("requires a reason and submits only an explicit Owner draft with optimistic version",async()=>{
  const save=[...host.querySelectorAll("button")].find(b=>b.textContent==="Save delivery controls")!;
  expect(save.disabled).toBe(true);
  await act(async()=>{(host.querySelector('[aria-label="SMS delivery enabled"]') as HTMLInputElement).click();});
  const reason=host.querySelector("textarea")!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(reason,"Approved controlled fixture");
    reason.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await act(async()=>save.click());
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.mutate.mock.calls[0][0].data).toMatchObject({smsEnabled:true,pushEnabled:false,
    paused:true,pushParentIds:[],expectedVersion:0,reason:"Approved controlled fixture"});
});
