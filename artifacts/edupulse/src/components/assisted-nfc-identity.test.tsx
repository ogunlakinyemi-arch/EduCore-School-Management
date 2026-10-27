// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({fetch:vi.fn(),start:vi.fn(),ready:false,mode:'TEST_ONLY',amount:320000,readiness:vi.fn()}));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:'fictional-admin'})}));
vi.mock('@workspace/api-client-react',()=>({
  customFetch:api.fetch,
  useGetAuthorizedContext:()=>({data:{user:{id:9},roles:[{role:'SCHOOL_ADMIN',status:'ACTIVE',schoolId:1}]}}),
  getGetDirectStudentLiveReadinessQueryKey:(id:number,scope:unknown)=>['direct-readiness',id,scope],
  useGetDirectStudentLiveReadiness:(id:number,scope:unknown)=>{
    api.readiness(id,scope);
    return {data:{ready:api.ready,mode:api.mode,amountMinor:api.amount,currency:'NGN',
      blockers:['LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED']},isLoading:false,isFetching:false,isError:false};
  },
  createDirectStudentLiveCheckout:api.start,requestDirectStudentAssistance:vi.fn(),
}));
vi.mock('@/components/shared',()=>({
  Button:({children,testId,variant:_variant,...props}:any)=><button data-testid={testId} {...props}>{children}</button>,
  Modal:({children}:any)=><div role="dialog">{children}</div>,
}));
import {AssistedNfcPayment} from './assisted-nfc-payment';
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.clearAllMocks();api.ready=false;api.mode='TEST_ONLY';api.amount=320000;
  api.fetch.mockResolvedValue({students:[{id:31,firstName:'Ada',lastName:'Example',admissionNo:'QA-31'}],
    terms:[{id:4,name:'First Term',sessionName:'Session'},{id:5,name:'Second Term',sessionName:'Session'}],amountMinor:320000});
  api.start.mockResolvedValue({id:1,reference:'SCV4_live_fictional',state:'READY',
    checkoutUrl:'https://checkout.flutterwave.com/v3/hosted/pay/fictional'});
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
async function withForm(run:(host:HTMLDivElement)=>Promise<void>){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<QueryClientProvider client={client}><AssistedNfcPayment schoolId={1}/></QueryClientProvider>));
    await act(async()=>{host.querySelector('button')!.click();});
    for(let i=0;i<100&&!host.querySelector('[data-testid="select-assisted-student"]');i++){
      await act(async()=>{await new Promise(r=>setTimeout(r,20));});
    }
    await run(host);
  }finally{await act(async()=>root.unmount());client.clear();host.remove();}
}
async function select(host:HTMLDivElement,testId:string,value:string){
  await act(async()=>{
    const node=host.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
async function scope(host:HTMLDivElement){
  await select(host,'select-assisted-student','31');await select(host,'select-assisted-term','4');
}
it('shows a fixed read-only 3200 fee, exact student/term selectors and TEST-only blocking without a parent fee mutation',async()=>{
  await withForm(async host=>{
    await scope(host);
    const amount=host.querySelector('[aria-label="Fixed Student platform fee"]') as HTMLInputElement;
    expect(amount.value).toBe('₦3,200');expect(amount.readOnly).toBe(true);
    expect(host.textContent).toContain('TEST-only environment');
    expect(host.textContent).toContain('parent-to-school NFC card/subscription fee workflow is unchanged');
    expect((host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.fetch.mock.calls.every(([url])=>String(url).includes('assisted-options'))).toBe(true);
  });
});
it('sends only the selected IDs to direct platform checkout after LIVE readiness, not a school fee amount',async()=>{
  api.ready=true;api.mode='LIVE';
  await withForm(async host=>{
    expect((host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    await scope(host);
    await act(async()=>{(host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).click();});
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.start.mock.calls[0][0]).toBe(1);
    expect(api.start.mock.calls[0][1]).toEqual({studentId:31,termId:4});
    expect(api.start.mock.calls[0][2].headers['Idempotency-Key']).toBeTruthy();
    expect(host.textContent).toContain('SCV4_live_fictional');
    await select(host,'select-assisted-term','5');
    expect(host.textContent).not.toContain('SCV4_live_fictional');
    expect(api.readiness).toHaveBeenLastCalledWith(1,{studentId:31,termId:5});
    expect(api.start).toHaveBeenCalledTimes(1);
  });
});
it('blocks inconsistent ready responses with TEST mode or a different amount',async()=>{
  api.ready=true;api.mode='TEST_ONLY';
  await withForm(async host=>{
    await scope(host);
    expect((host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).disabled).toBe(true);
  });
  api.mode='LIVE';api.amount=500000;
  await withForm(async host=>{
    await scope(host);
    expect((host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
  });
});
it('retains an uncertain attempt without automatically retrying or showing a success',async()=>{
  api.ready=true;api.mode='LIVE';api.start.mockRejectedValue(new Error('lost response'));
  await withForm(async host=>{
    await scope(host);
    await act(async()=>{(host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).click();});
    expect(host.textContent).toContain('Do not retry automatically');
    expect((host.querySelector('[data-testid="button-direct-student-checkout"]') as HTMLButtonElement).disabled).toBe(true);
    expect(api.start).toHaveBeenCalledTimes(1);
  });
});
