// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  actorId: 1,
  create: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { user: { id: state.actorId } } }),
  useListPlatformPartnerPayouts: () => ({ data: [], isLoading: false, isError: false }),
  getListPlatformPartnerPayoutsQueryKey: () => ['/api/platform/partner-payouts'],
  useCreatePartnerPayout: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdatePartnerPayout: () => ({ mutate: state.update }),
}));
vi.mock('@/components/shared', () => ({
  PageHeading: () => null,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  StatusPill: () => null,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/pages/partner/nfc-owner-control', () => ({ PartnerNfcOwnerControl: () => null }));
import { PayoutsOverview } from './management';
import { readPayoutDraft, savePayoutDraft } from '@/lib/partner-payout-retry';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let element: HTMLDivElement;
let root: Root;
let client: QueryClient;
const render = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><PayoutsOverview /></QueryClientProvider>));
};
const inputs = () => [...element.querySelectorAll('input')];
const setInput = async (index: number, value: string) => {
  await act(async () => {
    const input = inputs()[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const clickCreate = async () => {
  await act(async () => (element.querySelector('button') as HTMLButtonElement).click());
};

beforeEach(async () => {
  sessionStorage.clear();
  state.actorId = 1;
  vi.clearAllMocks();
  state.create.mockRejectedValue(new Error('Lost response'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  element = document.createElement('div');
  document.body.appendChild(element);
  root = createRoot(element);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  element.remove();
});

describe('Partner payout client retry identity', () => {
  it('sends exact decimal input with a stable key and restores it after remount', async () => {
    await setInput(0, '3');
    await setInput(1, '100.10');
    await clickCreate();
    const first = state.create.mock.calls[0][0].data;
    expect(first).toMatchObject({ partnerId: 3, amount: '100.10', currency: 'NGN' });
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(readPayoutDraft(sessionStorage, 1)).toEqual(first);
    expect(inputs().every((input) => input.disabled)).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(element);
    await render();
    expect(inputs()[0].value).toBe('3');
    expect(inputs()[1].value).toBe('100.10');
    await clickCreate();
    expect(state.create.mock.calls[1][0].data).toEqual(first);
  });

  it('clears the completed request and invalidates the real generated payout query key', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    state.create.mockResolvedValue({ id: 1 });
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    expect(inputs()[0].value).toBe('');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/platform/partner-payouts'] });
    const first = state.create.mock.calls[0][0].data;
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    expect(state.create.mock.calls[1][0].data.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('does not share another Owner’s pending request', async () => {
    savePayoutDraft(sessionStorage, 2, { idempotencyKey: 'other-owner-request', partnerId: 4, amount: '200', currency: 'NGN' });
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    expect(state.create.mock.calls[0][0].data.idempotencyKey).not.toBe('other-owner-request');
    expect(readPayoutDraft(sessionStorage, 2)?.partnerId).toBe(4);
  });

  it('permits correction after a definite rollback but preserves uncertain and key-conflict requests', async () => {
    state.create.mockRejectedValue(Object.assign(new Error('Payout exceeds payable commission'), { status: 409 }));
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    expect(inputs()[0].disabled).toBe(false);
    state.create.mockRejectedValue(Object.assign(new Error('This payout idempotency key was already used with a different payload'), { status: 409 }));
    await clickCreate();
    expect(readPayoutDraft(sessionStorage, 1)).not.toBeNull();
    expect(inputs()[0].disabled).toBe(true);
  });

  it('does not send a request when durable retry storage cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    expect(state.create).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('suppresses rapid duplicate clicks while one request is unresolved', async () => {
    let resolve!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    await clickCreate();
    expect(state.create).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ id: 1 }));
  });

  it('cleans up completed storage even when navigation unmounts the form', async () => {
    let resolve!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    await act(async () => root.unmount());
    await act(async () => resolve({ id: 1 }));
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    root = createRoot(element);
    await render();
  });

  it('does not clear another actor’s restored draft when an earlier request completes', async () => {
    let resolve!: (value: unknown) => void;
    state.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await setInput(0, '3');
    await setInput(1, '100');
    await clickCreate();
    savePayoutDraft(sessionStorage, 2, { idempotencyKey: 'owner-two-pending', partnerId: 4, amount: '200', currency: 'NGN' });
    state.actorId = 2;
    await render();
    await act(async () => resolve({ id: 1 }));
    expect(readPayoutDraft(sessionStorage, 1)).toBeNull();
    expect(readPayoutDraft(sessionStorage, 2)?.partnerId).toBe(4);
    expect(inputs()[0].value).toBe('4');
    expect(inputs()[1].value).toBe('200');
    expect(inputs()[0].disabled).toBe(true);
  });
});
