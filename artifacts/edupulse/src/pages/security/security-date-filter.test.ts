import { describe, expect, it } from 'vitest';
import { dayRange, validDayRange } from './security-contract';

describe('security date filters fail explicitly without a render crash', () => {
  it.each([['invalid', ''], ['2026-02-31', ''], ['2026-10-03', '2026-10-02']])(
    'rejects malformed, impossible or reversed dates: %s / %s', (from, to) => {
      expect(validDayRange(from, to)).toBe(false);
      expect(dayRange(from, to)).toEqual({});
    });
  it('accepts empty or valid same-day filters', () => {
    expect(validDayRange('', '')).toBe(true);
    expect(validDayRange('2026-10-02', '2026-10-02')).toBe(true);
    expect(dayRange('2026-10-02', '2026-10-02').to).toBeTruthy();
  });
});