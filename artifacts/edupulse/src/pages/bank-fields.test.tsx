// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cat = vi.hoisted(() => ({ data: undefined as any, isError: false, isLoading: false, isFetching: false, refetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useGetPaymentAccountProviders: () => ({ ...cat }),
}));
import { BankFields } from './payroll-common';
import { bankSelectionAllowed } from '@/lib/bank-selection';

const available = (extra: any[] = []) => ({ status: 'AVAILABLE', catalogueEnvironment: 'TEST', message: '', providers: [
  { id: 'a', name: 'Fictional Alpha Bank', code: '90001', transferCodeVerified: true },
  { id: 'b', name: 'Fictional Beta Microfinance Bank', code: '90002', transferCodeVerified: true },
  { id: 'c', name: 'Fictional Gamma Digital', code: null, transferCodeVerified: false },
  { id: 'd', name: 'FAB (Fictional Alpha alias)', code: '90001', transferCodeVerified: true },
  ...extra] });
type V = { bankName: string; bankCode: string; accountName: string; accountNumber: string };
let latest: V;
function Harness({ init }: { init: V }) {
  const [v, setV] = useState(init); latest = v;
  return <form data-testid="f"><BankFields v={v} set={p => setV(s => ({ ...s, ...p }))} maskedCurrent="****1234" /></form>;
}
async function mount(init: V) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness init={init} />));
  return { host, root };
}
const blank: V = { bankName: '', bankCode: '', accountName: '', accountNumber: '' };
const type = async (host: HTMLElement, text: string) => {
  const input = host.querySelector<HTMLInputElement>('[data-testid="input-bank-name"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return input;
};
const options = (host: HTMLElement) => Array.from(host.querySelectorAll('[role="option"]')).map(o => o.textContent);
const choose = (host: HTMLElement, i = 0) => act(async () => { host.querySelectorAll('[role="option"]')[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });

describe('shared bank provider select', () => {
  afterEach(() => { document.body.innerHTML = ''; cat.data = undefined; cat.isError = false; cat.isLoading = false; cat.isFetching = false; });
  it('shows loading, retry-in-progress and recovery to a selectable provider code', async () => {
    cat.isLoading = true;
    const { host, root } = await mount(blank);
    expect(host.textContent).toContain('Loading bank list');
    expect(host.querySelector<HTMLInputElement>('[role="combobox"]')!.disabled).toBe(true);
    cat.isLoading = false; cat.isFetching = true; cat.isError = true;
    await act(async () => root.render(<Harness init={blank} />));
    const retry=host.querySelector<HTMLButtonElement>('[data-testid="button-refresh-banks"]')!;
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toContain('Retrying');
    cat.isFetching = false; cat.isError = false; cat.data = available();
    await act(async () => root.render(<Harness init={blank} />));
    await type(host, 'beta'); await choose(host);
    expect(latest.bankCode).toBe('90002');
    expect(host.querySelector<HTMLInputElement>('[role="combobox"]')!.validity.valid).toBe(true);
    await act(async () => root.unmount());
  });
  it('exposes every returned institution, including results beyond the first 80', async () => {
    cat.data = available(Array.from({length:100},(_,i)=>({id:`extra-${i}`,name:`Fictional Institution ${i}`,code:`${910000+i}`,transferCodeVerified:true})));
    const { host, root } = await mount(blank);
    await act(async () => host.querySelector<HTMLInputElement>('[role="combobox"]')!.focus());
    expect(options(host)).toHaveLength(104);
    await type(host, 'institution 99'); await choose(host);
    expect(latest).toMatchObject({bankName:'Fictional Institution 99',bankCode:'910099'});
    await act(async () => root.unmount());
  });
  it('revokes selection verification when a refresh fails without deleting saved details', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    await type(host, 'alpha'); await choose(host);
    cat.isError = true;
    await act(async () => root.render(<Harness init={blank} />));
    expect(host.textContent).not.toContain('found in the current bank directory');
    expect(host.querySelector<HTMLInputElement>('[role="combobox"]')!.validity.valid).toBe(false);
    expect(latest.bankName).toBe('Fictional Alpha Bank');
    cat.isError = false;
    await act(async () => root.render(<Harness init={blank} />));
    expect(host.querySelector<HTMLInputElement>('[role="combobox"]')!.validity.valid).toBe(true);
    await act(async () => root.unmount());
  });
  it('searches the catalogue including alias entries and selects a verified bank with its code', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    await type(host, 'fab');
    expect(options(host)).toEqual(['FAB (Fictional Alpha alias)']);
    await type(host, 'beta');
    await choose(host);
    expect(latest.bankName).toBe('Fictional Beta Microfinance Bank');
    expect(latest.bankCode).toBe('90002');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-code"]')!.readOnly).toBe(true);
    await act(async () => root.unmount());
  });
  it('is keyboard usable with combobox semantics', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    const input = await type(host, 'bank');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(latest.bankName).toBe('Fictional Beta Microfinance Bank');
    await act(async () => root.unmount());
  });
  it('blocks an unverified provider with an empty code and never reuses an earlier code', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    await type(host, 'alpha'); await choose(host);
    expect(latest.bankCode).toBe('90001');
    await type(host, 'gamma'); await choose(host);
    expect(latest.bankName).toBe('Fictional Gamma Digital');
    expect(latest.bankCode).toBe('');
    expect(host.textContent).toContain('not currently available for account verification');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-name"]')!.validity.customError).toBe(true);
    expect(host.querySelector<HTMLFormElement>('[data-testid="f"]')!.checkValidity()).toBe(false);
    await act(async () => root.unmount());
  });
  it('rejects free text that was not chosen from the directory', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    await type(host, 'My Own Bank');
    expect(latest.bankName).toBe('');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-name"]')!.validity.customError).toBe(true);
    await act(async () => root.unmount());
  });
  it('shows a refresh fallback and selects nothing when the catalogue is unavailable', async () => {
    cat.data = { status: 'UNAVAILABLE', catalogueEnvironment: null, message: 'Directory offline.', providers: [] };
    const { host, root } = await mount(blank);
    expect(host.textContent).toContain('Directory offline.');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="button-refresh-banks"]')!.click());
    expect(cat.refetch).toHaveBeenCalled();
    expect(latest.bankName).toBe('');
    await act(async () => root.unmount());
  });
  it('preserves a saved legacy bank without claiming verification or rewriting it', async () => {
    cat.data = available();
    const { host, root } = await mount({ bankName: 'Existing provider bank', bankCode: '999999', accountName: 'Unit', accountNumber: '' });
    expect(host.querySelector('[data-testid="bank-saved-note"]')!.textContent).toContain('Saved bank: Existing provider bank. Not checked against the current bank list');
    expect(host.textContent).not.toContain('found in the current bank directory');
    expect(latest.bankName).toBe('Existing provider bank');
    expect(latest.bankCode).toBe('999999');
    expect(host.querySelector<HTMLInputElement>('[data-testid="input-bank-name"]')!.validity.valid).toBe(false);
    await act(async () => root.unmount());
  });
  it('does not present stale fallback names as institutions when the directory is UNAVAILABLE', async () => {
    cat.data = { ...available(), status: 'UNAVAILABLE', message: 'Directory offline.' };
    const { host, root } = await mount(blank);
    const input = await type(host, 'gamma');
    expect(options(host)).toEqual([]);
    await type(host, 'alpha');
    expect(latest.bankName).toBe('');
    expect(latest.bankCode).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = host.querySelector(`#${input.getAttribute('aria-describedby')}`);
    expect(err?.textContent).toContain('Choose a bank from the list');
    await act(async () => root.unmount());
  });
  it('does not treat cached available entries as verified after a failed refresh', async () => {
    cat.data = available(); cat.isError = true;
    const { host, root } = await mount(blank);
    await type(host, 'alpha');
    expect(options(host)).toEqual([]);
    expect(latest.bankCode).toBe('');
    expect(host.textContent).toContain('contact an administrator');
    await act(async () => root.unmount());
  });
  it('ties free-text errors to the field and clears any previous selection', async () => {
    cat.data = available();
    const { host, root } = await mount(blank);
    await type(host, 'alpha'); await choose(host);
    expect(latest.bankCode).toBe('90001');
    const input = await type(host, 'Typed Bank');
    expect(latest.bankName).toBe(''); expect(latest.bankCode).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`#${input.getAttribute('aria-describedby')}`)?.textContent).toContain('Choose a bank from the list');
    await act(async () => root.unmount());
  });
  it('save guard allows only unchanged saved or verified-code selections', () => {
    const saved = { bankName: 'Old', bankCode: '999999' };
    expect(bankSelectionAllowed(saved, saved)).toBe(true);
    expect(bankSelectionAllowed({ bankName: 'New', bankCode: '' }, saved)).toBe(false);
    expect(bankSelectionAllowed({ bankName: 'New', bankCode: '90001' }, saved)).toBe(true);
    expect(bankSelectionAllowed({ bankName: '', bankCode: '' }, null)).toBe(false);
    expect(bankSelectionAllowed({ bankName: 'New', bankCode: '' }, null, false)).toBe(true);
  });
});
