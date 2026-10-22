import { useEffect, useRef, useState } from 'react';
import { useGetAuthorizedContext, usePreviewFlutterwaveLiveEvidence } from '@workspace/api-client-react';
import type { LiveEvidencePreviewReport } from '@workspace/api-client-react';

export const MAX_EVIDENCE_BYTES = 16 * 1024;
const SCOPE = /^[A-Za-z0-9_-]{8,80}$/;
const posInt = (v: string) => /^[1-9]\d*$/.test(v.trim()) && Number.isSafeInteger(Number(v));

export function parseEvidence(text: string): { value?: Record<string, unknown>; error?: string } {
  if (new TextEncoder().encode(text).length > MAX_EVIDENCE_BYTES) return { error: 'Evidence exceeds the 16 KB limit.' };
  if (!text.trim()) return { error: 'Paste metadata-only evidence JSON.' };
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Evidence must be a JSON object.' };
    return { value: v as Record<string, unknown> };
  } catch { return { error: 'Evidence is not valid JSON.' }; }
}

const field = 'w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm';

export default function LiveReadinessPage() {
  const ctx = useGetAuthorizedContext();
  const preview = usePreviewFlutterwaveLiveEvidence();
  const [scope, setScope] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [evidence, setEvidence] = useState('');
  const [fileError, setFileError] = useState('');
  const [report, setReport] = useState<LiveEvidencePreviewReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  useEffect(() => () => { gen.current += 1; }, []);
  useEffect(() => {
    gen.current += 1;
    setReport(null); setError(''); setFileError(''); setBusy(false);
    setScope(''); setSchoolId(''); setReviewId(''); setEvidence('');
  }, [ctx.isLoading, ctx.data?.isPlatformOwner, ctx.data?.user?.id]);

  if (ctx.isLoading) return <div data-testid="live-readiness-loading" className="text-sm">Checking access...</div>;
  if (ctx.data?.isPlatformOwner !== true) return <div data-testid="live-readiness-denied" role="alert" className="text-sm font-bold">Owner access is required.</div>;

  const invalidate = () => { gen.current += 1; setReport(null); setError(''); setBusy(false); };
  const parsed = parseEvidence(evidence);
  const problems = [
    !SCOPE.test(scope) && 'Merchant scope must be 8-80 letters, digits, underscore or hyphen.',
    !posInt(schoolId) && 'School ID must be a positive integer.',
    !posInt(reviewId) && 'Review ID must be a positive integer.',
    parsed.error,
  ].filter(Boolean) as string[];
  const dirty = scope !== '' || schoolId !== '' || reviewId !== '' || evidence !== '';

  const onFile = async (file: File | undefined) => {
    invalidate();
    const mine = gen.current;
    setFileError('');
    setEvidence('');
    if (!file) return;
    if (file.size > MAX_EVIDENCE_BYTES) { setFileError('File exceeds the 16 KB limit; it was not imported.'); return; }
    try {
      const text = await file.text();
      if (mine !== gen.current) return;
      const p = parseEvidence(text);
      if (p.error) { setFileError(p.error); return; }
      setEvidence(text);
    } catch {
      if (mine === gen.current) setFileError('File could not be read; nothing was imported.');
    }
  };

  const submit = async () => {
    if (problems.length || !parsed.value) return;
    const mine = ++gen.current;
    setReport(null); setError(''); setBusy(true);
    try {
      const r = await preview.mutateAsync({ data: { merchantScope: scope, schoolId: Number(schoolId), reviewId: Number(reviewId), authorityEvidence: parsed.value } });
      if (mine !== gen.current) return;
      setReport(r); setBusy(false);
    } catch {
      if (mine !== gen.current) return;
      setError('Preview failed. Nothing was saved or approved. Check the inputs and retry.'); setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="live-readiness-page">
      <div>
        <h1 className="text-xl font-bold">Flutterwave LIVE evidence preview</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Validation only. Nothing is approved, saved or activated, and no payment is created. Provide metadata only: no original artifacts, banking data, keys or credentials.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-bold">Merchant scope<input data-testid="input-merchant-scope" className={field} value={scope} autoComplete="off" onChange={e => { invalidate(); setScope(e.target.value); }} /></label>
        <label className="text-sm font-bold">School ID<input data-testid="input-school-id" className={field} value={schoolId} inputMode="numeric" onChange={e => { invalidate(); setSchoolId(e.target.value); }} /></label>
        <label className="text-sm font-bold">Review ID<input data-testid="input-review-id" className={field} value={reviewId} inputMode="numeric" onChange={e => { invalidate(); setReviewId(e.target.value); }} /></label>
      </div>
      <label className="block text-sm font-bold">Authority evidence (JSON, max 16 KB)
        <textarea data-testid="input-evidence" rows={8} className={`${field} font-mono`} value={evidence} onChange={e => { invalidate(); setFileError(''); setEvidence(e.target.value); }} />
      </label>
      <label className="block text-sm font-bold">Or import a local JSON file (read in this browser only)
        <input data-testid="input-evidence-file" type="file" accept="application/json,.json" className="mt-1 block text-sm" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {fileError && <div data-testid="text-file-error" role="alert" className="text-sm font-bold">{fileError}</div>}
      {dirty && problems.length > 0 && <ul data-testid="list-validation" className="list-disc pl-5 text-sm">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <button data-testid="button-preview" disabled={busy || problems.length > 0} onClick={() => void submit()} className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50">
        {busy ? 'Validating...' : 'Run preview'}
      </button>
      {error && <div data-testid="text-error" role="alert" className="text-sm font-bold">{error}</div>}
      {report && <Report r={report} />}
    </div>
  );
}

function Report({ r }: { r: LiveEvidencePreviewReport }) {
  const p = r.policy;
  return (
    <section data-testid="report" className="space-y-4 rounded-md border border-[hsl(var(--border))] p-4 text-sm">
      <div data-testid="text-flags" className="font-bold">Preview only. Approved: no. Persisted: no. Activation ready: no.</div>
      <div data-testid="text-evidence-status">Evidence {r.evidenceValid ? 'valid' : 'not valid'} ({r.evidenceStatus}). This reflects the submitted metadata only; it is not a dashboard inspection or an approval.</div>
      <div data-testid="text-review-hash">{r.reviewHash
        ? `${r.evidenceValid ? 'Matched immutable review hash' : 'Existing review hash (submitted evidence did not match)'}: ${r.reviewHash}`
        : 'No existing reviewed hash is available.'}</div>
      {r.allocationPreview
        ? <div data-testid="text-allocation">Allocation preview: {r.allocationPreview.amount} {r.allocationPreview.currency}; {r.allocationPreview.subaccounts.map(s => `subaccount ${s.id} ${s.transaction_charge_type} charge ${s.transaction_charge}`).join('; ')}.</div>
        : <div data-testid="text-allocation">No allocation preview available.</div>}
      <div data-testid="text-policy">
        Charge {p.amount} {p.currency}; school receives {p.schoolAmount}. Fee bearer: {p.feeBearer}. Split ratio: {p.transactionSplitRatio || 'omitted'}. Eligible Partner amount {p.eligiblePartnerAmount}: {p.partnerPayment}. Partner commission is internal accrued payable only, for term-end Owner approval and export.
      </div>
      <ul data-testid="list-checks" className="space-y-1">
        {r.checks.map(c => <li key={c.key} data-testid={`check-${c.key}`}><span className="font-bold">{c.key}</span>: {c.status} - {c.detail}</li>)}
      </ul>
      {r.missingTables.length > 0
        ? <div data-testid="text-missing-tables" role="alert" className="font-bold">Schema absent: {r.missingTables.join(', ')}</div>
        : <div data-testid="text-missing-tables">No missing tables reported.</div>}
    </section>
  );
}
