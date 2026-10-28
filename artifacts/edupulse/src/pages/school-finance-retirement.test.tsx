// @vitest-environment jsdom
import {renderToStaticMarkup} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import appSource from '../App.tsx?raw';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({owner:false,role:'SCHOOL_ADMIN',status:'ACTIVE',schoolId:7,search:'',companyStatus:'VERIFIED',
  schoolRead:vi.fn(),schoolUpdate:vi.fn(),schoolHistory:vi.fn(),companyRead:vi.fn(),companyUpdate:vi.fn(),history:vi.fn()}));
vi.mock('wouter',async original=>({...await original<typeof import('wouter')>(),
  useSearch:()=>s.search,useLocation:()=>['/payment-settlement',vi.fn()],
}));
vi.mock('@workspace/api-client-react',async original=>{
  const actual=await original<typeof import('@workspace/api-client-react')>();
  const q=(data:unknown)=>({data,isLoading:false,isError:false,isFetching:false,dataUpdatedAt:0,refetch:vi.fn()});
  return {...actual,
    useGetAuthorizedContext:()=>q({isPlatformOwner:s.owner,user:{status:'ACTIVE'},roles:[{
      schoolId:s.owner?null:s.schoolId,role:s.owner?'PLATFORM_OWNER':s.role,status:s.status,
    }]}),
    useGetSchoolPaymentSettlement:s.schoolRead,useUpdateSchoolPaymentSettlement:s.schoolUpdate,
    useListSchoolSettlementHistory:s.schoolHistory,
    useGetPlatformPaymentSettlement:()=>{s.companyRead();return q({
      status:s.companyStatus,businessName:'FICTIONAL OWNER COMPANY',bankName:'FICTIONAL OWNER BANK',
      accountName:'FICTIONAL OWNER RECIPIENT',accountLast4:'0001',capability:{mode:'MOCK'},
    });},
    useUpdatePlatformPaymentSettlement:()=>({isPending:false,mutateAsync:s.companyUpdate}),
    useVerifyOwnerReceivingAccount:()=>({isPending:false,mutateAsync:vi.fn()}),
    useListPlatformSettlementHistory:(...args:unknown[])=>{s.history(...args);return q([]);},
  };
});
vi.mock('@/components/shared',async original=>({
  ...await original<typeof import('@/components/shared')>(),useTenant:()=>({schoolId:7}),
}));
import {PaymentSettlementPage} from './payment-settlement';
import {FinanceWorkspacePage} from './finance-workspace';
const render=(node:React.ReactNode)=>renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
beforeEach(()=>{
  Object.assign(s,{owner:false,role:'SCHOOL_ADMIN',status:'ACTIVE',schoolId:7,search:'',companyStatus:'VERIFIED'});
  for(const spy of [s.schoolRead,s.schoolUpdate,s.schoolHistory,s.companyRead,s.companyUpdate,s.history])spy.mockClear();
});
describe('retired School Admin settlement workflow',()=>{
  it('offers explicit beneficiary verification without changing status on render or refresh',()=>{
    s.owner=true;s.companyStatus='PENDING_VERIFICATION';
    const html=render(<PaymentSettlementPage/>);
    expect(html).toContain('company-verification-guidance');
    expect(html).toContain('Verify account details');
    expect(html).toContain('Saving or refreshing will not verify this account');
    expect(html).toContain('Sandbox and Development results cannot verify the account');
    expect(html).toContain('solely for optional school subscription bank-transfer assistance');
    expect(html).toContain('₦3,200 per student per academic term');
    expect(html).toContain('Schools cannot view unverified details');
    expect(html).not.toContain('banner-provider-mode');
    expect(html).toContain('Beneficiary resolution does not prove money movement');
    expect(html).not.toContain('Live settlement verified: no');
    expect(html).not.toContain('saved for provider verification');
    expect(html).not.toMatch(/<button[^>]*>[^<]*(Verify|Approve) company/i);
    expect(s.companyStatus).toBe('PENDING_VERIFICATION');
    expect(s.companyUpdate).not.toHaveBeenCalled();
  });
  it('does not label a previously verified account as pending or infer settlement from its verification',()=>{
    s.owner=true;
    const html=render(<PaymentSettlementPage/>);
    expect(html).not.toContain('company-verification-guidance');
    expect(html).toContain('Flutterwave merchant settlement configuration and evidence are handled separately in Flutterwave');
    expect(html).toContain('does not establish Flutterwave LIVE readiness');
    expect(html).toContain('Cash and company-account transfers never activate NFC or pay a subscription');
    expect(html).toContain('A separate authorized Flutterwave checkout must succeed');
    expect(html).not.toContain('banner-provider-mode');
    expect(s.companyUpdate).not.toHaveBeenCalled();
  });
  it('removes the School Finance settlement card without removing school fees, payroll or transport',()=>{
    const html=render(<FinanceWorkspacePage/>);
    expect(html).not.toContain('href="/payment-settlement');
    expect(html).not.toContain('settlement profile');
    for(const href of ['/finance','/payroll','/transport','/staff-nfc-finance'])expect(html).toContain(`href="${href}"`);
  });
  it.each(['SCHOOL_ADMIN','ACCOUNTANT','TEACHER','PARENT','STAFF'])(
    'does not mount any account requests or controls for %s even on direct page access',role=>{
      s.role=role;
      const html=render(<PaymentSettlementPage/>);
      expect(html).toContain('Owner-only settings');
      expect(html).not.toContain('FICTIONAL OWNER BANK');
      expect(html).not.toContain('button-edit-settlement');
      expect(html).not.toContain('form-settlement');
      for(const spy of [s.schoolRead,s.schoolUpdate,s.schoolHistory,s.companyRead,s.companyUpdate,s.history])
        expect(spy).not.toHaveBeenCalled();
    });
  it.each([{status:'INACTIVE',schoolId:7},{status:'ACTIVE',schoolId:8}])(
    'does not offer finance account controls for inactive or foreign memberships %j',membership=>{
      Object.assign(s,membership);
      const html=render(<FinanceWorkspacePage/>);
      expect(html).not.toContain('href="/payment-settlement');
      expect(html).not.toContain('href="/finance"');
    });
  it('keeps Accountant fee finance without the retired account configuration card',()=>{
    s.role='ACCOUNTANT';const html=render(<FinanceWorkspacePage/>);
    expect(html).toContain('href="/finance"');expect(html).not.toContain('href="/payment-settlement');
  });
  it('preserves Owner receiving-account configuration and read-only collection oversight entry points',()=>{
    s.owner=true;
    const finance=render(<FinanceWorkspacePage/>),account=render(<PaymentSettlementPage/>);
    expect(finance).toContain('href="/payment-settlement"');
    expect(finance).toContain('href="/payment-settlement?tab=schools"');
    expect(account).toContain('FICTIONAL OWNER BANK');
    expect(account).toContain('button-edit-company-settlement');
    expect(account).not.toContain('button-edit-settlement');
    expect(s.schoolRead).not.toHaveBeenCalled();expect(s.schoolUpdate).not.toHaveBeenCalled();
  });
  it('retains Owner historical settlement access without exposing school account editors',()=>{
    s.owner=true;s.search='tab=history';
    const html=render(<PaymentSettlementPage/>);
    expect(html).toContain('All settlement history');
    expect(s.history.mock.calls[0][1].query.enabled).toBe(true);
    expect(html).not.toContain('button-edit-settlement');
    expect(s.schoolUpdate).not.toHaveBeenCalled();
  });
  it('locks the actual application URL to the Owner-only role guard',()=>{
    expect(appSource).toContain('<Route path="/payment-settlement"><RoleGuard isPlatformOwnerOnly>');
    expect(appSource).not.toContain('<Route path="/payment-settlement"><RoleGuard allowedRoles=');
  });
});
