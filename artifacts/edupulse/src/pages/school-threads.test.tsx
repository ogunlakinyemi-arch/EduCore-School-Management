// @vitest-environment jsdom
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import type { CommunicationStudent, CommunicationGuardian } from '@workspace/api-client-react';
const state=vi.hoisted(()=>({students:vi.fn(),guardians:[] as CommunicationGuardian[],create:vi.fn()}));
const student={id:721,firstName:'Test',lastName:'Student',admissionNo:'TEST',className:'JSS 2',section:'A'} satisfies CommunicationStudent;
vi.mock('@workspace/api-client-react',()=>({
  useListCommunicationStudents:(p:any,o:any)=>{state.students(p,o);return{data:[student],isLoading:false};},
  useListCommunicationGuardians:()=>({data:state.guardians,isLoading:false}),
  useListSchoolParentMessageThreads:()=>({data:{items:[]},refetch:vi.fn()}),
  getListSchoolParentMessageThreadsQueryKey:()=>['threads'],
  useCreateSchoolParentMessageThread:()=>({mutateAsync:state.create,isPending:false}),
}));
vi.mock('@/components/shared',()=>({
  Button:(p:any)=><button data-testid={p.testId} onClick={p.onClick} disabled={p.disabled}>{p.children}</button>,
  EmptyState:()=>null,ErrorState:()=>null,SkeletonPage:()=>null,StatusPill:()=>null,date:()=>'',
}));
vi.mock('./security/ui',()=>({inputClass:'',Notice:(p:any)=><div>{p.children}</div>}));
vi.mock('@/components/school-ops-kit',()=>({errMsg:(e:any)=>e.message}));
vi.mock('./parent-communication/threads',()=>({Thread:()=>null}));
import { SchoolThreads } from './school-threads';
let root:Root,el:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{state.students.mockClear();state.guardians=[];el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
const mount=()=>act(async()=>root.render(<SchoolThreads schoolId={1393} teacher/>));
async function selectStudent(){const select=el.querySelector('[data-testid="select-thread-student"]') as HTMLSelectElement;
  await act(async()=>{select.value='721';select.dispatchEvent(new Event('change',{bubbles:true}));});}
describe('Teacher Message Parent',()=>{
  it('loads scoped students immediately, without a two-character search gate',async()=>{
    await mount();
    expect(state.students).toHaveBeenCalledWith({schoolId:1393},expect.objectContaining({query:expect.objectContaining({enabled:true})}));
    const select=el.querySelector('[data-testid="select-thread-student"]') as HTMLSelectElement;
    expect([...select.options].map(o=>o.value)).toEqual(['0','721']);
    expect(select.options[1].textContent).toContain('Test Student');
  });
  it('uses the exact missing-guardian empty state and disables sending',async()=>{
    await mount();await selectStudent();
    expect(el.querySelector('[data-testid="text-no-linked-parent"]')?.textContent).toBe('No linked parent/guardian is available for this student.');
    expect(el.querySelector('[data-testid="button-send-parent-message"]')).toBeNull();
    expect(el.textContent).not.toContain('Student not found');
  });
  it('loads only linked recipients and selects a single permitted guardian',async()=>{
    state.guardians=[{userId:914,firstName:'Test',lastName:'Guardian'}];
    await mount();await selectStudent();
    const select=el.querySelector('[data-testid="select-message-guardian"]') as HTMLSelectElement;
    expect([...select.options].map(o=>o.value)).toEqual(['0','914']);
    expect(select.value).toBe('914');
  });
});
