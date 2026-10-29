// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All provider names and codes below are explicitly fictional test data.
const s = vi.hoisted(() => {
  const emp = { employeeId: 1, fullName: 'Unit Staff', employeeType: 'TEACHER', status: 'ACTIVE', monthlySalaryMinor: 5000000, allowanceMinor: 0, deductionMinor: 0, bankName: 'Legacy Bank', bankCode: '999999', maskedAccountNumber: '****1234', bankConfigured: true, accountName: 'Unit Staff' };
  const settlement = { status: 'VERIFIED', businessName: 'Unit Biz', bankName: 'Legacy Bank', bankCode: '999999', accountName: 'Unit Account', accountLast4: '1234', settlementContactEmail: 'a@unit.test', capability: { mode: 'MOCK' } };
  const payout = { payoutMethod: 'BANK_TRANSFER', bankName: 'Legacy Bank', bankCode: '999999', accountName: 'Unit Partner', maskedAccountNumber: '****1' };
  const profile = { fullName: 'Unit Partner', isOwner: true };
  return {
    owner: true, schoolId: 7, emp, settlement, payout, profile,
    save: vi.fn(), partnerSave: vi.fn(), lookup: vi.fn(), plookup: vi.fn(), refresh: vi.fn(),
    catalogue: undefined as any,
  };
});
vi.mock('@/components/shared', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/shared')>(),
  useTenant: () => ({ schoolId: s.schoolId }),
  TenantPicker: () => null,
}));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() });
  const mut = () => ({ isPending: false, mutateAsync: s.save, mutate: s.partnerSave });
  const empQ = q([s.emp]); const perQ = q([]); const setQ = q(s.settlement); const ctxOwner = q({ isPlatformOwner: true, roles: [] });
  const ctxAdmin = q({ isPlatformOwner: false, roles: [{ schoolId: 7, role: 'SCHOOL_ADMIN', status: 'ACTIVE' }] });
  const profileQ = q(s.profile); const payoutQ = q(s.payout);
  return {
    ...actual,
    useGetPaymentAccountProviders: () => q(s.catalogue),
    useGetAuthorizedContext: () => s.owner ? ctxOwner : ctxAdmin,
    useGetPlatformPaymentSettlement: () => ({...setQ, refetch:s.refresh}), useUpdatePlatformPaymentSettlement: mut,
    lookupOwnerReceivingAccount: s.lookup, lookupPartnerReceivingAccount: s.plookup, lookupSchoolFeeBankAccount: s.plookup,
    useListPlatformSchoolSettlements: () => q([]), useListPlatformSettlementHistory: () => q([]), useGetPlatformSchoolSettlement: () => q(undefined),
    useGetSchoolPaymentSettlement: () => setQ, useUpdateSchoolPaymentSettlement: mut, useListSchoolSettlementHistory: () => q([]),
    useListCompanyPayrollEmployees: () => empQ, useListCompanyPayrollPeriods: () => perQ, useUpsertCompanyPayrollEmployee: mut,
    useListSchoolPayrollEmployees: () => empQ, useListSchoolPayrollPeriods: () => perQ, useUpdateSchoolPayrollEmployee: mut,
    useUpdateFinanceSettings: mut,
    useGetPartnerProfile: () => profileQ, useGetPartnerPayoutInformation: () => payoutQ, useUpdatePartnerProfile: mut, useUpdatePartnerPayoutInformation: mut,
  };
});
import { PaymentSettlementPage } from './payment-settlement';
import { PayrollPage } from './payroll';
import { BankTransferSettings } from './finance';
import { PartnerSettings } from './partner/portal';

const catalogue = (status = 'AVAILABLE') => ({ status, catalogueEnvironment: 'TEST', message: status === 'AVAILABLE' ? '' : 'Directory offline.', providers: [
  { id: 'a', name: 'Fictional Alpha Bank', code: '90001', transferCodeVerified: true },
  { id: 'b', name: 'Fictional Beta Microfinance Bank', code: '90002', transferCodeVerified: true },
  { id: 'c', name: 'Fictional Gamma Digital', code: null, transferCodeVerified: false },
] });

let host: HTMLDivElement; let root: Root; let client: QueryClient;
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.body.querySelector<T>(`[data-testid="${id}"]`)!;
const render = async (ui: React.ReactElement) => { await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)); await settle(); };
const combo = () => document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
const click = async (el: HTMLElement) => { await act(async () => el.click()); await settle(); };
const typeInto = async (input: HTMLInputElement, text: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
const pick = async (text: string) => {
  await typeInto(combo(), text);
  await act(async () => { document.body.querySelector('[role="option"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
};
// Dispatching submit directly bypasses native validity so the handler's own guard is what is tested.
const submit = async (form: Element) => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };

beforeEach(() => {
  s.settlement.status='VERIFIED';s.lookup.mockReset().mockResolvedValue({
    accountName:'YETENIA TECHNOLOGIES LIMITED',accountNumberMatched:true,accountLast4:'1234',
    lookupToken:'synthetic-encrypted-proof',expiresAt:new Date(Date.now()+300_000).toISOString(),
  });s.refresh.mockReset();
  s.owner = true; s.schoolId = 7; s.catalogue = catalogue(); s.save.mockReset().mockResolvedValue({}); s.partnerSave.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

type Case = { name: string; open: () => Promise<Element>; data: () => any };
const flows: Case[] = [
  { name: 'Owner company employee', async open() { s.owner = true; await render(<PayrollPage />); await click(node('tab-employees')); await click(node('button-edit-profile-1')); return node('form-payroll-profile'); }, data: () => s.save.mock.calls[0][0].data },
  { name: 'School teacher/staff', async open() { s.owner = false; await render(<PayrollPage />); await click(node('tab-employees')); await click(node('button-edit-profile-1')); return node('form-payroll-profile'); }, data: () => s.save.mock.calls[0][0].data },
];

describe.each(flows)('$name save payload', f => {
  it('sends bankName and the verified numeric bankCode for a catalogue pick', async () => {
    const form = await f.open(); await pick('beta'); await submit(form);
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(f.data()).toMatchObject({ bankName: 'Fictional Beta Microfinance Bank', bankCode: '90002' });
  });
  it('rejects an unverified provider with no code and does not reuse the saved code', async () => {
    const form = await f.open(); await pick('gamma'); await submit(form);
    expect(s.save).not.toHaveBeenCalled();
  });
  it('rejects typed free text submitted programmatically, even after a verified pick', async () => {
    const form = await f.open(); await pick('alpha');
    await typeInto(combo(), 'Typed Bank Name'); await submit(form);
    expect(s.save).not.toHaveBeenCalled();
    expect(combo().getAttribute('aria-invalid')).toBe('true');
  });
  it('preserves legacy display but blocks saving it without directory confirmation', async () => {
    const form = await f.open();
    expect(document.body.textContent).toContain('Not checked against the current bank list');
    await submit(form);
    expect(s.save).not.toHaveBeenCalled();
  });
  it('hides unavailable fallback records and prevents saving them', async () => {
    s.catalogue = catalogue('UNAVAILABLE');
    const form = await f.open(); await typeInto(combo(), 'alpha');
    expect(document.body.querySelector('[role="option"]')).toBeNull();
    await submit(form);
    expect(s.save).not.toHaveBeenCalled();
  });
});

describe('Owner automatic receiving-account lookup',()=>{
  const open=async()=>{s.settlement.status='PENDING_VERIFICATION';await render(<PaymentSettlementPage/>);
    await click(node('button-edit-company-settlement'));};
  const waitLookup=()=>act(async()=>{await new Promise(r=>setTimeout(r,550));});
  const complete=async()=>{await pick('beta');await typeInto(node<HTMLInputElement>('input-account-number'),'0123451234');};
  it('looks up automatically only on a complete account and enables Save Details after a match',async()=>{
    s.save.mockResolvedValue({...s.settlement,status:'VERIFIED'});
    await open();
    expect(s.lookup).not.toHaveBeenCalled();
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
    await complete();
    expect(document.body.textContent).toContain('Looking up account name');
    expect(s.lookup).not.toHaveBeenCalled();
    await waitLookup();
    expect(s.lookup).toHaveBeenCalledOnce();
    expect(s.lookup.mock.calls[0][0]).toEqual({bankName:'Fictional Beta Microfinance Bank',bankCode:'90002',accountNumber:'0123451234'});
    expect(node<HTMLInputElement>('input-account-name').value).toBe('YETENIA TECHNOLOGIES LIMITED');
    expect(node<HTMLInputElement>('input-account-name').readOnly).toBe(true);
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(false);
    expect(s.save).not.toHaveBeenCalled();
    await click(node('button-save-settlement'));
    expect(s.save).toHaveBeenCalledOnce();
    expect(s.save.mock.calls[0][0].data).toMatchObject({lookupToken:'synthetic-encrypted-proof',accountName:'YETENIA TECHNOLOGIES LIMITED',bankCode:'90002'});
    expect(host.textContent).toContain('School Admins can now view these details');
    expect(client.getQueryData(['/api/platform/finance/payment-settlement'])).toMatchObject({status:'VERIFIED'});
    expect(host.querySelector('[data-testid="button-verify-owner-account"]')).toBeNull();
  });
  it('does not lookup incomplete numbers or providers without a supported code',async()=>{
    await open();await pick('beta');await typeInto(node<HTMLInputElement>('input-account-number'),'01234');
    await waitLookup();expect(s.lookup).not.toHaveBeenCalled();
    await pick('gamma');await typeInto(node<HTMLInputElement>('input-account-number'),'0123451234');
    await waitLookup();expect(s.lookup).not.toHaveBeenCalled();
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
  });
  it.each(['LIVE lookup unavailable in Development or sandbox.','Flutterwave could not resolve this account.'])(
    'keeps name empty and Save disabled on %s',async message=>{
      s.lookup.mockRejectedValue(new Error(message));await open();await complete();await waitLookup();
      expect(document.body.textContent).toContain(message);
      expect(node<HTMLInputElement>('input-account-name').value).toBe('');
      expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
      expect(s.save).not.toHaveBeenCalled();
    });
  it.each([
    {accountName:'Other Person'}, {accountName:'YETENIA TECHNOLOGY LIMITED'},
    {accountNumberMatched:false},{accountLast4:'9999'}, {expiresAt:'2020-01-01T00:00:00Z'},
  ])('rejects an ambiguous or mismatching lookup result %j',async change=>{
    s.lookup.mockResolvedValue({...await s.lookup(),...change});s.lookup.mockClear();
    await open();await complete();await waitLookup();
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
    expect(node<HTMLInputElement>('input-account-name').value).toBe('');
    expect(s.save).not.toHaveBeenCalled();
  });
  it('immediately invalidates the match when the number or selected bank changes',async()=>{
    await open();await complete();await waitLookup();
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(false);
    await typeInto(node<HTMLInputElement>('input-account-number'),'0123459999');
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
    expect(node<HTMLInputElement>('input-account-name').value).toBe('');
    await pick('alpha');expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
    expect(s.save).not.toHaveBeenCalled();
  });
  it('ignores a stale in-flight result after an account edit',async()=>{
    let finish!:(value:any)=>void;
    s.lookup.mockImplementation(()=>new Promise(r=>{finish=r;}));
    await open();await complete();await waitLookup();
    await typeInto(node<HTMLInputElement>('input-account-number'),'01234');
    await act(async()=>finish({accountName:'YETENIA TECHNOLOGIES LIMITED',accountNumberMatched:true,
      accountLast4:'1234',lookupToken:'old-proof',expiresAt:new Date(Date.now()+300_000).toISOString()}));
    expect(node<HTMLInputElement>('input-account-name').value).toBe('');
    expect(node<HTMLButtonElement>('button-save-settlement').disabled).toBe(true);
  });
  it('does not resolve on refresh or a programmatic save without lookup evidence',async()=>{
    await open();await submit(node('form-settlement'));
    expect(s.lookup).not.toHaveBeenCalled();expect(s.save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('matching account-name lookup is required');
  });
});

describe('Partner payout automatic bank verification', () => {
  const form = () => node('form-partner-bank');
  const acct = () => node<HTMLInputElement>('input-partner-account-number');
  const wait = () => act(async () => { await new Promise(r => setTimeout(r, 600)); });
  beforeEach(() => { s.plookup.mockReset().mockResolvedValue({ accountName: 'UNIT PARTNER', accountLast4: '6789', lookupToken: 'synthetic-partner-proof', expiresAt: new Date(Date.now() + 300_000).toISOString() }); });
  it('hides unverified legacy details and never looks up on load or programmatic save', async () => {
    await render(<PartnerSettings />); await submit(form());
    expect(node('text-current-bank').textContent).not.toContain('Legacy Bank');
    expect(s.plookup).not.toHaveBeenCalled(); expect(s.partnerSave).not.toHaveBeenCalled();
  });
  it('looks up after 500ms with abort signal and saves only a fresh match', async () => {
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789');
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(true);
    await wait();
    expect(s.plookup).toHaveBeenCalledTimes(1);
    expect(s.plookup.mock.calls[0][0]).toEqual({ bankName: 'Fictional Alpha Bank', bankCode: '90001', accountNumber: '0123456789' });
    expect(s.plookup.mock.calls[0][1]).toMatchObject({ cache: 'no-store' }); expect(s.plookup.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(node<HTMLInputElement>('input-partner-account-name').value).toBe('UNIT PARTNER');
    await submit(form());
    expect(s.partnerSave.mock.calls[0][0].data).toEqual({ payoutMethod: 'BANK_TRANSFER', bankName: 'Fictional Alpha Bank', bankCode: '90001', accountNumber: '0123456789', accountName: 'UNIT PARTNER', lookupToken: 'synthetic-partner-proof' });
  });
  it('invalidates the match immediately on edit and rejects mismatched last4', async () => {
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789'); await wait();
    await typeInto(acct(), '012345678');
    expect(node<HTMLInputElement>('input-partner-account-name').value).toBe('');
    await submit(form()); expect(s.partnerSave).not.toHaveBeenCalled();
    s.plookup.mockResolvedValue({ accountName: 'UNIT PARTNER', accountLast4: '0000', lookupToken: 't', expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await typeInto(acct(), '0123456789'); await wait();
    expect(node('text-partner-lookup-error').textContent).toContain('not confirmed');
    await submit(form()); expect(s.partnerSave).not.toHaveBeenCalled();
  });
  it('shows server errors with retry and blocks unverified banks', async () => {
    s.plookup.mockRejectedValue(new Error('Account name does not match registered BRO name'));
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789'); await wait();
    expect(node('text-partner-lookup-error').textContent).toContain('does not match');
    s.plookup.mockResolvedValue({ accountName: 'UNIT PARTNER', accountLast4: '6789', lookupToken: 'x', expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await click(node('button-retry-partner-lookup')); await wait();
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(false);
    await pick('gamma'); await wait();
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(true);
  });
  it.each(['Other Person', 'PARTNER UNIT', 'UNIT EXTRA PARTNER'])('rejects a malformed successful response with mismatched beneficiary %s', async accountName => {
    s.plookup.mockResolvedValue({ accountName, accountLast4: '6789', lookupToken: 'x', expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789'); await wait();
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(true);
    expect(node<HTMLInputElement>('input-partner-account-name').value).toBe('');
    await submit(form()); expect(s.partnerSave).not.toHaveBeenCalled();
  });
  it('discards an old in-flight response after editing the number', async () => {
    let finish!: (value: unknown) => void;
    s.plookup.mockImplementation(() => new Promise(r => { finish = r; }));
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789'); await wait();
    await typeInto(acct(), '01234');
    await act(async () => finish({ accountName: 'UNIT PARTNER', accountLast4: '6789', lookupToken: 'old', expiresAt: new Date(Date.now() + 300_000).toISOString() }));
    expect(node<HTMLInputElement>('input-partner-account-name').value).toBe('');
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(true);
  });
  it('disables Save when fresh lookup evidence expires', async () => {
    s.plookup.mockImplementation(async () => ({ accountName: 'UNIT PARTNER', accountLast4: '6789', lookupToken: 'short', expiresAt: new Date(Date.now() + 250).toISOString() }));
    await render(<PartnerSettings />); await pick('alpha'); await typeInto(acct(), '0123456789'); await wait();
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(false);
    await wait();
    expect(node<HTMLButtonElement>('button-save-partner-bank').disabled).toBe(true);
    expect(node('text-partner-lookup-error').textContent).toContain('expired');
    await submit(form()); expect(s.partnerSave).not.toHaveBeenCalled();
  });
});

describe('Finance manual transfer settings', () => {
  const settings = { bankTransferEnabled: false, bankName: 'Legacy Bank', accountName: 'Unit School', accountNumber: null, officialSchoolName: 'Unit School', maskedAccountNumber: '****6789', bankVerified: false } as any;
  const mountIt = () => render(<BankTransferSettings schoolId={7} settings={settings} canEdit onSaved={() => {}} />);
  it('saves a directory pick only after a fresh official-school-name lookup with bank code and evidence', async () => {
    s.plookup.mockResolvedValue({ accountName: 'UNIT SCHOOL', accountLast4: '6789',
      lookupToken: 'school-proof', expiresAt: new Date(Date.now() + 300000).toISOString() });
    s.save.mockResolvedValue(settings);
    await mountIt(); await pick('beta');
    await typeInto(node<HTMLInputElement>('input-partner-account-number'), '0123456789');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    expect(node<HTMLInputElement>('input-partner-account-name').readOnly).toBe(true);
    await submit(document.body.querySelector('form')!);
    expect(s.save.mock.calls[0][0].data).toMatchObject({ bankName: 'Fictional Beta Microfinance Bank',
      bankCode: '90002', accountName: 'UNIT SCHOOL', accountNumber: '0123456789', lookupToken: 'school-proof',
      bankTransferEnabled: false });
  });
  it('rejects typed free text and keeps an untouched saved bank', async () => {
    await mountIt(); await typeInto(combo(), 'Typed Bank');
    await submit(document.body.querySelector('form')!); expect(s.save).not.toHaveBeenCalled();
  });
});
