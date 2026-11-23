// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
const f = vi.hoisted(() => ({ result: {} as Record<string, unknown>, mutateAsync:vi.fn() }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: 'user-a' } }) }));
vi.mock('@tanstack/react-query', async o => ({ ...await o<typeof import('@tanstack/react-query')>(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', async o => ({
  ...await o<typeof import('@workspace/api-client-react')>(),
  useGetCurrentFinanceOverview: () => f.result,
  useActOnCurrentFinance: () => ({ mutateAsync: f.mutateAsync, isPending: false }),
  useGetFieldSmsCampaigns: () => f.result,
  usePreviewFieldSmsCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordFieldSmsPermission: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDispatchFieldSmsCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
import { ConnectedFinancePanel } from './current-finance-panel';
import { FieldSmsCampaigns, campaignRetryable } from './field-sms-campaigns';
import { toMinor } from '@/lib/current-finance';

const overview = { owner: false, bro: true, schools: [], terms: [], blockers: ['Payout transport paused'],
  summary: { studentCount: 10, earnedMinor: 150000, pendingMinor: 0, approvedMinor: 15000, availableMinor: 135000, paidMinor: 0 },
  entitlements: [{ key: 'D:1', studentId: 1, studentName: 'Amaka Obi', schoolId: 2, schoolName: 'Lekki Hills', termId: 3, termName: 'First Term', amountMinor: 15000, state: 'ACCRUED', requestId: null, available: true }],
  requests: [], payments: [], refunds: [], payouts: [], batches: [], eligibleStudents: [] };

describe('connected finance', () => {
  it('converts NGN to integer minor units', () => {
    expect(toMinor('1,500')).toBe(150000); expect(toMinor('12.5')).toBe(1250);
    expect(toMinor('0')).toBeNull(); expect(toMinor('-3')).toBeNull(); expect(toMinor('1.234')).toBeNull();
  });
  it('shows an unavailable state, never zero balances, when the ledger is missing', () => {
    f.result = { isLoading: false, isError: true, error: { status: 404 }, refetch: vi.fn() };
    const html = renderToStaticMarkup(<ConnectedFinancePanel mode="bro" />);
    expect(html).toContain('not zero'); expect(html).not.toContain('₦0.00');
  });
  it('separates accrued earnings from bank-verified money and shows gates', () => {
    f.result = { isLoading: false, isError: false, data: overview, refetch: vi.fn() };
    const html = renderToStaticMarkup(<ConnectedFinancePanel mode="bro" />);
    expect(html).toContain('₦1,500.00'); expect(html).toContain('Approval is not a bank credit');
    expect(html).toContain('Bank-verified paid'); expect(html).toContain('Payout transport paused');
    expect(html).not.toContain('Initiate payout');
  });
  it('bulk receipts/recovery follow backend phases; school users cannot create refunds; BRO selects REQUESTED unrequested', () => {
    f.result = { isLoading: false, isError: false, refetch: vi.fn(), data: { ...overview, bro: false,
      payments: [{ id: 5, source: 'BULK', studentName: 'Tolu', studentId: 1, schoolId: 2, termId: 3, reference: 'R1', state: 'VERIFIED', amountMinor: 320000, refundedMinor: 0, netPaidMinor: 320000 }],
      batches: [{ id: 9, reference: 'B9', state: 'RECOVERY_REQUIRED', amountMinor: 640000, checkoutUrl: null, items: [
        { id: 1, studentId: 1, studentName: 'Tolu', state: 'POSTED', error: null }, { id: 2, studentId: 2, studentName: 'Ada', state: 'UNRESOLVED', error: null }] }] } };
    const html = renderToStaticMarkup(<ConnectedFinancePanel mode="school" schoolId={2} />);
    expect(html).toContain('button-recover-batch-9'); expect(html).toContain('button-receipt-9-1'); expect(html).not.toContain('button-receipt-9-2');
    expect(html).not.toContain('button-refund-BULK-5'); expect(html).toContain('refund-owner-review');
    f.result = { isLoading: false, isError: false, refetch: vi.fn(), data: { ...overview, entitlements: [
      { ...overview.entitlements[0], key: 'B:2', state: 'REQUESTED', requestId: null, available: false },
      { ...overview.entitlements[0], key: 'B:3', state: 'REQUESTED', requestId: 7, available: false }] } };
    const bro = renderToStaticMarkup(<ConnectedFinancePanel mode="bro" />);
    expect(bro).toMatch(/data-testid="check-entitlement-B:2"(?![^>]*disabled)/); expect(bro).toMatch(/disabled=""[^>]*data-testid="check-entitlement-B:3"/);
  });
  it('field SMS requires permission and blocks uncertain retries', () => {
    f.result = { isLoading: false, isError: false, refetch: vi.fn(), data: { blockedReason: 'SMS provider not configured',
      leads: [{ id: 1, schoolName: 'Ikeja Grammar', contactPhone: '0803', allowed: false, eligible: true, reason: null }], campaigns: [] } };
    const html = renderToStaticMarkup(<FieldSmsCampaigns />);
    expect(html).toContain('SMS provider not configured'); expect(html).not.toMatch(/whatsapp/i);
    const base = { id: 1, message: 'x', digest: 'd', createdAt: '', createdBy: 1 };
    expect(campaignRetryable({ ...base, recipients: [{ leadId: 1, schoolName: 'a', phone: '1', state: 'FAILED' }, { leadId: 2, schoolName: 'b', phone: '2', state: 'UNKNOWN' }] })).toBe(false);
    expect(campaignRetryable({ ...base, recipients: [{ leadId: 1, schoolName: 'a', phone: '1', state: 'FAILED',retryable:true }, { leadId: 2, schoolName: 'b', phone: '2', state: 'DELIVERED' }] })).toBe(true);
  });
  it('initiates a replacement with a fresh key only after independently reconciled failure restores server availability',async()=>{
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
    sessionStorage.clear();f.mutateAsync.mockReset();
    f.mutateAsync.mockRejectedValueOnce({status:503});
    const owner={...overview,owner:true,bro:false,blockers:[],
      entitlements:[{...overview.entitlements[0],state:'APPROVED',requestId:5,available:true}]};
    f.result={isLoading:false,isError:false,data:owner,refetch:vi.fn()};
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    const render=async()=>{await act(async()=>root.render(<ConnectedFinancePanel mode="owner"/>));};
    const click=async(id:string)=>{
      const button=host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      expect(button).not.toBeNull();expect(button!.disabled).toBe(false);
      await act(async()=>button!.click());
    };
    try{
      await render();
      const reason=host.querySelector<HTMLInputElement>('[data-testid="input-payout-reason"]')!;
      await act(async()=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(reason,'Owner reviewed bank outcome');
        reason.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await click('button-initiate-payout-D:1');
      const first=f.mutateAsync.mock.calls[0][0].data;
      expect(first.action).toBe('PAYOUT_INITIATE');expect(first.payload.key).toEqual(expect.any(String));
      expect(sessionStorage.getItem('educore:current-finance:user-a:payout:D:1')).toBe(first.payload.key);
      const pending={id:41,entitlementKey:'D:1',state:'PENDING',amountMinor:15000,reference:'YETENIA_CURRENT_41',maskedAccountNumber:'****0001'};
      f.result={...f.result,data:{...owner,entitlements:[{...owner.entitlements[0],available:false}],payouts:[pending]}};
      await render();expect(host.querySelector('[data-testid="button-initiate-payout-D:1"]')).toBeNull();
      f.mutateAsync.mockResolvedValueOnce({id:41,state:'FAILED'});
      await click('button-reconcile-payout-41');
      expect(f.mutateAsync.mock.calls[1][0].data.action).toBe('PAYOUT_RECONCILE');
      // Refetched server projection, not the client or a request-body assertion,
      // restores availability only after the independently verified failure.
      f.result={...f.result,data:{...owner,payouts:[{...pending,state:'FAILED'}]}};
      await render();
      f.mutateAsync.mockResolvedValueOnce({id:42,state:'PENDING'});
      await click('button-initiate-payout-D:1');
      const replacement=f.mutateAsync.mock.calls[2][0].data;
      expect(replacement.action).toBe('PAYOUT_INITIATE');
      expect(replacement.payload.entitlementKey).toBe('D:1');
      expect(replacement.payload.key).toEqual(expect.any(String));
      expect(replacement.payload.key).not.toBe(first.payload.key);
      expect(host.textContent).toContain('YETENIA_CURRENT_41');
      expect(host.textContent).toContain('FAILED');
    }finally{
      await act(async()=>root.unmount());host.remove();sessionStorage.clear();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
  it.each(['PENDING','PROCESSING','UNKNOWN','PAID','REVERSED','HELD','RECOVERY_REQUIRED'])(
    'does not offer another initiation while a %s payout exists, even if availability is stale',state=>{
      f.result={isLoading:false,isError:false,refetch:vi.fn(),data:{...overview,owner:true,bro:false,
        payouts:[{id:41,entitlementKey:'D:1',state,amountMinor:15000,reference:'retained',maskedAccountNumber:'****0001'}]}};
      expect(renderToStaticMarkup(<ConnectedFinancePanel mode="owner"/>)).not.toContain('button-initiate-payout-D:1');
    });
  it('blocks replacement for mixed failed and pending attempts or a server-held entitlement',()=>{
    const payout={id:41,entitlementKey:'D:1',state:'FAILED',amountMinor:15000,reference:'retained',maskedAccountNumber:'****0001'};
    f.result={isLoading:false,isError:false,refetch:vi.fn(),data:{...overview,owner:true,bro:false,
      payouts:[payout,{...payout,id:42,state:'PENDING'}]}};
    expect(renderToStaticMarkup(<ConnectedFinancePanel mode="owner"/>)).not.toContain('button-initiate-payout-D:1');
    f.result={...f.result,data:{...overview,owner:true,bro:false,payouts:[payout],
      entitlements:[{...overview.entitlements[0],available:false,state:'HELD'}]}};
    expect(renderToStaticMarkup(<ConnectedFinancePanel mode="owner"/>)).not.toContain('button-initiate-payout-D:1');
  });
});
