// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeeInvoice } from '@workspace/api-client-react';
import { CashPaymentAction } from './cash-payment-action';

vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, type = 'button', disabled }: any) => <button type={type} disabled={disabled} onClick={onClick}>{children}</button>,
  Modal: ({ children, onClose }: any) => <section><button type="button" onClick={onClose}>Close dialog</button>{children}</section>,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
}));

describe('cash collection form contract and retry behavior', () => {
  let host: HTMLDivElement, root: Root, qc: QueryClient;
  let posts: Array<{ body: any; key: string }>, failFirst: boolean;
  const invoice = { id: 41, schoolId: 1, invoiceNumber: 'FICTIONAL-41', studentName: 'Fictional Student',
    outstandingMinor: 50000, status: 'UNPAID' } as FeeInvoice;
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    posts = []; failFirst = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return { ok: true, json: async () => ({
        selectable: true, reason: null, lines: [
          { id: 1, name: 'Tuition', outstandingMinor: 30000 },
          { id: 2, name: 'Transport', outstandingMinor: 20000 },
          { id: 3, name: 'NFC Card & EduCore Subscription Fee', outstandingMinor: 60000 },
        ],
      }) };
      posts.push({ body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['Idempotency-Key'] });
      if (failFirst && posts.length === 1) throw new Error('Fictional lost response; retry safely');
      return { ok: true, json: async () => ({ id: 7, reference: 'CASH-FICTIONAL', amountMinor: posts.at(-1)!.body.amountMinor, receiptNumber: 'RCP-FICTIONAL' }) };
    }));
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={qc}><CashPaymentAction invoice={invoice} schoolId={1} onDone={vi.fn()} /></QueryClientProvider>));
    await click('Record cash');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); qc.clear(); });
    host.remove(); vi.unstubAllGlobals();
  });
  const click = async (text: string) => {
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  const input = async (label: string, value: string) => {
    const element = Array.from(host.querySelectorAll('label')).find(l => l.textContent?.startsWith(label))?.querySelector('input,textarea,select') as HTMLInputElement;
    expect(element).toBeTruthy();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  };
  const fill = async () => {
    await input('Received from', 'Fictional Guardian');
    await input('Cash reference', 'FICTIONAL-CASH-ONE');
    await input('Amount (₦)', '500.00');
    await input('Date cash received', '2026-01-02');
    await input('Notes', 'Fictional cash collection');
  };
  const submit = async () => {
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  };
  it('sends the collection date and displays the returned receipt', async () => {
    await fill(); await submit();
    expect(posts[0].body).toMatchObject({ amountMinor: 50000, receivedOn: '2026-01-02', receivedFrom: 'Fictional Guardian' });
    expect(posts[0].body.lineIds).toBeUndefined();
    expect(host.textContent).toContain('RCP-FICTIONAL');
  });
  it('reuses the same idempotency key after a lost response', async () => {
    failFirst = true; await fill(); await submit();
    expect(host.textContent).toContain('retry safely');
    await submit();
    expect(posts).toHaveLength(2);
    expect(posts[1].key).toBe(posts[0].key);
    expect(posts[1].body).toEqual(posts[0].body);
  });
  it('uses a different key after editing a previously failed request', async () => {
    failFirst = true; await fill(); await submit();
    await input('Notes', 'Corrected fictional cash note'); await submit();
    expect(posts).toHaveLength(2); expect(posts[1].key).not.toBe(posts[0].key);
  });
  it('submits explicit ordinary categories in full while keeping legacy NFC unavailable', async () => {
    await fill(); await input('Apply payment to', 'categories');
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[2].disabled).toBe(true);
    await act(async () => checkboxes[0].click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Cash amount in naira"]')?.readOnly).toBe(true);
    await submit();
    expect(posts[0].body).toMatchObject({ amountMinor: 30000, lineIds: [1] });
  });
  it('does not submit an empty selection or an overpayment', async () => {
    await fill(); await input('Amount (₦)', '501.00'); await submit();
    expect(posts).toHaveLength(0);
    await input('Apply payment to', 'categories'); await submit();
    expect(posts).toHaveLength(0);
  });
});
