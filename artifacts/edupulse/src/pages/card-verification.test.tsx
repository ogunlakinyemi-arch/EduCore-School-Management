// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const customFetch = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch }));
vi.mock('@/components/shared', () => ({
  Button: (p: any) => <button type={p.type} disabled={p.disabled} data-testid={p.testId}>{p.children}</button>,
  Field: (p: any) => <label>{p.label}{p.children}</label>,
}));
import { CardVerificationPage } from './card-verification';

it('posts the token and shows backend result', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  customFetch.mockResolvedValue({ valid: false, message: 'Card revoked' });
  const el = document.createElement('div'); document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<QueryClientProvider client={new QueryClient()}><CardVerificationPage /></QueryClientProvider>); });
  const ta = el.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, ' opaque ');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(customFetch).toHaveBeenCalledWith('/api/v1/id-cards/verify', expect.objectContaining({ body: JSON.stringify({ token: 'opaque' }) }));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  expect(el.textContent).toContain('Card revoked');
});
