import {describe,it,expect,vi,beforeEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {SubscriptionAccessStatus} from '@workspace/api-client-react';
const state=vi.hoisted(()=>({data:[] as SubscriptionAccessStatus[],isError:false}));
vi.mock('@workspace/api-client-react',()=>({
  getGetMySubscriptionEnforcementQueryKey:()=>['subscription-enforcement','me'],
  useGetMySubscriptionEnforcement:()=>({...state,refetch:vi.fn()}),
}));
vi.mock('@/components/shared',()=>({date:(value:string)=>value}));
import {LiveSubscriptionAccessStatus} from './live-subscription-access-status';
import {SubscriptionAccessBanner} from './subscription-access-banner';

const row=(status:SubscriptionAccessStatus['liveStatus']='PENDING'):SubscriptionAccessStatus=>({
  schoolId:10,studentId:1,schoolName:'Original School',studentName:'Fixture Child',
  termName:'First Term',startDate:'2026-10-01',enforcementDate:'2026-10-08',
  state:'SUBSCRIPTION_RESTRICTED',restricted:status!=='VERIFIED_ACTIVE',restrictionReason:null,
  environment:'LIVE',audiences:['student','parent'],liveStatus:status,entitled:status==='VERIFIED_ACTIVE',receiptNumber:null,
});
const render=(items:SubscriptionAccessStatus[],audience:'student'|'parent'='parent')=>
  renderToStaticMarkup(<LiveSubscriptionAccessStatus items={items} audience={audience}/>);
beforeEach(()=>{state.data=[];state.isError=false;});
describe('LIVE family subscription UI contract',()=>{
  it.each(['student','parent'] as const)('renders all explicit states for %s',audience=>{
    for(const [status,label] of [['PENDING','Verification pending'],['VERIFIED_ACTIVE','Verified subscription'],
      ['FAILED','Payment failure reported'],['REFUNDED_REVERSED','Refund or reversal review'],['UNAVAILABLE','LIVE status unavailable']] as const){
      const html=render([row(status)],audience);expect(html).toContain(label);
      expect(html).toContain('LIVE checkout is disabled');
      expect(html).not.toMatch(/Pay now|fully active|href=.*payment/);
    }
  });
  it('does not infer verified access from contradictory state or a retained receipt',()=>{
    const html=render([{...row('VERIFIED_ACTIVE'),entitled:false,receiptNumber:'LIVE-STUDENT-fixture'}]);
    expect(html).toContain('LIVE status unavailable');expect(html).not.toContain('Verified subscription');
    expect(html).toContain('A receipt alone does not grant access');
  });
  it('keeps manual school locks visible on an authoritative verified subscription',()=>{
    const html=render([{...row('VERIFIED_ACTIVE'),restricted:true,restrictionReason:'SCHOOL_SUBSCRIPTION_LOCKED'}]);
    expect(html).toContain('Verified subscription');expect(html).toContain('School locked');
  });
  it('never claims settled refund or recovered money',()=>{
    const html=render([{...row('REFUNDED_REVERSED'),receiptNumber:'LIVE-STUDENT-original'}]);
    expect(html).toContain('does not confirm that a refund settled');expect(html).toContain('LIVE-STUDENT-original');
  });
  it('does not render TEST records or children outside the server-authorized audience',()=>{
    expect(render([{...row(),environment:undefined}])).toBe('');
    expect(render([{...row(),audiences:['student']}],'parent')).toBe('');
  });
  it('wires LIVE into the existing banner and updates on refreshed response without TEST fallback',()=>{
    state.data=[row(),{...row('VERIFIED_ACTIVE'),environment:undefined,studentId:2}];
    expect(renderToStaticMarkup(<SubscriptionAccessBanner audience="parent"/>)).toContain('Verification pending');
    state.data=[row('VERIFIED_ACTIVE')];
    expect(renderToStaticMarkup(<SubscriptionAccessBanner audience="parent"/>)).toContain('Verified subscription');
    state.data=[row('REFUNDED_REVERSED')];
    const html=renderToStaticMarkup(<SubscriptionAccessBanner audience="parent"/>);
    expect(html).toContain('Refund or reversal review');expect(html).not.toContain('fully active');
    state.isError=true;
    const unavailable=renderToStaticMarkup(<SubscriptionAccessBanner audience="parent"/>);
    expect(unavailable).toContain('Subscription status is unavailable');expect(unavailable).not.toContain('Refund or reversal review');
  });
});
