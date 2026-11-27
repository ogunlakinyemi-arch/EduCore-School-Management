import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CurrentSubscriptionPolicy } from './current-subscription-policy';
describe('Owner current subscription policy', () => {
  it('states authoritative direct pricing without advertising historical allocations', () => {
    const html = renderToStaticMarkup(<CurrentSubscriptionPolicy showInternal />);
    expect(html).toContain('₦3,200'); expect(html).toContain('₦150');
    expect(html).toContain('not a checkout split');
    expect(html).toContain('Pay student subscriptions separately');
    expect(html).toContain('Existing payments and receipts are unchanged');
    expect(html).toContain('Free terms require no payment');
    expect(html).not.toMatch(/₦5,000|₦1,900|₦3,100|₦100/);
  });
  it('keeps internal BRO commission information out of the ordinary school policy', () => {
    const html = renderToStaticMarkup(<CurrentSubscriptionPolicy />);
    expect(html).toContain('₦3,200');
    expect(html).toContain('selected school and term');
    expect(html).not.toMatch(/Provider fees|full gross|platform expense|platform allocation/);
    expect(html).not.toContain('₦150');
    expect(html).not.toContain('Eligible BRO commission');
  });
});
