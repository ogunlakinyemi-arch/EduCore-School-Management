// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { feeClassSections, feeScopeLabel, feeSectionClass, matchingFeeStructures } from '@/lib/school-fee-scope';
const f = vi.hoisted(() => ({
  sessions: [] as any[], terms: [] as any[], classes: [] as any[], classesError: false,
  mutate: vi.fn(), reports: [] as any[], apiSessions: vi.fn(), apiTerms: vi.fn(), apiClasses: vi.fn(),
}));
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: 'fictional-admin' } }) }));
vi.mock('@tanstack/react-query', async o => ({
  ...await o<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));
vi.mock('@workspace/api-client-react', async o => {
  const actual = await o<typeof import('@workspace/api-client-react')>();
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  return { ...actual,
    listAcademicSessions: f.apiSessions, listAcademicTerms: f.apiTerms, listClasses: f.apiClasses,
    useListAcademicSessions: () => q(f.sessions),
    useListAcademicTerms: (id: number) => q(f.terms.filter(t => t.sessionId === id)),
    useListClasses: () => ({ ...q(f.classes), isError: f.classesError }),
    useListFeeCategories: () => q([]),
    useBulkAssignFeeStructure: () => ({ mutateAsync: f.mutate, isPending: false }),
    useGetSchoolFinanceReport: (p: unknown) => { f.reports.push(p); return q({ rows: [], totalCollectedMinor: 0 }); },
  };
});
import { BulkAssignment, FinanceReports } from './finance-phase7';
import { readSchoolFeeCatalog, SchoolFeeScopeLabel } from '@/components/school-fee-scope-label';
import { SchoolCollectionAccount } from './finance';
import { PublishedFeeCorrections } from '@/components/published-fee-corrections';
const structure = { id: 101, schoolId: 7, sessionId: 2, termId: 8, classId: 19,
  section: 'General', status: 'PUBLISHED', version: 2, lines: [{ categoryName: 'Tuition', amountMinor: 500000 }] } as any;
beforeEach(() => {
  vi.clearAllMocks(); f.classesError = false; f.reports = [];
  f.sessions = [{ id: 2, schoolId: 7, name: '2026/2027' }, { id: 99, schoolId: 8, name: 'Other school' }];
  f.terms = [{ id: 8, sessionId: 2, name: 'FIRST' }, { id: 88, sessionId: 99, name: 'Wrong term' }];
  f.classes = [
    { id: 19, schoolId: 7, name: 'JSS 1', section: 'General' },
    { id: 22, schoolId: 7, name: 'SS 1', section: 'Science' },
    { id: 23, schoolId: 7, name: 'SS 1', section: 'Commercial' },
    { id: 31, schoolId: 7, name: 'Prep', section: null },
    { id: 90, schoolId: 8, name: 'SS 1', section: 'Foreign section' },
  ];
  f.apiSessions.mockResolvedValue(f.sessions); f.apiClasses.mockResolvedValue(f.classes);
  f.apiTerms.mockImplementation(async () => f.terms);
  f.mutate.mockResolvedValue({ createdCount: 1, skippedCount: 1, results: [] });
});
async function mount(node: React.ReactNode) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  await act(async () => root.render(node));
  const select = async (id: string, value: string) => {
    const el = host.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`)!;
    expect(el).not.toBeNull();
    await act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  return { host, select, close: async () => {
    await act(async () => root.unmount()); host.remove(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  } };
}
it('resolves historical session, term, class and section names only within the correct school/session', async () => {
  const before = JSON.stringify({ sessions: f.sessions, terms: f.terms, classes: f.classes });
  const catalog = await readSchoolFeeCatalog(7);
  expect(f.apiSessions).toHaveBeenCalledWith({ schoolId: 7, status: 'all' }, { signal: undefined });
  expect(f.apiTerms.mock.calls).toEqual([[2, { schoolId: 7 }, { signal: undefined }]]);
  expect(feeScopeLabel(catalog, structure)).toBe('2026/2027 · FIRST · JSS 1 · General');
  expect(feeScopeLabel(catalog, { ...structure, schoolId: 8 })).toBe('Academic details unavailable');
  expect(feeScopeLabel(catalog, { ...structure, termId: 88 })).toContain('Term unavailable');
  expect(feeScopeLabel(catalog, { ...structure, sessionId: 999 })).not.toMatch(/#|999/);
  expect(JSON.stringify({ sessions: f.sessions, terms: f.terms, classes: f.classes })).toBe(before);
});
it('loads same-school sibling sections, handles a genuinely sectionless class, and changes section IDs safely', () => {
  expect(feeClassSections(f.classes, 7, 22)).toEqual(['Commercial', 'Science']);
  expect(feeClassSections(f.classes, 7, 31)).toEqual([]);
  expect(feeClassSections(f.classes, 7, 90)).toEqual([]);
  expect(feeSectionClass(f.classes, 7, 22, 'Commercial')).toBe(23);
  expect(feeSectionClass(f.classes, 7, 22, 'Foreign section')).toBe(22);
});
it('renders named academic labels and school account summary without a bank or gateway selector', () => {
  const client = new QueryClient();
  client.setQueryData(['school-fee-academic-labels', 'fictional-admin', 7], {
    schoolId: 7, sessions: f.sessions, terms: f.terms, classes: f.classes,
  });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><SchoolFeeScopeLabel {...structure} />
    <PublishedFeeCorrections schoolId={7} structures={[structure, { ...structure, schoolId: 8, id: 999 }]} onSaved={vi.fn()} />
    <SchoolCollectionAccount schoolId={7} canEdit onSaved={vi.fn()}
      settings={{ accountName: 'Fictional school', bankName: 'Saved school bank', maskedAccountNumber: '••••1234' } as any} />
  </QueryClientProvider>);
  expect(html).toContain('2026/2027 · FIRST · JSS 1 · General');
  expect(html).not.toMatch(/Session #|Term #|Class #|class #|term #/);
  expect(html.match(/<select/g)).toHaveLength(1); // Published schedule only, not bank/provider setup.
  expect(html).not.toContain('value="999"');
  expect(html).toContain('Parents pay your school directly');
  expect(html).toContain('Manage school account');
  expect(f.apiClasses).not.toHaveBeenCalled();
  client.clear();
});
it('matches only published exact scope while preserving versions and original records', () => {
  const records = [structure, { ...structure, id: 102, version: 3 },
    ...[{ schoolId: 8 }, { sessionId: 99 }, { termId: 88 }, { classId: 23 }, { section: null }, { status: 'DRAFT' }]
      .map((p, i) => ({ ...structure, id: 200 + i, ...p }))];
  const before = JSON.stringify(records);
  expect(matchingFeeStructures(records, structure).map(s => s.id)).toEqual([101, 102]);
  expect(JSON.stringify(records)).toBe(before);
});
it('populates a matching structure and review without issuance; cancellation and scope changes stay safe', async () => {
  const dom = await mount(<BulkAssignment schoolId={7} structures={[structure]} onChanged={vi.fn()} />);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    await dom.select('select-bulk-session', '2'); await dom.select('select-bulk-term', '8');
    await dom.select('select-bulk-class', '19');
    expect(dom.host.querySelector<HTMLSelectElement>('[data-testid="select-bulk-section"]')!.value).toBe('General');
    const choices = dom.host.querySelector('[data-testid="select-bulk-structure"]')!;
    expect(choices.textContent).toContain('2026/2027 · FIRST · JSS 1 · General · version 2 · ₦5,000.00');
    await dom.select('select-bulk-structure', '101');
    expect(dom.host.querySelector('[data-testid="bulk-invoice-review"]')?.textContent).toContain('Tuition');
    expect(f.mutate).not.toHaveBeenCalled();
    const dates = dom.host.querySelectorAll<HTMLInputElement>('input[type="date"]');
    for (const [i, value] of ['2026-09-14', '2026-12-18'].entries()) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(dates[i], value);
        dates[i].dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => { dom.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(confirm).toHaveBeenCalled(); expect(f.mutate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => { dom.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(f.mutate).toHaveBeenCalledTimes(1);
    expect(f.mutate).toHaveBeenCalledWith({ params: { schoolId: 7 }, data: {
      structureId: 101, classId: 19, section: 'General', issueDate: '2026-09-14', dueDate: '2026-12-18',
    } });
    await dom.select('select-bulk-class', '22');
    expect(dom.host.querySelector('[data-testid="select-bulk-section"]')!.textContent).toContain('Commercial');
    expect(dom.host.querySelector('[data-testid="bulk-invoice-review"]')).toBeNull();
    expect(dom.host.querySelector<HTMLSelectElement>('[data-testid="select-bulk-structure"]')!.value).toBe('');
    expect(f.mutate).toHaveBeenCalledTimes(1);
  } finally { confirm.mockRestore(); await dom.close(); }
});
it('provides honest section emptiness and keeps school-managed methods separate from historical gateway records', async () => {
  const dom = await mount(<BulkAssignment schoolId={7} structures={[]} onChanged={vi.fn()} />);
  try {
    await dom.select('select-bulk-class', '31');
    expect(dom.host.textContent).toContain('This class has no saved sections.');
  } finally { await dom.close(); }
  const report = await mount(<FinanceReports schoolId={7} />);
  try {
    const methods = report.host.querySelector('[data-testid="select-report-method"]')!;
    expect(methods.textContent).toBe('All methodsBank transferCash');
    expect(report.host.querySelectorAll('option[value="PAYSTACK"],option[value="REMITA"],option[value="FLUTTERWAVE"]')).toHaveLength(0);
    expect(f.reports.at(-1)).not.toHaveProperty('method');
    expect(f.reports.at(-1)).not.toHaveProperty('provider');
    await report.select('select-report-method', 'CASH');
    expect(f.reports.at(-1)).toMatchObject({ schoolId: 7, method: 'CASH' });
    expect(report.host.querySelector('[data-testid="select-report-section"]')!.textContent).toContain('Science');
    expect(report.host.textContent).not.toContain('Foreign section');
  } finally { await report.close(); }
});
