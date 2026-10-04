// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankFields } from './payroll-common';

describe('shared verified bank account form', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('selects a bank and fills its routing code without manual entry', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const set = vi.fn();
    await act(async () => root.render(<BankFields v={{ bankName: '', bankCode: '', accountName: '', accountNumber: '' }} set={set} />));
    const select = host.querySelector<HTMLSelectElement>('[data-testid="input-bank-name"]')!;
    await act(async () => { select.value = '058'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(set).toHaveBeenCalledWith({ bankName: 'Guaranty Trust Bank', bankCode: '058' });
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-code"]')!.readOnly).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-account-number"]')!.readOnly).toBe(false);
    await act(async () => root.unmount());
  });
  it('preserves a currently saved bank outside the common bank options', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const set = vi.fn();
    await act(async () => root.render(<BankFields v={{ bankName: 'Existing provider bank', bankCode: '999999', accountName: 'Unit Account', accountNumber: '' }} maskedCurrent="••••1234" set={set} />));
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('999999');
    expect(host.textContent).toContain('Existing provider bank (current saved bank)');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-code"]')!.value).toBe('999999');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-account-number"]')!.value).toBe('');
    expect(set).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});