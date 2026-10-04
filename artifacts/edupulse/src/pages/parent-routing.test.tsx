// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ timetable: vi.fn() }));
vi.mock('@clerk/react', () => ({ UserButton: () => null }));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<typeof import('@workspace/api-client-react')>(),
  useGetParentProfile: () => ({ data: { name: 'Unit Parent', email: 'unit@example.test', phone: 'Unit contact' } }),
  useGetParentChildren: () => ({ data: [
    { id: 12, firstName: 'First', lastName: 'Child', schoolId: 3, schoolName: 'Unit School' },
    { id: 13, firstName: 'Second', lastName: 'Child', schoolId: 4, schoolName: 'Other Unit School' },
  ] }),
  useGetParentChild: (id: number) => id === 12
    ? { data: { id: 12, firstName: 'First', schoolId: 3 } }
    : { isError: true, data: null },
  useGetChildAcademicTimetable: (id: number, params: { schoolId: number }) => {
    calls.timetable(id, params); return { data: [] };
  },
}));
vi.mock('@/components/subscription-access-banner', () => ({ SubscriptionAccessBanner: () => null }));
vi.mock('@/components/fee-payment-notifications', () => ({ FeePaymentNotifications: () => null }));
vi.mock('@/pages/communication-inbox', () => ({ CommunicationInbox: () => null, CommunicationInboxBadge: () => null }));
vi.mock('./parent-communication', () => ({ default: () => null }));

import ParentPortal from './parent-portal';
const render = (path: string) => {
  window.history.replaceState(null, '', path);
  return renderToStaticMarkup(<Router ssrPath={path}><ParentPortal /></Router>);
};

describe('existing Parent portal routes', () => {
  beforeEach(() => calls.timetable.mockClear());
  it.each(['/parent', '/parent/', '/parent/dashboard', '/'])('opens the existing dashboard at %s', path => {
    expect(render(path)).toContain('Welcome, Unit Parent.');
  });
  it.each(['/parent/timetable', '/timetable'])('offers only linked children at %s', path => {
    const html = render(path);
    expect(html).toContain('/parent/timetable/12');
    expect(html).toContain('/parent/timetable/13');
    expect(html).not.toContain('Page not found');
  });
  it('uses the linked child and that child’s school for the existing timetable hook', () => {
    expect(render('/parent/timetable/12')).toContain('No class timetable available');
    expect(calls.timetable).toHaveBeenCalledWith(12, { schoolId: 3 });
  });
  it('does not load a timetable when the child lookup is denied', () => {
    render('/parent/timetable/987');
    expect(calls.timetable).not.toHaveBeenCalled();
  });
});