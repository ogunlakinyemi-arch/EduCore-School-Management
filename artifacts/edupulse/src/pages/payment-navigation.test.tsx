// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({
  owner:true,status:'ACTIVE',global:true,roleStatus:'ACTIVE',mutate:vi.fn(),
}));
vi.mock('@workspace/api-client-react',async original=>{
  const actual=await original<typeof import('@workspace/api-client-react')>();
  const query=(data:unknown)=>({data,isLoading:false,isError:false,isFetching:false,dataUpdatedAt:0,refetch:vi.fn()});
  const profile={status:'VERIFIED',bankName:'Fictional fixture bank',accountLast4:'0000'};
  return {
    ...actual,
    useGetAuthorizedContext:()=>query({
      isPlatformOwner:fixture.owner,user:{id:9,status:fixture.status},
      roles:fixture.owner?[{role:'PLATFORM_OWNER',schoolId:fixture.global?null:7,status:fixture.roleStatus}]
        :[{role:'SCHOOL_ADMIN',schoolId:7,status:'ACTIVE'}],
    }),
    useGetPlatformPaymentSettlement:()=>query(profile),
    useGetSchoolPaymentSettlement:()=>query(profile),
    useListPlatformSettlementHistory:()=>query([]),
    useListSchoolSettlementHistory:()=>query([]),
    useUpdatePlatformPaymentSettlement:()=>({mutateAsync:fixture.mutate,isPending:false}),
    useUpdateSchoolPaymentSettlement:()=>({mutateAsync:fixture.mutate,isPending:false}),
  };
});
vi.mock('@/components/shared',async original=>({
  ...(await original<object>()),useTenant:()=>({schoolId:7}),TenantPicker:()=>null,
}));
vi.mock('@/components/nfc-fee-collection-oversight',()=>({
  NfcFeeCollectionOversight:()=> <section data-testid="oversight-read-only">Read-only fee collection filters</section>,
}));
import {PaymentSettlementPage} from './payment-settlement';
import {FinanceWorkspacePage} from './finance-workspace';

let root:ReturnType<typeof createRoot>,host:HTMLDivElement,client:QueryClient;
async function mount(url:string){
  window.history.replaceState({},'',url);
  await act(async()=>root.render(<QueryClientProvider client={client}><PaymentSettlementPage/></QueryClientProvider>));
}
async function tab(id:string){
  await act(async()=>host.querySelector<HTMLButtonElement>(`[data-testid="tab-${id}"]`)!.click());
}
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  fixture.owner=true;fixture.status='ACTIVE';fixture.global=true;fixture.roleStatus='ACTIVE';fixture.mutate.mockClear();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
});
afterEach(async()=>{
  await act(async()=>root.unmount());client.clear();host.remove();window.history.replaceState({},'','/');
});
describe('Owner payment navigation and existing query tabs',()=>{
  it('opens the existing schools tab directly without triggering payment or record mutations',async()=>{
    await mount('/payment-settlement?tab=schools');
    expect(host.querySelector('[data-testid="oversight-read-only"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="tab-schools"]')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[data-testid="button-edit-company-settlement"]')).toBeNull();
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it('supports in-place links, tab changes and query history while keeping other query fields',async()=>{
    await mount('/payment-settlement');
    expect(host.querySelector('[data-testid="tab-company"]')?.getAttribute('aria-selected')).toBe('true');
    await act(async()=>window.history.pushState({},'','/payment-settlement?tab=schools&source=fixture'));
    expect(host.querySelector('[data-testid="oversight-read-only"]')).not.toBeNull();
    await tab('history');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('history');
    expect(new URLSearchParams(window.location.search).get('source')).toBe('fixture');
    expect(host.querySelector('[data-testid="oversight-read-only"]')).toBeNull();
    await tab('company');
    expect(new URLSearchParams(window.location.search).get('tab')).toBeNull();
    await act(async()=>window.history.replaceState({},'','/payment-settlement?tab=invalid'));
    expect(host.querySelector('[data-testid="tab-company"]')?.getAttribute('aria-selected')).toBe('true');
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
  it('does not open the Owner oversight for a School Admin using its query link',async()=>{
    fixture.owner=false;
    await mount('/payment-settlement?tab=schools');
    expect(host.querySelector('[data-testid="oversight-read-only"]')).toBeNull();
    expect(host.querySelector('[data-testid="tab-schools"]')).toBeNull();
    expect(host.querySelector('[data-testid="tab-profile"]')).not.toBeNull();
  });
  it('distinguishes new Owner rules from retained staff billing and keeps both existing destinations',()=>{
    const html=renderToStaticMarkup(<FinanceWorkspacePage/>);
    expect(html).toContain('href="/subscription-payment-rules"');
    expect(html).toContain('href="/payment-settlement?tab=schools"');
    expect(html).toContain('href="/billing-rules"');
    expect(html).toContain('Staff NFC billing rules');
    expect(html).toContain('Subscription &amp; Payment Rules');
    for(const override of [{status:'INACTIVE'},{global:false},{roleStatus:'INACTIVE'},{owner:false}]){
      fixture.status='ACTIVE';fixture.global=true;fixture.roleStatus='ACTIVE';fixture.owner=true;
      Object.assign(fixture,override);
      const denied=renderToStaticMarkup(<FinanceWorkspacePage/>);
      expect(denied).not.toContain('href="/subscription-payment-rules"');
      expect(denied).not.toContain('href="/payment-settlement?tab=schools"');
    }
  });
});
