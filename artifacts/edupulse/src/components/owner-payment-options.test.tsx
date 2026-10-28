// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({context:null as any,fetch:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:state.context}),
  customFetch:(...args:unknown[])=>state.fetch(...args),
}));
vi.mock('@/components/shared',()=>({
  cx:(...v:unknown[])=>v.filter(Boolean).join(' '),
  Field:({label,children}:any)=><label>{label}{children}</label>,
  Button:({children,testId,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
}));
import { AssistanceForm } from '@/pages/subscription-payment-rules';

let host:HTMLDivElement,root:Root,client:QueryClient;
const submit=vi.fn();
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
const schoolOptions={schools:[{id:1,name:'Alpha School'},{id:2,name:'Beta School'}],terms:[]};
const choices=(schoolId:number)=>({
  schools:schoolOptions.schools,
  terms:[{id:schoolId*10,schoolId,name:'Second Term',sessionName:'2026/2027',startDate:'2027-01-18',endDate:'2027-04-09'}],
});
const select=async(label:string,value:string)=>{
  await act(async()=>{
    const node=host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await flush();
};
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  state.context={user:{id:9,status:'ACTIVE'},roles:[{role:'PLATFORM_OWNER',schoolId:null,status:'ACTIVE'}]};
  state.fetch.mockReset();submit.mockReset();
  state.fetch.mockImplementation(async(url:string)=>{
    const schoolId=Number(new URL(url,'https://fixture.invalid').searchParams.get('schoolId'));
    if(url.startsWith('/api/students'))return [
      {id:schoolId*100,schoolId,firstName:schoolId===1?'Ada':'Bola',lastName:'Learner',admissionNo:`ADM-${schoolId}`},
      {id:999,schoolId:999,firstName:'Other',lastName:'School',admissionNo:'NO-ACCESS'},
    ];
    return schoolId?choices(schoolId):schoolOptions;
  });
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();});
async function render(){
  await act(async()=>root.render(<QueryClientProvider client={client}><AssistanceForm onSubmit={submit}/></QueryClientProvider>));
  await flush();
}
const disabled=()=>host.querySelector<HTMLButtonElement>('[data-testid="button-request-assistance"]')!.disabled;

describe('Owner payment scope selects (read-only options, mocked submission)',()=>{
  it('loads named school choices, then school-scoped students and configured terms with stable IDs',async()=>{
    await render();
    expect(host.querySelector('input[inputmode="numeric"]')).toBeNull();
    expect(disabled()).toBe(true);
    expect(state.fetch.mock.calls.some(([url])=>url.startsWith('/api/students'))).toBe(false);
    await select('School','1');
    expect(host.textContent).toContain('Ada Learner · ADM-1');
    expect(host.textContent).toContain('Second Term (2027-01-18 – 2027-04-09)');
    expect(host.textContent).not.toContain('NO-ACCESS');
    await select('Student','100');await select('Academic term','10');
    expect(disabled()).toBe(false);
    const amount=host.querySelector<HTMLInputElement>('[data-testid="input-assist-amount"]')!;
    expect(amount.readOnly).toBe(true);expect(amount.value).toBe('3200');
    await act(async()=>{
      const note=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(note,'Reviewed fixture request');
      note.dispatchEvent(new Event('input',{bubbles:true}));
      note.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(submit).toHaveBeenCalledWith({schoolId:1,studentId:100,termId:10,amountMinor:320000,requestNote:'Reviewed fixture request'});
  });
  it('clears student and term on school changes and blocks tampered/non-option IDs',async()=>{
    await render();await select('School','1');await select('Student','100');await select('Academic term','10');
    expect(disabled()).toBe(false);
    await select('School','2');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Student"]')!.value).toBe('');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Academic term"]')!.value).toBe('');
    expect(host.textContent).not.toContain('Ada Learner');expect(disabled()).toBe(true);
    await select('Student','999');await select('Academic term','10');
    expect(disabled()).toBe(true);expect(submit).not.toHaveBeenCalled();
  });
  it('shows loading, empty and error states without enabling submission',async()=>{
    state.fetch.mockImplementation(()=>new Promise(()=>{}));
    await render();expect(host.textContent).toContain('Loading authorized');expect(disabled()).toBe(true);
    state.fetch.mockResolvedValue({schools:[],terms:[]});
    await act(async()=>client.cancelQueries());await act(async()=>client.resetQueries());await flush();
    expect(host.textContent).toContain('No authorized schools');expect(disabled()).toBe(true);
    state.fetch.mockRejectedValue(new Error('fixture unavailable'));
    await act(async()=>client.refetchQueries());await flush();
    expect(host.textContent).toContain('Payment choices could not be loaded');expect(disabled()).toBe(true);
  });
  it('does not request Owner options for an unauthorized identity',async()=>{
    state.context={user:{id:10,status:'ACTIVE'},roles:[{role:'SCHOOL_ADMIN',schoolId:1,status:'ACTIVE'}]};
    await render();expect(state.fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Active Platform Owner access is required');expect(disabled()).toBe(true);
  });
  it('blocks the selected school when its student/term choices are empty or unavailable',async()=>{
    const original=state.fetch.getMockImplementation()!;
    state.fetch.mockImplementation(async(url:string,...rest:unknown[])=>{
      if(url.includes('schoolId='))return url.startsWith('/api/students')?[]:{schools:schoolOptions.schools,terms:[]};
      return original(url,...rest);
    });
    await render();await select('School','1');
    expect(host.textContent).toContain('No students or configured academic terms');expect(disabled()).toBe(true);
    state.fetch.mockImplementation(async(url:string,...rest:unknown[])=>{
      if(url.includes('schoolId='))throw new Error('fixture roster outage');
      return original(url,...rest);
    });
    await act(async()=>client.refetchQueries({queryKey:['owner-payment-choices']}));
    await flush();
    expect(host.textContent).toContain('Payment choices could not be loaded');expect(disabled()).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
});
