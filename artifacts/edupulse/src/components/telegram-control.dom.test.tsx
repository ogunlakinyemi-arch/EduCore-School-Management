// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({
  s: {} as any, ctx: {} as any, keys: [] as any[],
  create: vi.fn(), confirm: vi.fn(), unlink: vi.fn(), health: vi.fn(),
  healthState: undefined as any,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }: any) => <svg data-qr-value={value} /> }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: m.ctx }),
  useGetTelegramStatus: (p: any) => ({ data: m.s[p.schoolId], isError: false, refetch: vi.fn() }),
  getGetTelegramStatusQueryKey: (p: any) => { m.keys.push(p); return ['tg', p]; },
  useCheckTelegramHealth: () => m.healthState ?? ({ mutate: m.health, data: undefined, isPending: false, isError: false }),
  useCreateTelegramLink: () => ({ mutateAsync: m.create, isPending: false }),
  useConfirmTelegramLink: () => ({ mutateAsync: m.confirm, isPending: false }),
  useUnlinkTelegram: () => ({ mutateAsync: m.unlink, isPending: false }),
}));
import { ParentTelegramControl, OwnerTelegramHealth } from './telegram-control';
const base = { configured: true, ready: true, reason: 'ok', botUsername: 'b', linked: false, consented: false, parentEligible: true, policyAllowed: true, pending: false, pendingAccountLabel: null };
let root: Root; let host: HTMLElement;
const mount = (el: any) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root.render(el)); };
const id = (s: string) => host.querySelector(`[data-testid="${s}"]`) as any;
const flush = () => act(async () => { await Promise.resolve(); });
afterEach(() => { act(() => root.unmount()); host.remove(); m.healthState=undefined; vi.clearAllMocks(); });
const parent = (sid: number) => ({ isPlatformOwner: false, roles: [{ schoolId: sid, role: 'PARENT', status: 'ACTIVE' }] });
describe('telegram dom flow', () => {
  it('an Admin invitation requires a fresh parent-owned link and cannot be confirmed directly', () => {
    m.ctx = parent(3); m.s = { 3: { ...base, pending: true, invitationOnly: true } };
    mount(<ParentTelegramControl schoolId={3} />);
    expect(id('button-telegram-confirm')).toBeNull();
    expect(id('button-telegram-start')).not.toBeNull();
    expect(host.textContent).toContain('create your personal link');
  });
  it('consent -> create -> pending -> confirm -> unlink, no mutation on mount', async () => {
    m.ctx = parent(3); m.s = { 3: { ...base } };
    m.create.mockResolvedValue({ url: 'https://t.me/FixtureBot?start=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expiresAt: new Date(Date.now() + 600000).toISOString() });
    m.confirm.mockResolvedValue({ linked: true }); m.unlink.mockResolvedValue({ unlinked: true });
    const el = (sid: number) => <ParentTelegramControl key={sid} schoolId={sid} />;
    mount(el(3));
    expect(m.create).not.toHaveBeenCalled(); expect(m.unlink).not.toHaveBeenCalled();
    expect(host.querySelector('input[type=text],input[name*=chat i]')).toBeNull();
    expect(id('button-telegram-start').disabled).toBe(true);
    act(() => id('checkbox-telegram-consent').click());
    expect(id('button-telegram-start').disabled).toBe(false);
    act(() => id('button-telegram-start').click()); await flush();
    expect(m.create).toHaveBeenCalledWith({ data: { schoolId: 3, consent: true } });
    const a = id('link-telegram-bot'); expect(a.rel).toBe('noreferrer noopener');
    expect(id('qr-telegram').querySelector('svg').getAttribute('data-qr-value')).toBe(a.href);
    m.s = { 3: { ...base, pending: true, pendingAccountLabel: '@kemi' } };
    act(() => root.render(el(3)));
    expect(host.textContent).toContain('@kemi');
    act(() => id('checkbox-telegram-confirm-consent').click());
    act(() => id('button-telegram-confirm').click()); await flush();
    expect(m.confirm).toHaveBeenCalledWith({ data: { schoolId: 3, consent: true } });
    act(() => id('button-telegram-unlink').click()); await flush();
    expect(m.unlink).toHaveBeenCalledTimes(1);
  });
  it('school change resets link and does not show other school status', async () => {
    m.ctx = { isPlatformOwner: false, roles: [parent(3).roles[0], parent(4).roles[0]] };
    m.s = { 3: { ...base }, 4: { ...base, pending: true, pendingAccountLabel: '@four' } };
    m.create.mockResolvedValue({ url: 'https://t.me/FixtureBot?start=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expiresAt: new Date(Date.now() + 600000).toISOString() });
    mount(<ParentTelegramControl schoolId={3} />);
    act(() => id('checkbox-telegram-consent').click());
    act(() => id('button-telegram-start').click()); await flush();
    expect(id('link-telegram-bot')).not.toBeNull();
    act(() => root.render(<ParentTelegramControl schoolId={4} />));
    expect(id('link-telegram-bot')).toBeNull();
    expect(host.textContent).toContain('@four');
    expect(m.keys.some(k => k?.schoolId === 4)).toBe(true);
  });
  it('unavailable: start blocked, withdrawal enabled; non-parent cannot start', () => {
    m.ctx = parent(3); m.s = { 3: { ...base, ready: false, policyAllowed: false, linked: true, consented: true } };
    mount(<ParentTelegramControl schoolId={3} />);
    expect(id('button-telegram-start')).toBeNull();
    expect(id('button-telegram-unlink').disabled).toBe(false);
    act(() => root.unmount()); host.remove();
    m.ctx = { isPlatformOwner: true, roles: [] }; m.s = { 3: { ...base } };
    mount(<ParentTelegramControl schoolId={3} />);
    expect(id('button-telegram-start')).toBeNull();
  });
  it('pending shows context, consent gates confirm, mismatch disables', () => {
    m.ctx = parent(3);
    m.s = { 3: { ...base, pending: true, schoolName: 'Alpha', children: ['Ada'], phoneCheck: 'MISMATCH' } };
    mount(<ParentTelegramControl schoolId={3} />);
    expect(host.textContent).toContain('Alpha'); expect(host.textContent).toContain('Ada');
    act(() => id('checkbox-telegram-confirm-consent').click());
    expect(id('button-telegram-confirm').disabled).toBe(true);
  });
  it('owner health only mutates on click', () => {
    mount(<OwnerTelegramHealth />);
    expect(m.health).not.toHaveBeenCalled();
    act(() => id('button-telegram-health').click());
    expect(m.health).toHaveBeenCalledTimes(1);
  });
  it('owner HTTP failure is an actionable red alert and hides raw errors and stale success',()=>{
    m.healthState={mutate:m.health,isPending:false,isError:true,
      error:{status:404,message:'sensitive diagnostics'},data:{ready:true}};
    mount(<OwnerTelegramHealth/>);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Development-only');
    expect(host.querySelector('[role="alert"]')?.className).toContain('text-[#991b1b]');
    expect(host.textContent).not.toContain('sensitive diagnostics');
    expect(host.textContent).not.toContain('Configuration looks ready');
  });
  it('unready bot results are red while successful results are neutral',()=>{
    m.healthState={mutate:m.health,isPending:false,isError:false,data:{ready:false,reason:'WEBHOOK_CONFLICT'}};
    mount(<OwnerTelegramHealth/>);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('existing webhook');
    m.healthState.data={ready:true,reason:'READY'};
    act(()=>root.render(<OwnerTelegramHealth/>));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.className).not.toContain('text-[#991b1b]');
  });
});
