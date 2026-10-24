// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({owner:false,schoolId:10,actorId:1,query:{} as any,checkout:vi.fn(),refresh:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  useGetAuthorizedContext:()=>({data:{user:{id:state.actorId}}}),
  useGetSchoolBillingContext:()=>({...state.query,refetch:state.refresh}),
  initializeLiveSchoolSubscription:(...args:any[])=>state.checkout(...args),
}));
vi.mock('./shared',()=>({
  useTenant:()=>({schoolId:state.schoolId}),
  useSchoolAdminAccess:()=>({isPlatformOwner:state.owner}),
}));
import {SchoolBillingDashboard} from './school-billing-dashboard';
let host:HTMLDivElement,root:Root;
const context=()=>({actorId:1,schoolId:10,mode:'LIVE',reason:'LIVE_CONTEXT',termId:7,termName:'Current numeric term',
  students:[{studentId:20,studentName:'Eligible student',status:'UNPAID',checkoutAllowed:true,reference:null,checkoutUrl:null}]});
function render(){act(()=>root.render(<SchoolBillingDashboard legacy={<div>Legacy TEST checkout</div>}/>))}
const buttons=()=>Array.from(host.querySelectorAll('button'));
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();
  state.owner=false;state.schoolId=10;state.actorId=1;state.checkout.mockReset();state.refresh.mockReset();
  state.query={data:context(),isLoading:false,isError:false};
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove()});
describe('server-selected school billing and recovery',()=>{
  it('never mounts legacy checkout while LIVE, loading, failed or unavailable',()=>{
    for(const query of [{isLoading:true},{isError:true,data:context()},
      {data:{...context(),mode:'UNAVAILABLE'}},{data:context()}]){
      state.query=query;render();expect(host.textContent).not.toContain('Legacy TEST');
    }
    state.query={data:{...context(),mode:'TEST'}};render();expect(host.textContent).toContain('Legacy TEST');
  });
  it('does not reuse another school or signed-in account context',()=>{
    state.query.data={...context(),schoolId:11};render();expect(host.textContent).toContain('Loading');
    state.query.data={...context(),actorId:99};render();expect(host.textContent).toContain('Loading');
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('preserves the Owner read-only legacy view without LIVE payment controls',()=>{
    state.owner=true;render();expect(host.textContent).toContain('Legacy TEST');
    expect(host.textContent).not.toContain('Start LIVE');
  });
  it('uses numeric server identity and one stable attempt; refreshes instead of trusting POST as paid',async()=>{
    state.checkout.mockResolvedValue({reference:'SCV3_live_untrustedPOST',checkoutUrl:'https://attacker.invalid'});
    render();
    const button=buttons().find(b=>b.textContent==='Start LIVE checkout')!;
    await act(async()=>{button.click();button.click();});
    expect(state.checkout).toHaveBeenCalledTimes(1);
    expect(state.checkout.mock.calls[0][0]).toMatchObject({schoolId:10,studentId:20,termId:7});
    expect(state.checkout.mock.calls[0][0]).not.toHaveProperty('subscriptionId');
    expect(state.checkout.mock.calls[0][0].idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('VERIFIED');
    expect(host.querySelector('a')).toBeNull();
  });
  it('does not resend after an unknown outcome or component reload',async()=>{
    state.checkout.mockRejectedValue(new Error('lost response'));render();
    await act(async()=>buttons().find(b=>b.textContent==='Start LIVE checkout')!.click());
    act(()=>root.unmount());root=createRoot(host);render();
    expect(buttons().find(b=>b.textContent==='Start LIVE checkout')!.disabled).toBe(true);
    expect(state.checkout).toHaveBeenCalledTimes(1);
  });
  it('recovers only server-scoped READY links and never offers another checkout for holds or unknown outcomes',()=>{
    for(const status of ['HELD','RECONCILIATION_REQUIRED','VERIFIED']){
      state.query.data={...context(),students:[{...context().students[0],status,checkoutAllowed:false,
        reference:'SCV3_live_retained',checkoutUrl:'https://checkout.flutterwave.com/v3/hosted/pay/allowed'}]};
      render();expect(host.querySelector('a')).toBeNull();
      expect(host.textContent).not.toContain('Start LIVE');
    }
    state.query.data.students[0].status='READY';render();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://checkout.flutterwave.com/v3/hosted/pay/allowed');
    state.query.data.students[0].checkoutUrl='https://attacker.invalid';render();
    expect(host.querySelector('a')).toBeNull();
  });
});
