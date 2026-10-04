// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FeeCategory, FeeStructure } from '@workspace/api-client-react';
import { FinancePage } from './finance';

const state=vi.hoisted(()=>({
  categories: [] as FeeCategory[], structures: [] as FeeStructure[], role:'SCHOOL_ADMIN',
  students: [] as {id:number;schoolId:number;className:string;section:string;firstName:string;lastName:string;admissionNo:string}[],
  loading:'', error:'', create:vi.fn(), createCategory:vi.fn(),assign:vi.fn(),
}));
const sessions=[{id:358,schoolId:1393,name:'2026/2027',startDate:'2026-09-14',endDate:'2026-12-18',status:'ACTIVE'}];
const terms=[{id:20,sessionId:358,name:'FIRST'},{id:21,sessionId:358,name:'SECOND'}];
const classes=[{id:571,schoolId:1393,name:'SS 1',section:'Science'},{id:573,schoolId:1393,name:'SS 1',section:'Commercial'}];
const tuition={id:11,schoolId:1393,name:'Tuition',description:'',compulsory:true,status:'ACTIVE'} satisfies FeeCategory;
const draft={id:91,schoolId:1393,sessionId:358,termId:20,classId:571,section:'Science',version:1,status:'DRAFT',
  lines:[{categoryId:11,categoryName:'Tuition',description:'',amountMinor:800000}]} satisfies FeeStructure;
vi.mock('@workspace/api-client-react',async original=>{
  const actual=await original<typeof import('@workspace/api-client-react')>();
  const result=(name:string,data:unknown)=>({data,isLoading:state.loading===name,isFetching:state.loading===name,
    isError:state.error===name,error:state.error===name?new Error('offline'):null,refetch:vi.fn()});
  const idle=()=>({isPending:false,mutateAsync:vi.fn()});
  return {...actual,
    useGetAuthorizedContext:()=>result('context',{roles:[{role:state.role,schoolId:1393,status:'ACTIVE'}]}),
    useGetSchoolFinanceSummary:()=>result('summary',{}),useGetFinanceSettings:()=>result('settings',{}),
    useListFeeCategories:()=>result('categories',state.categories),
    useListFeeStructures:()=>result('structures',state.structures),
    useListFeeInvoices:()=>result('invoices',[]),useListStudents:()=>result('students',state.students),
    useListAcademicSessions:()=>result('sessions',sessions),
    useListAcademicTerms:(id:number)=>result('terms',terms.filter(t=>t.sessionId===id)),
    useListClasses:()=>result('classes',classes),
    useCreateFeeStructure:()=>({isPending:false,mutateAsync:state.create}),
    useCreateFeeCategory:()=>({isPending:false,mutateAsync:state.createCategory}),
    useUpdateFeeCategory:idle,usePublishFeeStructure:idle,useAssignFeeStructure:()=>({isPending:false,mutateAsync:state.assign}),
    useUpdateFinanceSettings:idle,useRequestFeeAdjustment:idle,
  };
});
vi.mock('@/components/shared',()=>({
  useTenant:()=>({schoolId:1393}),TenantPicker:()=>null,PageHeading:()=>null,
  Button:({children,testId,variant,...p}:any)=><button type="button" data-testid={testId} {...p}>{children}</button>,
  Field:({label,children}:any)=><label>{label}{children}</label>,
  Modal:({title,children}:any)=><div role="dialog"><h2>{title}</h2>{children}</div>,
  EmptyState:({title}:any)=><div>{title}</div>,ErrorState:()=> <div>Request failed</div>,
  SkeletonPage:()=> <div>Loading</div>,StatusPill:({value}:any)=><span>{value}</span>,
}));
let host:HTMLDivElement,root:Root,qc:QueryClient;
const id=(name:string)=>host.querySelector<HTMLElement>(`[data-testid="${name}"]`)!;
const click=async(name:string)=>{await act(async()=>id(name).click());};
const change=async(name:string,value:string)=>{
  await act(async()=>{const element=id(name) as HTMLInputElement;
    const prototype=element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);
    element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});
};
const render=async()=>{await act(async()=>root.render(<QueryClientProvider client={qc}><FinancePage/></QueryClientProvider>));};
const open=async()=>{await render();await click('tab-finance-structures');await click('button-create-structure');};
const period=async()=>{await change('select-structure-session','358');await change('select-structure-term','20');await change('select-structure-class','571');};
const submit=async()=>{await act(async()=>host.querySelector('[role=dialog] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();
  state.categories=[];state.structures=[];state.students=[];state.role='SCHOOL_ADMIN';state.loading='';state.error='';
  state.create.mockResolvedValue(draft);state.createCategory.mockResolvedValue(tuition);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
describe('published structure invoice assignment',()=>{
  const pupil={id:721,schoolId:1393,className:'Primary 1',section:'A',firstName:'Existing',lastName:'Pupil',admissionNo:'ADM-NOT-A-STUDENT-ID'};
  const openAssignment=async()=>{
    state.structures=[{...draft,status:'PUBLISHED'}];
    await render();await click('tab-finance-structures');await click('button-assign-structure-91');
  };
  it('explains the missing eligible class/section instead of offering an unrelated pupil',async()=>{
    state.students=[pupil];await openAssignment();
    expect(host.textContent).toContain('No students are enrolled in SS 1 / Science');
    expect((id('select-invoice-student') as HTMLSelectElement).options).toHaveLength(1);
    expect((id('button-issue-invoice') as HTMLButtonElement).disabled).toBe(true);
    await submit();expect(state.assign).not.toHaveBeenCalled();
  });
  it('sends the canonical numeric pupil ID, not the admission number, for an eligible pupil',async()=>{
    state.students=[{...pupil,className:'SS 1',section:'Science'}];await openAssignment();
    await change('select-invoice-student','721');
    await change('input-invoice-issue-date','2026-10-04');await change('input-invoice-due-date','2026-10-12');
    await submit();expect(state.assign).toHaveBeenCalledWith({params:{schoolId:1393},
      data:{structureId:91,studentId:721,issueDate:'2026-10-04',dueDate:'2026-10-12'}});
    expect(host.textContent).toContain('Invoice issued to student');
  });
  it('blocks issuance when class data fails to load',async()=>{
    state.students=[{...pupil,className:'SS 1',section:'Science'}];state.error='classes';await openAssignment();
    expect(host.textContent).toContain('Unable to load eligible students');
    expect((id('button-issue-invoice') as HTMLButtonElement).disabled).toBe(true);
    await submit();expect(state.assign).not.toHaveBeenCalled();
  });
  it('retains the eligibility explanation after a new page mount',async()=>{
    state.students=[pupil];await openAssignment();
    await act(async()=>root.render(null));await openAssignment();
    expect(host.textContent).toContain('No students are enrolled in SS 1 / Science');
  });
});
afterEach(async()=>{await act(async()=>root.unmount());qc.clear();host.remove();});
describe('School Admin New Structure flow',()=>{
  it('opens the actual creation form even when there are no fee categories',async()=>{
    await open();expect(host.querySelector('[role=dialog]')).not.toBeNull();
    expect(host.textContent).toContain('No active fee categories are configured');
    expect(id('button-create-structure').hasAttribute('disabled')).toBe(false);
  });
  it('creates a requested category through the normal UI and resumes the selected structure',async()=>{
    await open();await period();await click('button-structure-create-category');
    await change('input-category-name','Tuition');state.categories=[tuition];await submit();
    expect(state.createCategory).toHaveBeenCalledWith({params:{schoolId:1393},data:expect.objectContaining({name:'Tuition'})});
    expect((id('select-structure-class') as HTMLSelectElement).value).toBe('571');
    expect((id('select-line-category-0') as HTMLSelectElement).value).toBe('11');
  });
  it('creates a valid draft with numeric IDs and naira converted exactly to minor units',async()=>{
    state.categories=[tuition];await open();await period();await change('select-line-category-0','11');await change('input-line-amount-0','8000');await submit();
    expect(state.create).toHaveBeenCalledWith({params:{schoolId:1393},data:{sessionId:358,termId:20,classId:571,section:'Science',
      lines:[{categoryId:11,amountMinor:800000,description:''}]}});
    expect(host.textContent).toContain('Draft structure created');expect(host.querySelector('[role=dialog]')).toBeNull();
  });
  it.each(['','0','21474836.48'])('rejects invalid amount %s without calling the create API',async(amount)=>{
    state.categories=[tuition];await open();await period();await change('select-line-category-0','11');await change('input-line-amount-0',amount);await submit();
    expect(state.create).not.toHaveBeenCalled();expect(host.textContent).toContain('valid amount greater than zero');
  });
  it('blocks saving an invalid period',async()=>{
    state.categories=[tuition];await open();await submit();expect(state.create).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Select a valid academic session, term and class');
  });
  it('clears dependent period/class/section selections',async()=>{
    await open();await period();await change('select-structure-session','');
    expect((id('select-structure-term') as HTMLSelectElement).value).toBe('');
    expect((id('select-structure-class') as HTMLSelectElement).value).toBe('');
    expect((id('input-structure-section') as HTMLSelectElement).value).toBe('');
  });
  it('maps section selection to an existing class row',async()=>{
    await open();await period();await change('input-structure-section','Commercial');
    expect((id('select-structure-class') as HTMLSelectElement).value).toBe('573');
  });
  it('shows a useful required-data loading state',async()=>{
    state.loading='sessions';await open();expect(host.textContent).toContain('Loading fee structure form');
    expect((id('select-structure-session') as HTMLSelectElement).disabled).toBe(true);
  });
  it('shows and recovers a failed form-data request rather than treating it as empty',async()=>{
    state.error='sessions';await open();expect(host.textContent).toContain('Unable to load fee structure form');
    await submit();expect(state.create).not.toHaveBeenCalled();state.error='';await render();
    expect((id('select-structure-session') as HTMLSelectElement).disabled).toBe(false);
  });
  it('renders an existing saved structure after a new component mount',async()=>{
    state.structures=[draft];await render();await click('tab-finance-structures');
    expect(host.textContent).toContain('Structure #91');expect(host.textContent).toContain('Tuition: ₦8,000.00');
  });
  it('surfaces the backend creation error and leaves the form open',async()=>{
    state.categories=[tuition];state.create.mockRejectedValue(new Error('Category is unavailable'));
    await open();await period();await change('select-line-category-0','11');await change('input-line-amount-0','8000');await submit();
    expect(host.textContent).toContain('Unable to save fee structure');expect(host.querySelector('[role=dialog]')).not.toBeNull();
  });
  it.each(['ACCOUNTANT','TEACHER'])('does not enable School Admin creation for %s',async(role)=>{
    state.role=role;await render();await click('tab-finance-structures');
    expect((id('button-create-structure') as HTMLButtonElement).disabled).toBe(true);
  });
});