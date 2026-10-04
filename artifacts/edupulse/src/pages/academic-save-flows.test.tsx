// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '@workspace/api-client-react';
import { academicSaveError } from '@/components/academic-save-error';
import { TimetableEntryForm } from './timetable';
import { SessionForm } from './academics';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), session: vi.fn(), editSession: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  useCreateAcademicTimetableEntry: () => ({mutateAsync:mocks.create,isPending:false}),
  useUpdateAcademicTimetableEntry: () => ({mutateAsync:mocks.update,isPending:false}),
  useCreateAcademicSession: () => ({mutate:mocks.session,isPending:false}),
  useUpdateAcademicSession: () => ({mutate:mocks.editSession,isPending:false}),
}));
vi.mock('@/components/shared', () => ({
  Field: ({label,children}:any) => <label>{label}{children}</label>,
  Button: ({children,variant,testId,...props}:any) => <button type="button" data-testid={testId} {...props}>{children}</button>,
}));
vi.mock('@/components/school-ops-kit', () => ({Notice:({children}:any)=><div>{children}</div>}));
let host:HTMLDivElement;
let root:Root;
beforeEach(()=>{
  vi.clearAllMocks();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  mocks.create.mockResolvedValue({id:1});mocks.update.mockResolvedValue({id:1});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const base = {
  schoolId:1,sessionId:2,termId:3,
  session:{id:2,schoolId:1,startDate:'2026-09-01',endDate:'2027-07-31'},
  classes:[{id:4,name:'SS2',section:'B'}],
  subjects:[{id:5,schoolId:1,name:'Maths'}],
  subjectAssignments:[{id:20,schoolId:1,sessionId:2,termId:3,classId:4,section:'B',subjectId:5,teacherId:6,status:'ACTIVE'}],
  teacherAssignments:[{id:21,schoolId:1,sessionId:2,classId:4,section:'B',subjectId:5,teacherId:6,assignmentType:'SUBJECT_TEACHER',status:'ACTIVE',startDate:'2026-09-01',endDate:null}],
  teachers:[{id:6,schoolId:1,employeeId:'T-006',firstName:'Test',lastName:'Teacher',type:'TEACHER',status:'ACTIVE'},
    {id:7,schoolId:1,employeeId:'D-007',firstName:'Test',lastName:'Driver',type:'DRIVER',status:'ACTIVE'}] satisfies Employee[],
  initial:{id:8,classId:4,subjectId:5,teacherId:6,weekday:'MONDAY',startTime:'08:00',endTime:'09:00'},
  onDone:vi.fn(),onCancel:vi.fn(),
};
async function submit(){
  await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
}
describe('timetable save form',()=>{
  it('creates using the selected period, numeric IDs and class section',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} initial={null} defaultClassId={4}/>));
    const selects=host.querySelectorAll('select');
    await act(async()=>{
      for(const [select,value] of [[selects[3],'5'],[selects[4],'6']] as const){
        select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
      }
    });
    await submit();
    expect(mocks.create).toHaveBeenCalledWith({data:expect.objectContaining({schoolId:1,sessionId:2,termId:3,classId:4,section:'B',subjectId:5,teacherId:6})});
    expect(base.onDone).toHaveBeenCalledOnce();
  });
  it('edits the existing ID rather than creating a duplicate',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base}/>));await submit();
    expect(mocks.update).toHaveBeenCalledWith({entryId:8,data:expect.objectContaining({classId:4,section:'B'})});
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps the form open and displays backend conflicts',async()=>{
    mocks.update.mockRejectedValue({data:{error:{message:'Timetable teacher conflict'}}});
    await act(async()=>root.render(<TimetableEntryForm {...base}/>));await submit();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Timetable teacher conflict');
    expect(base.onDone).not.toHaveBeenCalled();
  });
  it('rejects a missing term before calling the API',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} termId={undefined}/>));await submit();
    expect(mocks.update).not.toHaveBeenCalled();expect(host.textContent).toContain('Select a valid session and term');
  });
  it('rejects reversed times before calling the API',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} initial={{...base.initial,startTime:'10:00'}}/>));await submit();
    expect(mocks.update).not.toHaveBeenCalled();expect(host.textContent).toContain('End time must be later');
  });
  it('renders teachers from the real employee API type field, not drivers',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base}/>));
    expect(host.textContent).toContain('Test Teacher');expect(host.textContent).not.toContain('Test Driver');
  });
  it('does not render another school teacher or inactive teachers',async()=>{
    const teachers=[...base.teachers,
      {...base.teachers[0],id:9,schoolId:99,firstName:'Other',lastName:'School'},
      {...base.teachers[0],id:10,status:'INACTIVE',firstName:'Inactive',lastName:'Teacher'}];
    await act(async()=>root.render(<TimetableEntryForm {...base} teachers={teachers}/>));
    expect(host.textContent).toContain('Test Teacher');
    expect(host.textContent).not.toContain('Other School');expect(host.textContent).not.toContain('Inactive Teacher');
  });
  it('explains an empty eligible list instead of silently showing no options',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} teachers={[]}/>));
    const select=host.querySelectorAll('select')[4];
    expect(select.disabled).toBe(true);expect(select.textContent).toContain('No eligible teachers available');
    expect(host.textContent).toContain('No eligible teacher is assigned to this subject/class');
  });
  it('never submits a teacher ID from another school',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} teachers={[{...base.teachers[0],schoolId:99}]}/>));
    await submit();
    expect(mocks.update).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('not assigned to this subject/class');
  });
  it('does not offer an active same-school English teacher for Maths',async()=>{
    const english={...base.teachers[0],id:11,firstName:'English',lastName:'Teacher'};
    await act(async()=>root.render(<TimetableEntryForm {...base} teachers={[...base.teachers,english]} teacherAssignments={[
      ...base.teacherAssignments,{...base.teacherAssignments[0],id:22,teacherId:11,subjectId:12},
    ]}/>));
    expect([...host.querySelectorAll('select')[4].options].map(o=>o.value)).toEqual(['','6']);
    expect(host.textContent).not.toContain('English Teacher');
  });
  it('clears a stale teacher when the subject changes and submits only the new assignment',async()=>{
    const english={...base.teachers[0],id:11,firstName:'English',lastName:'Teacher'};
    await act(async()=>root.render(<TimetableEntryForm {...base}
      teachers={[...base.teachers,english]} subjects={[...base.subjects,{id:12,schoolId:1,name:'English'}]}
      subjectAssignments={[...base.subjectAssignments,{...base.subjectAssignments[0],id:22,subjectId:12,teacherId:11}]}
      teacherAssignments={[...base.teacherAssignments,{...base.teacherAssignments[0],id:23,subjectId:12,teacherId:11}]}/>));
    const selects=host.querySelectorAll('select');
    await act(async()=>{selects[3].value='12';selects[3].dispatchEvent(new Event('change',{bubbles:true}));});
    expect(selects[4].value).toBe('');
    await submit();expect(mocks.update).not.toHaveBeenCalled();
    await act(async()=>{selects[4].value='11';selects[4].dispatchEvent(new Event('change',{bubbles:true}));});
    await submit();expect(mocks.update).toHaveBeenCalledWith({entryId:8,data:expect.objectContaining({subjectId:12,teacherId:11})});
  });
  it('clears subject and teacher when class/section changes',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base} classes={[...base.classes,{id:14,name:'SS2',section:'C'}]}/>));
    const selects=host.querySelectorAll('select');
    await act(async()=>{selects[0].value='14';selects[0].dispatchEvent(new Event('change',{bubbles:true}));});
    expect(selects[2].value).toBe('C');expect(selects[3].value).toBe('');expect(selects[4].value).toBe('');
    await submit();expect(mocks.update).not.toHaveBeenCalled();
  });
  it('clears a teacher whose assignment is revoked while the form is open',async()=>{
    await act(async()=>root.render(<TimetableEntryForm {...base}/>));
    await act(async()=>root.render(<TimetableEntryForm {...base} teacherAssignments={[]}/>));
    expect(host.querySelectorAll('select')[4].value).toBe('');
    await submit();expect(mocks.update).not.toHaveBeenCalled();
  });
});
describe('reuse an existing academic year',()=>{
  it('routes the same year to its terms without a duplicate session POST',async()=>{
    const useExisting=vi.fn();
    await act(async()=>root.render(<SessionForm schoolId={1} existingSessions={[{id:2,name:'2026/2027'}]} onUseExisting={useExisting} onDone={vi.fn()} onCancel={vi.fn()}/>));
    const input=host.querySelector('input')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2026/2027');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const reuse=host.querySelector<HTMLButtonElement>('[data-testid=button-use-existing-session]');
    expect(reuse).not.toBeNull();
    await act(async()=>reuse!.click());
    expect(useExisting).toHaveBeenCalledWith(2);expect(mocks.session).not.toHaveBeenCalled();expect(mocks.editSession).not.toHaveBeenCalled();
  });
});
describe('academic API error contracts',()=>{
  it.each([
    [{data:{error:'Timetable class and section conflict'}},'Timetable class and section conflict'],
    [{data:{error:{message:'An academic record with these details already exists.'}}},'An academic record with these details already exists.'],
    [{data:{message:'Term does not belong to this session'}},'Term does not belong to this session'],
    [null,'Could not save this academic record.'],
  ])('renders a safe useful message for %j',(error,message)=>expect(academicSaveError(error)).toBe(message));
});