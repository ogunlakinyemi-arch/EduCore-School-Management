import { useEffect, useMemo, useState } from 'react';
import { useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey } from '@workspace/api-client-react';
import {
  ArrowDownToLine, ArrowRight, BookOpen, Building2, ChevronDown,
  ClipboardCheck, FileSpreadsheet, FileText, GraduationCap, Library,
  ListFilter, Search, ShieldCheck, UsersRound, WalletCards, X,
} from 'lucide-react';
import {
  Button, EmptyState, ErrorState, PageHeading, SkeletonPage, TenantPicker, cx, useTenant,
} from '@/components/shared';
import {
  catalogReports, exportReport, REPORT_PAGE_SIZE, useReportCatalog, useReportResult,
  type ExportFormat, type ReportCatalogItem, type ReportFilters, type ReportScope,
} from '@/hooks/use-reporting-api';

const families = [
  { id: 'all', label: 'All reports', icon: BookOpen },
  { id: 'people', label: 'People & classes', icon: UsersRound },
  { id: 'attendance', label: 'Attendance & NFC', icon: ClipboardCheck },
  { id: 'academics', label: 'Academics', icon: GraduationCap },
  { id: 'finance', label: 'Finance & subscriptions', icon: WalletCards },
  { id: 'activity', label: 'School activity', icon: Library },
  { id: 'platform', label: 'Platform & audit', icon: ShieldCheck },
] as const;

const reportFamilies: Record<string, string> = {
  overview: 'platform', students: 'people', parents: 'people', staff: 'people', classes: 'people',
  attendance: 'attendance', 'attendance-history': 'attendance',
  'attendance-discrepancies': 'attendance', 'attendance-daily': 'attendance',
  'attendance-weekly': 'attendance', 'attendance-monthly': 'attendance',
  'attendance-term': 'attendance', nfc: 'attendance',
  academics: 'academics', 'academic-results': 'academics', 'academic-assessments': 'academics',
  timetable: 'academics', 'report-card-summary': 'academics', 'grade-distribution': 'academics',
  finance: 'finance', 'finance-payments': 'finance', subscriptions: 'finance',
  communication: 'activity', library: 'activity', 'library-loans': 'activity',
  operations: 'activity', 'operations-history': 'activity', partners: 'platform', audit: 'platform',
};

const filterLabels: Record<string, string> = {
  schoolId: 'School', sessionId: 'Academic session', academicSessionId: 'Academic session',
  termId: 'Term', classId: 'Class', sectionId: 'Section', subjectId: 'Subject',
  studentId: 'Student', parentId: 'Parent', teacherId: 'Teacher',
  assessmentId: 'Assessment', dateFrom: 'From date', dateTo: 'To date',
  startDate: 'From date', endDate: 'To date', fromDate: 'From date', toDate: 'To date',
  from: 'From date', to: 'To date', date: 'Date',
  status: 'Status', attendanceStatus: 'Attendance status', subscriptionStatus: 'Subscription status',
  paymentMethod: 'Payment method', libraryStatus: 'Library status',
  operationsStatus: 'Operations status', staffRole: 'Staff role',
};
const dateKeys = new Set(['dateFrom', 'dateTo', 'startDate', 'endDate', 'fromDate', 'toDate', 'from', 'to', 'date']);
const startKeys = ['dateFrom', 'startDate', 'fromDate', 'from'];
const endKeys = ['dateTo', 'endDate', 'toDate', 'to'];
const selectInput = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3.5 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
const readable = (key: string) => filterLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-NG');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function dateError(filters: ReportFilters): string {
  const start = startKeys.map(key => filters[key]).find(Boolean);
  const end = endKeys.map(key => filters[key]).find(Boolean);
  const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()) && new Date(`${value}T00:00:00`).toISOString().startsWith(value);
  if (start && !isValidDate(start)) return 'Enter a valid start date.';
  if (end && !isValidDate(end)) return 'Enter a valid end date.';
  if (filters.date && !isValidDate(filters.date)) return 'Enter a valid date.';
  if (start && end && start > end) return 'The start date must be on or before the end date.';
  return '';
}

function ReportingWorkspace({ item, owner, scope, schools }: {
  item: ReportCatalogItem; owner: boolean;
  scope: ReportScope;
  schools: { id: number; name: string }[];
}) {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [offset, setOffset] = useState(0);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const allowedFilters = item.filters.filter(key => key !== 'schoolId' || owner);
  const applied = Object.fromEntries(allowedFilters.filter(key => filters[key]?.trim()).map(key => [key, filters[key]]));
  const serialized = JSON.stringify(applied);
  const valid = !dateError(applied);
  const query = useReportResult(scope, item.id, applied, offset, valid);
  const hasFilters = allowedFilters.length > 0;
  const changeFilter = (key: string, value: string) => {
    setFilters(previous => ({ ...previous, [key]: value }));
    setOffset(0);
  };
  const clearFilters = () => { setFilters({}); setOffset(0); };
  const exportCurrent = async () => {
    if (!valid || exporting) return;
    setExportError(''); setExportSuccess(''); setExporting(true);
    try {
      await exportReport(scope, item.id, format, applied, offset);
      setExportSuccess(`${format.toUpperCase()} export of this page downloaded.`);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'The export could not be prepared.');
    } finally { setExporting(false); }
  };

  useEffect(() => { setExportError(''); setExportSuccess(''); }, [serialized, format, offset]);

  return <div className="space-y-5" data-testid={`report-workspace-${item.id}`}>
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.28)] p-5 md:p-7">
        <div>
          <div className="eyebrow mb-2">{reportFamilies[item.id] === 'platform' ? 'Platform intelligence' : 'Live records'} / {item.id.replaceAll('-', ' ')}</div>
          <h2 className="display-font text-2xl font-bold md:text-3xl" data-testid="text-report-title">{query.data?.title || item.title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">A read-only view of the records you are authorized to see. Corrections belong in the originating workspace.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--muted-foreground))]"><ShieldCheck size={14} /> Read only</span>
      </div>
      {hasFilters && <div className="border-b border-[hsl(var(--border))] p-5 md:p-7">
        <div className="mb-4 flex items-center gap-2 text-sm font-bold"><ListFilter size={16} className="text-[hsl(var(--primary))]" /> Refine this report</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {allowedFilters.map(key => <label key={key} className="block">
            <span className="mb-1.5 block text-xs font-bold text-[hsl(var(--muted-foreground))]">{readable(key)}</span>
            {key === 'schoolId' ? <select className={selectInput} value={filters[key] ?? ''} onChange={event => changeFilter(key, event.target.value)} data-testid="select-report-school">
              <option value="">All authorized schools</option>
              {schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
            </select> : <input className={selectInput} type={dateKeys.has(key) ? 'date' : 'text'} inputMode={key.endsWith('Id') ? 'numeric' : undefined} min={key.endsWith('Id') ? '1' : undefined} placeholder={dateKeys.has(key) ? undefined : `Any ${readable(key).toLowerCase()}`} value={filters[key] ?? ''} onChange={event => changeFilter(key, event.target.value)} data-testid={`input-report-${key}`} />}
          </label>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div role="alert" className="text-xs font-semibold text-[hsl(var(--destructive))]" data-testid="status-report-filter-error">{dateError(applied)}</div>
          <Button variant="quiet" disabled={!Object.keys(applied).length} onClick={clearFilters} testId="button-clear-report-filters"><X size={14} /> Clear filters</Button>
        </div>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 md:px-7">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="eyebrow">Export this view</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">Downloads this page with the same authorized filters as the table.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Export format</span>
            <select className={`${selectInput} min-w-[110px] appearance-none pr-9`} value={format} onChange={event => setFormat(event.target.value as ExportFormat)} data-testid="select-report-export-format">
              <option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="pdf">PDF</option>
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3 text-[hsl(var(--muted-foreground))]" />
          </label>
          <Button onClick={() => void exportCurrent()} disabled={exporting || !valid || query.isLoading || query.isError} testId="button-export-report"><ArrowDownToLine size={16} />{exporting ? 'Preparing…' : 'Download'}</Button>
        </div>
      </div>
      {(exportError || exportSuccess) && <div role={exportError ? 'alert' : 'status'} className={cx('border-t border-[hsl(var(--border))] px-5 py-3 text-sm md:px-7', exportError ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--primary))]')} data-testid="status-report-export">{exportError || exportSuccess}</div>}
    </section>
    {valid ? query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => void query.refetch()} message={query.error instanceof Error ? query.error.message : 'Could not load the report. Please try again.'} /> : query.data ? <>
      {query.data.summary && Object.keys(query.data.summary).length > 0 && <section aria-label="Report summary" className="panel overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] px-5 py-4"><div className="eyebrow">At a glance</div></div>
        <dl className="grid gap-px bg-[hsl(var(--border))] sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(query.data.summary).map(([key, value]) => <div key={key} className="min-w-0 bg-[hsl(var(--card))] px-5 py-5"><dt className="eyebrow">{readable(key)}</dt><dd className="display-font mt-2 break-words text-2xl font-bold" data-testid={`metric-report-${key}`}>{displayValue(value)}</dd></div>)}
        </dl>
      </section>}
      <section className="panel overflow-hidden" aria-label="Report results">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] px-5 py-4 md:px-7">
          <div><div className="eyebrow">Record ledger</div><h3 className="display-font mt-1 text-lg font-bold">Results</h3></div>
          <div className="rounded-full bg-[hsl(var(--secondary))] px-3 py-1 text-xs font-bold" data-testid="text-report-total">{query.data.total.toLocaleString('en-NG')} total</div>
        </div>
        {!query.data.rows.length ? <EmptyState icon={FileText} title="Nothing in this view" description={offset > 0 ? 'This page has no records. Return to the previous page.' : 'No records match this report and its current filters. Adjust the filters to widen the view.'} action={offset > 0 ? <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - REPORT_PAGE_SIZE))}>Previous page</Button> : Object.keys(applied).length ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined} /> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px] border-collapse text-left text-sm">
              <thead className="bg-[hsl(var(--secondary)/.45)]"><tr>{query.data.columns.map(column => <th key={column.key} scope="col" className="whitespace-nowrap border-b border-[hsl(var(--border))] px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] first:pl-7">{column.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-[hsl(var(--border)/.7)]">{query.data.rows.map((row, index) => <tr key={index} className="transition-colors hover:bg-[hsl(var(--secondary)/.25)]" data-testid={`row-report-${index}`}>{query.data!.columns.map(column => <td key={column.key} className="max-w-[340px] break-words px-5 py-4 align-top text-[hsl(var(--foreground)/.85)] first:pl-7" data-testid={`text-report-${column.key}-${index}`}>{displayValue(row[column.key])}</td>)}</tr>)}</tbody>
            </table>
          </div>}
        {query.data.total > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-5 py-3 md:px-7">
          <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-report-visible-count">Showing {query.data.rows.length ? (offset + 1).toLocaleString('en-NG') : '0'}–{(offset + query.data.rows.length).toLocaleString('en-NG')} of {query.data.total.toLocaleString('en-NG')} records · Export downloads this page only.</p>
          <div className="flex items-center gap-2" aria-label="Report pages">
            <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - REPORT_PAGE_SIZE))} testId="button-report-previous-page">Previous</Button>
            <span className="px-1 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="text-report-page">Page {Math.floor(offset / REPORT_PAGE_SIZE) + 1}</span>
            <Button variant="outline" disabled={offset + query.data.rows.length >= query.data.total || !query.data.rows.length} onClick={() => setOffset(offset + REPORT_PAGE_SIZE)} testId="button-report-next-page">Next</Button>
          </div>
        </div>}
      </section>
    </> : <ErrorState retry={() => void query.refetch()} /> : <div role="alert" className="panel p-6 text-sm text-[hsl(var(--destructive))]">Choose a valid date range to load this report.</div>}
  </div>;
}

export function ReportingPage({ audience = 'school' }: { audience?: 'school' | 'parent' | 'partner' }) {
  const { schoolId } = useTenant();
  const contextQuery = useGetAuthorizedContext();
  const context = contextQuery.data;
  const owner = context?.isPlatformOwner === true;
  const parentSchools = [...new Set(context?.roles?.filter(role => role.status === 'ACTIVE' && role.role === 'PARENT' && role.schoolId != null).map(role => Number(role.schoolId)) ?? [])];
  const [parentSchool, setParentSchool] = useState(0);
  const parentSchoolId = parentSchools.includes(parentSchool) ? parentSchool : parentSchools[0] ?? 0;
  const activeRoles = context?.roles?.filter(role => role.status === 'ACTIVE' && (owner || !schoolId || role.schoolId === schoolId)).map(role => role.role).sort().join(',') ?? '';
  const tenantSchoolId = !owner && audience === 'school' ? schoolId : audience === 'parent' ? parentSchoolId : 0;
  const scope = { userId: context?.user?.id ?? 'pending', roleScope: owner ? 'PLATFORM_OWNER' : audience === 'school' ? activeRoles : audience.toUpperCase(), tenantId: tenantSchoolId, tenantSchoolId };
  const ready = !!context && (owner || audience === 'partner' || tenantSchoolId > 0);
  const catalogQuery = useReportCatalog(scope, ready);
  const schoolsQuery = useListSchools({ status: 'active' as any }, { query: { enabled: owner, queryKey: getListSchoolsQueryKey({ status: 'active' as any }) } });
  const [selected, setSelected] = useState('');
  const [family, setFamily] = useState('all');
  const [search, setSearch] = useState('');
  const available = useMemo(() => catalogReports(catalogQuery.data), [catalogQuery.data]);
  const active = available.find(item => item.id === selected) ?? available[0];
  const visible = available.filter(item => (family === 'all' || reportFamilies[item.id] === family) && `${item.title} ${item.id}`.toLowerCase().includes(search.toLowerCase()));
  const visibleFamilies = families.filter(group => group.id === 'all' || available.some(item => reportFamilies[item.id] === group.id));

  return <div className="fade-up">
    <PageHeading eyebrow={owner ? 'Platform / Intelligence' : audience === 'parent' ? 'Family / Intelligence' : audience === 'partner' ? 'Partner / Intelligence' : 'Workspace / Intelligence'} title="Reporting." description={owner ? 'Read across the network, then narrow to a school without entering its operational workspace.' : audience === 'parent' ? 'Reports concerning your linked children, in one place.' : audience === 'partner' ? 'Reports available to your partner account, in one place.' : 'One place to inspect the records behind your school’s work.'} action={!owner && audience === 'school' ? <TenantPicker /> : audience === 'parent' && parentSchools.length > 1 ? <label className="block text-xs font-bold">School<select className={`${selectInput} mt-1`} value={parentSchoolId} onChange={event => setParentSchool(Number(event.target.value))} data-testid="select-parent-report-school">{parentSchools.map(id => <option key={id} value={id}>School {id}</option>)}</select></label> : undefined} />
    <div className="mb-6 grid gap-4 lg:grid-cols-[1.6fr_.4fr]">
      <div className="relative overflow-hidden rounded-2xl bg-[hsl(var(--sidebar))] p-6 text-[hsl(var(--sidebar-foreground))] md:p-8">
        <div className="eyebrow text-[hsl(var(--accent))]">The record, in focus</div>
        <h2 className="display-font relative z-10 mt-3 max-w-xl text-2xl font-bold leading-tight md:text-3xl">Answers grounded in the work already done.</h2>
        <p className="relative z-10 mt-3 max-w-lg text-sm leading-relaxed opacity-70">Live reporting from the source. No parallel ledger, no edits from this view.</p>
        <FileSpreadsheet size={144} strokeWidth={.65} className="absolute -bottom-9 right-3 rotate-[-12deg] opacity-10" />
      </div>
      <div className="panel flex flex-col justify-center p-6">
        <div className="eyebrow">{owner ? 'Network scope' : 'Your access'}</div>
        <div className="display-font mt-2 text-xl font-bold">{owner ? 'Platform view' : 'Authorized reports'}</div>
        <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{owner ? 'School comparison is read-only and appears only where a report supports it.' : 'The catalog only lists reports available to your account.'}</p>
      </div>
    </div>
    {!ready ? <EmptyState icon={Building2} title="Choose a school" description="Select an authorized school context to open reporting." /> :
      catalogQuery.isLoading ? <SkeletonPage /> : catalogQuery.isError ? <ErrorState retry={() => void catalogQuery.refetch()} message={catalogQuery.error instanceof Error ? catalogQuery.error.message : 'The report catalog could not be loaded.'} /> :
      !available.length ? <div className="panel"><EmptyState icon={BookOpen} title="No reports available" description="Your current role does not have any reports in the catalog yet." /></div> :
      <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="panel overflow-hidden xl:sticky xl:top-24" aria-label="Report catalog">
          <div className="border-b border-[hsl(var(--border))] p-5">
            <div className="eyebrow mb-1">Explore</div><h2 className="display-font text-xl font-bold">Report library</h2>
            <label className="relative mt-4 block"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><span className="sr-only">Search reports</span><input className={`${selectInput} pl-9`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a report" data-testid="input-search-reports" /></label>
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))] p-2 xl:flex-col" role="group" aria-label="Report categories">{visibleFamilies.map(group => { const Icon = group.icon; return <button key={group.id} type="button" aria-pressed={family === group.id} onClick={() => setFamily(group.id)} className={cx('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors xl:w-full', family === group.id ? 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]')} data-testid={`button-report-family-${group.id}`}><Icon size={15} />{group.label}</button>; })}</div>
          <nav className="max-h-[420px] overflow-y-auto p-2" aria-label="Available reports">{visible.length ? visible.map(item => <button key={item.id} type="button" onClick={() => setSelected(item.id)} aria-current={active?.id === item.id ? 'page' : undefined} className={cx('flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors', active?.id === item.id ? 'bg-[hsl(var(--sidebar))] font-bold text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--foreground)/.8)] hover:bg-[hsl(var(--secondary))]')} data-testid={`button-report-${item.id}`}><span>{item.title}</span><ArrowRight size={14} className="shrink-0 opacity-50" /></button>) : <p className="px-3 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No reports match that search.</p>}</nav>
        </aside>
        {active && <ReportingWorkspace key={`${scope.userId}-${scope.roleScope}-${tenantSchoolId}-${active.id}`} item={active} owner={owner} scope={scope} schools={(schoolsQuery.data ?? []).map(school => ({ id: school.id, name: school.name }))} />}
      </div>}
  </div>;
}

export default ReportingPage;