import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Download, FileSearch, ShieldAlert } from 'lucide-react';
import {
  usePreviewStudentNfcReconciliation, getPreviewStudentNfcReconciliationQueryKey, useGetAuthorizedContext,
  type StudentNfcReconciliationReport, type StudentNfcReconciliationRow,
} from '@workspace/api-client-react';
import { Button, money } from '@/components/shared';

const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const input = 'mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 tabular-nums';
const ngn = (m: number | null | undefined) => (m == null ? 'Unknown' : money(m / 100));

export const STATUS_META: Record<StudentNfcReconciliationRow['status'], { label: string; detail: string; tone: string }> = {
  CANDIDATE_AFTER_REVIEW: { label: 'Candidate after review', detail: 'Not migration approval. Requires separate explicit review.', tone: 'border-[hsl(var(--primary)/.4)] bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]' },
  NEW_OBLIGATION_AFTER_REVIEW: { label: 'New obligation after review', detail: 'Not migration approval. No obligation is created by this preview.', tone: 'border-[hsl(var(--primary)/.4)] bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))]' },
  OWNER_REVIEW: { label: 'Owner review required', detail: 'Ambiguous, missing or conflicting evidence. Never treated as safe.', tone: 'border-[hsl(35_83%_53%/.5)] bg-[hsl(35_83%_53%/.12)] text-[hsl(28_73%_35%)]' },
  PRESERVE_COMPLETED_HISTORY: { label: 'Preserve completed history', detail: 'Completed payment history must stay unchanged.', tone: 'border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' },
};

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s.trimStart()) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function reportToCsv(r: StudentNfcReconciliationReport): string {
  const meta = [
    ['readOnly', 'true'], ['migrationApproved', 'false'], ['schoolId', r.schoolId], ['schoolName', r.schoolName],
    ['termId', r.termId], ['termName', r.termName], ['generatedAt', r.generatedAt], ['evidenceDigest', r.evidenceDigest],
    ['sourceStatus', r.sourceStatus], ['proposedPlatformAmountMinor', r.platformAmountMinor],
    ['reportVersion', r.reportVersion], ['academicSessionId', r.academicSessionId],
    ['termStart', r.termStart], ['termEnd', r.termEnd], ['warnings', r.warnings.join('; ')],
    ...r.sources.map(s=>[`source:${s.name}`,s.complete?'COMPLETE':'INCOMPLETE',s.recordCount,s.issues.join('; ')]),
  ];
  const head = ['studentId', 'studentName', 'admissionNo', 'status', 'reasons', 'subscriptionIds', 'originalAmountMinor', 'originalOutstandingMinor',
    'proposedPlatformAmountMinor', 'invoiceIds', 'schoolFeeTotalMinor', 'schoolFeePaidMinor', 'schoolFeeOutstandingMinor', 'paymentReferences', 'receiptNumbers', 'evidenceDigest'];
  const rows = r.rows.map(x => [x.studentId, x.studentName, x.admissionNo, x.status, x.reasons.join('; '), x.subscriptionIds.join(' '),
    x.originalAmountMinor, x.originalOutstandingMinor, x.proposedPlatformAmountMinor, x.invoiceIds.join(' '), x.schoolFeeTotalMinor,
    x.schoolFeePaidMinor, x.schoolFeeOutstandingMinor, x.paymentReferences.join(' '), x.receiptNumbers.join(' '), x.evidenceDigest]);
  return [...meta, [], head, ...rows].map(l => l.map(csvCell).join(',')).join('\r\n');
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const reconciliationScopeId = (s: string) => (/^\d+$/.test(s.trim()) && Number.isSafeInteger(Number(s)) && Number(s) >= 1 ? Number(s) : null);

export function StudentNfcReconciliation({ defaultSchoolId }: { defaultSchoolId: number | null }) {
  const actorId = useGetAuthorizedContext().data?.user?.id ?? null;
  const [school, setSchool] = useState(defaultSchoolId ? String(defaultSchoolId) : '');
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState<{ schoolId: number; termId: number; actorId: number | null; attempt: number } | null>(null);
  const previewSequence=useRef(0);

  // Tenant or actor change invalidates any displayed report.
  useEffect(() => { setSchool(defaultSchoolId ? String(defaultSchoolId) : ''); setScope(null); }, [defaultSchoolId]);
  useEffect(() => { setScope(null); }, [actorId]);

  const schoolId = reconciliationScopeId(school), termId = reconciliationScopeId(term);
  const params = { schoolId: scope?.schoolId ?? 0, termId: scope?.termId ?? 0 };
  const q = usePreviewStudentNfcReconciliation(params, { query: {
    enabled: !!scope && scope.actorId===actorId && actorId != null,
    queryKey: [...getPreviewStudentNfcReconciliationQueryKey(params), 'actor', actorId, 'preview', scope?.attempt],
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus:false, refetchOnReconnect:false,
  } });
  const r = scope && scope.actorId===actorId && !q.isFetching && !q.isError && q.data && q.data.schoolId === scope.schoolId && q.data.termId === scope.termId ? q.data : null;
  const unsafe = !!r && (r.sourceStatus !== 'COMPLETE' || r.sources.some(s => !s.complete || s.issues.length > 0) || r.warnings.length > 0);

  return (
    <section className="panel p-5" data-testid="nfc-reconciliation">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch size={18} />
        <h2 className="display-font text-lg font-bold">Student NFC reconciliation preview</h2>
        <span className="rounded-md border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">Read-only</span>
      </div>
      <p className={`mt-1 ${note}`}>Compares legacy NFC subscriptions with the proposed platform charge for one school and term. It does not migrate, reprice, create payments, change cards or contact any provider. There is no apply action.</p>
      <div role="note" className="mt-3 flex gap-2 rounded-xl border border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.08)] p-3 text-xs" data-testid="text-approval-required">
        <ShieldAlert size={16} className="shrink-0" />
        <span>Any actual migration requires a separate explicit review and approval, and fresh revalidation against current records. Statuses here are not approval.</span>
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); if (schoolId && termId) setScope({ schoolId, termId, actorId, attempt:++previewSequence.current }); }}>
        <label className="block text-sm"><span className="font-semibold">School ID</span>
          <input inputMode="numeric" className={input} value={school} onChange={e => { setSchool(e.target.value); setScope(null); }} data-testid="input-recon-school" /></label>
        <label className="block text-sm"><span className="font-semibold">Term ID</span>
          <input inputMode="numeric" className={input} value={term} onChange={e => { setTerm(e.target.value); setScope(null); }} data-testid="input-recon-term" /></label>
        <Button type="submit" disabled={!schoolId || !termId || actorId == null || q.isFetching} testId="button-recon-preview">{q.isFetching ? 'Loading preview...' : 'Preview'}</Button>
      </form>
      {(school || term) && (!schoolId || !termId) && <p className={`mt-2 ${note}`}>Enter positive whole numbers for both school and term.</p>}

      {scope && q.isFetching && !r && <div className="mt-4 h-32 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />}
      {scope && q.isError && <div role="alert" className="mt-4 rounded-xl border border-[hsl(var(--destructive)/.3)] p-3 text-sm text-[hsl(var(--destructive))]">
        Preview could not be loaded. <button className="underline" onClick={() => void q.refetch()} data-testid="button-recon-retry">Retry</button></div>}

      {r && (
        <div className="mt-5 space-y-4" data-testid="recon-report">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className={note}>School</dt><dd className="font-bold">{r.schoolName} (ID {r.schoolId})</dd></div>
            <div><dt className={note}>Term</dt><dd className="font-bold">{r.termName} (ID {r.termId})</dd></div>
            <div><dt className={note}>Generated</dt><dd className="font-bold">{new Date(r.generatedAt).toLocaleString('en-NG')}</dd></div>
            <div><dt className={note}>Proposed platform charge, per student</dt><dd className="font-bold tabular-nums" data-testid="text-proposed-amount">{ngn(r.platformAmountMinor)}</dd></div>
          </dl>
          <p className={note}>Evidence digest <span className="break-all font-mono" data-testid="text-recon-digest">{r.evidenceDigest}</span> · version {r.reportVersion}</p>
          <div className="grid gap-2 text-sm sm:grid-cols-4" data-testid="recon-summary">
            {([['Candidates after review', r.summary.candidates], ['New obligations after review', r.summary.newObligations], ['Owner review', r.summary.ownerReview], ['Preserved history', r.summary.preserved]] as const).map(([l, v]) =>
              <div key={l} className="rounded-lg bg-[hsl(var(--muted)/.4)] p-3"><div className={note}>{l}</div><div className="font-bold tabular-nums">{v}</div></div>)}
          </div>
          {unsafe && <div role="alert" className="rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-3 text-sm" data-testid="recon-incomplete">
            <div className="flex items-center gap-2 font-bold text-[hsl(var(--destructive))]"><CircleAlert size={16} />Evidence is incomplete or has warnings. Nothing in this report is safe to act on.</div>
            {r.warnings.length > 0 && <ul className="mt-2 list-disc pl-5">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>}
          <div>
            <h3 className="text-sm font-bold">Sources ({r.sourceStatus.toLowerCase()})</h3>
            <ul className="mt-1 space-y-1 text-xs">{r.sources.map(s => <li key={s.name}>
              <span className="font-semibold">{s.name}</span>: {s.complete ? 'complete' : 'INCOMPLETE'} · {s.recordCount} records read{s.issues.length > 0 && ` · ${s.issues.join('; ')}`}</li>)}</ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download(`nfc-reconciliation-${r.schoolId}-${r.termId}.csv`, reportToCsv(r), 'text/csv')} testId="button-recon-csv"><Download size={14} />CSV</Button>
            <Button variant="outline" onClick={() => download(`nfc-reconciliation-${r.schoolId}-${r.termId}.json`, JSON.stringify(r, null, 2), 'application/json')} testId="button-recon-json"><Download size={14} />JSON</Button>
          </div>
          {r.rows.length === 0 ? <p className={note}>No students in scope.</p> : <div className="divide-y divide-[hsl(var(--border)/.6)] rounded-xl border border-[hsl(var(--border))]">
            {r.rows.map(x => { const m = STATUS_META[x.status]; return (
              <div key={x.studentId} className="p-4 text-xs" data-testid={`recon-row-${x.studentId}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><div className="text-sm font-bold">{x.studentName}</div><div className={note}>Student {x.studentId} · {x.admissionNo}</div></div>
                  <div className={`rounded-lg border px-2 py-1 text-right ${m.tone}`}><div className="font-bold uppercase tracking-wide">{m.label}</div><div className="text-[11px]">{m.detail}</div></div>
                </div>
                {x.reasons.length > 0 && <ul className="mt-2 list-disc pl-5">{x.reasons.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-[hsl(var(--muted)/.35)] p-2"><div className="font-bold">Legacy subscription</div>
                    <div>IDs {x.subscriptionIds.join(', ') || 'none'}</div><div>Original {ngn(x.originalAmountMinor)}</div><div>Outstanding {ngn(x.originalOutstandingMinor)}</div></div>
                  <div className="rounded-lg border border-[hsl(var(--primary)/.3)] p-2"><div className="font-bold">Proposed platform charge</div>
                    <div className="tabular-nums">{ngn(x.proposedPlatformAmountMinor)}</div><div className={note}>Proposal only. Not charged.</div></div>
                  <div className="rounded-lg bg-[hsl(var(--muted)/.35)] p-2"><div className="font-bold">School-facing invoices (separate)</div>
                    <div>IDs {x.invoiceIds.join(', ') || 'none'}</div><div>Total {ngn(x.schoolFeeTotalMinor)} · Paid {ngn(x.schoolFeePaidMinor)}</div><div>Outstanding {ngn(x.schoolFeeOutstandingMinor)}</div></div>
                </div>
                <div className={`mt-2 ${note}`}>Refs: <span className="font-mono">{x.paymentReferences.join(', ') || 'none'}</span> · Receipts: <span className="font-mono">{x.receiptNumbers.join(', ') || 'none'}</span> · Digest <span className="break-all font-mono">{x.evidenceDigest}</span></div>
              </div>); })}
          </div>}
        </div>
      )}
    </section>
  );
}
