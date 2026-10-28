// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bank = { id: 1, payoutMethod: 'BANK_TRANSFER', bankName: 'Fictional Alpha Bank', accountName: 'Ada Obi', maskedAccountNumber: '****6789', verified: true, updatedAt: '2025-01-01' };
const candidate = (o: any = {}) => ({ partnerId: 3, fullName: 'Ada Obi', partnerCode: 'BRO-003', email: 'ada@unit.test', accruedCommission: 500, paidCommission: 200,
  outstandingCommission: 300, payableCommission: 100.1, reservedCommission: 50, pendingApprovalCommission: 25, bankDetails: bank, ...o });
const state = vi.hoisted(() => ({
  actorId: 1, create: vi.fn(), update: vi.fn(), toast: vi.fn(), reveal: vi.fn(), error: false, refetch: vi.fn(),
  candidates: [] as any[], candError: false, candFetching: false, payouts: [] as any[], updatePending: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { user: { id: state.actorId } } }),
  useListPlatformPartnerPayouts: () => ({ data: state.payouts, isLoading: false, isError: state.error, refetch: state.refetch }),
  getListPlatformPartnerPayoutsQueryKey: () => ['/api/platform/partner-payouts'],
  useListPartnerPayoutCandidates: () => ({ data: state.candError ? undefined : state.candidates, isLoading: false, isError: state.candError, isFetching: state.candFetching, refetch: vi.fn() }),
  getListPartnerPayoutCandidatesQueryKey: () => ['/api/platform/partner-payout-candidates'],
  getGetPartnerDashboardQueryKey: () => ['/api/partner/dashboard'],
  getPartnerPayoutBankDetails: state.reveal,
  useCreatePartnerPayout: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdatePartnerPayout: () => ({ mutate: state.update, isPending: state.updatePending }),
}));
vi.mock('@/components/shared', () => ({
  PageHeading: () => null,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Button: ({ children, testId, variant, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  StatusPill: () => null,
  Modal: ({ children, onClose }: any) => <div data-testid="modal">{children}<button data-testid="modal-close" onClick={onClose}>x</button></div>,
  cx: (...v: any[]) => v.filter(Boolean).join(' '),
  date: (v: string) => v,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: ({ message, retry }: any) => <div>{message}<button onClick={retry}>Retry feed</button></div>,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/pages/partner/nfc-owner-control', () => ({ PartnerNfcOwnerControl: () => null }));
import { PayoutsOverview } from './management';
import { readPayoutDraft, savePayoutDraft } from '@/lib/partner-payout-retry';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let element: HTMLDivElement; let root: Root; let client: QueryClient;
const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><PayoutsOverview /></QueryClientProvider>)); };
const q = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const createBtn = () => q('button-create-payout') as HTMLButtonElement;
const click = async (el: HTMLElement | null) => { await act(async () => el!.click()); };
const typeInto = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const choose = async (text = 'ada', id = 3) => {
  const combo = q('input-payout-candidate') as HTMLInputElement;
  await act(async () => { combo.focus(); });
  await typeInto(combo, text);
  await act(async () => { q(`option-payout-candidate-${id}`)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
};

beforeEach(async () => {
  sessionStorage.clear(); vi.clearAllMocks();
  Object.assign(state, { actorId: 1, error: false, candError: false, candFetching: false, payouts: [], updatePending: false, candidates: [candidate(), candidate({ partnerId: 4, fullName: 'Bisi Lawal', partnerCode: 'BRO-004', email: 'bisi@unit.test', bankDetails: null })] });
  state.create.mockRejectedValue(new Error('Lost response'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); element.remove(); vi.unstubAllGlobals(); });

describe('BRO payout creation', () => {
  it('shows a contextual read error and safely retries the payout feed without a payout mutation', async () => {
    state.error = true; await render();
    expect(element.textContent).toContain('BRO payout history could not be loaded');
    await act(async () => element.querySelector('button')!.click());
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it('searches candidates and shows identity, balances and exact read-only payable amount', async () => {
    await choose('bro-003');
    expect(element.textContent).toContain('ada@unit.test');
    expect(q('text-candidate-balances')!.textContent).toContain('NGN 500.00');
    expect(q('text-candidate-balances')!.textContent).toContain('NGN 25.00');
    const amount = q('text-payable-amount') as HTMLInputElement;
    expect(amount.value).toBe('100.10'); expect(amount.readOnly).toBe(true);
  });
  it('sends the exact payable amount in NGN with a stable key and restores it after remount', async () => {
    await choose(); await click(createBtn());
    const first = state.create.mock.calls[0][0].data;
    expect(first).toMatchObject({ partnerId: 3, amount: '100.10', currency: 'NGN' });
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(readPayoutDraft(sessionStorage, 1)).toEqual(first);
    await act(async () => root.unmount()); root = createRoot(element); await render();
    expect((q('text-payable-amount') as HTMLInputElement).value).toBe('100.10');
    await click(createBtn());
    expect(state.create.mock.calls[1][0].data).toEqual(first);
  });
  it('disables creation without a verified bank, without payable, or on stale/error candidates', async () => {
    await choose('bisi', 4); expect(createBtn().disabled).toBe(true);
    expect(q('text-payout-block')!.textContent).toContain('no verified bank');
    state.candidates = [candidate({ payableCommission: 0 })]; await render(); await choose();
    expect(createBtn().disabled).toBe(true);
    state.candidates = [candidate()]; state.candFetching = true; await render(); await choose();
    expect(createBtn().disabled).toBe(true);
    state.candFetching = false; state.candError = true; await render();
    expect(createBtn().disabled).toBe(true);
    await click(createBtn()); expect(state.create).not.toHaveBeenCalled();
  });
  it('clears the completed request and invalidates candidates, payouts and dashboard', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    state.create.mockResolvedValue({ id: 1 });
    await choose(); await click(createBtn());
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    for (const k of [['/api/platform/partner-payouts'], ['/api/platform/partner-payout-candidates'], ['/api/partner/dashboard']]) expect(invalidate).toHaveBeenCalledWith({ queryKey: k });
  });
  it('does not share another Owner pending request', async () => {
    savePayoutDraft(sessionStorage, 2, { idempotencyKey: 'other-owner-request', partnerId: 4, amount: '200', currency: 'NGN' });
    await choose(); await click(createBtn());
    expect(state.create.mock.calls[0][0].data.idempotencyKey).not.toBe('other-owner-request');
    expect(readPayoutDraft(sessionStorage, 2)?.partnerId).toBe(4);
  });
  it('permits correction after a definite rollback but preserves key-conflict requests', async () => {
    state.create.mockRejectedValue(Object.assign(new Error('Payout exceeds payable commission'), { status: 409 }));
    await choose(); await click(createBtn());
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    state.create.mockRejectedValue(Object.assign(new Error('This payout idempotency key was already used with a different payload'), { status: 409 }));
    await choose(); await click(createBtn());
    expect(readPayoutDraft(sessionStorage, 1)).not.toBeNull();
  });
  it('does not send when retry storage cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    await choose(); await click(createBtn());
    expect(state.create).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('suppresses rapid duplicate clicks and cleans storage after unmount', async () => {
    let resolve!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await choose(); await click(createBtn()); await click(createBtn());
    expect(state.create).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    await act(async () => resolve({ id: 1 }));
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    root = createRoot(element); await render();
  });
});

describe('Manual payout settlement', () => {
  const payout = (o: any = {}) => ({ id: 9, partnerId: 3, amount: 100.1, currency: 'NGN', status: 'PROCESSING', createdAt: '2025-01-01', partnerName: 'Ada Obi', bankDetailsAvailable: true, bankDetails: bank, paidBy: null, ...o });
  it('reveals frozen bank details only on explicit click and clears them on close', async () => {
    state.payouts = [payout()]; await render();
    expect(element.textContent).toContain('****6789');
    await click(q('button-mark-paid-9'));
    expect(state.reveal).not.toHaveBeenCalled();
    state.reveal.mockResolvedValue({ id: 1, partnerId: 3, payoutMethod: 'BANK_TRANSFER', bankName: 'Fictional Alpha Bank', accountName: 'Ada Obi', accountNumber: '0123456789', bankCode: '90001', updatedAt: '' });
    await click(q('button-reveal-bank'));
    expect(state.reveal).toHaveBeenCalledWith(9, expect.anything());
    expect(q('text-revealed-bank')!.textContent).toContain('0123456789');
    await click(q('modal-close'));
    expect(element.textContent).not.toContain('0123456789');
    await click(q('button-mark-paid-9'));
    expect(q('text-revealed-bank')).toBeNull();
  });
  it('requires confirmation and reference, then sends confirmExternalTransfer once', async () => {
    state.payouts = [payout({ status: 'PENDING' })]; await render();
    await click(q('button-mark-paid-9'));
    expect((q('button-confirm-paid') as HTMLButtonElement).disabled).toBe(true);
    await typeInto(q('input-payment-reference') as HTMLInputElement, ' TRF-551 ');
    expect((q('button-confirm-paid') as HTMLButtonElement).disabled).toBe(true);
    await click(q('checkbox-confirm-transfer'));
    await click(q('button-confirm-paid')); await click(q('button-confirm-paid'));
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update.mock.calls[0][0]).toEqual({ payoutId: 9, data: { status: 'PAID', paymentReference: 'TRF-551', confirmExternalTransfer: true } });
  });
  it('does not offer mark paid for already paid payouts', async () => {
    state.payouts = [payout({ status: 'PAID', paymentReference: 'X', paidBy: 1, paidAt: '2025-02-03T12:30:00.000Z' })]; await render();
    expect(q('button-mark-paid-9')).toBeNull();
    expect(element.textContent).toContain('Recorded by user #1');
    expect(q('text-payout-paid-at-9')?.getAttribute('datetime')).toBe('2025-02-03T12:30:00.000Z');
    expect(q('text-payout-paid-at-9')?.textContent).toContain('13:30');
    expect(q('text-payout-paid-at-9')?.textContent).toContain('WAT');
  });
});
