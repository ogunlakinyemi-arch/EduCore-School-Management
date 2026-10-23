// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ctx: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: m.ctx,
  usePreviewFlutterwaveLiveEvidence: () => ({ mutateAsync: m.mutateAsync }),
}));
import LiveReadinessPage from './live-readiness';

let host: HTMLDivElement, root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement;
async function set(el: HTMLElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const report = (hash: string | null = 'abc123') => ({
  previewOnly: true, approved: false, persisted: false, activationReady: false, evidenceValid: true, evidenceStatus: 'VALID',
  reviewHash: hash, allocationPreview: { amount: 5000, currency: 'NGN', subaccounts: [{ id: 'sub1', transaction_charge_type: 'flat_subaccount', transaction_charge: 1900 }] },
  policy: { amount: 5000, schoolAmount: 1900, currency: 'NGN', feeBearer: 'Merchant', eligiblePartnerAmount: 100, partnerPayment: 'internal accrued payable', transactionSplitRatio: '' },
  checks: [{ key: 'k1', status: 'PASS', detail: 'ok' }, { key: 'k2', status: 'MISSING', detail: 'none' }], missingTables: ['t_x'],
});
async function fill() {
  await set(q('input-merchant-scope'), 'merchant_01');
  await set(q('input-school-id'), '3');
  await set(q('input-review-id'), '7');
  await set(q('input-evidence'), '{"a":1}');
}
const run = async () => { await act(async () => q('button-preview').click()); };
const importFile = async (file: {size:number;text:()=>Promise<string>}) => {
  await act(async()=>{
    Object.defineProperty(q('input-evidence-file'),'files',{value:[file],configurable:true});
    q('input-evidence-file').dispatchEvent(new Event('change',{bubbles:true}));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  m.ctx.mockReturnValue({ data: { isPlatformOwner: true }, isLoading: false });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<LiveReadinessPage />));

describe('live readiness', () => {
  it('discards a previous Owner request that finishes after another Owner signs in',async()=>{
    let finish!: (r: ReturnType<typeof report>)=>void;
    m.ctx.mockReturnValue({data:{isPlatformOwner:true,user:{id:1}},isLoading:false});
    m.mutateAsync.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    await render();await fill();await run();
    m.ctx.mockReturnValue({data:{isPlatformOwner:true,user:{id:2}},isLoading:false});
    await render();await act(async()=>finish(report()));
    expect(q('text-review-hash')).toBeNull();
    expect((q('input-evidence') as HTMLTextAreaElement).value).toBe('');
  });
  it('clears Owner evidence/report when switching between two authenticated Owner identities',async()=>{
    m.ctx.mockReturnValue({data:{isPlatformOwner:true,user:{id:1}},isLoading:false});
    m.mutateAsync.mockResolvedValue(report());
    await render();await fill();await run();
    expect(q('text-review-hash').textContent).toContain('abc123');
    m.ctx.mockReturnValue({data:{isPlatformOwner:true,user:{id:2}},isLoading:false});
    await render();
    expect(q('text-review-hash')).toBeNull();
    expect((q('input-merchant-scope') as HTMLInputElement).value).toBe('');
    expect((q('input-evidence') as HTMLTextAreaElement).value).toBe('');
  });
  it('denies non-owners and does not mutate while loading', async () => {
    m.ctx.mockReturnValue({ data: { isPlatformOwner: false }, isLoading: false });
    await render();
    expect(q('live-readiness-denied')).toBeTruthy();
    m.ctx.mockReturnValue({ data: undefined, isLoading: true });
    await render();
    expect(q('live-readiness-loading')).toBeTruthy();
    expect(m.mutateAsync).not.toHaveBeenCalled();
  });
  it('submits and shows full report', async () => {
    m.mutateAsync.mockResolvedValue(report());
    await render(); await fill(); await run();
    expect(m.mutateAsync).toHaveBeenCalledWith({ data: { merchantScope: 'merchant_01', schoolId: 3, reviewId: 7, authorityEvidence: { a: 1 } } });
    expect(q('text-review-hash').textContent).toContain('abc123');
    expect(q('check-k1')).toBeTruthy(); expect(q('check-k2')).toBeTruthy();
    expect(q('text-policy').textContent).toContain('1900');
    expect(q('text-missing-tables').textContent).toContain('t_x');
  });
  it('validates json and blocks submit', async () => {
    await render(); await fill();
    await set(q('input-evidence'), '{bad');
    expect(q('list-validation').textContent).toContain('not valid JSON');
    expect((q('button-preview') as HTMLButtonElement).disabled).toBe(true);
    await set(q('input-evidence'), 'x'.repeat(16 * 1024 + 1));
    expect(q('list-validation').textContent).toContain('16 KB');
  });
  it('hides result on change and ignores stale response', async () => {
    let resolve!: (v: unknown) => void;
    m.mutateAsync.mockReturnValue(new Promise(r => { resolve = r; }));
    await render(); await fill(); await run();
    await set(q('input-review-id'), '8');
    await act(async () => resolve(report()));
    expect(q('report')).toBeNull();
    m.mutateAsync.mockResolvedValue(report());
    await run();
    expect(q('report')).toBeTruthy();
    await set(q('input-school-id'), '4');
    expect(q('report')).toBeNull();
  });
  it('imports local JSON only and submits the parsed metadata',async()=>{
    m.mutateAsync.mockResolvedValue(report());
    await render();await fill();
    await importFile({size:11,text:async()=>'{"local":1}'});
    await run();
    expect(m.mutateAsync).toHaveBeenCalledWith({data:{merchantScope:'merchant_01',schoolId:3,reviewId:7,authorityEvidence:{local:1}}});
  });
  it('invalid and oversized imports discard the old valid evidence and block submission',async()=>{
    await render();await fill();
    for(const file of [{size:4,text:async()=>'oops'},{size:17000,text:vi.fn(async()=>'{}')}]){
      await importFile(file);
      expect(q('text-file-error')).toBeTruthy();
      expect((q('input-evidence') as HTMLTextAreaElement).value).toBe('');
      expect((q('button-preview') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(m.mutateAsync).not.toHaveBeenCalled();
  });
  it('does not let a slow file overwrite newer pasted evidence',async()=>{
    let resolve!:(value:string)=>void;
    await render();await fill();
    await importFile({size:10,text:()=>new Promise(r=>{resolve=r;})});
    await set(q('input-evidence'),'{"newer":2}');
    await act(async()=>resolve('{"older":1}'));
    expect((q('input-evidence') as HTMLTextAreaElement).value).toBe('{"newer":2}');
  });
  it('fails closed when file reading fails or the preview request fails',async()=>{
    await render();await fill();
    await importFile({size:10,text:async()=>{throw new Error('Fictional file error');}});
    expect(q('text-file-error').textContent).toContain('could not be read');
    expect((q('button-preview') as HTMLButtonElement).disabled).toBe(true);
    await set(q('input-evidence'),'{}');
    m.mutateAsync.mockRejectedValue(new Error('Fictional unavailable API'));
    await run();
    expect(q('text-error').textContent).toContain('Nothing was saved or approved');
    expect(q('report')).toBeNull();
  });
  it('does not label an existing review hash as matched when evidence changed',async()=>{
    m.mutateAsync.mockResolvedValue({...report(),evidenceValid:false,evidenceStatus:'LIVE_SPLIT_AUTHORITY_HASH_MISMATCH',allocationPreview:null});
    await render();await fill();await run();
    expect(q('text-review-hash').textContent).toContain('did not match');
    expect(q('text-allocation').textContent).toContain('No allocation preview');
    expect(q('text-flags').textContent).toContain('Activation ready: no');
  });
  it('clears evidence and ignores an in-flight response when Owner access changes',async()=>{
    let resolve!:(value:unknown)=>void;
    m.mutateAsync.mockReturnValue(new Promise(r=>{resolve=r;}));
    await render();await fill();await run();
    m.ctx.mockReturnValue({data:{isPlatformOwner:false},isLoading:false});
    await render();await act(async()=>resolve(report()));
    expect(q('live-readiness-denied')).toBeTruthy();
    m.ctx.mockReturnValue({data:{isPlatformOwner:true},isLoading:false});
    await render();
    expect(q('report')).toBeNull();
    expect((q('input-evidence') as HTMLTextAreaElement).value).toBe('');
    expect((q('button-preview') as HTMLButtonElement).disabled).toBe(true);
  });
});
