// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyPayslipsPage } from './my-payslips';

const payslip = {
  id: 7, periodMonth: '2026-10', employeeName: 'Own Teacher', employeeType: 'TEACHER',
  schoolName: 'Own school', baseSalaryMinor: 100000, allowanceMinor: 1000,
  bonusMinor: 2000, deductionMinor: 500, adjustmentMinor: -100,
  adjustmentReason: 'Own adjustment', netSalaryMinor: 102400, currency: 'NGN',
  paymentStatus: 'PAID', maskedAccountNumber: '••••1234',
  transferReference: 'own-reference', providerTransactionId: '7',
  createdAt: '2026-10-01T00:00:00Z',
};

describe('Teacher payslips client contract and states', () => {
  let root: Root;
  let client: QueryClient;
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    client?.clear();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });
  async function mount(response: unknown, status = 200) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(response), {
      status, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(<QueryClientProvider client={client}><MyPayslipsPage /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    return { host, fetcher };
  }
  it('requests the authoritative endpoint and renders a valid empty state', async () => {
    const { host, fetcher } = await mount([]);
    expect(String(fetcher.mock.calls[0][0])).toBe('/api/me/payroll/payslips');
    expect((fetcher.mock.calls[0][1] as RequestInit).method).toBe('GET');
    expect(host.textContent).toContain('No payslips');
    expect(host.textContent).not.toContain('Couldn’t load this view');
    await act(async () => { await client.refetchQueries(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('No payslips');
  });
  it('opens the own-payslip detail using its documented endpoint and frozen amounts', async () => {
    const { host, fetcher } = await mount([payslip]);
    fetcher.mockImplementation(async () => new Response(JSON.stringify(payslip), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="row-payslip-7"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(fetcher.mock.calls.some(call => String(call[0]) === '/api/me/payroll/payslips/7')).toBe(true);
    expect(host.textContent).toContain('Own Teacher');
    expect(host.textContent).toContain('Own school');
    expect(host.textContent).toContain('Own adjustment');
    expect(host.textContent).toContain('1,024');
    expect(host.textContent).toContain('Print payslip');
  });
  it('uses a payslip-specific error rather than implying an Operations dependency', async () => {
    const { host } = await mount({ error: 'Unavailable' }, 500);
    expect(host.textContent).toContain('Your payslips could not be loaded');
    expect(host.textContent).not.toContain('operations feed');
  });
});
