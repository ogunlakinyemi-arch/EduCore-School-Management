// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const st = vi.hoisted(() => ({
  current: vi.fn(), legacy: vi.fn(), run: vi.fn(), refresh: vi.fn(),
  verify: vi.fn(), data: null as any,
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { user: { id: 77 } } }),
  useGetOwnerSubscriptionPaymentRules: st.legacy,
  getGetOwnerSubscriptionPaymentRulesQueryKey: () => ['legacy'],
  recordOwnerSubscriptionBankVerification: st.verify,
}));
vi.mock('@/lib/current-finance', () => ({
  useCurrentFinance: st.current,
  useFinanceAction: () => ({ run: st.run, busy: null }),
  isOverview: (v: any) => !!v?.schools && !!v?.batches,
  naira: (v: number) => `NGN ${v / 100}`,
}));
vi.mock('@/components/shared', () => ({
  PageHeading: ({ title, description }: any) => <header>{title} {description}</header>,
  Button: ({ children, variant: _, ...p }: any) => <button {...p}>{children}</button>,
  ErrorState: ({ retry }: any) => <button onClick={retry}>Could not load. Retry</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));
vi.mock('@/components/bank-remittance-batch', () => ({
  BankRemittanceBatch: ({ b, assistanceOnly }: any) => <article data-bank-request={b.id} data-assistance-only={assistanceOnly}>{b.reference}</article>,
}));
vi.mock('./subscription-payment-rules', () => ({
  VerifyDialog: ({ a, onVerify }: any) => <button onClick={() => onVerify(a.id, { bankName: 'Fictional test bank' })}>Confirm existing receipt</button>,
}));
import { OwnerPaymentAssistancePage } from './owner-payment-assistance';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  st.data = { owner: true, schools: [{ id: 4, name: 'Fixture School' }], batches: [
    { id: 1, method: 'COMPANY_BANK', reference: 'School request' },
    { id: 2, method: 'FLUTTERWAVE', reference: 'Ordinary checkout' },
  ] };
  st.current.mockReturnValue({ data: st.data, refetch: st.refresh });
  st.legacy.mockReturnValue({ data: { assistance: [{ id: 9, schoolId: 4, studentId: 5, termId: 6,
    amountMinor: 320000, status: 'REQUESTED', requestNote: 'Existing request' }] }, refetch: st.refresh });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<OwnerPaymentAssistancePage />));
describe('Owner payment assistance', () => {
  it('shows submitted bank requests, not ordinary checkouts or finance configuration', async () => {
    await render();
    expect(host.querySelectorAll('[data-bank-request]')).toHaveLength(1);
    expect(host.querySelector('[data-bank-request]')?.getAttribute('data-assistance-only')).toBe('true');
    expect(host.textContent).not.toContain('Ordinary checkout');
    expect(host.textContent).toContain('Ordinary online payments do not need Owner approval');
    expect(host.textContent).not.toMatch(/New rule|Create checkout|Approve release|BRO accrual/);
    expect(st.run).not.toHaveBeenCalled(); expect(st.verify).not.toHaveBeenCalled();
  });
  it('opens existing bank-receipt review only after an explicit Owner action', async () => {
    await render();
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Record bank receipt')!;
    await act(async () => button.click());
    expect(st.verify).not.toHaveBeenCalled();
    const confirm = [...host.querySelectorAll('button')].find(b => b.textContent === 'Confirm existing receipt')!;
    await act(async () => confirm.click());
    expect(st.verify).toHaveBeenCalledWith(9, { bankName: 'Fictional test bank' });
  });
  it('reports failed reads rather than claiming no requests', async () => {
    st.current.mockReturnValue({ isError: true, refetch: st.refresh });
    st.legacy.mockReturnValue({ isError: true, refetch: st.refresh });
    await render();
    expect(host.textContent).toContain('Could not load');
    expect(host.textContent).not.toContain('No school remittance requests');
    expect(st.run).not.toHaveBeenCalled();
  });
});
