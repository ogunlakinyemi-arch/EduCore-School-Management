// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ userId: 'user_a' }));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: auth.userId }) }));
vi.mock('@/components/shared', () => ({
  Button: ({ children, testId, variant: _v, ...p }: any) => <button data-testid={testId} {...p}>{children}</button>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ErrorState: () => <div role="alert">error</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  SkeletonPage: () => <div>Loading</div>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));

import { AddSchoolForm, AddSchoolPage, MySchoolsTable } from './partner-schools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let host: HTMLDivElement; let qc: QueryClient;
let rows: any[]; let profile: any; let calls: Array<{ url: string; method: string; body: any }>;
let postResponder: (url: string) => Response | Promise<Response>;
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, error = 'nope') => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 80)); });
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as any;
function type(id: string, v: string) {
  const el = q(id);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
function render(ui: React.ReactNode) {
  act(() => root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>));
}
function fillForm() {
  type('input-school-name', 'Cedar Grove'); type('input-school-city', 'Ikeja'); type('input-school-state', 'Lagos');
  type('input-admin-name', 'Bola Ade'); type('input-admin-email', 'bola@cg.ng'); type('input-admin-phone', '08031234567');
}
const submit = async (times = 1) => {
  await act(async () => { for (let i = 0; i < times; i++) q('form-add-school').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
};
const row = (o: any) => ({ attributionStatus: 'ACTIVE', attributionSource: 'PARTNER_ADDED', startDate: '2025-01-01', totalStudents: 0, subscriptionStatus: 'TRIAL', ...o });

beforeEach(() => {
  auth.userId = 'user_a';
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calls = [];
  profile = { id: 4, isOwner: true, partnerRole: 'PARTNER_OWNER' };
  rows = [
    row({ schoolId: 1, schoolName: 'Greenfield College', registrationStatus: 'PENDING', invitationId: '11', invitationStatus: 'PENDING', adminName: 'Ada', adminEmail: 'ada@g.ng', adminPhone: '0803' }),
    row({ schoolId: 2, schoolName: 'Hillcrest Academy', registrationStatus: 'PENDING', invitationId: '22', invitationStatus: 'PENDING', adminName: 'Ife', adminEmail: 'ife@h.ng', adminPhone: '0805' }),
    row({ schoolId: 3, schoolName: 'Lakeside', registrationStatus: 'ACTIVE', invitationId: '33', invitationStatus: 'ACCEPTED', acceptedAt: '2025-01-02' }),
    row({ schoolId: 4, schoolName: 'Odd Case', registrationStatus: 'PENDING', invitationId: '44', invitationStatus: 'UNKNOWN' }),
  ];
  postResponder = async () => { await new Promise(r => setTimeout(r, 20)); return ok({ schoolId: 9, email: 'ada@g.ng', administratorInvitation: { invitationId: '99' } }); };
  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === 'GET') return url.includes('/partner/profile') ? ok(profile) : ok(rows);
    return postResponder(url);
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const posts = () => calls.filter(c => c.method === 'POST');

describe('Add school', () => {
  it('sends exact body once on double submit, has no password/referral, resets, shows pending row cache', async () => {
    render(<AddSchoolForm />);
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.textContent).not.toMatch(/referral/i);
    fillForm();
    await submit(2);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual({
      school: { name: 'Cedar Grove', city: 'Ikeja', state: 'Lagos' },
      administrator: { fullName: 'Bola Ade', email: 'bola@cg.ng', phone: '08031234567' },
    });
    expect(q('input-school-name').value).toBe('');
    expect(q('text-add-school-notice').textContent).toMatch(/inbox delivery is unverified/i);
    expect(q('text-add-school-notice').textContent).not.toMatch(/\bsent\b/i);
    expect(q('link-view-my-schools')).not.toBeNull();
  });
  it('409 duplicate shows message, keeps input, allows correction', async () => {
    postResponder = () => fail(409, 'A school with this name already exists');
    render(<AddSchoolForm />); fillForm(); await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('already exists');
    expect(q('input-school-name').value).toBe('Cedar Grove');
    expect(q('button-send-school-invitation').disabled).toBe(false);
  });
  it('ambiguous 500 locks the form and never retries blindly', async () => {
    postResponder = () => fail(500, 'Provider timeout');
    render(<AddSchoolForm />); fillForm(); await submit(); await submit();
    expect(posts()).toHaveLength(1);
    expect(q('button-send-school-invitation').disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Check My Schools before retrying/);
  });
  it('page is gated for staff and partner admin sees form', async () => {
    profile = { id: 4, isOwner: false, partnerRole: 'PARTNER_STAFF' };
    render(<AddSchoolPage />); await flush();
    expect(q('add-school-forbidden')).not.toBeNull();
    expect(q('form-add-school')).toBeNull();
  });
  it('page shows form for partner admin', async () => {
    profile = { id: 4, isOwner: false, partnerRole: 'PARTNER_ADMIN' };
    render(<AddSchoolPage />); await flush();
    expect(q('form-add-school')).not.toBeNull();
  });
});

describe('My schools', () => {
  it('shows statuses, admin details, status detail, uncertain row has no resend', async () => {
    render(<MySchoolsTable canManage />); await flush();
    expect(q('row-school-1').textContent).toMatch(/ada@g.ng[\s\S]*0803[\s\S]*Pending/);
    expect(q('row-school-3').textContent).toContain('Active');
    expect(q('button-resend-3')).toBeNull();
    expect(q('button-resend-4')).toBeNull();
    expect(q('row-school-4').textContent).toContain('Uncertain');
    act(() => q('button-status-4').click());
    expect(q('text-status-detail-4').textContent).toMatch(/uncertain/);
  });
  it('resend double click hits only the selected row once', async () => {
    render(<MySchoolsTable canManage />); await flush();
    await act(async () => { q('button-resend-1').click(); q('button-resend-1').click(); });
    expect(q('button-resend-1').disabled).toBe(true);
    expect(q('button-resend-2').disabled).toBe(false);
    await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toContain('/partner/schools/1/invitations/11/resend');
    expect(q('button-resend-1').disabled).toBe(false);
    expect(host.textContent).toContain('unverified');
  });
  it('two simultaneous resends on different rows both release their own keys', async () => {
    render(<MySchoolsTable canManage />); await flush();
    await act(async () => { q('button-resend-1').click(); q('button-resend-2').click(); });
    await flush();
    expect(posts().map(p => p.url.match(/schools\/(\d+)\//)![1]).sort()).toEqual(['1', '2']);
    expect(q('button-resend-1').disabled).toBe(false);
    expect(q('button-resend-2').disabled).toBe(false);
  });
  it('stale invitation 409 refreshes list and explains, no retry', async () => {
    postResponder = () => { rows[0] = { ...rows[0], invitationId: '12' }; return fail(409, 'stale'); };
    render(<MySchoolsTable canManage />); await flush();
    await act(async () => { q('button-resend-1').click(); }); await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/no longer current/);
    expect(posts()).toHaveLength(1);
    expect(q('button-resend-1').disabled).toBe(false);
    expect(calls.filter(c => c.method === 'GET').length).toBeGreaterThan(1);
  });
  it('read-only staff get no resend; private data absent', async () => {
    render(<MySchoolsTable canManage={false} />); await flush();
    expect(q('button-resend-1')).toBeNull();
    expect(host.textContent).not.toMatch(/parent|teacher|finance/i);
  });
  it('picks up acceptance via refetch', async () => {
    render(<MySchoolsTable canManage />); await flush();
    rows[0] = { ...rows[0], registrationStatus: 'ACTIVE', invitationStatus: 'ACCEPTED' };
    await act(async () => { await qc.invalidateQueries({ queryKey: ['/api/partner/schools'] }); }); await flush();
    expect(q('row-school-1').textContent).toContain('Active');
    expect(q('button-resend-1')).toBeNull();
  });
  it('does not reuse another identity cache', async () => {
    render(<MySchoolsTable canManage />); await flush();
    expect(q('row-school-1')).not.toBeNull();
    auth.userId = 'user_b'; rows = [];
    render(<MySchoolsTable canManage />);
    expect(q('row-school-1')).toBeNull();
    await flush();
    expect(host.textContent).toContain('No schools yet');
  });
});
