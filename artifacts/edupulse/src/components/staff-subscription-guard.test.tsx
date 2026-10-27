import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: { restricted: true, status: 'UNPAID' }, isError: false, isLoading: false }));
vi.mock('@workspace/api-client-react', () => ({
  useGetMyStaffSubscriptionAccess: () => state,
  getGetMyStaffSubscriptionAccessQueryKey: () => ['/api/staff-nfc/access'],
}));
vi.mock('wouter', () => ({ Link: ({ children, href }: any) => <a href={href}>{children}</a> }));
import { isStaffOperationalPage, StaffSubscriptionGuard, StaffSubscriptionNotice } from './staff-subscription-guard';

describe('staff subscription dashboard restrictions', () => {
  it('explains exact renewal price, provider, pending status and retained access', () => {
    const html = renderToStaticMarkup(<StaffSubscriptionNotice status="PENDING" />);
    for (const text of ['₦2,000', 'Flutterwave', 'pending', 'read-only', '/my-nfc-subscription']) expect(html).toContain(text);
  });
  it('makes operational forms read-only when unpaid and restores them on fresh server success', () => {
    const render = (active = true, path = '/academic-work') => renderToStaticMarkup(
      <StaffSubscriptionGuard schoolId={1} actorId={9} active={active} path={path}><button>Save assessment</button></StaffSubscriptionGuard>);
    state.data = { restricted: true, status: 'UNPAID' };
    expect(render()).toContain('fieldset disabled');
    expect(render(false)).not.toContain('fieldset');
    expect(render(true, '/my-nfc-subscription')).not.toContain('fieldset');
    state.data = { restricted: false, status: 'PAID' };
    expect(render()).not.toContain('fieldset');
    state.isError = true;
    expect(render()).toContain('fieldset disabled');
    expect(render()).toContain('status unavailable');
    state.isError = false;
  });
  it.each(['/my-nfc-subscription', '/account', '/notifications', '/my-transport', '/academic-calendar', '/parent-fees'])(
    'does not gate essential or family page %s', path => expect(isStaffOperationalPage(path)).toBe(false));
});
