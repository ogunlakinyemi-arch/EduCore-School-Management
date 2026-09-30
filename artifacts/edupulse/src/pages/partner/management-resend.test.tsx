// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  location: '/partners',
  partners: [
    { id: 11, fullName: 'Partner A', email: 'a@partners.test', partnerCode: 'A', partnerType: 'BUSINESS', status: 'INVITED' },
    { id: 22, fullName: 'Partner B', email: 'b@partners.test', partnerCode: 'B', partnerType: 'BUSINESS', status: 'INVITED' },
    { id: 33, fullName: 'Partner C', email: 'c@partners.test', partnerCode: 'C', partnerType: 'BUSINESS', status: 'INVITED' },
  ],
  invitations: [
    { id: 101, partnerId: 11, email: 'a@partners.test', status: 'PENDING' },
    { id: 202, partnerId: 22, email: 'b@partners.test', status: 'PENDING' },
    { id: 303, partnerId: 33, email: 'c@partners.test', status: 'PENDING' },
  ],
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: state.invitations, isError: false, isLoading: false, refetch: vi.fn() }),
  };
});

vi.mock('@workspace/api-client-react', () => ({
  useListPartners: () => ({ data: state.partners, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreatePartnerInvitation: () => ({}),
  useGetPartner: () => ({}),
  useUpdatePartnerStatus: () => ({}),
  useListPartnerSchools: () => ({}),
  useListPartnerCommissions: () => ({}),
  useListPartnerPayouts: () => ({}),
  useListPlatformPartnerPayouts: () => ({}),
  useUpdatePartnerCommissionStatus: () => ({}),
  useUpdatePartnerPayout: () => ({}),
  useListPartnerAttributionConflicts: () => ({}),
  useResolvePartnerAttributionConflict: () => ({}),
  useCreatePartnerPayout: () => ({}),
}));

vi.mock('wouter', () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  Switch: ({ children }: any) => <>{children}</>,
  Route: ({ path, component, children }: any) => {
    if (path !== state.location) return null;
    return component ? React.createElement(component) : typeof children === 'function' ? children({}) : children;
  },
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ eyebrow, title, description, action }: any) => <header><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p>{action}</header>,
  Button: ({ children, testId, variant: _variant, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  money: (value: number) => String(value),
  date: (value: string) => value,
  SkeletonPage: () => <div>Loading</div>,
  EmptyState: () => <div>Empty</div>,
  ErrorState: () => <div>Error</div>,
  Modal: () => null,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  cx: (...classes: string[]) => classes.join(' '),
  Metric: () => <div />,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/pages/not-found', () => ({ default: () => <div>Not found</div> }));

import PartnerManagement from './management';

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;

describe('partner invitation resend row isolation', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    state.location = '/partners';
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  });

  it('resends only the selected invitation ID once on rapid repeated clicks', async () => {
    let finishRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishRequest = resolve; })));
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PartnerManagement /></QueryClientProvider>));

    const rowA = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Partner A'))!;
    const rowB = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Partner B'))!;
    const rowC = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Partner C'))!;
    const resendB = rowB.querySelector<HTMLButtonElement>('[aria-label="Resend invitation for Partner B"]')!;

    await act(async () => {
      resendB.click();
      resendB.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/platform/partners/22/invitations/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ invitationId: 202 }),
    }));
    expect(rowA.textContent).toContain('Resend');
    expect(rowA.textContent).not.toContain('Resending');
    expect(rowB.textContent).toContain('Resending…');
    expect(rowC.textContent).toContain('Resend');
    expect(rowC.textContent).not.toContain('Resending');
    await act(async () => {
      finishRequest({ ok: true, json: async () => ({}) } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('keeps overlapping rows independent and allows the first row to resend after its own request settles', async () => {
    const deferred: Array<{ resolve: (response: Response) => void }> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => deferred.push({ resolve }))));
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PartnerManagement /></QueryClientProvider>));

    const rowA = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Partner A'))!;
    const rowB = [...host.querySelectorAll('tr')].find((row) => row.textContent?.includes('Partner B'))!;
    const resendA = rowA.querySelector<HTMLButtonElement>('[aria-label="Resend invitation for Partner A"]')!;
    const resendB = rowB.querySelector<HTMLButtonElement>('[aria-label="Resend invitation for Partner B"]')!;

    await act(async () => {
      resendA.click();
      resendB.click();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rowA.textContent).toContain('Resending…');
    expect(rowB.textContent).toContain('Resending…');

    await act(async () => {
      deferred[0].resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rowA.textContent).toContain('Resend');
    expect(rowA.textContent).not.toContain('Resending');
    expect(rowB.textContent).toContain('Resending…');

    await act(async () => {
      resendA.click();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith('/api/platform/partners/11/invitations/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ invitationId: 101 }),
    }));

    await act(async () => {
      deferred[1].resolve({ ok: true, json: async () => ({}) } as Response);
      deferred[2].resolve({ ok: true, json: async () => ({}) } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});