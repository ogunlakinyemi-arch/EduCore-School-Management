// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationChannelPolicy } from '@workspace/api-client-react';
const mocks = vi.hoisted(() => ({ policy: vi.fn(), save: vi.fn(), mutateAsync: vi.fn(), invalidate: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetNotificationChannelPolicy: mocks.policy,
  getGetNotificationChannelPolicyQueryKey: () => ['owner-policy'],
  useUpdateNotificationChannelPolicy: mocks.save,
}));
vi.mock('./shared', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  ErrorState: ({ retry }: any) => <button onClick={retry}>Retry</button>,
}));
import { OwnerNotificationPolicyControl } from './owner-notification-policy';
let host: HTMLDivElement, root: Root, policy: NotificationChannelPolicy;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  policy = { events: {
    ACADEMIC: { allowed: ['IN_APP', 'PUSH', 'TELEGRAM', 'EMAIL'], defaults: ['IN_APP'] },
    ATTENDANCE_ABSENCE: { allowed: ['IN_APP', 'PUSH', 'TELEGRAM', 'SMS'], defaults: ['IN_APP'] },
  }, schools: { '12': { enabled: false, allowed: ['IN_APP'] } } };
  mocks.policy.mockReturnValue({ data: { policy, availability: { EMAIL: true, SMS: true } } });
  mocks.save.mockReturnValue({ isPending: false, mutateAsync: mocks.mutateAsync });
  mocks.mutateAsync.mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<OwnerNotificationPolicyControl />));
const input = (event: string, channel: string) => host.querySelector<HTMLInputElement>(`[aria-label="${event} ${channel}"]`)!;
async function click(el: HTMLElement) { await act(async () => el.click()); }
async function reason() {
  await act(async () => {
    const el = host.querySelector<HTMLInputElement>('input:not([type=checkbox])')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'Reviewed event choices');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('compact central notification settings', () => {
  it('offers only one Email and SMS choice per event, without standard-channel switches or school overrides', async () => {
    await render();
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(4);
    expect(input('ACADEMIC', 'SMS').disabled).toBe(true);
    expect(host.querySelector('select')).toBeNull();
    for (const el of host.querySelectorAll('input[type=checkbox]')) {
      expect(el.getAttribute('aria-label')).toMatch(/ (EMAIL|SMS)$/);
    }
    expect(host.textContent).toContain('including reminders');
    expect(host.textContent).toContain('consent');
  });
  it('saves Email/SMS through the existing API, retaining standard permissions and all school safeguards', async () => {
    await render();
    await click(input('ACADEMIC', 'EMAIL'));
    await click(input('ATTENDANCE_ABSENCE', 'SMS'));
    const save = host.querySelector('button')!;
    expect(save.disabled).toBe(true);
    await reason(); await click(save);
    const sent = mocks.mutateAsync.mock.calls[0][0].data;
    expect(sent.schools).toEqual(policy.schools);
    expect(sent.events.ACADEMIC.allowed).toEqual(policy.events.ACADEMIC!.allowed);
    expect(sent.events.ACADEMIC.defaults).toEqual(['IN_APP', 'EMAIL']);
    expect(sent.events.ATTENDANCE_ABSENCE.defaults).toEqual(['IN_APP', 'SMS']);
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['owner-policy'] });
  });
  it('does not enable held/unavailable delivery through a preference', async () => {
    mocks.policy.mockReturnValue({ data: { policy, availability: { EMAIL: false, SMS: false } } });
    await render();
    expect(input('ACADEMIC', 'EMAIL').disabled).toBe(true);
    expect(input('ATTENDANCE_ABSENCE', 'SMS').disabled).toBe(true);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
