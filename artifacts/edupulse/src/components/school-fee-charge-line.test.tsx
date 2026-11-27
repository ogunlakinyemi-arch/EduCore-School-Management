// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SchoolFeeChargeLine, SCHOOL_NFC_CATEGORY, SCHOOL_NFC_LABEL, validFeeChargeLines, schoolChargeMinor, feeChargeInput } from './school-fee-charge-line';

const line = { categoryId: SCHOOL_NFC_CATEGORY, amount: '', description: '' };
it('always provides the built-in category even when the school has no saved fee categories', () => {
  const html = renderToStaticMarkup(<SchoolFeeChargeLine schoolId={7} line={line} index={0} categories={[]} onChange={vi.fn()} />);
  expect(html).toContain(SCHOOL_NFC_LABEL);
  expect(html).toContain('School NFC amount');
  expect(html).toContain('required=""');
  expect(html).not.toContain('Line note');
  expect(html).not.toContain('input-line-description');
  expect(html).toContain('collected by your school');
  expect(html).toContain('does not pay or activate a Yetenia platform subscription');
});
it.each(['', ' ', '0', '0.00', '-1', 'NaN', '12.345'])('blocks missing/invalid amount %s without defaulting to platform prices', amount => {
  expect(schoolChargeMinor(amount)).toBeNull();
  expect(validFeeChargeLines([{ ...line, amount }], [], 7)).toBe(false);
  expect(() => feeChargeInput({ ...line, amount })).toThrow('greater than zero');
});
it('preserves the exact school-entered amount in a school-owned payload, never a platform checkout', () => {
  expect(validFeeChargeLines([{ ...line, amount: '7250.50' }], [], 7)).toBe(true);
  expect(feeChargeInput({ ...line, amount: '7250.50' })).toEqual({ builtInCategory: 'SCHOOL_NFC', amountMinor: 725050 });
});
it('never duplicates the canonical option or exposes a reserved platform category or another school category', () => {
  const categories = [
    { id: 1, schoolId: 7, name: SCHOOL_NFC_LABEL, status: 'ACTIVE' },
    { id: 2, schoolId: 7, name: 'NFC Card Subscription', status: 'ACTIVE' },
    { id: 3, schoolId: 8, name: 'Other school charge', status: 'ACTIVE' },
  ] as any;
  const html = renderToStaticMarkup(<SchoolFeeChargeLine schoolId={7} line={line} index={0} categories={categories} onChange={vi.fn()} />);
  expect(html.match(new RegExp(`>${SCHOOL_NFC_LABEL}<`, 'g'))).toHaveLength(1);
  expect(html).not.toContain('value="2"'); expect(html).not.toContain('value="3"');
});
it('requires fresh amount entry after selecting the built-in category and enables save only for a positive amount', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const save = vi.fn(), host = document.createElement('div'), root = createRoot(host);
  document.body.append(host);
  function Form() {
    const [current, change] = useState({ categoryId: '', amount: '3200', description: 'Old note' });
    const valid = validFeeChargeLines([current], [], 7);
    return <form onSubmit={e => { e.preventDefault(); if (valid) save(feeChargeInput(current)); }}>
      <SchoolFeeChargeLine schoolId={7} line={current} categories={[]} index={0} onChange={change} />
      <button type="submit" disabled={!valid}>Save draft</button>
    </form>;
  }
  try {
    await act(async () => root.render(<Form />));
    const select = host.querySelector('select')!;
    await act(async () => { select.value = SCHOOL_NFC_CATEGORY; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const amount = host.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(amount.value).toBe('');
    expect(host.querySelector('input[placeholder="Line note (optional)"]')).toBeNull();
    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    for (const value of ['0', '7250']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, value);
        amount.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(button.disabled).toBe(value === '0');
    }
    expect(save).not.toHaveBeenCalled();
    await act(async () => { button.click(); });
    expect(save).toHaveBeenCalledWith({ builtInCategory: 'SCHOOL_NFC', amountMinor: 725000 });
  } finally { await act(async () => root.unmount()); host.remove(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; }
});
