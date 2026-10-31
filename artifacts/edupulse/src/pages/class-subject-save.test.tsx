// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks=vi.hoisted(()=>({save:vi.fn(),done:vi.fn(),dirty:vi.fn()}));
vi.mock("@workspace/api-client-react",()=>({useSaveClassSubjectSetup:()=>({isPending:false,mutateAsync:mocks.save})}));
vi.mock("wouter",()=>({Link:({href,children,...p}:any)=><a href={href} {...p}>{children}</a>}));
vi.mock("@/components/shared",()=>({
  Button:({children,testId,...p}:any)=><button data-testid={testId} {...p}>{children}</button>,
  EmptyState:({title,action}:any)=><div>{title}{action}</div>,
  ErrorState:({message}:any)=><div role="alert">{message}</div>,
  SkeletonPage:()=>null,Field:({children}:any)=><div>{children}</div>,
  PageHeading:()=>null,TenantPicker:()=>null,useTenant:()=>({schoolId:1}),
  useSchoolAdminAccess:()=>({canManageSchool:true}),cx:(...p:any[])=>p.filter(Boolean).join(" "),
}));
import { SubjectLinkForm } from "./class-subjects";
const props:any={
  scope:{schoolId:1,classId:4,sessionId:2,termId:null,section:"B"},
  session:{id:2,schoolId:1,startDate:"2026-09-01",endDate:"2027-07-31"},
  className:"JSS 1 B",terms:[],
  subjects:[{id:5,schoolId:1,name:"Mathematics",status:"ACTIVE"},{id:7,schoolId:1,name:"English",status:"ACTIVE"}],
  links:[{id:31,schoolId:1,classId:4,sessionId:2,termId:null,section:"B",subjectId:5,teacherId:null,status:"ACTIVE"}],
  staffing:[],teachers:[{id:6,schoolId:1,type:"TEACHER",status:"ACTIVE",firstName:"Fixture",lastName:"Teacher"}],
  syncing:false,onSaved:mocks.done,onDirty:mocks.dirty,
};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  mocks.save.mockReset().mockResolvedValue({saved:true,linkedSubjectCount:2});
  mocks.done.mockReset().mockResolvedValue(undefined);mocks.dirty.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(extra:any={}){
  await act(async()=>{root.render(<QueryClientProvider client={new QueryClient()}><SubjectLinkForm {...props} {...extra}/></QueryClientProvider>);});
}
const checkbox=(id:number)=>host.querySelector<HTMLInputElement>(`[data-testid="checkbox-subject-${id}"]`)!;
const saveButton=()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("Save"))!;
async function click(el:HTMLElement){await act(async()=>el.click());}
async function select(el:HTMLSelectElement,value:string){await act(async()=>{el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));});}
describe("School Admin class subject save controls",()=>{
  it("adds an existing catalogue subject once and submits the responsible teacher with the original scope guard",async()=>{
    await render();
    await click(checkbox(7));await click(checkbox(7));await click(checkbox(7));
    const teacher=host.querySelector<HTMLSelectElement>('[aria-label="Responsible teacher for English"]')!;
    expect(teacher).not.toBeNull();
    await select(teacher,"6");await click(saveButton());
    expect(mocks.save).toHaveBeenCalledWith({data:{
      schoolId:1,classId:4,sessionId:2,termId:null,expectedAssignmentIds:[31],
      subjects:[{subjectId:5,teacherId:null},{subjectId:7,teacherId:6}],
    }});
    expect(mocks.done).toHaveBeenCalledWith(2);
  });
  it("removes only the unchecked subject from the selected scope",async()=>{
    await render();await click(checkbox(5));await click(saveButton());
    expect(mocks.save).toHaveBeenCalledWith({data:expect.objectContaining({expectedAssignmentIds:[31],subjects:[]})});
  });
  it("keeps unsaved selections when refreshed props arrive",async()=>{
    await render();await click(checkbox(7));
    await render({links:[...props.links]});
    expect(checkbox(7).checked).toBe(true);expect(mocks.dirty).toHaveBeenLastCalledWith(true);
  });
  it("shows a save conflict and never announces success",async()=>{
    mocks.save.mockRejectedValue({data:{error:"Class subject links changed. Reload them before saving"}});
    await render();await click(checkbox(7));await click(saveButton());
    expect(host.textContent).toContain("Reload them before saving");
    expect(mocks.done).not.toHaveBeenCalled();
  });
  it("blocks a save while eligibility data is refreshing",async()=>{
    await render({syncing:true});
    expect(saveButton().disabled).toBe(true);await click(saveButton());
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("blocks a stale baseline rather than dropping another administrator's links",async()=>{
    await render();await click(checkbox(7));
    await render({links:[...props.links,{...props.links[0],id:32,subjectId:7}]});
    expect(saveButton().disabled).toBe(true);
    expect(host.textContent).toMatch(/changed/i);
  });
});
