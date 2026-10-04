import { describe, expect, it } from 'vitest';
import { rangeFor } from './attendance-range';
const now = new Date('2025-03-15T10:00:00Z');
describe('rangeFor', () => {
  it('builds today/week/month', () => {
    expect(rangeFor('today', now)).toEqual({ from: '2025-03-15', to: '2025-03-15' });
    expect(rangeFor('week', now)).toEqual({ from: '2025-03-09', to: '2025-03-15' });
    expect(rangeFor('month', now)).toEqual({ from: '2025-03-01', to: '2025-03-15' });
  });
  it('rejects bad custom ranges and uses term/session', () => {
    expect(rangeFor('custom', now, { from: '2025-03-10', to: '2025-03-01' })).toBeNull();
    expect(rangeFor('custom', now, { from: '2025-03-01', to: '2025-03-10' })).toEqual({ from: '2025-03-01', to: '2025-03-10' });
    expect(rangeFor('term', now)).toBeNull();
    expect(rangeFor('session', now, { session: { from: 'a', to: 'b' } })).toEqual({ from: 'a', to: 'b' });
  });
});
