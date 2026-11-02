import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { customFetch, type NfcScanAuditRow, type OwnerUidInventory, type PlatformDevice } from '@workspace/api-client-react';
import { Download, Radio, Search } from 'lucide-react';
import { Button, EmptyState, PageHeading } from '@/components/shared';
import { uidInventoryKey } from '@/components/owner-uid-reader';
import { AssignUidModal, backendError } from '@/components/uid-actions';
import { AuditFilterSelect } from '@/components/audit-filter-select';

export const nfcScanAuditKey = [...uidInventoryKey, 'scans'] as const;
const PAGE_SIZE = 50;
const POLL_MS = 5_000;
const MAX_POLLS = 60; // finite polling: about five minutes, then manual refresh
const VALID_UID = /^(?:[A-Fa-f0-9]{8}|[A-Fa-f0-9]{14}|[A-Fa-f0-9]{20})$/;

const time = (v?: string | null) => v ? new Date(v).toLocaleString('en-NG') : 'Unavailable';
const toIso = (local: string) => { if (!local) return ''; const d = new Date(local); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
const kindLabel: Record<string, string> = { SCAN: 'Card scan', RETRY: 'Transport retry', HEARTBEAT: 'Heartbeat', MALFORMED: 'Malformed report', ERROR: 'Error report' };
const regLabel: Record<string, string> = { REGISTERED: 'Registered', UNREGISTERED: 'Pending Registration', UNAVAILABLE: 'Registration unavailable' };
const regTone: Record<string, string> = {
  REGISTERED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  UNREGISTERED: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  UNAVAILABLE: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
};

export type AuditFilters = { q: string; schoolId: string; deviceId: string; from: string; to: string; source: string; registration: string; result: string; kind: string };
const emptyFilters: AuditFilters = { q: '', schoolId: '', deviceId: '', from: '', to: '', source: '', registration: '', result: '', kind: 'SCAN' };

export function buildAuditParams(f: AuditFilters, page: number) {
  const p = new URLSearchParams({ view: 'scans', page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.schoolId) p.set('schoolId', f.schoolId);
  if (f.deviceId) p.set('deviceId', f.deviceId);
  const from = toIso(f.from), to = toIso(f.to);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (f.source) p.set('source', f.source);
  if (f.registration) p.set('registration', f.registration);
  if (f.result.trim()) p.set('result', f.result.trim());
  if (f.kind) p.set('kind', f.kind);
  return p;
}

type AuditSchool = { id: number; name: string; code?: string | null };

export function NfcScanAuditPage() {
  const [f, setF] = useState<AuditFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [assign, setAssign] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const polls = useRef(0);
  const [pollingStopped, setPollingStopped] = useState(false);
  const params = buildAuditParams(f, page);
  const set = (k: keyof AuditFilters, v: string) => { setF(prev => ({ ...prev, [k]: v })); setPage(1); polls.current = 0; setPollingStopped(false); };
  const schools = useQuery({
    queryKey: ['nfc-scan-audit-school-options'],
    queryFn: () => customFetch<{ schools: AuditSchool[] }>('/api/platform/schools/directory?status=all'),
    staleTime: 60_000,
  });
  const devices = useQuery({
    queryKey: ['nfc-scan-audit-device-options'],
    queryFn: () => customFetch<PlatformDevice[]>('/api/platform/devices'),
    staleTime: 60_000,
  });
  const schoolOptions = (schools.data?.schools ?? []).map(school => ({
    value: String(school.id), label: `${school.name}${school.code ? ` · ${school.code}` : ''} (#${school.id})`,
  })).sort((a, b) => a.label.localeCompare(b.label));
  const deviceOptions = (devices.data ?? []).filter(device => !f.schoolId || String(device.schoolId) === f.schoolId)
    .map(device => ({ value: String(device.id),
      label: `${device.name || 'Unnamed device'} (#${device.id})${device.serialNumber ? ` · ${device.serialNumber}` : ''}${device.schoolName ? ` · ${device.schoolName}` : device.schoolId == null ? ' · No school / Owner hardware' : ''}`,
    })).sort((a, b) => a.label.localeCompare(b.label));
  const selectSchool = (schoolId: string) => {
    // Clear a device that no longer belongs to the chosen school atomically:
    // never issue a transient mismatched school/device audit request.
    const device = devices.data?.find(device => String(device.id) === f.deviceId);
    const deviceId = !schoolId || String(device?.schoolId) === schoolId ? f.deviceId : '';
    setF(prev => ({ ...prev, schoolId, deviceId }));
    setPage(1); polls.current = 0; setPollingStopped(false);
  };

  const audit = useQuery({
    queryKey: [...nfcScanAuditKey, params.toString()],
    queryFn: () => customFetch<OwnerUidInventory>(`/api/platform/uid-inventory?${params}`),
    refetchInterval: () => {
      if (pollingStopped) return false;
      polls.current += 1;
      if (polls.current > MAX_POLLS) { setTimeout(() => setPollingStopped(true), 0); return false; }
      return POLL_MS;
    },
  });
  const rows: NfcScanAuditRow[] = audit.data?.rows ?? [];
  const total = audit.data?.total ?? 0;
  const scanTotal = audit.data?.scanTotal;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.entries(f).some(([k, v]) => k === 'kind' ? v !== 'SCAN' : !!v);

  const exportCsv = async () => {
    setExporting(true); setExportError('');
    try {
      const csvParams = buildAuditParams(f, 1); csvParams.delete('page'); csvParams.delete('pageSize'); csvParams.set('format', 'CSV');
      const text = await customFetch<string>(`/api/platform/uid-inventory?${csvParams}`, { responseType: 'text' });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `nfc-scan-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      const status = (e as any)?.status;
      setExportError(status === 409 ? 'Export exceeds the 5,000-row limit. Narrow the date range or filters, then export again.' : `Export failed: ${backendError(e)}`);
    } finally { setExporting(false); }
  };

  return <div className="fade-up">
    <PageHeading eyebrow="Platform Owner / NFC hardware" title="NFC Card Scan Audit"
      description="Reports EduCore received from authenticated readers. Only reports that reached EduCore appear here; taps a reader never delivered cannot be recovered."
      action={<Link href="/card-uid-inventory" className="text-sm font-bold underline" data-testid="link-uid-inventory">Open Card UID Inventory</Link>} />

    <div className="mb-6 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
      <div className="panel p-5" data-testid="stat-scan-total">
        <p className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Received card scans</p>
        <p className="display-font mt-1 font-mono text-3xl font-bold">{audit.isLoading ? '...' : (scanTotal ?? 0).toLocaleString('en-NG')}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Excludes retries, heartbeats and errors</p>
      </div>
      <div className="panel p-5" data-testid="stat-row-total">
        <p className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Matching audit rows</p>
        <p className="display-font mt-1 font-mono text-3xl font-bold">{audit.isLoading ? '...' : total.toLocaleString('en-NG')}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Rows are received reports, not proof of every physical tap</p>
      </div>
      <div className="panel flex flex-col justify-center gap-2 p-5">
        <Button variant="outline" testId="button-export-csv" disabled={exporting} onClick={() => void exportCsv()}><Download size={15} className="mr-1 inline" />{exporting ? 'Exporting...' : 'Export CSV'}</Button>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Restricted, current filters, max 5,000 rows</p>
      </div>
    </div>
    {exportError && <p role="alert" className="mb-4 text-sm font-medium text-[hsl(var(--destructive))]" data-testid="text-export-error">{exportError}</p>}

    <section className="panel overflow-hidden" aria-label="NFC scan audit rows">
      <div className="border-b border-[hsl(var(--border))] p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Card UID
            <span className="relative mt-1 block"><Search className="absolute left-3 top-3" size={16} />
              <input aria-label="Search UID" data-testid="input-audit-q" className="w-full pl-9" maxLength={128} value={f.q} placeholder="UID" onChange={e => set('q', e.target.value)} /></span>
          </label>
          <AuditFilterSelect label="School" value={f.schoolId} options={schoolOptions} allLabel="All schools"
            loading={schools.isPending} error={schools.isError} onRetry={() => void schools.refetch()} onChange={selectSchool} />
          <AuditFilterSelect key={f.schoolId} label="Device" value={f.deviceId} options={deviceOptions} allLabel="All devices"
            loading={devices.isPending} error={devices.isError} onRetry={() => void devices.refetch()} onChange={value => set('deviceId', value)} />
          <label className="text-sm">Registration
            <select aria-label="Registration" data-testid="select-audit-registration" className="mt-1 w-full" value={f.registration} onChange={e => set('registration', e.target.value)}>
              <option value="">Any registration</option><option value="REGISTERED">Registered</option><option value="UNREGISTERED">Pending Registration</option><option value="UNAVAILABLE">Unavailable</option>
            </select>
          </label>
          <label className="text-sm">From
            <input aria-label="From" data-testid="input-audit-from" type="datetime-local" className="mt-1 w-full" value={f.from} onChange={e => set('from', e.target.value)} />
          </label>
          <label className="text-sm">To
            <input aria-label="To" data-testid="input-audit-to" type="datetime-local" className="mt-1 w-full" value={f.to} onChange={e => set('to', e.target.value)} />
          </label>
          <label className="text-sm">Reader source
            <select aria-label="Source" data-testid="select-audit-source" className="mt-1 w-full" value={f.source} onChange={e => set('source', e.target.value)}>
              <option value="">School and Owner readers</option><option value="SCHOOL">School reader</option><option value="OWNER">Owner reader</option>
            </select>
          </label>
          <label className="text-sm">Result
            <input aria-label="Result" data-testid="input-audit-result" className="mt-1 w-full" maxLength={64} value={f.result} placeholder="e.g. CARD_INELIGIBLE" onChange={e => set('result', e.target.value)} />
          </label>
        </div>
        <details className="mt-4 text-sm" open={f.kind !== 'SCAN'}>
          <summary className="cursor-pointer font-bold">Diagnostic filters</summary>
          <label className="mt-2 block max-w-xs text-sm">Report kind
            <select aria-label="Kind" data-testid="select-audit-kind" className="mt-1 w-full" value={f.kind} onChange={e => set('kind', e.target.value)}>
              <option value="SCAN">Card scans only (recommended)</option><option value="">All report kinds</option><option value="RETRY">Transport retries</option><option value="HEARTBEAT">Heartbeats</option><option value="MALFORMED">Malformed reports</option><option value="ERROR">Error reports</option>
            </select>
          </label>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
          <span data-testid="text-polling">{pollingStopped ? 'Auto-refresh paused after 5 minutes.' : 'Refreshes every 5 seconds for up to 5 minutes.'}</span>
          {pollingStopped && <Button variant="quiet" testId="button-resume-refresh" onClick={() => { polls.current = 0; setPollingStopped(false); void audit.refetch(); }}>Refresh now</Button>}
          {filtered && <Button variant="quiet" testId="button-clear-filters" onClick={() => { setF(emptyFilters); setPage(1); }}>Clear filters</Button>}
        </div>
      </div>

      {audit.isError && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border))] p-5 text-sm text-[hsl(var(--destructive))]" data-testid="text-audit-error">
        Scan audit could not be loaded: {backendError(audit.error)}
        <Button variant="outline" testId="button-retry-audit" onClick={() => void audit.refetch()}>Retry</Button>
      </div>}

      {audit.isLoading ? <div role="status" aria-label="Loading scan audit" className="space-y-3 p-5">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />)}
      </div> : rows.length ? <ul className="divide-y divide-[hsl(var(--border))]">
        {rows.map(row => {
          const canRegister = row.kind === 'SCAN' && row.registration === 'UNREGISTERED' && !!row.uid && VALID_UID.test(row.uid);
          return <li key={row.id} className="grid gap-3 p-5 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-center" data-testid={`row-audit-${row.id}`}>
            <div className="min-w-0">
              <p className="select-all break-all font-mono text-base font-bold" data-testid={`text-audit-uid-${row.id}`}>{row.uid ?? 'No UID reported'}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold">
                <span className={`rounded-full px-2 py-0.5 ${regTone[row.registration] ?? regTone.UNAVAILABLE}`} data-testid={`status-audit-registration-${row.id}`}>{regLabel[row.registration] ?? row.registration}</span>
                <span className="rounded-full bg-[hsl(var(--primary)/.08)] px-2 py-0.5">{kindLabel[row.kind] ?? row.kind}</span>
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5">{row.source === 'OWNER' ? 'Owner reader' : 'School reader'}</span>
              </div>
            </div>
            <dl className="min-w-0 text-sm">
              <dt className="text-xs text-[hsl(var(--muted-foreground))]">Reader / school</dt>
              <dd className="break-words">{row.deviceName ?? `Device #${row.deviceId}`} <span className="text-xs">(ID {row.deviceId})</span></dd>
              <dd className="break-words text-xs">{row.schoolName ? `${row.schoolName} (ID ${row.schoolId})` : row.schoolId ? `School ID ${row.schoolId}` : 'No school'}</dd>
            </dl>
            <dl className="min-w-0 text-sm">
              <dt className="text-xs text-[hsl(var(--muted-foreground))]">Received</dt><dd>{time(row.receivedAt)}</dd>
              <dd className="text-xs">Reader time: {time(row.occurredAt)}</dd>
              <dd className="break-all font-mono text-xs" data-testid={`text-audit-outcome-${row.id}`}>{row.outcome}{row.reason ? ` · ${row.reason}` : ''}</dd>
            </dl>
            <div>{canRegister && <Button variant="outline" testId={`button-add-registration-${row.id}`} onClick={() => setAssign(row.uid!)}>Add to Registration</Button>}</div>
          </li>;
        })}
      </ul> : !audit.isError && <EmptyState icon={Radio} title={filtered ? 'No matching reports' : 'No card scans received yet'}
        description={filtered ? 'Change or clear the filters to see other received reports.' : 'When an authenticated reader delivers a card scan to EduCore it appears here. Reports a reader never delivered cannot be shown.'} />}

      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm" data-testid="text-audit-page">Page {page} of {pages}</p>
        <div className="flex gap-2">
          <Button variant="outline" testId="button-audit-prev" disabled={page === 1 || audit.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <Button variant="outline" testId="button-audit-next" disabled={page >= pages || audit.isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </section>
    {assign && <AssignUidModal uid={assign} onClose={() => setAssign(null)} />}
  </div>;
}
