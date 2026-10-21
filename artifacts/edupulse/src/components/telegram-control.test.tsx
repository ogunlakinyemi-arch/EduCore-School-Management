import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const st = vi.hoisted(() => ({ s: {} as Record<string, unknown>, ctx: { isPlatformOwner: false, roles: [{ schoolId: 3, role: "PARENT", status: "ACTIVE" }] } as any }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: st.ctx }),
  useGetTelegramStatus: () => ({ data: st.s, isError: false, refetch: vi.fn() }),
  getGetTelegramStatusQueryKey: (p: unknown) => ['tg', p],
  useCheckTelegramHealth: () => ({ data: { ready: false, reason: 'webhook_missing', botUsername: null }, isPending: false, isError: false, mutate: vi.fn() }),
  useCreateTelegramLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmTelegramLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkTelegram: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
import { ParentTelegramControl, OwnerTelegramHealth, telegramGate } from './telegram-control';
const base = { configured: true, ready: true, reason: 'ok', botUsername: 'b', linked: false, consented: false, parentEligible: true, policyAllowed: true, pending: false, pendingAccountLabel: null };
const render = (o: object) => { st.s = { ...base, ...o }; return renderToStaticMarkup(<ParentTelegramControl schoolId={3} />); };
describe('telegram control', () => {
  it('separates disabled, unavailable and policy-blocked', () => {
    expect(render({ configured: false, ready: false })).toContain('disabled');
    expect(render({ ready: false })).toContain('unavailable');
    expect(render({ policyAllowed: false })).toContain('blocked');
  });
  it('requires consent before start, no manual chat id', () => {
    const h = render({});
    expect(h).toContain('checkbox-telegram-consent');
    expect(h).toMatch(/button-telegram-start[^>]*disabled/);
    expect(h).not.toMatch(/chat id/i);
  });
  it('shows pending label, confirm and unlink', () => {
    const h = render({ pending: true, pendingAccountLabel: '@parent' });
    expect(h).toContain('@parent');
    expect(h).toContain('Confirm this Telegram account');
    expect(h).toContain('button-telegram-unlink');
  });
  it('allows unlink when policy unavailable', () => {
    expect(render({ linked: true, consented: true, ready: false, policyAllowed: false })).toContain('button-telegram-unlink');
    expect(telegramGate({ ...base, ready: false })).toBe(false);
  });
  it('owner health never offers a message', () => {
    const h = renderToStaticMarkup(<OwnerTelegramHealth />);
    expect(h).toContain('Check bot configuration');
    expect(h).toContain('never sends a message');
    expect(h).not.toMatch(/send test/i);
  });
});
