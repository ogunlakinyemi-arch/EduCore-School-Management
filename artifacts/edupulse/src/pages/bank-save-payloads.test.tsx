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
    save: vi.fn(), partnerSave: vi.fn(),
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
    useGetPlatformPaymentSettlement: () => setQ, useUpdatePlatformPaymentSettlement: mut,
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
  s.owner = true; s.schoolId = 7; s.catalogue = catalogue(); s.save.mockReset().mockResolvedValue({}); s.partnerSave.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

type Case = { name: string; open: () => Promise<Element>; data: () => any };
const flows: Case[] = [
  { name: 'Owner company settlement', async open() { s.owner = true; await render(<PaymentSettlementPage />); await click(node('button-edit-company-settlement')); return node('form-settlement'); }, data: () => s.save.mock.calls[0][0].data },
  { name: 'School Admin settlement', async open() { s.owner = false; await render(<PaymentSettlementPage />); await click(node('button-edit-settlement')); return node('form-settlement'); }, data: () => s.save.mock.calls[0][0].data },
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
  it('keeps an untouched legacy provider without claiming verification', async () => {
    const form = await f.open();
    expect(document.body.textContent).toContain('Not checked against the current directory');
    await submit(form);
    expect(f.data()).toMatchObject({ bankName: 'Legacy Bank', bankCode: '999999' });
  });
  it('does not verify a pick when the catalogue is UNAVAILABLE, but still lists entries', async () => {
    s.catalogue = catalogue('UNAVAILABLE');
    const form = await f.open(); await typeInto(combo(), 'alpha');
    expect(document.body.querySelector('[role="option"]')!.textContent).toContain('transfer code not verified');
    await pick('alpha'); await submit(form);
    expect(s.save).not.toHaveBeenCalled();
  });
});

describe('Partner payout save payload', () => {
  const form = () => document.body.querySelectorAll('form')[1];
  it('sends bankName and verified bankCode', async () => {
    await render(<PartnerSettings />); await pick('alpha'); await submit(form());
    expect(s.partnerSave).toHaveBeenCalledTimes(1);
    expect(s.partnerSave.mock.calls[0][0].data).toMatchObject({ payoutMethod: 'BANK_TRANSFER', bankName: 'Fictional Alpha Bank', bankCode: '90001' });
  });
  it('blocks unverified and free-text banks', async () => {
    await render(<PartnerSettings />); await pick('gamma'); await submit(form());
    await typeInto(combo(), 'Typed Bank'); await submit(form());
    expect(s.partnerSave).not.toHaveBeenCalled();
  });
  it('preserves an untouched legacy bank and its code', async () => {
    await render(<PartnerSettings />); await submit(form());
    expect(s.partnerSave.mock.calls[0][0].data).toMatchObject({ bankName: 'Legacy Bank', bankCode: '999999' });
  });
});

describe('Finance manual transfer settings', () => {
  const settings = { bankTransferEnabled: true, bankName: 'Legacy Bank', accountName: 'Unit Account', accountNumber: '0123456789' } as any;
  const mountIt = () => render(<BankTransferSettings schoolId={7} settings={settings} canEdit onSaved={() => {}} />);
  it('saves a directory pick by name only', async () => {
    await mountIt(); await pick('beta'); await submit(document.body.querySelector('form')!);
    expect(s.save.mock.calls[0][0].data).toMatchObject({ bankName: 'Fictional Beta Microfinance Bank' });
    expect(s.save.mock.calls[0][0].data).not.toHaveProperty('bankCode');
  });
  it('rejects typed free text and keeps an untouched saved bank', async () => {
    await mountIt(); await typeInto(combo(), 'Typed Bank');
    await submit(document.body.querySelector('form')!); expect(s.save).not.toHaveBeenCalled();
  });
});
