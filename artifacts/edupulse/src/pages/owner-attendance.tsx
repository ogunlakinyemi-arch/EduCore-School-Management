import { useState } from 'react';
import { ClipboardCheck, Download } from 'lucide-react';
import {
  useListOwnerSchoolDirectory, getListOwnerSchoolDirectoryQueryKey,
  useListOwnerAttendanceClasses, getListOwnerAttendanceClassesQueryKey,
  useGetOwnerAttendanceRecords, getGetOwnerAttendanceRecordsQueryKey, getOwnerAttendanceRecords,
} from '@workspace/api-client-react';
import type { OwnerAttendanceReport } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, PageHeading } from '@/components/shared';

type Evidence = OwnerAttendanceReport['rows'][number]['gateEntries'][number];
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const lagosDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const lagos = (v: string | null) => v ? new Date(v).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'medium' }) : 'Not recorded';
const sourceLabel = (s: string) => s === 'NFC_GATE_AUTO' ? 'NFC_GATE_AUTO (provisional gate-derived, not biometric)' : s === 'FINGERPRINT' ? 'FINGERPRINT' : s === 'MANUAL' ? 'MANUAL' : s;

function EvidenceList({ items, testId }: { items: Evidence[]; testId: string }) {
  if (!items.length) return <span data-testid={testId}>Not recorded</span>;
  return <ul className="space-y-1.5" data-testid={testId}>{items.map(e => (
    <li key={e.eventId} className="text-xs">
      <div className="font-semibold">{lagos(e.at)}</div>
      <div className="text-[hsl(var(--muted-foreground))]">{e.eventType} · {sourceLabel(e.source)} · {e.status} · {e.result}</div>
    </li>))}</ul>;
}
const firstEntry = (r: OwnerAttendanceReport['rows'][number]) => r.gateEntries.map(e => e.at).filter((x): x is string => !!x).sort()[0] ?? null;
const lastExit = (r: OwnerAttendanceReport['rows'][number]) => r.gateExits.map(e => e.at).filter((x): x is string => !!x).sort().slice(-1)[0] ?? null;

export function OwnerAttendancePage() {
  const today = lagosDay(Date.now());
  const [schoolId, setSchoolId] = useState('');
  const [type, setType] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(lagosDay(Date.now() - 6 * DAY));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const locked = exporting;

  const directory = useListOwnerSchoolDirectory({ status: 'all' }, { query: { queryKey: getListOwnerSchoolDirectoryQueryKey({ status: 'all' }) } });
  const sid = Number(schoolId) || 0;
  const classes = useListOwnerAttendanceClasses({ schoolId: sid }, { query: { enabled: sid > 0 && type === 'STUDENT', queryKey: getListOwnerAttendanceClassesQueryKey({ schoolId: sid }) } });
  const cid = Number(classId) || 0;
  const span = (Date.parse(to) - Date.parse(from)) / DAY;
  const rangeValid = !!from && !!to && span >= 0 && span <= 30;
  const ready0 = sid > 0 && type === 'STUDENT';
  const ready = !directory.isError && !(type === 'STUDENT' && classes.isError) && sid > 0 && rangeValid && (type === 'TEACHER' || cid > 0);
  const params = { schoolId: sid, type, ...(type === 'STUDENT' ? { classId: cid } : {}), from, to, page, pageSize, format: 'JSON' as const };
  const records = useGetOwnerAttendanceRecords(params, { query: { enabled: ready, queryKey: getGetOwnerAttendanceRecordsQueryKey(params) } });
  const rawReport = records.data;
  const dirFailed = directory.isError || (ready0 && classes.isError);
  const report = (typeof rawReport === 'object' && rawReport && rawReport.school?.id === sid && rawReport.type === type && rawReport.from === from && rawReport.to === to
    && (type === 'TEACHER' ? !rawReport.class : rawReport.class?.id === cid)) ? rawReport as OwnerAttendanceReport : undefined;
  const schools = directory.data?.schools ?? [];
  const reset = () => { setPage(1); setExportError(''); };
  const totalPages = report ? Math.max(1, Math.ceil(report.total / report.pageSize)) : 1;

  const exportCsv = async () => {
    setExporting(true); setExportError('');
    try {
      const { page: _p, pageSize: _s, ...scope } = params;
      const csv = await getOwnerAttendanceRecords({ ...scope, format: 'CSV' });
      if (typeof csv !== 'string') throw new Error('not csv');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `attendance-${type.toLowerCase()}-${sid}-${from}-${to}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setExportError('Export failed. Narrow the filters (limit 5,000 rows) and retry. Nothing was truncated.'); }
    finally { setExporting(false); }
  };

  return (
    <div className="fade-up">
      <PageHeading eyebrow="Platform / Attendance" title="Attendance monitor" description="Read-only daily attendance evidence for any school. Nothing here can be created, corrected or deleted." />
      <div className="panel mb-5 space-y-2 p-4 text-sm" data-testid="text-attendance-notes">
        <p>Gate entries and exits are accepted NFC taps, listed separately. Classroom evidence may be provisional NFC_GATE_AUTO (derived from a gate tap, never biometric), MANUAL, or actual FINGERPRINT. Every tap stays visible and no time or absence is inferred: missing evidence shows Not recorded. Times are Africa/Lagos.</p>
        <p>Historical rosters come from recorded class assignments and snapshots; the current profile is used as a fallback for today only.</p>
      </div>
      <div className="panel mb-5 flex flex-wrap items-end gap-4 p-5">
        <label className="flex flex-col gap-1 text-xs font-semibold">School
          <select aria-label="School" value={schoolId} disabled={directory.isLoading || locked} onChange={e => { setSchoolId(e.target.value); setClassId(''); reset(); }}>
            <option value="">Select a school</option>
            {schools.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Person type
          <select aria-label="Person type" value={type} disabled={locked} onChange={e => { setType(e.target.value as 'STUDENT' | 'TEACHER'); setClassId(''); reset(); }}>
            <option value="STUDENT">Student</option><option value="TEACHER">Teacher</option>
          </select></label>
        {type === 'STUDENT' && <label className="flex flex-col gap-1 text-xs font-semibold">Class
          <select aria-label="Class" value={classId} disabled={!sid || classes.isLoading || locked} onChange={e => { setClassId(e.target.value); reset(); }}>
            <option value="">{sid ? 'Select a class' : 'Select a school first'}</option>
            {(classes.data ?? []).map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select></label>}
        <label className="flex flex-col gap-1 text-xs font-semibold">From
          <input type="date" aria-label="From" value={from} disabled={locked} max={to || undefined} onChange={e => { setFrom(e.target.value); reset(); }} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">To
          <input type="date" aria-label="To" value={to} disabled={locked} onChange={e => { setTo(e.target.value); reset(); }} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Rows per page
          <select aria-label="Rows per page" value={pageSize} disabled={locked} onChange={e => { setPageSize(Number(e.target.value)); reset(); }}>
            {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <Button variant="outline" testId="button-export-csv" disabled={!ready || exporting || !report || records.isLoading || records.isError} onClick={() => void exportCsv()}>
          <Download size={15} />{exporting ? 'Preparing CSV…' : 'Export CSV (selected filters)'}</Button>
      </div>
      {!rangeValid && <p role="alert" className="mb-4 text-sm text-[hsl(var(--destructive))]">Choose a valid date range of at most 31 days.</p>}
      {exportError && <p role="alert" className="mb-4 text-sm text-[hsl(var(--destructive))]">{exportError}</p>}
      {dirFailed && <ErrorState retry={() => { void directory.refetch(); void classes.refetch(); }} message="Schools or classes could not be loaded. Retry before querying or exporting." />}
      {dirFailed ? null : !ready ? <div className="panel"><EmptyState icon={ClipboardCheck} title="Choose filters" description={type === 'STUDENT' ? 'Select a school, a class and a date range to view attendance.' : 'Select a school and a date range to view teacher gate attendance.'} /></div>
        : records.isLoading || !report ? <div className="panel p-8 text-sm" role="status">Loading attendance records…</div>
        : records.isError || (!report && !records.isFetching) ? <ErrorState retry={() => void records.refetch()} message="Attendance records could not be loaded." />
        : <div className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-4 text-xs" data-testid="text-report-scope">
            {report.school.name}{report.class ? ` · ${report.class.name}` : ''} · {report.type} · {report.from} to {report.to} · {report.timeZone} · {report.total} rows
            {type === 'TEACHER' && <div className="mt-1">Time in / Time out are derived from the first gate entry and last gate exit only. They are not separate clock records.</div>}
          </div>
          {report.rows.length === 0 ? <EmptyState icon={ClipboardCheck} title="No rows" description="No people matched these filters." /> :
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
            <thead><tr className="text-xs uppercase">
              <th scope="col" className="p-3">Name</th><th scope="col" className="p-3">Identifier</th><th scope="col" className="p-3">Date</th>
              <th scope="col" className="p-3">Entry Tag-in</th><th scope="col" className="p-3">Exit Tag-out</th>
              {type === 'TEACHER' ? <><th scope="col" className="p-3">Time in (first Entry Tag-in)</th><th scope="col" className="p-3">Time out (last Exit Tag-out)</th></> : <th scope="col" className="p-3">Classroom</th>}
              <th scope="col" className="p-3">Anomalies</th><th scope="col" className="p-3">Status</th></tr></thead>
            <tbody>{report.rows.map(r => (
              <tr key={`${r.personId}-${r.date}`} className="border-t border-[hsl(var(--border)/.6)] align-top" data-testid={`row-attendance-${r.personId}-${r.date}`}>
                <th scope="row" className="p-3 font-semibold">{r.name}</th><td className="p-3">{r.identifier}</td><td className="p-3">{r.date}</td>
                <td className="p-3"><EvidenceList items={r.gateEntries} testId={`gate-entries-${r.personId}-${r.date}`} /></td>
                <td className="p-3"><EvidenceList items={r.gateExits} testId={`gate-exits-${r.personId}-${r.date}`} /></td>
                {type === 'TEACHER' ? <><td className="p-3">{lagos(firstEntry(r))}</td><td className="p-3">{lagos(lastExit(r))}</td></> : <td className="p-3"><EvidenceList items={r.classroom} testId={`classroom-${r.personId}-${r.date}`} /></td>}
                <td className="p-3 text-xs">{r.anomalies.length ? r.anomalies.join(', ') : 'None'}</td><td className="p-3">{r.status}</td>
              </tr>))}</tbody></table></div>}
          <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] p-4 text-xs">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span data-testid="text-page">Page {report.page} of {totalPages}</span>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>}
    </div>
  );
}
