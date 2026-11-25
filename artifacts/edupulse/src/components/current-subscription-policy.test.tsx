import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CurrentSubscriptionPolicy } from './current-subscription-policy';
describe('Owner current subscription policy', () => {
  it('states authoritative direct pricing without advertising historical allocations', () => {
    const html = renderToStaticMarkup(<CurrentSubscriptionPolicy showInternal />);
    expect(html).toContain('₦3,200'); expect(html).toContain('₦150');
    expect(html).toContain('no school allocation, split payment');
    expect(html).toContain('separate platform expense');
    expect(html).toContain('historical'); expect(html).toContain('January 2027');
    expect(html).not.toMatch(/₦5,000|₦1,900|₦3,100|₦100/);
  });
  it('keeps internal BRO commission information out of the ordinary school policy', () => {
    const html = renderToStaticMarkup(<CurrentSubscriptionPolicy />);
    expect(html).toContain('₦3,200');
    expect(html).toContain('January 2027');
    expect(html).not.toContain('₦150');
    expect(html).not.toContain('Eligible BRO commission');
  });
});
