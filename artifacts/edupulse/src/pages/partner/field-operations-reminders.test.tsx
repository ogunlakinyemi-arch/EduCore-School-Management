// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const f = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'sess-a' } as Record<string, unknown>,
  sms: {} as Record<string, unknown>,
  smsCalls: [] as any[],
  mutationOpts: [] as any[],
  preview: vi.fn(), permission: vi.fn(), dispatch: vi.fn(),
  isOwner: true,
}));
vi.mock('@clerk/react', () => ({ useAuth: () => f.auth, useUser: () => ({ user: { id: f.auth.userId } }) }));
vi.mock('@tanstack/react-query', async o => ({ ...await o<typeof import('@tanstack/react-query')>(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
const leads = [
  { id: 1, schoolName: 'Ikeja Grammar', address: 'a', status: 'Visited', visitDate: '2025-03-04', nextFollowUpDate: null, currentOwnerId: 4 },
  { id: 2, schoolName: 'Surulere Day', address: 'b', status: 'Interested', visitDate: '2025-03-05', nextFollowUpDate: null, currentOwnerId: 4 },
  { id: 3, schoolName: 'Yaba Model', address: 'c', status: 'Adopted', visitDate: '2025-03-06', nextFollowUpDate: null, currentOwnerId: 4 },
  { id: 4, schoolName: 'Ajah Heights', address: 'd', status: 'Visited', visitDate: '2025-03-07', nextFollowUpDate: null, currentOwnerId: 4 },
  { id: 5, schoolName: 'Lekki Bridge', address: 'e', status: 'Visited', visitDate: '2025-03-08', nextFollowUpDate: null, currentOwnerId: 4 },
];
const smsData = { blockedReason: null, campaigns: [], leads: [
  { id: 1, schoolName: 'Ikeja Grammar', contactPhone: '08031110001', allowed: true, eligible: true, reason: null },
  { id: 2, schoolName: 'Surulere Day', contactPhone: '08031110002', allowed: true, eligible: true, reason: null },
  { id: 3, schoolName: 'Yaba Model', contactPhone: '08031110003', allowed: true, eligible: false, reason: 'Already onboarded' },
  { id: 4, schoolName: 'Ajah Heights', contactPhone: '08031110004', allowed: false, eligible: true, reason: null },
  // lead 5 deliberately absent from the server SMS list (e.g. invalid phone)
] };
vi.mock('@workspace/api-client-react', async o => ({
  ...await o<typeof import('@workspace/api-client-react')>(),
  useGetBroFieldOptions: () => ({ isLoading: false, isError: false, data: { isOwner: f.isOwner, bros: [], schools: [], conflicts: [] }, refetch: vi.fn() }),
  useListBroFieldLeads: () => ({ isLoading: false, isError: false, data: leads, refetch: vi.fn() }),
  useGetBroFieldLead: () => ({ isLoading: true }),
  useCreateBroFieldLead: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBroFieldLead: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestBroFieldTransfer: () => ({ mutate: vi.fn(), isPending: false }),
  useDecideBroFieldTransfer: () => ({ mutate: vi.fn(), isPending: false }),
  useGetFieldSmsCampaigns: (opts: any) => { f.smsCalls.push(opts); return f.sms; },
  usePreviewFieldSmsCampaign: (o: any) => { f.mutationOpts.push(o); return { mutateAsync: f.preview, isPending: false }; },
  useRecordFieldSmsPermission: (o: any) => { f.mutationOpts.push(o); return { mutateAsync: f.permission, isPending: false }; },
  useDispatchFieldSmsCampaign: (o: any) => { f.mutationOpts.push(o); return { mutateAsync: f.dispatch, isPending: false }; },
}));
import FieldOperationsPage from './field-operations';

async function dom() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const render = async () => { await act(async () => root.render(<FieldOperationsPage />)); };
  const click = async (id: string) => { const el = $(id)!; expect(el).not.toBeNull(); await act(async () => el.click()); };
  const close = async () => { await act(async () => root.unmount()); host.remove(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; };
  return { host, $, render, click, close };
}
const checked = (el: HTMLElement | null) => (el as HTMLInputElement).checked;
const disabled = (el: HTMLElement | null) => (el as HTMLInputElement | HTMLButtonElement).disabled;

beforeEach(() => {
  f.auth = { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'sess-a' };
  f.sms = { isLoading: false, isError: false, data: smsData, refetch: vi.fn() };
  f.smsCalls = []; f.mutationOpts = []; f.isOwner = true;
  f.preview.mockReset(); f.permission.mockReset(); f.dispatch.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('field operations visit reminders', () => {
  it('wires checkboxes and actions into the visited list beside, not inside, the detail button', async () => {
    const d = await dom();
    try {
      await d.render();
      expect(d.$('field-reminder-toolbar')).not.toBeNull();
      const row = d.$('row-field-lead-1')!;
      const detail = d.$('field-lead-1')!;
      expect(row.contains(detail)).toBe(true);
      expect(detail.querySelector('input,button')).toBeNull();
      expect(d.$('field-sms')).not.toBeNull();
      expect(d.$('field-sms')!.contains(d.$('check-field-lead-1'))).toBe(false);
    } finally { await d.close(); }
  });

  it('non-Owner keeps the plain list without SMS controls or SMS requests', async () => {
    f.isOwner = false; const d = await dom();
    try {
      await d.render();
      expect(d.$('field-lead-1')).not.toBeNull();
      expect(d.$('check-field-lead-1')).toBeNull(); expect(d.$('field-sms')).toBeNull();
      expect(f.smsCalls).toHaveLength(0);
    } finally { await d.close(); }
  });

  it('selects single and all eligible visible rows using server eligibility, shared with the composer', async () => {
    const d = await dom();
    try {
      await d.render();
      await d.click('check-field-lead-1');
      expect(d.$('check-sms-lead-1')).toBeNull(); expect(d.$('check-sms-all')).toBeNull();
      expect(d.$('text-sms-selected-count')!.textContent).toContain('1 recipient');
      await d.click('check-field-select-visible');
      expect(d.$('check-field-select-visible')!.parentElement!.textContent).toContain('2 of 5');
      expect(checked(d.$('check-field-lead-2'))).toBe(true);
      expect(d.$('button-field-send-reminders')!.textContent).toContain('(2)');
      for (const id of [3, 4, 5]) { expect(disabled(d.$(`check-field-lead-${id}`))).toBe(true); expect(checked(d.$(`check-field-lead-${id}`))).toBe(false); }
      expect(document.querySelectorAll('[data-testid="input-sms-message"]')).toHaveLength(1);
      expect(d.$('field-sms')!.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    } finally { await d.close(); }
  });

  it('shows exclusions and opens the reason-required permission recorder from an excluded row', async () => {
    f.permission.mockResolvedValue({});
    const d = await dom();
    try {
      await d.render();
      expect(d.$('text-field-excluded-3')!.textContent).toContain('Already onboarded');
      expect(d.$('text-field-excluded-4')!.textContent).toContain('permission');
      expect(d.$('text-field-excluded-5')!.textContent).toContain('Not in server SMS contacts');
      expect(d.$('button-field-remind-4')).toBeNull();
      expect(d.$('sms-permission-form')).toBeNull();
      await d.click('button-field-record-permission-4');
      const save = d.$('button-save-permission') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      const input = d.$('input-permission-reason') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Head teacher agreed by phone');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await d.click('button-save-permission');
      expect(f.permission).toHaveBeenCalledWith({ data: { leadId: 4, allowed: true, reason: 'Head teacher agreed by phone' } });
      expect(checked(d.$('check-field-lead-4'))).toBe(false);
    } finally { await d.close(); }
  });

  it('row reminder only opens the composer; preview shows count and dispatch needs confirmation', async () => {
    f.preview.mockResolvedValue({ id: 9, digest: 'a'.repeat(64), message: 'm', recipients: [{ leadId: 1, schoolName: 'Ikeja Grammar', phone: '0803', state: 'REQUESTED' }] });
    f.dispatch.mockResolvedValue({});
    const d = await dom();
    try {
      await d.render();
      await d.click('button-field-remind-1');
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      expect(f.preview).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
      expect((d.$('input-sms-message') as HTMLTextAreaElement).value).toContain('Yetenia EduCore');
      const draft = (d.$('input-sms-message') as HTMLTextAreaElement).value;
      expect(draft).not.toMatch(/https?:|\+?\d{7,}|reply/i); expect(draft).toContain('Yetenia representative');
      await d.click('button-sms-preview');
      expect(f.preview.mock.calls[0][0].data).toMatchObject({ all: false, leadIds: [1] });
      expect(d.$('text-sms-preview-count')!.textContent).toContain('1 recipient');
      expect(disabled(d.$('button-sms-send'))).toBe(true);
      await d.click('check-sms-confirm');
      await d.click('button-sms-send');
      expect(f.dispatch).toHaveBeenCalledWith({ id: 9, data: { digest: 'a'.repeat(64), confirm: true } });
    } finally { await d.close(); }
  });

  it('row Send reminder replaces an existing multi-selection with exactly that school and discards the preview', async () => {
    f.preview.mockResolvedValue({ id: 9, digest: 'c'.repeat(64), message: 'm', recipients: [] });
    const d = await dom();
    try {
      await d.render();
      await d.click('check-field-select-visible');
      await d.click('button-sms-preview');
      expect(d.$('sms-preview')).not.toBeNull();
      await d.click('button-field-remind-2');
      expect(checked(d.$('check-field-lead-1'))).toBe(false); expect(checked(d.$('check-field-lead-2'))).toBe(true);
      expect(d.$('sms-preview')).toBeNull();
      await d.click('button-field-remind-2');
      expect(d.$('text-sms-selected-count')!.textContent).toContain('1 recipient');
      await d.click('button-sms-preview');
      expect(f.preview.mock.calls.at(-1)![0].data).toMatchObject({ all: false, leadIds: [2] });
      expect(f.dispatch).not.toHaveBeenCalled();
    } finally { await d.close(); }
  });

  it('opt-out for an eligible contact uses the reason-bearing form', async () => {
    const d = await dom();
    try {
      await d.render();
      await d.click('button-field-optout-1');
      expect((d.$('radio-permission-optout') as HTMLInputElement).checked).toBe(true);
      expect(disabled(d.$('button-save-permission'))).toBe(true);
    } finally { await d.close(); }
  });

  it('ignores a preview that completes after the session changed', async () => {
    let resolve!: (v: unknown) => void;
    f.preview.mockReturnValue(new Promise(r => { resolve = r; }));
    const d = await dom();
    try {
      await d.render();
      await d.click('check-field-lead-1');
      await d.click('button-sms-preview');
      f.auth = { isLoaded: true, isSignedIn: true, userId: 'user-b', sessionId: 'sess-c' };
      await d.render();
      await act(async () => { resolve({ id: 9, digest: 'd'.repeat(64), message: 'm', recipients: [{ leadId: 1, schoolName: 'x', phone: '1', state: 'REQUESTED' }] }); });
      expect(d.$('sms-preview')).toBeNull(); expect(d.$('sms-notice')).toBeNull();
    } finally { await d.close(); }
  });

  it('surfaces uncertain dispatch and readiness errors without hiding them', async () => {
    f.preview.mockResolvedValue({ id: 9, digest: 'b'.repeat(64), message: 'm', recipients: [{ leadId: 1, schoolName: 'Ikeja Grammar', phone: '0803', state: 'REQUESTED' }] });
    f.dispatch.mockRejectedValue({ status: 503 });
    const d = await dom();
    try {
      await d.render();
      await d.click('check-field-lead-1'); await d.click('button-sms-preview');
      await d.click('check-sms-confirm'); await d.click('button-sms-send');
      expect(d.$('sms-notice')!.textContent).toContain('will not be resent');
      f.sms = { isLoading: false, isError: true, error: { status: 401 }, refetch: vi.fn() };
      await d.render();
      expect(d.$('sms-readiness-error')!.textContent).toContain('SESSION_REQUIRED');
      expect(d.$('text-reminder-eligibility-unknown')).not.toBeNull();
      expect(disabled(d.$('check-field-lead-1'))).toBe(true);
      expect(d.$('button-field-remind-1')).toBeNull();
    } finally { await d.close(); }
  });

  it('keys by user and session, uses cookies only, waits for a loaded session, and resets on session change', async () => {
    f.auth = { isLoaded: false, isSignedIn: undefined, userId: null, sessionId: null };
    const d = await dom();
    try {
      await d.render();
      expect(f.smsCalls.at(-1).query.enabled).toBe(false);
      f.auth = { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'sess-a' };
      await d.render();
      const call = f.smsCalls.at(-1);
      expect(call.query.enabled).toBe(true);
      expect(call.query.queryKey).toEqual(expect.arrayContaining(['user-a', 'sess-a']));
      expect(call.request).toEqual({ credentials: 'same-origin' });
      expect(call.query.retry(0,{status:401})).toBe(true);
      expect(call.query.retry(1,{status:401})).toBe(false);
      expect(call.query.retry(0,{status:403})).toBe(false);
      expect(call.query.retry(0,{status:503})).toBe(false);
      expect(call.query.retryDelay).toBe(1000);
      expect(f.mutationOpts.every(o => o?.request?.credentials === 'same-origin')).toBe(true);
      expect(JSON.stringify([call, ...f.mutationOpts])).not.toMatch(/authorization|bearer/i);
      await d.click('check-field-lead-1');
      expect(checked(d.$('check-field-lead-1'))).toBe(true);
      f.auth = { isLoaded: true, isSignedIn: true, userId: 'user-a', sessionId: 'sess-b' };
      await d.render();
      expect(f.smsCalls.at(-1).query.queryKey).toEqual(expect.arrayContaining(['user-a', 'sess-b']));
      expect(checked(d.$('check-field-lead-1'))).toBe(false);
    } finally { await d.close(); }
  });
});
