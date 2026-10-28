// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({data:null as any,error:false,loading:false,hook:vi.fn(),request:vi.fn(),checkout:vi.fn(),close:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  useGetOwnerBankTransferInstructions:(...args:unknown[])=>{f.hook(...args);return{
    data:f.data,isError:f.error,isLoading:f.loading,isFetching:f.loading,refetch:vi.fn(),
  };},
  requestDirectStudentAssistance:f.request,createDirectStudentLiveCheckout:f.checkout,
  useGetAuthorizedContext:()=>({data:{user:{id:9}}}),
  getGetDirectStudentLiveReadinessQueryKey:()=>[],
  useGetDirectStudentLiveReadiness:()=>({data:{ready:false,blockers:['REVIEW_REQUIRED']},isFetching:false,isLoading:false}),
}));
vi.mock('@/components/shared',()=>({
  Modal:({children,title,onClose}:any)=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close dialog</button></div>,
  Button:({children,variant,testId,...props}:any)=><button {...props} data-testid={testId}>{children}</button>,
  Info:({label,value}:any)=><div><span>{label}</span><div>{value}</div></div>,
}));
import {OwnerBankTransferAssistance} from './owner-bank-transfer-assistance';
import {DirectStudentLivePanel} from './direct-student-live-panel';
let root:Root,host:HTMLDivElement;
const verified=()=>({available:true,amountMinor:320000,currency:'NGN',schoolName:'Fictional School',
  termName:'Second Term',transferReference:'YETENIA-S1-T4-ST31',collectionPeriodEligible:true,
  ownerConfigurationPath:null,message:'Evidence is not confirmation.',
  bank:{businessName:'Fictional Owner Business',bankName:'Fictional Bank',accountName:'Fictional Business Account',accountNumber:'0000000001'}});
const render=async(node=<OwnerBankTransferAssistance schoolId={1} studentId={31} termId={4} actorId={9} onClose={f.close}/>)=>{
  await act(async()=>root.render(node));
};
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  f.data=verified();f.error=false;f.loading=false;
  for(const spy of [f.hook,f.request,f.checkout,f.close])spy.mockReset();
  f.request.mockResolvedValue({id:51,status:'REQUESTED'});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const input=async()=>{
  await act(async()=>{
    const textarea=host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Fictional transfer REF-51, 2027-01-12, receipt evidence E-51');
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
  });
};
const submit=async()=>{await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
describe('bank-transfer assistance display, scope and no-payment confirmation',()=>{
  it('displays only fetched verified details, exact rate and reference without submitting or starting payment',async()=>{
    await render();
    expect(host.textContent).toContain('₦3,200 per student per academic term');
    expect(host.textContent).toContain('Fictional Bank');expect(host.textContent).toContain('0000000001');
    expect(host.textContent).toContain('YETENIA-S1-T4-ST31');
    expect(host.textContent).toContain('does not confirm a transfer or mark a subscription paid');
    expect(host.textContent).toContain('optional bank-transfer assistance');
    expect(host.textContent).toContain('not a school settlement account, split/subaccount setup or proof of Flutterwave LIVE readiness');
    expect(host.textContent).toContain('even after receipt is confirmed, never activate NFC or pay the subscription');
    expect(host.textContent).toContain('a separate authorized Flutterwave payment link');
    expect(f.request).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
    expect(f.hook.mock.calls[0][2].query).toMatchObject({gcTime:0,staleTime:0,retry:false,
      queryKey:['owner-transfer-instructions',9,1,31,4]});
  });
  it('shows unavailable and Owner-only configuration guidance without placeholder data or a school configuration link',async()=>{
    f.data={...verified(),available:false,bank:null,message:'Verified Owner business details are unavailable. Do not transfer funds.'};
    await render();
    expect(host.textContent).toContain('Do not transfer funds');
    expect(host.textContent).toContain('School Admins cannot configure or approve this account');
    expect(host.textContent).toContain('contact the Platform Owner');
    expect(host.textContent).toContain('No supported company verification action is currently available');
    expect(host.textContent).not.toContain('complete verification of the company account in');
    expect(host.textContent).not.toContain('0000000001');expect(host.querySelector('a')).toBeNull();
  });
  it('hides unverified bank details even if an unavailable response contains stale bank fields',async()=>{
    f.data={...verified(),available:false};
    await render();
    expect(host.textContent).not.toContain('0000000001');
    expect(host.textContent).not.toContain('Fictional Bank');
    expect(host.textContent).toContain('Do not transfer funds; contact the Platform Owner');
    expect(f.request).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
  });
  it('offers the existing account configuration link to Owner responses only, without a School Admin request form',async()=>{
    f.data={...verified(),available:false,bank:null,ownerConfigurationPath:'/payment-settlement'};
    await render();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/payment-settlement');
    expect(host.querySelector('form')).toBeNull();
  });
  it('hides old bank details and blocks evidence submission on a refresh error',async()=>{
    f.error=true;await render();
    expect(host.textContent).toContain('Do not transfer funds');expect(host.textContent).not.toContain('0000000001');
    expect(host.querySelector('form')).toBeNull();expect(f.request).not.toHaveBeenCalled();
  });
  it('preserves free-period controls without presenting an amount as currently owed',async()=>{
    f.data={...verified(),collectionPeriodEligible:false};await render();
    expect(host.textContent).toContain('not currently eligible');
    expect(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  });
  it('sends evidence once through the existing REQUESTED workflow with the correct reference and no checkout',async()=>{
    await render();await input();await submit();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledWith(1,{studentId:31,termId:4,
      requestNote:'YETENIA-S1-T4-ST31\nEvidence/request: Fictional transfer REF-51, 2027-01-12, receipt evidence E-51'});
    expect(host.textContent).toContain('No transfer has been confirmed or subscription credited');
    expect(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    await submit();expect(f.request).toHaveBeenCalledOnce();expect(f.checkout).not.toHaveBeenCalled();
  });
  it('does not automatically retry or claim payment when evidence submission is uncertain',async()=>{
    f.request.mockRejectedValue(new Error('fictional transport failure'));
    await render();await input();await submit();await submit();
    expect(f.request).toHaveBeenCalledOnce();expect(host.textContent).toContain('Do not resubmit or transfer again');
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it('treats unexpected confirmed-status responses as uncertain, never as subscription payment',async()=>{
    f.request.mockResolvedValue({id:51,status:'BANK_VERIFIED'});
    await render();await input();await submit();
    expect(host.textContent).toContain('request may already have been saved');
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it('the School Admin action opens instructions without creating a request, and close removes bank details',async()=>{
    await render(<DirectStudentLivePanel schoolId={1} selectionOptions={{
      students:[{id:31,firstName:'Fictional',lastName:'Student',admissionNo:'FICTIONAL-31'}],
      terms:[{id:4,name:'Second Term',sessionName:'2026/2027'}],
    }}/>);
    expect(f.hook).not.toHaveBeenCalled();expect(host.textContent).not.toContain('0000000001');
    await act(async()=>{
      const selects=host.querySelectorAll('select');
      selects[0].value='31';selects[0].dispatchEvent(new Event('change',{bubbles:true}));
      selects[1].value='4';selects[1].dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="button-request-direct-assistance"]')!.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();expect(host.textContent).toContain('0000000001');
    expect(f.request).not.toHaveBeenCalled();expect(f.checkout).not.toHaveBeenCalled();
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Close dialog')!.click());
    expect(host.textContent).not.toContain('0000000001');
  });
});
