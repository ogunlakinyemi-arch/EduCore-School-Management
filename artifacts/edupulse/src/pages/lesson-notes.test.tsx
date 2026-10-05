// @vitest-environment jsdom
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LessonNote, CurriculumTeachingContext } from '@workspace/api-client-react';

const state=vi.hoisted(()=>({create:vi.fn(),mapping:{id:1,versionId:3,status:'ACTIVE'},topic:{id:2,title:'Development test topic',sourceKind:'SCHOOL_SPECIFIC'}}));
vi.mock('@workspace/api-client-react',()=>({
  useGetLessonNote:()=>({data:null,isLoading:false,isError:false}),
  useCreateLessonNote:()=>({mutateAsync:state.create,isPending:false}),
  useUpdateLessonNote:()=>({mutateAsync:vi.fn(),isPending:false}),
  useSubmitLessonNote:()=>({mutate:vi.fn(),isPending:false}),
  useArchiveLessonNote:()=>({isPending:false}),
  useReviewLessonNote:()=>({}),useSendWeeklyLessonNoteReminders:()=>({}),
  useGetLessonNoteMonitoring:()=>({}),useListLessonNotes:()=>({}),
  useListSchoolCurriculumMappings:()=>({data:[state.mapping],isLoading:false}),
  useListSchoolCurriculumTopics:()=>({data:{topics:[state.topic]}}),
  getListLessonNotesQueryKey:()=>['notes'],getGetLessonNoteQueryKey:()=>['note'],
  getGetLessonNoteMonitoringQueryKey:()=>['monitoring'],getListSchoolCurriculumMappingsQueryKey:()=>['maps'],
  getListSchoolCurriculumTopicsQueryKey:()=>['topics'],
}));
vi.mock('@/components/shared',()=>({
  Field:(p:any)=><label>{p.label}{p.children}</label>,
  Button:(p:any)=><button onClick={p.onClick} disabled={p.disabled} data-testid={p.testId}>{p.children}</button>,
  StatusPill:()=>null,PageHeading:()=>null,SkeletonPage:()=>null,ErrorState:()=>null,EmptyState:()=>null,TenantPicker:()=>null,Metric:()=>null,
  cx:()=>'',date:()=>'',
}));
vi.mock('@/components/school-ops-kit',()=>({Notice:(p:any)=><div>{p.children}</div>,errMsg:(e:any)=>e.message,FRESH:{},useSchoolRole:()=>({})}));
vi.mock('@/components/source-download',()=>({SourceDownload:()=>null}));
vi.mock('@/components/lesson-note-pdf',()=>({LessonNotePdfPanel:()=>null}));
vi.mock('@/hooks/use-curriculum-context',()=>({useInvalidateSchool:()=>()=>{},useCurriculumContext:()=>({})}));
import { NoteEditor } from './lesson-notes';

const assignments=[
  {classId:538,className:'JSS 2',section:'A',subjectId:6,subjectName:'Mathematics',subjectCode:'MTH',sessionId:358,termId:20},
  {classId:538,className:'JSS 2',section:'B',subjectId:7,subjectName:'English',subjectCode:'ENG',sessionId:358,termId:20},
  {classId:571,className:'SSS 2',section:'Science',subjectId:15,subjectName:'Physics',subjectCode:'PHY',sessionId:358,termId:20},
] satisfies CurriculumTeachingContext[];
const ctx={assignments,sessionId:358,termId:20} as Parameters<typeof NoteEditor>[0]['ctx'];
let root:Root,el:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const find=(id:string)=>el.querySelector(`[data-testid="${id}"]`)!;
async function change(id:string,value:string){
  const field=find(id) as HTMLInputElement;
  const prototype=field.tagName==='SELECT'?HTMLSelectElement.prototype:field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(field,value);
  await act(async()=>{field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));});
}
beforeEach(async()=>{
  state.create.mockReset().mockResolvedValue({id:100,schoolId:1393,sessionId:358,termId:20,classId:538,subjectId:6,teacherId:183,
    week:1,date:'2026-10-05',status:'DRAFT',revision:0,createdAt:'2026-10-05',updatedAt:'2026-10-05'} satisfies LessonNote);
  el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);
  await act(async()=>{root.render(<NoteEditor schoolId={1393} ctx={ctx} noteId={null} onSaved={()=>{}}/>);});
});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
describe('Existing lesson-note native selectors',()=>{
  it('retains section distinctions and filters subjects by the selected class/section',async()=>{
    expect([...((find('select-note-class') as HTMLSelectElement).options)].map(o=>o.value)).toEqual(['0:','538:A','538:B','571:Science']);
    await change('select-note-class','538:A');
    expect([...((find('select-note-subject') as HTMLSelectElement).options)].map(o=>o.value)).toEqual(['0','6']);
    await change('select-note-subject','6');await change('select-note-topic','2');
    await change('select-note-class','538:B');
    expect((find('select-note-subject') as HTMLSelectElement).value).toBe('0');
    expect((find('select-note-topic') as HTMLSelectElement).value).toBe('0');
    expect([...((find('select-note-subject') as HTMLSelectElement).options)].map(o=>o.value)).toEqual(['0','7']);
  });
  it('sends the selected academic scope and topic without guessing PDF metadata',async()=>{
    await change('select-note-class','538:A');await change('select-note-subject','6');await change('select-note-topic','2');
    await act(async()=>{(find('button-save-note') as HTMLButtonElement).click();});
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({schoolId:1393,data:expect.objectContaining({
      sessionId:358,termId:20,classId:538,section:'A',subjectId:6,topicId:2,curriculumMappingId:1,curriculumVersionId:3,
    })}));
  });
  it('still requires structured content when no PDF is attached',async()=>{
    await change('select-note-class','538:A');await change('select-note-subject','6');
    await act(async()=>{(find('button-submit-note') as HTMLButtonElement).click();});
    expect(state.create).not.toHaveBeenCalled();
    expect(find('text-note-message').textContent).toContain('Complete before submitting');
  });
  it('does not mislabel a new-note uniqueness conflict as an edited existing note',async()=>{
    state.create.mockRejectedValue(Object.assign(Error('A lesson note already exists for this teaching assignment and week.'),{status:409}));
    await change('select-note-class','538:A');await change('select-note-subject','6');await change('select-note-topic','2');
    await act(async()=>{(find('button-save-note') as HTMLButtonElement).click();});
    expect(find('text-note-message').textContent).toContain('already exists');
    expect(el.querySelector('[data-testid="notice-conflict"]')).toBeNull();
  });
});
