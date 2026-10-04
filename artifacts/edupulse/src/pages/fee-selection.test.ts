import { describe, expect, it } from 'vitest';
import { lineTotal, parseSelection } from './fee-selection';
import { parseNairaToMinor } from '@/components/cash-payment-action';

describe('fee selection', () => {
  const lines = [{ id: 1, name: 'Tuition', amountMinor: 5000000, paidMinor: 0, outstandingMinor: 5000000 }, { id: 2, name: 'Uniform', amountMinor: 1250050, paidMinor: 0, outstandingMinor: 1250050 }, { id: 3, name: 'Bus', amountMinor: 100, paidMinor: 100, outstandingMinor: 0 }];
  it('sums selected outstanding lines exactly and excludes paid lines', () => {
    expect(lineTotal(lines, [1, 2])).toBe(6250050n);
    expect(lineTotal(lines, [3])).toBe(0n);
  });
  it('reads legacy and line selections, rejecting bad data', () => {
    expect(parseSelection('[4,5]')).toEqual({ 4: 'ALL', 5: 'ALL' });
    expect(parseSelection('{"7":[1,2],"8":"ALL"}')).toEqual({ 7: [1, 2], 8: 'ALL' });
    expect(() => parseSelection('{"7":[0]}')).toThrow();
  });
  it('parses cash naira amounts to minor units', () => {
    expect(parseNairaToMinor('1,500.5')).toBe(150050);
    expect(parseNairaToMinor('0')).toBeNull();
    expect(parseNairaToMinor('1.234')).toBeNull();
  });
});
