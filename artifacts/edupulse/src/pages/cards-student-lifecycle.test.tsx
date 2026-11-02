// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const s=vi.hoisted(()=>({owner:true,cards:[] as any[],mutate:vi.fn(),invalidate:vi.fn(),onChanged:null as null|(()=>void)}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:s.invalidate}),useMutation:()=>({mutate:vi.fn(),isPending:false})}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{isPlatformOwner:s.owner,roles:[]}}),
  useListCards:()=>({data:s.cards,isLoading:false,isError:false}),
  useListStudents:()=>({data:[],isLoading:false}),useListEmployeeNfcCards:()=>({data:[]}),
  useRegisterCard:()=>({mutate:vi.fn(),isPending:false}),
  useUpdateCardStatus:()=>({mutate:s.mutate,isPending:false}),getListCardsQueryKey:(p?:unknown)=>p?['/api/cards',p]:['/api/cards'],
}));
vi.mock('wouter',()=>({Link:({children}:any)=><span>{children}</span>}));
vi.mock('@/components/owner-card-link',()=>({OwnerCardLink:()=>null}));
vi.mock('@/components/printable-nfc-card-download',()=>({PrintableNfcCardDownload:()=>null}));
vi.mock('@/components/card-brand-settings',()=>({CardBrandSettings:()=>null}));
vi.mock('@/components/official-card-preview',()=>({OfficialCardPreview:()=>null}));
vi.mock('@/hooks/use-phase9-api',()=>({phase9Request:vi.fn()}));
vi.mock('@/components/owner-student-card-lifecycle',()=>({OwnerStudentCardLifecycle:(p:any)=>{s.onChanged=p.onChanged;return <div data-testid="lifecycle">{p.uid}</div>;}}));
vi.mock('@/components/shared',()=>({
  PageHeading:({children}:any)=><div>{children}</div>,Button:({children,testId,variant,...p}:any)=><button data-testid={testId} {...p}>{children}</button>,
  StatusPill:({value}:any)=><span>{value}</span>,SkeletonPage:()=>null,ErrorState:()=>null,EmptyState:()=>null,
  Modal:({title,children}:any)=><div role="dialog" aria-label={title}>{children}</div>,Field:({children}:any)=><label>{children}</label>,
  TenantPicker:()=>null,useTenant:()=>({schoolId:2,setSchoolId:vi.fn()}),cx:(...a:any[])=>a.filter(Boolean).join(' '),
}));
import {CardsPage} from './cards';
let root:Root,host:HTMLDivElement;
const q=(id:string)=>host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;s.owner=true;s.mutate.mockReset();s.invalidate.mockReset();
  s.cards=[{id:1,uid:'ACT1',status:'active',studentId:3,studentName:'Ada'},{id:2,uid:'LCK2',status:'locked',studentId:4},
    {id:3,uid:'RST3',status:'restricted',studentId:5},{id:4,uid:'EMP4',status:'active',employeeId:8,employeeName:'Tolu'}];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('opens lifecycle for every active/locked/restricted student card and never calls the generic PATCH lock',async()=>{
  await act(async()=>root.render(<CardsPage/>));
  for(const id of [1,2,3])expect(q(`button-manage-student-card-${id}`)).not.toBeNull();
  expect(q('button-card-status-1')).toBeNull();expect(q('button-manage-student-card-4')).toBeNull();
  await act(async()=>q('button-manage-student-card-1')!.click());
  expect(q('lifecycle')!.textContent).toBe('ACT1');expect(s.mutate).not.toHaveBeenCalled();
  await act(async()=>s.onChanged!());
  expect(s.invalidate).toHaveBeenCalledWith({queryKey:['/api/cards']});expect(q('lifecycle')).not.toBeNull();
});
it('hides student management from non-owners',async()=>{
  s.owner=false;await act(async()=>root.render(<CardsPage/>));expect(q('button-manage-student-card-1')).toBeNull();
});
